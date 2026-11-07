import type { Brute } from '../types';
import type { P01 } from './g01';

/** Every bijection points -> letters that keeps all roads and non-roads; collect the asked value for each. */
export const brute: Brute<P01> = (p) => {
  const n = p.n;
  const w: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (const e of p.edges) w[e.a][e.b] = w[e.b][e.a] = e.w;

  const dist = w.map((row, i) => row.map((x, j) => (i === j ? 0 : x > 0 ? x : Infinity)));
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (dist[i][k] + dist[k][j] < dist[i][j]) dist[i][j] = dist[i][k] + dist[k][j];

  const found = new Set<number>();
  const map: number[] = [];
  const taken = Array<boolean>(n).fill(false);
  const place = (i: number) => {
    if (i === n) {
      const a = map[p.p];
      const b = map[p.q];
      found.add(p.shape === 'edge' ? w[a][b] : dist[a][b]);
      return;
    }
    for (let l = 0; l < n; l++) {
      if (taken[l]) continue;
      let ok = true;
      for (let j = 0; j < i && ok; j++) if (p.table[i][j] !== w[l][map[j]] > 0) ok = false;
      if (!ok) continue;
      taken[l] = true;
      map[i] = l;
      place(i + 1);
      taken[l] = false;
    }
  };
  place(0);
  return [...found].filter((x) => Number.isFinite(x) && x > 0).sort((x, y) => x - y).map(String);
};
