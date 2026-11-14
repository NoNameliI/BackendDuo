import { describe, expect, it } from 'vitest';
import { splitRequests } from '@/engine/api/server';
import { ignoredFields, stripPythonComments, testMarks } from './fastapi';

describe('ignoredFields', () => {
  it('reads the mark on the ### line before each request', () => {
    const text = 'POST /login\n\n### ignore: access_token, expires\nPOST /token\n###\nGET /me\n### ignore\nGET /time\n### just a note\nGET /x\n';
    expect(splitRequests(text)).toHaveLength(5);
    expect(ignoredFields(text)).toEqual([null, ['access_token', 'expires'], null, '*', null]);
  });
  it('ignores empty blocks like splitRequests does', () => {
    expect(ignoredFields('### ignore\n\n###\nGET /a\n')).toEqual([null]);
  });
});

describe('testMarks', () => {
  it('reads ignore and save parts separated by ;', () => {
    const text = '### ignore: access_token; save token = access_token\nPOST /token\n###\nGET /me\nAuthorization: Bearer {{token}}\n';
    expect(testMarks(text)).toEqual([
      { ignore: ['access_token'], save: [['token', 'access_token']] },
      { ignore: null, save: [] },
    ]);
  });
});

describe('stripPythonComments', () => {
  it('drops comments but keeps # inside strings', () => {
    const src = 'x = 1  # compare_digest\ns = "a # b"\nt = \'\'\'doc # kept\n# also kept\'\'\'\n# whole line\ny = 2';
    expect(stripPythonComments(src)).toBe('x = 1  \ns = "a # b"\nt = \'\'\'doc # kept\n# also kept\'\'\'\n\ny = 2');
  });
});
