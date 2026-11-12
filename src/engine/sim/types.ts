import type { Rng } from '../drill/types';
import type { RuleId } from './rules';

export type Ms = number;
export type Flavor = 'rabbit' | 'kafka';
/** Lower class runs first at equal time: 0 control/fault, 1 broker internal, 2 network, 3 client, 4 sample. */
export type EventClass = 0 | 1 | 2 | 3 | 4;
export interface SimEvent {
  id: number;
  at: Ms;
  cls: EventClass;
  kind: string;
  data: Record<string, unknown>;
}

export interface JournalEntry {
  seq: number;
  at: Ms;
  /** 'publish'|'route'|'deliver'|'ack'|'nack'|'requeue'|'expire'|'deadletter'|'drop'|'return'|'confirm'|'produce'|
   *  'append'|'replicate'|'isr'|'leader'|'fetch'|'commit'|'rebalance'|'assign'|'revoke'|'retention'|'compact'|
   *  'fault'|'error'|'sim.limit' */
  kind: string;
  actor: string;
  /** queue, exchange, topic-p */
  subject?: string;
  /** message id */
  msg?: string;
  /** one Russian line */
  text: string;
  rule?: RuleId;
  data?: Record<string, string | number | boolean | null>;
}
export type JournalDraft = Omit<JournalEntry, 'seq' | 'at'>;
export interface JournalFilter {
  kinds?: string[];
  actor?: string;
  subject?: string;
  msg?: string;
  from?: Ms;
  to?: Ms;
  important?: boolean;
}
/** Capped at 50 000 entries, then one `sim.limit` entry. */
export interface Journal {
  entries(): readonly JournalEntry[];
  filter(f: JournalFilter): JournalEntry[];
}

export interface Series {
  id: string;
  points: [Ms, number][];
}
export interface Metrics {
  series(): Series[];
  get(id: string): Series | undefined;
}

export interface KernelApi {
  readonly now: Ms;
  /** Returns the event id. */
  schedule(delay: Ms, cls: EventClass, kind: string, data?: Record<string, unknown>): number;
  cancel(id: number): void;
  /** createRng(hashSeed(seed, stream)); one stream per actor/purpose. */
  rng(stream: string): Rng;
  log(e: JournalDraft): void;
}
export interface Model<S> {
  readonly flavor: Flavor;
  attach(k: KernelApi): void;
  handle(ev: SimEvent): void;
  /** Gauges and counters sampled every `sampleMs`. */
  sample(): Record<string, number>;
  /** Plain JSON, structuredClone-safe. */
  snapshot(): S;
  /** True when no pending work besides idle timers (used by `runToIdle`). */
  quiet(): boolean;
}
export interface SimOptions {
  seed: number;
  /** default 100 */
  sampleMs?: Ms;
  /** default 200_000 */
  maxEvents?: number;
  /** default 600_000 */
  horizonMs?: Ms;
}
export interface RunStats {
  events: number;
  stoppedBy: 'time' | 'idle' | 'horizon' | 'maxEvents';
}
