/** Moves the boundary between panes `index` and `index + 1` by `delta` percent, keeping both at least `min`. */
export function resizePair(sizes: readonly number[], index: number, delta: number, min: number): number[] {
  const pairTotal = sizes[index] + sizes[index + 1];
  const first = Math.min(Math.max(sizes[index] + delta, min), pairTotal - min);
  const next = sizes.slice();
  next[index] = first;
  next[index + 1] = pairTotal - first;
  return next;
}

export function loadSizes(key: string, fallback: number[]): number[] {
  try {
    const saved = JSON.parse(localStorage.getItem(`pgstudio:layout:${key}`) ?? 'null');
    if (Array.isArray(saved) && saved.length === fallback.length && saved.every((n) => typeof n === 'number')) {
      return saved;
    }
  } catch {
    // ignore malformed or unavailable storage
  }
  return fallback;
}

export function saveSizes(key: string, sizes: number[]): void {
  try {
    localStorage.setItem(`pgstudio:layout:${key}`, JSON.stringify(sizes.map((n) => Math.round(n * 10) / 10)));
  } catch {
    // layout persistence is a convenience only
  }
}
