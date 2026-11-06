// Sealed packs: a set of text files encrypted with a key derived from an access code (WebCrypto only).
// Pack text: JSON { format, kdf: PBKDF2/SHA-256 + salt, cipher: AES-GCM + iv, data }, where data is the
// ciphertext of a gzip-compressed JSON document { files }.

export const PACK_ITERATIONS = 600_000;

const FORMAT = 'sealed-1';
const SALT_BYTES = 16;
const IV_BYTES = 12;

export class SealedError extends Error {}

interface PackDoc {
  format: string;
  kdf: { name: string; hash: string; iterations: number; salt: string };
  cipher: { name: string; iv: string };
  data: string;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  try {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    throw new SealedError('bad base64');
  }
}

async function pipe(data: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([data]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function parsePack(pack: string): PackDoc {
  let doc: PackDoc;
  try {
    doc = JSON.parse(pack) as PackDoc;
  } catch {
    throw new SealedError('bad pack');
  }
  const ok =
    doc !== null &&
    typeof doc === 'object' &&
    doc.format === FORMAT &&
    doc.kdf?.name === 'PBKDF2' &&
    doc.kdf.hash === 'SHA-256' &&
    Number.isInteger(doc.kdf.iterations) &&
    doc.kdf.iterations > 0 &&
    typeof doc.kdf.salt === 'string' &&
    doc.cipher?.name === 'AES-GCM' &&
    typeof doc.cipher.iv === 'string' &&
    typeof doc.data === 'string';
  if (!ok) throw new SealedError('bad pack');
  return doc;
}

export function packSalt(pack: string): { salt: string; iterations: number } {
  const doc = parsePack(pack);
  return { salt: doc.kdf.salt, iterations: doc.kdf.iterations };
}

export async function deriveKey(code: string, salt: string, iterations: number): Promise<Uint8Array> {
  try {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(code.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations }, material, 256);
    return new Uint8Array(bits);
  } catch (e) {
    throw e instanceof SealedError ? e : new SealedError('key derivation failed');
  }
}

const aesKey = (raw: Uint8Array, usage: KeyUsage) => crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, 'AES-GCM', false, [usage]);

export async function sealFiles(files: Record<string, string>, code: string, options: { iterations?: number } = {}): Promise<string> {
  // Only tests pass fewer iterations; real packs always use PACK_ITERATIONS.
  const iterations = options.iterations ?? PACK_ITERATIONS;
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await aesKey(await deriveKey(code, salt, iterations), 'encrypt');
  const plain = await pipe(new TextEncoder().encode(JSON.stringify({ files })), new CompressionStream('gzip'));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const doc: PackDoc = {
    format: FORMAT,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(cipher),
  };
  return JSON.stringify(doc);
}

export async function openPack(pack: string, rawKey: Uint8Array): Promise<Record<string, string>> {
  const doc = parsePack(pack);
  try {
    const key = await aesKey(rawKey, 'decrypt');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(doc.cipher.iv) }, key, fromBase64(doc.data));
    const json = new TextDecoder().decode(await pipe(new Uint8Array(plain), new DecompressionStream('gzip')));
    const files = (JSON.parse(json) as { files?: unknown }).files;
    if (files === null || typeof files !== 'object') throw new SealedError('bad content');
    return files as Record<string, string>;
  } catch (e) {
    throw e instanceof SealedError ? e : new SealedError('cannot open pack');
  }
}
