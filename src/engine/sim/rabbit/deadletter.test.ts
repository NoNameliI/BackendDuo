import { describe, expect, it } from 'vitest';
import { deadLetter, deliveryHeaders, isDeadLetterCycle } from './deadletter';
import { bodies, channel, make, put, queue, val } from './harness';
import type { Msg } from './queue';

const msg = (over: Partial<Msg> = {}): Msg => ({
  id: 'm1',
  body: 'b',
  size: 1,
  exchange: 'orders',
  routingKey: 'order.new',
  props: { headers: { h: 1 } },
  persistent: false,
  publishedAt: 0,
  deaths: [],
  history: [],
  ...over,
});

/** work -> dlx (fanout) -> dlq */
function topology(workArgs: Record<string, unknown> = {}) {
  const t = make();
  val(t.model.declareExchange('/', { name: 'dlx', type: 'fanout', durable: true }));
  queue(t.model, 'dlq');
  val(t.model.bind('/', { source: 'dlx', destinationType: 'queue', destination: 'dlq', routingKey: '' }));
  queue(t.model, 'work', { 'x-dead-letter-exchange': 'dlx', ...workArgs });
  return t;
}
const reasons = (t: ReturnType<typeof make>) => t.sim.journal.filter({ kinds: ['deadletter'] }).map((e) => e.data?.reason);

describe('dead lettering', () => {
  it('[dlx-reasons] rejected, expired and maxlen go to the DLX; without a DLX the message is lost', () => {
    const t = topology({ 'x-message-ttl': 100, 'x-max-length': 2 });
    const ch = channel(t.model);
    put(t.model, ch, 'work', 'a');
    val(t.model.get(ch, 'work', 'manual'));
    val(t.model.reject(ch, 1, false));
    put(t.model, ch, 'work', 'b');
    t.run(200);
    put(t.model, ch, 'work', 'c1');
    put(t.model, ch, 'work', 'c2');
    put(t.model, ch, 'work', 'c3');
    expect(reasons(t)).toEqual(['rejected', 'expired', 'maxlen']);
    expect(bodies(t.model, 'dlq')).toEqual(['a', 'b', 'c1']);
    const bare = make();
    queue(bare.model, 'plain');
    const c2 = channel(bare.model);
    put(bare.model, c2, 'plain', 'x');
    val(bare.model.get(c2, 'plain', 'manual'));
    val(bare.model.reject(c2, 1, false));
    const drop = bare.sim.journal.filter({ kinds: ['drop'] });
    expect(drop).toHaveLength(1);
    expect(drop[0].rule).toBe('dlx-reasons');
  });

  it('[dlx-routing-key] the configured dead-letter key wins, otherwise the original keys stay', () => {
    const t = make();
    val(t.model.declareExchange('/', { name: 'dlx', type: 'direct', durable: true }));
    queue(t.model, 'by-key');
    queue(t.model, 'by-dead');
    val(t.model.bind('/', { source: 'dlx', destinationType: 'queue', destination: 'by-key', routingKey: 'original' }));
    val(t.model.bind('/', { source: 'dlx', destinationType: 'queue', destination: 'by-dead', routingKey: 'dead' }));
    val(t.model.declareExchange('/', { name: 'in', type: 'direct', durable: true }));
    queue(t.model, 'keep', { 'x-dead-letter-exchange': 'dlx' });
    queue(t.model, 'rewrite', { 'x-dead-letter-exchange': 'dlx', 'x-dead-letter-routing-key': 'dead' });
    val(t.model.bind('/', { source: 'in', destinationType: 'queue', destination: 'keep', routingKey: 'original' }));
    val(t.model.bind('/', { source: 'in', destinationType: 'queue', destination: 'rewrite', routingKey: 'original' }));
    const ch = channel(t.model);
    put(t.model, ch, 'original', 'm', {}, 'in');
    val(t.model.get(ch, 'keep', 'manual'));
    val(t.model.reject(ch, 1, false));
    val(t.model.get(ch, 'rewrite', 'manual'));
    val(t.model.reject(ch, 2, false));
    expect(bodies(t.model, 'by-key')).toEqual(['m']);
    expect(bodies(t.model, 'by-dead')).toEqual(['m']);
  });

  it('[x-death] one entry per queue and reason with a count, newest first; first stays, last moves', () => {
    const first = deadLetter(msg({ props: { expiration: '60000' } }), 'work', 'rejected', 'dlx', null, 100);
    expect(first.props.expiration).toBeUndefined();
    expect(first.deaths).toEqual([
      { queue: 'work', reason: 'rejected', count: 1, exchange: 'orders', 'routing-keys': ['order.new'], time: 100, 'original-expiration': '60000' },
    ]);
    expect(first.exchange).toBe('dlx');
    const again = deadLetter(first, 'work', 'rejected', 'dlx', null, 200);
    expect(again.deaths).toHaveLength(1);
    expect(again.deaths[0]).toMatchObject({ count: 2, time: 200, exchange: 'orders' });
    const other = deadLetter(again, 'retry', 'expired', 'dlx', 'rk', 300);
    expect(other.deaths.map((d) => `${d.queue}/${d.reason}`)).toEqual(['retry/expired', 'work/rejected']);
    expect(other.routingKey).toBe('rk');
    const h = deliveryHeaders(other, 0);
    expect(h['x-first-death-queue']).toBe('work');
    expect(h['x-first-death-reason']).toBe('rejected');
    expect(h['x-last-death-queue']).toBe('retry');
    expect(h['x-last-death-reason']).toBe('expired');
  });

  it('[x-death] a consumer of the dead-letter queue sees the headers and no expiration', () => {
    const t = topology();
    const ch = channel(t.model);
    put(t.model, ch, 'work', 'm', { expiration: '60000', headers: { k: 'v' } });
    val(t.model.get(ch, 'work', 'manual'));
    val(t.model.reject(ch, 1, false));
    const d = val(t.model.get(ch, 'dlq', 'auto'));
    expect(d?.props.expiration).toBeUndefined();
    expect(d?.headers['x-death']).toEqual([
      expect.objectContaining({ queue: 'work', reason: 'rejected', count: 1, exchange: '', 'routing-keys': ['work'], 'original-expiration': '60000' }),
    ]);
    expect(d?.headers.k).toBe('v');
  });

  it('[dl-cycle] a cycle without a rejection drops the message, a rejection lets it go on', () => {
    const msgA = deadLetter(deadLetter(msg(), 'q1', 'expired', 'x', null, 1), 'q2', 'expired', 'x', null, 2);
    expect(isDeadLetterCycle(msgA, 'q1', 'expired')).toBe(true);
    expect(isDeadLetterCycle(msgA, 'q3', 'expired')).toBe(false);
    const msgB = deadLetter(deadLetter(msg(), 'q1', 'rejected', 'x', null, 1), 'q2', 'expired', 'x', null, 2);
    expect(isDeadLetterCycle(msgB, 'q1', 'expired')).toBe(false);
    expect(isDeadLetterCycle(msgA, 'q1', 'rejected')).toBe(false);

    const t = make();
    for (const [n, other] of [['q1', 'x2'], ['q2', 'x1']]) {
      val(t.model.declareExchange('/', { name: other === 'x2' ? 'x1' : 'x2', type: 'fanout', durable: true }));
      queue(t.model, n, { 'x-message-ttl': 50, 'x-dead-letter-exchange': other });
    }
    val(t.model.bind('/', { source: 'x1', destinationType: 'queue', destination: 'q1', routingKey: '' }));
    val(t.model.bind('/', { source: 'x2', destinationType: 'queue', destination: 'q2', routingKey: '' }));
    put(t.model, channel(t.model), 'q1', 'loop');
    t.run(2000);
    const drop = t.sim.journal.filter({ kinds: ['drop'] });
    expect(drop.map((e) => e.rule)).toEqual(['dl-cycle']);
    expect(reasons(t)).toEqual(['expired', 'expired']);
    expect(t.model.snapshot().vhosts[0].queues.map((q) => q.messages)).toEqual([0, 0]);
  });
});
