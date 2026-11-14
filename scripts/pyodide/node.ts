// Python for tests and validate:content: the same runtime as the app's worker, run directly in Node from the
// files prepared by scripts/pyodide/prepare.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPyodide } from 'pyodide';
import type { CourseRuntime } from '@/checker/fastapiCourse';
import { setupRuntime, type PyodideLike } from '@/engine/python/runtime';

const dir = join(process.cwd(), 'public', 'pyodide').replaceAll('\\', '/');

let shared: ReturnType<typeof setupRuntime> | null = null;

/** A new interpreter with its own runtime (what a respawned worker is). */
export async function freshNodePython(): Promise<ReturnType<typeof setupRuntime>> {
  const pyodide = await loadPyodide({ indexURL: `${dir}/`, stdout: () => {}, stderr: () => {} });
  return setupRuntime(pyodide as unknown as PyodideLike, new Uint8Array(readFileSync(`${dir}/site.tar.gz`)));
}

/** Archives of lazy package groups (public/pyodide/groups/<name>.tar.gz), keyed by group name. */
export function nodeGroups(names: string[]): Record<string, Uint8Array> {
  return Object.fromEntries(names.map((name) => [name, new Uint8Array(readFileSync(`${dir}/groups/${name}.tar.gz`))]));
}

/** A new interpreter with the given lazy package groups already unpacked (what a worker is after `ensure`). */
export async function freshNodePythonWith(groups: string[]): Promise<ReturnType<typeof setupRuntime>> {
  const runtime = await freshNodePython();
  runtime.addPackages(nodeGroups(groups));
  return runtime;
}

export async function nodePython(): Promise<ReturnType<typeof setupRuntime>> {
  shared ??= await freshNodePython();
  return shared;
}

/** The runtime as the course checks use it (src/checker/fastapiCourse.ts): lazy groups are unpacked before a run, one interpreter serves all. */
export async function nodeCourseRuntime(): Promise<CourseRuntime> {
  const runtime = await nodePython();
  const loaded = new Set<string>();
  const ensure = (groups: string[] = []) => {
    const missing = groups.filter((g) => !loaded.has(g));
    if (missing.length === 0) return;
    runtime.addPackages(nodeGroups(missing));
    missing.forEach((g) => loaded.add(g));
  };
  return {
    run: async (project, requests, options = {}) => {
      ensure(options.groups);
      return runtime.run(project, requests, { keep: options.keep });
    },
    test: async (project, options = {}) => {
      ensure(options.groups);
      return runtime.test(project);
    },
    analyze: async (project, rules) => runtime.analyze(project, rules),
  };
}
