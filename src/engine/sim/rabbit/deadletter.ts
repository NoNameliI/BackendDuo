import type { Args } from './routing';
import type { Death, DeathReason, Msg } from './queue';

/**
 * A cycle exists when the message dies again in a queue it already died in; it is dropped only when
 * nothing in the cycle (from the previous death in this queue on, including this one) was a rejection.
 */
export function isDeadLetterCycle(msg: Msg, queue: string, reason: DeathReason): boolean {
  let from = -1;
  msg.history.forEach((h, i) => {
    if (h.queue === queue) from = i;
  });
  if (from < 0) return false;
  return reason !== 'rejected' && msg.history.slice(from).every((h) => h.reason !== 'rejected');
}

/**
 * The message as it reaches the dead-letter exchange: x-death updated (newest first, one entry per
 * {queue, reason} with a count), first/last death marks, expiration moved to original-expiration.
 * `dlk` is x-dead-letter-routing-key; without it the earlier routing key stays.
 */
export function deadLetter(msg: Msg, queue: string, reason: DeathReason, dlx: string, dlk: string | null, now: number): Msg {
  const deaths: Death[] = msg.deaths.map((d) => ({ ...d, 'routing-keys': [...d['routing-keys']] }));
  const i = deaths.findIndex((d) => d.queue === queue && d.reason === reason);
  let entry: Death;
  if (i >= 0) {
    entry = deaths.splice(i, 1)[0];
    entry.count++;
    entry.time = now;
  } else {
    entry = { queue, reason, count: 1, exchange: msg.exchange, 'routing-keys': [msg.routingKey], time: now };
    if (msg.props.expiration !== undefined) entry['original-expiration'] = msg.props.expiration;
  }
  deaths.unshift(entry);
  const { expiration: _gone, ...props } = msg.props;
  void _gone;
  const mark = { queue, reason, exchange: msg.exchange };
  return {
    ...msg,
    exchange: dlx,
    routingKey: dlk ?? msg.routingKey,
    props,
    deaths,
    first: msg.first ?? mark,
    last: mark,
    history: [...msg.history, { queue, reason }],
  };
}

/** Headers a consumer sees: the published ones plus x-death and the first/last death marks. */
export function deliveryHeaders(msg: Msg, deliveryCount: number): Args {
  const h: Args = { ...(msg.props.headers ?? {}) };
  if (msg.deaths.length > 0) h['x-death'] = msg.deaths.map((d) => ({ ...d, 'routing-keys': [...d['routing-keys']] }));
  if (msg.first) {
    h['x-first-death-queue'] = msg.first.queue;
    h['x-first-death-reason'] = msg.first.reason;
    h['x-first-death-exchange'] = msg.first.exchange;
  }
  if (msg.last) {
    h['x-last-death-queue'] = msg.last.queue;
    h['x-last-death-reason'] = msg.last.reason;
    h['x-last-death-exchange'] = msg.last.exchange;
  }
  if (deliveryCount > 0) h['x-delivery-count'] = deliveryCount;
  return h;
}
