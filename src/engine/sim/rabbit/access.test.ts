import { describe, expect, it } from 'vitest';
import { allows, checkAccess } from './access';
import { errCode, make, queue, val } from './harness';

describe('access', () => {
  it('[permission-table] every operation checks the permission the table names', () => {
    expect(allows('', 'anything')).toBe(false);
    expect(allows('^q-', 'q-1')).toBe(true);
    expect(allows('^q-', 'x-q-1')).toBe(false);
    expect(checkAccess({ configure: '', write: '^q$', read: '^x$' }, 'queue.bind', { queue: 'q', exchange: 'x' })).toBeNull();
    expect(checkAccess({ configure: '', write: '^q$', read: '' }, 'queue.bind', { queue: 'q', exchange: 'x' })?.kind).toBe('exchange');
    expect(checkAccess(undefined, 'basic.get', { queue: 'q' })?.permission).toBe('read');

    const { model } = make();
    val(model.declareExchange('/', { name: 'x', type: 'direct', durable: true }));
    queue(model, 'q');
    queue(model, 'q-own');
    val(model.addVhost('other'));
    for (const u of ['conf', 'writer', 'reader', 'binder', 'nobody']) val(model.addUser(u));
    val(model.setPermissions('/', 'conf', '^c-', '', ''));
    val(model.setPermissions('/', 'writer', '', '^x$', ''));
    val(model.setPermissions('/', 'reader', '', '', '^q$'));
    val(model.setPermissions('/', 'binder', '', '^q$', '^x$'));

    // configure: declare and delete
    expect(val(model.declareQueue('/', { name: 'c-1', durable: true }, 'conf')).name).toBe('c-1');
    expect(errCode(model.declareQueue('/', { name: 'z', durable: true }, 'conf'))).toBe(403);
    expect(val(model.declareExchange('/', { name: 'c-x', type: 'fanout', durable: true }, 'conf'))).toBeUndefined();
    expect(errCode(model.declareExchange('/', { name: 'zx', type: 'fanout', durable: true }, 'conf'))).toBe(403);
    expect(errCode(model.deleteQueue('/', 'q', { user: 'conf' }))).toBe(403);
    expect(val(model.deleteQueue('/', 'c-1', { user: 'conf' }))).toBe(0);
    expect(errCode(model.deleteExchange('/', 'x', 'conf'))).toBe(403);

    // bind: write on the queue and read on the exchange
    const bind = (src: string, dst: string) => model.bind('/', { source: src, destinationType: 'queue', destination: dst, routingKey: 'k' }, 'binder');
    expect(errCode(bind('x', 'q'))).toBe(0);
    expect(errCode(bind('x', 'q-own'))).toBe(403);
    expect(errCode(bind('amq.direct', 'q'))).toBe(403);

    // publish: write on the exchange
    const w = val(model.openChannel('writer', '/'));
    expect(errCode(model.publish(w, { exchange: 'x', routingKey: 'k', body: '1' }))).toBe(0);
    expect(errCode(model.publish(w, { exchange: 'amq.direct', routingKey: 'k', body: '1' }))).toBe(403);
    expect(errCode(model.publish(w, { exchange: 'x', routingKey: 'k', body: '1' }))).not.toBe(0);

    // get and consume: read on the queue
    const r = val(model.openChannel('reader', '/'));
    expect(errCode(model.get(r, 'q', 'auto'))).toBe(0);
    expect(errCode(model.consume(r, 'q', { prefetch: 0, autoAck: false }))).toBe(0);
    expect(errCode(model.get(r, 'q-own', 'auto'))).toBe(403);
    const r2 = val(model.openChannel('reader', '/'));
    expect(errCode(model.consume(r2, 'q-own', { prefetch: 0, autoAck: false }))).toBe(403);

    // purge is not checked, no permissions means no connection
    expect(errCode(model.purge('/', 'q-own'))).toBe(0);
    const n = model.openChannel('nobody', '/');
    expect(errCode(n)).toBe(403);
    expect(!n.ok && n.error.scope).toBe('connection');
    expect(errCode(model.openChannel('reader', 'other'))).toBe(403);
  });
});
