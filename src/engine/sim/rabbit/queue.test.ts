import { describe, expect, it } from 'vitest';
import { bodies, channel, errCode, info, make, put, queue, val } from './harness';
import type { RabbitModel } from './model';

const getBody = (m: RabbitModel, ch: number, q: string, mode: 'auto' | 'manual' = 'manual'): string | null => {
  const d = val(m.get(ch, q, mode));
  return d ? d.body : null;
};
const fill = (m: RabbitModel, q: string, n: number): number => {
  const ch = channel(m);
  for (let i = 1; i <= n; i++) put(m, ch, q, `m${i}`);
  return ch;
};

describe('acknowledgements', () => {
  it('[ack-multiple] multiple acks every tag up to the given one, tag 0 acks all', () => {
    const { model } = make();
    queue(model, 'q');
    const ch = fill(model, 'q', 4);
    for (let i = 0; i < 4; i++) getBody(model, ch, 'q');
    val(model.ack(ch, 2, true));
    expect(model.unacked(ch).map((u) => u.tag)).toEqual([3, 4]);
    val(model.ack(ch, 4, false));
    expect(model.unacked(ch).map((u) => u.tag)).toEqual([3]);
    val(model.ack(ch, 0, true));
    expect(model.unacked(ch)).toEqual([]);
    expect(info(model, 'q')?.messages).toBe(0);
  });

  it('[unknown-tag-406] an unknown or repeated tag fails the channel', () => {
    const { model } = make();
    queue(model, 'q');
    const ch = fill(model, 'q', 1);
    getBody(model, ch, 'q');
    val(model.ack(ch, 1));
    const r = model.ack(ch, 1);
    expect(errCode(r)).toBe(406);
    expect(!r.ok && r.error.text).toContain('unknown delivery tag');
    expect(errCode(model.get(ch, 'q', 'auto'))).not.toBe(0);
    expect(errCode(model.ack(channel(model), 7, true))).toBe(406);
  });

  it('[requeue-position] a requeued message returns to its original place with redelivered', () => {
    const { model } = make();
    queue(model, 'q');
    const ch = fill(model, 'q', 3);
    getBody(model, ch, 'q');
    getBody(model, ch, 'q');
    val(model.nack(ch, 2, false, true));
    val(model.reject(ch, 1, true));
    const d1 = val(model.get(ch, 'q', 'manual'));
    expect([d1?.body, d1?.redelivered]).toEqual(['m1', true]);
    const d2 = val(model.get(ch, 'q', 'manual'));
    expect([d2?.body, d2?.redelivered]).toEqual(['m2', true]);
    const d3 = val(model.get(ch, 'q', 'manual'));
    expect([d3?.body, d3?.redelivered]).toEqual(['m3', false]);
  });

  it('[close-requeue] closing the channel returns unacked messages, cancelling the consumer does not', () => {
    const { model } = make();
    queue(model, 'q');
    fill(model, 'q', 3);
    const c1 = channel(model);
    const tag = val(model.consume(c1, 'q', { prefetch: 2, autoAck: false }));
    expect(info(model, 'q')).toMatchObject({ ready: 1, unacked: 2 });
    val(model.cancel(c1, tag));
    expect(info(model, 'q')).toMatchObject({ ready: 1, unacked: 2, consumers: 0 });
    model.closeChannel(c1);
    expect(info(model, 'q')).toMatchObject({ ready: 3, unacked: 0 });
    const c2 = channel(model);
    val(model.consume(c2, 'q', { prefetch: 0, autoAck: false }));
    expect(model.takeDeliveries(c2).map((d) => [d.body, d.redelivered])).toEqual([
      ['m1', true],
      ['m2', true],
      ['m3', false],
    ]);
  });
});

describe('consumers', () => {
  it('[prefetch-per-consumer] each consumer has its own window, zero is unlimited, auto-ack is exempt', () => {
    const { model } = make();
    queue(model, 'q');
    queue(model, 'r');
    const pub = fill(model, 'q', 5);
    const c = channel(model);
    val(model.consume(c, 'q', { prefetch: 2, autoAck: false }));
    expect(info(model, 'q')).toMatchObject({ ready: 3, unacked: 2 });
    val(model.ack(c, 1));
    expect(info(model, 'q')).toMatchObject({ ready: 2, unacked: 2 });
    // a second consumer on the same channel gets its own window of 2
    for (let i = 0; i < 5; i++) put(model, pub, 'r', `r${i}`);
    val(model.consume(c, 'r', { prefetch: 2, autoAck: false }));
    expect(info(model, 'r')).toMatchObject({ ready: 3, unacked: 2 });
    const free = channel(model);
    queue(model, 's');
    for (let i = 0; i < 4; i++) put(model, pub, 's', `s${i}`);
    val(model.consume(free, 's', { prefetch: 1, autoAck: true }));
    expect(info(model, 's')).toMatchObject({ ready: 0, unacked: 0 });
    queue(model, 'u');
    for (let i = 0; i < 4; i++) put(model, pub, 'u', `u${i}`);
    val(model.consume(channel(model), 'u', { prefetch: 0, autoAck: false }));
    expect(info(model, 'u')).toMatchObject({ ready: 0, unacked: 4 });
  });

  it('[round-robin] messages alternate between consumers with room', () => {
    const { model } = make();
    queue(model, 'q');
    const a = channel(model);
    const b = channel(model);
    val(model.consume(a, 'q', { prefetch: 0, autoAck: false }));
    val(model.consume(b, 'q', { prefetch: 0, autoAck: false }));
    fill(model, 'q', 5);
    expect(model.takeDeliveries(a).map((d) => d.body)).toEqual(['m1', 'm3', 'm5']);
    expect(model.takeDeliveries(b).map((d) => d.body)).toEqual(['m2', 'm4']);
    // a full consumer is skipped
    const { model: m2 } = make();
    queue(m2, 'q');
    const x = channel(m2);
    const y = channel(m2);
    val(m2.consume(x, 'q', { prefetch: 1, autoAck: false }));
    val(m2.consume(y, 'q', { prefetch: 0, autoAck: false }));
    fill(m2, 'q', 4);
    expect(m2.takeDeliveries(x)).toHaveLength(1);
    expect(m2.takeDeliveries(y)).toHaveLength(3);
  });
});

describe('ttl', () => {
  it('[ttl-min] the smaller of queue and message TTL applies', () => {
    const { model, run } = make();
    queue(model, 'a', { 'x-message-ttl': 1000 });
    queue(model, 'b', { 'x-message-ttl': 1000 });
    const ch = channel(model);
    put(model, ch, 'a', 'short', { expiration: '300' });
    put(model, ch, 'b', 'long', { expiration: '5000' });
    run(299);
    expect([info(model, 'a')?.ready, info(model, 'b')?.ready]).toEqual([1, 1]);
    run(301);
    expect([info(model, 'a')?.ready, info(model, 'b')?.ready]).toEqual([0, 1]);
    run(999);
    expect(info(model, 'b')?.ready).toBe(1);
    run(1001);
    expect(info(model, 'b')?.ready).toBe(0);
  });

  it('[ttl-min] a requeued message keeps its original expiry', () => {
    const { model, run } = make();
    queue(model, 'q', { 'x-message-ttl': 1000 });
    const ch = fill(model, 'q', 1);
    getBody(model, ch, 'q');
    run(600);
    val(model.nack(ch, 1, false, true));
    run(900);
    expect(info(model, 'q')?.ready).toBe(1);
    run(1001);
    expect(info(model, 'q')?.ready).toBe(0);
  });

  it('[ttl-head-only] an expired message behind a live one stays until it reaches the head', () => {
    const { model, run } = make();
    queue(model, 'q');
    const ch = channel(model);
    put(model, ch, 'q', 'live');
    put(model, ch, 'q', 'old', { expiration: '100' });
    run(5000);
    expect(info(model, 'q')?.ready).toBe(2);
    expect(getBody(model, ch, 'q')).toBe('live');
    expect(getBody(model, ch, 'q')).toBeNull();
    expect(info(model, 'q')?.ready).toBe(0);
  });

  it('[queue-expires] an idle queue disappears after x-expires, a used one does not', () => {
    const { model, run, sim } = make();
    queue(model, 'idle', { 'x-expires': 1000 });
    queue(model, 'busy', { 'x-expires': 1000 });
    fill(model, 'idle', 1);
    val(model.consume(channel(model), 'busy', { prefetch: 0, autoAck: false }));
    run(999);
    expect(val(model.listQueues('/')).map((q) => q.name)).toEqual(['busy', 'idle']);
    run(1001);
    expect(val(model.listQueues('/')).map((q) => q.name)).toEqual(['busy']);
    expect(sim.journal.filter({ kinds: ['drop'] })[0].rule).toBe('queue-expires');
  });
});

describe('limits and priorities', () => {
  const dlq = (m: RabbitModel) => {
    queue(m, 'dlq');
  };
  it('[overflow] drop-head evicts the oldest ready message to the dead-letter queue, unacked are not counted', () => {
    const { model, sim } = make();
    dlq(model);
    queue(model, 'q', { 'x-max-length': 2, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'dlq' });
    const ch = fill(model, 'q', 3);
    expect(bodies(model, 'q')).toEqual(['m2', 'm3']);
    expect(bodies(model, 'dlq')).toEqual(['m1']);
    expect(sim.journal.filter({ kinds: ['deadletter'] })[0].data?.reason).toBe('maxlen');
    // evicted into the DLQ is not a loss
    expect(sim.journal.filter({ kinds: ['drop'] })).toEqual([]);
    expect(sim.journal.filter({ kinds: ['overflow'] })).toHaveLength(1);
    const c = channel(model);
    val(model.consume(c, 'q', { prefetch: 1, autoAck: false }));
    put(model, ch, 'q', 'm4');
    put(model, ch, 'q', 'm5');
    expect(info(model, 'q')).toMatchObject({ ready: 2, unacked: 1 });
  });

  it('[overflow] reject-publish refuses the new message with a nack, bytes limit counts the body', () => {
    const { model, run, sim } = make();
    queue(model, 'q', { 'x-max-length': 1, 'x-overflow': 'reject-publish' });
    const ch = channel(model);
    model.confirmSelect(ch);
    put(model, ch, 'q', 'first');
    put(model, ch, 'q', 'second');
    run(50);
    expect(bodies(model, 'q')).toEqual(['first']);
    const c = sim.journal.filter({ kinds: ['confirm'] }).map((e) => e.data?.ok);
    expect(c).toEqual([true, false]);
    queue(model, 'bytes', { 'x-max-length-bytes': 10 });
    put(model, ch, 'bytes', '123456');
    put(model, ch, 'bytes', '123456');
    expect(bodies(model, 'bytes')).toEqual(['123456']);
  });

  it('[overflow] reject-publish-dlx dead-letters the refused message; quorum queues do not support it', () => {
    const { model } = make();
    queue(model, 'dlq');
    queue(model, 'q', { 'x-max-length': 1, 'x-overflow': 'reject-publish-dlx', 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'dlq' });
    fill(model, 'q', 2);
    expect(bodies(model, 'q')).toEqual(['m1']);
    expect(bodies(model, 'dlq')).toEqual(['m2']);
    const r = model.declareQueue('/', { name: 'qq', type: 'quorum', durable: true, arguments: { 'x-overflow': 'reject-publish-dlx' } });
    expect(errCode(r)).toBe(406);
  });

  it('[priority-clamp] higher priority first, above x-max-priority becomes the maximum, none is 0', () => {
    const { model } = make();
    queue(model, 'p', { 'x-max-priority': 5 });
    const ch = channel(model);
    put(model, ch, 'p', 'none');
    put(model, ch, 'p', 'two', { priority: 2 });
    put(model, ch, 'p', 'nine', { priority: 9 });
    put(model, ch, 'p', 'five', { priority: 5 });
    expect(model.snapshot().vhosts[0].queues.find((q) => q.name === 'p')?.head.map((h) => h.priority)).toEqual([0, 2, 5, 5]);
    expect([1, 2, 3, 4].map(() => getBody(model, ch, 'p'))).toEqual(['nine', 'five', 'two', 'none']);
    queue(model, 'plain');
    put(model, ch, 'plain', 'a');
    put(model, ch, 'plain', 'b', { priority: 9 });
    expect([getBody(model, ch, 'plain'), getBody(model, ch, 'plain')]).toEqual(['a', 'b']);
  });

  it('[priority-clamp] messages already delivered are not overtaken', () => {
    const { model } = make();
    queue(model, 'p', { 'x-max-priority': 5 });
    const ch = channel(model);
    val(model.consume(ch, 'p', { prefetch: 2, autoAck: false }));
    put(model, ch, 'p', 'low1');
    put(model, ch, 'p', 'low2');
    put(model, ch, 'p', 'high', { priority: 5 });
    expect(model.takeDeliveries(ch).map((d) => d.body)).toEqual(['low1', 'low2']);
    val(model.ack(ch, 1));
    expect(model.takeDeliveries(ch).map((d) => d.body)).toEqual(['high']);
  });
});

describe('quorum', () => {
  it('[quorum-priority] priorities are strict 0-31, absent means 4', () => {
    const { model } = make();
    queue(model, 'qq', {}, 'quorum');
    const ch = channel(model);
    put(model, ch, 'qq', 'default');
    put(model, ch, 'qq', 'three', { priority: 3 });
    put(model, ch, 'qq', 'huge', { priority: 40 });
    put(model, ch, 'qq', 'max', { priority: 31 });
    expect(model.snapshot().vhosts[0].queues.find((q) => q.name === 'qq')?.head.map((h) => h.priority)).toEqual([4, 3, 31, 31]);
    expect([1, 2, 3, 4].map(() => getBody(model, ch, 'qq'))).toEqual(['huge', 'max', 'default', 'three']);
  });

  it('[delivery-limit] returned messages go to the head and carry x-delivery-count', () => {
    const { model } = make();
    queue(model, 'qq', {}, 'quorum');
    const ch = fill(model, 'qq', 2);
    getBody(model, ch, 'qq');
    getBody(model, ch, 'qq');
    val(model.nack(ch, 2, false, true));
    val(model.nack(ch, 1, false, true));
    const first = val(model.get(ch, 'qq', 'manual'));
    expect([first?.body, first?.headers['x-delivery-count']]).toEqual(['m2', 1]);
    expect(getBody(model, ch, 'qq')).toBe('m1');
  });

  it('[delivery-limit] after 20 returns the next one dead-letters with reason delivery_limit', () => {
    const { model, sim } = make();
    queue(model, 'dlq');
    queue(model, 'qq', { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'dlq' }, 'quorum');
    const ch = fill(model, 'qq', 1);
    let tag = 0;
    for (let i = 1; i <= 20; i++) {
      const d = val(model.get(ch, 'qq', 'manual'));
      tag = d?.tag ?? 0;
      val(model.nack(ch, tag, false, true));
      expect(info(model, 'qq')?.ready).toBe(1);
    }
    const d = val(model.get(ch, 'qq', 'manual'));
    expect(d?.headers['x-delivery-count']).toBe(20);
    val(model.nack(ch, d?.tag ?? 0, false, true));
    expect(info(model, 'qq')?.messages).toBe(0);
    expect(bodies(model, 'dlq')).toEqual(['m1']);
    expect(sim.journal.filter({ kinds: ['deadletter'] })[0].data?.reason).toBe('delivery_limit');
  });
});

describe('confirms', () => {
  it('[confirm-after-disk] sequence starts at 1; persistent in a durable queue waits for the disk write', () => {
    const { model, run, sim } = make();
    queue(model, 'd');
    const ch = channel(model);
    expect(val(model.publish(ch, { exchange: '', routingKey: 'd', body: 'x' }))).toEqual({});
    model.confirmSelect(ch);
    expect(val(model.publish(ch, { exchange: '', routingKey: 'd', body: 'persistent', props: { deliveryMode: 2 } })).seq).toBe(1);
    expect(val(model.publish(ch, { exchange: '', routingKey: 'd', body: 'transient', props: { delivery_mode: 1 } })).seq).toBe(2);
    run(5);
    const seqs = () => sim.journal.filter({ kinds: ['confirm'] }).map((e) => e.data?.seq);
    expect(seqs()).toEqual([2]);
    run(10);
    expect(seqs()).toEqual([2, 1]);
  });
});
