import { checkGraphql, checkProto, graphqlProblems, type GraphqlInput, type GraphqlTask, type ProtoTask } from '@/checker/apiSchema';
import { SolutionError, type CheckResult } from '@/checker/index';
import { GraphqlServer, type Collections, type GraphqlResult } from './graphqlRun';
import type protobuf from 'protobufjs';
import { callRpc, encodeMessage, parseProto, type Encoded, type ProtoSummary, type RpcResult } from './protoRun';
import { jsonSize } from './http';
import type { ServerDef } from './server';

/**
 * What the schema worker can do. Everything is plain data in and out: the main thread keeps the collections
 * and sends them with each call, so a terminated worker loses nothing.
 */
export interface SchemaOps {
  /** `explained`: the errors in Russian (graphql-js stays in the worker). */
  graphql(sdl: string, collections: Collections, query: string, variables: Record<string, unknown>): { result: GraphqlResult; collections: Collections; explained: string[] };
  proto(source: string): { ok: true; summary: ProtoSummary } | { ok: false; error: string };
  encode(source: string, type: string, value: Record<string, unknown>): Encoded | { error: string };
  rpc(source: string, collections: Collections, service: string, method: string, request: Record<string, unknown>): { result: RpcResult; collections: Collections };
  /** A `proto example` block of theory: the .proto, then after a line `###` lines to encode or call. */
  protoExample(text: string, collections: Collections): { summary?: ProtoSummary; error?: string; outputs: ExampleOutput[]; collections: Collections };
  checkGraphql(task: GraphqlTask, server: ServerDef | undefined, input: GraphqlInput): CheckResult;
  checkProto(task: ProtoTask, source: string): CheckResult;
}

export type SchemaOp = keyof SchemaOps;

export interface ExampleOutput {
  line: string;
  ok: boolean;
  text: string;
}

/**
 * One line after `###` in a proto example: `Order {"id": 150}` encodes a message and compares its size with
 * JSON; `shop.OrderService/GetOrder {"id": 1}` models a call.
 */
function exampleLine(root: protobuf.Root, pkg: string, line: string, collections: Collections): ExampleOutput {
  const m = /^([\w.]+)(?:\/(\w+))?\s*(\{.*\})?\s*$/.exec(line);
  if (!m) return { line, ok: false, text: 'Строка примера: «Тип {json}» или «Сервис/Метод {json}»' };
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(m[3] ?? '{}') as Record<string, unknown>;
  } catch {
    return { line, ok: false, text: 'Значение после имени — не JSON' };
  }
  const name = pkg && !m[1].includes('.') ? `${pkg}.${m[1]}` : m[1];
  if (m[2]) {
    const result = callRpc(root, collections, name, m[2], value);
    if (result.status !== 'OK') return { line, ok: false, text: `${result.status}: ${result.detail ?? ''}` };
    const json = result.messages.reduce((a, msg) => a + jsonSize(msg), 0);
    const bytes = result.bytes.reduce((a, b) => a + b, 0);
    return { line, ok: true, text: [...result.messages.map((msg) => JSON.stringify(msg)), `${bytes} Б в protobuf, ${json} Б в JSON`].join('\n') };
  }
  const encoded = encodeMessage(root, name, value);
  if ('error' in encoded) return { line, ok: false, text: encoded.error };
  return { line, ok: true, text: `${encoded.hex || '(пусто)'}\n${encoded.bytes} Б в protobuf, ${encoded.jsonBytes} Б в JSON` };
}

export const schemaOps: SchemaOps = {
  graphql(sdl, collections, query, variables) {
    const server = new GraphqlServer(sdl, collections);
    const result = server.run(query, variables);
    return { result, collections: server.collections as Collections, explained: graphqlProblems(result) };
  },
  proto(source) {
    const parsed = parseProto(source);
    return parsed.ok ? { ok: true, summary: parsed.summary } : parsed;
  },
  encode(source, type, value) {
    const parsed = parseProto(source);
    return parsed.ok ? encodeMessage(parsed.root, type, value) : { error: parsed.error };
  },
  rpc(source, collections, service, method, request) {
    const parsed = parseProto(source);
    const data = structuredClone(collections);
    if (!parsed.ok) return { result: { messages: [], bytes: [], status: 'INVALID_ARGUMENT', detail: parsed.error }, collections: data };
    return { result: callRpc(parsed.root, data, service, method, request), collections: data };
  },
  protoExample(text, collections) {
    const [source, ...rest] = text.split(/^###.*$/m);
    const parsed = parseProto(source);
    const data = structuredClone(collections);
    if (!parsed.ok) return { error: parsed.error, outputs: [], collections: data };
    const lines = rest.join('\n').split('\n').map((l) => l.trim()).filter(Boolean);
    return { summary: parsed.summary, outputs: lines.map((line) => exampleLine(parsed.root, parsed.summary.package, line, data)), collections: data };
  },
  checkGraphql,
  checkProto,
};

export type SchemaReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string; solution?: boolean };

/** Runs one request of the worker protocol. */
export function runSchemaOp(id: number, op: SchemaOp, args: unknown[]): SchemaReply {
  try {
    const value = (schemaOps[op] as (...a: unknown[]) => unknown)(...args);
    return { id, ok: true, value };
  } catch (e) {
    return { id, ok: false, error: e instanceof Error ? e.message : String(e), solution: e instanceof SolutionError };
  }
}
