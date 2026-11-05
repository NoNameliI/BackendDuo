import { createContext, useContext } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { parseRequest, RequestFormatError, type ApiRequest, type Exchange } from '@/engine/api/http';

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

export interface ApiSandboxState {
  draft: ApiRequest;
  exchanges: Exchange[];
  selected: number | null;
  sending: boolean;
  engine: ApiEngine;
  /** Shown in the composer: where relative URLs go. */
  baseUrl: string;
  setDraft: (patch: Partial<ApiRequest>) => void;
  /** Replaces the draft with a request written as text; returns the error message for bad text. */
  setDraftText: (text: string) => string | null;
  send: () => Promise<void>;
  select: (id: number | null) => void;
  reset: (starter: string, engine?: ApiEngine, baseUrl?: string) => void;
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
  return create<ApiSandboxState>((set, get) => ({
    draft: EMPTY,
    exchanges: [],
    selected: null,
    sending: false,
    engine: noServer,
    baseUrl: '',
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
        const group = nextId;
        const produced = (await engine.send(draft)).map((e) => ({ ...e, id: nextId++, group }));
        set({ exchanges: [...get().exchanges, ...produced].slice(-100), selected: produced.at(-1)?.id ?? null });
      } finally {
        set({ sending: false });
      }
    },
    select: (selected) => set({ selected }),
    reset: (starter, engine = noServer, baseUrl = '') => set({ draft: fromText(starter), exchanges: [], selected: null, engine, baseUrl }),
  }));
}

export const ApiSandboxContext = createContext<ApiSandboxStore | null>(null);

export function useApiSandbox(): ApiSandboxStore {
  const store = useContext(ApiSandboxContext);
  if (!store) throw new Error('ApiSandboxContext is missing');
  return store;
}
