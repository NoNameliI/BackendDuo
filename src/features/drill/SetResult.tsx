import type { Course, DrillConfig } from '@/content/loadCourse';
import { Button } from '@/ui/Button';
import { useFocusHeading } from '@/ui/useFocusHeading';
import { useDrill } from './drillStore';
import { mmss } from './Level';

export function SetResult({ cfg }: { course: Course; cfg: DrillConfig }) {
  const summary = useDrill((s) => s.summary);
  const { goHome, openNumber, startSet } = useDrill.getState();
  const rootRef = useFocusHeading<HTMLDivElement>('result');
  if (!summary) return null;
  const { result, rows, level } = summary;
  return (
    <div ref={rootRef} className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
          {cfg.labels.modes.full} · {cfg.labels.levels[level]} · {mmss(result.seconds)}
        </p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight">
          {cfg.labels.score}: <span className="text-ok">{result.score}</span> из {result.max}
        </h1>
        <table className="mt-5 w-full border-collapse text-[13.5px]">
          <caption className="sr-only">Ответы набора</caption>
          <thead>
            <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
              <th scope="col" className="py-2 pr-3">
                {cfg.labels.number}
              </th>
              <th scope="col" className="py-2 pr-3">
                Ваш ответ
              </th>
              <th scope="col" className="py-2 pr-3">
                Верный ответ
              </th>
              <th scope="col" className="py-2">
                <span className="sr-only">Разбор</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n} className="border-b border-line/60">
                <th scope="row" className="py-2 pr-3 text-left font-mono font-semibold">
                  {r.n}
                  <span className="sr-only">{r.ok ? ', верно' : ', неверно'}</span>
                </th>
                <td className={`py-2 pr-3 font-mono ${r.ok ? 'text-ok' : 'text-err'}`}>
                  <span aria-hidden="true">{r.ok ? '✓ ' : '✗ '}</span>
                  {r.given.trim() || '—'}
                </td>
                <td className="py-2 pr-3 font-mono">{r.right}</td>
                <td className="py-2 text-right">
                  <Button variant="ghost" aria-label={`Разбор: ${cfg.labels.number} ${r.n}`} onClick={() => openNumber(r.n, { level, seed: r.seed, reveal: true })}>
                    Разбор
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-6 flex gap-2">
          <Button variant="check" onClick={goHome}>
            К списку номеров
          </Button>
          <Button variant="outline" onClick={startSet}>
            Ещё набор
          </Button>
        </div>
      </div>
    </div>
  );
}
