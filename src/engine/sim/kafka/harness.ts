import { Sim } from '../kernel';
import { parseScenario } from '../scenario';
import type { Scenario } from '../scenario';
import { KafkaModel, type KafkaOptions, type Result, type TopicSpec } from './model';

/** Test helpers: a model inside a kernel with its clock wired. Small segments are allowed here. */
export function make(scenario?: unknown, seed = 1, opts: KafkaOptions = {}) {
  const sc: Scenario | undefined = scenario === undefined ? undefined : parseScenario({ sim: 'kafka', seed, durationMs: 60000, ...(scenario as object) });
  const model = new KafkaModel(sc, { minSegmentBytes: 1, ...opts });
  const sim = new Sim(model, { seed });
  model.setClock((ms) => void sim.runUntil(sim.now + ms));
  return { model, sim, run: (t: number) => sim.runUntil(t) };
}

export function val<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code} ${r.error.name}: ${r.error.text}`);
  return r.value;
}
export const errCode = <T>(r: Result<T>): number => (r.ok ? 0 : r.error.code);

export function topic(m: KafkaModel, name: string, partitions = 1, rf = 3, configs: Record<string, string> = {}): void {
  val(m.createTopic({ name, partitions, replicationFactor: rf, configs } satisfies TopicSpec));
}

/** Sends records through a fresh producer and waits for the acknowledgements. */
export function put(m: KafkaModel, topicName: string, values: (string | { key?: string | null; value: string | null; partition?: number })[], config: Record<string, unknown> = {}) {
  return val(
    m.produce(
      topicName,
      values.map((v) => (typeof v === 'string' ? { value: v } : v)),
      config,
    ),
  );
}
