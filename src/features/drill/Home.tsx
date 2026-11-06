import { useEffect, useMemo, useState } from 'react';
import type { Course, DrillConfig } from '@/content/loadCourse';
import { LEVELS } from '@/engine/drill/types';
import { numberAccuracy, weakNumbers } from '@/progress/drill';
import { selectCourse, useProgress } from '@/progress/store';
import { Button } from '@/ui/Button';
import { ProgressBar } from '@/ui/ProgressBar';
import { useFocusHeading } from '@/ui/useFocusHeading';
import { lessonOfNumber, remainingSeconds, useDrill } from './drillStore';
import { LevelSwitch, mmss } from './Level';

export function Home({ course, cfg }: { course: Course; cfg: DrillConfig }) {
  const cp = useProgress(selectCourse(course.id));
  const level = useDrill((s) => s.level);
  const saved = useDrill((s) => s.saved);
  const weakDone = useDrill((s) => s.weakDone);
  const { setLevel, openNumber, startSet, startWeak, resumeSet, discardSet } = useDrill.getState();
  const rootRef = useFocusHeading<HTMLDivElement>('home');
  const ns = useMemo(() => cfg.numbers.map((x) => x.n), [cfg]);
  const weak = useMemo(() => weakNumbers(cp.drill, ns), [cp.drill, ns]);
  const sets = (cp.drill?.sets ?? []).slice(-5).reverse();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!saved) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [saved]);
  const left = saved ? remainingSeconds(saved.startedAt, cfg.set.minutes, now) : 0;

  return (
    <div ref={rootRef} className="h-full overflow-auto">
      <div className="mx-auto max-w-[1100px] px-6 py-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Тренажёр</p>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">{course.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <LevelSwitch cfg={cfg} value={level} onChange={setLevel} />
            <span className="font-mono text-[12px] text-faint">{cp.drill?.xp ?? 0} XP</span>
          </div>
        </header>

        {saved && (
          <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber/40 bg-amber/10 px-4 py-2.5 text-[13.5px]">
            <span>
              {left > 0 ? `${cfg.labels.modes.full} не завершён: осталось ${mmss(left)}.` : `${cfg.labels.modes.full}: время вышло.`}
            </span>
            <Button variant="check" onClick={resumeSet}>
              {left > 0 ? 'Продолжить' : 'Показать итог'}
            </Button>
            <Button variant="outline" onClick={discardSet}>
              Отказаться
            </Button>
          </div>
        )}

        <section aria-label="Режимы" className="mb-6 flex flex-wrap items-center gap-3">
          <Button variant="check" onClick={startSet}>
            {cfg.labels.modes.full}: {cfg.set.minutes} мин · {cfg.labels.levels[level]}
          </Button>
          <Button variant="outline" disabled={weak.length === 0} onClick={() => startWeak()}>
            {cfg.labels.modes.weak}
            {weak.length > 0 ? ` (${weak.length})` : ''}
          </Button>
          <span className="text-[12.5px] text-faint">
            {weak.length === 0
              ? weakDone
                ? 'Все слабые места проработаны.'
                : 'Слабых мест пока нет: они появятся после нескольких ответов.'
              : '«' + cfg.labels.modes.weak + '» берёт номера с низкой точностью, уровень «' + cfg.labels.levels.core + '».'}
          </span>
        </section>

        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">{cfg.labels.modes.pick}</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ns.map((n) => {
            const stat = cp.drill?.numbers[String(n)];
            const accuracy = numberAccuracy(stat);
            const isWeak = weak.includes(n);
            const title = lessonOfNumber(course, n)?.title ?? '';
            return (
              <li key={n}>
                <button
                  type="button"
                  onClick={() => openNumber(n)}
                  aria-label={`${cfg.labels.number} ${n}: ${title}. Решено ${stat?.correct ?? 0} из ${stat?.seen ?? 0}${isWeak ? '. Слабое место' : ''}`}
                  className="flex h-full w-full flex-col gap-2 rounded-md border border-line bg-panel p-3.5 text-left transition hover:border-line-strong hover:bg-raised"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[15px] font-semibold">
                      {cfg.labels.number} {n}
                    </span>
                    {isWeak && <span aria-hidden="true" title="Слабое место" className="h-2 w-2 rounded-full bg-amber" />}
                    <span className="ml-auto font-mono text-[11.5px] text-faint">{stat ? `${stat.correct}/${stat.seen}` : '—'}</span>
                  </span>
                  <span className="line-clamp-2 min-h-[2.5em] text-[13px] text-dim">{title}</span>
                  <ProgressBar value={accuracy} label={`Точность: ${Math.round(accuracy * 100)}%`} tone={isWeak ? 'amber' : 'ok'} />
                  <span className="flex gap-3 font-mono text-[11px] text-faint">
                    {LEVELS.map((l) => (
                      <span key={l} title={cfg.labels.levels[l]}>
                        {cfg.labels.levels[l].slice(0, 1)} {stat?.levels[l] ? `${stat.levels[l]![0]}/${stat.levels[l]![1]}` : '·'}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {sets.length > 0 && (
          <section aria-label="Последние наборы" className="mt-8">
            <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">{cfg.labels.modes.full}: последние</h2>
            <ul className="divide-y divide-line rounded-md border border-line bg-panel text-[13.5px]">
              {sets.map((r) => (
                <li key={r.at} className="flex flex-wrap items-center gap-4 px-4 py-2">
                  <span className="font-mono text-faint">{new Date(r.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                  <span>
                    {cfg.labels.score}: <span className="font-mono font-semibold text-ok">{r.score}</span>/{r.max}
                  </span>
                  <span className="text-dim">{cfg.labels.levels[r.level]}</span>
                  <span className="ml-auto font-mono text-faint">{mmss(r.seconds)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
