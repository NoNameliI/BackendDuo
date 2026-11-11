import { labelSize, NODE_R } from '@/engine/drill/gen/shared/graphLayout';
import { escapeHtml } from '@/ui/highlightSql';

type Node = { label: string; x: number; y: number };
type Edge = { a: string; b: string; w: number; lx?: number; ly?: number };

const R = NODE_R;

function parse(body: string): { nodes: Node[]; edges: Edge[] } | null {
  try {
    const v = JSON.parse(body) as { nodes?: Node[]; edges?: Edge[] };
    if (!Array.isArray(v.nodes) || !Array.isArray(v.edges)) return null;
    const ok = v.nodes.every((n) => typeof n.label === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y));
    return ok && v.edges.every((e) => typeof e.a === 'string' && typeof e.b === 'string') ? { nodes: v.nodes, edges: v.edges } : null;
  } catch {
    return null;
  }
}

/** Inline SVG of a weighted graph from the JSON of a `graph` fence; null when the body is not such a graph. */
export function graphFigure(body: string): string | null {
  const g = parse(body);
  if (!g || g.nodes.length === 0) return null;
  const at = new Map(g.nodes.map((n) => [n.label, n]));
  const edges = g.edges.filter((e) => at.has(e.a) && at.has(e.b));
  const label = `Граф. Рёбра: ${edges.map((e) => `${e.a}–${e.b}, вес ${e.w}`).join('; ')}`;
  const lines = edges
    .map((e, i) => {
      const a = at.get(e.a)!;
      const b = at.get(e.b)!;
      return `<line data-edge="${i}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--dim)" stroke-width="1.5"/>`;
    })
    .join('');
  // Weight plates: at the layout's (lx, ly) or, without it, at the middle of the edge.
  const plates = edges.map((e) => {
    const a = at.get(e.a)!;
    const b = at.get(e.b)!;
    const text = String(e.w);
    const cx = Number.isFinite(e.lx) ? (e.lx as number) : (a.x + b.x) / 2;
    const cy = Number.isFinite(e.ly) ? (e.ly as number) : (a.y + b.y) / 2;
    const { w, h } = labelSize(text);
    return { text, cx, cy, w, h };
  });
  const weights = plates
    .map(
      (p, i) =>
        `<g data-edge="${i}"><rect x="${p.cx - p.w / 2}" y="${p.cy - p.h / 2}" width="${p.w}" height="${p.h}" rx="4" fill="var(--raised)" stroke="var(--amber)" stroke-opacity="0.55"/>` +
        `<text x="${p.cx}" y="${p.cy}" text-anchor="middle" dominant-baseline="central" font-size="13" fill="var(--amber)" style="font-family:var(--font-mono)">${escapeHtml(p.text)}</text></g>`,
    )
    .join('');
  const xs = [...g.nodes.flatMap((n) => [n.x - R, n.x + R]), ...plates.flatMap((p) => [p.cx - p.w / 2, p.cx + p.w / 2])];
  const ys = [...g.nodes.flatMap((n) => [n.y - R, n.y + R]), ...plates.flatMap((p) => [p.cy - p.h / 2, p.cy + p.h / 2])];
  const x0 = Math.min(...xs) - 8;
  const y0 = Math.min(...ys) - 8;
  const w = Math.max(...xs) - Math.min(...xs) + 16;
  const h = Math.max(...ys) - Math.min(...ys) + 16;
  const nodes = g.nodes
    .map(
      (n, i) =>
        `<circle data-node="${i}" cx="${n.x}" cy="${n.y}" r="${R}" fill="var(--raised)" stroke="var(--nav)" stroke-width="1.5"/>` +
        `<text data-node="${i}" x="${n.x}" y="${n.y}" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="600" fill="var(--fg)" style="font-family:var(--font-mono)">${escapeHtml(n.label)}</text>`,
    )
    .join('');
  return `<figure class="my-3"><svg data-audit-graph role="img" aria-label="${escapeHtml(label)}" viewBox="${x0} ${y0} ${w} ${h}" width="${w}" style="max-width:100%;height:auto">${lines}${weights}${nodes}</svg></figure>`;
}
