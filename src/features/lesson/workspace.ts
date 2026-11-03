import { create } from 'zustand';

export type LogKind = 'cmd' | 'info' | 'ok' | 'error';

export interface LogEntry {
  id: number;
  kind: LogKind;
  text: string;
  at: number;
}

interface WorkspaceState {
  code: string;
  log: LogEntry[];
  setCode: (code: string) => void;
  print: (kind: LogKind, text: string) => void;
  clearLog: () => void;
  run: () => void;
  check: () => void;
}

const LOG_LIMIT = 200;
let nextId = 1;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  code: '',
  log: [],
  setCode: (code) => set({ code }),
  print: (kind, text) =>
    set((s) => ({ log: [...s.log, { id: nextId++, kind, text, at: Date.now() }].slice(-LOG_LIMIT) })),
  clearLog: () => set({ log: [] }),
  run: () => get().print('cmd', firstLine(get().code) || '(пустой запрос)'),
  check: () => get().print('cmd', 'проверка решения'),
}));

function firstLine(code: string): string {
  const line = code.trim().split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}
