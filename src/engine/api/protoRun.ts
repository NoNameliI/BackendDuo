import protobuf from 'protobufjs';
import type { Collections } from './graphqlRun';
import { jsonSize } from './http';

/**
 * Protocol Buffers for the course: parse a .proto file into a readable structure, encode a message to bytes
 * (to compare its size with JSON), and model a gRPC call over in-memory collections. There is no gRPC server
 * and no network; a call is "service, method, request, response" computed here.
 */
export interface ProtoField {
  name: string;
  type: string;
  number: number;
  repeated: boolean;
  optional: boolean;
}

export interface ProtoMessage {
  name: string;
  fields: ProtoField[];
}

export interface ProtoMethod {
  name: string;
  request: string;
  response: string;
  clientStream: boolean;
  serverStream: boolean;
}

export interface ProtoSummary {
  package: string;
  messages: ProtoMessage[];
  enums: { name: string; values: Record<string, number> }[];
  services: { name: string; methods: ProtoMethod[] }[];
}

export type ParsedProto = { ok: true; summary: ProtoSummary; root: protobuf.Root } | { ok: false; error: string };

/** "illegal token '=' (line 3)" → a hint in Russian with the line. */
function explainProtoError(message: string): string {
  const line = /\(line (\d+)\)/.exec(message)?.[1];
  const at = line ? ` (строка ${line})` : '';
  if (/illegal token '(.*)'/.test(message)) return `Неожиданный символ «${/illegal token '(.*)'/.exec(message)![1]}»${at}. Проверьте «тип имя = номер;» и точку с запятой в конце поля.`;
  if (/duplicate id (\d+)/.test(message)) return `Номер поля ${/duplicate id (\d+)/.exec(message)![1]} повторяется${at}: у каждого поля сообщения свой номер.`;
  if (/duplicate name '(.+?)'/.test(message)) return `Имя «${/duplicate name '(.+?)'/.exec(message)![1]}» уже есть${at}.`;
  if (/no such type: (\S+)/.test(message)) return `Тип ${/no such type: (\S+)/.exec(message)![1]} не объявлен: опишите message с таким именем или исправьте опечатку.`;
  if (/illegal id/.test(message)) return `Недопустимый номер поля${at}: номера начинаются с 1.`;
  return `${message}${at ? '' : ''}`;
}

export function parseProto(source: string): ParsedProto {
  let root: protobuf.Root;
  try {
    root = protobuf.parse(source, { keepCase: true }).root;
    root.resolveAll();
  } catch (e) {
    return { ok: false, error: explainProtoError((e as Error).message) };
  }
  const summary: ProtoSummary = { package: '', messages: [], enums: [], services: [] };
  const walk = (ns: protobuf.NamespaceBase, prefix: string) => {
    for (const obj of ns.nestedArray) {
      const name = prefix ? `${prefix}.${obj.name}` : obj.name;
      if (obj instanceof protobuf.Type) {
        summary.messages.push({
          name,
          fields: obj.fieldsArray.map((f) => ({
            name: f.name,
            type: f.type,
            number: f.id,
            repeated: f.repeated,
            optional: Boolean((f.options as Record<string, unknown> | undefined)?.proto3_optional),
          })),
        });
        walk(obj, name);
      } else if (obj instanceof protobuf.Enum) summary.enums.push({ name, values: { ...obj.values } });
      else if (obj instanceof protobuf.Service) {
        summary.services.push({
          name,
          methods: obj.methodsArray.map((m) => ({ name: m.name, request: m.requestType, response: m.responseType, clientStream: Boolean(m.requestStream), serverStream: Boolean(m.responseStream) })),
        });
      } else if (obj instanceof protobuf.Namespace) {
        summary.package = summary.package ? `${summary.package}.${obj.name}` : name;
        walk(obj, '');
      }
    }
  };
  walk(root, '');
  return { ok: true, summary, root };
}

const findType = (root: protobuf.Root, name: string) => {
  try {
    return root.lookupType(name);
  } catch {
    return null;
  }
};

export interface Encoded {
  bytes: number;
  hex: string;
  jsonBytes: number;
  decoded: Record<string, unknown>;
}

/** Encodes `value` as message `typeName`; reports what does not fit the schema. */
export function encodeMessage(root: protobuf.Root, typeName: string, value: Record<string, unknown>): Encoded | { error: string } {
  const type = findType(root, typeName);
  if (!type) return { error: `Сообщения ${typeName} нет в схеме` };
  const problem = type.verify(value);
  if (problem) return { error: `Значение не подходит под ${typeName}: ${problem}` };
  const bytes = type.encode(type.fromObject(value)).finish();
  return {
    bytes: bytes.length,
    hex: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' '),
    jsonBytes: jsonSize(value),
    decoded: type.toObject(type.decode(bytes), { defaults: true, longs: Number, enums: String }),
  };
}

const plural = (word: string) => (word.endsWith('s') ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`);
const snake = (s: string) => s.replace(/[A-Z]/g, (c, i: number) => `${i ? '_' : ''}${c.toLowerCase()}`);

export interface RpcResult {
  /** One message for unary calls, several for server streaming. */
  messages: Record<string, unknown>[];
  bytes: number[];
  status: 'OK' | 'NOT_FOUND' | 'INVALID_ARGUMENT' | 'UNIMPLEMENTED';
  detail?: string;
}

/**
 * Models a gRPC call by the method's name: Get<Thing> finds by the request's first field, List<Things> returns
 * the matching items (Watch/Stream<Things> too; streamed when the method returns a stream), Create<Thing> adds one.
 */
export function callRpc(root: protobuf.Root, collections: Collections, service: string, method: string, request: Record<string, unknown>): RpcResult {
  const svc = (() => {
    try {
      return root.lookupService(service);
    } catch {
      return null;
    }
  })();
  const m = svc?.methods[method];
  if (!svc || !m) return { messages: [], bytes: [], status: 'UNIMPLEMENTED', detail: `Метода ${service}.${method} нет в схеме` };
  m.resolve();
  const reqType = m.resolvedRequestType!;
  const resType = m.resolvedResponseType!;
  const problem = reqType.verify(request);
  if (problem) return { messages: [], bytes: [], status: 'INVALID_ARGUMENT', detail: problem };
  const req = reqType.toObject(reqType.fromObject(request), { defaults: true, longs: Number });
  const shape = (item: Record<string, unknown>) => {
    const msg = resType.fromObject(item);
    return { object: resType.toObject(msg, { defaults: true, longs: Number, enums: String }), bytes: resType.encode(msg).finish().length };
  };
  const action = /^(Get|List|Watch|Stream|Create|Delete)(\w+)$/.exec(method);
  const name = action ? snake(action[2]) : '';
  const items = collections[plural(name)] ?? collections[name] ?? collections[plural(name.replace(/s$/, ''))];
  if (!action || !items) return { messages: [], bytes: [], status: 'UNIMPLEMENTED', detail: `Учебный сервер не знает, как выполнить ${method}` };
  const fields = Object.entries(req).filter(([, v]) => v !== '' && v !== 0 && v !== null && !(Array.isArray(v) && !v.length));
  if (action[1] === 'Get') {
    const [key, value] = fields[0] ?? Object.entries(req)[0] ?? ['id', 0];
    const found = items.find((i) => String(i[key]) === String(value));
    if (!found) return { messages: [], bytes: [], status: 'NOT_FOUND', detail: `${action[2]} с ${key} = ${String(value)} не найден` };
    const r = shape(found);
    return { messages: [r.object], bytes: [r.bytes], status: 'OK' };
  }
  if (action[1] === 'List' || action[1] === 'Watch' || action[1] === 'Stream') {
    const list = items.filter((i) => fields.every(([k, v]) => k in i === false || String(i[k]) === String(v)));
    const shaped = list.map(shape);
    if (m.responseStream) return { messages: shaped.map((s) => s.object), bytes: shaped.map((s) => s.bytes), status: 'OK' };
    // A unary List returns one message whose repeated field holds the items.
    const repeated = resType.fieldsArray.find((f) => f.repeated);
    const wrapped = shape(repeated ? { [repeated.name]: list } : {});
    return { messages: [wrapped.object], bytes: [wrapped.bytes], status: 'OK' };
  }
  if (action[1] === 'Create') {
    const item = { ...req, id: Math.max(0, ...items.map((i) => Number(i.id) || 0)) + 1 };
    items.push(item);
    const r = shape(item);
    return { messages: [r.object], bytes: [r.bytes], status: 'OK' };
  }
  const [key, value] = fields[0] ?? ['id', 0];
  const index = items.findIndex((i) => String(i[key]) === String(value));
  if (index === -1) return { messages: [], bytes: [], status: 'NOT_FOUND', detail: `${action[2]} с ${key} = ${String(value)} не найден` };
  const [removed] = items.splice(index, 1);
  const r = shape(removed);
  return { messages: [r.object], bytes: [r.bytes], status: 'OK' };
}
