import type { JournalEntry } from '@/engine/sim/types';
import type { RuleRegistry } from '@/engine/sim/rules';

const stamp = (ms: number): string => `${(ms / 1000).toFixed(2).replace('.', ',')} с`;

interface ExplainPanelProps {
  /** Message whose path is shown (chosen in the journal or in a queue card). */
  msg: string | null;
  /** Journal entries of that message, in order. */
  path: readonly JournalEntry[];
  /** Lines of the last failed check: the first wrong message and its journal path. */
  trace?: readonly string[];
  rules: RuleRegistry;
  onClear: () => void;
}

/** "Why did this happen": the path of one message with the documentation rule behind each step, and the explanation of a failed check. */
export function ExplainPanel({ msg, path, trace = [], rules, onClear }: ExplainPanelProps) {
  const used = [...new Set(path.map((e) => e.rule).filter((r): r is string => !!r && r in rules))];
  if (!msg && trace.length === 0) return null;
  return (
    <section aria-label="Объяснение" className="max-h-[38%] min-h-0 shrink-0 overflow-y-auto border-t border-line bg-well px-3 py-2 text-[13px]">
      {trace.length > 0 && (
        <div className="mb-2">
          <h3 className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Разбор последней проверки</h3>
          <ul className="list-none space-y-1 p-0">
            {trace.map((line, i) => (
              <li key={i} className="break-words text-fg">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      {msg && (
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Путь сообщения {msg}</h3>
            <button type="button" onClick={onClear} className="ml-auto h-6 rounded border border-line-strong px-2 text-[12px] text-dim hover:border-faint hover:text-fg">
              Скрыть
            </button>
          </div>
          {path.length === 0 ? (
            <p className="text-dim">В журнале нет записей об этом сообщении.</p>
          ) : (
            <ol className="list-none space-y-0.5 p-0 font-mono text-[12px]">
              {path.map((e) => (
                <li key={e.seq} className="flex gap-2">
                  <time className="w-16 shrink-0 text-right text-dim">{stamp(e.at)}</time>
                  <span className="min-w-0 flex-1 break-words text-fg">{e.text}</span>
                </li>
              ))}
            </ol>
          )}
          {used.length > 0 && (
            <dl className="mt-2 space-y-1">
              {used.map((id) => (
                <div key={id}>
                  <dt className="inline font-mono text-[12px] text-amber">{id}</dt>
                  <dd className="ml-2 inline text-dim">
                    {rules[id].ru} ({rules[id].status === 'exact' ? 'как в документации' : 'упрощено'})
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
