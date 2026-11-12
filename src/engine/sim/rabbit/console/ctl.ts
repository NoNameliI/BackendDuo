import { err, out, type ConsoleCommand, type ConsoleResult, type ConsoleLine } from '../../console';
import type { BindingInfo, ExchangeInfo, QueueInfo, RabbitConsoleApi, Result } from './api';
import { parseFlags, UsageError, type FlagDef } from './flags';
import { amqpFail, json, msg, renderTsv, yn } from './format';

const CTL_FLAGS: FlagDef[] = [
  { key: 'vhost', long: '--vhost', short: '-p', kind: 'value' },
  { key: 'node', long: '--node', short: '-n', kind: 'value' },
  { key: 'quiet', long: '--quiet', short: '-q', kind: 'switch' },
  { key: 'ifEmpty', long: '--if-empty', short: '-e', kind: 'switch' },
  { key: 'ifUnused', long: '--if-unused', short: '-u', kind: 'switch' },
  { key: 'description', long: '--description', kind: 'value' },
  { key: 'tags', long: '--tags', kind: 'value' },
  { key: 'defaultQueueType', long: '--default-queue-type', kind: 'value' },
  { key: 'offline', long: '--offline', kind: 'switch' },
  { key: 'online', long: '--online', kind: 'switch' },
  { key: 'local', long: '--local', kind: 'switch' },
];

const QUEUE_ITEMS: Record<string, (q: QueueInfo) => string> = {
  name: (q) => q.name,
  durable: (q) => yn(q.durable),
  auto_delete: (q) => yn(q.autoDelete),
  arguments: (q) => json(q.arguments),
  policy: () => '',
  exclusive: (q) => yn(q.exclusive),
  messages_ready: (q) => String(q.ready),
  messages_unacknowledged: (q) => String(q.unacked),
  messages: (q) => String(q.messages),
  consumers: (q) => String(q.consumers),
  state: () => 'running',
  type: (q) => q.type,
};
const NOT_SIMULATED = ['messages_persistent', 'message_bytes', 'memory'];

const EXCHANGE_ITEMS: Record<string, (x: ExchangeInfo) => string> = {
  name: (x) => x.name,
  type: (x) => x.type,
  durable: (x) => yn(x.durable),
  auto_delete: (x) => yn(x.autoDelete),
  internal: (x) => yn(x.internal),
  arguments: (x) => json(x.arguments),
  policy: () => '',
};

const BINDING_ITEMS: Record<string, (b: BindingInfo) => string> = {
  source_name: (b) => b.source,
  source_kind: () => 'exchange',
  destination_name: (b) => b.destination,
  destination_kind: (b) => b.destinationType,
  routing_key: (b) => b.routingKey,
  arguments: (b) => json(b.arguments),
};

const lines = (tone: ConsoleLine['tone'], ...texts: string[]): ConsoleResult => ({ lines: texts.map((text) => ({ text, tone })), exit: 0 });

function itemTable<T>(items: readonly string[], defaults: readonly string[], cols: Record<string, (r: T) => string>, rows: readonly T[], extra: readonly string[] = []): ConsoleResult {
  const names = items.length ? items : defaults;
  for (const n of names) {
    if (cols[n]) continue;
    if (extra.includes(n)) return err(`Error: item '${n}' is not simulated in this sandbox`, 64);
    return err(`Error: invalid item '${n}' (available: ${Object.keys(cols).join(', ')})`, 64);
  }
  return out(...renderTsv(names, rows.map((r) => names.map((n) => cols[n](r)))));
}

function unwrap<T>(r: Result<T>, then: (v: T) => ConsoleResult): ConsoleResult {
  return r.ok ? then(r.value) : amqpFail(r.error, true, 70);
}

export function createCtlCommands(api: RabbitConsoleApi): ConsoleCommand[] {
  function run(args: string[], forced?: string[]): ConsoleResult {
    try {
      const p = parseFlags([...(forced ?? []), ...args], CTL_FLAGS);
      const [cmd, ...pos] = p.rest;
      const vhost = p.values.vhost ?? '/';
      if (cmd === undefined) return err('Usage: rabbitmqctl [--node <node>] [--quiet] <command> [<command options>]', 64);
      const need = (n: number, usage: string): ConsoleResult | null => (pos.length === n ? null : err(`Error: wrong number of arguments. Usage: rabbitmqctl ${usage}`, 64));
      switch (cmd) {
        case 'list_queues':
          return unwrap(api.listQueues(vhost), (qs) => itemTable(pos, ['name', 'messages'], QUEUE_ITEMS, qs, NOT_SIMULATED));
        case 'list_exchanges':
          return unwrap(api.listExchanges(vhost), (xs) => itemTable(pos, ['name', 'type'], EXCHANGE_ITEMS, xs));
        case 'list_bindings':
          return unwrap(api.listBindings(vhost), (bs) => itemTable(pos, Object.keys(BINDING_ITEMS), BINDING_ITEMS, bs));
        case 'list_consumers':
          return unwrap(api.listConsumers(vhost), (cs) =>
            out(...renderTsv(['queue_name', 'channel_pid', 'consumer_tag', 'ack_required', 'prefetch_count', 'arguments'], cs.map((c) => [c.queue, c.channel, c.tag, yn(c.ackRequired), String(c.prefetch), json(c.arguments)]))),
          );
        case 'list_vhosts':
          return out(...renderTsv(['name'], api.listVhosts().map((v) => [v])));
        case 'list_users':
          return out(...renderTsv(['user', 'tags'], api.listUsers().map((u) => [u.name, `[${u.tags.join(', ')}]`])));
        case 'add_vhost':
          return need(1, 'add_vhost <vhost>') ?? unwrap(api.addVhost(pos[0]), () => lines('dim', msg.ctlAddVhost(pos[0])));
        case 'delete_vhost':
          return need(1, 'delete_vhost <vhost>') ?? unwrap(api.deleteVhost(pos[0]), () => lines('dim', msg.ctlDeleteVhost(pos[0])));
        case 'add_user':
          return need(2, 'add_user <username> <password>') ?? unwrap(api.addUser(pos[0], []), () => lines('dim', msg.ctlAddUser(pos[0])));
        case 'set_permissions':
          return need(4, 'set_permissions [-p <vhost>] <username> <conf> <write> <read>') ?? unwrap(api.setPermissions(vhost, pos[0], pos[1], pos[2], pos[3]), () => lines('dim', msg.ctlSetPermissions(vhost, pos[0])));
        case 'purge_queue':
          return need(1, 'purge_queue [-p <vhost>] <queue>') ?? unwrap(api.purge(vhost, pos[0]), () => lines('dim', msg.ctlPurge(pos[0], vhost)));
        case 'delete_queue':
          return (
            need(1, 'delete_queue [-p <vhost>] <queue_name> [--if-empty|-e] [--if-unused|-u]') ??
            unwrap(api.deleteQueue(vhost, pos[0], { ifEmpty: p.switches.has('ifEmpty'), ifUnused: p.switches.has('ifUnused') }), (n) => lines('out', msg.ctlDeleteQueue(n)))
          );
        default:
          return err(`Error: unknown command '${cmd}'. Run 'help' for the list.`, 64);
      }
    } catch (e) {
      if (e instanceof UsageError) return err(e.message, 64);
      throw e;
    }
  }
  return [
    { name: 'rabbitmqctl', help: 'управление узлом: list_queues|list_exchanges|list_bindings|list_consumers, add_vhost, add_user, set_permissions...', run: (args) => run(args) },
    { name: 'lq', help: 'то же, что rabbitmqctl list_queues --quiet', run: (args) => run(args, ['list_queues', '--quiet']) },
  ];
}
