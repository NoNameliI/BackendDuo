import { z } from 'zod';
import { invariantSchema } from './invariants';
import type { KernelApi } from './types';

const record = z.record(z.string(), z.unknown());

const messageSchema = z.object({
  body: z.string().optional(),
  key: z.string().optional(),
  routingKey: z.string().optional(),
  exchange: z.string().optional(),
  headers: record.optional(),
  props: record.optional(),
});

const actorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['producer', 'consumer']),
  rate: z.number().positive().optional(),
  count: z.number().int().nonnegative().optional(),
  message: messageSchema.optional(),
  queue: z.string().optional(),
  topic: z.string().optional(),
  group: z.string().optional(),
  topics: z.array(z.string()).optional(),
  processMs: z.number().nonnegative().optional(),
  jitterMs: z.number().nonnegative().optional(),
  failEveryN: z.number().int().nonnegative().optional(),
  config: record.default({}),
});

const faultSchema = z.looseObject({ at: z.number().nonnegative(), kind: z.string(), actor: z.string().optional() });

export const scenarioSchema = z.object({
  sim: z.enum(['rabbit', 'kafka']),
  seed: z.number().int().nonnegative(),
  durationMs: z.number().positive(),
  setup: z.string().default(''),
  actors: z.array(actorSchema).default([]),
  faults: z.array(faultSchema).default([]),
  expect: z.array(invariantSchema).default([]),
});
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioActor = z.infer<typeof actorSchema>;

export function parseScenario(json: unknown): Scenario {
  return scenarioSchema.parse(json);
}

/** The only substitution in message templates: `{n}` and `{n%K}`. */
export function expandTemplate(tpl: string, n: number): string {
  return tpl.replace(/\{n(?:%(\d+))?\}/g, (_, k: string | undefined) => String(k ? n % Number(k) : n));
}

/** Scenario faults become class-0 events; the model handles them by `kind`. */
export function scheduleFaults(sc: Scenario, k: KernelApi): void {
  for (const f of sc.faults) {
    const { at, kind, ...data } = f;
    k.schedule(Math.max(0, at - k.now), 0, kind, data);
  }
}

function parseValue(v: string): string | number | boolean {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
}

/**
 * Learner overrides on top of `config`: lines `actor.key=value` and `topic.<name>.<config>=value`
 * (keys may contain dots, e.g. `mailer.prefetch_count=1`, `orders-api.enable.idempotence=true`).
 */
export function applyProperties(sc: Scenario, lines: readonly string[]): { scenario: Scenario; errors: string[] } {
  const scenario = structuredClone(sc);
  const errors: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    const path = eq < 0 ? '' : line.slice(0, eq).trim();
    const dot = path.indexOf('.');
    if (eq < 0 || dot <= 0 || dot === path.length - 1) {
      errors.push(`Ожидалось actor.ключ=значение: ${line}`);
      continue;
    }
    const value = parseValue(line.slice(eq + 1).trim());
    const head = path.slice(0, dot);
    const rest = path.slice(dot + 1);
    const direct = scenario.actors.find((a) => a.id === head);
    if (direct) {
      direct.config[rest] = value;
      continue;
    }
    const d2 = rest.indexOf('.');
    if (head === 'topic' && d2 > 0) {
      const name = rest.slice(0, d2);
      const targets = scenario.actors.filter((a) => a.topic === name || a.topics?.includes(name));
      if (targets.length === 0) errors.push(`Нет участников с топиком ${name}: ${line}`);
      for (const a of targets) a.config[rest.slice(d2 + 1)] = value;
      continue;
    }
    errors.push(`Неизвестный участник ${head}: ${line}`);
  }
  return { scenario, errors };
}
