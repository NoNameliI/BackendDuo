import type { KernelApi, Model, SimEvent } from './types';

export interface PingPongState {
  sent: number;
  received: number;
  inFlight: number;
}

/**
 * Ping-pong model for kernel tests: ping sends round n, pong answers after a random network delay,
 * ping "processes" the answer and starts the next round. Delays come from named rng streams.
 */
export function createPingPong(rounds = 20): Model<PingPongState> {
  let k!: KernelApi;
  const st: PingPongState = { sent: 0, received: 0, inFlight: 0 };
  const latencies: number[] = [];
  const sentAt = new Map<number, number>();
  const send = (n: number): void => {
    st.sent++;
    st.inFlight++;
    sentAt.set(n, k.now);
    k.log({ kind: 'publish', actor: 'ping', msg: `m-${n}`, text: `ping отправил раунд ${n}`, data: { confirms: true } });
    k.schedule(k.rng('net').int(5, 15), 2, 'pong.recv', { n });
  };
  return {
    flavor: 'rabbit',
    attach(kernel) {
      k = kernel;
      k.schedule(0, 3, 'ping.start');
    },
    handle(ev: SimEvent) {
      const n = Number(ev.data.n ?? 0);
      if (ev.kind === 'ping.start') send(1);
      else if (ev.kind === 'pong.recv') {
        k.log({ kind: 'deliver', actor: 'pong', msg: `m-${n}`, text: `pong получил раунд ${n}` });
        k.schedule(k.rng('proc').int(1, 5), 3, 'ping.recv', { n });
      } else if (ev.kind === 'ping.recv') {
        st.received++;
        st.inFlight--;
        latencies.push(k.now - (sentAt.get(n) ?? 0));
        k.log({ kind: 'confirm', actor: 'pong', msg: `m-${n}`, text: `раунд ${n} подтверждён`, data: { ok: true } });
        k.log({ kind: 'ack', actor: 'ping', msg: `m-${n}`, text: `ping обработал ответ ${n}`, data: { processed: true, key: 'k', seq: n } });
        if (n < rounds) send(n + 1);
      }
    },
    sample: () => ({ 'rate.publish': st.sent, 'q.pong.ready': st.inFlight, 'latency.p95': Math.max(0, ...latencies.slice(-5)) }),
    snapshot: () => ({ ...st }),
    quiet: () => st.inFlight === 0 && st.sent > 0,
  };
}
