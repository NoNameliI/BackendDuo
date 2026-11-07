/**
 * g11: information volume of stored records. Answer: int. Shapes: `records`, `plates`, `extra`.
 *
 * records: each record holds a code of `len` symbols from an alphabet of `size` symbols; every symbol takes the
 *   same minimal number of bits, the code is stored in a whole number of bytes, plus `extra` bytes of other data.
 *   Ask the memory for `count` records in bytes or in KiB (rounded up).
 *   base: alphabet 10-26, length 5-12, no extra data, bytes.  core: alphabet 26-60, length 8-20, 4-24 extra bytes,
 *   bytes or KiB.  hard: alphabet 60-130, length 10-30, 5-60 extra bytes, 100-3000 records, KiB.
 * plates: the code is a pattern of groups (alphabet size, length, letters distinct or not); all codes of the
 *   pattern are numbered with the same minimal number of bits, whole bytes per code, plus extra bytes; ask the total.
 *   base: two groups; core: two or three groups, one with distinct symbols; hard: three groups, two distinct.
 * extra: the total memory of `count` records is given exactly (bytes or KiB); find the extra bytes per record.
 * Reject: answers outside 2..200000; extra: totals that are not whole.
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { ceilDiv, ceilLog2, permutations, pow } from './shared/bigint';

type Group = { size: number; len: number; distinct: boolean };
type Parts = { letters: number; digits: number; other: number };
type Unit = 'bytes' | 'KiB';
export type P11 =
  | { shape: 'records'; parts: Parts; len: number; extra: number; count: number; unit: Unit }
  | { shape: 'plates'; groups: Group[]; extra: number; count: number; unit: Unit }
  | { shape: 'extra'; parts: Parts; len: number; count: number; total: number; unit: Unit };

const sizeOf = (p: Parts) => p.letters + p.digits + p.other;

function codeBytes(p: P11): { bits: number; perCode: number; codes?: bigint } {
  if (p.shape === 'plates') {
    let codes = 1n;
    for (const g of p.groups) codes *= g.distinct ? permutations(g.size, g.len) : pow(g.size, g.len);
    const bits = ceilLog2(codes);
    return { bits, perCode: Math.ceil(bits / 8), codes };
  }
  const perSymbol = ceilLog2(BigInt(sizeOf(p.parts)));
  const bits = perSymbol * p.len;
  return { bits, perCode: Math.ceil(bits / 8) };
}

function check(v: bigint) {
  if (v < 2n || v > 200000n) throw new Reject('answer out of range');
}

function solve11(p: P11): Solved {
  const c = codeBytes(p);
  if (p.shape === 'extra') {
    const totalBytes = BigInt(p.total) * (p.unit === 'KiB' ? 1024n : 1n);
    const count = BigInt(p.count);
    if (totalBytes % count !== 0n) throw new Reject('not whole');
    const each = totalBytes / count;
    const extra = each - BigInt(c.perCode);
    if (extra < 1n) throw new Reject('no extra data');
    check(extra);
    return { answer: extra.toString(), steps: { perSymbol: c.bits / p.len, bits: c.bits, perCode: c.perCode, each: each.toString() } };
  }
  const each = BigInt(c.perCode + p.extra);
  const total = each * BigInt(p.count);
  const size = p.unit === 'KiB' ? ceilDiv(total, 1024n) : total;
  check(size);
  const steps: Fields =
    p.shape === 'plates'
      ? { codes: c.codes!.toString(), bits: c.bits, perCode: c.perCode, each: each.toString(), totalBytes: total.toString() }
      : { perSymbol: c.bits / p.len, bits: c.bits, perCode: c.perCode, each: each.toString(), totalBytes: total.toString() };
  return { answer: size.toString(), steps };
}

function buildParts(rng: Rng, level: Level): Parts {
  if (level === 'base') return { letters: rng.int(10, 26), digits: rng.chance(0.4) ? 10 : 0, other: 0 };
  if (level === 'core') return { letters: rng.pick([26, 26, 33, 32]), digits: 10, other: rng.int(0, 8) };
  return { letters: rng.pick([52, 52, 66]), digits: 10, other: rng.int(4, 32) };
}

function buildGroups(rng: Rng, level: Level): Group[] {
  const letterGroup = (distinct: boolean): Group => {
    const size = rng.int(8, 26);
    return { size, len: distinct ? rng.int(2, Math.min(5, size)) : rng.int(2, 5), distinct };
  };
  const digitGroup = (distinct: boolean): Group => ({ size: 10, len: rng.int(2, distinct ? 6 : 5), distinct });
  const extraGroup = (): Group => ({ size: rng.int(3, 7), len: rng.int(1, 3), distinct: false });
  if (level === 'base') return rng.shuffle([letterGroup(false), digitGroup(false)]);
  if (level === 'core') {
    const gs = [letterGroup(rng.chance(0.5)), digitGroup(false)];
    if (rng.chance(0.5)) gs.push(extraGroup());
    return rng.shuffle(gs);
  }
  return rng.shuffle([letterGroup(true), digitGroup(true), extraGroup()]);
}

function build(rng: Rng, level: Level, shape: P11['shape']): P11 {
  const count =
    level === 'base' ? rng.pick([10, 20, 25, 40, 50, 60, 100]) : level === 'core' ? rng.pick([20, 50, 100, 128, 200, 256, 300]) : rng.pick([100, 200, 256, 500, 512, 1000, 2000, 3000]);
  const unit: Unit = level === 'base' ? 'bytes' : level === 'core' ? (rng.chance(0.5) ? 'KiB' : 'bytes') : 'KiB';
  const extraMax = level === 'base' ? 0 : level === 'core' ? 24 : 60;
  const extraMin = level === 'base' ? 0 : level === 'core' ? 4 : 5;
  const len = level === 'base' ? rng.int(5, 12) : level === 'core' ? rng.int(8, 20) : rng.int(10, 30);
  if (shape === 'records') return { shape, parts: buildParts(rng, level), len, extra: rng.int(extraMin, extraMax), count, unit };
  if (shape === 'plates') {
    return { shape, groups: buildGroups(rng, level), extra: rng.int(Math.max(extraMin, 1), Math.max(extraMax, 4)), count, unit };
  }
  const parts = buildParts(rng, level);
  const base: P11 = { shape: 'records', parts, len, extra: rng.int(Math.max(extraMin, 1), Math.max(extraMax, 4)), count, unit: 'bytes' };
  const perCode = codeBytes(base).perCode;
  const totalBytes = (perCode + base.extra) * count;
  const asKiB = totalBytes % 1024 === 0;
  return { shape, parts, len, count, total: asKiB ? totalBytes / 1024 : totalBytes, unit: asKiB ? 'KiB' : 'bytes' };
}

export const g11: Generator<P11> = {
  id: 'g11',
  answer: { kind: 'int' },
  shapes: ['records', 'plates', 'extra'],
  generate(rng, level, shape) {
    if (shape !== 'records' && shape !== 'plates' && shape !== 'extra') throw new Error(`g11: unknown shape "${shape}"`);
    const p = build(rng, level, shape);
    solve11(p);
    return p;
  },
  solve: solve11,
  fields(p): Fields {
    const ask = { askBytes: p.unit === 'bytes', askKiB: p.unit === 'KiB' };
    if (p.shape === 'plates') return { groups: p.groups, extra: p.extra, count: p.count, ...ask };
    const common = { parts: p.parts, size: sizeOf(p.parts), len: p.len, count: p.count };
    if (p.shape === 'records') return { ...common, extra: p.extra, ...ask };
    return { ...common, total: p.total, totalKiB: p.unit === 'KiB', totalBytes: p.unit === 'bytes' };
  },
};
