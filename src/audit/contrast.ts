/** WCAG 2 contrast on plain colours; colours are 0..255 channels with alpha 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** `top` painted over `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

const channel = (v: number): number => {
  const s = Math.min(255, Math.max(0, v)) / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** Ratio of two opaque colours, 1..21. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Required ratio: 3 for large text (≥ 24 px, or ≥ 18.66 px bold), else 4.5. */
export function requiredRatio(sizePx: number, bold: boolean): number {
  return sizePx >= 24 || (bold && sizePx >= 18.66) ? 3 : 4.5;
}

/** rgb()/rgba(), `color(srgb …)` and #hex; anything else (oklab, named) is left to the caller. */
export function parseCssColor(text: string): Rgba | null {
  const s = text.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const fn = /^(rgba?|color)\(\s*(?:srgb\s+)?([^)]*)\)$/.exec(s);
  if (!fn) return null;
  const [body, slash] = fn[2].split('/').map((x) => x.trim());
  const parts = body.split(/[\s,]+/).filter(Boolean);
  const rawAlpha = slash ?? (fn[1] !== 'color' ? parts[3] : undefined);
  if (parts.length < 3) return null;
  const scale = fn[1] === 'color' ? 255 : 1;
  const nums = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p) * scale));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  let a = 1;
  if (rawAlpha !== undefined) a = rawAlpha.endsWith('%') ? parseFloat(rawAlpha) / 100 : parseFloat(rawAlpha);
  if (!Number.isFinite(a)) return null;
  return { r: nums[0], g: nums[1], b: nums[2], a: Math.min(1, Math.max(0, a)) };
}
