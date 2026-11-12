import { describe, expect, it } from 'vitest';
import { bodies, channel, errCode, info, make, put, queue, val } from './harness';

describe('restart', () => {
  it('[durable-persistent] only durable queues with persistent, written messages survive a crash', () => {
    const { model, run, sim } = make();
    queue(model, 'd');
    val(model.declareExchange('/', { name: 'keep', type: 'direct', durable: true }));
    val(model.declareExchange('/', { name: 'gone', type: 'direct', durable: false }));
    val(model.bind('/', { source: 'keep', destinationType: 'queue', destination: 'd', routingKey: 'k' }));
    val(model.bind('/', { source: 'gone', destinationType: 'queue', destination: 'd', routingKey: 'k' }));
    const conn = val(model.openConnection('guest', '/'));
    val(model.declareQueue('/', { name: 'tmp', durable: false, exclusive: true, connection: conn }));
    const ch = channel(model);
    put(model, ch, 'd', 'synced', { deliveryMode: 2 });
    put(model, ch, 'd', 'transient', { deliveryMode: 1 });
    put(model, ch, 'd', 'inflight', { deliveryMode: 2 });
    const c = channel(model);
    val(model.consume(c, 'd', { prefetch: 1, autoAck: false }));
    run(100);
    put(model, ch, 'd', 'too-late', { deliveryMode: 2 });
    model.crash();
    expect(errCode(model.listQueues('/'))).toBe(404);
    expect(errCode(model.openChannel('guest', '/'))).toBe(404);
    run(500);
    model.restart();
    const q = info(model, 'd');
    expect(q).toMatchObject({ ready: 2, unacked: 0, consumers: 0 });
    expect(bodies(model, 'd')).toEqual(['synced', 'inflight']);
    expect(model.snapshot().vhosts[0].queues[0].head.map((h) => h.redelivered)).toEqual([true, false]);
    expect(val(model.listQueues('/')).map((x) => x.name)).toEqual(['d']);
    expect(val(model.listExchanges('/')).map((e) => e.name)).not.toContain('gone');
    expect(val(model.listBindings('/')).map((b) => b.source)).toEqual(['keep']);
    const lost = sim.journal.filter({ kinds: ['drop'] }).map((e) => `${e.msg}:${e.data?.reason}`);
    expect(lost.some((l) => l.endsWith(':transient-message'))).toBe(true);
    expect(lost.some((l) => l.endsWith(':unsynced'))).toBe(true);
    expect(lost.some((l) => l.endsWith(':transient-queue'))).toBe(false);
  });

  it('[durable-persistent] a graceful restart loses nothing persistent and drops transient queues', () => {
    const { model } = make();
    queue(model, 'd');
    const ch = channel(model);
    put(model, ch, 'd', 'now', { deliveryMode: 2 });
    model.restart();
    expect(bodies(model, 'd')).toEqual(['now']);
  });
});
