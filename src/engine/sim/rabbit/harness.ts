import { Sim } from '../kernel';
import { parseScenario } from '../scenario';
import type { Scenario } from '../scenario';
import { RabbitModel, type Result } from './model';

/** Test helpers: a model inside a kernel with its clock wired. */
export function make(scenario?: unknown, seed = 1) {
  const sc: Scenario | undefined = scenario === undefined ? undefined : parseScenario({ sim: 'rabbit', seed, durationMs: 60000, ...(scenario as object) });
  const model = new RabbitModel(sc);
  const sim = new Sim(model, { seed });
  model.setClock((ms) => void sim.runUntil(sim.now + ms));
  return { model, sim, run: (t: number) => sim.runUntil(t) };
}

export function val<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code} ${r.error.text}`);
  return r.value;
}

export const errCode = <T>(r: Result<T>): number => (r.ok ? 0 : r.error.code);

/** Declares a durable classic queue. */
export function queue(m: RabbitModel, name: string, args: Record<string, unknown> = {}, type: 'classic' | 'quorum' = 'classic'): void {
  val(m.declareQueue('/', { name, type, durable: true, arguments: args }));
}

export function channel(m: RabbitModel, user = 'guest'): number {
  return val(m.openChannel(user, '/'));
}

/** Publishes through the default exchange to a queue. */
export function put(m: RabbitModel, ch: number, key: string, body: string, props: Record<string, unknown> = {}, exchange = ''): void {
  val(m.publish(ch, { exchange, routingKey: key, body, props }));
}

export const bodies = (m: RabbitModel, name: string): string[] =>
  m.snapshot().vhosts[0].queues.find((q) => q.name === name)?.head.map((x) => x.body) ?? [];
export const info = (m: RabbitModel, name: string) => val(m.listQueues('/')).find((q) => q.name === name);
