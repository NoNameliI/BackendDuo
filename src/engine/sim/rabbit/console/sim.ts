import { err, type ConsoleCommand, type ConsoleResult } from '../../console';
import type { ChannelId, ConsoleSession, RabbitConsoleApi } from './api';
import { parseFlags, UsageError, type FlagDef } from './flags';
import { adminError, parseDuration } from './format';

/**
 * Teaching-only commands (no real CLI has an equivalent): they drive consumers, the clock and the
 * acting user of the sandbox. Every line they print starts with `[sim]`.
 */
const FLAGS: FlagDef[] = [
  { key: 'vhost', long: '--vhost', short: '-V', kind: 'value' },
  { key: 'prefetch', long: '--prefetch', kind: 'value' },
  { key: 'autoAck', long: '--auto-ack', kind: 'switch' },
  { key: 'multiple', long: '--multiple', kind: 'switch' },
  { key: 'requeue', long: '--requeue', kind: 'switch' },
];

const USAGE = [
  '[sim] consume QUEUE --prefetch N [--auto-ack] [--vhost V]   подключить потребителя',
  '[sim] ack TAG [--multiple]                                   подтвердить (TAG 0 + --multiple = все)',
  '[sim] nack TAG [--multiple] [--requeue]                      отклонить, по умолчанию без возврата',
  '[sim] reject TAG [--requeue]                                 отклонить одно сообщение',
  '[sim] run 5s                                                 продвинуть виртуальное время',
  '[sim] restart                                                перезапуск узла',
  '[sim] as USER <команда>                                      выполнить rabbitmqadmin от имени пользователя',
];

const sim = (...t: string[]): ConsoleResult => ({ lines: t.map((text) => ({ text: `[sim] ${text}`, tone: 'dim' as const })), exit: 0 });

export function createSimCommand(api: RabbitConsoleApi, session: ConsoleSession, dispatch: (name: string, args: string[]) => ConsoleResult | undefined): ConsoleCommand {
  const key = (vhost: string) => `${session.user}\u0000${vhost}`;
  const channelOf = (vhost: string): ChannelId | null => session.channels.get(key(vhost)) ?? null;

  const unackedLines = (ch: ChannelId): ConsoleResult => {
    const u = api.unacked(ch);
    if (u.length === 0) return sim('нет неподтверждённых сообщений');
    return sim(...u.map((m) => `tag=${m.tag} queue=${m.queue} redelivered=${m.redelivered} body=${m.body}`));
  };

  function settle(kind: 'ack' | 'nack' | 'reject', args: string[]): ConsoleResult {
    const p = parseFlags(args, FLAGS);
    const tag = Number(p.rest[0]);
    if (p.rest.length !== 1 || !Number.isInteger(tag) || tag < 0) return err(`sim ${kind}: нужен номер тега (целое число)`, 2);
    const vhost = p.values.vhost ?? '/';
    const ch = channelOf(vhost);
    if (ch === null) return err(`sim ${kind}: нет потребителя пользователя ${session.user} в vhost ${vhost} (сначала sim consume)`, 1);
    const multiple = p.switches.has('multiple');
    const requeue = p.switches.has('requeue');
    const r = kind === 'ack' ? api.ack(ch, tag, multiple) : kind === 'nack' ? api.nack(ch, tag, multiple, requeue) : api.reject(ch, tag, requeue);
    if (!r.ok) {
      session.channels.delete(key(vhost)); // a channel error closes the channel
      return err(adminError(r.error));
    }
    api.advance(0);
    return unackedLines(ch);
  }

  return {
    name: 'sim',
    help: 'учебные команды песочницы: consume, ack, nack, reject, run, restart, as',
    run(args) {
      try {
        const [sub, ...rest] = args;
        switch (sub) {
          case 'consume': {
            const p = parseFlags(rest, FLAGS);
            if (p.rest.length !== 1) return err('sim consume: укажите очередь, например: sim consume orders --prefetch 1', 2);
            const prefetch = Number(p.values.prefetch ?? '0');
            if (!Number.isInteger(prefetch) || prefetch < 0) return err('sim consume: --prefetch — целое число ≥ 0', 2);
            const vhost = p.values.vhost ?? '/';
            let ch = channelOf(vhost);
            if (ch === null) {
              const o = api.openChannel(session.user, vhost);
              if (!o.ok) return err(adminError(o.error));
              ch = o.value;
              session.channels.set(key(vhost), ch);
            }
            const r = api.consume(ch, p.rest[0], { prefetch, autoAck: p.switches.has('autoAck') });
            if (!r.ok) return err(adminError(r.error));
            api.advance(0);
            const head = sim(`потребитель ${r.value} на очереди ${p.rest[0]} (prefetch=${prefetch}, ${p.switches.has('autoAck') ? 'автоподтверждение' : 'ручное подтверждение'})`);
            const tail = unackedLines(ch);
            return { lines: [...head.lines, ...tail.lines], exit: 0 };
          }
          case 'ack':
          case 'nack':
          case 'reject':
            return settle(sub, rest);
          case 'run': {
            const ms = rest.length === 1 ? parseDuration(rest[0]) : null;
            if (ms === null) return err('sim run: укажите длительность, например: sim run 5s или sim run 500ms', 2);
            api.advance(ms);
            return sim(`прошло ${ms} мс виртуального времени`);
          }
          case 'restart':
            api.crash();
            api.restart();
            session.channels.clear();
            return sim('узел перезапущен: durable очереди и persistent сообщения восстановлены, остальное потеряно');
          case 'as': {
            const [user, name, ...cmdArgs] = rest;
            if (!user || !name) return err('sim as: sim as USER rabbitmqadmin …', 2);
            const prev = session.user;
            session.user = user;
            try {
              return dispatch(name, cmdArgs) ?? err(`sim as: ${name}: команда не найдена`, 127);
            } finally {
              session.user = prev;
            }
          }
          default:
            return { lines: USAGE.map((text) => ({ text, tone: 'dim' as const })), exit: sub === undefined ? 0 : 2 };
        }
      } catch (e) {
        if (e instanceof UsageError) return err(e.message, 2);
        throw e;
      }
    },
  };
}
