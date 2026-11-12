// DOM → plain data. Reads layout and styles only; never writes to the page and never keeps course text.
import type { Box, Pt, Seg } from '@/engine/drill/gen/shared/plane';
import { over, parseCssColor, type Rgba } from './contrast';
import {
  coreBox,
  isRenderError,
  isWrapToken,
  unionBox,
  type ElemFlags,
  type GEdge,
  type GLabel,
  type GNode,
  type Graph,
  type Item,
  type Snapshot,
  type Solid,
  type TextItem,
} from './rules';

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'HEAD', 'TITLE']);
const SOLID_TAGS = new Set(['IMG', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'VIDEO', 'CANVAS']);
const DATA_REGION = 'section[aria-label="Данные"] [role=region]';

const box = (r: DOMRect | DOMRectReadOnly): Box => ({ x: r.left, y: r.top, w: r.width, h: r.height });

// --- colours ----------------------------------------------------------------------------------------------------

let probe: CanvasRenderingContext2D | null = null;
const colorCache = new Map<string, Rgba>();

/** Any CSS colour as straight RGBA; syntaxes parseCssColor does not know are measured on a canvas. */
function toRgba(css: string): Rgba {
  const known = parseCssColor(css);
  if (known) return known;
  const hit = colorCache.get(css);
  if (hit) return hit;
  probe ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
  const paint = (under: string): Uint8ClampedArray => {
    probe!.clearRect(0, 0, 1, 1);
    probe!.fillStyle = under;
    probe!.fillRect(0, 0, 1, 1);
    probe!.fillStyle = css;
    probe!.fillRect(0, 0, 1, 1);
    return probe!.getImageData(0, 0, 1, 1).data;
  };
  const black = paint('#000000');
  const white = paint('#ffffff');
  const a = 1 - (white[1] - black[1]) / 255;
  const out: Rgba = a <= 0.004 ? { r: 0, g: 0, b: 0, a: 0 } : { r: Math.min(255, black[0] / a), g: Math.min(255, black[1] / a), b: Math.min(255, black[2] / a), a: Math.min(1, a) };
  colorCache.set(css, out);
  return out;
}

// --- helpers ----------------------------------------------------------------------------------------------------

type Ctx = ReturnType<typeof makeCtx>;

function makeCtx() {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const hiddenMap = new Map<Element, boolean>();
  const style = (el: Element): CSSStyleDeclaration => {
    let s = styles.get(el);
    if (!s) styles.set(el, (s = getComputedStyle(el)));
    return s;
  };
  const hidden = (el: Element | null): boolean => {
    if (!el || el === document.documentElement) return false;
    const known = hiddenMap.get(el);
    if (known !== undefined) return known;
    const s = style(el);
    const own = SKIP_TAGS.has(el.tagName) || el.hasAttribute('data-audit-overlay') || el.classList.contains('sr-only') || s.visibility === 'hidden' || s.opacity === '0' || s.display === 'none';
    const result = own || hidden(el.parentElement);
    hiddenMap.set(el, result);
    return result;
  };
  return { style, hidden };
}

/** Short CSS path without course text: tag, id, role and the first classes, up to three levels. */
function wherePath(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== document.body && parts.length < 3; e = e.parentElement) {
    const tag = e.tagName.toLowerCase();
    const id = e.id && !/[^\w-]/.test(e.id) ? `#${e.id}` : '';
    const role = e.getAttribute('role');
    const cls = [...e.classList].filter((c) => /^[a-z][\w-]*$/.test(c)).slice(0, 2).map((c) => `.${c}`).join('');
    parts.unshift(`${tag}${id}${id ? '' : cls}${role && !id ? `[role=${role}]` : ''}`);
    if (id) break;
  }
  return parts.join(' > ');
}

function allowOf(el: Element): string {
  let out = '';
  for (let e: Element | null = el; e; e = e.parentElement) out += ` ${e.getAttribute('data-audit-allow') ?? ''}`;
  return out.trim();
}

const isSvgInner = (el: Element): boolean => el instanceof SVGElement && el.tagName !== 'svg';

function ancestors(el: Element | null): Element[] {
  const out: Element[] = [];
  for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) out.push(e);
  return out;
}

const scrolls = (v: string): boolean => v === 'auto' || v === 'scroll';
const clips = (v: string): boolean => v === 'hidden' || v === 'clip';
/** Deliberate truncation: an ellipsis whose full text is offered in `title`. What is cut off is not on screen by design. */
const abbreviated = (el: Element, s: CSSStyleDeclaration): boolean => s.textOverflow === 'ellipsis' && clips(s.overflowX) && el.hasAttribute('title');

const paddingBox = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  // Inline elements have no client size: their border box is the best available bound.
  if (el.clientWidth === 0 && el.clientHeight === 0) return box(r);
  return { x: r.left + el.clientLeft, y: r.top + el.clientTop, w: el.clientWidth, h: el.clientHeight };
};

/**
 * The part of a rectangle that a scrolling ancestor shows (virtualized rows and half-visible rows at the edge of a data
 * region are judged by what is on screen); null when nothing of it is visible. Clipping (overflow: hidden) is not applied:
 * text cut off there is a defect, not a scrolled-away row.
 */
function visibleBox(ctx: Ctx, from: Element | null, r: Box): Box | null {
  let { x, y, w, h } = r;
  for (const a of ancestors(from)) {
    const s = ctx.style(a);
    const ax = scrolls(s.overflowX) || abbreviated(a, s);
    const ay = scrolls(s.overflowY) && a.matches('[role=region]');
    if (!ax && !ay) continue;
    const p = paddingBox(a);
    const x0 = ax ? Math.max(x, p.x) : x;
    const x1 = ax ? Math.min(x + w, p.x + p.w) : x + w;
    const y0 = ay ? Math.max(y, p.y) : y;
    const y1 = ay ? Math.min(y + h, p.y + p.h) : y + h;
    if (x1 <= x0 || y1 <= y0) return null;
    ({ x, y, w, h } = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return { x, y, w, h };
}

/** Item fields common to texts and solids; `from` is the nearest element that may contain the item. */
function itemOf(ctx: Ctx, el: Element, from: Element | null, b: Box): Item {
  let container: Item['container'] = null;
  let skipX = false;
  let skipY = false;
  let clipX = false;
  let done = false;
  for (const a of ancestors(from)) {
    const s = ctx.style(a);
    if (s.overflowX !== 'visible') clipX = true;
    if (done) continue;
    const bordered = ['top', 'right', 'bottom', 'left'].some((side) => parseFloat(s.getPropertyValue(`border-${side}-width`)) > 0);
    const filled = toRgba(s.backgroundColor).a > 0.01 || (s.backgroundImage !== 'none' && s.backgroundImage !== '');
    const clipping = clips(s.overflowX) || clips(s.overflowY);
    skipX ||= scrolls(s.overflowX);
    skipY ||= scrolls(s.overflowY);
    if (bordered || filled || clipping) {
      container = skipX && skipY ? null : { box: paddingBox(a), x: !skipX, y: !skipY };
      done = true; // the first target decides; keep scanning for clipX only
    }
  }
  return { where: wherePath(el), box: b, allow: allowOf(el), container, clipX };
}

// --- main -------------------------------------------------------------------------------------------------------

/** Colour of a design token (var(--dim)) as the browser resolves it now. */
function tokenColor(name: string): Rgba {
  const el = document.createElement('span');
  el.style.color = `var(${name})`;
  el.setAttribute('data-audit-overlay', '');
  document.body.appendChild(el);
  const c = toRgba(getComputedStyle(el).color);
  el.remove();
  return c;
}

const close = (a: Rgba, b: Rgba): boolean => Math.abs(a.r - b.r) < 1.5 && Math.abs(a.g - b.g) < 1.5 && Math.abs(a.b - b.b) < 1.5;

function backdrop(ctx: Ctx, el: Element, point?: Pt): Rgba | null {
  const layers: Rgba[] = [];
  const stroke = el instanceof SVGTextElement ? ctx.style(el) : null;
  if (stroke && stroke.stroke !== 'none' && parseFloat(stroke.strokeWidth) > 0 && stroke.paintOrder.startsWith('stroke')) layers.push(toRgba(stroke.stroke));
  else if (el instanceof SVGElement && point) {
    const under = document.elementsFromPoint(point.x, point.y).find((x) => x !== el && x instanceof SVGElement && /^(circle|rect|ellipse|path|polygon)$/.test(x.tagName) && x.closest('svg') === el.closest('svg'));
    if (under) {
      const fill = toRgba(ctx.style(under).fill);
      if (fill.a > 0) layers.push(fill);
    }
  }
  let opaque = layers.length > 0 && layers[0].a >= 0.99;
  for (let e: Element | null = el; e && !opaque; e = e.parentElement) {
    const s = ctx.style(e);
    if (s.backgroundImage !== 'none' && s.backgroundImage !== '') return null;
    const c = toRgba(s.backgroundColor);
    if (c.a > 0) layers.push(c);
    opaque = c.a >= 0.99;
  }
  return layers.reduceRight<Rgba>((under, top) => over(top, under), WHITE);
}

export function collect(): Snapshot {
  const ctx = makeCtx();
  const dim = tokenColor('--dim');
  const faint = tokenColor('--faint');
  const all = [...document.body.querySelectorAll('*')].filter((el) => !ctx.hidden(el));

  // solids; an inline element wrapped over several lines contributes one box per line fragment
  const solidIds = new Map<Element, number[]>();
  const solids: Solid[] = [];
  for (const el of all) {
    if (isSvgInner(el)) continue;
    const s = ctx.style(el);
    const cell = el.tagName === 'TD' || el.tagName === 'TH';
    const bordered = ['top', 'right', 'bottom', 'left'].some((side) => parseFloat(s.getPropertyValue(`border-${side}-width`)) > 0);
    const filled = toRgba(s.backgroundColor).a > 0.01;
    if (!(bordered || filled || cell || el.tagName === 'svg' || SOLID_TAGS.has(el.tagName))) continue;
    const fragments = s.display === 'inline' ? [...el.getClientRects()] : [el.getBoundingClientRect()];
    for (const r of fragments) {
      if (r.width <= 0 || r.height <= 0) continue;
      const whole = cell ? { x: r.left + 1, y: r.top + 1, w: Math.max(0, r.width - 2), h: Math.max(0, r.height - 2) } : box(r);
      const b = visibleBox(ctx, el.parentElement, whole);
      if (!b) continue;
      const id = solids.length;
      solidIds.set(el, [...(solidIds.get(el) ?? []), id]);
      solids.push({ id, ...itemOf(ctx, el, el.parentElement, b) });
    }
  }

  // text
  const texts: TextItem[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const svgDone = new Set<Element>();
  const pushText = (el: Element, rects: Box[], text: string, wrapped: TextItem['wrapped']) => {
    const s = ctx.style(el);
    const svg = el instanceof SVGElement;
    let scale = 1;
    let point: Pt | undefined;
    if (svg && el instanceof SVGGraphicsElement) {
      const m = el.getScreenCTM();
      scale = m ? Math.abs(m.a) : 1;
      point = { x: rects[0].x + rects[0].w / 2, y: rects[0].y + rects[0].h / 2 };
    }
    const size = parseFloat(s.fontSize) * scale;
    const halo = svg && s.stroke !== 'none' && parseFloat(s.strokeWidth) > 0 && s.paintOrder.startsWith('stroke') ? (parseFloat(s.strokeWidth) * scale) / 2 : 0;
    const cores = svg ? rects : rects.map(coreBox);
    const used = halo ? cores.map((b) => ({ x: b.x - halo, y: b.y - halo, w: b.w + 2 * halo, h: b.h + 2 * halo })) : cores;
    const union = unionBox(cores);
    const inside = ancestors(el).flatMap((a) => solidIds.get(a) ?? []);
    const disabled = el.closest('[disabled],[aria-disabled="true"]') !== null;
    const fgCss = svg ? s.fill : s.color;
    const bg = disabled || fgCss === 'none' ? null : backdrop(ctx, el, point);
    const fg = toRgba(fgCss);
    const area: TextItem['area'] = el.closest('svg[data-audit-graph]') ? 'graph' : el.closest('.md') ? 'md' : el.closest('section[aria-label="Данные"]') && el.closest('td,th,[role=region]') ? 'data' : 'chrome';
    const flat = bg ? over(fg, bg) : null;
    let positioned = false;
    for (const a of ancestors(el)) {
      const p = ctx.style(a).position;
      if (p === 'absolute' || p === 'fixed') positioned = true;
    }
    texts.push({
      id: texts.length,
      ...itemOf(ctx, el, el, union),
      boxes: used,
      kind: svg ? 'svg' : 'html',
      positioned,
      size,
      bold: parseInt(s.fontWeight, 10) >= 700,
      inside,
      area,
      secondary: !!flat && (close(fg, dim) || close(fg, faint)),
      colors: flat && bg ? { fg: flat, bg } : null,
      wrapped,
      renderError: isRenderError(text),
    });
  };

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    const el = node.parentElement;
    if (!el || !text.trim() || ctx.hidden(el)) continue;
    if (el instanceof SVGElement) {
      const owner = el.closest('text') ?? el;
      if (svgDone.has(owner)) continue;
      svgDone.add(owner);
      const r = owner.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      pushText(owner, [box(r)], owner.textContent ?? '', null);
      continue;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    const whole = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).map(box);
    if (whole.length === 0 || whole.every((r) => r.w <= 1 || r.h <= 1)) continue;
    const rects = whole.flatMap((r) => visibleBox(ctx, el, r) ?? []);
    if (rects.length === 0) continue;
    pushText(el, rects, text, wrapOf(node as Text, el, text, whole));
  }

  // elements
  const elems: ElemFlags[] = [];
  for (const el of all) {
    if (el === document.body || isSvgInner(el)) continue;
    const s = ctx.style(el);
    const flags: ElemFlags = { where: wherePath(el), box: { x: 0, y: 0, w: 0, h: 0 }, allow: '' };
    const rects = el.getClientRects();
    const own = rects.length > 0 ? box(el.getBoundingClientRect()) : null;
    if (!own) continue;
    flags.box = own;
    const hasText = !!el.textContent?.trim();
    const clipping = clips(s.overflowX) || clips(s.overflowY) || s.textOverflow === 'ellipsis';
    if (clipping && !abbreviated(el, s) && hasText && !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.id !== 'root') {
      flags.clip = { scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight };
    }
    if (scrolls(s.overflowX)) flags.scrollX = { scrollW: el.scrollWidth, clientW: el.clientWidth, minor: el.matches('pre.md-code') };
    if (el.matches('.md') && !hasText && !el.querySelector('svg,img,table')) flags.empty = 'statement';
    else if (el.matches('svg[data-audit-graph]') && (own.w <= 0 || own.h <= 0 || !el.querySelector('line') || !el.querySelector('circle'))) flags.empty = 'graph';
    else if (el.tagName === 'TABLE' && el.querySelectorAll('tbody tr:not([aria-hidden])').length === 0 && !el.closest('[data-audit-allow~="empty-data"]')) flags.empty = 'table';
    else if ((el.tagName === 'TD' || el.tagName === 'TH' || el.tagName === 'FIGURE') && (own.w <= 0 || own.h <= 0)) flags.empty = 'cell';
    if (!flags.clip && !flags.scrollX && !flags.empty) continue;
    // Horizontal scroll of the data regions is by design (wide tables, long text lines).
    flags.allow = `${allowOf(el)}${el.matches(DATA_REGION) ? ' scroll-x-element' : ''}`.trim();
    elems.push(flags);
  }

  const graphs = [...document.body.querySelectorAll('svg[data-audit-graph]')].filter((el) => !ctx.hidden(el)).map((svg) => graphOf(ctx, svg));

  const se = document.scrollingElement ?? document.documentElement;
  return { innerWidth: window.innerWidth, scrollWidth: Math.max(se.scrollWidth, document.body.scrollWidth), texts, solids, graphs, elems };
}

/** Does a token (or a numeric cell) of this text node break over several lines? */
function wrapOf(node: Text, el: Element, text: string, rects: Box[]): TextItem['wrapped'] {
  const lines = new Set(rects.map((r) => Math.round(r.y / Math.max(1, r.h * 0.5))));
  if (rects.length < 2 || lines.size < 2) return null;
  const where: TextItem['wrapped'] = el.closest('td,th') ? 'cell' : el.closest('code,pre') ? 'code' : 'text';
  if (where === 'cell' && /^[\d\s.,−\-+%·]+$/.test(text.trim())) return 'cell';
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!isWrapToken(m[0])) continue;
    const r = document.createRange();
    r.setStart(node, m.index);
    r.setEnd(node, m.index + m[0].length);
    const parts = [...r.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
    if (new Set(parts.map((x) => Math.round(x.top / Math.max(1, x.height * 0.5)))).size > 1) return where;
  }
  return null;
}

function graphOf(ctx: Ctx, svg: Element): Graph {
  const point = (el: SVGGraphicsElement, x: number, y: number): Pt => {
    const m = el.getScreenCTM();
    const p = m ? new DOMPoint(x, y).matrixTransform(m) : new DOMPoint(x, y);
    return { x: p.x, y: p.y };
  };
  const num = (el: Element, name: string) => parseFloat(el.getAttribute(name) ?? '0');
  const nodes: GNode[] = [...svg.querySelectorAll<SVGCircleElement>('circle[data-node]')].map((c) => ({
    i: Number(c.dataset.node),
    c: point(c, num(c, 'cx'), num(c, 'cy')),
    r: num(c, 'r') * Math.abs(c.getScreenCTM()?.a ?? 1),
  }));
  const nearest = (p: Pt): number => nodes.find((n) => Math.hypot(n.c.x - p.x, n.c.y - p.y) < n.r + 1.5)?.i ?? -1;
  const edges: GEdge[] = [...svg.querySelectorAll<SVGLineElement>('line[data-edge]')].map((l) => {
    const seg: Seg = { a: point(l, num(l, 'x1'), num(l, 'y1')), b: point(l, num(l, 'x2'), num(l, 'y2')) };
    return { i: Number(l.dataset.edge), seg, stroke: parseFloat(ctx.style(l).strokeWidth) * Math.abs(l.getScreenCTM()?.a ?? 1), a: nearest(seg.a), b: nearest(seg.b) };
  });
  const labels: GLabel[] = [...svg.querySelectorAll<SVGGraphicsElement>('[data-edge]:not(line),[data-node-label]')].map((el) => {
    const plate = el.tagName === 'g' ? el.querySelector('rect') : null;
    const b = box((plate ?? el).getBoundingClientRect());
    const text = el.tagName === 'text' ? el : el.querySelector('text');
    const s = text ? ctx.style(text) : null;
    const halo = s && s.stroke !== 'none' && s.paintOrder.startsWith('stroke') && !plate ? (parseFloat(s.strokeWidth) * Math.abs((text as SVGGraphicsElement).getScreenCTM()?.a ?? 1)) / 2 : 0;
    const owner = (el as unknown as HTMLElement).dataset;
    const nodeLabel = owner.nodeLabel !== undefined;
    return { i: nodeLabel ? -1 : Number(owner.edge), ...(nodeLabel ? { node: Number(owner.nodeLabel) } : {}), box: { x: b.x - halo, y: b.y - halo, w: b.w + 2 * halo, h: b.h + 2 * halo } };
  });
  return { chain: svg.getAttribute('data-audit-graph') === 'chain', where: wherePath(svg), allow: allowOf(svg), edges, nodes, labels };
}
