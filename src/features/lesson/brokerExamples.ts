import { loadBrokerLib } from '@/features/broker/brokerStore';
import type { BrokerTask, Lesson } from '@/content/loadCourse';
import { explainFailure } from '@/engine/sim/explain';
import { evaluate } from '@/engine/sim/invariants';
import { parseScenario } from '@/engine/sim/scenario';
import { kafkaRules } from '@/engine/sim/kafka/rules';
import { rabbitRules } from '@/engine/sim/rabbit/rules';

export interface BrokerRun {
  command: string;
  lines: { text: string; tone: 'out' | 'err' | 'dim' }[];
  exit: number;
}

export interface ScenarioRun {
  error?: string;
  /** Verdict of every `expect` entry. */
  checks: { ok: boolean; text: string }[];
  /** Explanation lines of the first violation. */
  trace: string[];
  published: number;
  /** The most important journal lines (faults, drops, dead letters, returns). */
  notable: string[];
  durationMs: number;
}

type Lib = Awaited<ReturnType<typeof loadBrokerLib>>;
type Box = ReturnType<Lib['createSandbox']>;

// Theory examples of a lesson share one example broker and run in order, like commands typed by hand.
let shared: { lesson: string; box: Box } | null = null;

async function sandboxFor(lesson: Lesson): Promise<Box> {
  if (shared?.lesson === lesson.id) return shared.box;
  const lib = await loadBrokerLib();
  const first = lesson.tasks.find((t) => 'brokerSolution' in t);
  const box = lib.createSandbox((first as BrokerTask | undefined)?.sim ?? 'rabbit');
  box.run(lesson.exampleSetup);
  shared = { lesson: lesson.id, box };
  return box;
}

export async function runBrokerExample(lesson: Lesson, script: string): Promise<BrokerRun[]> {
  const lib = await loadBrokerLib();
  const box = await sandboxFor(lesson);
  return lib.splitScript(script).map((command) => {
    const r = box.console.exec(command);
    box.sim.runUntil(box.sim.now);
    return { command: command.split('\n')[0], lines: r.lines, exit: r.exit };
  });
}

export function resetBrokerExamples(): void {
  shared = null;
}

/** A whole scenario in its own broker, run to the end. */
export async function runScenarioExample(json: string): Promise<ScenarioRun> {
  const lib = await loadBrokerLib();
  try {
    const scenario = parseScenario(JSON.parse(json));
    const box = lib.createSandbox(scenario.sim, scenario);
    box.run(scenario.setup);
    box.sim.runUntil(scenario.durationMs);
    const journal = box.sim.journal;
    const checks = scenario.expect.map((inv) => {
      const r = evaluate(inv, box.sim);
      return { ok: r.ok, text: r.text, trace: r.ok ? [] : explainFailure(r, journal, scenario.sim === 'kafka' ? kafkaRules : rabbitRules) };
    });
    const entries = journal.entries();
    return {
      checks: checks.map(({ ok, text }) => ({ ok, text })),
      trace: checks.find((c) => !c.ok)?.trace ?? [],
      published: entries.filter((e) => e.kind === 'publish').length,
      notable: entries
        .filter((e) => ['fault', 'drop', 'deadletter', 'return', 'error', 'handler.error', 'overflow', 'sim.limit', 'leader', 'isr', 'rebalance'].includes(e.kind))
        .slice(0, 8)
        .map((e) => `${(e.at / 1000).toFixed(2).replace('.', ',')} с — ${e.text}`),
      durationMs: scenario.durationMs,
    };
  } catch (e) {
    return { checks: [], trace: [], published: 0, notable: [], durationMs: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
