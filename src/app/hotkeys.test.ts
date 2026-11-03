import { describe, expect, it } from 'vitest';
import { matchesHotkey } from './hotkeys';

const key = (init: Partial<KeyboardEvent>) => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
});

describe('matchesHotkey', () => {
  it('requires exact modifiers', () => {
    expect(matchesHotkey(key({ key: 'Enter', ctrlKey: true }), 'Ctrl+Enter')).toBe(true);
    expect(matchesHotkey(key({ key: 'Enter', ctrlKey: true, shiftKey: true }), 'Ctrl+Enter')).toBe(false);
    expect(matchesHotkey(key({ key: 'Enter', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Enter')).toBe(true);
    expect(matchesHotkey(key({ key: 'Enter' }), 'Ctrl+Enter')).toBe(false);
  });

  it('treats Meta as Ctrl', () => {
    expect(matchesHotkey(key({ key: 'Enter', metaKey: true }), 'Ctrl+Enter')).toBe(true);
  });

  it('matches letters by physical key in any layout', () => {
    expect(matchesHotkey(key({ key: 'л', code: 'KeyK', ctrlKey: true }), 'Ctrl+K')).toBe(true);
    expect(matchesHotkey(key({ key: 'k', code: 'KeyJ', ctrlKey: true }), 'Ctrl+K')).toBe(false);
  });

  it('matches named keys with Alt', () => {
    expect(matchesHotkey(key({ key: 'ArrowLeft', altKey: true }), 'Alt+ArrowLeft')).toBe(true);
    expect(matchesHotkey(key({ key: 'ArrowRight', altKey: true }), 'Alt+ArrowLeft')).toBe(false);
  });
});
