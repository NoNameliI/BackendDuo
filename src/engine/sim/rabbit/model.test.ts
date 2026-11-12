import { describe, expect, it } from 'vitest';
import { evaluate } from '../invariants';
import { bodies, channel, errCode, info, make, put, queue, val } from './harness';
import { rabbitRules } from './rules';

describe('declarations', () => {
  it('[redeclare-406] the same declaration is idempotent, different attributes fail with 406', () => {
    const { model } = make();
    val(model.declareExchange('/', { name: 'x', type: 'direct', durable: true }));
    expect(errCode(model.declareExchange('/', { name: 'x', type: 'direct', durable: true }))).toBe(0);
    const t = model.declareExchange('/', { name: 'x', type: 'topic', durable: true });
    expect(errCode(t)).toBe(406);
    expect(!t.ok && t.error.text).toContain("inequivalent arg 'type'");
    queue(model, 'q', { 'x-message-ttl': 5 });
    expect(errCode(model.declareQueue('/', { name: 'q', durable: true, arguments: { 'x-message-ttl': 5 } }))).toBe(0);
    expect(errCode(model.declareQueue('/', { name: 'q', durable: true, arguments: { 'x-message-ttl': 6 } }))).toBe(406);
    expect(errCode(model.declareQueue('/', { name: 'q', durable: false, exclusive: true, connection: 1 }))).toBe(406);
    expect(errCode(model.declareQueue('/', { name: 'q', type: 'quorum', durable: true }))).toBe(406);
  });

  it('[reserved-name-403] names starting with amq. cannot be declared', () => {
    const { model } = make();
    expect(errCode(model.declareQueue('/', { name: 'amq.mine', durable: true }))).toBe(403);
    expect(errCode(model.declareExchange('/', { name: 'amq.mine', type: 'direct', durable: true }))).toBe(403);
    expect(val(model.declareQueue('/', { name: '', durable: true })).name).toMatch(/^amq\.gen-/);
  });

  it('[unknown-exchange-404] publishing to a missing exchange closes the channel', () => {
    const { model, sim } = make();
    const ch = channel(model);
    const r = model.publish(ch, { exchange: 'nope', routingKey: 'k', body: 'x' });
    expect(errCode(r)).toBe(404);
    const closed = model.publish(ch, { exchange: '', routingKey: 'k', body: 'x' });
    expect(errCode(closed)).toBe(404);
    expect(sim.journal.filter({ kinds: ['error'] })[0].rule).toBe('unknown-exchange-404');
  });

  it('[transient-forbidden] a non-durable non-exclusive classic queue is refused', () => {
    const { model } = make();
    expect(errCode(model.declareQueue('/', { name: 't', durable: false }))).toBe(406);
    expect(errCode(model.declareQueue('/', { name: 't', type: 'quorum', durable: false }))).toBe(406);
    const conn = val(model.openConnection('guest', '/'));
    expect(errCode(model.declareQueue('/', { name: 't', durable: false, exclusive: true, connection: conn }))).toBe(0);
  });

  it('[exclusive-queue] other connections get 405, the queue dies with its connection', () => {
    const { model } = make();
    const conn = val(model.openConnection('guest', '/'));
    val(model.declareQueue('/', { name: 'mine', durable: false, exclusive: true, connection: conn }));
    const own = val(model.openChannel('guest', '/', conn));
    expect(errCode(model.consume(own, 'mine', { prefetch: 0, autoAck: false }))).toBe(0);
    const other = channel(model);
    expect(errCode(model.consume(other, 'mine', { prefetch: 0, autoAck: false }))).toBe(405);
    expect(errCode(model.declareQueue('/', { name: 'mine', durable: false, exclusive: true, connection: 99 }))).toBe(405);
    model.closeConnection(conn);
    expect(val(model.listQueues('/'))).toEqual([]);
  });

  it('[auto-delete] the queue goes after its last consumer; one never consumed stays', () => {
    const { model } = make();
    val(model.declareQueue('/', { name: 'auto', durable: true, autoDelete: true }));
    val(model.declareQueue('/', { name: 'idle', durable: true, autoDelete: true }));
    const a = channel(model);
    const b = channel(model);
    val(model.consume(a, 'auto', { prefetch: 0, autoAck: false }));
    val(model.consume(b, 'auto', { prefetch: 0, autoAck: false }));
    model.closeChannel(a);
    expect(val(model.listQueues('/')).map((q) => q.name)).toEqual(['auto', 'idle']);
    model.closeChannel(b);
    expect(val(model.listQueues('/')).map((q) => q.name)).toEqual(['idle']);
  });

  it('[exchange-auto-delete] the exchange goes with its last binding; one never bound stays', () => {
    const { model } = make();
    queue(model, 'q');
    val(model.declareExchange('/', { name: 'tmp', type: 'fanout', durable: true, autoDelete: true }));
    val(model.declareExchange('/', { name: 'fresh', type: 'fanout', durable: true, autoDelete: true }));
    const b = { source: 'tmp', destinationType: 'queue' as const, destination: 'q', routingKey: '' };
    val(model.bind('/', b));
    val(model.bind('/', { ...b, routingKey: 'k' }));
    val(model.unbind('/', b));
    expect(val(model.listExchanges('/')).map((e) => e.name)).toContain('tmp');
    val(model.unbind('/', { ...b, routingKey: 'k' }));
    const names = val(model.listExchanges('/')).map((e) => e.name);
    expect(names).not.toContain('tmp');
    expect(names).toContain('fresh');
  });
});

describe('alarm', () => {
  it('[alarm-blocks-publishers] publishing waits for the alarm to clear, consumers keep working', () => {
    const { model, run } = make();
    queue(model, 'q');
    const pub = channel(model);
    put(model, pub, 'q', 'before');
    model.setAlarm(true);
    put(model, pub, 'q', 'during');
    expect(info(model, 'q')?.ready).toBe(1);
    const c = channel(model);
    val(model.consume(c, 'q', { prefetch: 0, autoAck: false }));
    expect(model.takeDeliveries(c).map((d) => d.body)).toEqual(['before']);
    run(500);
    expect(info(model, 'q')?.messages).toBe(1);
    model.setAlarm(false);
    expect(model.takeDeliveries(c).map((d) => d.body)).toEqual(['during']);
  });
});

const orders = (extra: object = {}, config: object = {}) => ({
  seed: 7,
  durationMs: 20000,
  actors: [
    { id: 'api', kind: 'producer', rate: 10, count: 20, message: { body: 'order {n}', key: 'c{n%3}', routingKey: 'orders' }, config: { confirms: true } },
    { id: 'mailer', kind: 'consumer', queue: 'orders', processMs: 50, jitterMs: 20, config: { prefetch_count: 2, ...config } },
  ],
  faults: [{ at: 520, kind: 'consumer.crash', actor: 'mailer', afterProcess: true }],
  expect: [{ kind: 'noLoss' }, { kind: 'noDuplicateProcessing', actor: 'mailer' }, { kind: 'allConfirmed' }],
  ...extra,
});

function runScenario(sc: object, seed = 7) {
  const t = make(sc, seed);
  queue(t.model, 'orders');
  t.sim.runToIdle();
  return t;
}

describe('scenarios', () => {
  it('a crash after processing makes a duplicate unless the consumer is idempotent', () => {
    const t = runScenario(orders());
    const res = t.sim.journal.filter({ kinds: ['process'] }).filter((e) => e.actor === 'mailer');
    expect(res.length).toBe(21);
    const inv = evaluate({ kind: 'noDuplicateProcessing', actor: 'mailer' }, t.sim);
    expect(inv.ok).toBe(false);
    expect(evaluate({ kind: 'noLoss' }, t.sim).ok).toBe(true);
    expect(evaluate({ kind: 'allConfirmed' }, t.sim).ok).toBe(true);
    const idem = runScenario(orders({}, { idempotent: true }));
    expect(evaluate({ kind: 'noDuplicateProcessing', actor: 'mailer' }, idem.sim).ok).toBe(true);
    expect(info(idem.model, 'orders')?.messages).toBe(0);
  });

  it('auto_ack loses the message in flight when the consumer crashes', () => {
    const t = runScenario(orders({ faults: [{ at: 520, kind: 'consumer.crash', actor: 'mailer', afterProcess: false }] }, { auto_ack: true }));
    expect(evaluate({ kind: 'noLoss' }, t.sim).ok).toBe(false);
  });

  it('a lost confirm makes the producer republish the same message', () => {
    const t = runScenario(orders({ faults: [{ at: 0, kind: 'ack.lost', actor: 'api' }] }));
    expect(t.sim.journal.filter({ kinds: ['publish'] }).filter((e) => e.msg === 'api-1')).toHaveLength(2);
    expect(evaluate({ kind: 'noDuplicateProcessing', actor: 'mailer' }, t.sim).ok).toBe(false);
  });

  it('failEveryN with nack-requeue redelivers and processes everything', () => {
    const t = runScenario({ ...orders({ faults: [] }), actors: [orders().actors[0], { ...orders().actors[1], failEveryN: 3, config: { prefetch_count: 1, on_error: 'nack-requeue' } }] });
    expect(info(t.model, 'orders')?.messages).toBe(0);
    expect(t.sim.journal.filter({ kinds: ['process'] })).toHaveLength(20);
    expect(info(t.model, 'orders')?.redelivered).toBeGreaterThan(0);
  });

  it('the same scenario and seed give an identical journal, another seed does not', () => {
    const dump = (seed: number) => {
      const t = runScenario(orders(), seed);
      return JSON.stringify([t.sim.journal.entries(), t.sim.metrics.series(), t.sim.snapshot()]);
    };
    expect(dump(7)).toBe(dump(7));
    expect(dump(7)).not.toBe(dump(8));
  });

  it('a broker crash and restart bring the consumer back', () => {
    const sc = orders({ faults: [{ at: 300, kind: 'broker.crash' }, { at: 800, kind: 'broker.restart' }] });
    const t = runScenario(sc);
    expect(t.model.snapshot().up).toBe(true);
    expect(t.sim.journal.filter({ kinds: ['process'] }).length).toBeGreaterThan(0);
    expect(Object.keys(rabbitRules).length).toBeGreaterThan(30);
  });

  it('sample reports queue depth and rates', () => {
    const t = runScenario(orders({ faults: [] }));
    expect(t.sim.metrics.get('q.orders.ready')).toBeDefined();
    expect(t.sim.metrics.get('rate.publish')?.points.some(([, v]) => v > 0)).toBe(true);
    expect(t.sim.metrics.get('latency.p95')?.points.at(-1)?.[1]).toBeGreaterThan(0);
    expect(bodies(t.model, 'orders')).toEqual([]);
  });
});
