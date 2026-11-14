import { createContext, useContext } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { browserFetch } from '@/engine/api/cors';
import type { Collections } from '@/engine/api/graphqlRun';
import { jsonSize, parseRequest, RequestFormatError, splitUrl, type ApiRequest, type Exchange } from '@/engine/api/http';
import type { Encoded, ProtoSummary } from '@/engine/api/protoRun';
import { schemaClient } from '@/engine/api/schemaClient';
import { sendTo, type CorsConfig, type HttpSimServer } from '@/engine/api/server';
import { explainPythonError } from '@/engine/python/explain';
import { PYTHON_BASE_URL, pythonClient } from '@/engine/python/pythonClient';
import type { Project, ProjectFiles, PytestRun } from '@/engine/python/runtime';
import { readSpec, type Spec } from '@/features/fastapi/openapi';
import { closeTab, createFile, deleteFile, openFile, renameFile, type ProjectState } from '@/features/fastapi/project';

/** Sends a request somewhere inside the app (a virtual server, a simulated browser) — never to the network. */
export interface ApiEngine {
  send(request: ApiRequest): Promise<Omit<Exchange, 'id'>[]>;
}

/** Engine of a task without a virtual server: says so instead of pretending. */
export const noServer: ApiEngine = {
  async send(request) {
    return [{ kind: 'request', request, response: null, error: 'У этого задания нет учебного сервера: здесь важен сам запрос. Соберите его и нажмите «Проверить».' }];
  },
};

/** Requests go straight to a virtual server (like a tool such as curl or Postman would send them). */
export function serverEngine(server: HttpSimServer): ApiEngine {
  return {
    async send(request) {
      const res = sendTo(server, request);
      return [typeof res === 'string' ? { kind: 'request', request, response: null, error: res } : { kind: 'request', request, response: res }];
    },
  };
}

/** One line of the app log: what the app wrote while loading, the studio's access line, what a request printed. */
export interface PythonLogEntry {
  id: number;
  kind: 'load' | 'access' | 'output' | 'error';
  text: string;
}

export const PYTHON_LOG_LIMIT = 200;

/** The learner's project as the sandbox holds it: files, the tabs, whether the file tree shows, lazy package groups. */
export interface PythonProject extends ProjectState {
  tree: boolean;
  groups: string[];
  /** Files the learner cannot edit (the editor shows them locked). */
  readonly: string[];
}

/** What a FastAPI task starts with; `files` and `tree` let a task bring a whole project. */
export interface PythonStart {
  files: ProjectFiles;
  entry: string;
  tree: boolean;
  groups: string[];
  readonly?: string[];
}

export interface PythonDocs {
  spec: Spec | null;
  loading: boolean;
  error: string | null;
  /** Whether the project was edited after the spec was read. */
  stale: boolean;
}

export interface PythonTests {
  running: boolean;
  run: PytestRun | null;
  error: string | null;
}

const NO_TESTS: PythonTests = { running: false, run: null, error: null };

const STREAM_NOTE = 'Потоковый ответ: показан целиком после завершения';

/** `INFO:     127.0.0.1:50000 - "GET /items?limit=2 HTTP/1.1" 200`: the line uvicorn would write; the studio writes it here. */
export function accessLine(request: ApiRequest, status: number): string {
  const { origin } = splitUrl(request.url);
  const target = origin ? request.url.slice(origin.length) || '/' : request.url;
  return `INFO:     127.0.0.1:50000 - "${request.method} ${target.startsWith('/') ? target : `/${target}`} HTTP/1.1" ${status}`;
}

/**
 * Requests go to the learner's own FastAPI project. The app is kept between sends, so a POST is seen by
 * the next GET; editing the code starts it afresh, like uvicorn --reload.
 */
export function pythonEngine(read: () => { project: Project; groups: string[] }, log: (entries: Omit<PythonLogEntry, 'id'>[]) => void = () => {}): ApiEngine {
  return {
    async send(request) {
      const origin = splitUrl(request.url).origin;
      if (origin && origin !== PYTHON_BASE_URL) return [{ kind: 'request', request, response: null, error: `Запрос ушёл на ${origin}, а приложение запущено на ${PYTHON_BASE_URL}` }];
      try {
        const { project, groups } = read();
        const run = await pythonClient().run(project, [request], { keep: true, groups });
        const entries: Omit<PythonLogEntry, 'id'>[] = [];
        if (run.output.trim()) entries.push({ kind: 'load', text: run.output.trimEnd() });
        if (!run.load.ok) {
          const text = explainPythonError(run.load.error);
          log([...entries, { kind: 'error', text }]);
          return [{ kind: 'request', request, response: null, error: text, notes: run.output.trim() ? [{ text: `Вывод print: ${run.output.trim()}`, warn: false }] : [] }];
        }
        const res = run.responses[0];
        entries.push({ kind: 'access', text: accessLine(request, res.status) });
        if (res.output.trim()) entries.push({ kind: 'output', text: res.output.trimEnd() });
        if (res.error) entries.push({ kind: 'error', text: explainPythonError(res.error) });
        log(entries);
        const printed = [run.output.trim(), res.output.trim()].filter(Boolean).join('\n');
        const notes = [
          ...(res.error ? [{ text: explainPythonError(res.error), warn: true }] : []),
          ...(printed ? [{ text: `Вывод print: ${printed}`, warn: false }] : []),
          ...(res.chunks > 1 ? [{ text: STREAM_NOTE, warn: false }] : []),
        ];
        return [{ kind: 'request', request, response: { status: res.status, headers: res.headers, body: res.body, timeMs: Math.max(1, Math.round(res.ms)) }, notes }];
      } catch (e) {
        return [{ kind: 'request', request, response: null, error: (e as Error).message }];
      }
    },
  };
}

/** A frontend page in a simulated browser calls the server with fetch. */
export interface FrontendCall {
  origin: string;
  /** The fetch request as text. */
  request: string;
  credentials: boolean;
}

/** GraphQL tasks: the query being written, its variables (JSON text) and the server's schema and data. */
export interface GraphqlSandbox {
  query: string;
  variables: string;
  sdl: string;
  collections: Collections;
}

/** Protobuf tasks: the .proto being written, what it parses into, the last encoding, the server's data. */
export interface ProtoSandbox {
  source: string;
  summary: ProtoSummary | null;
  error: string | null;
  encoded: Encoded | { error: string } | null;
  collections: Collections;
}

export interface ApiSandboxState {
  draft: ApiRequest;
  exchanges: Exchange[];
  selected: number | null;
  sending: boolean;
  engine: ApiEngine;
  server: HttpSimServer | null;
  /** Where relative URLs go (the server's address). */
  baseUrl: string;
  /** CORS tasks: the server's settings the learner edits and the page that calls the server. */
  cors: { config: CorsConfig; call: FrontendCall } | null;
  graphql: GraphqlSandbox | null;
  proto: ProtoSandbox | null;
  /** FastAPI tasks: the learner's project (one main.py unless the task brings a tree). */
  python: PythonProject | null;
  /** Replaces the text of the active file. */
  setPythonSource: (source: string) => void;
  /** Replaces all files of the project (the solution inserted from the task panel); the entry and the read-only list stay. */
  setPythonProject: (files: ProjectFiles) => void;
  openPythonFile: (path: string) => void;
  closePythonTab: (path: string) => void;
  /** File operations answer with an error message in Russian, or null when done. */
  createPythonFile: (path: string) => string | null;
  renamePythonFile: (from: string, to: string) => string | null;
  deletePythonFile: (path: string) => string | null;
  /** The app log (newest last, capped) and the documentation read from /openapi.json. */
  pythonLog: PythonLogEntry[];
  clearPythonLog: () => void;
  docs: PythonDocs;
  loadDocs: () => Promise<void>;
  /** The last pytest run of the project. */
  tests: PythonTests;
  runTests: () => Promise<void>;
  setDraft: (patch: Partial<ApiRequest>) => void;
  /** Replaces the draft with a request written as text; returns the error message for bad text. */
  setDraftText: (text: string) => string | null;
  send: () => Promise<void>;
  setCorsConfig: (config: CorsConfig) => void;
  /** The page runs its fetch with the current CORS settings. */
  runFrontend: () => void;
  setGraphql: (patch: Partial<Pick<GraphqlSandbox, 'query' | 'variables'>>) => void;
  /** Runs the query on the server: logged as the POST /graphql request it is. */
  runGraphql: () => Promise<void>;
  /** Re-parses the .proto (the panel calls it as the learner types). */
  setProtoSource: (source: string) => Promise<void>;
  encodeProto: (type: string, json: string) => Promise<void>;
  /** A gRPC call: logged as POST /package.Service/Method, like on the wire. */
  callRpc: (service: string, method: string, json: string) => Promise<void>;
  select: (id: number | null) => void;
  reset: (
    starter: string,
    options?: {
      server?: HttpSimServer | null;
      cors?: { config: CorsConfig; call: FrontendCall } | null;
      graphql?: Omit<GraphqlSandbox, 'variables'> & { variables: Record<string, unknown> };
      proto?: { source: string; collections: Collections };
      python?: PythonStart;
    },
  ) => void;
}

export type ApiSandboxStore = UseBoundStore<StoreApi<ApiSandboxState>>;

let nextId = 1;
const NO_DOCS: PythonDocs = { spec: null, loading: false, error: null, stale: false };
const EMPTY: ApiRequest = { method: 'GET', url: '/', headers: [], body: '' };

/** JSON object typed by the learner (variables, a message); empty text is an empty object. */
export function readJsonObject(text: string, what: string): Record<string, unknown> {
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${what}: это не JSON. Пример: {"id": 1}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${what}: нужен объект в фигурных скобках`);
  return value as Record<string, unknown>;
}

const GRPC_CODES = { OK: 0, INVALID_ARGUMENT: 3, NOT_FOUND: 5, UNIMPLEMENTED: 12 } as const;

const fromText = (text: string): ApiRequest => {
  try {
    return parseRequest(text);
  } catch {
    return EMPTY;
  }
};

export function createApiSandboxStore(): ApiSandboxStore {
  return create<ApiSandboxState>((set, get) => {
    // Bumped by reset: an answer that arrives after the task changed belongs to the old task and is dropped.
    let generation = 0;
    const current = () => {
      const started = generation;
      return () => started === generation;
    };
    // A file operation: the project it produced replaces the old one, the docs are out of date.
    const changeProject = (outcome: ReturnType<typeof createFile>): string | null => {
      const python = get().python;
      if (!python) return 'Проект не запущен';
      if (!outcome.ok) return outcome.error;
      set({ python: { ...python, ...outcome.value }, docs: { ...get().docs, stale: true } });
      return null;
    };
    const record = (produced: Omit<Exchange, 'id'>[]) => {
      const group = nextId;
      const withIds = produced.map((e) => ({ ...e, id: nextId++, group }));
      set({ exchanges: [...get().exchanges, ...withIds].slice(-100), selected: withIds.at(-1)?.id ?? null });
    };
    return {
      draft: EMPTY,
      exchanges: [],
      selected: null,
      sending: false,
      engine: noServer,
      server: null,
      baseUrl: '',
      cors: null,
      graphql: null,
      proto: null,
      python: null,
      setPythonSource: (source) => {
        const python = get().python;
        if (!python || python.readonly.includes(python.active)) return;
        set({ python: { ...python, files: { ...python.files, [python.active]: source } }, docs: { ...get().docs, stale: true } });
      },
      setPythonProject: (files) => {
        const python = get().python;
        if (!python) return;
        set({ python: { ...python, files, active: python.entry, open: [python.entry] }, docs: { ...get().docs, stale: true } });
      },
      openPythonFile: (path) => {
        const python = get().python;
        if (python) set({ python: { ...python, ...openFile(python, path) } });
      },
      closePythonTab: (path) => {
        const python = get().python;
        if (python) set({ python: { ...python, ...closeTab(python, path) } });
      },
      createPythonFile: (path) => changeProject(createFile(get().python as PythonProject, path)),
      renamePythonFile: (from, to) => (get().python?.readonly.includes(from) ? `Файл «${from}» только для чтения` : changeProject(renameFile(get().python as PythonProject, from, to))),
      deletePythonFile: (path) => (get().python?.readonly.includes(path) ? `Файл «${path}» только для чтения` : changeProject(deleteFile(get().python as PythonProject, path))),
      pythonLog: [],
      clearPythonLog: () => set({ pythonLog: [] }),
      docs: NO_DOCS,
      tests: NO_TESTS,
      runTests: async () => {
        const python = get().python;
        if (!python || get().tests.running) return;
        const alive = current();
        set({ tests: { running: true, run: null, error: null } });
        let tests: PythonTests;
        try {
          tests = { running: false, run: await pythonClient().test({ files: python.files, entry: python.entry }, { groups: python.groups }), error: null };
        } catch (e) {
          tests = { running: false, run: null, error: e instanceof Error ? e.message : String(e) };
        }
        if (alive()) set({ tests });
      },
      loadDocs: async () => {
        const python = get().python;
        if (!python || get().docs.loading) return;
        const alive = current();
        set({ docs: { ...get().docs, loading: true, error: null } });
        let docs: PythonDocs;
        try {
          const run = await pythonClient().run({ files: python.files, entry: python.entry }, [{ method: 'GET', url: '/openapi.json', headers: [], body: '' }], { keep: true, groups: python.groups });
          if (!run.load.ok) docs = { spec: null, loading: false, error: explainPythonError(run.load.error), stale: false };
          else if (run.responses[0].status !== 200) docs = { spec: null, loading: false, error: `Приложение ответило на /openapi.json кодом ${run.responses[0].status}`, stale: false };
          else docs = { spec: readSpec(JSON.parse(run.responses[0].body)), loading: false, error: null, stale: false };
        } catch (e) {
          docs = { spec: null, loading: false, error: e instanceof Error ? e.message : String(e), stale: false };
        }
        if (alive()) set({ docs: { ...docs, stale: get().python?.files !== python.files } });
      },
      setDraft: (patch) => set({ draft: { ...get().draft, ...patch } }),
      setDraftText: (text) => {
        try {
          set({ draft: parseRequest(text) });
          return null;
        } catch (e) {
          if (e instanceof RequestFormatError) return e.message;
          throw e;
        }
      },
      send: async () => {
        const { draft, engine, sending } = get();
        if (sending) return;
        const alive = current();
        set({ sending: true });
        try {
          const produced = await engine.send(draft);
          if (alive()) record(produced);
        } finally {
          if (alive()) set({ sending: false });
        }
      },
      setCorsConfig: (config) => {
        const cors = get().cors;
        if (cors) set({ cors: { ...cors, config } });
      },
      runFrontend: () => {
        const { cors, server } = get();
        if (!cors || !server) return;
        record(browserFetch(server, cors.config, { origin: cors.call.origin, request: parseRequest(cors.call.request), credentials: cors.call.credentials }));
      },
      setGraphql: (patch) => {
        const graphql = get().graphql;
        if (graphql) set({ graphql: { ...graphql, ...patch } });
      },
      runGraphql: async () => {
        const graphql = get().graphql;
        if (!graphql) return;
        const request: ApiRequest = { method: 'POST', url: `${get().baseUrl}/graphql`, headers: [{ name: 'Content-Type', value: 'application/json' }], body: '' };
        let variables: Record<string, unknown>;
        try {
          variables = readJsonObject(graphql.variables, 'Переменные');
        } catch (e) {
          record([{ kind: 'request', protocol: 'graphql', request: { ...request, body: JSON.stringify({ query: graphql.query }) }, response: null, error: (e as Error).message }]);
          return;
        }
        request.body = JSON.stringify(Object.keys(variables).length ? { query: graphql.query, variables } : { query: graphql.query }, null, 2);
        if (get().sending) return;
        const alive = current();
        set({ sending: true });
        try {
          const { result, collections, explained } = await schemaClient().graphql(graphql.sdl, graphql.collections, graphql.query, variables);
          if (!alive()) return;
          const notes = explained.map((text) => ({ text, warn: true }));
          notes.push({ text: `Обращений к источнику данных: ${result.calls}`, warn: false });
          const body = JSON.stringify({ ...(result.data !== undefined ? { data: result.data } : {}), ...(result.errors ? { errors: result.errors } : {}) });
          set({ graphql: { ...graphql, ...get().graphql, collections } });
          record([{ kind: 'request', protocol: 'graphql', request, response: { status: 200, headers: [{ name: 'content-type', value: 'application/json' }], body, timeMs: 6 + result.calls }, notes }]);
        } catch (e) {
          if (alive()) record([{ kind: 'request', protocol: 'graphql', request, response: null, error: (e as Error).message }]);
        } finally {
          if (alive()) set({ sending: false });
        }
      },
      setProtoSource: async (source) => {
        const proto = get().proto;
        if (!proto) return;
        set({ proto: { ...proto, source } });
        const parsed = await schemaClient().proto(source);
        const now = get().proto;
        if (!now || now.source !== source) return;
        set({ proto: { ...now, summary: parsed.ok ? parsed.summary : null, error: parsed.ok ? null : parsed.error } });
      },
      encodeProto: async (type, json) => {
        const proto = get().proto;
        if (!proto) return;
        const alive = current();
        let encoded: Encoded | { error: string };
        try {
          encoded = await schemaClient().encode(proto.source, type, readJsonObject(json, 'Значение'));
        } catch (e) {
          encoded = { error: (e as Error).message };
        }
        const now = get().proto;
        if (alive() && now) set({ proto: { ...now, encoded } });
      },
      callRpc: async (service, method, json) => {
        const proto = get().proto;
        if (!proto) return;
        const request: ApiRequest = {
          method: 'POST',
          url: `${get().baseUrl}/${service}/${method}`,
          headers: [
            { name: 'Content-Type', value: 'application/grpc' },
            { name: 'TE', value: 'trailers' },
          ],
          body: json,
        };
        const alive = current();
        try {
          const { result, collections } = await schemaClient().rpc(proto.source, proto.collections, service, method, readJsonObject(json, 'Запрос'));
          const now = get().proto;
          if (!alive() || !now) return;
          const code = GRPC_CODES[result.status];
          const notes = [{ text: `gRPC-статус ${code} ${result.status}${result.detail ? `: ${result.detail}` : ''}`, warn: result.status !== 'OK' }];
          if (result.status === 'OK') {
            const bytes = result.bytes.reduce((a, b) => a + b, 0);
            const stream = result.messages.length > 1 ? `Сообщений в потоке: ${result.messages.length}. ` : '';
            notes.push({ text: `${stream}В protobuf — ${bytes} Б, тот же ответ в JSON — ${result.messages.reduce((a, m) => a + jsonSize(m), 0)} Б`, warn: false });
          }
          set({ proto: { ...now, collections } });
          const body = result.messages.length > 1 ? `[${result.messages.map((m) => JSON.stringify(m)).join(',')}]` : JSON.stringify(result.messages[0] ?? {});
          record([
            {
              kind: 'request',
              protocol: 'grpc',
              request,
              response: { status: 200, headers: [{ name: 'content-type', value: 'application/grpc' }, { name: 'grpc-status', value: String(code) }], body, timeMs: 3 + result.messages.length },
              notes,
            },
          ]);
        } catch (e) {
          if (alive()) record([{ kind: 'request', protocol: 'grpc', request, response: null, error: (e as Error).message }]);
        }
      },
      select: (selected) => set({ selected }),
      reset: (starter, options = {}) => {
        const server = options.server ?? null;
        const graphql = options.graphql;
        const python: PythonProject | null = options.python ? { ...options.python, readonly: options.python.readonly ?? [], active: options.python.entry, open: [options.python.entry] } : null;
        generation++;
        set({
          sending: false,
          draft: fromText(starter),
          exchanges: [],
          selected: null,
          server,
          engine: python
            ? pythonEngine(
                () => {
                  const now = get().python;
                  return { project: { files: now?.files ?? {}, entry: now?.entry }, groups: now?.groups ?? [] };
                },
                (entries) => set({ pythonLog: [...get().pythonLog, ...entries.map((e) => ({ ...e, id: nextId++ }))].slice(-PYTHON_LOG_LIMIT) }),
              )
            : server ? serverEngine(server) : noServer,
          baseUrl: python ? PYTHON_BASE_URL : (server?.def.baseUrl ?? ''),
          python,
          pythonLog: [],
          docs: NO_DOCS,
          tests: NO_TESTS,
          cors: options.cors ?? null,
          graphql: graphql ? { ...graphql, variables: Object.keys(graphql.variables).length ? JSON.stringify(graphql.variables, null, 2) : '' } : null,
          proto: options.proto ? { ...options.proto, summary: null, error: null, encoded: null } : null,
        });
        if (options.proto) void get().setProtoSource(options.proto.source);
        if (python) {
          pythonClient().prewarm();
          void pythonClient().forget().catch(() => {});
        }
      },
    };
  });
}

export const ApiSandboxContext = createContext<ApiSandboxStore | null>(null);

export function useApiSandbox(): ApiSandboxStore {
  const store = useContext(ApiSandboxContext);
  if (!store) throw new Error('ApiSandboxContext is missing');
  return store;
}
