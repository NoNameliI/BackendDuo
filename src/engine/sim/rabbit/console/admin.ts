import { err, out, type ConsoleCommand, type ConsoleResult } from '../../console';
import type { Args, ConsoleSession, Delivery, QueueInfo, RabbitConsoleApi, Result } from './api';
import { boolValue, jsonObject, parseFlags, requireFlags, UsageError, type FlagDef, type Parsed } from './flags';
import { adminError, msg, renderTable, V1_HINT, yn, json, type TableStyle } from './format';

const val = (key: string, long: string, short?: string): FlagDef => ({ key, long, short, kind: 'value' });
const sw = (key: string, long: string, short?: string): FlagDef => ({ key, long, short, kind: 'switch' });

/** Global flags of rabbitmqadmin; the connection ones are accepted and ignored. */
const GLOBALS: FlagDef[] = [
  val('vhost', '--vhost', '-V'),
  val('username', '--username', '-u'),
  val('password', '--password', '-p'),
  sw('nonInteractive', '--non-interactive'),
  sw('quiet', '--quiet'),
  val('host', '--host', '-H'),
  val('port', '--port', '-P'),
  val('baseUri', '--base-uri', '-U'),
  val('pathPrefix', '--path-prefix'),
  val('node', '--node'),
  val('config', '--config'),
  val('tableStyle', '--table-style'),
];

const NAME = val('name', '--name');
const TYPE = val('type', '--type');
const DURABLE = val('durable', '--durable');
const AUTO_DELETE = val('autoDelete', '--auto-delete');
const ARGUMENTS = val('arguments', '--arguments');
const BINDING: FlagDef[] = [val('source', '--source'), val('destinationType', '--destination-type'), val('destination', '--destination'), val('routingKey', '--routing-key'), ARGUMENTS];
const BINDING_REQUIRED = ['source', 'destinationType', 'destination', 'routingKey'];

interface Ctx {
  api: RabbitConsoleApi;
  session: ConsoleSession;
  p: Parsed;
  vhost: string;
  user: string;
  style: TableStyle;
  stdin?: string;
  defs: FlagDef[];
}
interface Cmd {
  defs: FlagDef[];
  required?: string[];
  run(c: Ctx): ConsoleResult;
}

const fail = (e: Parameters<typeof adminError>[0]): ConsoleResult => err(adminError(e));
const table = (c: Ctx, header: string[], rows: string[][]): ConsoleResult =>
  out(...renderTable(header, rows, c.style));

function pick<T>(r: Result<T>): T | ConsoleResult {
  return r.ok ? r.value : fail(r.error);
}
const failed = (x: unknown): x is ConsoleResult => typeof x === 'object' && x !== null && 'lines' in x && 'exit' in x;

const QUEUE_COLUMNS: Record<string, (q: QueueInfo, vhost: string) => string> = {
  name: (q) => q.name,
  vhost: (_q, v) => v,
  queue_type: (q) => q.type,
  durable: (q) => yn(q.durable),
  auto_delete: (q) => yn(q.autoDelete),
  exclusive: (q) => yn(q.exclusive),
  messages: (q) => String(q.messages),
  message_count: (q) => String(q.messages),
  messages_ready: (q) => String(q.ready),
  messages_unacknowledged: (q) => String(q.unacked),
  consumers: (q) => String(q.consumers),
  arguments: (q) => json(q.arguments),
};
const DEFAULT_QUEUE_COLUMNS = ['name', 'queue_type', 'messages', 'messages_ready', 'messages_unacknowledged', 'consumers'];

const QUEUE_TYPES = ['classic', 'quorum'];
const EXCHANGE_TYPES = ['direct', 'fanout', 'topic', 'headers'];

const CMDS: Record<string, Cmd> = {
  'queues declare': {
    defs: [NAME, TYPE, DURABLE, AUTO_DELETE, ARGUMENTS],
    required: ['name'],
    run(c) {
      const type = c.p.values.type ?? 'classic';
      if (type === 'stream') return err('Error: streams are not simulated in this sandbox (only classic and quorum queues)');
      if (!QUEUE_TYPES.includes(type)) return err(`error: invalid value '${type}' for '--type <TYPE>' [possible values: classic, quorum, stream]`, 2);
      const name = c.p.values.name;
      const r = c.api.declareQueue(
        c.vhost,
        {
          name,
          type: type as 'classic' | 'quorum',
          durable: boolValue(c.p, 'durable', '--durable') ?? true,
          autoDelete: boolValue(c.p, 'autoDelete', '--auto-delete') ?? false,
          arguments: jsonObject(c.p, 'arguments', '--arguments') as Args | undefined,
        },
        c.user,
      );
      return r.ok ? out(msg.declared('queue', r.value.name, c.vhost)) : fail(r.error);
    },
  },
  'exchanges declare': {
    defs: [NAME, TYPE, DURABLE, AUTO_DELETE, ARGUMENTS],
    required: ['name'],
    run(c) {
      const type = c.p.values.type ?? 'direct';
      if (!EXCHANGE_TYPES.includes(type)) return err(`error: invalid value '${type}' for '--type <TYPE>' [possible values: direct, fanout, topic, headers]`, 2);
      const name = c.p.values.name;
      const r = c.api.declareExchange(
        c.vhost,
        {
          name,
          type: type as 'direct' | 'fanout' | 'topic' | 'headers',
          durable: boolValue(c.p, 'durable', '--durable') ?? true,
          autoDelete: boolValue(c.p, 'autoDelete', '--auto-delete') ?? false,
          arguments: jsonObject(c.p, 'arguments', '--arguments') as Args | undefined,
        },
        c.user,
      );
      return r.ok ? out(msg.declared('exchange', name, c.vhost)) : fail(r.error);
    },
  },
  'bindings declare': {
    defs: BINDING,
    required: BINDING_REQUIRED,
    run(c) {
      const b = bindingOf(c);
      if (failed(b)) return b;
      const r = c.api.bind(c.vhost, b, c.user);
      return r.ok ? out(msg.declaredBinding(b, c.vhost)) : fail(r.error);
    },
  },
  'bindings delete': {
    defs: BINDING,
    required: BINDING_REQUIRED,
    run(c) {
      const b = bindingOf(c);
      if (failed(b)) return b;
      const r = c.api.unbind(c.vhost, b, c.user);
      return r.ok ? out(msg.deletedBinding(b, c.vhost)) : fail(r.error);
    },
  },
  'queues list': {
    defs: [val('columns', '--columns')],
    run(c) {
      const cols = c.p.values.columns ? c.p.values.columns.split(',').map((s) => s.trim()) : DEFAULT_QUEUE_COLUMNS;
      const bad = cols.find((x) => !QUEUE_COLUMNS[x]);
      if (bad) return err(`Error: unknown column '${bad}' (available: ${Object.keys(QUEUE_COLUMNS).join(', ')})`, 2);
      const qs = pick(c.api.listQueues(c.vhost));
      if (failed(qs)) return qs;
      return table(c, cols, qs.map((q) => cols.map((x) => QUEUE_COLUMNS[x](q, c.vhost))));
    },
  },
  'exchanges list': {
    defs: [],
    run(c) {
      const xs = pick(c.api.listExchanges(c.vhost));
      if (failed(xs)) return xs;
      return table(c, ['name', 'type', 'durable'], xs.map((x) => [x.name, x.type, yn(x.durable)]));
    },
  },
  'bindings list': {
    defs: [],
    run(c) {
      const bs = pick(c.api.listBindings(c.vhost));
      if (failed(bs)) return bs;
      return table(c, ['source', 'destination', 'destination_type', 'routing_key'], bs.map((b) => [b.source, b.destination, b.destinationType, b.routingKey]));
    },
  },
  'queues delete': {
    defs: [NAME, sw('idempotently', '--idempotently')],
    required: ['name'],
    run(c) {
      const name = c.p.values.name;
      const r = c.api.deleteQueue(c.vhost, name);
      if (r.ok) return out(msg.deleted('queue', name, c.vhost));
      if (r.error.code === 404 && c.p.switches.has('idempotently')) return out(msg.notFoundIdempotent('queue', name));
      return fail(r.error);
    },
  },
  'exchanges delete': {
    defs: [NAME, sw('idempotently', '--idempotently')],
    required: ['name'],
    run(c) {
      const name = c.p.values.name;
      const r = c.api.deleteExchange(c.vhost, name);
      if (r.ok) return out(msg.deleted('exchange', name, c.vhost));
      if (r.error.code === 404 && c.p.switches.has('idempotently')) return out(msg.notFoundIdempotent('exchange', name));
      return fail(r.error);
    },
  },
  'queues purge': {
    defs: [NAME],
    required: ['name'],
    run(c) {
      const name = c.p.values.name;
      const r = c.api.purge(c.vhost, name);
      return r.ok ? out(msg.purged(name, c.vhost, r.value)) : fail(r.error);
    },
  },
  'publish message': {
    defs: [val('routingKey', '--routing-key', '-k'), val('exchange', '--exchange', '-e'), val('payload', '--payload', '-m'), val('payloadFile', '--payload-file', '-f'), val('properties', '--properties', '-p')],
    run(c) {
      let body = c.p.values.payload ?? 'test';
      const file = c.p.values.payloadFile;
      if (file !== undefined) {
        if (c.p.values.payload !== undefined) return err("error: the argument '--payload-file <PAYLOAD_FILE>' cannot be used with '--payload <PAYLOAD>'", 2);
        if (file !== '-') return err(`Error: ${file}: files are not available in the sandbox (use '-f -' with a heredoc)`);
        body = c.stdin ?? '';
      }
      const props = jsonObject(c.p, 'properties', '--properties');
      const ch = c.api.openChannel(c.user, c.vhost);
      if (!ch.ok) return fail(ch.error);
      try {
        // mandatory lets the console tell "routed" from "not routed" (the HTTP API does the same).
        const r = c.api.publish(ch.value, { exchange: c.p.values.exchange ?? '', routingKey: c.p.values.routingKey ?? '', body, mandatory: true, props });
        // The broker accepts an unroutable mandatory message and hands it back with basic.return on the channel.
        if (r.ok) return out((c.api.takeReturns?.(ch.value) ?? []).length ? msg.notRouted : msg.published);
        if (r.error.code === 312) return out(msg.notRouted);
        return fail(r.error);
      } finally {
        c.api.closeChannel(ch.value);
      }
    },
  },
  'get messages': {
    defs: [val('queue', '--queue', '-q'), val('count', '--count', '-c'), val('ackMode', '--ack-mode', '-a')],
    required: ['queue'],
    run(c) {
      const mode = c.p.values.ackMode ?? 'ack_requeue_false';
      const modes = ['ack_requeue_false', 'reject_requeue_false', 'ack_requeue_true', 'reject_requeue_true'];
      if (!modes.includes(mode)) return err(`error: invalid value '${mode}' for '--ack-mode <ACK_MODE>' [possible values: ${modes.join(', ')}]`, 2);
      const count = Number(c.p.values.count ?? '1');
      if (!Number.isInteger(count) || count < 1) return err(`error: invalid value '${c.p.values.count}' for '--count <COUNT>': not a positive number`, 2);
      const ch = c.api.openChannel(c.user, c.vhost);
      if (!ch.ok) return fail(ch.error);
      const got: Delivery[] = [];
      try {
        const consume = mode === 'ack_requeue_false';
        for (let i = 0; i < count; i++) {
          const r = c.api.get(ch.value, c.p.values.queue, consume ? 'auto' : 'manual');
          if (!r.ok) return fail(r.error);
          if (r.value === null) break;
          got.push(r.value);
        }
        if (!consume) {
          // Settle after the whole batch so a requeued message is not fetched twice.
          const requeue = mode.endsWith('requeue_true');
          for (const d of [...got].reverse()) {
            if (mode.startsWith('reject')) c.api.reject(ch.value, d.tag, requeue);
            else if (requeue) c.api.nack(ch.value, d.tag, false, true);
            else c.api.ack(ch.value, d.tag, false);
          }
        }
      } finally {
        c.api.closeChannel(ch.value);
      }
      return table(c, ['exchange', 'routing_key', 'redelivered', 'payload_bytes', 'payload'], got.map((d) => [d.exchange, d.routingKey, yn(d.redelivered), String(new TextEncoder().encode(d.body).length), d.body]));
    },
  },
};

function bindingOf(c: Ctx): { source: string; destinationType: 'queue' | 'exchange'; destination: string; routingKey: string; arguments?: Args } | ConsoleResult {
  const t = c.p.values.destinationType;
  if (t !== 'queue' && t !== 'exchange') return err(`error: invalid value '${t}' for '--destination-type <DESTINATION_TYPE>' [possible values: queue, exchange]`, 2);
  return {
    source: c.p.values.source,
    destinationType: t,
    destination: c.p.values.destination,
    routingKey: c.p.values.routingKey,
    arguments: jsonObject(c.p, 'arguments', '--arguments'),
  };
}

/** Verb-first spellings (`declare queue`, `list queues`, ...) map onto the noun-first commands. */
const VERB_FIRST: Record<string, string> = {
  'declare queue': 'queues declare',
  'declare exchange': 'exchanges declare',
  'declare binding': 'bindings declare',
  'delete queue': 'queues delete',
  'delete exchange': 'exchanges delete',
  'delete binding': 'bindings delete',
  'purge queue': 'queues purge',
  'list queues': 'queues list',
  'list exchanges': 'exchanges list',
  'list bindings': 'bindings list',
};

export function createAdminCommand(api: RabbitConsoleApi, session: ConsoleSession): ConsoleCommand {
  return {
    name: 'rabbitmqadmin',
    help: 'управление через HTTP API (v2): queues|exchanges|bindings declare|list|delete, publish message, get messages',
    run(args, stdin) {
      try {
        const lead = parseFlags(args, GLOBALS, true);
        const [w1, w2, ...tail] = lead.rest;
        if (w1 === undefined) return err('Usage: rabbitmqadmin [OPTIONS] <COMMAND>\nCommands: queues, exchanges, bindings, publish, get, declare, delete, list, purge', 2);
        const key = VERB_FIRST[`${w1} ${w2}`] ?? `${w1} ${w2}`;
        const cmd = CMDS[key];
        if (!cmd) {
          if (w2 === undefined) return err(`error: '${w1}' requires a subcommand but one was not provided`, 2);
          return err(`error: unrecognized subcommand '${w1} ${w2}'`, 2);
        }
        if (tail.some((t) => /^[A-Za-z_]+=/.test(t))) return err(V1_HINT, 2);
        // Command flags win over globals with the same spelling (`-p` is the password before the group, properties after it).
        const own = cmd.defs;
        const shared = GLOBALS.filter((g) => !own.some((o) => o.long === g.long || (o.short !== undefined && o.short === g.short)));
        const defs = [...own, ...shared];
        const g = lead;
        const p = parseFlags(tail, defs);
        if (p.rest.length > 0) return err(`error: unexpected argument '${p.rest[0]}' found`, 2);
        requireFlags(p, defs, cmd.required ?? []);
        const user = p.values.username ?? g.values.username ?? session.user;
        const vhost = p.values.vhost ?? g.values.vhost ?? '/';
        const nonInteractive = p.switches.has('nonInteractive') || g.switches.has('nonInteractive');
        return cmd.run({ api, session, p, vhost, user, style: nonInteractive ? 'borderless' : 'bordered', stdin, defs });
      } catch (e) {
        if (e instanceof UsageError) return err(e.message, 2);
        throw e;
      }
    },
  };
}
