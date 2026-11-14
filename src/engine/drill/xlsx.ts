import type { Cell } from './types';

/** One worksheet: an optional caption row (strings, bold, frozen) and the data rows. */
export interface Sheet {
  name: string;
  header: string[] | null;
  rows: Cell[][];
}

const enc = new TextEncoder();
const FORBIDDEN = /[[\]:*?/\\]/g;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Sheet name: at most 31 characters, none of []:*?/\, no edge apostrophes, unique ignoring case, never empty. */
export function sheetName(label: string, used: Set<string>): string {
  const base = (label.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').slice(0, 31).trim() || `Лист ${used.size + 1}`).slice(0, 31);
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` ${n}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Excel serial of an ISO day (1900 date system), or null when the text is not a real date. */
export function dateSerial(text: string): number | null {
  const m = ISO_DAY.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / 86_400_000 + 25_569;
}

// XML 1.0 forbids most control characters even as references; they never occur in table data, so they are dropped.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (s: string): string =>
  s.replace(CONTROL, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

/** 0 -> A, 25 -> Z, 26 -> AA. */
function column(index: number): string {
  let out = '';
  let n = index;
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const STYLE_DATE = 1;
const STYLE_HEAD = 2;

function text(ref: string, value: string, style?: number): string {
  const keep = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t${keep}>${esc(value)}</t></is></c>`;
}

function cellXml(ref: string, value: Cell): string {
  if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` : text(ref, String(value));
  const serial = dateSerial(value);
  return serial === null ? text(ref, value) : `<c r="${ref}" s="${STYLE_DATE}"><v>${serial}</v></c>`;
}

const shown = (v: Cell): number => (typeof v === 'string' && dateSerial(v) !== null ? 10 : String(v).length);

function sheetXml(sheet: Sheet, selected: boolean): string {
  const width: number[] = [];
  const fit = (j: number, len: number) => {
    width[j] = Math.max(width[j] ?? 0, len);
  };
  const lines: string[] = [];
  let r = 0;
  if (sheet.header) {
    r++;
    sheet.header.forEach((h, j) => fit(j, h.length + 2));
    lines.push(`<row r="${r}">${sheet.header.map((h, j) => text(`${column(j)}${r}`, h, STYLE_HEAD)).join('')}</row>`);
  }
  for (const row of sheet.rows) {
    r++;
    row.forEach((v, j) => fit(j, shown(v)));
    lines.push(`<row r="${r}">${row.map((v, j) => cellXml(`${column(j)}${r}`, v)).join('')}</row>`);
  }
  const cols = width.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${Math.min(60, Math.max(6, w + 2))}" customWidth="1"/>`).join('');
  const pane = sheet.header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>' : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetViews><sheetView${selected ? ' tabSelected="1"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${lines.join('')}</sheetData></worksheet>`
  );
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const STYLES =
  `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

let crcTable: Uint32Array | undefined;
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip without compression (method 0): enough for OOXML, and bytes are fully determined by the content. */
function zip(parts: { name: string; data: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const { name, data } of parts) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x0021, true); // 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const entry = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(14, 0x0021, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    central.push(entry);
    offset += local.length;
  }
  const size = central.reduce((s, e) => s + e.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, parts.length, true);
  ev.setUint16(10, parts.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const chunk of [...locals, ...central, end]) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** One workbook, a worksheet per entry. Numbers stay numbers, ISO days become dates, captions are bold strings. */
export function toXlsx(sheets: Sheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet');
  const used = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, used));
  const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const parts: [string, string][] = [
    [
      '[Content_Types].xml',
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>',
    ],
    ['_rels/.rels', `${XML}<Relationships xmlns="${pkg}"><Relationship Id="rId1" Type="${ns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    [
      'xl/workbook.xml',
      `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${ns}"><sheets>` +
        names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${XML}<Relationships xmlns="${pkg}">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="${ns}/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, i === 0)]),
  ];
  return zip(parts.map(([name, body]) => ({ name, data: enc.encode(body) })));
}
