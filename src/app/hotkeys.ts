import { useEffect, useRef } from 'react';

type KeyInfo = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/**
 * Matches combos like "Ctrl+Shift+Enter", "Alt+ArrowLeft", "Ctrl+K".
 * Letters and digits are compared by physical key code so shortcuts work in any keyboard layout.
 */
export function matchesHotkey(e: KeyInfo, combo: string): boolean {
  const parts = combo.split('+');
  const key = parts.pop()!;
  const ctrl = parts.includes('Ctrl');
  const shift = parts.includes('Shift');
  const alt = parts.includes('Alt');
  if ((e.ctrlKey || e.metaKey) !== ctrl || e.shiftKey !== shift || e.altKey !== alt) return false;
  if (/^[A-Z]$/.test(key)) return e.code === `Key${key}`;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}`;
  return e.key === key;
}

export type HotkeyMap = Record<string, () => void>;

interface HotkeyOptions {
  /** Keep working while a modal dialog (e.g. the command palette) is open. */
  inModal?: boolean;
}

/** Window-level shortcuts handled in the capture phase, so they win over focused widgets such as the editor. */
export function useHotkeys(bindings: HotkeyMap, options: HotkeyOptions = {}): void {
  const ref = useRef(bindings);
  ref.current = bindings;
  const inModal = options.inModal ?? false;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!inModal && document.querySelector('[aria-modal="true"]')) return;
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable="true"]');
      for (const [combo, handler] of Object.entries(ref.current)) {
        if (typing && !combo.includes('+')) continue;
        if (matchesHotkey(e, combo)) {
          e.preventDefault();
          e.stopPropagation();
          handler();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [inModal]);
}
