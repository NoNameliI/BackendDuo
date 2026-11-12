import { describe, expect, it } from 'vitest';
import { Sim } from './kernel';
import { createPlayer } from './player';
import { createPingPong } from './testModel';

function setup() {
  let cb: ((dt: number) => void) | null = null;
  let cancelled = 0;
  const p = createPlayer(() => new Sim(createPingPong(50), { seed: 9 }), (f) => {
    cb = f;
    return () => {
      cb = null;
      cancelled++;
    };
  });
  return { p, tick: (dt: number) => cb?.(dt), running: () => cb !== null, cancelled: () => cancelled };
}

describe('player', () => {
  it('advances virtual time by dt * speed while playing', () => {
    const { p, tick } = setup();
    p.play();
    tick(100);
    expect(p.state()).toEqual({ playing: true, speed: 1, now: 100 });
    p.setSpeed(4);
    tick(100);
    expect(p.state().now).toBe(500);
    p.pause();
    tick(100);
    expect(p.state()).toMatchObject({ playing: false, now: 500 });
  });
  it('steps one event and steps to a time', () => {
    const { p } = setup();
    p.stepEvent();
    expect(p.sim().journal.entries().length).toBeGreaterThan(0);
    p.stepTo(250);
    expect(p.state().now).toBe(250);
    p.stepTo(100);
    expect(p.state().now).toBe(250);
  });
  it('seek back replays and equals a forward run', () => {
    const { p } = setup();
    p.seek(2000);
    const forward = JSON.stringify(p.sim().journal.entries().filter((e) => e.at <= 1000));
    p.seek(1000);
    expect(p.state().now).toBe(1000);
    expect(JSON.stringify(p.sim().journal.entries())).toBe(forward);
    const direct = new Sim(createPingPong(50), { seed: 9 });
    direct.runUntil(1000);
    expect(JSON.stringify(p.sim().metrics.series())).toBe(JSON.stringify(direct.metrics.series()));
  });
  it('stops playing at the horizon and notifies subscribers', () => {
    let cb: ((dt: number) => void) | null = null;
    const p = createPlayer(() => new Sim(createPingPong(50), { seed: 1, horizonMs: 500 }), (f) => {
      cb = f;
      return () => void (cb = null);
    });
    let calls = 0;
    const off = p.subscribe(() => calls++);
    p.play();
    (cb as ((dt: number) => void) | null)?.(10_000);
    expect(p.state().playing).toBe(false);
    expect(calls).toBeGreaterThan(1);
    off();
  });
});
