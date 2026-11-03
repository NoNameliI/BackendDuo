import { useEffect, useRef } from 'react';

/**
 * Screen-by-screen flows replace the focused button with new content; move focus to the new screen's
 * heading so keyboard and screen-reader users continue from the top of it.
 */
export function useFocusHeading<T extends HTMLElement>(screenKey: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const heading = ref.current?.querySelector<HTMLElement>('h1');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus();
  }, [screenKey]);
  return ref;
}
