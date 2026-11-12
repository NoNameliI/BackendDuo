import { useEffect, useState } from 'react';
import { Button } from '../../ui/Button';

export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16] as const;
export type PlayerSpeed = (typeof SPEEDS)[number];

/** Plain data, the shape of the simulator's player state. */
export interface PlayerView {
  playing: boolean;
  speed: number;
  now: number;
}

interface PlayerControlsProps {
  state: PlayerView;
  /** End of the timeline, ms. */
  durationMs: number;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onSpeed: (x: PlayerSpeed) => void;
  /** Called with a virtual time; going back replays from zero. */
  onSeek: (t: number) => void;
  onRestart: () => void;
  disabled?: boolean;
}

/** True when the system asks for less motion; the lab then shows counters instead of moving dots. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

const speedText = (x: number): string => `${String(x).replace('.', ',')}×`;
const clock = (ms: number): string => `${(ms / 1000).toFixed(1).replace('.', ',')} с`;

export function nextSpeed(cur: number, dir: 1 | -1): PlayerSpeed {
  const i = SPEEDS.findIndex((s) => s >= cur);
  const at = i < 0 ? SPEEDS.length - 1 : i;
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, at + dir))];
}

export function PlayerControls({ state, durationMs, onPlay, onPause, onStep, onSpeed, onSeek, onRestart, disabled }: PlayerControlsProps) {
  const atEnd = state.now >= durationMs;
  return (
    <div role="group" aria-label="Управление симуляцией" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
      <div className="flex items-center gap-1">
        <Button
          variant="run"
          className="!text-[color-mix(in_oklab,var(--nav),var(--fg)_30%)]"
          disabled={disabled}
          aria-keyshortcuts="Space"
          aria-pressed={state.playing}
          onClick={state.playing ? onPause : onPlay}
          icon={<span aria-hidden="true">{state.playing ? '❚❚' : '▶'}</span>}
        >
          {state.playing ? 'Пауза' : atEnd ? 'Заново' : 'Пуск'}
        </Button>
        <Button variant="outline" disabled={disabled || state.playing || atEnd} aria-keyshortcuts="." onClick={onStep} icon={<span aria-hidden="true">⏭</span>}>
          Шаг
        </Button>
        <Button variant="ghost" disabled={disabled} aria-keyshortcuts="Home" onClick={onRestart} icon={<span aria-hidden="true">⏮</span>}>
          В начало
        </Button>
      </div>
      <div role="group" aria-label="Скорость" className="flex items-center gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            aria-pressed={state.speed === s}
            aria-label={`Скорость ${speedText(s)}`}
            onClick={() => onSpeed(s)}
            className={`h-7 min-w-8 rounded border px-1.5 font-mono text-[11px] transition disabled:opacity-40 ${
              state.speed === s ? 'border-nav bg-nav/15 text-[color-mix(in_oklab,var(--nav),var(--fg)_30%)]' : 'border-line-strong text-dim hover:border-faint hover:text-fg'
            }`}
          >
            {speedText(s)}
          </button>
        ))}
        <span className="sr-only">Клавиши: «[» медленнее, «]» быстрее</span>
      </div>
      <label className="flex min-w-40 flex-1 items-center gap-2 text-dim">
        <span className="font-mono text-[12px] whitespace-nowrap text-fg">{clock(state.now)}</span>
        <input
          type="range"
          min={0}
          max={durationMs}
          step={100}
          value={Math.min(state.now, durationMs)}
          disabled={disabled}
          aria-label="Положение на шкале времени"
          aria-valuetext={`${clock(state.now)} из ${clock(durationMs)}`}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="h-1.5 flex-1 accent-(--nav)"
        />
        <span className="font-mono text-[12px] whitespace-nowrap">{clock(durationMs)}</span>
      </label>
    </div>
  );
}
