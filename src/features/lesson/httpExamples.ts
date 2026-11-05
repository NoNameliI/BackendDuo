import { courseById } from '@/content/courses';
import type { Lesson } from '@/content/loadCourse';
import type { Collections } from '@/engine/api/graphqlRun';
import { parseRequest, prettyBody, type ApiRequest, type ApiResponse } from '@/engine/api/http';
import type { ProtoSummary } from '@/engine/api/protoRun';
import { schemaClient } from '@/engine/api/schemaClient';
import { splitPythonExample } from '@/engine/python/example';
import { explainPythonError } from '@/engine/python/explain';
import { pythonClient } from '@/engine/python/pythonClient';
import { HttpSimServer, sendTo, splitRequests } from '@/engine/api/server';

export interface HttpRun {
  request: ApiRequest;
  response: ApiResponse | null;
  error?: string;
  /** What print() wrote (python examples). */
  output?: string;
}

// The `http example` blocks of a lesson share one virtual server and run in order, like requests sent by hand.
let server: HttpSimServer | null = null;
let loadedLesson: string | null = null;

function load(lesson: Lesson): HttpSimServer | null {
  const def = lesson.exampleServer ? courseById(lesson.courseId).servers[lesson.exampleServer] : undefined;
  server = def ? new HttpSimServer(def) : null;
  loadedLesson = lesson.id;
  return server;
}

export function runHttpExample(lesson: Lesson, text: string): HttpRun[] {
  const target = loadedLesson === lesson.id ? server : load(lesson);
  return splitRequests(text).map((block) => {
    let request: ApiRequest;
    try {
      request = parseRequest(block);
    } catch (e) {
      return { request: { method: '?', url: '', headers: [], body: '' }, response: null, error: (e as Error).message };
    }
    if (!target) return { request, response: null, error: 'У урока нет учебного сервера' };
    const res = sendTo(target, request);
    return typeof res === 'string' ? { request, response: null, error: res } : { request, response: res };
  });
}

export function resetHttpExamples(lesson: Lesson): void {
  load(lesson);
  data = null;
}

export interface SchemaRun {
  /** Answer, encoded bytes or call results to show under the example. */
  lines: { text: string; ok: boolean }[];
  summary?: ProtoSummary;
}

// GraphQL and proto examples of a lesson share the data of its server, so a mutation is seen by later examples.
let data: { lesson: string; collections: Collections } | null = null;

function collectionsOf(lesson: Lesson): Collections {
  if (data?.lesson !== lesson.id) {
    const def = lesson.exampleServer ? courseById(lesson.courseId).servers[lesson.exampleServer] : undefined;
    data = { lesson: lesson.id, collections: structuredClone(def?.collections ?? {}) };
  }
  return data.collections;
}

export async function runGraphqlExample(lesson: Lesson, query: string): Promise<SchemaRun> {
  const sdl = lesson.exampleServer ? courseById(lesson.courseId).servers[lesson.exampleServer]?.graphql : undefined;
  if (!sdl) return { lines: [{ text: 'У сервера урока нет GraphQL-схемы', ok: false }] };
  try {
    const { result, collections, explained } = await schemaClient().graphql(sdl, collectionsOf(lesson), query, {});
    data = { lesson: lesson.id, collections };
    const body = JSON.stringify({ ...(result.data !== undefined ? { data: result.data } : {}), ...(result.errors ? { errors: result.errors.map((e) => ({ message: e.message })) } : {}) });
    return {
      lines: [{ text: prettyBody(body), ok: true }, ...explained.map((text) => ({ text, ok: false })), { text: `Обращений к источнику данных: ${result.calls}`, ok: true }],
    };
  } catch (e) {
    return { lines: [{ text: (e as Error).message, ok: false }] };
  }
}

export async function runProtoExample(lesson: Lesson, text: string): Promise<SchemaRun> {
  try {
    const out = await schemaClient().protoExample(text, collectionsOf(lesson));
    data = { lesson: lesson.id, collections: out.collections };
    if (out.error) return { lines: [{ text: out.error, ok: false }] };
    return { summary: out.summary, lines: out.outputs.map((o) => ({ text: `${o.line}\n${o.text}`, ok: o.ok })) };
  } catch (e) {
    return { lines: [{ text: (e as Error).message, ok: false }] };
  }
}

/** A `python example`: the app runs afresh with its requests; nothing is kept between examples. */
export async function runPythonExample(text: string): Promise<HttpRun[]> {
  let example: ReturnType<typeof splitPythonExample>;
  try {
    example = splitPythonExample(text);
  } catch (e) {
    return [{ request: { method: '?', url: '', headers: [], body: '' }, response: null, error: (e as Error).message }];
  }
  try {
    const run = await pythonClient().run(example.source, example.requests);
    const output = run.output.trim() ? `Вывод print: ${run.output.trim()}` : undefined;
    if (!run.load.ok) return [{ request: { method: 'python', url: 'main.py', headers: [], body: '' }, response: null, error: explainPythonError(run.load.error) }];
    return example.requests.map((request, i) => {
      const res = run.responses[i];
      return {
        request,
        response: { status: res.status, headers: res.headers, body: res.body, timeMs: Math.round(res.ms) },
        ...(res.error ? { error: explainPythonError(res.error) } : {}),
        ...(i === example.requests.length - 1 && output ? { output } : {}),
      };
    });
  } catch (e) {
    return [{ request: { method: 'python', url: 'main.py', headers: [], body: '' }, response: null, error: (e as Error).message }];
  }
}
