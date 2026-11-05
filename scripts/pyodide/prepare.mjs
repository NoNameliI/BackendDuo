// Prepares Python for the app: Pyodide's runtime files plus one archive with FastAPI, pydantic and their
// dependencies, already compiled to .pyc. The result lands in public/pyodide/ and ships inside the installer,
// so the app never downloads anything. Wheels are fetched once (checked against pyodide-lock.json) and cached.
// Run by npm before dev, build, test and validate:content; it does nothing when the output is up to date.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const core = join(root, 'node_modules', 'pyodide');
const out = join(root, 'public', 'pyodide');
const cache = join(root, 'node_modules', '.cache', 'pyodide-wheels');

/** Packages the course needs; their dependencies are resolved from the lock file (minus the optional ones). */
const WANTED = ['fastapi', 'pydantic', 'starlette', 'anyio', 'idna'];
/** FastAPI lists them, but the course never uses its test client (httpx) or templates (jinja2). */
const SKIP = new Set(['httpx', 'jinja2']);
const CORE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

const pkg = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(core, 'pyodide-lock.json'), 'utf8'));

const wheels = new Map();
const visit = (name) => {
  if (SKIP.has(name) || wheels.has(name)) return;
  const entry = lock.packages[name] ?? lock.packages[name.replaceAll('_', '-')];
  if (!entry) throw new Error(`pyodide-lock.json has no package ${name}`);
  wheels.set(name, entry);
  entry.depends.forEach(visit);
};
WANTED.forEach(visit);

const stamp = JSON.stringify({ version: pkg.version, wheels: [...wheels.values()].map((w) => w.file_name).sort() });
// The stamp lives next to the wheel cache, not in public/: everything in public/ ships with the app.
const stampFile = join(cache, 'stamp.json');
if (existsSync(join(out, 'site.tar.gz')) && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) process.exit(0);

mkdirSync(out, { recursive: true });
mkdirSync(cache, { recursive: true });
for (const file of CORE_FILES) copyFileSync(join(core, file), join(out, file));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const paths = [];
for (const entry of wheels.values()) {
  const path = join(cache, entry.file_name);
  if (!existsSync(path) || sha256(readFileSync(path)) !== entry.sha256) {
    const url = `https://cdn.jsdelivr.net/pyodide/v${pkg.version}/full/${entry.file_name}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (sha256(bytes) !== entry.sha256) throw new Error(`${entry.file_name}: checksum does not match pyodide-lock.json`);
    writeFileSync(path, bytes);
  }
  // Pyodide reads the package name from the path and needs forward slashes on Windows too.
  paths.push(path.replaceAll('\\', '/'));
}

const { loadPyodide } = await import(new URL(`file:///${join(core, 'pyodide.mjs').replaceAll('\\', '/')}`).href);
const pyodide = await loadPyodide({ indexURL: `${core}/` });
await pyodide.loadPackage(paths, { messageCallback: () => {} });
// loadPackage reports failures only in messages: an import proves that everything is in place.
pyodide.runPython('import fastapi, pydantic, starlette, anyio');
// Sources are dropped once compiled: the archive is smaller and import is faster (no compile on first run).
const archive = pyodide
  .runPython(
    `
import compileall, io, site, tarfile
sp = site.getsitepackages()[0]
compileall.compile_dir(sp, quiet=1, legacy=True)
buf = io.BytesIO()
def keep(info):
    return None if info.name.endswith(".py") or "__pycache__" in info.name else info
with tarfile.open(fileobj=buf, mode="w:gz") as tar:
    tar.add(sp, arcname=".", filter=keep)
buf.getvalue()
`,
  )
  .toJs();
writeFileSync(join(out, 'site.tar.gz'), archive);
writeFileSync(stampFile, stamp);
console.log(`pyodide ${pkg.version}: ${wheels.size} packages, site.tar.gz ${(archive.length / 1048576).toFixed(2)} MB`);
