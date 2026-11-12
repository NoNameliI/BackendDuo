import { splitUrl, type ApiRequest, type HttpHeader } from '@/engine/api/http';
import { createBridge, createClientSandbox, type Bridge, type BrokerOp, type ClientSetup } from './brokerBridge';
import confluentKafkaShim from './shims/confluent_kafka.py?raw';
import pikaShim from './shims/pika.py?raw';
import runtimeSource from './studio_runtime.py?raw';

/** The part of a Pyodide instance the runtime uses (the worker and Node pass the real one). */
export interface PyodideLike {
  runPython(code: string): unknown;
  unpackArchive(buffer: Uint8Array, format: string, options?: { extractDir?: string }): void;
  FS: { writeFile(path: string, data: string): void };
  registerJsModule(name: string, module: object): void;
  pyimport(name: string): {
    run(source: string, requests: string, keep: boolean): Promise<string>;
    forget(): void;
    script(source: string, files: string): string;
    client(source: string): string;
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

/** A broker client program (pika, confluent_kafka) run against a fresh simulator, and everything it did there. */
export interface ClientRun {
  output: string;
  error?: PythonError;
  /** The sandbox horizon ended an endless wait: a clean stop, not a mistake of the program. */
  stopped: boolean;
  /** Operations on the broker in order; the app repeats them on its own simulator. */
  ops: BrokerOp[];
  ms: number;
}

export type ClientRunner = (source: string, setup: ClientSetup) => ClientRun;

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
export function setupRuntime(pyodide: PyodideLike, siteArchive: Uint8Array): { run: AppRunner; forget: () => void; script: ScriptRunner; client: ClientRunner } {
  const sitePackages = pyodide.runPython('import site; site.getsitepackages()[0]') as string;
  pyodide.unpackArchive(siteArchive, 'gztar', { extractDir: sitePackages });
  pyodide.FS.writeFile(`${sitePackages}/studio_runtime.py`, runtimeSource);
  pyodide.FS.writeFile(`${sitePackages}/pika.py`, pikaShim);
  pyodide.FS.writeFile(`${sitePackages}/confluent_kafka.py`, confluentKafkaShim);
  // The shims reach the simulator of the run in progress through this one function.
  let current: Bridge | null = null;
  pyodide.registerJsModule('_studio_broker', { call: (json: string) => (current ? current.call(json) : JSON.stringify({ stop: true })) });
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
    client(source, setup) {
      const bridge = createBridge(createClientSandbox(setup));
      current = bridge;
      try {
        const parsed = JSON.parse(runtime.client(source)) as Omit<ClientRun, 'ops'>;
        return { ...parsed, stopped: parsed.stopped || bridge.stopped, ops: bridge.ops };
      } finally {
        current = null;
      }
    },
  };
}
