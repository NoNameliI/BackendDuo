import { escapeHtml } from '@/ui/highlightSql';

type Node = { label: string; x: number; y: number };
type Edge = { a: string; b: string; w: number };

const R = 16;

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
  const pad = R + 14;
  const xs = g.nodes.map((n) => n.x);
  const ys = g.nodes.map((n) => n.y);
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + 2 * pad;
  const h = Math.max(...ys) - Math.min(...ys) + 2 * pad;
  const edges = g.edges.filter((e) => at.has(e.a) && at.has(e.b));
  const label = `Граф. Рёбра: ${edges.map((e) => `${e.a}–${e.b}, вес ${e.w}`).join('; ')}`;
  const lines = edges
    .map((e) => {
      const a = at.get(e.a)!;
      const b = at.get(e.b)!;
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--dim)" stroke-width="1.5"/>`;
    })
    .join('');
  const weights = edges
    .map((e) => {
      const a = at.get(e.a)!;
      const b = at.get(e.b)!;
      return `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2}" text-anchor="middle" dominant-baseline="central" font-size="13" fill="var(--amber)" stroke="var(--bg)" stroke-width="4" paint-order="stroke" style="font-family:var(--font-mono)">${escapeHtml(String(e.w))}</text>`;
    })
    .join('');
  const nodes = g.nodes
    .map(
      (n) =>
        `<circle cx="${n.x}" cy="${n.y}" r="${R}" fill="var(--raised)" stroke="var(--nav)" stroke-width="1.5"/>` +
        `<text x="${n.x}" y="${n.y}" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="600" fill="var(--fg)" style="font-family:var(--font-mono)">${escapeHtml(n.label)}</text>`,
    )
    .join('');
  return `<figure class="my-3"><svg role="img" aria-label="${escapeHtml(label)}" viewBox="${x0} ${y0} ${w} ${h}" width="${w}" style="max-width:100%;height:auto">${lines}${weights}${nodes}</svg></figure>`;
}
