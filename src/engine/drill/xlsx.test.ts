import { describe, expect, it } from 'vitest';
import { headerOf, toTsv } from './data';
import { registry } from './registry';
import { draw } from './instance';
import { LEVELS, type Cell, type DataTable, type Generator } from './types';
import { dateSerial, sheetName, toXlsx } from './xlsx';

// ---- an independent reader: zip (local headers + central directory + CRC) and a small XML parser ----

const dec = new TextDecoder('utf-8', { fatal: true });

function crc(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function unzip(bytes: Uint8Array): Map<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  expect(end, 'end of central directory').toBeGreaterThanOrEqual(0);
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const method = v.getUint16(at + 10, true);
    const sum = v.getUint32(at + 16, true);
    const csize = v.getUint32(at + 20, true);
    const usize = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    expect(method, name).toBe(0);
    expect(csize).toBe(usize);
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(dec.decode(bytes.subarray(local + 30, local + 30 + v.getUint16(local + 26, true)))).toBe(name);
    expect(v.getUint32(local + 14, true), `crc in local header of ${name}`).toBe(sum);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + usize);
    expect(crc(data), `crc of ${name}`).toBe(sum);
    expect(out.has(name), `duplicate ${name}`).toBe(false);
    out.set(name, dec.decode(data));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

interface El {
  tag: string;
  attrs: Record<string, string>;
  kids: El[];
  text: string;
}

const unescape = (s: string): string =>
  s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e]!);

/** Throws on a mismatched tag, a bare `<`/`&`, or content after the root. */
function parseXml(xml: string): El {
  const root: El = { tag: '#root', attrs: {}, kids: [], text: '' };
  const stack = [root];
  const re = /<\?[^?]*\?>|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<&]*(?:&(?:lt|gt|quot|apos|amp);[^"<&]*)*")*)\s*(\/?)>|([^<]+)/gy;
  let pos = 0;
  while (pos < xml.length) {
    re.lastIndex = pos;
    const m = re.exec(xml);
    if (!m) throw new Error(`bad XML at ${pos}: ${xml.slice(pos, pos + 40)}`);
    pos = re.lastIndex;
    const [all, close, tag, attrText, selfClose, text] = m;
    const top = stack[stack.length - 1];
    if (text !== undefined) {
      if (/&(?!(lt|gt|quot|apos|amp);)/.test(text)) throw new Error(`bare & in text: ${text.slice(0, 40)}`);
      top.text += unescape(text);
    } else if (tag === undefined) {
      expect(all.startsWith('<?xml')).toBe(true);
    } else if (close) {
      if (top.tag !== tag) throw new Error(`</${tag}> closes <${top.tag}>`);
      stack.pop();
    } else {
      const attrs: Record<string, string> = {};
      for (const a of attrText.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
        if (a[1] in attrs) throw new Error(`duplicate attribute ${a[1]}`);
        attrs[a[1]] = unescape(a[2]);
      }
      const el: El = { tag, attrs, kids: [], text: '' };
      top.kids.push(el);
      if (!selfClose) stack.push(el);
    }
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1].tag}>`);
  expect(root.kids).toHaveLength(1);
  return root.kids[0];
}

const kid = (el: El, tag: string): El => {
  const found = el.kids.find((k) => k.tag === tag);
  if (!found) throw new Error(`no <${tag}> in <${el.tag}>`);
  return found;
};

interface ReadSheet {
  name: string;
  rows: Cell[][];
  styles: number[][];
  frozen: boolean;
  tags: string[][];
}

function colIndex(ref: string): number {
  return [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

/** Reads a workbook back the way a spreadsheet application does: through workbook.xml and its relationships. */
function readBook(bytes: Uint8Array): { parts: Map<string, string>; sheets: ReadSheet[] } {
  const parts = unzip(bytes);
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']) {
    expect(parts.has(name), name).toBe(true);
  }
  for (const [name, body] of parts) {
    if (name.endsWith('.xml') || name.endsWith('.rels')) parseXml(body);
  }
  const rels = new Map(parseXml(parts.get('xl/_rels/workbook.xml.rels')!).kids.map((r) => [r.attrs.Id, r.attrs.Target]));
  const types = parseXml(parts.get('[Content_Types].xml')!);
  const book = parseXml(parts.get('xl/workbook.xml')!);
  const sheets = kid(book, 'sheets').kids.map((s): ReadSheet => {
    const part = `xl/${rels.get(s.attrs['r:id'])}`;
    expect(types.kids.some((t) => t.attrs.PartName === `/${part}`), `content type of ${part}`).toBe(true);
    const ws = parseXml(parts.get(part)!);
    const rows: Cell[][] = [];
    const styles: number[][] = [];
    const tags: string[][] = [];
    for (const row of kid(ws, 'sheetData').kids) {
      if (Number(row.attrs.r) !== rows.length + 1) throw new Error(`row ${row.attrs.r} out of order`);
      const values: Cell[] = [];
      const st: number[] = [];
      const tg: string[] = [];
      for (const c of row.kids) {
        const at = colIndex(c.attrs.r);
        if (at !== values.length) throw new Error(`cell ${c.attrs.r} out of order`);
        const style = Number(c.attrs.s ?? 0);
        st.push(style);
        tg.push(c.attrs.t ?? 'n');
        if (c.attrs.t === 'inlineStr') values.push(kid(kid(c, 'is'), 't').text);
        else {
          if (c.attrs.t !== undefined) throw new Error(`unexpected type ${c.attrs.t}`);
          const num = Number(kid(c, 'v').text);
          if (style === 1) {
            const day = new Date((num - 25_569) * 86_400_000).toISOString().slice(0, 10);
            values.push(day);
          } else values.push(num);
        }
      }
      rows.push(values);
      styles.push(st);
      tags.push(tg);
    }
    const view = kid(kid(ws, 'sheetViews'), 'sheetView');
    return { name: s.attrs.name, rows, styles, frozen: view.kids.some((k) => k.tag === 'pane' && k.attrs.state === 'frozen' && k.attrs.ySplit === '1'), tags };
  });
  return { parts, sheets };
}

// ---- unit tests ----

describe('toXlsx', () => {
  const sample = toXlsx([
    { name: 'Товары', header: ['id', 'Название', 'Дата', 'Цена, руб.'], rows: [[1, 'Крупа <гречка> & "рис" \'х\'', '2025-03-01', 12.5], [2, ' пробел ', '2025-13-40', -3]] },
    { name: 'Сетка', header: null, rows: [[1, 2, 3], [4, 5, 6]] },
  ]);

  it('has the required parts, valid XML and a good CRC for every part', () => {
    const { parts } = readBook(sample);
    expect([...parts.keys()].sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].sort(),
    );
  });

  it('keeps sheets, rows, number and date types, captions and escaping', () => {
    const { sheets, parts } = readBook(sample);
    expect(sheets.map((s) => s.name)).toEqual(['Товары', 'Сетка']);
    const [a, b] = sheets;
    expect(a.rows).toEqual([['id', 'Название', 'Дата', 'Цена, руб.'], [1, 'Крупа <гречка> & "рис" \'х\'', '2025-03-01', 12.5], [2, ' пробел ', '2025-13-40', -3]]);
    expect(a.tags[1]).toEqual(['n', 'inlineStr', 'n', 'n']); // date = number with the date style
    expect(a.styles[1]).toEqual([0, 0, 1, 0]);
    expect(a.styles[0]).toEqual([2, 2, 2, 2]); // bold captions
    expect(a.tags[2][2]).toBe('inlineStr'); // 2025-13-40 is not a date: stays text
    expect(a.frozen).toBe(true);
    expect(b.frozen).toBe(false);
    expect(b.rows).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(parts.get('xl/styles.xml')).toContain('numFmtId="164"');
    expect(parts.get('xl/worksheets/sheet1.xml')).toContain('<cols>');
    expect(parts.get('xl/worksheets/sheet1.xml')).toContain('xml:space="preserve"');
  });

  it('is deterministic', () => {
    expect(toXlsx([{ name: 'a', header: null, rows: [[1]] }])).toEqual(toXlsx([{ name: 'a', header: null, rows: [[1]] }]));
  });

  it('refuses an empty workbook', () => {
    expect(() => toXlsx([])).toThrow();
  });

  it('turns ISO days into the Excel serial of the 1900 system', () => {
    expect(dateSerial('1900-03-01')).toBe(61);
    expect(dateSerial('2025-03-01')).toBe(45_717);
    expect(dateSerial('2024-02-30')).toBeNull();
    expect(dateSerial('2025-3-1')).toBeNull();
  });
});

describe('sheetName', () => {
  it('cleans, limits and de-duplicates names', () => {
    const used = new Set<string>();
    expect(sheetName('Торговые точки', used)).toBe('Торговые точки');
    expect(sheetName('торговые точки', used)).toBe('торговые точки 2');
    expect(sheetName('a[b]:c*d?e/f\\g', used)).toBe('a b c d e f g');
    expect(sheetName("'quoted'", used)).toBe('quoted');
    expect(sheetName('x'.repeat(50), used)).toHaveLength(31);
    expect(sheetName('x'.repeat(50), used)).toHaveLength(31);
    expect([...used].every((n) => n.length <= 31)).toBe(true);
    expect(sheetName('  ', used)).toMatch(/^Лист \d+$/);
    expect(sheetName('???', used)).toMatch(/^Лист \d+$/);
  });
});

describe('toTsv', () => {
  it('pastes into Excel: tabs, decimal comma, quoting', () => {
    const t: DataTable = { key: 't1', columns: ['c1', 'c2'], rows: [['a\tb', 1.5], ['say "hi"', 2]] };
    expect(toTsv(t, { 't1.c1': 'Имя' })).toBe('Имя\tc2\r\n"a\tb"\t1,5\r\n"say ""hi"""\t2');
    expect(toTsv({ ...t, header: false })).toBe('"a\tb"\t1,5\r\n"say ""hi"""\t2');
  });
});

// ---- round trip through the real generators ----

const placeholderVocab = (gen: Generator<unknown>) =>
  Object.fromEntries(Object.entries(gen.vocab ?? {}).map(([k, size]) => [k, Array.from({ length: size }, (_, i) => `${k} ${i + 1}`)]));

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

for (const id of ['g03', 'g09', 'g18'] as const) {
  describe(`${id} workbook`, () => {
    const gen = registry[id] as Generator<unknown>;
    for (const level of LEVELS) {
      it(`${level}: sheets read back equal the tables on ${SEEDS.length} seeds`, () => {
        for (const seed of SEEDS) {
          const shape = gen.shapes[seed % gen.shapes.length];
          const { params } = draw(gen, { seed, level, shape, vocab: placeholderVocab(gen) });
          const tables = (gen.files!(params) as { kind: string; tables?: DataTable[] }[]).flatMap((f) => f.tables ?? []);
          expect(tables.length).toBeGreaterThan(0);
          const captions = Object.fromEntries(tables.flatMap((t) => t.columns.map((c, i) => [`${t.key}.${c}`, `Заголовок ${t.key}.${i + 1} "<&>"`])));
          const bytes = toXlsx(tables.map((t) => ({ name: `Лист ${t.key}`, header: headerOf(t, captions), rows: t.rows })));
          const { sheets } = readBook(bytes);
          expect(sheets, `${id} ${level} #${seed}`).toHaveLength(tables.length);
          sheets.forEach((s, i) => {
            const t = tables[i];
            const head = headerOf(t, captions);
            expect(s.name).toBe(`Лист ${t.key}`);
            expect(s.rows).toEqual([...(head ? [head] : []), ...t.rows]);
            expect(s.frozen).toBe(!!head);
          });
        }
      }, 120_000);
    }
  });
}

it('g03 has three sheets with real dates in the journal', () => {
  const gen = registry.g03 as Generator<unknown>;
  const { params } = draw(gen, { seed: 3, level: 'core', shape: gen.shapes[0], vocab: placeholderVocab(gen) });
  const tables = (gen.files!(params) as { tables?: DataTable[] }[]).flatMap((f) => f.tables ?? []);
  const { sheets } = readBook(toXlsx(tables.map((t) => ({ name: t.key, header: headerOf(t), rows: t.rows }))));
  expect(sheets.map((s) => s.name)).toEqual(['t1', 't2', 't3']);
  expect(sheets[2].styles.slice(1).every((row) => row[1] === 1 && row[0] === 0)).toBe(true);
});
