import { explainPytest } from '@/engine/python/explain';
import type { PytestCase, PytestRun } from '@/engine/python/runtime';
import { Button } from '@/ui/Button';
import { PlayIcon } from '@/ui/icons';
import { EmptyState } from '@/ui/Panel';

interface Props {
  running: boolean;
  run: PytestRun | null;
  error: string | null;
  onRun: () => void;
}

const OUTCOME: Record<PytestCase['outcome'], { text: string; tone: string }> = {
  passed: { text: 'пройден', tone: 'text-ok' },
  failed: { text: 'упал', tone: 'text-err' },
  error: { text: 'ошибка', tone: 'text-err' },
  skipped: { text: 'пропущен', tone: 'text-faint' },
};

/** «Passed 3, failed 1»: the counts as one Russian sentence for the live region. */
export function summaryText(run: PytestRun): string {
  const { passed, failed, error, skipped } = run.counts;
  const total = passed + failed + error + skipped;
  if (total === 0) return 'Тестов не найдено';
  const parts = [`пройдено ${passed} из ${total}`];
  if (failed) parts.push(`упало ${failed}`);
  if (error) parts.push(`с ошибкой ${error}`);
  if (skipped) parts.push(`пропущено ${skipped}`);
  return `Тесты: ${parts.join(', ')}`;
}

/** pytest over the project's tests/: the summary, every case, the crash lines with a hint, the raw output. */
export function TestsPanel({ running, run, error, onRun }: Props) {
  const hint = run ? explainPytest(run) : null;
  const status = running ? 'Тесты выполняются…' : error ? '' : run ? summaryText(run) : '';
  const clean = run !== null && run.exit === 0;
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
        <Button variant="run" icon={<PlayIcon />} onClick={onRun} disabled={running}>
          Запустить тесты
        </Button>
        <p role="status" aria-live="polite" className={`min-w-0 truncate font-mono text-[12.5px] ${running ? 'text-amber' : clean ? 'text-ok' : 'text-dim'}`}>
          {status}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto" aria-busy={running}>
        {error ? (
          <div role="alert" className="p-3 text-[13px]">
            <p className="font-semibold text-err">Тесты не выполнились</p>
            <p className="mt-1 break-words font-mono text-[12px] text-dim">{error}</p>
          </div>
        ) : !run ? (
          <EmptyState>Нажмите «Запустить тесты»: pytest выполнит файлы из папки tests/ против вашего приложения.</EmptyState>
        ) : (
          <>
            {hint && <p className="border-b border-line px-3 py-2 text-[12.5px] text-amber">{hint}</p>}
            <ul aria-label="Тесты">
              {run.tests.map((t) => {
                const advice = explainPytest(t);
                const view = OUTCOME[t.outcome];
                return (
                  <li key={t.nodeid} className="border-b border-line px-3 py-2 text-[13px] last:border-b-0">
                    <p className="flex items-baseline gap-2">
                      <span className={`w-20 shrink-0 font-mono text-[12px] font-semibold ${view.tone}`}>{view.text}</span>
                      <span className="min-w-0 break-all font-mono text-[12.5px] text-fg">{t.nodeid}</span>
                    </p>
                    {t.message && <pre className="mt-1 whitespace-pre-wrap break-words pl-[88px] font-mono text-[12px] text-dim">{t.message}</pre>}
                    {advice && <p className="mt-1 pl-[88px] text-[12.5px] text-amber">{advice}</p>}
                  </li>
                );
              })}
            </ul>
            {run.output.trim() && (
              <details className="border-t border-line px-3 py-2 text-[12.5px]">
                <summary className="cursor-pointer text-dim">Вывод pytest целиком</summary>
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] text-dim">{run.output}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
