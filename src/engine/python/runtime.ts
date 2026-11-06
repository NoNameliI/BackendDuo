import { splitUrl, type ApiRequest, type HttpHeader } from '@/engine/api/http';
import runtimeSource from './studio_runtime.py?raw';

/** The part of a Pyodide instance the runtime uses (the worker and Node pass the real one). */
export interface PyodideLike {
  runPython(code: string): unknown;
  unpackArchive(buffer: Uint8Array, format: string, options?: { extractDir?: string }): void;
  FS: { writeFile(path: string, data: string): void };
  pyimport(name: string): {
    run(source: string, requests: string, keep: boolean): Promise<string>;
    forget(): void;
    script(source: string, files: string): string;
  };
}

export interface PythonError {
  /** syntax: main.py does not parse; load: it fails while running; request: an endpoint raised. */
  kind: 'syntax' | 'load' | 'request';
  type: string;
  message: string;
  line: number | null;
}

export interface PyResponse {
  status: number;
  headers: HttpHeader[];
  body: string;
  ms: number;
  error?: PythonError;
}

export interface AppRun {
  load: { ok: true } | { ok: false; error: PythonError };
  responses: PyResponse[];
  /** What print() wrote, for the learner's debugging. */
  output: string;
}

/** A standalone script run (the drill scratch pad): what it printed and how it ended. */
export interface ScriptRun {
  output: string;
  error?: PythonError;
  ms: number;
}

export type ScriptRunner = (source: string, files: Record<string, string>) => ScriptRun;

export type AppRunner = (source: string, requests: ApiRequest[], options?: { keep?: boolean }) => Promise<AppRun>;

const toWire = (req: ApiRequest) => {
  const { path, query } = splitUrl(req.url);
  return {
    method: req.method,
    path: path || '/',
    query: query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'),
    headers: req.headers.map((h) => [h.name, h.value]),
    body: req.body,
  };
};

/** Unpacks the precompiled packages, installs the runtime module and returns a runner of learner apps. */
export function setupRuntime(pyodide: PyodideLike, siteArchive: Uint8Array): { run: AppRunner; forget: () => void; script: ScriptRunner } {
  const sitePackages = pyodide.runPython('import site; site.getsitepackages()[0]') as string;
  pyodide.unpackArchive(siteArchive, 'gztar', { extractDir: sitePackages });
  pyodide.FS.writeFile(`${sitePackages}/studio_runtime.py`, runtimeSource);
  pyodide.runPython('import importlib; importlib.invalidate_caches()');
  const runtime = pyodide.pyimport('studio_runtime');
  return {
    async run(source, requests, options = {}) {
      const raw = await runtime.run(source, JSON.stringify(requests.map(toWire)), Boolean(options.keep));
      const parsed = JSON.parse(raw) as Omit<AppRun, 'responses'> & { responses: (Omit<PyResponse, 'headers'> & { headers: [string, string][] })[] };
      return { ...parsed, responses: parsed.responses.map((r) => ({ ...r, headers: r.headers.map(([name, value]) => ({ name, value })) })) };
    },
    forget: () => runtime.forget(),
    script: (source, files) => JSON.parse(runtime.script(source, JSON.stringify(files))) as ScriptRun,
  };
}
