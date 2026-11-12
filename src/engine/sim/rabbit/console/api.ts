/**
 * The part of the broker model that the Rabbit console consumes. The methods that exist in the design
 * (declare/bind/publish/get/...) mirror the RabbitModel API; the `list*`, `unacked` and `advance`
 * members are what the console needs on top of it and must be provided by the model (or a thin adapter)
 * when the two parts are joined. Types are structural, so the model's own types fit without imports.
 */
export type Args = Record<string, unknown>;
export type MsgProps = Record<string, unknown>;
export type ChannelId = number | string;

export interface AmqpError {
  code: 312 | 403 | 404 | 405 | 406;
  name: string;
  text: string;
  scope: 'channel' | 'connection';
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: AmqpError };

export interface Delivery {
  tag: number;
  exchange: string;
  routingKey: string;
  body: string;
  redelivered: boolean;
  props?: MsgProps;
}

export interface QueueInfo {
  name: string;
  type: 'classic' | 'quorum';
  durable: boolean;
  autoDelete: boolean;
  exclusive: boolean;
  arguments: Args;
  /** ready + unacknowledged */
  messages: number;
  ready: number;
  unacked: number;
  consumers: number;
}
export interface ExchangeInfo {
  name: string;
  type: 'direct' | 'fanout' | 'topic' | 'headers';
  durable: boolean;
  autoDelete: boolean;
  internal: boolean;
  arguments: Args;
}
export interface BindingInfo {
  source: string;
  destination: string;
  destinationType: 'queue' | 'exchange';
  routingKey: string;
  arguments: Args;
}
export interface ConsumerInfo {
  queue: string;
  channel: string;
  tag: string;
  ackRequired: boolean;
  prefetch: number;
  arguments: Args;
}
export interface UserInfo {
  name: string;
  tags: string[];
}
/** A delivered, not yet settled message of a channel (for the teaching `sim` commands). */
export interface UnackedInfo {
  tag: number;
  queue: string;
  body: string;
  redelivered: boolean;
}

export interface RabbitConsoleApi {
  declareExchange(vhost: string, s: { name: string; type: 'direct' | 'fanout' | 'topic' | 'headers'; durable: boolean; autoDelete?: boolean; arguments?: Args }, user?: string): Result<void>;
  declareQueue(vhost: string, s: { name: string; type?: 'classic' | 'quorum'; durable: boolean; exclusive?: boolean; autoDelete?: boolean; arguments?: Args }, user?: string): Result<{ name: string }>;
  bind(vhost: string, b: { source: string; destinationType: 'queue' | 'exchange'; destination: string; routingKey: string; arguments?: Args }, user?: string): Result<void>;
  unbind(vhost: string, b: { source: string; destinationType: 'queue' | 'exchange'; destination: string; routingKey: string; arguments?: Args }, user?: string): Result<void>;
  deleteQueue(vhost: string, name: string, o?: { ifEmpty?: boolean; ifUnused?: boolean }): Result<number>;
  deleteExchange(vhost: string, name: string): Result<void>;
  purge(vhost: string, queue: string): Result<number>;
  openChannel(user: string, vhost: string): Result<ChannelId>;
  closeChannel(ch: ChannelId): void;
  publish(ch: ChannelId, p: { exchange: string; routingKey: string; body: string; mandatory?: boolean; props?: MsgProps }): Result<{ seq?: number }>;
  /** Messages returned to the channel with basic.return since the last call (unroutable mandatory publishes). */
  takeReturns?(ch: ChannelId): unknown[];
  consume(ch: ChannelId, queue: string, o: { prefetch: number; autoAck: boolean; tag?: string }): Result<string>;
  ack(ch: ChannelId, tag: number, multiple?: boolean): Result<void>;
  nack(ch: ChannelId, tag: number, multiple: boolean, requeue: boolean): Result<void>;
  reject(ch: ChannelId, tag: number, requeue: boolean): Result<void>;
  get(ch: ChannelId, queue: string, ackMode: 'auto' | 'manual'): Result<Delivery | null>;
  crash(): void;
  restart(): void;
  addVhost(name: string): Result<void>;
  deleteVhost(name: string): Result<void>;
  addUser(name: string, tags?: string[]): Result<void>;
  setPermissions(vhost: string, user: string, conf: string, write: string, read: string): Result<void>;

  // Needed by the console on top of the design API.
  listQueues(vhost: string): Result<QueueInfo[]>;
  listExchanges(vhost: string): Result<ExchangeInfo[]>;
  listBindings(vhost: string): Result<BindingInfo[]>;
  listConsumers(vhost: string): Result<ConsumerInfo[]>;
  listVhosts(): string[];
  listUsers(): UserInfo[];
  /** Messages delivered to the channel and not yet acknowledged, in delivery order. */
  unacked(ch: ChannelId): UnackedInfo[];
  /** Runs the simulation clock forward (0 = only process events due now). */
  advance(ms: number): void;
}

/** Shared per-console state: the acting user of `rabbitmqadmin` and the channels opened by `sim consume`. */
export interface ConsoleSession {
  user: string;
  channels: Map<string, ChannelId>;
}
export const newSession = (): ConsoleSession => ({ user: 'guest', channels: new Map() });
