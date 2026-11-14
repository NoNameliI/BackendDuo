import { beforeAll, describe, expect, it } from 'vitest';
import { freshNodePythonWith } from '../../../scripts/pyodide/node';
import type { PythonRuntime } from './runtime';

let py: PythonRuntime;
beforeAll(async () => {
  py = await freshNodePythonWith(['client']);
}, 90_000);

const APP = `
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from pydantic import BaseModel

events = []

@asynccontextmanager
async def lifespan(app):
    app.state.items = {"a": 1}
    events.append("startup")
    yield
    events.append("shutdown")

app = FastAPI(lifespan=lifespan)

class Item(BaseModel):
    name: str
    price: float

@app.get("/items/{key}")
def read(key: str, request: Request):
    if key not in request.app.state.items:
        raise HTTPException(404, "нет такого")
    return {"key": key, "value": request.app.state.items[key]}

@app.post("/items", status_code=201)
def create(item: Item):
    return item

@app.get("/boom")
def boom():
    raise ValueError("boom")
`;

describe('TestClient', () => {
  it('is the real class: requests, validation, lifespan inside with', () => {
    const run = py.script(
      `${APP}
client = TestClient(app)
print(client.post("/items", json={"name": "tea", "price": 1.5}).status_code)
print(client.post("/items", json={"name": "tea"}).json()["detail"][0]["loc"])
print(hasattr(app.state, "items"), "no lifespan without with")
with TestClient(app) as c:
    print(c.get("/items/a").json(), c.get("/items/zz").status_code)
print(events)
print(type(client).__module__)
`,
      {},
    );
    expect(run.error).toBeUndefined();
    expect(run.output).toBe(
      ['201', "['body', 'price']", 'False no lifespan without with', "{'key': 'a', 'value': 1} 404", "['startup', 'shutdown']", 'starlette.testclient', ''].join('\n'),
    );
  });

  it('raises the server error by default and answers 500 on request', () => {
    const run = py.script(
      `${APP}
try:
    TestClient(app).get("/boom")
except ValueError as e:
    print("raised", e)
print(TestClient(app, raise_server_exceptions=False).get("/boom").status_code)
`,
      {},
    );
    expect(run.error).toBeUndefined();
    expect(run.output).toBe('raised boom\n500\n');
  });

  it('streams with a virtual clock and works with websockets', () => {
    const run = py.script(
      `import asyncio
from fastapi import FastAPI, WebSocket
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

app = FastAPI()

@app.get("/s")
async def s():
    async def gen():
        for i in range(3):
            await asyncio.sleep(30)
            yield f"{i};"
    return StreamingResponse(gen())

@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({"hello": await websocket.receive_text()})
    await websocket.close()

with TestClient(app) as c:
    print(c.get("/s").text)
    with c.websocket_connect("/ws") as w:
        w.send_text("ann")
        print(w.receive_json())
`,
      {},
    );
    expect(run.error).toBeUndefined();
    expect(run.output).toBe("0;1;2;\n{'hello': 'ann'}\n");
    expect(run.ms).toBeLessThan(5000);
  });

  it('answers 50 GETs quickly', () => {
    const run = py.script(
      `${APP}
import time
with TestClient(app) as client:
    t = time.perf_counter()
    for _ in range(50):
        assert client.get("/items/zz").status_code == 404
    print(round((time.perf_counter() - t) * 1000))
`,
      {},
    );
    expect(run.error).toBeUndefined();
    const ms = Number(run.output);
    console.log(`TestClient 50 GETs: ${ms} ms`);
    expect(ms).toBeLessThan(5000);
  });

  it('does not disturb run(): the app still answers over the studio driver', async () => {
    const run = await py.run(APP, [{ method: 'GET', url: '/items/a', headers: [], body: '' }]);
    expect(run.load).toEqual({ ok: true });
    expect(run.responses[0].status).toBe(200);
  });
});
