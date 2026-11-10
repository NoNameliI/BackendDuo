import { useRef, type KeyboardEvent } from 'react';
import type { DrillConfig } from '@/content/loadCourse';
import { LEVELS, type Level } from '@/engine/drill/types';

/** Level switch (radio group) with the pack's own captions. */
export function LevelSwitch({ cfg, value, onChange, label = 'Уровень' }: { cfg: DrillConfig; value: Level; onChange: (level: Level) => void; label?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent) => {
    const at = LEVELS.indexOf(value);
    const target =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % LEVELS.length
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at - 1 + LEVELS.length) % LEVELS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? LEVELS.length - 1
      : -1;
    if (target < 0) return;
    e.preventDefault();
    if (target !== at) onChange(LEVELS[target]);
    refs.current[target]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className="inline-flex overflow-hidden rounded border border-line-strong">
      {LEVELS.map((level, i) => (
        <button
          key={level}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          tabIndex={level === value ? 0 : -1}
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
