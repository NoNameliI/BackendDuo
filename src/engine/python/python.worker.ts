import { cutOff, noCodeFromStrings } from '../isolate';
import { CONNECT, type PythonReply, type PythonRequest } from './protocol';
import { setupRuntime, type AppRunner, type PyodideLike } from './runtime';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  location: Location;
};

let runtime: Promise<{ run: AppRunner; forget: () => void; loadMs: number }> | null = null;

// Python, its standard library and the precompiled packages are files of the app (public/pyodide). They are
// loaded first; then the worker loses every way out (network, storage, nested workers, its own postMessage)
// before any learner code runs. Only the private port below still talks to the app.
async function start() {
  const started = performance.now();
  const base = new URL('/pyodide/', scope.location.href).href;
  const { loadPyodide } = (await import(/* @vite-ignore */ `${base}pyodide.mjs`)) as {
    loadPyodide: (options: { indexURL: string; stdout?: (s: string) => void; stderr?: (s: string) => void }) => Promise<PyodideLike>;
  };
  const [pyodide, archive] = await Promise.all([
    loadPyodide({ indexURL: base, stdout: () => {}, stderr: () => {} }),
    fetch(`${base}site.tar.gz`).then(async (res) => {
      if (!res.ok) throw new Error(`site.tar.gz: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }),
  ]);
  const ready = setupRuntime(pyodide, archive);
  // The first import of FastAPI is the slow part; doing it here makes the learner's first run fast.
  await ready.run('from fastapi import FastAPI\napp = FastAPI()', []);
  cutOff(self, ['postMessage', 'onmessage', 'onmessageerror', 'close']);
  noCodeFromStrings(self);
  return { ...ready, loadMs: Math.round(performance.now() - started) };
}

function serve(port: MessagePort) {
  const reply = (message: PythonReply) => port.postMessage(message);
  port.onmessage = async ({ data }: MessageEvent<PythonRequest>) => {
    try {
      if (data.op === 'init') {
        runtime ??= start();
        const { loadMs } = await runtime;
        reply({ id: data.id, ok: true, value: { loadMs } });
        return;
      }
      if (!runtime) throw new Error('Python ещё не запущен');
      const { run, forget } = await runtime;
      if (data.op === 'forget') {
        forget();
        reply({ id: data.id, ok: true, value: null });
        return;
      }
      reply({ id: data.id, ok: true, value: await run(data.source, data.requests, { keep: data.keep }) });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      reply({ id: data.id, ok: false, error, fatal: /fatal error/i.test(error) });
    }
  };
}

scope.onmessage = ({ data, ports }) => {
  if (data !== CONNECT || !ports[0]) return;
  scope.onmessage = null;
  serve(ports[0]);
};
