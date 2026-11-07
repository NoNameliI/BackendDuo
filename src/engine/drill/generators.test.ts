import { describe, expect, it } from 'vitest';
import { normalizeAnswer } from './answer';
import { draw, MAX_TRIES } from './instance';
import { registry } from './registry';
import { hashSeed } from './rng';
import { LEVELS, type Brute, type Generator } from './types';

const brutes = import.meta.glob<{ brute: Brute<unknown> }>('./gen/g*.brute.ts', { eager: true });
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

const bruteOf = (id: string): Brute<unknown> | undefined => brutes[`./gen/${id}.brute.ts`]?.brute;

/** Placeholder word lists of the minimum size each generator asks the pack for. */
const placeholderVocab = (gen: Generator<unknown>) =>
  Object.fromEntries(Object.entries(gen.vocab ?? {}).map(([k, size]) => [k, Array.from({ length: size }, (_, i) => `${k}${i + 1}`)]));

describe('registry', () => {
  it('has a brute for every generator', () => {
    for (const id of Object.keys(registry)) expect(bruteOf(id), `${id}.brute.ts`).toBeTypeOf('function');
  });
});

for (const [id, gen] of Object.entries(registry)) {
  describe(id, () => {
    for (const level of LEVELS) {
      it(`${level}: brute agrees with solve on ${SEEDS.length} seeds`, () => {
        const brute = bruteOf(id)!;
        const tries: number[] = [];
        const times: number[] = [];
        for (const seed of SEEDS) {
          const shape = gen.shapes[seed % gen.shapes.length];
          const vocab = placeholderVocab(gen);
          const t0 = performance.now();
          const a = draw(gen, { seed, level, shape, vocab });
          times.push(performance.now() - t0);
          tries.push(a.tries);
          expect(brute(a.params), `${level}/${shape}/seed ${seed}`).toEqual([a.solved.answer]);
          const n = normalizeAnswer(a.solved.answer, gen.answer);
          expect(n.ok && n.value, 'canonical answer').toBe(a.solved.answer);
          const b = draw(gen, { seed, level, shape, vocab });
          expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        }
        expect(tries.reduce((s, x) => s + x, 0) / tries.length, 'mean tries').toBeLessThanOrEqual(5);
        expect(Math.max(...tries), 'max tries').toBeLessThan(MAX_TRIES);
        times.sort((x, y) => x - y);
        expect(times[Math.floor(times.length * 0.95)], 'p95 ms').toBeLessThanOrEqual(50);
      });

    }
  });
}

it('first seeds of every level keep their stream', () => {
  const out: Record<string, string[]> = {};
  for (const [id, gen] of Object.entries(registry)) {
    for (const level of LEVELS) {
      out[`${id}/${level}`] = [1, 2, 3].map((seed) => {
        const shape = gen.shapes[seed % gen.shapes.length];
        const r = draw(gen, { seed, level, shape, vocab: placeholderVocab(gen) });
        return `${shape} #${seed} -> ${r.solved.answer} (${r.tries} tries, ${hashSeed(JSON.stringify(gen.fields(r.params)))})`;
      });
    }
  }
  expect(out).toMatchInlineSnapshot(`
    {
      "g01/base": [
        "path #1 -> 10 (1 tries, 1717208645)",
        "edge #2 -> 5 (1 tries, 1360618876)",
        "path #3 -> 13 (1 tries, 2190208180)",
      ],
      "g01/core": [
        "path #1 -> 25 (1 tries, 77706228)",
        "edge #2 -> 13 (1 tries, 3420751991)",
        "path #3 -> 11 (1 tries, 3504602247)",
      ],
      "g01/hard": [
        "path #1 -> 27 (1 tries, 1568231114)",
        "edge #2 -> 22 (1 tries, 984009489)",
        "path #3 -> 34 (1 tries, 1068895481)",
      ],
      "g02/base": [
        "full #1 -> PQR (1 tries, 1986488647)",
        "fragment #2 -> BAC (1 tries, 3342415708)",
        "full #3 -> YXZ (1 tries, 2444376518)",
      ],
      "g02/core": [
        "full #1 -> SPRQ (1 tries, 12979585)",
        "fragment #2 -> ACBD (1 tries, 3607907200)",
        "full #3 -> XYZW (1 tries, 3505523087)",
      ],
      "g02/hard": [
        "full #1 -> PSQR (1 tries, 134765231)",
        "fragment #2 -> BDCA (1 tries, 1572018226)",
        "full #3 -> XZYW (1 tries, 3350984245)",
      ],
      "g03/base": [
        "net #1 -> 64750 (1 tries, 2067791744)",
        "money #2 -> 274879 (1 tries, 2924344151)",
        "volume #3 -> 554400 (1 tries, 2162792122)",
      ],
      "g03/core": [
        "net #1 -> -49250 (1 tries, 766756611)",
        "money #2 -> 41539 (1 tries, 2612196407)",
        "volume #3 -> 404050 (1 tries, 2599552156)",
      ],
      "g03/hard": [
        "net #1 -> -192000 (1 tries, 3751162310)",
        "money #2 -> 211739 (1 tries, 2498073553)",
        "volume #3 -> 846350 (1 tries, 2162609851)",
      ],
      "g04/base": [
        "longest #1 -> 4 (1 tries, 3232791175)",
        "total #2 -> 9 (1 tries, 2370711901)",
        "longest #3 -> 4 (1 tries, 640007515)",
      ],
      "g04/core": [
        "longest #1 -> 4 (1 tries, 185787801)",
        "total #2 -> 13 (1 tries, 3233524936)",
        "longest #3 -> 4 (2 tries, 1148596550)",
      ],
      "g04/hard": [
        "longest #1 -> 4 (1 tries, 927271212)",
        "total #2 -> 31 (1 tries, 416311378)",
        "longest #3 -> 6 (1 tries, 3546297616)",
      ],
      "g05/base": [
        "min-r #1 -> 24 (1 tries, 3998753645)",
        "max-n #2 -> 12 (1 tries, 187621611)",
        "min-n #3 -> 5 (1 tries, 3799353771)",
      ],
      "g05/core": [
        "min-r #1 -> 195 (1 tries, 3419529481)",
        "max-n #2 -> 3 (1 tries, 772692821)",
        "min-n #3 -> 6 (1 tries, 3160293618)",
      ],
      "g05/hard": [
        "min-r #1 -> 824 (1 tries, 3155295893)",
        "max-n #2 -> 4 (3 tries, 843843607)",
        "min-n #3 -> 45 (2 tries, 3221440507)",
      ],
      "g06/base": [
        "common #1 -> 16 (1 tries, 1919706272)",
        "region #2 -> 78 (1 tries, 515344480)",
        "common #3 -> 24 (1 tries, 1630653270)",
      ],
      "g06/core": [
        "common #1 -> 28 (1 tries, 394854657)",
        "region #2 -> 620 (1 tries, 2513163461)",
        "common #3 -> 190 (2 tries, 2872017903)",
      ],
      "g06/hard": [
        "common #1 -> 816 (1 tries, 2720682205)",
        "region #2 -> 984 (1 tries, 1489293677)",
        "common #3 -> 638 (1 tries, 4082717870)",
      ],
      "g07/base": [
        "image #1 -> 5 (1 tries, 481491790)",
        "change #2 -> 16 (1 tries, 4230705273)",
        "sound #3 -> 860 (1 tries, 784490890)",
      ],
      "g07/core": [
        "image #1 -> 8 (1 tries, 1890415221)",
        "change #2 -> 624 (1 tries, 2585866224)",
        "sound #3 -> 24 (1 tries, 2784032161)",
      ],
      "g07/hard": [
        "image #1 -> 103 (1 tries, 2392808499)",
        "change #2 -> 1200 (1 tries, 3632656311)",
        "sound #3 -> 44 (1 tries, 3637150677)",
      ],
      "g08/base": [
        "rank #1 -> 41 (1 tries, 3444630753)",
        "first #2 -> 376 (1 tries, 3374009522)",
        "count #3 -> 209 (1 tries, 1237585877)",
      ],
      "g08/core": [
        "rank #1 -> 296 (1 tries, 3910291265)",
        "first #2 -> 257 (2 tries, 3421547319)",
        "count #3 -> 1616 (1 tries, 3100675520)",
      ],
      "g08/hard": [
        "rank #1 -> 3914 (1 tries, 4283604159)",
        "first #2 -> 3626 (1 tries, 4046103858)",
        "count #3 -> 24195 (1 tries, 987472406)",
      ],
      "g09/base": [
        "compare #1 -> 33 (1 tries, 1439368891)",
        "mean #2 -> 49 (1 tries, 3769514234)",
        "pattern #3 -> 274 (1 tries, 1453952159)",
      ],
      "g09/core": [
        "compare #1 -> 322 (1 tries, 2103047267)",
        "mean #2 -> 833 (1 tries, 1179789313)",
        "pattern #3 -> 355 (1 tries, 1060147716)",
      ],
      "g09/hard": [
        "compare #1 -> 22 (1 tries, 3189551457)",
        "mean #2 -> 209 (1 tries, 3730619733)",
        "pattern #3 -> 551 (1 tries, 1022249220)",
      ],
      "g10/base": [
        "mask #1 -> 27 (1 tries, 1012578309)",
        "count #2 -> 32 (1 tries, 2637472194)",
        "network #3 -> 96 (1 tries, 4010778557)",
      ],
      "g10/core": [
        "mask #1 -> 22 (1 tries, 3010696233)",
        "count #2 -> 15 (1 tries, 2480833043)",
        "network #3 -> 389 (1 tries, 311070457)",
      ],
      "g10/hard": [
        "mask #1 -> 18 (1 tries, 3413684688)",
        "count #2 -> 255 (1 tries, 1561848674)",
        "network #3 -> 731 (1 tries, 663754171)",
      ],
      "g11/base": [
        "plates #1 -> 70 (1 tries, 1762077617)",
        "extra #2 -> 4 (1 tries, 909030651)",
        "records #3 -> 300 (1 tries, 1914618099)",
      ],
      "g11/core": [
        "plates #1 -> 2600 (2 tries, 464557559)",
        "extra #2 -> 4 (1 tries, 673324337)",
        "records #3 -> 4 (1 tries, 3311430976)",
      ],
      "g11/hard": [
        "plates #1 -> 2 (1 tries, 1898154304)",
        "extra #2 -> 44 (1 tries, 3772016789)",
        "records #3 -> 5 (1 tries, 1943588965)",
      ],
      "g12/base": [
        "tape #1 -> 6 (1 tries, 64295624)",
        "rewrite #2 -> 19 (2 tries, 3324936218)",
        "tape #3 -> 4 (1 tries, 257765590)",
      ],
      "g12/core": [
        "tape #1 -> 16 (1 tries, 2031994689)",
        "rewrite #2 -> 60 (1 tries, 4219199795)",
        "tape #3 -> 13 (2 tries, 1292010207)",
      ],
      "g12/hard": [
        "tape #1 -> 15 (1 tries, 1109981000)",
        "rewrite #2 -> 125 (1 tries, 669491452)",
        "tape #3 -> 50 (1 tries, 1920124586)",
      ],
      "g13/base": [
        "length #1 -> 5 (1 tries, 4265373817)",
        "count #2 -> 13 (3 tries, 1471424167)",
        "length #3 -> 3 (1 tries, 942677742)",
      ],
      "g13/core": [
        "length #1 -> 8 (2 tries, 3031986021)",
        "count #2 -> 46308550231 (1 tries, 802265500)",
        "length #3 -> 6 (1 tries, 1442529341)",
      ],
      "g13/hard": [
        "length #1 -> 273 (2 tries, 1573660568)",
        "count #2 -> 3944358548483 (3 tries, 3210077249)",
        "length #3 -> 21 (1 tries, 820316998)",
      ],
      "g14/base": [
        "digit #1 -> 429636 (1 tries, 3788040537)",
        "powers #2 -> 38 (1 tries, 4106196936)",
        "digit #3 -> 47899 (1 tries, 368974349)",
      ],
      "g14/core": [
        "digit #1 -> 3798854 (4 tries, 3158468740)",
        "powers #2 -> 861 (1 tries, 3339673822)",
        "digit #3 -> 1788186825 (1 tries, 2284331720)",
      ],
      "g14/hard": [
        "digit #1 -> 271344379 (5 tries, 301638155)",
        "powers #2 -> 2198 (1 tries, 336745703)",
        "digit #3 -> 26747005558 (1 tries, 2980915794)",
      ],
      "g15/base": [
        "segment #1 -> 7 (1 tries, 3574700749)",
        "mask #2 -> 15 (1 tries, 3885307812)",
        "divisor #3 -> 2 (1 tries, 1238517670)",
      ],
      "g15/core": [
        "segment #1 -> 6 (1 tries, 1423040528)",
        "mask #2 -> 2 (1 tries, 1229577393)",
        "divisor #3 -> 5 (1 tries, 3483033160)",
      ],
      "g15/hard": [
        "segment #1 -> 5 (1 tries, 3927324023)",
        "mask #2 -> 36 (1 tries, 2462729287)",
        "divisor #3 -> 5 (1 tries, 3483033160)",
      ],
      "g16/base": [
        "ratio #1 -> 5814 (1 tries, 925512238)",
        "calls #2 -> 25 (1 tries, 3250006578)",
        "value #3 -> 337 (1 tries, 2868890835)",
      ],
      "g16/core": [
        "ratio #1 -> 2861288196940887840 (1 tries, 1266127959)",
        "calls #2 -> 1801 (1 tries, 1559092682)",
        "value #3 -> 190411799641682433364 (1 tries, 3003875156)",
      ],
      "g16/hard": [
        "ratio #1 -> 39725362140710400 (1 tries, 4050411312)",
        "calls #2 -> 428333 (1 tries, 1550108943)",
        "value #3 -> 317823500862317285975897971644618793728600016280160792124607 (1 tries, 970514196)",
      ],
      "g17/base": [
        "triples #1 -> 862 2836 (1 tries, 4264506103)",
        "gap #2 -> 186129 1995 (1 tries, 1969332951)",
        "adjacent #3 -> 752 1955 (1 tries, 1585150914)",
      ],
      "g17/core": [
        "triples #1 -> 303 17809 (1 tries, 2116741067)",
        "gap #2 -> 331821 19982 (1 tries, 3085914786)",
        "adjacent #3 -> 45 16588 (1 tries, 2706106296)",
      ],
      "g17/hard": [
        "triples #1 -> 434 248091 (1 tries, 4027627614)",
        "gap #2 -> 325337 199327 (1 tries, 666129579)",
        "adjacent #3 -> 1491 169755 (1 tries, 1991404603)",
      ],
      "g18/base": [
        "through #1 -> 136 80 (1 tries, 1546966641)",
        "walls #2 -> 154 96 (1 tries, 3118657789)",
        "corner #3 -> 143 71 (1 tries, 484694325)",
      ],
      "g18/core": [
        "through #1 -> 537 237 (1 tries, 3625164427)",
        "walls #2 -> 556 247 (1 tries, 1919549300)",
        "corner #3 -> 577 265 (1 tries, 2129989809)",
      ],
      "g18/hard": [
        "through #1 -> 858 267 (1 tries, 3023819240)",
        "walls #2 -> 741 174 (1 tries, 236353284)",
        "corner #3 -> 890 172 (1 tries, 2953506652)",
      ],
      "g19/base": [
        "greatest #1 -> 10 (1 tries, 1570359021)",
        "least #2 -> 8 (1 tries, 941527536)",
        "greatest #3 -> 21 (1 tries, 221851183)",
      ],
      "g19/core": [
        "greatest #1 -> 47 (1 tries, 3903481799)",
        "least #2 -> 12 (1 tries, 2598718256)",
        "greatest #3 -> 29 (1 tries, 913396006)",
      ],
      "g19/hard": [
        "greatest #1 -> 19 (1 tries, 1769954827)",
        "least #2 -> 13 (1 tries, 2241125352)",
        "greatest #3 -> 27 (1 tries, 1897212460)",
      ],
      "g20/base": [
        "span #1 -> 4 7 (1 tries, 3409077429)",
        "least #2 -> 7 12 (1 tries, 2919582444)",
        "span #3 -> 6 11 (3 tries, 2526294138)",
      ],
      "g20/core": [
        "span #1 -> 23 44 (1 tries, 680180174)",
        "least #2 -> 30 31 (1 tries, 868712722)",
        "span #3 -> 15 29 (2 tries, 1529661344)",
      ],
      "g20/hard": [
        "span #1 -> 22 26 (5 tries, 1730159438)",
        "least #2 -> 12 20 (1 tries, 4293128906)",
        "span #3 -> 16 20 (2 tries, 2146379838)",
      ],
      "g21/base": [
        "greatest #1 -> 16 (1 tries, 2105878499)",
        "least #2 -> 11 (2 tries, 477202249)",
        "greatest #3 -> 14 (7 tries, 3770349729)",
      ],
      "g21/core": [
        "greatest #1 -> 38 (1 tries, 3903481799)",
        "least #2 -> 14 (2 tries, 812225072)",
        "greatest #3 -> 19 (7 tries, 1681276843)",
      ],
      "g21/hard": [
        "greatest #1 -> 42 (1 tries, 2163285107)",
        "least #2 -> 22 (2 tries, 882854263)",
        "greatest #3 -> 42 (7 tries, 2407301887)",
      ],
    }
  `);
});
