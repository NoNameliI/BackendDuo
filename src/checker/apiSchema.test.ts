import { describe, expect, it } from 'vitest';
import { runSchemaOp, type SchemaReply } from '@/engine/api/schemaOps';
import { createSchemaClient, type SchemaWorkerLike } from '@/engine/api/schemaClient';
import type { ServerDef } from '@/engine/api/server';
import { checkGraphql, checkProto, type GraphqlTask, type ProtoTask } from './apiSchema';
import { SolutionError } from './index';

const SERVER: ServerDef = {
  baseUrl: 'https://api.chat.local',
  routes: [],
  collections: {
    users: [{ id: 1, name: 'Ира' }, { id: 2, name: 'Олег' }],
    messages: [
      { id: 1, text: 'Привет', user_id: 1, chat_id: 1 },
      { id: 2, text: 'Как дела?', user_id: 2, chat_id: 1 },
    ],
  },
  graphql: `
type User { id: ID! name: String! messages: [Message!]! }
type Message { id: ID! text: String! user: User! }
input MessageInput { text: String! user_id: ID! chat_id: ID! }
type Query { messages(chat_id: ID): [Message!]! user(id: ID!): User }
type Mutation { createMessage(input: MessageInput!): Message! }`,
} as ServerDef;

const base = { id: 't', courseId: 'api', lessonId: 'l', title: 'T', xp: 10, hints: ['a'], server: 'chat', httpStarter: 'GET /', httpSolution: 'POST /graphql', variables: {} };
const gql = (solution: string, check: Partial<GraphqlTask['check']> = {}) =>
  ({ ...base, type: 'graphql', prompt: '', graphqlStarter: '{\n}', graphqlSolution: solution, check: { exactFields: false, state: [], ...check } }) as unknown as GraphqlTask;

describe('graphql check', () => {
  it('accepts the same data and explains errors and missing fields', () => {
    const task = gql('{ messages(chat_id: 1) { text user { name } } }');
    expect(checkGraphql(task, SERVER, { query: '{ messages(chat_id: 1) { text user { name } } }', variables: {} }).passed).toBe(true);
    expect(checkGraphql(task, SERVER, { query: 'query($c: ID) { messages(chat_id: $c) { id text user { name } } }', variables: { c: 1 } }).passed).toBe(true);
    expect(checkGraphql(task, SERVER, { query: '{ messages { text } }', variables: {} }).problems).toEqual(['Не запрошено поле «messages.user»']);
    expect(checkGraphql(task, SERVER, { query: '{ messages { body } }', variables: {} }).problems[0]).toMatch(/нет поля «body»/);
  });

  it('flags over-fetching with exactFields and compares data after mutations', () => {
    const exact = gql('{ messages { text } }', { exactFields: true });
    expect(checkGraphql(exact, SERVER, { query: '{ messages { id text } }', variables: {} }).problems[0]).toMatch(/^Запрошено лишнее: «messages.id»/);
    const mutation = gql('mutation { createMessage(input: { text: "Ок", user_id: 2, chat_id: 1 }) { id } }', { state: ['messages'] });
    expect(checkGraphql(mutation, SERVER, { query: 'mutation { createMessage(input: { text: "Ок", user_id: 2, chat_id: 1 }) { id text } }', variables: {} }).passed).toBe(true);
    expect(checkGraphql(mutation, SERVER, { query: 'mutation { createMessage(input: { text: "Нет", user_id: 2, chat_id: 1 }) { id } }', variables: {} }).problems).toEqual([
      'Данные «messages» на сервере после запроса отличаются от ожидаемых',
    ]);
    expect(() => checkGraphql(gql('{ nope }'), SERVER, { query: '{ messages { id } }', variables: {} })).toThrow(SolutionError);
  });
});

const proto = (solution: string, fieldNumbers = true) =>
  ({ ...base, type: 'proto', prompt: '', httpSolution: 'POST /', protoStarter: '', protoSolution: solution, check: { fieldNumbers } }) as unknown as ProtoTask;

const REF = `syntax = "proto3";
package chat;
message Message { int64 id = 1; string text = 2; repeated string tags = 3; }
message MessageRequest { int64 id = 1; }
service ChatService { rpc GetMessage (MessageRequest) returns (Message); }`;

describe('proto check', () => {
  it('compares messages, fields and services', () => {
    const task = proto(REF);
    expect(checkProto(task, REF).passed).toBe(true);
    const wrong = REF.replace('string text = 2', 'string text = 4').replace('repeated string tags', 'string tags').replace('int64 id = 1; }\nservice', 'int64 id = 1; string note = 2; }\nservice');
    expect(checkProto(task, wrong).problems).toEqual([
      'Message.text: номер поля 2, а у вас 4. Номер — это то, что уходит по сети вместо имени',
      'Message.tags: это список — нужен repeated',
      'В MessageRequest лишнее поле note',
    ]);
    expect(checkProto(task, REF.replace('returns (Message)', 'returns (stream Message)')).problems).toEqual(['Метод GetMessage: ожидается rpc GetMessage (MessageRequest) returns (Message)']);
    expect(checkProto(task, 'syntax = "proto3";\nmessage A {').problems[0]).toBeTruthy();
    expect(checkProto(proto(REF, false), REF.replace('string text = 2', 'string text = 4')).passed).toBe(true);
  });
});

describe('schema worker client', () => {
  const inProcess = (): SchemaWorkerLike => {
    const w: SchemaWorkerLike = {
      onmessage: null,
      onerror: null,
      terminate() {},
      postMessage({ id, op, args }) {
        const reply: SchemaReply = runSchemaOp(id, op, args);
        queueMicrotask(() => w.onmessage?.({ data: reply } as MessageEvent<SchemaReply>));
      },
    };
    return w;
  };

  it('runs operations, keeps data outside and rethrows content errors', async () => {
    const client = createSchemaClient(inProcess);
    const { result, collections, explained } = await client.graphql(SERVER.graphql!, SERVER.collections!, 'mutation { createMessage(input: { text: "x", user_id: 1, chat_id: 2 }) { id } }', {});
    expect(result.data).toEqual({ createMessage: { id: '3' } });
    expect(collections.messages).toHaveLength(3);
    expect(SERVER.collections!.messages).toHaveLength(2);
    expect(explained).toEqual([]);
    const parsed = await client.proto(REF);
    expect(parsed.ok && parsed.summary.services[0].methods[0].name).toBe('GetMessage');
    await expect(client.checkProto(proto('broken {'), REF)).rejects.toBeInstanceOf(SolutionError);
  });

  it('stops a call that hangs and starts a fresh worker', async () => {
    let spawned = 0;
    const silent = (): SchemaWorkerLike => {
      spawned++;
      return { onmessage: null, onerror: null, terminate() {}, postMessage() {} };
    };
    const client = createSchemaClient(silent, 20);
    await expect(client.proto(REF)).rejects.toThrow(/был остановлен/);
    await expect(client.proto(REF)).rejects.toThrow(/был остановлен/);
    expect(spawned).toBe(2);
  });
});
