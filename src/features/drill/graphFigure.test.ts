import { describe, expect, it } from 'vitest';
import { graphFigure } from './graphFigure';

const body = (lx?: number, ly?: number) =>
  JSON.stringify({
    nodes: [{ label: 'A', x: 30, y: 30 }, { label: 'B', x: 130, y: 30 }],
    edges: [{ a: 'A', b: 'B', w: 12, lx, ly }],
  });

describe('graphFigure', () => {
  it('puts the plate at lx/ly with edge attributes', () => {
    const svg = graphFigure(body(80, 60)) as string;
    expect(svg).toContain('<g data-edge="0">');
    expect(svg).toMatch(/<text x="80" y="60"/);
    expect(svg).toContain('data-audit-graph');
    expect(svg).toContain('data-node="1"');
  });
  it('falls back to the midpoint', () => {
    expect(graphFigure(body()) as string).toMatch(/<text x="80" y="30"/);
  });
  it('viewBox holds every plate and circle', () => {
    const svg = graphFigure(body(80, 90)) as string;
    const [x, y, w, h] = (/viewBox="([^"]+)"/.exec(svg) as RegExpExecArray)[1].split(' ').map(Number);
    expect(x).toBeLessThanOrEqual(14 - 8);
    expect(y + h).toBeGreaterThanOrEqual(90 + 9 + 8);
    expect(x + w).toBeGreaterThanOrEqual(146 + 8);
  });
  it('rejects a body that is not a graph', () => {
    expect(graphFigure('{}')).toBeNull();
  });
});
