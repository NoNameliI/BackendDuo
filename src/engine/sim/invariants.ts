import { z } from 'zod';
import { percentile } from './metrics';
import type { Journal, JournalEntry, Metrics, Ms } from './types';

/**
 * Journal conventions the invariants rely on (models must follow them):
 * - kind 'publish' with `msg` (data.confirms = true when the publisher waits for confirms, data.body optional);
 * - kind 'confirm' with `msg`, data.ok = false for a nack;
 * - an entry with data.processed = true marks one processing of `msg` by `actor` (data.key, data.seq optional);
 * - kind 'drop' with `msg` = message lost for good; kind 'return' = basic.return;
 * - kind 'deadletter' with `subject` = target queue (data.body, data.reason optional).
 * Metrics: q.<queue>.ready, lag.<group>, latency.p95.
 */
export const invariantSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('noLoss'), from: z.number().optional() }),
  z.object({ kind: z.literal('noDuplicateProcessing'), actor: z.string() }),
  z.object({ kind: z.literal('orderedByKey'), actor: z.string() }),
  z.object({ kind: z.literal('lagBelow'), group: z.string(), value: z.number(), byMs: z.number() }),
  z.object({ kind: z.literal('depthBelow'), queue: z.string(), value: z.number(), byMs: z.number() }),
  z.object({
    kind: z.literal('dlqContains'),
    queue: z.string(),
    count: z.number().int().optional(),
    bodies: z.array(z.string()).optional(),
    reason: z.string().optional(),
  }),
  z.object({ kind: z.literal('latencyP95Below'), ms: z.number() }),
  z.object({ kind: z.literal('processedAtLeast'), actor: z.string(), count: z.number().int(), byMs: z.number() }),
  z.object({ kind: z.literal('noReturned') }),
  z.object({ kind: z.literal('allConfirmed') }),
]);
export type Invariant = z.infer<typeof invariantSchema>;

export interface InvariantResult {
  ok: boolean;
  text: string;
  /** Message ids, first violation first. */
  evidence: string[];
}

const ok = (text: string): InvariantResult => ({ ok: true, text, evidence: [] });
const fail = (text: string, evidence: string[] = []): InvariantResult => ({ ok: false, text, evidence });
const uniq = (xs: string[]): string[] => [...new Set(xs)];
const processed = (j: Journal, actor: string): JournalEntry[] =>
  j.entries().filter((e) => e.data?.processed === true && e.actor === actor && e.msg !== undefined);

/** "Below" means "not above": the threshold itself is acceptable. */
function seriesBelow(m: Metrics, id: string, value: number, byMs: Ms, what: string): InvariantResult {
  const s = m.series().find((x) => x.id === id);
  if (!s) return fail(`${what}: нет данных (${id})`);
  const late = s.points.filter(([t]) => t >= byMs);
  if (late.length === 0) return fail(`${what}: симуляция не дошла до ${byMs} мс`);
  const bad = late.find(([, v]) => v > value);
  return bad
    ? fail(`${what}: на ${bad[0]} мс значение ${bad[1]} больше ${value} (срок ${byMs} мс)`)
    : ok(`${what}: не больше ${value} после ${byMs} мс`);
}

export function evaluate(inv: Invariant, sim: { journal: Journal; metrics: Metrics }): InvariantResult {
  const j = sim.journal;
  switch (inv.kind) {
    case 'noLoss': {
      const from = inv.from ?? 0;
      const published = new Set(j.filter({ kinds: ['publish'], from }).flatMap((e) => (e.msg ? [e.msg] : [])));
      const lost = uniq(j.filter({ kinds: ['drop'] }).flatMap((e) => (e.msg && published.has(e.msg) ? [e.msg] : [])));
      return lost.length ? fail(`Потеряно сообщений: ${lost.length}`, lost) : ok('Потерь нет');
    }
    case 'noDuplicateProcessing': {
      const seen = new Set<string>();
      const dup: string[] = [];
      for (const e of processed(j, inv.actor)) {
        if (seen.has(e.msg as string)) dup.push(e.msg as string);
        else seen.add(e.msg as string);
      }
      const d = uniq(dup);
      return d.length ? fail(`${inv.actor}: повторно обработано сообщений: ${d.length}`, d) : ok(`${inv.actor}: дублей нет`);
    }
    case 'orderedByKey': {
      const last = new Map<string, number>();
      for (const e of processed(j, inv.actor)) {
        const key = e.data?.key;
        const seq = e.data?.seq;
        if (typeof key !== 'string' || typeof seq !== 'number') continue;
        const prev = last.get(key);
        if (prev !== undefined && seq < prev) return fail(`${inv.actor}: нарушен порядок по ключу ${key}`, [e.msg as string]);
        last.set(key, seq);
      }
      return ok(`${inv.actor}: порядок по ключам сохранён`);
    }
    case 'lagBelow':
      return seriesBelow(sim.metrics, `lag.${inv.group}`, inv.value, inv.byMs, `Лаг группы ${inv.group}`);
    case 'depthBelow':
      return seriesBelow(sim.metrics, `q.${inv.queue}.ready`, inv.value, inv.byMs, `Очередь ${inv.queue}`);
    case 'dlqContains': {
      let es = j.filter({ kinds: ['deadletter'], subject: inv.queue });
      if (inv.reason !== undefined) es = es.filter((e) => e.data?.reason === inv.reason);
      const bodies = new Set(es.map((e) => e.data?.body));
      const missing = (inv.bodies ?? []).filter((b) => !bodies.has(b));
      const need = inv.count ?? (inv.bodies ? 0 : 1);
      if (missing.length) return fail(`В ${inv.queue} нет сообщений: ${missing.join(', ')}`);
      if (es.length < need) return fail(`В ${inv.queue} ${es.length} из ${need} ожидаемых сообщений`);
      return ok(`В ${inv.queue} ${es.length} сообщ.`);
    }
    case 'latencyP95Below': {
      const s = sim.metrics.series().find((x) => x.id === 'latency.p95');
      const v = s ? percentile(s.points.map((p) => p[1]), 1) : 0;
      return v > inv.ms ? fail(`Задержка p95 до ${v} мс, предел ${inv.ms} мс`) : ok(`Задержка p95 не выше ${inv.ms} мс`);
    }
    case 'processedAtLeast': {
      const n = processed(j, inv.actor).filter((e) => e.at <= inv.byMs).length;
      return n < inv.count ? fail(`${inv.actor}: обработано ${n} из ${inv.count} к ${inv.byMs} мс`) : ok(`${inv.actor}: обработано ${n}`);
    }
    case 'noReturned': {
      const r = j.filter({ kinds: ['return'] });
      return r.length ? fail(`Возвращено издателю: ${r.length}`, uniq(r.flatMap((e) => (e.msg ? [e.msg] : [])))) : ok('Возвратов нет');
    }
    case 'allConfirmed': {
      const confirmed = new Set(j.filter({ kinds: ['confirm'] }).flatMap((e) => (e.msg && e.data?.ok !== false ? [e.msg] : [])));
      const miss = uniq(j.filter({ kinds: ['publish'] }).flatMap((e) => (e.msg && e.data?.confirms === true && !confirmed.has(e.msg) ? [e.msg] : [])));
      return miss.length ? fail(`Без подтверждения: ${miss.length}`, miss) : ok('Все публикации подтверждены');
    }
  }
}
