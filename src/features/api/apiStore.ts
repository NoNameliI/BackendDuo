import { createContext, useContext } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { browserFetch } from '@/engine/api/cors';
import { parseRequest, RequestFormatError, type ApiRequest, type Exchange } from '@/engine/api/http';
import { sendTo, type CorsConfig, type HttpSimServer } from '@/engine/api/server';

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

/** A frontend page in a simulated browser calls the server with fetch. */
export interface FrontendCall {
  origin: string;
  /** The fetch request as text. */
  request: string;
  credentials: boolean;
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
  setDraft: (patch: Partial<ApiRequest>) => void;
  /** Replaces the draft with a request written as text; returns the error message for bad text. */
  setDraftText: (text: string) => string | null;
  send: () => Promise<void>;
  setCorsConfig: (config: CorsConfig) => void;
  /** The page runs its fetch with the current CORS settings. */
  runFrontend: () => void;
  select: (id: number | null) => void;
  reset: (starter: string, options?: { server?: HttpSimServer | null; cors?: { config: CorsConfig; call: FrontendCall } | null }) => void;
}

export type ApiSandboxStore = UseBoundStore<StoreApi<ApiSandboxState>>;

let nextId = 1;
const EMPTY: ApiRequest = { method: 'GET', url: '/', headers: [], body: '' };

const fromText = (text: string): ApiRequest => {
  try {
    return parseRequest(text);
  } catch {
    return EMPTY;
  }
};

export function createApiSandboxStore(): ApiSandboxStore {
  return create<ApiSandboxState>((set, get) => {
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
        const { draft, engine } = get();
        set({ sending: true });
        try {
          record(await engine.send(draft));
        } finally {
          set({ sending: false });
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
      select: (selected) => set({ selected }),
      reset: (starter, options = {}) => {
        const server = options.server ?? null;
        set({
          draft: fromText(starter),
          exchanges: [],
          selected: null,
          server,
          engine: server ? serverEngine(server) : noServer,
          baseUrl: server?.def.baseUrl ?? '',
          cors: options.cors ?? null,
        });
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
