import type { RabbitRule } from './rules';

export type Args = Record<string, unknown>;
export type ExchangeType = 'direct' | 'fanout' | 'topic' | 'headers';

export interface Exchange {
  name: string;
  type: ExchangeType;
  durable: boolean;
  autoDelete: boolean;
  arguments: Args;
  /** True once a binding used it as a source (auto-delete only removes exchanges that had one). */
  everBound: boolean;
}

export interface Binding {
  source: string;
  destinationType: 'queue' | 'exchange';
  destination: string;
  routingKey: string;
  arguments: Args;
}

/** What `route` needs to know about one vhost. */
export interface RouteCtx {
  exchanges: ReadonlyMap<string, Exchange>;
  bindings: readonly Binding[];
  hasQueue(name: string): boolean;
}

export interface Target {
  queue: string;
  /** Exchange whose binding (or the default exchange) matched. */
  via: string;
  rule: RabbitRule;
}

const words = (s: string): string[] => (s === '' ? [] : s.split('.'));

/** `*` = exactly one word, `#` = zero or more words. */
export function matchTopic(pattern: string, key: string): boolean {
  const p = words(pattern);
  const k = words(key);
  const memo = new Map<number, boolean>();
  const go = (i: number, j: number): boolean => {
    const id = i * (k.length + 1) + j;
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    let r: boolean;
    if (i === p.length) r = j === k.length;
    else if (p[i] === '#') r = go(i + 1, j) || (j < k.length && go(i, j + 1));
    else r = j < k.length && (p[i] === '*' || p[i] === k[j]) && go(i + 1, j + 1);
    memo.set(id, r);
    return r;
  };
  return go(0, 0);
}

/** x-match any|all ignore headers named x-…; any-with-x|all-with-x compare them too. */
export function matchHeaders(bindArgs: Args, headers: Args): boolean {
  const raw = bindArgs['x-match'];
  const mode = typeof raw === 'string' ? raw : 'all';
  const withX = mode === 'any-with-x' || mode === 'all-with-x';
  const any = mode === 'any' || mode === 'any-with-x';
  const keys = Object.keys(bindArgs).filter((k) => k !== 'x-match' && (withX || !k.startsWith('x-')));
  const same = (k: string): boolean => Object.prototype.hasOwnProperty.call(headers, k) && headers[k] === bindArgs[k];
  return any ? keys.some(same) : keys.every(same);
}

const sameArgs = (a: Args, b: Args): boolean => JSON.stringify(a, Object.keys(a).sort()) === JSON.stringify(b, Object.keys(b).sort());
export const sameBinding = (a: Binding, b: Binding): boolean =>
  a.source === b.source &&
  a.destinationType === b.destinationType &&
  a.destination === b.destination &&
  a.routingKey === b.routingKey &&
  sameArgs(a.arguments, b.arguments);

const ruleOf = (t: ExchangeType): RabbitRule => (t === 'topic' ? 'topic-wildcards' : t === 'headers' ? 'headers-match' : t);

function matches(ex: Exchange, b: Binding, key: string, headers: Args): boolean {
  switch (ex.type) {
    case 'fanout':
      return true;
    case 'direct':
      return b.routingKey === key;
    case 'topic':
      return matchTopic(b.routingKey, key);
    case 'headers':
      return matchHeaders(b.arguments, headers);
  }
}

/**
 * Queues a message published to `exchange` reaches, each queue once, in binding order.
 * Follows exchange-to-exchange bindings; when an exchange finds no queue, its alternate exchange is tried
 * (chain stops at the first route, at the end of the chain or at an exchange already tried).
 */
export function route(ctx: RouteCtx, exchange: string, key: string, headers: Args = {}): Target[] {
  const out: Target[] = [];
  const seenQueues = new Set<string>();
  const tried = new Set<string>();
  const walk = (name: string, viaAe: boolean): void => {
    if (tried.has(name)) return;
    tried.add(name);
    if (name === '') {
      if (ctx.hasQueue(key) && !seenQueues.has(key)) {
        seenQueues.add(key);
        out.push({ queue: key, via: '', rule: 'default-exchange' });
      }
      return;
    }
    const ex = ctx.exchanges.get(name);
    if (!ex) return;
    const before = out.length;
    for (const b of ctx.bindings) {
      if (b.source !== name || !matches(ex, b, key, headers)) continue;
      if (b.destinationType === 'queue') {
        if (seenQueues.has(b.destination) || !ctx.hasQueue(b.destination)) continue;
        seenQueues.add(b.destination);
        out.push({ queue: b.destination, via: name, rule: viaAe ? 'ae-chain' : ruleOf(ex.type) });
      } else walk(b.destination, viaAe);
    }
    const ae = ex.arguments['alternate-exchange'];
    if (out.length === before && typeof ae === 'string') walk(ae, true);
  };
  walk(exchange, false);
  return out;
}
