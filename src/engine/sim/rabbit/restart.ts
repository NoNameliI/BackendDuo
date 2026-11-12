import type { Msg, RQueue } from './queue';
import type { Binding, Exchange } from './routing';

export interface Recoverable {
  exchanges: Map<string, Exchange>;
  queues: Map<string, RQueue>;
  bindings: Binding[];
}

export interface Lost {
  queue: string;
  msg: Msg;
  why: 'transient-queue' | 'transient-message' | 'unsynced';
}

export interface RecoveryReport {
  queuesDeleted: string[];
  exchangesDeleted: string[];
  lost: Lost[];
  kept: number;
}

/**
 * What a node restart leaves of one vhost: durable queues with their persistent messages, durable exchanges,
 * bindings between survivors. Messages whose disk write was still pending at `crashAt` are lost.
 * Unacknowledged messages must already be back among the ready ones.
 */
export function recover(v: Recoverable, crashAt: number): RecoveryReport {
  const rep: RecoveryReport = { queuesDeleted: [], exchangesDeleted: [], lost: [], kept: 0 };
  for (const name of [...v.queues.keys()].sort()) {
    const q = v.queues.get(name) as RQueue;
    if (!q.durable || q.exclusive !== null) {
      for (const qm of q.ready) rep.lost.push({ queue: name, msg: qm.msg, why: 'transient-queue' });
      q.ready = [];
      q.deleted = true;
      v.queues.delete(name);
      rep.queuesDeleted.push(name);
      continue;
    }
    q.ready = q.ready.filter((qm) => {
      const why = !qm.msg.persistent ? 'transient-message' : qm.diskAt !== null && qm.diskAt > crashAt ? 'unsynced' : null;
      if (why) rep.lost.push({ queue: name, msg: qm.msg, why });
      else rep.kept++;
      return why === null;
    });
    q.consumers = [];
    q.cursor = 0;
    q.front = 0;
    q.unacked = 0;
  }
  for (const name of [...v.exchanges.keys()].sort()) {
    if (v.exchanges.get(name)?.durable) continue;
    v.exchanges.delete(name);
    rep.exchangesDeleted.push(name);
  }
  v.bindings = v.bindings.filter(
    (b) =>
      (b.source === '' || v.exchanges.has(b.source)) &&
      (b.destinationType === 'queue' ? v.queues.has(b.destination) : v.exchanges.has(b.destination)),
  );
  return rep;
}
