import type { ApiRequest } from '@/engine/api/http';
import { cutOff, noCodeFromStrings } from '../isolate';
import { setupRuntime, type AppRunner, type PyodideLike } from './runtime';

export type PythonRequest =
  | { id: number; op: 'init' }
  | { id: number; op: 'run'; source: string; requests: ApiRequest[]; keep: boolean }
  | { id: number; op: 'forget' };

export type PythonReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

const scope = self as unknown as {
  onmessage: (event: MessageEvent<PythonRequest>) => void;
  postMessage: (message: PythonReply) => void;
  location: Location;
};

let runtime: Promise<{ run: AppRunner; forget: () => void; loadMs: number }> | null = null;

// Python, its standard library and the precompiled packages are files of the app (public/pyodide). They are
// loaded first; then the worker loses every way out (network, storage, nested workers) before any learner code runs.
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
  cutOff(self);
  noCodeFromStrings(self);
  return { ...ready, loadMs: Math.round(performance.now() - started) };
}

scope.onmessage = async ({ data }) => {
  try {
    if (data.op === 'init') {
      runtime ??= start();
      const { loadMs } = await runtime;
      scope.postMessage({ id: data.id, ok: true, value: { loadMs } });
      return;
    }
    if (!runtime) throw new Error('Python ещё не запущен');
    const { run, forget } = await runtime;
    if (data.op === 'forget') {
      forget();
      scope.postMessage({ id: data.id, ok: true, value: null });
      return;
    }
    scope.postMessage({ id: data.id, ok: true, value: await run(data.source, data.requests, { keep: data.keep }) });
  } catch (e) {
    scope.postMessage({ id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
