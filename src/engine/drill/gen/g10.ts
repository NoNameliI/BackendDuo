/**
 * g10: IPv4 addresses and subnet masks. Answer: int. Shapes: `network`, `mask`, `count`.
 *
 * network: host address and a contiguous mask; ask a part (octet 1..4, or the sum of octets) of the network address
 *   (askNet) or of the broadcast address (askBcast). base: mask inside the last octet, network octet 4.
 *   core: prefix 9..30, any part. hard: also broadcast, odd prefixes in any octet.
 * mask: host address and network address; the mask is some contiguous run of ones. Ask the smallest or the largest
 *   possible number of ones, or the largest possible number of hosts (2^(32-ones) - 2, ones as small as possible).
 *   A prefix p fits when the first p bits of both addresses coincide and the network has no ones after bit p.
 * count: how many addresses of the network (host bits ranging over all values; optionally without the all-zero and
 *   all-one host part) have a number of ones in the binary notation of the whole address that is even / odd / a
 *   multiple of m. Binomial sums over the number of ones in the host part. Host bits: base <= 6, core <= 9, hard <= 13.
 * Reject: zero octet answer, mask range of a single value for min/max asks, counts of 0 or 1.
 */
import { Reject, type Fields, type Generator, type Level, type Rng, type Solved } from '../types';
import { binom, intToIp, ipText, ipToInt, popcount, prefixMask } from './shared/bits';

type Cond = { kind: 'even' } | { kind: 'odd' } | { kind: 'mult'; m: number };
export type P10 =
  | { shape: 'network'; ip: number[]; prefix: number; what: 'net' | 'bcast'; part: number } // part 0 = sum
  | { shape: 'mask'; ip: number[]; net: number[]; ask: 'minOnes' | 'maxOnes' | 'maxHosts' }
  | { shape: 'count'; ip: number[]; prefix: number; cond: Cond; exclude: boolean };

const octetsBin = (o: readonly number[]) => o.map((x) => x.toString(2).padStart(8, '0'));

function randomIp(rng: Rng): number[] {
  let first = rng.int(11, 223);
  if (first === 127) first = 128;
  return [first, rng.int(0, 255), rng.int(0, 255), rng.int(1, 254)];
}

function partOf(o: readonly number[], part: number): number {
  return part === 0 ? o[0] + o[1] + o[2] + o[3] : o[part - 1];
}

function solveNetwork(p: Extract<P10, { shape: 'network' }>): Solved {
  const ip = ipToInt(p.ip);
  const mask = prefixMask(p.prefix);
  const net = (ip & mask) >>> 0;
  const bcast = (net | (~mask >>> 0)) >>> 0;
  const target = intToIp(p.what === 'net' ? net : bcast);
  const answer = partOf(target, p.part);
  if (p.part !== 0 && answer === 0) throw new Reject('zero octet');
  return {
    answer: String(answer),
    steps: {
      ipBin: octetsBin(p.ip),
      maskBin: octetsBin(intToIp(mask)),
      mask: intToIp(mask),
      netBin: octetsBin(intToIp(net)),
      net: intToIp(net),
      bcast: intToIp(bcast),
      bcastBin: octetsBin(intToIp(bcast)),
      target,
    },
  };
}

function solveMask(p: Extract<P10, { shape: 'mask' }>): Solved {
  const ip = ipToInt(p.ip);
  const net = ipToInt(p.net);
  // lo: the network keeps all its ones; hi: the addresses agree on the first hi bits.
  const lastOne = net === 0 ? -1 : 31 - Math.log2(((net & -net) >>> 0));
  const lo = lastOne + 1;
  const diff = (ip ^ net) >>> 0;
  const hi = diff === 0 ? 32 : 31 - Math.floor(Math.log2(diff));
  if (lo > hi) throw new Reject('no mask fits');
  if (hi === lo) throw new Reject('single mask');
  const value = p.ask === 'minOnes' ? lo : p.ask === 'maxOnes' ? hi : 2 ** (32 - lo) - 2;
  if (p.ask === 'maxHosts' && lo < 6) throw new Reject('too many hosts');
  return {
    answer: String(value),
    steps: {
      ipBin: octetsBin(p.ip),
      netBin: octetsBin(p.net),
      lo,
      hi,
      candidates: hi - lo + 1,
      hostBits: 32 - lo,
    },
  };
}

const okCount = (c: Cond, ones: number): boolean =>
  c.kind === 'even' ? ones % 2 === 0 : c.kind === 'odd' ? ones % 2 === 1 : ones % c.m === 0;

function solveCount(p: Extract<P10, { shape: 'count' }>): Solved {
  const h = 32 - p.prefix;
  const net = (ipToInt(p.ip) & prefixMask(p.prefix)) >>> 0;
  const base = popcount(net);
  let total = 0;
  const terms: { j: number; ways: number }[] = [];
  for (let j = 0; j <= h; j++) {
    if (p.exclude && (j === 0 || j === h)) continue;
    if (okCount(p.cond, base + j)) {
      const ways = binom(h, j);
      total += ways;
      terms.push({ j, ways });
    }
  }
  if (total < 2) throw new Reject('tiny count');
  return {
    answer: String(total),
    steps: { hostBits: h, netOnes: base, net: intToIp(net), terms, total, all: 2 ** h },
  };
}

function buildNetwork(rng: Rng, level: Level): P10 {
  const ip = randomIp(rng);
  if (level === 'base') {
    return { shape: 'network', ip, prefix: rng.int(25, 30), what: 'net', part: 4 };
  }
  if (level === 'core') {
    const prefix = rng.int(9, 30);
    const part = rng.pick([0, 0, 1 + Math.floor((prefix - 1) / 8), 3, 4]);
    return { shape: 'network', ip, prefix, what: 'net', part };
  }
  const prefix = rng.pick([9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30]);
  const part = rng.pick([0, 0, 2, 3, 4]);
  return { shape: 'network', ip, prefix, what: rng.chance(0.5) ? 'bcast' : 'net', part };
}

function buildMask(rng: Rng, level: Level): P10 {
  const ip = randomIp(rng);
  const prefix = level === 'base' ? rng.int(24, 29) : level === 'core' ? rng.int(14, 29) : rng.int(10, 29);
  const net = intToIp((ipToInt(ip) & prefixMask(prefix)) >>> 0);
  const ask = level === 'hard' ? rng.pick(['minOnes', 'maxOnes', 'maxHosts'] as const) : rng.pick(['minOnes', 'maxOnes'] as const);
  return { shape: 'mask', ip, net, ask };
}

function buildCount(rng: Rng, level: Level): P10 {
  const hostBits = level === 'base' ? rng.int(3, 6) : level === 'core' ? rng.int(5, 9) : rng.int(8, 13);
  const kinds: Cond[] =
    level === 'hard'
      ? [{ kind: 'even' }, { kind: 'odd' }, { kind: 'mult', m: 3 }, { kind: 'mult', m: 4 }, { kind: 'mult', m: 5 }]
      : level === 'core'
        ? [{ kind: 'even' }, { kind: 'odd' }, { kind: 'mult', m: 3 }]
        : [{ kind: 'even' }, { kind: 'odd' }];
  return {
    shape: 'count',
    ip: randomIp(rng),
    prefix: 32 - hostBits,
    cond: rng.pick(kinds),
    exclude: level !== 'base' && rng.chance(0.6),
  };
}

export const g10: Generator<P10> = {
  id: 'g10',
  answer: { kind: 'int' },
  shapes: ['network', 'mask', 'count'],
  generate(rng, level, shape) {
    if (shape === 'network') return buildNetwork(rng, level);
    if (shape === 'mask') return buildMask(rng, level);
    if (shape === 'count') return buildCount(rng, level);
    throw new Error(`g10: unknown shape "${shape}"`);
  },
  solve(p) {
    return p.shape === 'network' ? solveNetwork(p) : p.shape === 'mask' ? solveMask(p) : solveCount(p);
  },
  fields(p): Fields {
    if (p.shape === 'network') {
      const mask = intToIp(prefixMask(p.prefix));
      return {
        ip: p.ip,
        ipText: ipText(p.ip),
        mask,
        maskText: ipText(mask),
        prefix: p.prefix,
        askNet: p.what === 'net',
        askBcast: p.what === 'bcast',
        partSum: p.part === 0,
        part: p.part,
      };
    }
    if (p.shape === 'mask') {
      return {
        ip: p.ip,
        ipText: ipText(p.ip),
        net: p.net,
        netText: ipText(p.net),
        askMinOnes: p.ask === 'minOnes',
        askMaxOnes: p.ask === 'maxOnes',
        askMaxHosts: p.ask === 'maxHosts',
      };
    }
    const mask = intToIp(prefixMask(p.prefix));
    return {
      ip: p.ip,
      ipText: ipText(p.ip),
      mask,
      maskText: ipText(mask),
      prefix: p.prefix,
      condEven: p.cond.kind === 'even',
      condOdd: p.cond.kind === 'odd',
      condMult: p.cond.kind === 'mult',
      m: p.cond.kind === 'mult' ? p.cond.m : 0,
      exclude: p.exclude,
    };
  },
};
