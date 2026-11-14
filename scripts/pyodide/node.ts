// Python for tests and validate:content: the same runtime as the app's worker, run directly in Node from the
// files prepared by scripts/pyodide/prepare.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPyodide } from 'pyodide';
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
