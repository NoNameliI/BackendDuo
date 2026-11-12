// Python client code (pika, confluent_kafka) talks to the same TypeScript broker simulators as the console:
// the shims in ./shims call `_studio_broker.call(json)`, this module runs the operation on a simulator and
// keeps a journal of every operation with its result. The journal is how the app's main thread repeats the run on
// its own simulator (lab picture, checks): same setup and seed, same operations, same results.
import { createSandbox, type AnySandbox, type KafkaSandbox, type RabbitSandbox } from '@/engine/sim/sandbox';
import type { Scenario } from '@/engine/sim/scenario';
import type { Flavor } from '@/engine/sim/types';
import { kafkaHandler } from './bridgeKafka';
import { rabbitHandler } from './bridgeRabbit';

/** Everything that defines a fresh simulator for one client run. */
export interface ClientSetup {
  flavor: Flavor;
  /** Scenario with the task's patch applied (plain data); its actors run while the client waits. */
  scenario?: Scenario;
  /** Console scripts run in order before the client starts (scenario setup, task setup). */
  scripts: string[];
}

export type Args = Record<string, unknown>;
export interface BridgeError {
  code: number;
  name: string;
  text: string;
  scope?: 'channel' | 'connection';
}
export type BridgeResult = { ok: true; value: unknown } | { ok: false; error: BridgeError };
/** One operation of the client as it happened. */
export interface BrokerOp {
  op: string;
  args: Args;
  result: BridgeResult;
}

/** Runs one operation on a simulator; the generic ones (`advance`) are handled by the bridge itself. */
export type OpHandler = (op: string, args: Args) => BridgeResult | undefined;

/** The client stops when it has waited this long in virtual time (an endless `while True: poll()` loop). */
export const HORIZON_MS = 60_000;
/** ... or has made this many operations. */
export const MAX_OPS = 5000;

export const ok = (value: unknown = null): BridgeResult => ({ ok: true, value });
export const err = (code: number, name: string, text: string, scope?: BridgeError['scope']): BridgeResult => ({ ok: false, error: { code, name, text, ...(scope ? { scope } : {}) } });

export const str = (a: Args, k: string, def = ''): string => (typeof a[k] === 'string' ? (a[k] as string) : def);
export const num = (a: Args, k: string, def = 0): number => (typeof a[k] === 'number' && Number.isFinite(a[k]) ? (a[k] as number) : def);
export const bool = (a: Args, k: string, def = false): boolean => (typeof a[k] === 'boolean' ? (a[k] as boolean) : def);
export const rec = (a: Args, k: string): Record<string, unknown> => (a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? (a[k] as Record<string, unknown>) : {});

/** Moves the virtual clock in small steps until `done()` or `maxMs` passed; returns the time that passed. */
export function waitFor(box: AnySandbox, maxMs: number, done: () => boolean, stepMs = 10): number {
  let waited = 0;
  while (waited < maxMs && !done()) {
    const step = Math.min(stepMs, maxMs - waited);
    box.sim.runUntil(box.sim.now + step);
    waited += step;
  }
  return waited;
}

export interface Bridge {
  readonly box: AnySandbox;
  /** Operations done so far, in order. */
  readonly ops: BrokerOp[];
  /** True once a limit stopped the client. */
  readonly stopped: boolean;
  /** Runs one operation without limits and without recording it (replay). */
  apply(op: string, args: Args): BridgeResult;
  /** The function the Python shims call: `{op, args}` as JSON in, a result envelope as JSON out. */
  call(json: string): string;
}

export interface BridgeLimits {
  horizonMs?: number;
  maxOps?: number;
}

/** A simulator built from a setup description: the console scripts must all succeed. */
export function createClientSandbox(setup: ClientSetup): AnySandbox {
  const box = createSandbox(setup.flavor, setup.scenario);
  for (const script of setup.scripts) {
    const bad = box.run(script).find((r) => r.exit !== 0);
    if (bad) throw new Error(`Настройка задания упала на «${bad.line}»: ${bad.output}`);
  }
  return box;
}

export function createBridge(box: AnySandbox, limits: BridgeLimits = {}): Bridge {
  const horizon = limits.horizonMs ?? HORIZON_MS;
  const maxOps = limits.maxOps ?? MAX_OPS;
  const handler: OpHandler = box.model.flavor === 'kafka' ? kafkaHandler(box as KafkaSandbox) : rabbitHandler(box as RabbitSandbox);
  const started = box.sim.now;
  const ops: BrokerOp[] = [];
  let stopped = false;

  const apply = (op: string, args: Args): BridgeResult => {
    try {
      if (op === 'advance') {
        box.sim.runUntil(box.sim.now + Math.max(0, Math.min(num(args, 'ms'), 3_600_000)));
        return ok({ now: box.sim.now });
      }
      return handler(op, args) ?? err(-1, 'UNSUPPORTED', `Операция ${op} не поддерживается песочницей`);
    } catch (e) {
      return err(-1, 'SANDBOX_ERROR', e instanceof Error ? e.message : String(e));
    }
  };

  return {
    box,
    ops,
    get stopped() {
      return stopped;
    },
    apply,
    call(json) {
      if (stopped || box.sim.now - started >= horizon || ops.length >= maxOps) {
        stopped = true;
        return JSON.stringify({ stop: true });
      }
      let parsed: { op?: unknown; args?: unknown };
      try {
        parsed = JSON.parse(json) as { op?: unknown; args?: unknown };
      } catch {
        return JSON.stringify({ result: err(-1, 'SANDBOX_ERROR', 'Некорректный запрос к песочнице') });
      }
      const op = String(parsed.op);
      const args = parsed.args && typeof parsed.args === 'object' ? (parsed.args as Args) : {};
      const result = apply(op, args);
      ops.push({ op, args, result });
      return JSON.stringify({ result });
    },
  };
}

/**
 * Repeats a client's operations on a simulator built from the same setup. Every result must equal the recorded one;
 * a difference means the two simulators diverged (a bug, not a mistake of the learner): the text names the first one.
 */
export function replayOps(box: AnySandbox, ops: BrokerOp[]): string | null {
  const bridge = createBridge(box, { horizonMs: Infinity, maxOps: Infinity });
  for (let i = 0; i < ops.length; i++) {
    const got = bridge.apply(ops[i].op, ops[i].args);
    if (JSON.stringify(got) !== JSON.stringify(ops[i].result)) return `Повтор клиентского запуска разошёлся на операции ${i + 1} (${ops[i].op})`;
  }
  return null;
}
