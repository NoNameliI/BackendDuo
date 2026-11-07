import { describe, expect, it } from 'vitest';
import { draw } from './instance';
import { registry } from './registry';
import type { FieldValue, Level } from './types';

const one = (id: string, level: Level, shape: string, seed: number) => {
  const gen = registry[id as keyof typeof registry];
  const vocab = Object.fromEntries(Object.entries(gen.vocab ?? {}).map(([k, n]) => [k, Array.from({ length: n as number }, (_, i) => `${k}${i + 1}`)]));
  const { params, solved } = draw(gen, { seed, level, shape, vocab });
  return { fields: gen.fields(params) as Record<string, FieldValue>, steps: solved.steps as Record<string, FieldValue>, files: gen.files?.(params) ?? [] };
};

describe('template extras', () => {
  it('g14 marks single-digit runs', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { steps } = one('g14', 'core', 'powers', seed);
      for (const r of steps.runs as unknown as { from: number; to: number; single: boolean }[]) expect(r.single).toBe(r.from === r.to);
    }
  });

  it('g06 lines carry op flags, arg and indent', () => {
    const { fields } = one('g06', 'base', 'region', 1);
    const lines = fields.lines as unknown as Record<string, number | boolean>[];
    expect(lines.some((l) => l.isRepeat)).toBe(true);
    for (const l of lines) {
      expect(['isFwd', 'isBack', 'isRight', 'isLeft', 'isRepeat', 'isEnd'].filter((k) => l[k] === true).length).toBeLessThanOrEqual(1);
      expect(l.indent).toBe(l.depth);
      expect(l.arg).toBe(l.value);
    }
  });

  it('g16 exposes sign and magnitude of constants', () => {
    for (const shape of ['value', 'ratio', 'calls']) {
      const { fields } = one('g16', 'core', shape, 3);
      const rules = fields.rules as unknown as { terms: { b: number; bNeg: boolean; bAbs: number; a: number; aNeg: boolean; aAbs: number }[]; add: number; addNeg: boolean; addAbs: number }[];
      for (const r of rules) {
        expect(r.addAbs).toBe(Math.abs(r.add));
        expect(r.addNeg).toBe(r.add < 0);
        for (const t of r.terms) {
          expect(t.bAbs).toBe(Math.abs(t.b));
          expect(t.bNeg).toBe(t.b < 0);
          expect(t.aAbs).toBe(Math.abs(t.a));
        }
      }
    }
  });

  it('g01 drawing lists every vertex once and every edge', () => {
    const { fields } = one('g01', 'core', 'edge', 5);
    const d = fields.drawing as unknown as { nodes: { label: string; x: number; y: number }[]; edges: { a: string; b: string; w: number }[] };
    expect(new Set(d.nodes.map((n) => n.label)).size).toBe(d.nodes.length);
    expect(new Set(d.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(d.nodes.length);
    expect(d.edges).toEqual(fields.edges);
    expect(one('g01', 'core', 'edge', 5).fields.drawing).toEqual(fields.drawing);
  });

  it('grid tables have no caption row', () => {
    for (const [id, shape] of [['g09', 'pattern'], ['g18', 'plain']] as const) {
      const gen = registry[id];
      const { files } = one(id, 'base', gen.shapes.includes(shape) ? shape : gen.shapes[0], 2);
      const f = files[0];
      expect(f.kind === 'table' && f.tables[0].header).toBe(false);
    }
  });
});
