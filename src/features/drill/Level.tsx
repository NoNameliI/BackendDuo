import type { DrillConfig } from '@/content/loadCourse';
import { LEVELS, type Level } from '@/engine/drill/types';

/** Level switch (radio group) with the pack's own captions. */
export function LevelSwitch({ cfg, value, onChange, label = 'Уровень' }: { cfg: DrillConfig; value: Level; onChange: (level: Level) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded border border-line-strong">
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={level === value}
          onClick={() => onChange(level)}
          className={`h-7 px-3 text-[12.5px] font-medium transition ${level === value ? 'bg-raised text-fg' : 'text-dim hover:text-fg'}`}
        >
          {cfg.labels.levels[level]}
        </button>
      ))}
    </div>
  );
}

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
