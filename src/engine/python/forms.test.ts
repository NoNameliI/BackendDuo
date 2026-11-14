import { describe, expect, it } from 'vitest';
import { freshNodePython, nodeGroups } from '../../../scripts/pyodide/node';

const APP = `
from typing import Annotated
from fastapi import FastAPI, Form, UploadFile

app = FastAPI()

@app.post("/login")
def login(username: Annotated[str, Form()], password: Annotated[str, Form()]):
    return {"user": username, "len": len(password)}

@app.post("/upload")
async def upload(file: UploadFile):
    data = await file.read()
    return {"name": file.filename, "size": len(data)}
`;

describe('forms after a late multipart group', () => {
  it('works in an interpreter that imported FastAPI before the group arrived', async () => {
    const py = await freshNodePython();
    // FastAPI (and starlette.formparsers) are imported first, as the worker does at start.
    await py.run('from fastapi import FastAPI\napp = FastAPI()', []);
    expect(py.addPackages(nodeGroups(['multipart']))).toEqual(['multipart']);
    const form = { method: 'POST', url: '/login', headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }], body: 'username=ann&password=secret' };
    const body = ['--XyZ', 'Content-Disposition: form-data; name="file"; filename="a.txt"', 'Content-Type: text/plain', '', 'hello', '--XyZ--', ''].join('\n');
    const multipart = { method: 'POST', url: '/upload', headers: [{ name: 'Content-Type', value: 'multipart/form-data; boundary=XyZ' }], body };
    const run = await py.run(APP, [form, multipart]);
    expect(run.load).toEqual({ ok: true });
    expect(run.responses.map((r) => [r.status, JSON.parse(r.body)])).toEqual([
      [200, { user: 'ann', len: 6 }],
      [200, { name: 'a.txt', size: 5 }],
    ]);
  }, 120_000);
});
