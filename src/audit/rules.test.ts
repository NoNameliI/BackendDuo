import { describe, expect, it } from 'vitest';
import { contrastRatio, over, parseCssColor, requiredRatio } from './contrast';
import {
  contrastLow,
  coreBox,
  dedupeKey,
  edgeThroughNode,
  edgesOverlap,
  evaluate,
  isClipped,
  isRenderError,
  isWrapToken,
  labelOnCrossing,
  labelOwned,
  nodesOverlap,
  outsideContainer,
  outsideWindow,
  textOverLine,
  textOverNode,
  type Graph,
  type Hit,
  type Snapshot,
  type TextItem,
} from './rules';

const seg = (x1: number, y1: number, x2: number, y2: number) => ({ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });
const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

const base = { allow: '', container: null, clipX: false };
const text = (id: number, b: ReturnType<typeof box>, extra: Partial<TextItem> = {}): TextItem => ({
  ...base,
  where: `p${id}`,
  box: b,
  id,
  boxes: [coreBox(b)],
  kind: 'html',
  positioned: false,
  size: 14,
  bold: false,
  inside: [],
  area: 'md',
  secondary: false,
  colors: null,
  wrapped: null,
  renderError: false,
  ...extra,
});
const empty = (): Snapshot => ({ innerWidth: 1000, scrollWidth: 1000, texts: [], solids: [], graphs: [], elems: [] });
const rules = (hits: Hit[]) => hits.map((h) => h.rule);

describe('text rules', () => {
  it('text-overlap: html cores intersecting vs inline neighbours', () => {
    const hit = evaluate({ ...empty(), texts: [text(0, box(0, 0, 50, 20)), text(1, box(30, 5, 50, 20))] });
    expect(rules(hit)).toContain('text-overlap');
    const adjacent = evaluate({ ...empty(), texts: [text(0, box(0, 0, 50, 20)), text(1, box(50, 0, 50, 20))] });
    expect(rules(adjacent)).not.toContain('text-overlap');
    const lines = evaluate({ ...empty(), texts: [text(0, box(0, 0, 50, 20)), text(1, box(0, 20, 50, 20))] });
    expect(rules(lines)).not.toContain('text-overlap');
  });

  it('text-overlap: positioned and svg text need a 2 px margin', () => {
    const svg = (id: number, x: number) => text(id, box(x, 0, 20, 14), { kind: 'svg' });
    expect(rules(evaluate({ ...empty(), texts: [svg(0, 0), svg(1, 21)] }))).toContain('text-overlap');
    expect(rules(evaluate({ ...empty(), texts: [svg(0, 0), svg(1, 23)] }))).not.toContain('text-overlap');
  });

  it('text-over-element: a foreign solid meets the core box, an ancestor does not', () => {
    const t = text(0, box(0, 0, 50, 20));
    const solid = { ...base, id: 7, where: 'button', box: box(30, 0, 40, 20) };
    expect(rules(evaluate({ ...empty(), texts: [t], solids: [solid] }))).toContain('text-over-element');
    expect(rules(evaluate({ ...empty(), texts: [{ ...t, inside: [7] }], solids: [solid] }))).not.toContain('text-over-element');
    expect(rules(evaluate({ ...empty(), texts: [t], solids: [{ ...solid, box: box(49.5, 0, 40, 20) }] }))).not.toContain('text-over-element');
  });

  it('overflow-container and overflow-window', () => {
    const c = { box: box(0, 0, 100, 40), x: true, y: false };
    expect(outsideContainer(box(10, 5, 95, 10), c)).toBe(true);
    expect(outsideContainer(box(10, 5, 90.5, 10), c)).toBe(false);
    expect(outsideContainer(box(10, 100, 50, 10), c)).toBe(false); // vertical axis scrolls
    expect(outsideWindow(box(950, 0, 60, 10), 1000)).toBe(true);
    expect(outsideWindow(box(940, 0, 60, 10), 1000)).toBe(false);
    expect(rules(evaluate({ ...empty(), texts: [text(0, box(990, 0, 40, 10))] }))).toContain('overflow-window');
    expect(rules(evaluate({ ...empty(), texts: [text(0, box(990, 0, 40, 10), { clipX: true })] }))).not.toContain('overflow-window');
  });

  it('clipped-text', () => {
    expect(isClipped({ scrollW: 120, clientW: 100, scrollH: 20, clientH: 20 })).toBe(true);
    expect(isClipped({ scrollW: 101, clientW: 100, scrollH: 20, clientH: 20 })).toBe(false);
    const el = { where: 'span.truncate', box: box(0, 0, 100, 20), allow: '', clip: { scrollW: 150, clientW: 100, scrollH: 20, clientH: 20 } };
    expect(rules(evaluate({ ...empty(), elems: [el] }))).toContain('clipped-text');
  });

  it('bad-wrap severity: critical in cells and code, minor in prose', () => {
    expect(isWrapToken('12,5')).toBe(true);
    expect(isWrapToken('a')).toBe(false);
    expect(isWrapToken('two words')).toBe(false);
    const sev = (wrapped: TextItem['wrapped']) => evaluate({ ...empty(), texts: [text(0, box(0, 0, 50, 20), { wrapped })] }).find((h) => h.rule === 'bad-wrap')?.severity;
    expect(sev('cell')).toBe('critical');
    expect(sev('code')).toBe('critical');
    expect(sev('text')).toBe('minor');
    expect(sev(null)).toBeUndefined();
  });

  it('scroll-x-page and scroll-x-element', () => {
    expect(rules(evaluate({ ...empty(), scrollWidth: 1001 }))).toContain('scroll-x-page');
    expect(rules(evaluate(empty()))).not.toContain('scroll-x-page');
    const el = (minor: boolean, scrollW: number) => ({ where: 'pre.md-code', box: box(0, 0, 100, 20), allow: '', scrollX: { scrollW, clientW: 100, minor } });
    expect(evaluate({ ...empty(), elems: [el(true, 200)] })[0].severity).toBe('minor');
    expect(evaluate({ ...empty(), elems: [el(false, 200)] })[0].severity).toBe('critical');
    expect(evaluate({ ...empty(), elems: [el(false, 100.5)] })).toEqual([]);
  });

  it('font-small below 11 px', () => {
    expect(rules(evaluate({ ...empty(), texts: [text(0, box(0, 0, 50, 20), { size: 10.9 })] }))).toContain('font-small');
    expect(rules(evaluate({ ...empty(), texts: [text(0, box(0, 0, 50, 20), { size: 11 })] }))).not.toContain('font-small');
  });

  it('contrast: 4.49 fails, 4.5 passes; large text needs 3; chrome and secondary are minor', () => {
    expect(contrastLow(4.49, 14, false)).toBe(true);
    expect(contrastLow(4.5, 14, false)).toBe(false);
    expect(contrastLow(3.1, 24, false)).toBe(false);
    expect(contrastLow(2.9, 19, true)).toBe(true);
    expect(requiredRatio(19, true)).toBe(3);
    const grey = { fg: { r: 150, g: 150, b: 150, a: 1 }, bg: { r: 255, g: 255, b: 255, a: 1 } };
    const sev = (extra: Partial<TextItem>) => evaluate({ ...empty(), texts: [text(0, box(0, 0, 50, 20), { colors: grey, ...extra })] }).find((h) => h.rule === 'contrast')?.severity;
    expect(sev({})).toBe('critical');
    expect(sev({ area: 'chrome' })).toBe('minor');
    expect(sev({ secondary: true })).toBe('minor');
    expect(sev({ colors: { fg: { r: 0, g: 0, b: 0, a: 1 }, bg: grey.bg } })).toBeUndefined();
  });

  it('empty-data and render-error', () => {
    expect(rules(evaluate({ ...empty(), elems: [{ where: 'div.md', box: box(0, 0, 10, 10), allow: '', empty: 'statement' }] }))).toContain('empty-data');
    expect(rules(evaluate({ ...empty(), texts: [text(0, box(0, 0, 50, 20), { renderError: true })] }))).toContain('render-error');
    expect(isRenderError('Ошибка шаблона: x')).toBe(true);
    expect(isRenderError('значение {{a}}')).toBe(true);
    expect(isRenderError('NaN')).toBe(true);
    expect(isRenderError('Banana, undefined')).toBe(true);
    expect(isRenderError('[object Object]')).toBe(true);
    expect(isRenderError('Banana 5')).toBe(false);
  });

  it('data-audit-allow switches a rule off', () => {
    const t = text(0, box(990, 0, 40, 10), { allow: 'overflow-window font-small' });
    expect(evaluate({ ...empty(), texts: [t] })).toEqual([]);
  });
});

describe('graph rules', () => {
  it('text-over-line and text-over-node', () => {
    const label = box(40, 40, 20, 16);
    expect(textOverLine(label, seg(0, 48, 100, 48), 1.5)).toBe(true);
    expect(textOverLine(label, seg(0, 58, 100, 58), 1.5)).toBe(false); // 2 px away, limit 1.75
    expect(textOverLine(label, seg(0, 57.5, 100, 57.5), 1.5)).toBe(true);
    expect(textOverNode(label, { x: 70, y: 48 }, 16)).toBe(true);
    expect(textOverNode(label, { x: 80, y: 48 }, 16)).toBe(false);
  });

  it('label-ownership: nearest own line, middle of it', () => {
    const own = seg(0, 0, 100, 0);
    expect(labelOwned({ x: 50, y: 0 }, own, [seg(0, 50, 100, 50)])).toBe(true);
    expect(labelOwned({ x: 50, y: 20 }, own, [seg(0, 24, 100, 24)])).toBe(false); // other line as close
    expect(labelOwned({ x: 10, y: 0 }, own, [seg(0, 50, 100, 50)])).toBe(false); // too near an end
  });

  it('label-on-crossing', () => {
    const segs = [seg(0, 0, 100, 100), seg(0, 100, 100, 0)];
    expect(labelOnCrossing(box(40, 40, 20, 16), segs)).not.toBeNull();
    expect(labelOnCrossing(box(0, 40, 20, 16), segs)).toBeNull();
  });

  it('edge-through-node, node-overlap', () => {
    expect(edgeThroughNode({ x: 50, y: 18 }, 16, seg(0, 0, 100, 0))).toBe(true);
    expect(edgeThroughNode({ x: 50, y: 20 }, 16, seg(0, 0, 100, 0))).toBe(false);
    expect(nodesOverlap({ i: 0, c: { x: 0, y: 0 }, r: 16 }, { i: 1, c: { x: 35, y: 0 }, r: 16 })).toBe(true);
    expect(nodesOverlap({ i: 0, c: { x: 0, y: 0 }, r: 16 }, { i: 1, c: { x: 36, y: 0 }, r: 16 })).toBe(false);
  });

  it('edges-overlap: collinear, incident and crossing-at-an-angle edges', () => {
    expect(edgesOverlap(seg(0, 0, 100, 0), seg(20, 3, 90, 3), false)).toBe(true);
    expect(edgesOverlap(seg(0, 0, 100, 0), seg(20, 30, 90, 30), false)).toBe(false);
    expect(edgesOverlap(seg(0, 0, 100, 0), seg(120, 3, 200, 3), false)).toBe(false); // no projected overlap
    expect(edgesOverlap(seg(0, 0, 100, 0), seg(0, 0, 100, 10), true)).toBe(true); // 5.7° apart
    expect(edgesOverlap(seg(0, 0, 100, 0), seg(0, 0, 100, 30), true)).toBe(false);
  });

  it('edges-concurrent: three edges through one point, the hexagon diagonals', () => {
    const hex: Graph = {
      where: 'svg',
      allow: '',
      nodes: [0, 1, 2, 3, 4, 5].map((i) => ({ i, c: { x: 100 + 80 * Math.cos((i * Math.PI) / 3), y: 100 + 80 * Math.sin((i * Math.PI) / 3) }, r: 16 })),
      edges: [0, 1, 2].map((i) => ({ i, seg: { a: { x: 100 + 80 * Math.cos((i * Math.PI) / 3), y: 100 + 80 * Math.sin((i * Math.PI) / 3) }, b: { x: 100 - 80 * Math.cos((i * Math.PI) / 3), y: 100 - 80 * Math.sin((i * Math.PI) / 3) } }, stroke: 1.5, a: i, b: i + 3 })),
      labels: [],
    };
    expect(rules(evaluate({ ...empty(), graphs: [hex] }))).toContain('edges-concurrent');
    const two = { ...hex, edges: hex.edges.slice(0, 2).map((e) => ({ ...e, seg: { a: { x: e.seg.a.x, y: e.seg.a.y + 30 * (e.i + 1) }, b: { x: e.seg.b.x, y: e.seg.b.y } } })) };
    expect(rules(evaluate({ ...empty(), graphs: [{ ...two, nodes: [] }] }))).not.toContain('edges-concurrent');
  });

  it('a label at the common midpoint breaks ownership and sits on a crossing', () => {
    const g: Graph = {
      where: 'svg',
      allow: '',
      nodes: [],
      edges: [
        { i: 0, seg: seg(0, 0, 200, 200), stroke: 1.5, a: -1, b: -1 },
        { i: 1, seg: seg(0, 200, 200, 0), stroke: 1.5, a: -1, b: -1 },
      ],
      labels: [{ i: 0, box: box(88, 91, 24, 18) }],
    };
    const found = rules(evaluate({ ...empty(), graphs: [g] }));
    expect(found).toContain('label-ownership');
    expect(found).toContain('label-on-crossing');
    expect(found).toContain('text-over-line');
  });
});

describe('contrast and keys', () => {
  it('WCAG ratio', () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    expect(over({ r: 0, g: 0, b: 0, a: 0.5 }, white).r).toBeCloseTo(127.5, 5);
  });

  it('parses the colour syntaxes of computed styles', () => {
    expect(parseCssColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseCssColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseCssColor('rgb(10 20 30 / 25%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    expect(parseCssColor('color(srgb 1 0 0 / 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor('oklab(0.5 0 0)')).toBeNull();
  });

  it('dedupe key ignores :nth-*', () => {
    expect(dedupeKey(1, 'contrast', 'tr:nth-child(3) > td')).toBe(dedupeKey(1, 'contrast', 'tr:nth-child(9) > td'));
    expect(dedupeKey(1, 'contrast', 'a')).not.toBe(dedupeKey(2, 'contrast', 'a'));
  });
});
