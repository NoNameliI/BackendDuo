import { err, type ConsoleCommand, type ConsoleResult } from '../../console';
import type { KafkaModel } from '../model';
import { parseDuration } from './format';

/**
 * Teaching-only commands (no real CLI has an equivalent): they move the clock and break or restore brokers.
 * Every line they print starts with `[sim]`.
 */
const USAGE = [
  '[sim] run 10s                    продвинуть виртуальное время',
  '[sim] crash broker N             остановить брокер N (1–3)',
  '[sim] restart broker N           запустить брокер N',
  '[sim] stall broker N 40s         реплики на брокере N перестают забирать данные на 40 с',
  '[sim] consumer start|stop ID     запустить или остановить потребителя сценария',
];

const sim = (...t: string[]): ConsoleResult => ({ lines: t.map((text) => ({ text: `[sim] ${text}`, tone: 'dim' as const })), exit: 0 });

export function createSimCommand(api: KafkaModel): ConsoleCommand {
  const brokerId = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);
  return {
    name: 'sim',
    help: 'учебные команды песочницы: run, crash, restart, stall, consumer',
    run(args) {
      const [sub, what, id, dur] = args;
      switch (sub) {
        case 'run': {
          const ms = args.length === 2 ? parseDuration(args[1]) : null;
          if (ms === null) return err('sim run: укажите длительность, например: sim run 10s или sim run 500ms', 2);
          api.advance(ms);
          return sim(`прошло ${ms} мс виртуального времени`);
        }
        case 'crash':
        case 'restart':
        case 'stall': {
          const n = brokerId(id);
          const ms = sub === 'stall' ? (dur === undefined ? null : parseDuration(dur)) : 0;
          if (what !== 'broker' || n === null || ms === null || args.length !== (sub === 'stall' ? 4 : 3)) {
            return err(sub === 'stall' ? 'sim stall: sim stall broker N 40s' : `sim ${sub}: sim ${sub} broker N`, 2);
          }
          const r = sub === 'crash' ? api.crashBroker(n) : sub === 'restart' ? api.restartBroker(n) : api.stallReplica(n, ms);
          if (!r.ok) return err(`sim ${sub}: ${r.error.text}`, 1, String(r.error.code));
          if (sub === 'crash') return sim(`брокер ${n} остановлен`);
          if (sub === 'restart') return sim(`брокер ${n} запущен, данные на диске сохранились`);
          return sim(`брокер ${n}: реплики-подписчики не забирают данные ${ms} мс`);
        }
        case 'consumer': {
          if ((what !== 'start' && what !== 'stop') || id === undefined || args.length !== 3) return err('sim consumer: sim consumer start|stop ID', 2);
          const r = what === 'start' ? api.startConsumer(id) : api.stopConsumer(id);
          if (!r.ok) return err(`sim consumer: ${r.error.text}`, 1, String(r.error.code));
          return sim(what === 'start' ? `потребитель ${id} запущен и входит в группу` : `потребитель ${id} остановлен и вышел из группы`);
        }
        default:
          return { lines: USAGE.map((text) => ({ text, tone: 'dim' as const })), exit: sub === undefined ? 0 : 2 };
      }
    },
  };
}
