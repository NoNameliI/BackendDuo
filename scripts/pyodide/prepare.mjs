// Prepares Python for the app: Pyodide's runtime files plus one archive with FastAPI, pydantic and their
// dependencies, already compiled to .pyc, plus lazy package groups (httpx, pytest, SQLAlchemy, ...) that the app
// fetches only for lessons that need them. The result lands in public/pyodide/ and ships inside the installer,
// so the app never downloads anything. Wheels are fetched once (checked against pyodide-lock.json or pypi.json)
// and cached. Run by npm before dev, build, test and validate:content; it does nothing when the output is up to
// date. The base site.tar.gz and the groups have separate stamps: a group change never touches the base archive.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const core = join(root, 'node_modules', 'pyodide');
const out = join(root, 'public', 'pyodide');
const groupsDir = join(out, 'groups');
const cache = join(root, 'node_modules', '.cache', 'pyodide-wheels');

/** Packages the course needs; their dependencies are resolved from the lock file (minus the optional ones). */
const WANTED = ['fastapi', 'pydantic', 'starlette', 'anyio', 'idna'];
/** FastAPI lists them, but the course never uses its test client (httpx) or templates (jinja2). */
const SKIP = new Set(['httpx', 'jinja2']);
const CORE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

/**
 * Lazy groups. Wheel lists are explicit (the lock's dependency lists are stale for pytest). `lock` names come from
 * pyodide-lock.json, `pypi` names from pypi.json. `prune` drops files (paths under site-packages, .pyc names).
 * `smoke` runs in a fresh interpreter with the base site and this group only; a failure fails the build.
 */
const GROUPS = {
  client: { lock: ['httpx'], smoke: 'import httpx, fastapi.testclient' },
  pytest: {
    lock: ['pytest', 'pluggy', 'iniconfig', 'packaging', 'pygments'],
    // Lexers are loaded by name from _mapping; only Python and diff output is ever highlighted.
    prune: String.raw`^pygments/lexers/(?!(__init__|_mapping|python|diff)\.pyc$)`,
    // A failing test, as a lesson would run it: proves that the pruned package still reports an assertion.
    smoke: `
import contextlib, io, os, pytest
os.makedirs("/tmp/smoke", exist_ok=True)
with open("/tmp/smoke/test_fail.py", "w") as f:
    f.write("def test_fail():\\n    assert 1 == 2\\n")
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    code = pytest.main(["-q", "-p", "no:cacheprovider", "--color=no", "-rfE", "/tmp/smoke/test_fail.py"])
text = buf.getvalue()
assert code == 1 and "assert 1 == 2" in text and "1 failed" in text, (code, text)
`,
  },
  db: {
    lock: ['sqlalchemy'],
    prune: String.raw`^sqlalchemy/(dialects/(postgresql|mysql|oracle|mssql)|testing|ext/mypy)/`,
    smoke: `
import sqlalchemy.orm
from sqlalchemy import create_engine, text
with create_engine("sqlite://").connect() as c:
    assert c.execute(text("select 1")).scalar() == 1
`,
  },
  bcrypt: { lock: ['bcrypt'], smoke: 'import bcrypt\nassert bcrypt.checkpw(b"x", bcrypt.hashpw(b"x", bcrypt.gensalt(rounds=4)))' },
  multipart: {
    pypi: ['python-multipart'],
    smoke: `
from fastapi import FastAPI, Form
app = FastAPI()
@app.post("/x")
def x(name: str = Form()):
    return {"name": name}
`,
  },
  jwt: {
    pypi: ['pyjwt'],
    smoke: 'import jwt\nassert jwt.decode(jwt.encode({"a": 1}, "k" * 32, algorithm="HS256"), "k" * 32, algorithms=["HS256"]) == {"a": 1}',
  },
  settings: { pypi: ['pydantic-settings', 'python-dotenv'], smoke: 'import pydantic_settings, dotenv' },
};

const pkg = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(core, 'pyodide-lock.json'), 'utf8'));
const pypiText = readFileSync(join(here, 'pypi.json'), 'utf8');
const pypi = JSON.parse(pypiText);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const lockEntry = (name) => {
  const entry = lock.packages[name] ?? lock.packages[name.replaceAll('_', '-')];
  if (!entry) throw new Error(`pyodide-lock.json has no package ${name}`);
  return entry;
};

const wheels = new Map();
const visit = (name) => {
  if (SKIP.has(name) || wheels.has(name)) return;
  const entry = lockEntry(name);
  wheels.set(name, entry);
  entry.depends.forEach(visit);
};
WANTED.forEach(visit);

/** Wheel into the cache (downloaded when missing or damaged, always checked); returns a path Pyodide accepts. */
async function fetchWheel(file, sha, url) {
  const path = join(cache, file);
  if (!existsSync(path) || sha256(readFileSync(path)) !== sha) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const source = url.includes('files.pythonhosted.org') ? 'pypi.json' : 'pyodide-lock.json';
    if (sha256(bytes) !== sha) throw new Error(`${file}: checksum does not match ${source}`);
    writeFileSync(path, bytes);
  }
  // Pyodide reads the package name from the path and needs forward slashes on Windows too.
  return path.replaceAll('\\', '/');
}
const lockWheel = (entry) => fetchWheel(entry.file_name, entry.sha256, `https://cdn.jsdelivr.net/pyodide/v${pkg.version}/full/${entry.file_name}`);

let loadPyodide;
async function pyodideOf() {
  loadPyodide ??= (await import(new URL(`file:///${join(core, 'pyodide.mjs').replaceAll('\\', '/')}`).href)).loadPyodide;
  return loadPyodide({ indexURL: `${core}/`, stdout: () => {}, stderr: () => {} });
}

mkdirSync(out, { recursive: true });
mkdirSync(cache, { recursive: true });

// ---- base site ----
const stamp = JSON.stringify({ version: pkg.version, wheels: [...wheels.values()].map((w) => w.file_name).sort() });
// The stamps live next to the wheel cache, not in public/: everything in public/ ships with the app.
const stampFile = join(cache, 'stamp.json');
if (!(existsSync(join(out, 'site.tar.gz')) && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp)) {
  for (const file of CORE_FILES) copyFileSync(join(core, file), join(out, file));

  const paths = [];
  for (const entry of wheels.values()) paths.push(await lockWheel(entry));

  const pyodide = await pyodideOf();
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
}

// ---- lazy groups ----
const siteBytes = readFileSync(join(out, 'site.tar.gz'));
const groupStamp = JSON.stringify({ version: pkg.version, site: sha256(siteBytes), pypi: sha256(pypiText), groups: GROUPS });
const groupStampFile = join(cache, 'groups-stamp.json');
const groupsFile = join(out, 'groups.json');
const groupsReady = () =>
  existsSync(groupsFile) &&
  existsSync(groupStampFile) &&
  readFileSync(groupStampFile, 'utf8') === groupStamp &&
  Object.values(JSON.parse(readFileSync(groupsFile, 'utf8'))).every((g) => existsSync(join(groupsDir, g.file)));

if (!groupsReady()) {
  mkdirSync(groupsDir, { recursive: true });
  /** Fresh interpreter with the base site unpacked, as the app's worker has it. */
  const freshSite = async () => {
    const py = await pyodideOf();
    const sp = py.runPython('import site; site.getsitepackages()[0]');
    py.unpackArchive(new Uint8Array(siteBytes), 'gztar', { extractDir: sp });
    return { py, sp };
  };
  const manifest = {};
  let total = 0;
  for (const [name, group] of Object.entries(GROUPS)) {
    const files = [];
    const packages = [];
    for (const n of group.lock ?? []) {
      const entry = lockEntry(n);
      files.push(await lockWheel(entry));
      packages.push(`${entry.name}==${entry.version}`);
    }
    for (const n of group.pypi ?? []) {
      const entry = pypi.find((p) => p.name === n);
      if (!entry) throw new Error(`pypi.json has no package ${n}`);
      files.push(await fetchWheel(entry.file, entry.sha256, entry.url));
      packages.push(`${entry.name}==${entry.version}`);
    }

    // Build: base site, snapshot of its files, load the group wheels, compile, archive only the new files.
    const { py } = await freshSite();
    py.runPython('import site, os; BEFORE = {os.path.join(d, f) for d, _, fs in os.walk(site.getsitepackages()[0]) for f in fs}');
    await py.loadPackage(files, { messageCallback: () => {} });
    const archive = py
      .runPython(
        `
import compileall, io, os, re, site, tarfile
PRUNE = re.compile(${JSON.stringify(group.prune ?? '(?!)')})
sp = site.getsitepackages()[0]
compileall.compile_dir(sp, quiet=1, legacy=True)
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tar:
    for d, dirs, fs in os.walk(sp):
        dirs.sort()
        for f in sorted(fs):
            p = os.path.join(d, f)
            if p in BEFORE or p.endswith(".py") or "__pycache__" in p or PRUNE.search(os.path.relpath(p, sp).replace(os.sep, "/")):
                continue
            tar.add(p, arcname=os.path.relpath(p, sp).replace(os.sep, "/"))
buf.getvalue()
`,
      )
      .toJs();

    // Smoke: a fresh interpreter with the base site and this group only.
    const fresh = await freshSite();
    fresh.py.unpackArchive(archive, 'gztar', { extractDir: fresh.sp });
    fresh.py.runPython('import importlib; importlib.invalidate_caches()');
    try {
      fresh.py.runPython(group.smoke);
    } catch (error) {
      throw new Error(`group ${name}: smoke import failed\n${error instanceof Error ? error.message : error}`);
    }

    writeFileSync(join(groupsDir, `${name}.tar.gz`), archive);
    manifest[name] = { file: `${name}.tar.gz`, bytes: archive.length, packages };
    total += archive.length;
    console.log(`group ${name}: ${packages.join(', ')} -> ${name}.tar.gz ${(archive.length / 1024).toFixed(0)} KiB`);
  }
  writeFileSync(groupsFile, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(groupStampFile, groupStamp);
  console.log(`groups: ${Object.keys(manifest).length}, ${(total / 1024).toFixed(0)} KiB`);
}
