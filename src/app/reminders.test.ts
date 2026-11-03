import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform', () => ({ notify: vi.fn(), readStore: vi.fn(), writeStore: vi.fn() }));
vi.mock('@/progress/store', () => ({ useProgress: { getState: () => ({ doc: { activity: {} } }) } }));

const { shouldRemind } = await import('./reminders');

const evening = new Date(2026, 10, 3, 20, 0);
const morning = new Date(2026, 10, 3, 9, 0);
const alive = { current: 4, best: 4, activeToday: false };

describe('shouldRemind', () => {
  const settings = { enabled: true, hour: 19 };

  it('fires in the evening of an inactive day while a streak exists', () => {
    expect(shouldRemind(settings, evening, alive)).toBe(true);
  });

  it('stays quiet otherwise', () => {
    expect(shouldRemind(settings, morning, alive)).toBe(false);
    expect(shouldRemind(settings, evening, { ...alive, activeToday: true })).toBe(false);
    expect(shouldRemind(settings, evening, { ...alive, current: 0 })).toBe(false);
    expect(shouldRemind({ ...settings, enabled: false }, evening, alive)).toBe(false);
    expect(shouldRemind({ ...settings, lastSentDay: '2026-11-03' }, evening, alive)).toBe(false);
  });
});
