import { useId, useMemo } from 'react';

/** Plain data, the shape of the simulator's metric series (ms, value). */
export interface ChartSeries {
  id: string;
  /** Human name for the legend and the table. */
  label: string;
  points: readonly (readonly [number, number])[];
}

interface MetricChartProps {
  series: readonly ChartSeries[];
  /** Virtual time of the cursor line, ms. */
  now?: number;
  /** Right edge of the time axis; default = last point or `now`. */
  endMs?: number;
  title: string;
  unit?: string;
  width?: number;
  height?: number;
}

const COLORS = ['var(--nav)', 'var(--amber)', 'var(--ok)', 'var(--err)', 'var(--fg)', 'var(--dim)'];
const DASHES = ['', '6 3', '2 3', '10 3 2 3', '', '6 3'];
const PAD = { l: 44, r: 12, t: 10, b: 24 };
/** Never draw more than this many vertices per series. */
export const MAX_POINTS = 600;

/** Min/max per pixel column keeps spikes visible; ≤ `columns` * 2 points come out. */
export function reduceSeries(points: readonly (readonly [number, number])[], columns: number, t0: number, t1: number): [number, number][] {
  if (points.length <= columns * 2) return points.map(([t, v]) => [t, v]);
  const span = Math.max(1, t1 - t0);
  const out: [number, number][] = [];
  let col = -1;
  let lo: [number, number] | null = null;
  let hi: [number, number] | null = null;
  const flush = () => {
    if (!lo || !hi) return;
    const pair = lo[0] <= hi[0] ? [lo, hi] : [hi, lo];
    out.push(pair[0]);
    if (pair[1] !== pair[0]) out.push(pair[1]);
  };
  for (const [t, v] of points) {
    const c = Math.min(columns - 1, Math.max(0, Math.floor(((t - t0) / span) * columns)));
    if (c !== col) {
      flush();
      col = c;
      lo = [t, v];
      hi = [t, v];
    } else {
      if (v < lo![1]) lo = [t, v];
      if (v > hi![1]) hi = [t, v];
    }
  }
  flush();
  return out;
}

/** Round axis step: 1, 2 or 5 times a power of ten. */
export function niceStep(range: number, ticks: number): number {
  const raw = Math.max(range, 1e-9) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

/** Value axis for the data maximum: ticks from 0 to `top` inclusive, all inside the plot box. */
export function valueAxis(max: number): { step: number; top: number; ticks: number[] } {
  // An all-zero series still gets a readable 0..1 axis instead of nano-sized ticks.
  const step = max > 0 ? niceStep(max, 4) : 1;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let k = 0; k * step <= top * (1 + 1e-9); k++) ticks.push(k * step);
  return { step, top, ticks };
}

const fmtTime =(ms: number): string => (ms >= 1000 ? `${+(ms / 1000).toFixed(1)} с` : `${Math.round(ms)} мс`);
const fmtNum = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace('.', ',');

function lastAt(points: readonly (readonly [number, number])[], t: number): number | null {
  let v: number | null = null;
  for (const p of points) {
    if (p[0] > t) break;
    v = p[1];
  }
  return v;
}

export function MetricChart({ series, now, endMs, title, unit = '', width = 520, height = 170 }: MetricChartProps) {
  const uid = useId();
  const model = useMemo(() => {
    let end = endMs ?? 0;
    let max = 0;
    for (const s of series) {
      for (const p of s.points) {
        if (endMs === undefined && p[0] > end) end = p[0];
        if (p[1] > max) max = p[1];
      }
    }
    if (endMs === undefined && now !== undefined && now > end) end = now;
    end = Math.max(end, 1000);
    return { end, ...valueAxis(max) };
  }, [series, now, endMs]);

  const iw = width - PAD.l - PAD.r;
  const ih = height - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + (t / model.end) * iw;
  const y = (v: number) => PAD.t + ih - (v / model.top) * ih;
  const yTicks = model.ticks;
  const tStep = niceStep(model.end, 5);
  const xTicks: number[] = [];
  for (let t = 0; t <= model.end + 1e-9; t += tStep) xTicks.push(t);

  const cursor = now === undefined ? model.end : Math.min(now, model.end);
  const empty = series.every((s) => s.points.length === 0);
  const titleId = `${uid}-t`;

  return (
    <figure className="m-0 flex flex-col gap-1.5 text-fg">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId} className="block h-auto w-full max-w-full">
        <title id={titleId}>{`${title}. ${series.map((s) => `${s.label}: ${fmtNum(lastAt(s.points, cursor) ?? 0)}${unit ? ` ${unit}` : ''}`).join('; ')}`}</title>
        <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="var(--well)" />
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--dim)" className="font-mono">
              {fmtNum(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={x(t)} x2={x(t)} y1={PAD.t + ih} y2={PAD.t + ih + 4} stroke="var(--line-strong)" strokeWidth={1} />
            <text x={x(t)} y={height - 6} textAnchor={t === 0 ? 'start' : x(t) + (fmtTime(t).length * 7) / 2 > width - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--dim)" className="font-mono">
              {fmtTime(t)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + ih} stroke="var(--line-strong)" strokeWidth={1} />
        <line x1={PAD.l} x2={PAD.l + iw} y1={PAD.t + ih} y2={PAD.t + ih} stroke="var(--line-strong)" strokeWidth={1} />
        {series.map((s, i) => {
          const pts = reduceSeries(s.points, Math.min(MAX_POINTS / 2, Math.floor(iw)), 0, model.end);
          if (pts.length === 0) return null;
          const d = pts.map(([t, v], k) => `${k === 0 ? 'M' : 'L'}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
          return (
            <path key={s.id} d={d} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={1.75} strokeDasharray={DASHES[i % DASHES.length]} strokeLinejoin="round" data-series={s.id} />
          );
        })}
        {now !== undefined && <line x1={x(cursor)} x2={x(cursor)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--fg)" strokeWidth={1} strokeDasharray="2 2" opacity={0.7} data-cursor />}
        {empty && (
          <text x={PAD.l + iw / 2} y={PAD.t + ih / 2} textAnchor="middle" fontSize={12} fill="var(--dim)">
            Данных пока нет
          </text>
        )}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-dim">
        <span className="text-fg">{title}</span>
        {series.map((s, i) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <svg width={22} height={8} aria-hidden="true">
              <line x1={0} x2={22} y1={4} y2={4} stroke={COLORS[i % COLORS.length]} strokeWidth={2} strokeDasharray={DASHES[i % DASHES.length]} />
            </svg>
            {s.label}
          </span>
        ))}
      </figcaption>
      <table className="sr-only">
        <caption>{`${title}: значения в момент ${fmtTime(cursor)}`}</caption>
        <thead>
          <tr>
            <th scope="col">Ряд</th>
            <th scope="col">Значение{unit ? `, ${unit}` : ''}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.label}</th>
              <td>{lastAt(s.points, cursor) === null ? 'нет данных' : fmtNum(lastAt(s.points, cursor)!)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
