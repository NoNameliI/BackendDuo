import { createRng, hashSeed } from '../drill/rng';
import type { Rng } from '../drill/types';
import { createJournal, type JournalWriter } from './journal';
import { createMetrics, type MetricsWriter } from './metrics';
import type { EventClass, Journal, JournalDraft, KernelApi, Metrics, Model, Ms, RunStats, SimEvent, SimOptions } from './types';

const before = (a: SimEvent, b: SimEvent): boolean =>
  a.at < b.at || (a.at === b.at && (a.cls < b.cls || (a.cls === b.cls && a.id < b.id)));

/** Binary min-heap ordered by (at, cls, id). */
class Heap {
  private a: SimEvent[] = [];
  peek(): SimEvent | undefined {
    return this.a[0];
  }
  push(e: SimEvent): void {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): SimEvent | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && before(a[l], a[m])) m = l;
        if (r < a.length && before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

const SAMPLE = 'sim.sample';
type Stop = 'time' | 'horizon' | 'maxEvents';

export class Sim<S> implements KernelApi {
  private _now: Ms = 0;
  private readonly heap = new Heap();
  private readonly cancelled = new Set<number>();
  private readonly streams = new Map<string, Rng>();
  private nextId = 1;
  private processed = 0;
  private limitLogged = false;
  private readonly w: JournalWriter = createJournal();
  private readonly m: MetricsWriter = createMetrics();
  private readonly sampleMs: Ms;
  private readonly maxEvents: number;
  private readonly horizonMs: Ms;
  private readonly seed: number;

  constructor(
    private readonly model: Model<S>,
    o: SimOptions,
  ) {
    this.seed = o.seed >>> 0;
    this.sampleMs = o.sampleMs ?? 100;
    this.maxEvents = o.maxEvents ?? 200_000;
    this.horizonMs = o.horizonMs ?? 600_000;
    model.attach(this);
    this.schedule(0, 4, SAMPLE);
  }

  get now(): Ms {
    return this._now;
  }
  get journal(): Journal {
    return this.w;
  }
  get metrics(): Metrics {
    return this.m;
  }
  snapshot(): S {
    return this.model.snapshot();
  }

  schedule(delay: Ms, cls: EventClass, kind: string, data: Record<string, unknown> = {}): number {
    if (!(delay >= 0) || !Number.isFinite(delay)) throw new RangeError(`schedule(${delay})`);
    const id = this.nextId++;
    this.heap.push({ id, at: this._now + delay, cls, kind, data });
    return id;
  }
  cancel(id: number): void {
    if (id > 0 && id < this.nextId) this.cancelled.add(id);
  }
  rng(stream: string): Rng {
    let r = this.streams.get(stream);
    if (!r) this.streams.set(stream, (r = createRng(hashSeed(this.seed, stream))));
    return r;
  }
  log(e: JournalDraft): void {
    this.w.add(this._now, e);
  }

  private head(): SimEvent | undefined {
    for (;;) {
      const e = this.heap.peek();
      if (!e || !this.cancelled.has(e.id)) return e;
      this.heap.pop();
      this.cancelled.delete(e.id);
    }
  }

  private limit(why: 'maxEvents' | 'horizon'): void {
    if (this.limitLogged) return;
    this.limitLogged = true;
    const text =
      why === 'maxEvents'
        ? `Остановлено: достигнут предел ${this.maxEvents} событий`
        : `Остановлено: достигнут горизонт ${this.horizonMs} мс`;
    this.w.add(this._now, { kind: 'sim.limit', actor: 'sim', text });
  }

  /** Runs the head event if it is due by `upTo` and no limit blocks it. */
  private exec(upTo: Ms): SimEvent | Stop {
    const e = this.head();
    if (!e || e.at > upTo) return 'time';
    if (this.processed >= this.maxEvents) {
      this.limit('maxEvents');
      return 'maxEvents';
    }
    if (e.at > this.horizonMs) {
      this._now = Math.max(this._now, this.horizonMs);
      this.limit('horizon');
      return 'horizon';
    }
    this.heap.pop();
    this._now = e.at;
    this.processed++;
    if (e.kind === SAMPLE) {
      this.m.record(e.at, this.model.sample());
      this.schedule(this.sampleMs, 4, SAMPLE);
    } else this.model.handle(e);
    return e;
  }

  step(): SimEvent | null {
    const r = this.exec(Infinity);
    return typeof r === 'string' ? null : r;
  }

  runUntil(t: Ms): RunStats {
    let events = 0;
    for (;;) {
      const r = this.exec(t);
      if (typeof r !== 'string') {
        events++;
        continue;
      }
      if (r === 'time') {
        if (t > this.horizonMs) {
          this._now = Math.max(this._now, this.horizonMs);
          this.limit('horizon');
          return { events, stoppedBy: 'horizon' };
        }
        this._now = Math.max(this._now, t);
      }
      return { events, stoppedBy: r };
    }
  }

  runToIdle(limit: Ms = this.horizonMs): RunStats {
    let events = 0;
    const cap = Math.min(limit, this.horizonMs);
    while (!this.model.quiet()) {
      const r = this.exec(cap);
      if (typeof r !== 'string') {
        events++;
        continue;
      }
      if (r === 'time') {
        this._now = Math.max(this._now, cap);
        if (cap >= this.horizonMs) this.limit('horizon');
        return { events, stoppedBy: 'horizon' };
      }
      return { events, stoppedBy: r };
    }
    return { events, stoppedBy: 'idle' };
  }
}
