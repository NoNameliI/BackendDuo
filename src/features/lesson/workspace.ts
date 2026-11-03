import { create } from 'zustand';
import { createEngine, type QueryPlan, type SandboxEngine, type SchemaInfo, type SqlError, type StatementResult } from '@/engine';
import { formatMs } from '@/ui/format';
import { formatSqlError, summarizeStatement } from './format';

export type LogKind = 'cmd' | 'info' | 'ok' | 'error';

export interface LogEntry {
  id: number;
  kind: LogKind;
  text: string;
  at: number;
}

export type EngineStatus = 'off' | 'starting' | 'ready' | 'busy' | 'failed';
export type ResultTab = 'result' | 'schema' | 'plan';

interface WorkspaceState {
  status: EngineStatus;
  code: string;
  setupSql: string;
  log: LogEntry[];
  result: StatementResult | null;
  error: SqlError | null;
  schema: SchemaInfo | null;
  plan: QueryPlan | null;
  tab: ResultTab;
  setCode: (code: string) => void;
  setTab: (tab: ResultTab) => void;
  print: (kind: LogKind, text: string) => void;
  clearLog: () => void;
  boot: () => Promise<void>;
  resetDatabase: () => Promise<void>;
  run: () => Promise<void>;
  explain: () => Promise<void>;
  check: () => void;
}

const LOG_LIMIT = 300;
let nextLogId = 1;
let engine: SandboxEngine | null = null;

const getEngine = () => (engine ??= createEngine('postgres'));

export const useWorkspace = create<WorkspaceState>((set, get) => {
  /** Serialises engine work and keeps `status` in sync. */
  const withEngine = async (work: (engine: SandboxEngine) => Promise<void>) => {
    if (get().status === 'busy' || get().status === 'starting') return;
    set({ status: 'busy' });
    try {
      await work(getEngine());
      set({ status: 'ready' });
    } catch (e) {
      get().print('error', e instanceof Error ? e.message : String(e));
      set({ status: 'failed' });
    }
  };

  const refreshSchema = async (engine: SandboxEngine) => set({ schema: await engine.introspect() });

  return {
    status: 'off',
    code: '',
    setupSql: '',
    log: [],
    result: null,
    error: null,
    schema: null,
    plan: null,
    tab: 'result',

    setCode: (code) => set({ code, error: null }),
    setTab: (tab) => set({ tab }),
    print: (kind, text) =>
      set((s) => ({ log: [...s.log, { id: nextLogId++, kind, text, at: Date.now() }].slice(-LOG_LIMIT) })),
    clearLog: () => set({ log: [] }),

    boot: async () => {
      if (get().status !== 'off' && get().status !== 'failed') return;
      set({ status: 'starting' });
      const started = performance.now();
      try {
        const engine = getEngine();
        await engine.init();
        await engine.reset(get().setupSql);
        await refreshSchema(engine);
        set({ status: 'ready' });
        get().print('ok', `Песочница PostgreSQL готова (${formatMs(performance.now() - started)})`);
      } catch (e) {
        set({ status: 'failed' });
        get().print('error', `Не удалось запустить песочницу: ${e instanceof Error ? e.message : String(e)}`);
      }
    },

    resetDatabase: () =>
      withEngine(async (engine) => {
        await engine.reset(get().setupSql);
        await refreshSchema(engine);
        set({ result: null, plan: null, error: null });
        get().print('info', 'База возвращена к исходному состоянию');
      }),

    run: () =>
      withEngine(async (engine) => {
        const { code, print } = get();
        if (!code.trim()) return;
        print('cmd', firstLine(code));
        const out = await engine.execute(code);
        out.results.forEach((r) => print('ok', summarizeStatement(r)));
        out.notices.forEach((n) => print('info', `NOTICE: ${n}`));
        if (out.error) print('error', formatSqlError(out.error));
        else print('info', `Готово за ${formatMs(out.durationMs)}`);

        const shown = out.results.findLast((r) => r.columns.length > 0) ?? null;
        set({ result: shown, error: out.error ?? null, ...(shown ? { tab: 'result' as const } : {}) });
        if (out.results.length > 0) await refreshSchema(engine);
      }),

    explain: () =>
      withEngine(async (engine) => {
        const { code, print } = get();
        if (!code.trim()) return;
        print('cmd', `EXPLAIN ${firstLine(code)}`);
        const out = await engine.explain(code, { analyze: true });
        if (out.error) {
          print('error', formatSqlError(out.error));
          set({ error: out.error });
          return;
        }
        set({ plan: out.plan, tab: 'plan' });
        print('ok', `План построен${out.plan.analyzed ? ' и выполнен' : ''}`);
      }),

    check: () => get().print('cmd', 'проверка решения'),
  };
});

function firstLine(code: string): string {
  const line = code.trim().split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}
