import type { FieldValue, Fields } from './types';

/**
 * Statement templates: a tiny strict mustache-like language producing Markdown.
 *   {{a}} {{a.b}} {{list.0}}        paths; inside {{#each list}} also {{.}}, item keys, {{@n}} (1-based), {{@first}}, {{@last}}
 *   {{#if a}}..{{else}}..{{/if}}    {{#unless a}}..{{/unless}}   (falsy: false, 0, '', [])
 *   {{a|filter:arg|filter}}         sub sup radix:B num join:SEP plural:one,few,many expr code json
 * An argument may be quoted ("..") to keep spaces; the separator '|' is not allowed inside arguments.
 * Anything unknown (path, filter, unclosed block) is a TemplateError.
 */
export class TemplateError extends Error {}

type Filter = { name: string; arg: string | undefined };
type Node =
  | { t: 'text'; s: string }
  | { t: 'out'; path: string; filters: Filter[] }
  | { t: 'each'; path: string; body: Node[] }
  | { t: 'cond'; path: string; negate: boolean; then: Node[]; other: Node[] };

type Open = { kind: 'each' | 'if' | 'unless'; path: string; body: Node[]; other: Node[] | null; inElse: boolean };

const TAG = /\{\{([\s\S]*?)\}\}/g;

function parse(template: string): Node[] {
  const root: Node[] = [];
  const stack: Open[] = [];
  const target = (): Node[] => {
    const top = stack[stack.length - 1];
    return top ? (top.inElse ? top.other! : top.body) : root;
  };
  let last = 0;
  for (const m of template.matchAll(TAG)) {
    if (m.index > last) target().push({ t: 'text', s: template.slice(last, m.index) });
    last = m.index + m[0].length;
    const tag = m[1].trim();
    const block = /^#(each|if|unless)\s+(\S+)$/.exec(tag);
    if (block) {
      stack.push({ kind: block[1] as Open['kind'], path: block[2], body: [], other: block[1] === 'each' ? null : [], inElse: false });
    } else if (tag === 'else') {
      const top = stack[stack.length - 1];
      if (!top || top.kind === 'each' || top.inElse) throw new TemplateError('{{else}} outside of if/unless');
      top.inElse = true;
    } else if (tag.startsWith('/')) {
      const top = stack.pop();
      if (!top || top.kind !== tag.slice(1)) throw new TemplateError(`unexpected {{${tag}}}`);
      const node: Node =
        top.kind === 'each'
          ? { t: 'each', path: top.path, body: top.body }
          : { t: 'cond', path: top.path, negate: top.kind === 'unless', then: top.body, other: top.other ?? [] };
      target().push(node);
    } else {
      if (tag === '') throw new TemplateError('empty {{}}');
      const [path, ...rest] = tag.split('|');
      const filters = rest.map((f): Filter => {
        const i = f.indexOf(':');
        const name = (i < 0 ? f : f.slice(0, i)).trim();
        let arg = i < 0 ? undefined : f.slice(i + 1);
        if (arg !== undefined && arg.length >= 2 && arg.startsWith('"') && arg.endsWith('"')) arg = arg.slice(1, -1);
        return { name, arg };
      });
      target().push({ t: 'out', path: path.trim(), filters });
    }
  }
  if (last < template.length) target().push({ t: 'text', s: template.slice(last) });
  if (stack.length > 0) throw new TemplateError(`unclosed {{#${stack[stack.length - 1].kind} ${stack[stack.length - 1].path}}}`);
  return root;
}

type Frame = { item: FieldValue; n: number; first: boolean; last: boolean };

const isObject = (v: FieldValue | undefined): v is { readonly [k: string]: FieldValue } => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function lookup(path: string, frames: Frame[], root: Fields): FieldValue {
  if (path === '.') {
    const f = frames[frames.length - 1];
    if (!f) throw new TemplateError('{{.}} outside of {{#each}}');
    return f.item;
  }
  if (path === '@n') {
    const f = frames[frames.length - 1];
    if (!f) throw new TemplateError('{{@n}} outside of {{#each}}');
    return f.n;
  }
  if (path === '@first' || path === '@last') {
    const f = frames[frames.length - 1];
    if (!f) throw new TemplateError(`{{${path}}} outside of {{#each}}`);
    return path === '@first' ? f.first : f.last;
  }
  const [head, ...tail] = path.split('.');
  let value: FieldValue | undefined;
  for (let i = frames.length - 1; i >= 0 && value === undefined; i--) {
    const item = frames[i].item;
    if (isObject(item) && has(item, head)) value = item[head];
  }
  if (value === undefined && has(root, head)) value = root[head];
  if (value === undefined) throw new TemplateError(`unknown field "${path}"`);
  for (const seg of tail) {
    if (Array.isArray(value) && /^\d+$/.test(seg) && Number(seg) < value.length) value = (value as readonly FieldValue[])[Number(seg)];
    else if (isObject(value) && has(value, seg)) value = value[seg];
    else throw new TemplateError(`unknown field "${path}"`);
  }
  return value;
}

const truthy = (v: FieldValue): boolean => !(v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0));

const cp = String.fromCodePoint;
// Superscript digits: 0, 1-3 (Latin-1), 4-9; subscript digits 0-9.
const SUP = [0x2070, 0xb9, 0xb2, 0xb3, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079].map((c) => cp(c));
const SUB = [0x2080, 0x2081, 0x2082, 0x2083, 0x2084, 0x2085, 0x2086, 0x2087, 0x2088, 0x2089].map((c) => cp(c));
const MIDDOT = cp(0xb7);
const SUP_MINUS = cp(0x207b);
const SUB_MINUS = cp(0x208b);
const MINUS = cp(0x2212);
const THIN = cp(0x2009);

function scalar(v: FieldValue, what: string): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  throw new TemplateError(`${what}: a list or an object cannot be printed here`);
}

function script(text: string, digits: string[], sign: string, what: string): string {
  let out = '';
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') out += digits[Number(ch)];
    else if (ch === '-') out += sign;
    else throw new TemplateError(`${what}: cannot raise or lower "${ch}"`);
  }
  return out;
}

const supText = (text: string, what = 'sup') => script(text, SUP, SUP_MINUS, what);

function integerOf(v: FieldValue, what: string): bigint {
  const s = scalar(v, what);
  if (!/^-?\d+$/.test(s)) throw new TemplateError(`${what}: "${s}" is not an integer`);
  return BigInt(s);
}

function expr(v: FieldValue, what: string): string {
  if (!Array.isArray(v)) throw new TemplateError(`${what}: expr needs a list of {c,b,e}`);
  let out = '';
  (v as readonly FieldValue[]).forEach((term) => {
    if (!isObject(term)) throw new TemplateError(`${what}: expr needs a list of {c,b,e}`);
    const num = (k: string) => {
      const x = Number(scalar(term[k] ?? '', `${what}.${k}`));
      if (!Number.isInteger(x)) throw new TemplateError(`${what}: "${k}" must be an integer`);
      return x;
    };
    const c = num('c');
    const b = num('b');
    const e = num('e');
    if (c === 0) return;
    const abs = Math.abs(c);
    let body: string;
    if (e === 0 || b === 1) body = String(abs);
    else {
      const power = e === 1 ? String(b) : `${b}${supText(String(e), what)}`;
      body = abs === 1 ? power : `${abs}${MIDDOT}${power}`;
    }
    if (out === '') out = c < 0 ? `${MINUS}${body}` : body;
    else out += c < 0 ? ` ${MINUS} ${body}` : ` + ${body}`;
  });
  if (out === '') throw new TemplateError(`${what}: expr of an empty sum`);
  return out;
}

function plural(v: FieldValue, arg: string | undefined, what: string): string {
  const forms = (arg ?? '').split(',');
  if (forms.length !== 2 && forms.length !== 3) throw new TemplateError(`${what}: plural needs two or three forms`);
  const n = integerOf(v, what);
  const abs = n < 0n ? -n : n;
  if (forms.length === 2) return abs === 1n ? forms[0] : forms[1];
  const m10 = Number(abs % 10n);
  const m100 = Number(abs % 100n);
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

function applyFilter(v: FieldValue, f: Filter, what: string): FieldValue {
  switch (f.name) {
    case 'sub':
      return script(scalar(v, what), SUB, SUB_MINUS, `${what}|sub`);
    case 'sup':
      return supText(scalar(v, what), `${what}|sup`);
    case 'radix': {
      const base = Number(f.arg);
      if (!Number.isInteger(base) || base < 2 || base > 36) throw new TemplateError(`${what}: radix needs a base from 2 to 36`);
      return integerOf(v, what).toString(base).toUpperCase();
    }
    case 'num': {
      const s = scalar(v, what);
      const m = /^(-?)(\d+)(\.\d*)?$/.exec(s);
      if (!m) throw new TemplateError(`${what}: "${s}" is not a number`);
      return `${m[1]}${m[2].replace(/\B(?=(\d{3})+$)/g, THIN)}${m[3] ?? ''}`;
    }
    case 'join': {
      if (!Array.isArray(v)) throw new TemplateError(`${what}: join needs a list`);
      return (v as readonly FieldValue[]).map((x) => scalar(x, what)).join(f.arg ?? '');
    }
    case 'plural':
      return plural(v, f.arg, what);
    case 'expr':
      return expr(v, what);
    case 'json':
      return JSON.stringify(v);
    case 'code': {
      const s = scalar(v, what);
      return s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``;
    }
    default:
      throw new TemplateError(`${what}: unknown filter "${f.name}"`);
  }
}

function run(nodes: Node[], frames: Frame[], root: Fields): string {
  let out = '';
  for (const node of nodes) {
    if (node.t === 'text') out += node.s;
    else if (node.t === 'out') {
      let v = lookup(node.path, frames, root);
      for (const f of node.filters) v = applyFilter(v, f, node.path);
      out += scalar(v, node.path);
    } else if (node.t === 'cond') {
      out += run(truthy(lookup(node.path, frames, root)) !== node.negate ? node.then : node.other, frames, root);
    } else {
      const list = lookup(node.path, frames, root);
      if (!Array.isArray(list)) throw new TemplateError(`${node.path}: {{#each}} needs a list`);
      (list as readonly FieldValue[]).forEach((item, i) => {
        out += run(node.body, [...frames, { item, n: i + 1, first: i === 0, last: i === list.length - 1 }], root);
      });
    }
  }
  return out;
}

export function renderTemplate(template: string, scope: Fields): string {
  return run(parse(template), [], scope);
}
