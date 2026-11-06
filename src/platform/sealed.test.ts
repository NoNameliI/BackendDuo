import { describe, expect, it } from 'vitest';
import { deriveKey, openPack, PACK_ITERATIONS, packSalt, sealFiles, SealedError } from './sealed';

const CODE = 'test-access-0001';
const FILES = { '/sealed/t1/a.txt': 'hello', '/sealed/t1/b.txt': 'привет\nworld' };
const FAST = { iterations: 1000 };

async function open(pack: string, code: string) {
  const { salt, iterations } = packSalt(pack);
  return openPack(pack, await deriveKey(code, salt, iterations));
}

describe('sealed packs', () => {
  it('round-trips files', async () => {
    const pack = await sealFiles(FILES, CODE, FAST);
    expect(await open(pack, CODE)).toEqual(FILES);
  });

  it('rejects a wrong code', async () => {
    const pack = await sealFiles(FILES, CODE, FAST);
    await expect(open(pack, 'test-access-0002')).rejects.toBeInstanceOf(SealedError);
  });

  it('rejects tampered data', async () => {
    const pack = await sealFiles(FILES, CODE, FAST);
    const doc = JSON.parse(pack);
    const bytes = Buffer.from(doc.data, 'base64');
    bytes[3] ^= 1;
    doc.data = bytes.toString('base64');
    await expect(open(JSON.stringify(doc), CODE)).rejects.toBeInstanceOf(SealedError);
  });

  it('rejects bad JSON and wrong format', async () => {
    expect(() => packSalt('not json')).toThrow(SealedError);
    const doc = JSON.parse(await sealFiles(FILES, CODE, FAST));
    expect(() => packSalt(JSON.stringify({ ...doc, format: 'sealed-2' }))).toThrow(SealedError);
    await expect(openPack('{}', new Uint8Array(32))).rejects.toBeInstanceOf(SealedError);
  });

  it('uses random salt and iv', async () => {
    const a = JSON.parse(await sealFiles(FILES, CODE, FAST));
    const b = JSON.parse(await sealFiles(FILES, CODE, FAST));
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
  });

  it('records the default iteration count', async () => {
    expect(PACK_ITERATIONS).toBe(600000);
    const pack = await sealFiles(FILES, CODE);
    expect(packSalt(pack).iterations).toBe(600000);
    expect(await open(pack, CODE)).toEqual(FILES);
  }, 30_000);
});
