// Every lazy package group (built by scripts/pyodide/prepare.mjs) must import in a fresh interpreter that has
// the base site plus that group only, unpacked the way the app's worker does it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPyodide } from 'pyodide';
import { describe, expect, it } from 'vitest';
import { nodeGroups } from './node';

const dir = join(process.cwd(), 'public', 'pyodide').replaceAll('\\', '/');
const manifest = JSON.parse(readFileSync(`${dir}/groups.json`, 'utf8')) as Record<string, { file: string; bytes: number; packages: string[] }>;

const SMOKE: Record<string, string> = {
  client: 'import httpx, fastapi.testclient',
  pytest: `
import contextlib, io, os, pytest
os.makedirs("/tmp/t", exist_ok=True)
with open("/tmp/t/test_a.py", "w") as f:
    f.write("def test_a():\\n    assert 1 == 2\\n")
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    code = pytest.main(["-q", "-p", "no:cacheprovider", "--color=no", "/tmp/t/test_a.py"])
assert code == 1 and "assert 1 == 2" in buf.getvalue()
`,
  db: `
import sqlalchemy.orm
from sqlalchemy import create_engine, text
with create_engine("sqlite://").connect() as c:
    assert c.execute(text("select 1")).scalar() == 1
`,
  bcrypt: 'import bcrypt\nassert bcrypt.checkpw(b"x", bcrypt.hashpw(b"x", bcrypt.gensalt(rounds=4)))',
  multipart: 'from fastapi import FastAPI, Form\napp = FastAPI()\n@app.post("/x")\ndef x(name: str = Form()):\n    return {"name": name}',
  jwt: 'import jwt\nassert jwt.decode(jwt.encode({"a": 1}, "k" * 32, algorithm="HS256"), "k" * 32, algorithms=["HS256"]) == {"a": 1}',
  settings: 'import pydantic_settings, dotenv',
};

describe('lazy package groups', () => {
  it('has a smoke import for every group in groups.json', () => {
    expect(Object.keys(SMOKE).sort()).toEqual(Object.keys(manifest).sort());
  });

  for (const name of Object.keys(SMOKE)) {
    it(`${name}: imports on top of the base site`, async () => {
      const pyodide = await loadPyodide({ indexURL: `${dir}/`, stdout: () => {}, stderr: () => {} });
      const sitePackages = pyodide.runPython('import site; site.getsitepackages()[0]') as string;
      pyodide.unpackArchive(new Uint8Array(readFileSync(`${dir}/site.tar.gz`)), 'gztar', { extractDir: sitePackages });
      pyodide.unpackArchive(nodeGroups([name])[name]!, 'gztar', { extractDir: sitePackages });
      pyodide.runPython('import importlib; importlib.invalidate_caches()');
      expect(() => pyodide.runPython(SMOKE[name]!)).not.toThrow();
    }, 60_000);
  }
});
