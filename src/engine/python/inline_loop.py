"""A same-thread event loop and portal: WebAssembly has no threads, yet Starlette's TestClient and the studio's
own ASGI driver need to run coroutines from synchronous code.

The loop has a virtual clock: `asyncio.sleep(5)` does not wait, it moves the clock. `run` drives the loop until the
given awaitable finishes (other tasks progress meanwhile); a wait with nothing scheduled raises `Deadlock`.
"""

import asyncio
import concurrent.futures
import contextlib


class Deadlock(RuntimeError):
    pass


class _NoSelector:
    def __init__(self, loop):
        self.loop = loop

    def select(self, timeout):
        if timeout is None:
            raise Deadlock("Приложение ждёт события, которое никогда не наступит (например, receive() без сообщений от клиента)")
        self.loop._virtual += max(timeout, 0)  # virtual time: asyncio.sleep(5) does not wait
        return []

    def close(self):
        pass


class InlineLoop(asyncio.BaseEventLoop):
    def __init__(self):
        super().__init__()
        self._virtual = 0.0
        self._selector = _NoSelector(self)

    def time(self):
        return self._virtual

    def _process_events(self, event_list):
        pass

    def _write_to_self(self):
        pass


class _TaskFuture(concurrent.futures.Future):
    """result() drives the loop instead of blocking a thread that does not exist."""

    def __init__(self, portal, task):
        super().__init__()
        self._portal, self._task = portal, task

    def result(self, timeout=None):
        self._portal.run(self._task)
        return self._task.result()

    def done(self):
        return self._task.done()

    def cancel(self):
        return self._task.cancel()


class _TaskStatus:
    def __init__(self, loop):
        self.future = loop.create_future()

    def started(self, value=None):
        if not self.future.done():
            self.future.set_result(value)


class InlinePortal:
    """The part of anyio's BlockingPortal that TestClient uses, on an InlineLoop."""

    def __init__(self):
        self.loop = InlineLoop()

    def run(self, awaitable):
        # Pyodide keeps its browser loop marked as running even in synchronous code: step it aside meanwhile.
        outer = asyncio._get_running_loop()
        asyncio._set_running_loop(None)
        try:
            fut = asyncio.ensure_future(awaitable, loop=self.loop)
            return self.loop.run_until_complete(fut)
        finally:
            asyncio._set_running_loop(outer)

    def call(self, func, *args):
        async def runner():
            result = func(*args)
            if asyncio.iscoroutine(result):
                result = await result
            return result

        return self.run(runner())

    def start_task_soon(self, func, *args, name=None):
        async def runner():
            return await func(*args)

        task = self.loop.create_task(runner())
        return _TaskFuture(self, task)

    def start_task(self, func, *args, name=None):
        status = _TaskStatus(self.loop)

        async def runner():
            return await func(*args, task_status=status)

        task = self.loop.create_task(runner())
        value = self.run(_first(status.future, task))
        return _TaskFuture(self, task), value

    def close(self):
        pending = [t for t in asyncio.all_tasks(self.loop) if not t.done()]
        for t in pending:
            t.cancel()
        if pending:
            try:
                async def settle():
                    await asyncio.gather(*pending, return_exceptions=True)

                self.run(settle())
            except Deadlock:
                pass
        self.loop.close()


async def _first(status_future, task):
    await asyncio.wait({status_future, task}, return_when=asyncio.FIRST_COMPLETED)
    if status_future.done():
        return status_future.result()
    task.result()
    raise RuntimeError("task finished without calling task_status.started()")


@contextlib.contextmanager
def start_blocking_portal(backend="asyncio", backend_options=None, *, name=None):
    portal = InlinePortal()
    try:
        yield portal
    finally:
        portal.close()


def install():
    """Makes `fastapi.testclient.TestClient` (the genuine class) work: it asks anyio for a blocking portal."""
    import anyio.from_thread

    anyio.from_thread.start_blocking_portal = start_blocking_portal
