import { useDeferredValue, useMemo, useState } from 'react';

/** Plain data, the shape of the simulator's journal entry. */
export interface JournalRow {
  seq: number;
  at: number;
  kind: string;
  actor: string;
  subject?: string;
  msg?: string;
  text: string;
  rule?: string;
}

interface JournalViewProps {
  entries: readonly JournalRow[];
  /** Message whose path is highlighted. Controlled by the parent when given. */
  selectedMsg?: string | null;
  onSelectMsg?: (msg: string | null) => void;
  /** Rule id → title shown in the tooltip and after the line. */
  ruleTitle?: (rule: string) => string | undefined;
  /** Rows drawn at most (the newest); older ones stay reachable through filters. */
  limit?: number;
}

/** Kinds that deserve a spoken announcement; ordinary traffic never does. */
const ANNOUNCED = new Set(['fault', 'error', 'handler.error', 'sim.limit', 'deadletter', 'drop', 'return', 'rebalance', 'leader']);
const TONE: Record<string, string> = {
  fault: 'text-[color-mix(in_oklab,var(--err),var(--fg)_30%)]',
  error: 'text-[color-mix(in_oklab,var(--err),var(--fg)_30%)]',
  'sim.limit': 'text-[color-mix(in_oklab,var(--err),var(--fg)_30%)]',
  deadletter: 'text-[color-mix(in_oklab,var(--amber),var(--fg)_30%)]',
  drop: 'text-[color-mix(in_oklab,var(--amber),var(--fg)_30%)]',
  return: 'text-[color-mix(in_oklab,var(--amber),var(--fg)_30%)]',
  nack: 'text-[color-mix(in_oklab,var(--amber),var(--fg)_30%)]',
  requeue: 'text-[color-mix(in_oklab,var(--amber),var(--fg)_30%)]',
  expire: 'text-[color-mix(in_oklab,var(--amber),var(--fg)_30%)]',
  rebalance: 'text-[color-mix(in_oklab,var(--nav),var(--fg)_30%)]',
  leader: 'text-[color-mix(in_oklab,var(--nav),var(--fg)_30%)]',
  isr: 'text-[color-mix(in_oklab,var(--nav),var(--fg)_30%)]',
};

const stamp = (ms: number): string => `${(ms / 1000).toFixed(2).replace('.', ',')} с`;
const uniq = (xs: readonly (string | undefined)[]): string[] => [...new Set(xs.filter((x): x is string => !!x))].sort();

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-dim">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-7 max-w-40 rounded border border-line-strong bg-well px-1.5 text-[12px] text-fg">
        <option value="">все</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function JournalView({ entries, selectedMsg, onSelectMsg, ruleTitle, limit = 400 }: JournalViewProps) {
  const [kind, setKind] = useState('');
  const [actor, setActor] = useState('');
  const [msgFilter, setMsgFilter] = useState('');
  const [inner, setInner] = useState<string | null>(null);
  const selected = selectedMsg === undefined ? inner : selectedMsg;
  const select = (m: string | null) => {
    setInner(m);
    onSelectMsg?.(m);
  };

  // Option lists and rows are derived from a deferred copy: playback at 16× must not block typing in filters.
  const rowsSource = useDeferredValue(entries);
  const kinds = useMemo(() => uniq(rowsSource.map((e) => e.kind)), [rowsSource]);
  const actors = useMemo(() => uniq(rowsSource.map((e) => e.actor)), [rowsSource]);
  const shown = useMemo(() => {
    const q = msgFilter.trim().toLowerCase();
    return rowsSource.filter((e) => (!kind || e.kind === kind) && (!actor || e.actor === actor) && (!q || (e.msg ?? '').toLowerCase().includes(q)));
  }, [rowsSource, kind, actor, msgFilter]);
  const visible = shown.length > limit ? shown.slice(shown.length - limit) : shown;

  // Live region: only the latest notable event, never every tick.
  const lastNotable = useMemo(() => {
    for (let i = rowsSource.length - 1; i >= 0; i--) if (ANNOUNCED.has(rowsSource[i].kind)) return rowsSource[i];
    return null;
  }, [rowsSource]);

  return (
    <section aria-label="Журнал событий" className="flex min-h-0 flex-col gap-2">
      <div role="search" aria-label="Фильтры журнала" className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Select label="Событие" value={kind} options={kinds} onChange={setKind} />
        <Select label="Участник" value={actor} options={actors} onChange={setActor} />
        <label className="flex items-center gap-1.5 text-[12px] text-dim">
          Сообщение
          <input
            type="text"
            value={msgFilter}
            onChange={(e) => setMsgFilter(e.target.value)}
            placeholder="order-17"
            className="h-7 w-28 rounded border border-line-strong bg-well px-1.5 font-mono text-[12px] text-fg placeholder:text-faint"
          />
        </label>
        {(kind || actor || msgFilter || selected) && (
          <button
            type="button"
            onClick={() => {
              setKind('');
              setActor('');
              setMsgFilter('');
              select(null);
            }}
            className="h-7 rounded border border-line-strong px-2 text-[12px] text-dim hover:border-faint hover:text-fg"
          >
            Сбросить
          </button>
        )}
        <span className="ml-auto text-[12px] text-dim">
          {shown.length === entries.length ? `${entries.length} записей` : `${shown.length} из ${entries.length}`}
          {shown.length > limit ? `, показаны последние ${limit}` : ''}
        </span>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {lastNotable ? `${stamp(lastNotable.at)}: ${lastNotable.text}` : ''}
      </div>
      {visible.length === 0 ? (
        <p className="rounded border border-dashed border-line-strong p-3 text-[13px] text-dim">
          {entries.length === 0 ? 'Журнал пуст: запустите симуляцию или выполните команду.' : 'Под фильтр ничего не попало.'}
        </p>
      ) : (
        <ol
          aria-label="Записи журнала"
          aria-live="off"
          tabIndex={0}
          className="m-0 max-h-full min-h-0 list-none overflow-y-auto rounded border border-line bg-well p-0 font-mono text-[12px] leading-5"
        >
          {visible.map((e) => {
            const on = !!e.msg && e.msg === selected;
            const title = e.rule ? ruleTitle?.(e.rule) : undefined;
            return (
              <li key={e.seq} data-kind={e.kind} className={`flex gap-2 border-b border-line/60 px-2 py-0.5 ${on ? 'bg-nav/15' : ''}`} aria-current={on ? 'true' : undefined}>
                <time className="w-16 shrink-0 text-right text-dim">{stamp(e.at)}</time>
                <span className={`w-20 shrink-0 ${TONE[e.kind] ?? 'text-dim'}`}>{e.kind}</span>
                <span className="w-24 shrink-0 truncate text-dim" title={e.actor}>
                  {e.actor}
                </span>
                <span className="min-w-0 flex-1 text-fg">
                  {e.text}
                  {title && (
                    <span className="text-dim" title={e.rule}>
                      {' '}
                      [правило: {title}]
                    </span>
                  )}
                </span>
                {e.msg && (
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={`Показать путь сообщения ${e.msg}`}
                    onClick={() => select(on ? null : (e.msg ?? null))}
                    className={`h-5 shrink-0 rounded border px-1.5 text-[11px] leading-none ${on ? 'border-nav text-[color-mix(in_oklab,var(--nav),var(--fg)_30%)]' : 'border-line-strong text-dim hover:border-faint hover:text-fg'}`}
                  >
                    {e.msg}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
