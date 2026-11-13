"""Runs the learner's main.py with FastAPI and calls its app directly over ASGI: no server, no sockets.

The isolation boundary is the worker this runs in (it has no network, disk or desktop APIs); the import guard
below only turns attempts to reach the browser into a clear message.
"""

import builtins
import contextlib
import io
import json
import sys
import time
import traceback
import types

import anyio.to_thread

# WebAssembly has no threads: FastAPI runs `def` endpoints in a thread pool, here they run inline.
async def _run_inline(func, *args, abandon_on_cancel=False, cancellable=None, limiter=None):
    return func(*args)


anyio.to_thread.run_sync = _run_inline

# Tutorials end with uvicorn.run(app); the sandbox serves the app itself, so the call is a harmless no-op.
_uvicorn = types.ModuleType("uvicorn")
_uvicorn.run = lambda *args, **kwargs: print("uvicorn.run(...) здесь не нужен: учебная среда запускает приложение сама")
sys.modules.setdefault("uvicorn", _uvicorn)

_BLOCKED = {"js", "pyodide", "pyodide_js", "_pyodide", "micropip"}


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level == 0 and name.split(".")[0] in _BLOCKED:
        raise ImportError(f"Модуль {name} недоступен: учебное приложение работает без сети и без доступа к браузеру")
    return _real_import(name, globals, locals, fromlist, level)


_real_import = builtins.__import__
_BUILTINS = dict(builtins.__dict__, __import__=_guarded_import)


def _fresh_builtins():
    """Every learner run gets its own copy, so a patched `__builtins__` never reaches the next run."""
    return dict(_BUILTINS)


def _drop_new_modules(before):
    """Forgets the modules a learner run added (its own files, patched shims); already loaded ones stay."""
    for name in list(sys.modules):
        if name not in before:
            del sys.modules[name]


class LoadError(Exception):
    pass


def _error(exc, kind, filename="main.py"):
    """Type, message and the line of main.py where it happened (the deepest frame from main.py)."""
    line = None
    if isinstance(exc, SyntaxError) and exc.filename == filename:
        line = exc.lineno
    else:
        for frame in traceback.extract_tb(exc.__traceback__):
            if frame.filename == filename:
                line = frame.lineno
    message = exc.msg if isinstance(exc, SyntaxError) else str(exc)
    return {"kind": kind, "type": type(exc).__name__, "message": message, "line": line}


def _load(source):
    module = types.ModuleType("main")
    module.__file__ = "main.py"
    module.__dict__["__builtins__"] = _fresh_builtins()
    sys.modules["main"] = module
    exec(compile(source, "main.py", "exec"), module.__dict__)
    app = module.__dict__.get("app")
    if app is None:
        raise LoadError("В main.py нет переменной app: создайте приложение строкой app = FastAPI()")
    from fastapi import FastAPI

    if not isinstance(app, FastAPI):
        raise LoadError(f"app — это {type(app).__name__}, а нужно приложение FastAPI: app = FastAPI()")
    return app


async def _call(app, request):
    body = request["body"].encode()
    headers = [(name.lower().encode(), value.encode()) for name, value in request["headers"]]
    if not any(name == b"host" for name, _ in headers):
        headers.append((b"host", b"127.0.0.1:8000"))
    path = request["path"]
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
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
    received = False

    async def receive():
        nonlocal received
        if received:
            return {"type": "http.disconnect"}
        received = True
        return {"type": "http.request", "body": body, "more_body": False}

    out = {"status": None, "headers": [], "body": b""}

    async def send(message):
        if message["type"] == "http.response.start":
            out["status"] = message["status"]
            out["headers"] = [[k.decode("latin-1"), v.decode("latin-1")] for k, v in message.get("headers", [])]
        elif message["type"] == "http.response.body":
            out["body"] += message.get("body", b"")

    error = None
    started = time.perf_counter()
    try:
        await app(scope, receive, send)
    except Exception as exc:
        # Starlette has already answered 500 and re-raises the error for the server's log: keep both.
        error = _error(exc, "request")
    result = {
        "status": out["status"] or 500,
        "headers": out["headers"],
        "body": out["body"].decode("utf-8", "replace"),
        "ms": round((time.perf_counter() - started) * 1000, 1),
    }
    if error:
        result["error"] = error
    return result


_kept = {"source": None, "app": None}


async def run(source, requests_json, keep=False):
    """Loads main.py (or reuses the kept app for the same source) and answers the requests in order."""
    requests = json.loads(requests_json)
    output = io.StringIO()
    result = {"load": {"ok": True}, "responses": []}
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
        app = _kept["app"] if keep and _kept["source"] == source else None
        if app is None:
            try:
                app = _load(source)
            except LoadError as exc:
                result["load"] = {"ok": False, "error": {"kind": "load", "type": "LoadError", "message": str(exc), "line": None}}
            except SyntaxError as exc:
                result["load"] = {"ok": False, "error": _error(exc, "syntax")}
            except Exception as exc:
                result["load"] = {"ok": False, "error": _error(exc, "load")}
            if keep:
                _kept.update(source=source, app=app)
        if app is not None:
            for request in requests:
                result["responses"].append(await _call(app, request))
    result["output"] = output.getvalue()[-4000:]
    return json.dumps(result, ensure_ascii=False)


def forget():
    _kept.update(source=None, app=None)


_scratch_count = 0
_OUTPUT_LIMIT = 20000


def script(source, files_json):
    """Runs a standalone learner script (the drill scratch pad) in a fresh scratch directory with the given files.

    Same import guard as the FastAPI apps; fresh globals every run; the kept FastAPI app is not touched.
    """
    global _scratch_count
    import os
    import shutil

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
                error = _error(exc, "syntax", "script.py")
            except Exception as exc:
                error = _error(exc, "load", "script.py")
    except Exception as exc:
        error = _error(exc, "load", "script.py")
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
    import time

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
