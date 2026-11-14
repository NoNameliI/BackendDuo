import { describe, expect, it } from 'vitest';
import { nodePython } from '../../../scripts/pyodide/node';

const APP = `
from typing import Annotated
from fastapi import FastAPI, Header, HTTPException
import itertools

app = FastAPI()
counter = itertools.count(1)
tokens = set()

@app.post("/token")
def token():
    value = f"t{next(counter)}"
    tokens.add(value)
    return {"access_token": value, "token_type": "bearer"}

@app.get("/me")
def me(authorization: Annotated[str, Header()], seen: list[str] = Header(default=[], alias="x-studio-save")):
    if authorization.removeprefix("Bearer ") not in tokens:
        raise HTTPException(401)
    return {"token": authorization, "save_header_seen": seen}
`;

describe('saved fields between hidden requests', () => {
  it('fills {{name}} from an earlier answer and hides the save header from the app', async () => {
    const py = await nodePython();
    const run = await py.run(APP, [
      { method: 'POST', url: '/token', headers: [{ name: 'x-studio-save', value: 'tok=access_token' }], body: '' },
      { method: 'GET', url: '/me?x={{tok}}', headers: [{ name: 'Authorization', value: 'Bearer {{tok}}' }], body: '' },
    ]);
    expect(run.responses.map((r) => r.status)).toEqual([200, 200]);
    expect(JSON.parse(run.responses[1].body)).toEqual({ token: 'Bearer t1', save_header_seen: [] });
  }, 120_000);
});
