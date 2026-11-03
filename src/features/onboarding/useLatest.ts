import { useCallback, useRef, useState } from 'react';

/** State whose latest value is readable synchronously (hotkeys may fire before the next render). */
export function useLatestState<T>(initial: T): [T, (value: T) => void, () => T] {
  const [value, setValue] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  const get = useCallback(() => ref.current, []);
  return [value, set, get];
}
