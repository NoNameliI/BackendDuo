import { splitUrl, type ApiRequest, type HttpHeader } from '@/engine/api/http';
import { createBridge, createClientSandbox, type Bridge, type BrokerOp, type ClientSetup } from './brokerBridge';
import confluentKafkaShim from './shims/confluent_kafka.py?raw';
import pikaShim from './shims/pika.py?raw';
import inlineLoopSource from './inline_loop.py?raw';
import runtimeSource from './studio_runtime.py?raw';
import staticRulesSource from './static_rules.py?raw';

/** The part of a Pyodide instance the runtime uses (the worker and Node pass the real one). */
export interface PyodideLike {
  runPython(code: string): unknown;
  unpackArchive(buffer: Uint8Array, format: string, options?: { extractDir?: string }): void;
  FS: { writeFile(path: string, data: string): void };
  registerJsModule(name: string, module: object): void;
  pyimport(name: string): {
    run(project: string, requests: string, keep: boolean): string;
    forget(): void;
    script(source: string, files: string): string;
    client(source: string): string;
    test(project: string, args: string): string;
    analyze(project: string, rules: string): string;
  };
}

/** Learner files by project-relative path: 'main.py', 'routers/items.py', 'tests/test_x.py'. */
export type ProjectFiles = Record<string, string>;

/** `entry` defaults to 'main.py'; 'app/main.py' is the module app.main. */
export interface Project {
  files: ProjectFiles;
  entry?: string;
}

export const asProject = (p: Project | string): Project => (typeof p === 'string' ? { files: { 'main.py': p } } : p);

export interface PythonError {
  /** syntax: a file does not parse; load: it fails while running; request: an endpoint raised. */
  kind: 'syntax' | 'load' | 'request';
  type: string;
  message: string;
  line: number | null;
  /** Project-relative file of the deepest learner frame (or of the syntax error). */
  file: string | null;
  /** Learner frames only, outermost first, at most 8. */
  trace: { file: string; line: number; name: string }[];
}

export interface PyResponse {
  status: number;
  headers: HttpHeader[];
  body: string;
  ms: number;
  error?: PythonError;
  /** What print(), logging and warnings wrote while this request ran (background tasks included). */
  output: string;
  /** http.response.body messages that carried data: more than one means a streamed answer. */
  chunks: number;
}

export interface AppRun {
  load: { ok: true } | { ok: false; error: PythonError };
  responses: PyResponse[];
  /** What the project wrote while loading and in its lifespan (startup, shutdown). */
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

export interface PytestCase {
  nodeid: string;
  outcome: 'passed' | 'failed' | 'error' | 'skipped';
  /** The crash lines of pytest (`E   assert 404 == 200`), at most 600 characters. */
  message: string;
  file: string | null;
  line: number | null;
}

export interface PytestRun {
  exit: number;
  counts: { passed: number; failed: number; error: number; skipped: number };
  tests: PytestCase[];
  output: string;
  ms: number;
}

export type ClientRunner = (source: string, setup: ClientSetup) => ClientRun;

export type ScriptRunner = (source: string, files: Record<string, string>) => ScriptRun;

export type AppRunner = (project: Project | string, requests: ApiRequest[], options?: { keep?: boolean; reference?: boolean }) => Promise<AppRun>;

/** Rules of `check.static`; every rule may carry its own Russian `message`. */
export type StaticRule = { message?: string } & (
  | { rule: 'uses'; name: string; file?: string }
  | { rule: 'imports'; module: string; name?: string }
  | { rule: 'no-blocking-in-async'; calls?: string[]; file?: string }
  | { rule: 'router'; file: string }
  | { rule: 'response-model-hides'; field: string }
  | { rule: 'no-literal-secret'; names: string[] }
  | { rule: 'pattern'; regex: string; forbid?: boolean }
  | { rule: 'tests-api-only' }
);

export interface AnalyzeResult {
  /** Russian problems naming file:line; empty when every rule holds. */
  problems: string[];
}

export type Analyzer = (project: Project, rules: StaticRule[]) => AnalyzeResult;

export type TestRunner = (project: Project, args?: string[]) => PytestRun;

export interface PythonRuntime {
  run: AppRunner;
  forget: () => void;
  script: ScriptRunner;
  client: ClientRunner;
  test: TestRunner;
  /** Parses the project with ast and applies the rules; learner code is never executed. */
  analyze: Analyzer;
  /** Unpacks lazy package groups (name → archive) once each; returns the names added by this call. */
  addPackages: (archives: Record<string, Uint8Array>) => string[];
}

const toWire = (req: ApiRequest) => {
  const { path, query } = splitUrl(req.url);
  return {
    method: req.method,
    path: path || '/',
    query: query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'),
    headers: req.headers.map((h) => [h.name, h.value]),
    // A request written as text has \n line ends; a multipart body needs CRLF between its parts, as a client sends it.
    body: /^multipart\//i.test(req.headers.find((h) => h.name.toLowerCase() === 'content-type')?.value.trim() ?? '') ? req.body.replace(/\r?\n/g, '\r\n') : req.body,
  };
};

/** Unpacks the precompiled packages, installs the runtime module and returns a runner of learner apps. */
export function setupRuntime(pyodide: PyodideLike, siteArchive: Uint8Array): PythonRuntime {
  const sitePackages = pyodide.runPython('import site; site.getsitepackages()[0]') as string;
  pyodide.unpackArchive(siteArchive, 'gztar', { extractDir: sitePackages });
  pyodide.FS.writeFile(`${sitePackages}/inline_loop.py`, inlineLoopSource);
  pyodide.FS.writeFile(`${sitePackages}/studio_runtime.py`, runtimeSource);
  pyodide.FS.writeFile(`${sitePackages}/static_rules.py`, staticRulesSource);
  pyodide.FS.writeFile(`${sitePackages}/pika.py`, pikaShim);
  pyodide.FS.writeFile(`${sitePackages}/confluent_kafka.py`, confluentKafkaShim);
  // The shims reach the simulator of the run in progress through this one function.
  let current: Bridge | null = null;
  pyodide.registerJsModule('_studio_broker', { call: (json: string) => (current ? current.call(json) : JSON.stringify({ stop: true })) });
  pyodide.runPython('import importlib; importlib.invalidate_caches()');
  const runtime = pyodide.pyimport('studio_runtime');
  // Imported before any learner code runs: the module keeps its own references to ast, json and re.
  const rules = pyodide.pyimport('static_rules');
  const loaded = new Set<string>();
  return {
    async run(project, requests, options = {}) {
      const raw = runtime.run(JSON.stringify(asProject(project)), JSON.stringify(requests.map(toWire)), Boolean(options.keep));
      const parsed = JSON.parse(raw) as Omit<AppRun, 'responses'> & { responses: (Omit<PyResponse, 'headers'> & { headers: [string, string][] })[] };
      return { ...parsed, responses: parsed.responses.map((r) => ({ ...r, headers: r.headers.map(([name, value]) => ({ name, value })) })) };
    },
    forget: () => runtime.forget(),
    script: (source, files) => JSON.parse(runtime.script(source, JSON.stringify(files))) as ScriptRun,
    test: (project, args = []) => JSON.parse(runtime.test(JSON.stringify(project), JSON.stringify(args))) as PytestRun,
    analyze: (project, list) => JSON.parse(rules.analyze(JSON.stringify(asProject(project)), JSON.stringify(list))) as AnalyzeResult,
    addPackages(archives) {
      const added = Object.keys(archives).filter((name) => !loaded.has(name));
      for (const name of added) {
        pyodide.unpackArchive(archives[name], 'gztar', { extractDir: sitePackages });
        loaded.add(name);
      }
      if (added.length) pyodide.runPython('import importlib; importlib.invalidate_caches()');
      // Starlette looks for python-multipart once, when its modules are first imported (FastAPI imports them at start):
      // fill in what it found missing, so forms work in a worker that loaded Python before the group arrived.
      if (added.includes('multipart')) {
        pyodide.runPython(
          // reload keeps the module's dict, so parser classes already imported elsewhere see the new globals.
          'import importlib, sys\nfrom python_multipart.multipart import parse_options_header\nif "starlette.formparsers" in sys.modules: importlib.reload(sys.modules["starlette.formparsers"])\nif "starlette.requests" in sys.modules: sys.modules["starlette.requests"].parse_options_header = parse_options_header',
        );
      }
      return added;
    },
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
