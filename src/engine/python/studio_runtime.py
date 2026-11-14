"""Runs the learner's project with FastAPI and calls its app directly over ASGI: no server, no sockets.

Every entry point is synchronous (Python 3.14 refuses nested tasks): the app is driven on an InlineLoop with a
virtual clock, and the genuine Starlette TestClient works through the same loop. The isolation boundary is the worker
this runs in (it has no network, disk or desktop APIs); the import guard below only turns attempts to reach the
browser into a clear message.
"""

import asyncio
import builtins
import contextlib
import importlib
import io
import json
import os
import re
import shutil
import sys
import time
import traceback
import types
import warnings

import anyio.to_thread

import inline_loop

sys.dont_write_bytecode = True  # MEMFS mtimes are coarse: a stale .pyc could survive a quick edit
inline_loop.install()


# WebAssembly has no threads: FastAPI runs `def` endpoints in a thread pool, here they run inline.
async def _run_inline(func, *args, abandon_on_cancel=False, cancellable=None, limiter=None):
    return func(*args)


anyio.to_thread.run_sync = _run_inline

# Tutorials end with uvicorn.run(app); the sandbox serves the app itself, so the call is a harmless no-op.
_uvicorn = types.ModuleType("uvicorn")
_uvicorn.run = lambda *args, **kwargs: print("uvicorn.run(...) здесь не нужен: учебная среда запускает приложение сама")
sys.modules.setdefault("uvicorn", _uvicorn)

ROOT = "/project"
_PREFIX = ROOT + "/"
_RUN_LIMIT = 4000
_OUTPUT_LIMIT = 20000

# --- import guard -----------------------------------------------------------------------------------------------

_BLOCKED = {"js", "pyodide", "pyodide_js", "_pyodide"}
_NO_PIP = {"micropip", "pip"}
_PIP_MESSAGE = "Установка пакетов недоступна: пакеты урока уже подключены"
_LEARNER_FILES = ("main.py", "script.py")


def _is_learner_file(path):
    return isinstance(path, str) and (path.startswith(_PREFIX) or path in _LEARNER_FILES)


def _check_import(name, learner):
    """Raises the friendly error when learner code asks for a module that would reach the browser or the network."""
    top = name.partition(".")[0]
    if top in _NO_PIP:
        raise ImportError(_PIP_MESSAGE, name=top)
    if top in _BLOCKED:
        raise ImportError(f"Модуль {name} недоступен: учебное приложение работает без сети и без доступа к браузеру", name=top)


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    __tracebackhide__ = True  # pytest leaves this frame out of its reports
    if level == 0 and (name.partition(".")[0] in _BLOCKED or name.partition(".")[0] in _NO_PIP):
        try:
            learner = globals is None or _is_learner_file(globals.get("__file__"))
        except Exception:
            learner = False
        if learner:
            _check_import(name, True)
    return _real_import(name, globals, locals, fromlist, level)


_real_import_module = importlib.import_module


def _guarded_import_module(name, package=None):
    __tracebackhide__ = True
    if not name.startswith(".") and (name.partition(".")[0] in _BLOCKED or name.partition(".")[0] in _NO_PIP):
        try:
            learner = _is_learner_file(sys._getframe(1).f_globals.get("__file__"))
        except Exception:
            learner = False
        if learner:
            _check_import(name, True)
    return _real_import_module(name, package)


importlib.import_module = _guarded_import_module


_real_import = builtins.__import__
builtins.__import__ = _guarded_import
_BUILTINS = dict(builtins.__dict__, __import__=_guarded_import)


def _fresh_builtins():
    """Every standalone learner run (script, client) gets its own copy, so a patched `__builtins__` never reaches the next."""
    return dict(_BUILTINS)


def _drop_new_modules(before):
    """Forgets the modules a learner run added (its own files, patched shims); already loaded ones stay."""
    for name in list(sys.modules):
        if name not in before:
            del sys.modules[name]


# --- captured output --------------------------------------------------------------------------------------------

_capture = {"buf": None}


class _Sink:
    """sys.stdout / sys.stderr for good: what is written lands in the buffer of the call in progress, so a logging
    handler created while the project was imported still writes to the right request."""

    encoding = "utf-8"
    errors = "strict"

    def __init__(self, fallback):
        self.fallback = fallback

    def write(self, text):
        buf = _capture["buf"]
        return (buf if buf is not None else self.fallback).write(text)

    def writelines(self, lines):
        for line in lines:
            self.write(line)

    def flush(self):
        if _capture["buf"] is None:
            self.fallback.flush()

    def isatty(self):
        return False

    def writable(self):
        return True

    def __getattr__(self, name):
        return getattr(self.fallback, name)


_STDOUT = _Sink(sys.stdout)
_STDERR = _Sink(sys.stderr)


class _Capture:
    """Collects everything printed, logged or warned while it is open."""

    def __init__(self):
        self.buf = io.StringIO()

    def __enter__(self):
        self.previous = _capture["buf"]
        _capture["buf"] = self.buf
        sys.stdout, sys.stderr = _STDOUT, _STDERR
        return self

    def __exit__(self, *exc):
        _capture["buf"] = self.previous

    def text(self, limit=_RUN_LIMIT):
        return self.buf.getvalue()[-limit:]


def _show_warning(message, category, filename, lineno, file=None, line=None):
    sys.stderr.write(f"{category.__name__}: {message}\n")


warnings.showwarning = _show_warning
warnings.filterwarnings("always", category=RuntimeWarning)  # a forgotten await is reported on every run

# --- errors -----------------------------------------------------------------------------------------------------


class LoadError(Exception):
    pass


def _rel_path(path, files=None):
    """A project-relative name for a path under /project, a learner script name, or None for anything else."""
    if not isinstance(path, str):
        return None
    if path.startswith(_PREFIX):
        return path[len(_PREFIX):]
    if path in _LEARNER_FILES:
        return path
    if files is None:
        files = _written["files"] or {}
    if path.startswith("./"):
        path = path[2:]
    return path if path in files else None


def _error(exc, kind):
    """Type, message, the deepest learner frame (project-relative file and line) and the learner frames of the trace."""
    while isinstance(exc, BaseExceptionGroup) and len(exc.exceptions) == 1:
        exc = exc.exceptions[0]
    trace = []
    file = line = None
    if isinstance(exc, SyntaxError):
        file = _rel_path(exc.filename)
        line = exc.lineno if file is not None else None
    else:
        for frame in traceback.extract_tb(exc.__traceback__):
            rel = _rel_path(frame.filename)
            if rel is not None:
                trace.append({"file": rel, "line": frame.lineno, "name": frame.name})
        if trace:
            file, line = trace[-1]["file"], trace[-1]["line"]
    message = exc.msg if isinstance(exc, SyntaxError) else str(exc)
    return {"kind": kind, "type": type(exc).__name__, "message": message[:2000], "line": line, "file": file, "trace": trace[-8:]}


def _load_error(message):
    return {"kind": "load", "type": "LoadError", "message": message, "line": None, "file": None, "trace": []}


# --- project files ----------------------------------------------------------------------------------------------

# `.env` is the one dot name allowed: pydantic-settings and python-dotenv read it by default.
_SEGMENT = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]*|\.env")
_MAX_FILES = 40
_MAX_BYTES = 400 * 1024
_written = {"files": None}


def _check_files(files):
    if not isinstance(files, dict) or not files:
        raise LoadError("В проекте нет файлов")
    if len(files) > _MAX_FILES:
        raise LoadError(f"В проекте {len(files)} файлов, а можно не больше {_MAX_FILES}")
    total = 0
    for name, text in files.items():
        parts = name.split("/")
        if not all(_SEGMENT.fullmatch(p) and ".." not in p for p in parts):
            raise LoadError(f"Недопустимое имя файла «{name}»: допустимы буквы, цифры, _ . - и / между папками, без «..»")
        total += len(text.encode("utf-8"))
    if total > _MAX_BYTES:
        raise LoadError(f"Проект занимает {total // 1024} КБ, а можно не больше {_MAX_BYTES // 1024} КБ")


def _purge_project_modules():
    """Forgets every module imported from the project, so the next import reads the files as they are now."""
    for name, module in list(sys.modules.items()):
        try:
            file = getattr(module, "__file__", None)
            gone = isinstance(file, str) and file.startswith(_PREFIX)
            if not gone:
                gone = any(isinstance(p, str) and (p == ROOT or p.startswith(_PREFIX)) for p in list(getattr(module, "__path__", ())))
        except Exception:
            continue
        if gone:
            del sys.modules[name]
    importlib.invalidate_caches()


def _apply_project(files):
    """Writes the files to /project when they differ from the last write, and drops the modules imported from there."""
    _check_files(files)
    if files != _written["files"]:
        _written["files"] = None
        shutil.rmtree(ROOT, ignore_errors=True)
        os.makedirs(ROOT, exist_ok=True)
        for name, text in files.items():
            path = f"{ROOT}/{name}"
            try:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "wb") as handle:
                    handle.write(text.encode("utf-8"))
            except OSError:
                raise LoadError(f"Файл «{name}» конфликтует с другим именем: имя не может быть и файлом, и папкой") from None
        _written["files"] = dict(files)
    os.makedirs(ROOT, exist_ok=True)
    _purge_project_modules()
    if sys.path[:1] != [ROOT]:
        while ROOT in sys.path:
            sys.path.remove(ROOT)
        sys.path.insert(0, ROOT)


@contextlib.contextmanager
def _in_project():
    os.makedirs(ROOT, exist_ok=True)
    previous = os.getcwd()
    os.chdir(ROOT)
    try:
        yield
    finally:
        os.chdir(previous)


def _import_entry(files, entry):
    if entry not in files:
        raise LoadError(f"В проекте нет файла {entry}: создайте его или выберите другой главный файл")
    parts = entry[:-3].split("/") if entry.endswith(".py") else None
    if parts and parts[-1] == "__init__":
        parts.pop()
    if not parts or not all(p.isidentifier() for p in parts):
        raise LoadError(f"Файл {entry} нельзя запустить как модуль: имя должно быть вида name.py из букв, цифр и _")
    module = importlib.import_module(".".join(parts))
    app = module.__dict__.get("app")
    if app is None:
        raise LoadError(f"В {entry} нет переменной app: создайте приложение строкой app = FastAPI()")
    from fastapi import FastAPI

    if not isinstance(app, FastAPI):
        raise LoadError(f"app — это {type(app).__name__}, а нужно приложение FastAPI: app = FastAPI()")
    return app


# --- the ASGI driver --------------------------------------------------------------------------------------------


async def _http(app, request, state):
    body = request["body"].encode()
    headers = [(name.lower().encode(), value.encode()) for name, value in request["headers"]]
    if not any(name == b"host" for name, _ in headers):
        headers.append((b"host", b"127.0.0.1:8000"))
    path = request["path"]
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1",
        "method": request["method"].upper(),
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": request["query"].encode(),
        "headers": headers,
        "client": ("127.0.0.1", 50000),
        "server": ("127.0.0.1", 8000),
        "root_path": "",
    }
    if state is not None:
        scope["state"] = dict(state)
    received = False
    complete = asyncio.Event()

    async def receive():
        nonlocal received
        if not received:
            received = True
            return {"type": "http.request", "body": body, "more_body": False}
        # A real server reports the client gone only after the answer is out: waiting keeps StreamingResponse alive.
        await complete.wait()
        return {"type": "http.disconnect"}

    out = {"status": None, "headers": [], "body": [], "chunks": 0}

    async def send(message):
        if message["type"] == "http.response.start":
            out["status"] = message["status"]
            out["headers"] = [[k.decode("latin-1"), v.decode("latin-1")] for k, v in message.get("headers", [])]
        elif message["type"] == "http.response.body":
            data = message.get("body", b"")
            if data:
                out["body"].append(data)
                out["chunks"] += 1
            if not message.get("more_body"):
                complete.set()

    error = None
    try:
        await app(scope, receive, send)
    except Exception as exc:
        # Starlette has already answered 500 and re-raises the error for the server's log: keep both.
        error = _error(exc, "request")
    return out, error


class _Session:
    """One loaded app on its own loop: lifespan startup before the first request, shutdown when it is dropped."""

    def __init__(self, app):
        self.app = app
        self.portal = inline_loop.InlinePortal()
        self.state = {}
        self.started = False
        self.broken = False
        self.task = self.inbox = self.outbox = None

    async def _startup(self):
        self.inbox, self.outbox = asyncio.Queue(), asyncio.Queue()
        scope = {"type": "lifespan", "asgi": {"version": "3.0", "spec_version": "2.0"}, "state": self.state}
        self.task = asyncio.ensure_future(self.app(scope, self.inbox.get, self.outbox.put))
        await self.inbox.put({"type": "lifespan.startup"})
        reply = asyncio.ensure_future(self.outbox.get())
        await asyncio.wait({reply, self.task}, return_when=asyncio.FIRST_COMPLETED)
        if not reply.done():
            reply.cancel()
            self.task.result()  # the app's own error; a clean return means it has no lifespan at all
            self.task = None
            return
        message = reply.result()
        if message["type"] == "lifespan.startup.failed":
            await self.task  # raises the original error of the startup code
            raise LoadError(message.get("message") or "Запуск приложения (lifespan) завершился ошибкой")
        self.started = True

    async def _shutdown(self):
        await self.inbox.put({"type": "lifespan.shutdown"})
        await self.outbox.get()
        await self.task

    def startup(self):
        self.portal.run(self._startup())

    def request(self, request):
        started = time.perf_counter()
        try:
            out, error = self.portal.run(_http(self.app, request, self.state if self.started else None))
        except BaseException as exc:
            # Deadlock (the app waits for an event that cannot come) or a stop the app asked for: this app is done.
            self.broken = True
            out, error = {"status": None, "headers": [], "body": [], "chunks": 0}, _error(exc, "request")
        result = {
            "status": out["status"] or 500,
            "headers": out["headers"],
            "body": b"".join(out["body"]).decode("utf-8", "replace"),
            "chunks": out["chunks"],
            "ms": round((time.perf_counter() - started) * 1000, 1),
        }
        if error:
            result["error"] = error
        return result

    def close(self):
        try:
            if self.started and not self.broken:
                self.portal.run(self._shutdown())
        except BaseException as exc:
            print(f"Ошибка при завершении приложения: {type(exc).__name__}: {exc}", file=sys.stderr)
        finally:
            try:
                self.portal.close()
            except BaseException:
                pass


def _start(files, entry):
    _apply_project(files)
    session = _Session(_import_entry(files, entry))
    try:
        session.startup()
    except BaseException:
        session.close()
        raise
    return session


_kept = {"key": None, "session": None}


def _end_kept():
    session = _kept["session"]
    _kept.update(key=None, session=None)
    if session is not None:
        session.close()


def run(project_json, requests_json, keep=False):
    """Loads the project (or reuses the kept app for the same files) and answers the requests in order."""
    project = json.loads(project_json)
    requests = json.loads(requests_json)
    files, entry = project["files"], project.get("entry") or "main.py"
    key = json.dumps([entry, files], sort_keys=True, ensure_ascii=False)
    result = {"load": {"ok": True}, "responses": []}
    session = None
    with _Capture() as lifecycle, _in_project():
        try:
            if keep and _kept["key"] == key and _kept["session"] is not None and not _kept["session"].broken:
                session = _kept["session"]
            else:
                if keep:
                    _end_kept()  # a run without keep has its own session and leaves the composer's app alone
                session = _start(files, entry)
                if keep:
                    _kept.update(key=key, session=session)
        except LoadError as exc:
            result["load"] = {"ok": False, "error": _load_error(str(exc))}
        except SyntaxError as exc:
            result["load"] = {"ok": False, "error": _error(exc, "syntax")}
        except BaseException as exc:
            result["load"] = {"ok": False, "error": _error(exc, "load")}
        if session is not None:
            for request in requests:
                with _Capture() as each:
                    response = session.request(request)
                response["output"] = each.text()
                result["responses"].append(response)
            if not keep:
                session.close()
            elif session.broken:
                _end_kept()
    result["output"] = lifecycle.text()
    return json.dumps(result, ensure_ascii=False)


def forget():
    with _Capture():
        _end_kept()


# --- pytest -----------------------------------------------------------------------------------------------------


class _Collector:
    """pytest plugin: one case per test (and per collection error) with its outcome and the crash lines."""

    def __init__(self):
        self.cases = {}

    @staticmethod
    def _message(report):
        longrepr = getattr(report, "longrepr", None)
        if isinstance(longrepr, tuple) and len(longrepr) == 3:  # skipped: (path, line, reason)
            return re.sub(r"^Skipped: ", "", str(longrepr[2]))[:600]
        text = getattr(report, "longreprtext", "") or ""
        lines = [line for line in text.splitlines() if line.startswith("E ")]
        if not lines:
            lines = [line for line in text.splitlines() if line.strip()][-1:]
        return "\n".join(lines)[:600]

    @staticmethod
    def _where(report):
        longrepr = getattr(report, "longrepr", None)
        if isinstance(longrepr, tuple) and len(longrepr) == 3:
            return _rel_path(str(longrepr[0])), longrepr[1] if isinstance(longrepr[1], int) else None
        crash = getattr(longrepr, "reprcrash", None)
        rel = _rel_path(getattr(crash, "path", None)) if crash is not None else None
        if rel is not None:
            return rel, getattr(crash, "lineno", None)
        # the crash is inside a library: point at the deepest frame of the project
        entries = getattr(getattr(longrepr, "reprtraceback", None), "reprentries", None) or []
        for entry in reversed(entries):
            loc = getattr(entry, "reprfileloc", None)
            rel = _rel_path(getattr(loc, "path", None)) if loc is not None else None
            if rel is not None:
                return rel, getattr(loc, "lineno", None)
        # collection errors carry only text: "tests/test_a.py:1: in <module>" lines name the frames
        frames = re.findall(r"^(\S+\.py):(\d+): in ", getattr(report, "longreprtext", "") or "", re.M)
        for path, number in reversed(frames):
            rel = _rel_path(path)
            if rel is not None:
                return rel, int(number)
        location = getattr(report, "location", None)
        if location:
            rel = _rel_path(str(location[0]))
            return rel, location[1] + 1 if isinstance(location[1], int) and location[1] >= 0 else None
        return None, None

    def _add(self, report, outcome):
        file, line = self._where(report)
        self.cases[report.nodeid] = {
            "nodeid": report.nodeid,
            "outcome": outcome,
            "message": "" if outcome == "passed" else self._message(report),
            "file": file,
            "line": line,
        }

    def pytest_runtest_logreport(self, report):
        if report.when == "call":
            self._add(report, "passed" if report.passed else "skipped" if report.skipped else "failed")
        elif report.when == "setup" and not report.passed:
            self._add(report, "skipped" if report.skipped else "error")
        elif report.when == "teardown" and report.failed:
            self._add(report, "error")

    def pytest_collectreport(self, report):
        if report.failed:
            self._add(report, "error")


def test(project_json, args_json="[]"):
    """Runs pytest over the project (cwd /project) with the real TestClient; returns exit code, cases and the output."""
    project = json.loads(project_json)
    args = json.loads(args_json)
    files = project["files"]
    started = time.perf_counter()
    collector = _Collector()
    code = 4
    with _Capture() as cap, _in_project():
        paths_before = list(sys.path)
        try:
            _apply_project(files)
            os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
            try:
                import pytest
            except ImportError:
                print("pytest в этом уроке не подключён", file=sys.stderr)
            else:
                try:
                    code = int(pytest.main(["-q", "-p", "no:cacheprovider", "--color=no", "-rfE", *args], plugins=[collector]))
                except SystemExit as exc:
                    code = exc.code if isinstance(exc.code, int) else 4
        except LoadError as exc:
            print(str(exc), file=sys.stderr)
        except BaseException as exc:
            print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        finally:
            sys.path[:] = paths_before
            _purge_project_modules()
    tests = list(collector.cases.values())
    counts = {kind: sum(1 for t in tests if t["outcome"] == kind) for kind in ("passed", "failed", "error", "skipped")}
    return json.dumps({"exit": code, "counts": counts, "tests": tests, "output": cap.text(_OUTPUT_LIMIT), "ms": round((time.perf_counter() - started) * 1000, 1)}, ensure_ascii=False)


# --- standalone scripts and broker clients ----------------------------------------------------------------------

_scratch_count = 0


def script(source, files_json):
    """Runs a standalone learner script (the drill scratch pad) in a fresh scratch directory with the given files.

    Same import guard as the FastAPI apps; fresh globals every run; the kept FastAPI app is not touched.
    """
    global _scratch_count

    files = json.loads(files_json)
    _scratch_count += 1
    root = f"/scratch/{_scratch_count}"
    previous = os.getcwd()
    output = io.StringIO()
    error = None
    started = time.perf_counter()
    modules_before = set(sys.modules)
    os.makedirs(root, exist_ok=True)
    try:
        for name, text in files.items():
            if not name or "/" in name or chr(92) in name or name.startswith("."):
                raise ValueError(f"Недопустимое имя файла: {name}")
            with open(f"{root}/{name}", "wb") as handle:
                handle.write(text.encode("utf-8"))
        os.chdir(root)
        namespace = {"__name__": "__main__", "__file__": "script.py", "__builtins__": _fresh_builtins()}
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            try:
                exec(compile(source, "script.py", "exec"), namespace)
            except SystemExit:
                pass
            except SyntaxError as exc:
                error = _error(exc, "syntax")
            except Exception as exc:
                error = _error(exc, "load")
    except Exception as exc:
        error = _error(exc, "load")
    finally:
        _drop_new_modules(modules_before)
        os.chdir(previous)
        shutil.rmtree(root, ignore_errors=True)
    result = {"output": output.getvalue()[-_OUTPUT_LIMIT:], "ms": round((time.perf_counter() - started) * 1000, 1)}
    if error:
        result["error"] = error
    return json.dumps(result, ensure_ascii=False)


class SandboxStop(BaseException):
    """The client program reached the sandbox horizon (endless wait or too many operations): a clean stop, not an error."""


def broker_call(op, **args):
    """One operation of a client library shim on the broker simulator; returns {"ok": ..., "value" | "error": ...}."""
    import _studio_broker

    reply = json.loads(_studio_broker.call(json.dumps({"op": op, "args": args})))
    if reply.get("stop"):
        raise SandboxStop("остановлено по горизонту песочницы")
    return reply["result"]


_SHIMS = ("pika", "confluent_kafka")


def _forget_shims():
    for name in list(sys.modules):
        if name.split(".")[0] in _SHIMS:
            del sys.modules[name]


def client(source):
    """Runs a learner's pika / confluent_kafka program against the broker simulator the host has attached.

    time.sleep moves the simulator's virtual clock instead of waiting. A stop at the sandbox horizon is reported
    as `stopped`, not as an error. The shims are imported afresh by every run.
    """
    output = io.StringIO()
    error = None
    stopped = False
    started = time.perf_counter()

    def virtual_sleep(seconds):
        if seconds < 0:
            raise ValueError("sleep length must be non-negative")
        broker_call("advance", ms=int(seconds * 1000))

    real_sleep = time.sleep
    time.sleep = virtual_sleep
    _forget_shims()
    modules_before = set(sys.modules)
    namespace = {"__name__": "__main__", "__file__": "main.py", "__builtins__": _fresh_builtins()}
    try:
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            try:
                exec(compile(source, "main.py", "exec"), namespace)
            except SandboxStop:
                stopped = True
            except SystemExit:
                pass
            except SyntaxError as exc:
                error = _error(exc, "syntax")
            except Exception as exc:
                error = _error(exc, "load")
    finally:
        time.sleep = real_sleep
        _drop_new_modules(modules_before)
        _forget_shims()
    result = {"output": output.getvalue()[-_OUTPUT_LIMIT:], "stopped": stopped, "ms": round((time.perf_counter() - started) * 1000, 1)}
    if error:
        result["error"] = error
    return json.dumps(result, ensure_ascii=False)
