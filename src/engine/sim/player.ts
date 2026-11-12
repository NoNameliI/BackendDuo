import type { Sim } from './kernel';
import type { Ms } from './types';

export type Speed = 0.25 | 0.5 | 1 | 2 | 4 | 8 | 16;

export interface Player<S = unknown> {
  state(): { playing: boolean; speed: number; now: Ms };
  play(): void;
  pause(): void;
  stepEvent(): void;
  stepTo(t: Ms): void;
  setSpeed(x: Speed): void;
  seek(t: Ms): void;
  /** Current simulation (replaced on backward seek). */
  sim(): Sim<S>;
  /** Called after every change; returns unsubscribe. */
  subscribe(cb: () => void): () => void;
}

/**
 * `tick(cb)` registers a ticker that calls `cb(dtMs)` with real elapsed milliseconds and returns a cancel
 * function (requestAnimationFrame in the UI, a fake in tests).
 */
export function createPlayer<S>(make: () => Sim<S>, tick: (cb: (dtMs: number) => void) => () => void): Player<S> {
  let sim = make();
  let speed = 1;
  let stop: (() => void) | null = null;
  const subs = new Set<() => void>();
  const emit = (): void => subs.forEach((f) => f());
  const halt = (): void => {
    stop?.();
    stop = null;
  };
  return {
    state: () => ({ playing: stop !== null, speed, now: sim.now }),
    play() {
      if (stop) return;
      stop = tick((dt) => {
        const r = sim.runUntil(sim.now + dt * speed);
        if (r.stoppedBy === 'horizon' || r.stoppedBy === 'maxEvents') halt();
        emit();
      });
      emit();
    },
    pause() {
      halt();
      emit();
    },
    stepEvent() {
      sim.step();
      emit();
    },
    stepTo(t) {
      if (t > sim.now) sim.runUntil(t);
      emit();
    },
    setSpeed(x) {
      speed = x;
      emit();
    },
    seek(t) {
      if (t < sim.now) sim = make();
      sim.runUntil(t);
      emit();
    },
    sim: () => sim,
    subscribe(cb) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
  };
}
