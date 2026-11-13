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

export async function nodePython(): Promise<ReturnType<typeof setupRuntime>> {
  shared ??= await freshNodePython();
  return shared;
}
