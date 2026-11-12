import type { AmqpError } from './api';

/**
 * All console output formats live here so they can be corrected in one place.
 * Verified against rabbitmqadmin-ng: bordered table with a header row by default, borderless table
 * WITHOUT header row under --non-interactive, newlines in cells replaced by ",".
 * Not verified (follow the design): column sets and header names of lists, the one-line confirmations,
 * the rabbitmqctl header row and the error wording.
 */
export type TableStyle = 'bordered' | 'borderless';

const cell = (s: string): string => s.replace(/\r?\n/g, ',');

export function renderTable(header: readonly string[], rows: readonly (readonly string[])[], style: TableStyle): string[] {
  const body = rows.map((r) => r.map(cell));
  if (style === 'borderless') {
    const widths = header.map((_h, i) => Math.max(...body.map((r) => r[i].length), 0));
    return body.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd());
  }
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const bar = (l: string, m: string, r: string) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  const row = (r: readonly string[]) => '│' + r.map((c, i) => ` ${c.padEnd(widths[i])} `).join('│') + '│';
  return [bar('┌', '┬', '┐'), row(header), bar('├', '┼', '┤'), ...body.map(row), bar('└', '┴', '┘')];
}

/** rabbitmqctl: header row and rows separated by TAB, no banner (simplified). */
export function renderTsv(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [header.join('\t'), ...rows.map((r) => r.map(cell).join('\t'))];
}

export const json = (v: unknown): string => JSON.stringify(v);
export const yn = (b: boolean): string => (b ? 'true' : 'false');

export function formatAmqpError(e: AmqpError): string {
  return `${e.code} ${e.name} - ${e.text}`;
}
export const adminError = (e: AmqpError): string => `Error: ${formatAmqpError(e)}`;
export const ctlError = (e: AmqpError): string => `Error:\n${formatAmqpError(e)}`;

export const V1_HINT =
  'rabbitmqadmin v2 больше не принимает синтаксис key=value (это v1). Пример: rabbitmqadmin queues declare --name orders --type classic --durable true';

export const msg = {
  declared: (kind: string, name: string, vhost: string) => `declared ${kind} '${name}' in virtual host '${vhost}'`,
  declaredBinding: (b: { source: string; destination: string; destinationType: string; routingKey: string }, vhost: string) =>
    `declared a binding from '${b.source}' to ${b.destinationType} '${b.destination}' with routing key '${b.routingKey}' in virtual host '${vhost}'`,
  deleted: (kind: string, name: string, vhost: string) => `deleted ${kind} '${name}' in virtual host '${vhost}'`,
  deletedBinding: (b: { source: string; destination: string; destinationType: string; routingKey: string }, vhost: string) =>
    `deleted a binding from '${b.source}' to ${b.destinationType} '${b.destination}' with routing key '${b.routingKey}' in virtual host '${vhost}'`,
  notFoundIdempotent: (kind: string, name: string) => `${kind} '${name}' does not exist, nothing to delete`,
  purged: (name: string, vhost: string, n: number) => `purged queue '${name}' in virtual host '${vhost}' (${n} messages removed)`,
  published: 'published the message',
  notRouted: 'published the message, but it was not routed to any queue',
  ctlAddVhost: (n: string) => `Adding vhost "${n}" ...`,
  ctlDeleteVhost: (n: string) => `Deleting vhost "${n}" ...`,
  ctlAddUser: (n: string) => `Adding user "${n}" ...`,
  ctlSetPermissions: (v: string, u: string) => `Setting permissions for user "${u}" in vhost "${v}" ...`,
  ctlPurge: (q: string, v: string) => `Purging queue '${q}' in vhost '${v}' ...`,
  ctlDeleteQueue: (n: number) => `Queue was successfully deleted with ${n} messages`,
};

/** Duration like `5s`, `1500ms`, `0.5s` → ms; null if malformed. */
export function parseDuration(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === 'ms' ? 1 : 1000);
  return Math.round(n);
}
