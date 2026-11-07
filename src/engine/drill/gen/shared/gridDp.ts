/** Dynamic programming over a rectangular grid: monotone walks between opposite corners. Pure. */

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
/** null = blocked cell. */
export type Grid = (number | null)[][];
export type Extremes = { max: number; min: number };

/** Mirror the grid so that a walk starting at `start` becomes a walk from the top-left corner going right/down. */
export function orient(grid: Grid, start: Corner, via?: [number, number]): { grid: Grid; via?: [number, number] } {
  const h = grid.length;
  const w = grid[0].length;
  const flipRows = start === 'bl' || start === 'br';
  const flipCols = start === 'tr' || start === 'br';
  const out = grid.map((_, r) => grid[flipRows ? h - 1 - r : r].map((_, c) => grid[flipRows ? h - 1 - r : r][flipCols ? w - 1 - c : c]));
  return { grid: out, via: via ? [flipRows ? h - 1 - via[0] : via[0], flipCols ? w - 1 - via[1] : via[1]] : undefined };
}

/** Best and worst totals of right/down walks from (0,0) to the last cell, through `via` when given. null: no walk. */
export function walkExtremes(grid: Grid, via?: [number, number]): Extremes | null {
  const h = grid.length;
  const w = grid[0].length;
  const fmax: number[][] = [];
  const fmin: number[][] = [];
  for (let r = 0; r < h; r++) {
    fmax.push(new Array<number>(w).fill(-Infinity));
    fmin.push(new Array<number>(w).fill(Infinity));
    for (let c = 0; c < w; c++) {
      const v = grid[r][c];
      if (v === null) continue;
      if (r === 0 && c === 0) {
        fmax[r][c] = fmin[r][c] = v;
        continue;
      }
      const up = r > 0 ? fmax[r - 1][c] : -Infinity;
      const left = c > 0 ? fmax[r][c - 1] : -Infinity;
      const upMin = r > 0 ? fmin[r - 1][c] : Infinity;
      const leftMin = c > 0 ? fmin[r][c - 1] : Infinity;
      if (Math.max(up, left) === -Infinity) continue;
      fmax[r][c] = Math.max(up, left) + v;
      fmin[r][c] = Math.min(upMin, leftMin) + v;
    }
  }
  if (!via) {
    const mx = fmax[h - 1][w - 1];
    return mx === -Infinity ? null : { max: mx, min: fmin[h - 1][w - 1] };
  }
  // Backward pass: best/worst totals of cells after (r,c), excluding (r,c).
  const bmax: number[][] = Array.from({ length: h }, () => new Array<number>(w).fill(-Infinity));
  const bmin: number[][] = Array.from({ length: h }, () => new Array<number>(w).fill(Infinity));
  for (let r = h - 1; r >= 0; r--) {
    for (let c = w - 1; c >= 0; c--) {
      const v = grid[r][c];
      if (v === null) continue;
      if (r === h - 1 && c === w - 1) {
        bmax[r][c] = bmin[r][c] = 0;
        continue;
      }
      let best = -Infinity;
      let worst = Infinity;
      for (const [nr, nc] of [[r + 1, c], [r, c + 1]]) {
        if (nr >= h || nc >= w || grid[nr][nc] === null || bmax[nr][nc] === -Infinity) continue;
        best = Math.max(best, bmax[nr][nc] + (grid[nr][nc] as number));
        worst = Math.min(worst, bmin[nr][nc] + (grid[nr][nc] as number));
      }
      bmax[r][c] = best;
      bmin[r][c] = worst;
    }
  }
  const [vr, vc] = via;
  if (fmax[vr][vc] === -Infinity || bmax[vr][vc] === -Infinity) return null;
  return { max: fmax[vr][vc] + bmax[vr][vc], min: fmin[vr][vc] + bmin[vr][vc] };
}
