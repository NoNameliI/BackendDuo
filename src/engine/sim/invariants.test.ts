import { describe, expect, it } from 'vitest';
import { explainFailure } from './explain';
import { evaluate } from './invariants';
import { createJournal } from './journal';
import { createMetrics } from './metrics';
import { createPingPong } from './testModel';
import { Sim } from './kernel';

function world() {
  const journal = createJournal();
  const metrics = createMetrics();
  return { journal, metrics, add: journal.add, metrics_: metrics };
}

describe('invariants', () => {
  it('noLoss, noReturned, allConfirmed on a clean ping-pong run', () => {
    const sim = new Sim(createPingPong(10), { seed: 2 });
    sim.runToIdle();
    for (const kind of ['noLoss', 'noReturned', 'allConfirmed'] as const) expect(evaluate({ kind }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'processedAtLeast', actor: 'ping', count: 10, byMs: 10_000 }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'processedAtLeast', actor: 'ping', count: 11, byMs: 10_000 }, sim).ok).toBe(false);
    expect(evaluate({ kind: 'orderedByKey', actor: 'ping' }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'noDuplicateProcessing', actor: 'ping' }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'latencyP95Below', ms: 100 }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'latencyP95Below', ms: 1 }, sim).ok).toBe(false);
  });

  it('reports lost, duplicated, unconfirmed and returned messages with evidence', () => {
    const w = world();
    w.add(0, { kind: 'publish', actor: 'p', msg: 'm1', text: 'pub', data: { confirms: true } });
    w.add(1, { kind: 'drop', actor: 'q', msg: 'm1', text: 'потеряно' });
    w.add(2, { kind: 'ack', actor: 'c', msg: 'm2', text: 'ok', data: { processed: true } });
    w.add(3, { kind: 'ack', actor: 'c', msg: 'm2', text: 'ok again', data: { processed: true } });
    w.add(4, { kind: 'return', actor: 'x', msg: 'm3', text: 'возврат' });
    const sim = { journal: w.journal, metrics: w.metrics };
    expect(evaluate({ kind: 'noLoss' }, sim)).toMatchObject({ ok: false, evidence: ['m1'] });
    expect(evaluate({ kind: 'noLoss', from: 5 }, sim).ok).toBe(true);
    expect(evaluate({ kind: 'noDuplicateProcessing', actor: 'c' }, sim)).toMatchObject({ ok: false, evidence: ['m2'] });
    expect(evaluate({ kind: 'allConfirmed' }, sim)).toMatchObject({ ok: false, evidence: ['m1'] });
    expect(evaluate({ kind: 'noReturned' }, sim)).toMatchObject({ ok: false, evidence: ['m3'] });
  });

  it('orderedByKey detects reordering', () => {
    const w = world();
    w.add(0, { kind: 'ack', actor: 'c', msg: 'a', text: '', data: { processed: true, key: 'k', seq: 2 } });
    w.add(1, { kind: 'ack', actor: 'c', msg: 'b', text: '', data: { processed: true, key: 'k', seq: 1 } });
    expect(evaluate({ kind: 'orderedByKey', actor: 'c' }, w)).toMatchObject({ ok: false, evidence: ['b'] });
  });

  it('lagBelow and depthBelow check the series after byMs', () => {
    const w = world();
    w.metrics.record(0, { 'lag.g': 50, 'q.emails.ready': 5 });
    w.metrics.record(100, { 'lag.g': 3, 'q.emails.ready': 9 });
    w.metrics.record(200, { 'lag.g': 2, 'q.emails.ready': 9 });
    expect(evaluate({ kind: 'lagBelow', group: 'g', value: 3, byMs: 100 }, w).ok).toBe(true);
    expect(evaluate({ kind: 'lagBelow', group: 'g', value: 3, byMs: 0 }, w).ok).toBe(false);
    expect(evaluate({ kind: 'lagBelow', group: 'g', value: 3, byMs: 999 }, w).ok).toBe(false);
    expect(evaluate({ kind: 'lagBelow', group: 'none', value: 3, byMs: 0 }, w).ok).toBe(false);
    expect(evaluate({ kind: 'depthBelow', queue: 'emails', value: 8, byMs: 100 }, w).ok).toBe(false);
  });

  it('dlqContains checks count, bodies and reason', () => {
    const w = world();
    w.add(0, { kind: 'deadletter', actor: 'b', subject: 'dlq', msg: 'm1', text: '', data: { body: 'bad', reason: 'rejected' } });
    expect(evaluate({ kind: 'dlqContains', queue: 'dlq' }, w).ok).toBe(true);
    expect(evaluate({ kind: 'dlqContains', queue: 'dlq', count: 2 }, w).ok).toBe(false);
    expect(evaluate({ kind: 'dlqContains', queue: 'dlq', bodies: ['bad'], reason: 'rejected' }, w).ok).toBe(true);
    expect(evaluate({ kind: 'dlqContains', queue: 'dlq', bodies: ['bad', 'worse'] }, w).ok).toBe(false);
    expect(evaluate({ kind: 'dlqContains', queue: 'dlq', reason: 'expired' }, w).ok).toBe(false);
    expect(evaluate({ kind: 'dlqContains', queue: 'other' }, w).ok).toBe(false);
  });
});

describe('explainFailure', () => {
  it('prints the verdict and the evidence path with rule texts', () => {
    const w = world();
    w.add(1200, { kind: 'deliver', actor: 'mailer', msg: 'order-17', text: 'order-17 доставлено mailer' });
    w.add(1500, { kind: 'requeue', actor: 'broker', msg: 'order-17', text: 'вернулось в очередь', rule: 'r1' });
    w.add(1600, { kind: 'ack', actor: 'mailer', msg: 'order-17', text: 'обработано повторно', data: { processed: true } });
    w.add(1700, { kind: 'ack', actor: 'mailer', msg: 'order-17', text: 'обработано повторно', data: { processed: true } });
    const r = evaluate({ kind: 'noDuplicateProcessing', actor: 'mailer' }, w);
    const lines = explainFailure(r, w.journal, { r1: { url: 'u', ru: 'unacked возвращаются при закрытии канала', status: 'exact' } });
    expect(lines[0]).toBe(r.text);
    expect(lines[1]).toContain('order-17: order-17 доставлено mailer (1,20 с) → вернулось в очередь (1,50 с) [правило: unacked возвращаются при закрытии канала] →');
    expect(explainFailure({ ok: true, text: 'ok', evidence: [] }, w.journal)).toEqual([]);
  });
});
