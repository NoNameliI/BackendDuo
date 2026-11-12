import { describe, expect, it } from 'vitest';
import { bodies, channel, errCode, make, put, queue, val } from './harness';
import { matchHeaders, matchTopic, route, type Binding, type Exchange, type RouteCtx } from './routing';

const ex = (name: string, type: Exchange['type'], args: Record<string, unknown> = {}): Exchange => ({
  name,
  type,
  durable: true,
  autoDelete: false,
  arguments: args,
  everBound: true,
});
const bind = (source: string, destination: string, routingKey = '', args: Record<string, unknown> = {}): Binding => ({
  source,
  destination,
  destinationType: 'queue',
  routingKey,
  arguments: args,
});
const ctx = (exchanges: Exchange[], bindings: Binding[], queues: string[]): RouteCtx => ({
  exchanges: new Map([['', ex('', 'direct')], ...exchanges.map((e) => [e.name, e] as const)]),
  bindings,
  hasQueue: (n) => queues.includes(n),
});
const names = (c: RouteCtx, e: string, key: string, h = {}) => route(c, e, key, h).map((t) => t.queue);

describe('routing', () => {
  it('[default-exchange] routes by queue name and refuses bindings', () => {
    const c = ctx([], [], ['q1', 'q2']);
    expect(names(c, '', 'q2')).toEqual(['q2']);
    expect(names(c, '', 'nope')).toEqual([]);
    const { model } = make();
    queue(model, 'q1');
    const r = model.bind('/', { source: '', destinationType: 'queue', destination: 'q1', routingKey: 'q1' });
    expect(errCode(r)).toBe(403);
  });

  it('[direct] matches the key exactly', () => {
    const c = ctx([ex('d', 'direct')], [bind('d', 'a', 'red'), bind('d', 'b', 'blue'), bind('d', 'c', 'red')], ['a', 'b', 'c']);
    expect(names(c, 'd', 'red')).toEqual(['a', 'c']);
    expect(names(c, 'd', 'Red')).toEqual([]);
  });

  it('[fanout] copies to every binding and ignores the key', () => {
    const c = ctx([ex('f', 'fanout')], [bind('f', 'a', 'x'), bind('f', 'b')], ['a', 'b']);
    expect(names(c, 'f', 'anything')).toEqual(['a', 'b']);
  });

  it('[topic-wildcards] star is one word, hash is zero or more', () => {
    expect(matchTopic('*.orange.*', 'quick.orange.rabbit')).toBe(true);
    expect(matchTopic('*.orange.*', 'orange.rabbit')).toBe(false);
    expect(matchTopic('*.orange.*', 'a.b.orange.c')).toBe(false);
    expect(matchTopic('audit.events.#', 'audit.events')).toBe(true);
    expect(matchTopic('audit.events.#', 'audit.events.x.y')).toBe(true);
    expect(matchTopic('#', 'any.key.at.all')).toBe(true);
    expect(matchTopic('a.#.z', 'a.z')).toBe(true);
    expect(matchTopic('a.#.z', 'a.b.c.z')).toBe(true);
    expect(matchTopic('a.b', 'a.b')).toBe(true);
    expect(matchTopic('a.b', 'a.b.c')).toBe(false);
  });

  it('[topic-one-copy] a queue gets one copy however many bindings match', () => {
    const c = ctx([ex('t', 'topic')], [bind('t', 'q', '*.orange.*'), bind('t', 'q', 'lazy.#'), bind('t', 'q', '#')], ['q']);
    expect(names(c, 't', 'lazy.orange.rabbit')).toEqual(['q']);
    const { model } = make();
    queue(model, 'q');
    val(model.declareExchange('/', { name: 't', type: 'topic', durable: true }));
    for (const k of ['*.orange.*', 'lazy.#']) val(model.bind('/', { source: 't', destinationType: 'queue', destination: 'q', routingKey: k }));
    put(model, channel(model), 'lazy.orange.rabbit', 'm', {}, 't');
    expect(bodies(model, 'q')).toEqual(['m']);
  });

  it('[headers-match] any/all skip x- headers, the -with-x modes compare them', () => {
    const h = { color: 'red', size: 3, 'x-tag': 'a' };
    expect(matchHeaders({ 'x-match': 'all', color: 'red', size: 3 }, h)).toBe(true);
    expect(matchHeaders({ 'x-match': 'all', color: 'red', size: 4 }, h)).toBe(false);
    expect(matchHeaders({ 'x-match': 'any', color: 'blue', size: 3 }, h)).toBe(true);
    expect(matchHeaders({ 'x-match': 'any', color: 'blue', size: 4 }, h)).toBe(false);
    expect(matchHeaders({ color: 'red' }, h)).toBe(true);
    expect(matchHeaders({ 'x-match': 'all', color: 'red', 'x-tag': 'zzz' }, h)).toBe(true);
    expect(matchHeaders({ 'x-match': 'all-with-x', color: 'red', 'x-tag': 'zzz' }, h)).toBe(false);
    expect(matchHeaders({ 'x-match': 'any-with-x', color: 'blue', 'x-tag': 'a' }, h)).toBe(true);
    expect(matchHeaders({ 'x-match': 'any', 'x-tag': 'a' }, h)).toBe(false);
  });

  it('[mandatory-return] unroutable is dropped, with mandatory it is returned before the confirm', () => {
    const { model, run, sim } = make();
    val(model.declareExchange('/', { name: 'd', type: 'direct', durable: true }));
    const ch = channel(model);
    model.confirmSelect(ch);
    val(model.publish(ch, { exchange: 'd', routingKey: 'k', body: 'lost' }));
    val(model.publish(ch, { exchange: 'd', routingKey: 'k', body: 'back', mandatory: true }));
    run(10);
    const j = sim.journal.entries();
    expect(j.filter((e) => e.kind === 'drop').map((e) => e.rule)).toEqual(['mandatory-return']);
    const ret = j.findIndex((e) => e.kind === 'return');
    const conf = j.findIndex((e) => e.kind === 'confirm' && e.data?.seq === 2);
    expect(ret).toBeGreaterThan(-1);
    expect(j[ret].data?.replyCode).toBe(312);
    expect(conf).toBeGreaterThan(ret);
    expect(model.takeReturns(ch).map((r) => r.body)).toEqual(['back']);
  });

  it('[ae-chain] alternate exchanges are followed until a route, a loop or the end', () => {
    const a = ex('a', 'direct', { 'alternate-exchange': 'b' });
    const b = ex('b', 'fanout', { 'alternate-exchange': 'c' });
    const c = ex('c', 'fanout', { 'alternate-exchange': 'a' });
    const x = ctx([a, b, c], [bind('c', 'q')], ['q']);
    expect(route(x, 'a', 'k')).toEqual([{ queue: 'q', via: 'c', rule: 'ae-chain' }]);
    const loop = ctx([a, b, c], [], ['q']);
    expect(names(loop, 'a', 'k')).toEqual([]);
    const own = ctx([a, b], [bind('a', 'q', 'k'), bind('b', 'r')], ['q', 'r']);
    expect(names(own, 'a', 'k')).toEqual(['q']);
  });

  it('[ae-chain] a message routed through the alternate exchange is not returned', () => {
    const { model, sim, run } = make();
    val(model.declareExchange('/', { name: 'ae', type: 'fanout', durable: true }));
    val(model.declareExchange('/', { name: 'main', type: 'direct', durable: true, arguments: { 'alternate-exchange': 'ae' } }));
    queue(model, 'unrouted');
    val(model.bind('/', { source: 'ae', destinationType: 'queue', destination: 'unrouted', routingKey: '' }));
    const ch = channel(model);
    val(model.publish(ch, { exchange: 'main', routingKey: 'nobody', body: 'x', mandatory: true }));
    run(5);
    expect(bodies(model, 'unrouted')).toEqual(['x']);
    expect(sim.journal.filter({ kinds: ['return'] })).toHaveLength(0);
  });
});
