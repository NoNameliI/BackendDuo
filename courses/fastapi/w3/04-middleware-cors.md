# Middleware, CORS и глобальные зависимости

Нужно замерить время ответа каждого маршрута, добавить к каждому ответу служебный заголовок, пустить на API страницу с другого сайта. Дописывать это в каждый обработчик нельзя: их десятки, и новый обязательно забудут. Для задач, которые касаются каждого запроса, есть **middleware**: слой, через который проходят все запросы и все ответы приложения.

### Middleware: слой вокруг приложения

Middleware получает запрос раньше обработчика и видит ответ после него. Между этими моментами — вызов `call_next`, то есть «остальное приложение».

```python
@app.middleware("http")
async def имя(request: Request, call_next):
    # до обработчика: запрос ещё не обработан
    response = await call_next(request)
    # после обработчика: ответ готов, его можно изменить
    return response
```

- `@app.middleware("http")` — регистрирует функцию как middleware для HTTP-запросов.
- `request` — объект запроса (`Request` из `fastapi`): адрес, заголовки, `request.state`.
- `call_next` — функция: передаёт запрос дальше (другим middleware и обработчику) и возвращает ответ. Вызывается всегда как `await call_next(request)`.
- `response` — готовый ответ. Его заголовки изменяют так: `response.headers["Имя"] = "значение"`.
- В конце функция обязана вернуть ответ. Если вернуть что-то своё и не вызвать `call_next`, обработчик не выполнится: так middleware может запретить запрос.
- Middleware видит и ответы с ошибками: `HTTPException` из обработчика уже превращён в ответ с кодом `404` или `401`, когда он доходит до слоя.

Классический пример — время обработки в заголовке:

```python example
import time

from fastapi import FastAPI, Request

app = FastAPI()


@app.middleware("http")
async def add_process_time(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    elapsed = time.perf_counter() - started
    response.headers["X-Process-Time"] = f"{elapsed:.4f}"
    return response


@app.get("/ping")
def ping():
    return {"pong": True}
###
GET /ping
```

Ответ — `200` и `{"pong": true}`, а в заголовках появился `x-process-time` с числом секунд, например `0.0021`. Число у вас будет другим: оно зависит от скорости работы. `time.perf_counter()` — секундомер из стандартной библиотеки: разность двух его показаний даёт длительность. Запись `:.4f` оставляет четыре знака после запятой. Заголовки, которые придумали вы сами, по традиции начинаются с `X-`.

### Порядок middleware

Если слоёв несколько, они оборачивают приложение как луковица. **Последний добавленный слой — самый внешний**: запрос проходит через него первым, а ответ покидает его последним.

```python example
from fastapi import FastAPI, Request

app = FastAPI()


@app.middleware("http")
async def first(request: Request, call_next):
    request.scope.setdefault("trace", []).append("first")
    response = await call_next(request)
    response.headers["X-Out"] = response.headers.get("X-Out", "") + "first;"
    return response


@app.middleware("http")
async def second(request: Request, call_next):
    request.scope.setdefault("trace", []).append("second")
    response = await call_next(request)
    response.headers["X-Out"] = response.headers.get("X-Out", "") + "second;"
    return response


@app.get("/work")
def work(request: Request):
    return {"in": request.scope["trace"]}
###
GET /work
```

Ответ: `{"in": ["second", "first"]}`, заголовок `x-out: first;second;`. Запрос шёл по слоям с внешнего: сначала `second` (добавлен позже), потом `first`, потом обработчик. Ответ вернулся в обратном порядке: сначала дописал `first`, затем `second`. Здесь `request.scope` — словарь запроса, общий для всех слоёв; в него слои складывают заметки.

Практический вывод: слой, который должен видеть всё (подсчёт времени, журнал), добавляйте последним. Слой, который проверяет доступ и может прервать запрос, ставьте так, чтобы раньше него ничего лишнего не выполнялось.

Подробность: `@app.middleware("http")` удобен для заголовков и измерений. Читать в нём тело запроса не стоит: тело придётся разбирать дважды.

### CORS: чужой сайт и браузер

Страница на `https://app.example.com` отправляет запрос к вашему API на другом адресе. Браузер по умолчанию не отдаёт странице такой ответ, пока сервер явно не разрешил этот сайт. Это защита **браузера**, а не сервера: запрос до сервера доходит и обрабатывается, но страница не получит результат. Разрешение — заголовки ответа `Access-Control-Allow-*`. Правила называют **CORS**. Если вы читали урок о CORS в курсе по API, здесь то же самое, только со стороны сервера; читать его для понимания этого раздела не нужно.

Два вида запросов:

- обычный (`GET`, простой `POST`) — браузер сразу отправляет его с заголовком `Origin` (откуда страница) и смотрит на заголовки ответа;
- «сложный» (`PUT`, `DELETE`, JSON с нестандартными заголовками) — браузер сначала отправляет **предзапрос** `OPTIONS` с вопросом «можно ли?» и только после положительного ответа посылает настоящий.

В FastAPI это включает готовый слой Starlette, `CORSMiddleware`. Он сам отвечает на предзапросы и добавляет заголовки.

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)
```

- `app.add_middleware(Класс, настройки...)` — подключает готовый класс-middleware. Настройки передаются именованными аргументами.
- `allow_origins` — список сайтов (`схема://хост[:порт]`, без слэша на конце), которым разрешено. `["*"]` — любым.
- `allow_credentials=True` — разрешить запросы с cookie и данными авторизации. Тогда `["*"]` для источников не годится: браузер не принимает звёздочку вместе с учётными данными, перечислите источники явно.
- `allow_methods` — разрешённые методы; по умолчанию только `GET`.
- `allow_headers` — разрешённые заголовки запроса.
- Слой подключается последним среди прочих, чтобы он был самым внешним и добавлял заголовки и к ответам с ошибками.

```python example
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization"],
)


@app.get("/notes")
def list_notes():
    return ["first", "second"]
###
GET /notes
Origin: https://app.example.com
###
GET /notes
Origin: https://other.example
###
OPTIONS /notes
Origin: https://app.example.com
Access-Control-Request-Method: POST
###
OPTIONS /notes
Origin: https://other.example
Access-Control-Request-Method: POST
```

Что вернулось:

- запрос со «своего» сайта: `200`, тело `["first", "second"]` и заголовки `access-control-allow-origin: https://app.example.com`, `access-control-allow-credentials: true`;
- запрос с чужого сайта: тоже `200` и тело, но заголовка `access-control-allow-origin` нет. Сервер выполнил запрос, а браузер не отдаст ответ странице с `https://other.example`;
- предзапрос со своего сайта: `200`, тело `OK` и заголовки со списками разрешённых методов (`access-control-allow-methods`) и заголовков;
- предзапрос с чужого: `400`, текст `Disallowed CORS origin` и нет заголовка `access-control-allow-origin`.

В студии нет браузера, поэтому проверяется то, что делает сервер: заголовки ответа. Запрос заголовком `Origin` вы описываете сами.

### Глобальные зависимости

Проверка, которая нужна каждому маршруту (ключ сервиса, версия клиента), не должна повторяться в каждом декораторе. Её передают приложению целиком:

```python
app = FastAPI(dependencies=[Depends(verify_token)])
```

- `dependencies=[...]` в `FastAPI(...)` — список зависимостей, выполняемых перед **каждым** маршрутом приложения, в том числе в подключённых роутерах.
- Это та же идея, что `dependencies` у `APIRouter` из предыдущего урока, но на уровень выше: роутер защищает свою группу, приложение — всё.
- Результат такой зависимости обработчику не передаётся: она проверяет и при необходимости поднимает `HTTPException`.
- Параметры зависимости (например, заголовок) попадают в документацию каждой операции: на странице `/docs` у каждого маршрута виден обязательный заголовок.

```python example
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException


def verify_token(x_token: Annotated[str, Header()]) -> None:
    if x_token != "t-1":
        raise HTTPException(status_code=401, detail="Bad token")


app = FastAPI(dependencies=[Depends(verify_token)])


@app.get("/a")
def read_a():
    return {"a": 1}


@app.get("/b")
def read_b():
    return {"b": 2}
###
GET /a
###
GET /b
X-Token: t-1
###
GET /b
X-Token: wrong
```

Ответы: без заголовка `422` (обязательный заголовок не передан), с верным — `200` и `{"b": 2}`, с неверным — `401` и `{"detail": "Bad token"}`. Проверка сработала на обоих маршрутах, хотя в обработчиках её нет.

### Что выбрать

- Нужно изменить или измерить каждый ответ (заголовки, время, журнал) — middleware.
- Нужно пустить браузерные страницы с другого сайта — `CORSMiddleware`.
- Нужна проверка доступа, у которой могут быть параметры и которая должна попасть в документацию — зависимость: глобальная, на роутер или на маршрут.
- Нужно получить значение в обработчике (пользователя, настройки) — обычная зависимость с `Depends`.

### Частые ошибки

- Не вызван `call_next`. Неверно: функция middleware возвращает свой ответ, не вызвав `await call_next(request)` — обработчики перестанут работать. Верно: `response = await call_next(request)` и в конце `return response`.
- Забыт `await`. Неверно: `response = call_next(request)`. Верно: `response = await call_next(request)`.
- Звёздочка с учётными данными. Неверно: `allow_origins=["*"], allow_credentials=True`. Верно: перечислить источники.
- Слэш на конце источника. Неверно: `"https://app.example.com/"`. Верно: `"https://app.example.com"`.
- Расчёт, что CORS защищает сервер. Неверно: считать, что чужой сайт не сможет отправить запрос. Верно: CORS ограничивает только чтение ответа в браузере; защита доступа — это авторизация.

### Шпаргалка

- `@app.middleware("http")`, `async def f(request, call_next)`; `response = await call_next(request)`; `return response`.
- Заголовок ответа: `response.headers["X-Имя"] = "значение"`.
- Последний добавленный middleware — самый внешний.
- `app.add_middleware(CORSMiddleware, allow_origins=[...], allow_credentials=..., allow_methods=[...], allow_headers=[...])`.
- Предзапрос — `OPTIONS` с `Origin` и `Access-Control-Request-Method`.
- Глобальная зависимость: `FastAPI(dependencies=[Depends(f)])`; у роутера — `APIRouter(dependencies=[...])`.

## task fa-middleware-header
```json
{
  "type": "fastapi",
  "title": "Служебные заголовки в каждом ответе",
  "xp": 15,
  "hints": [
    "Раздел «Middleware: слой вокруг приложения»: заголовки добавляют после `await call_next(request)`, тогда они попадают и в ответы с ошибками.",
    "Счётчик запросов хранится в словаре `COUNTER` (он уже есть). Увеличьте его до вызова `call_next` и запишите в заголовок строкой: значения заголовков — текст.",
    "Шаблон: `COUNTER[\"requests\"] += 1`, `response = await call_next(request)`, `response.headers[\"X-Request-Number\"] = str(…)`, `response.headers[\"X-Powered-By\"] = …`, `return response`."
  ],
  "check": { "headers": ["x-request-number", "x-powered-by"] },
  "wrong": {
    "only-ok": "заголовки добавляются только к ответам с кодом 200, ответы с ошибками остаются без них",
    "zero-based": "нумерация запросов начинается с нуля, а нужна с единицы"
  }
}
```
В трекер нужно добавить middleware, которое ставит в **каждый** ответ два заголовка:

- `X-Request-Number` — порядковый номер запроса с момента запуска приложения, начиная с `1` (счётчик ведёт словарь `COUNTER`);
- `X-Powered-By` — строка `tracker`.

Заголовки нужны и у ответов с ошибками: `404` от несуществующей задачи, `422` от неверного номера. Сами маршруты менять не нужно.

```python starter
from fastapi import FastAPI, HTTPException, Request

app = FastAPI()
COUNTER = {"requests": 0}
TASKS = {1: "Write report", 2: "Review code"}


@app.middleware("http")
async def add_headers(request: Request, call_next):
    …


@app.get("/ping")
def ping():
    return {"pong": True}


@app.get("/tasks/{task_id}")
def read_task(task_id: int):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"id": task_id, "title": TASKS[task_id]}
```

```python solution
from fastapi import FastAPI, HTTPException, Request

app = FastAPI()
COUNTER = {"requests": 0}
TASKS = {1: "Write report", 2: "Review code"}


@app.middleware("http")
async def add_headers(request: Request, call_next):
    COUNTER["requests"] += 1
    response = await call_next(request)
    response.headers["X-Request-Number"] = str(COUNTER["requests"])
    response.headers["X-Powered-By"] = "tracker"
    return response


@app.get("/ping")
def ping():
    return {"pong": True}


@app.get("/tasks/{task_id}")
def read_task(task_id: int):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"id": task_id, "title": TASKS[task_id]}
```

```python wrong id=only-ok
from fastapi import FastAPI, HTTPException, Request

app = FastAPI()
COUNTER = {"requests": 0}
TASKS = {1: "Write report", 2: "Review code"}


@app.middleware("http")
async def add_headers(request: Request, call_next):
    COUNTER["requests"] += 1
    response = await call_next(request)
    if response.status_code == 200:
        response.headers["X-Request-Number"] = str(COUNTER["requests"])
        response.headers["X-Powered-By"] = "tracker"
    return response


@app.get("/ping")
def ping():
    return {"pong": True}


@app.get("/tasks/{task_id}")
def read_task(task_id: int):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"id": task_id, "title": TASKS[task_id]}
```

```python wrong id=zero-based
from fastapi import FastAPI, HTTPException, Request

app = FastAPI()
COUNTER = {"requests": 0}
TASKS = {1: "Write report", 2: "Review code"}


@app.middleware("http")
async def add_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Request-Number"] = str(COUNTER["requests"])
    response.headers["X-Powered-By"] = "tracker"
    COUNTER["requests"] += 1
    return response


@app.get("/ping")
def ping():
    return {"pong": True}


@app.get("/tasks/{task_id}")
def read_task(task_id: int):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"id": task_id, "title": TASKS[task_id]}
```

```http tests
GET /ping
###
GET /tasks/1
###
GET /tasks/9
###
GET /tasks/abc
###
GET /ping
```

## task fa-middleware-order
```json
{
  "type": "choice",
  "title": "В каком порядке сработают слои",
  "xp": 10,
  "hints": [
    "Раздел «Порядок middleware».",
    "Последний добавленный слой самый внешний: запрос проходит через него первым, а ответ покидает его последним.",
    "Слой `audit` добавлен последним, значит, он внешний. Запрос: `audit`, затем `timing`, затем обработчик. Ответ идёт обратно: `timing`, затем `audit`."
  ],
  "options": [
    "audit in → timing in → handler → timing out → audit out",
    "timing in → audit in → handler → audit out → timing out",
    "audit in → timing in → handler → audit out → timing out",
    "timing in → audit in → handler → timing out → audit out"
  ],
  "answer": [0],
  "explanation": "Слой, добавленный позже, оборачивает более ранние, поэтому `audit` (второй декоратор) оказывается снаружи. Запрос проходит слои снаружи внутрь: `audit`, `timing`, обработчик. Ответ возвращается изнутри наружу, в обратном порядке: сначала `timing out`, потом `audit out`. Варианты 2 и 4 ставят внутренним слоем `audit`, это порядок, в котором слои были бы добавлены наоборот. В варианте 3 запрос идёт верно, но ответ почему-то выходит в том же порядке, а не в обратном."
}
```
Приложение собрано так, что каждый слой пишет в журнал строку «имя in» до вызова `call_next` и «имя out» после него. Что окажется в журнале после одного запроса к `/`?

```python
@app.middleware("http")
async def timing(request: Request, call_next):
    LOG.append("timing in")
    response = await call_next(request)
    LOG.append("timing out")
    return response


@app.middleware("http")
async def audit(request: Request, call_next):
    LOG.append("audit in")
    response = await call_next(request)
    LOG.append("audit out")
    return response


@app.get("/")
def root():
    LOG.append("handler")
    return {"ok": True}
```

## task fa-middleware-cors
```json
{
  "type": "fastapi",
  "title": "Пустите страницу трекера на API",
  "xp": 20,
  "hints": [
    "Раздел «CORS: чужой сайт и браузер»: слой `CORSMiddleware` подключают через `app.add_middleware`, настройки пишут именованными аргументами.",
    "Источник один: `https://app.example.com` (без слэша на конце). Нужны `allow_credentials=True`, методы `GET` и `POST`, заголовки `Authorization` и `Content-Type`. Звёздочку использовать нельзя.",
    "Шаблон: `from fastapi.middleware.cors import CORSMiddleware`, затем `app.add_middleware(CORSMiddleware, allow_origins=[…], allow_credentials=…, allow_methods=[…], allow_headers=[…])`."
  ],
  "check": {
    "headers": [
      "access-control-allow-origin",
      "access-control-allow-credentials",
      "access-control-allow-methods",
      "access-control-allow-headers"
    ]
  },
  "wrong": {
    "wildcard-origin": "разрешены все сайты через звёздочку, а не только страница трекера",
    "no-credentials": "учётные данные не разрешены: страница не сможет отправлять cookie"
  }
}
```
Страница трекера живёт на `https://app.example.com` и обращается к этому API из браузера. Включите CORS так, чтобы:

- страница `https://app.example.com` могла отправлять запросы вместе с cookie и данными авторизации;
- другим сайтам ничего не разрешалось;
- разрешены только методы `GET` и `POST` и заголовки запроса `Authorization` и `Content-Type`.

Маршрут `GET /tasks` уже есть. Проверка отправляет обычные и предварительные (`OPTIONS`) запросы с разными `Origin` и сравнивает заголовки `access-control-allow-*` с эталонными.

```python starter
from fastapi import FastAPI

app = FastAPI()


@app.get("/tasks")
def list_tasks():
    return [{"id": 1, "title": "Write report"}]
```

```python solution
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/tasks")
def list_tasks():
    return [{"id": 1, "title": "Write report"}]
```

```python wrong id=wildcard-origin
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/tasks")
def list_tasks():
    return [{"id": 1, "title": "Write report"}]
```

```python wrong id=no-credentials
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/tasks")
def list_tasks():
    return [{"id": 1, "title": "Write report"}]
```

```http tests
GET /tasks
Origin: https://app.example.com
###
GET /tasks
Origin: https://other.example
###
GET /tasks
###
OPTIONS /tasks
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization
###
OPTIONS /tasks
Origin: https://other.example
Access-Control-Request-Method: POST
###
OPTIONS /tasks
Origin: https://app.example.com
Access-Control-Request-Method: DELETE
```

## task fa-global-deps
```json
{
  "type": "openapi",
  "title": "Токен на каждом маршруте",
  "xp": 15,
  "hints": [
    "Раздел «Глобальные зависимости»: список зависимостей для всех маршрутов передаётся в `FastAPI(dependencies=[...])`.",
    "Зависимость `verify_token` уже написана в `deps.py` и принимает обязательный заголовок `X-Token`. Подключите её один раз на уровне приложения, а не в каждом маршруте.",
    "Шаблон: `from deps import verify_token`, затем `app = FastAPI(title=\"Tracker\", dependencies=[Depends(verify_token)])`; `Depends` берётся из `fastapi`."
  ],
  "readonly": ["deps.py", "routers/__init__.py", "routers/tasks.py"],
  "check": { "compare": ["params", "responses"] },
  "wrong": {
    "no-global": "зависимость не подключена: в документации маршрутов нет заголовка X-Token",
    "only-router": "зависимость подключена только к одному роутеру, а маршрут /health остался без неё"
  }
}
```
У трекера два роутера в `routers/` и маршрут `GET /health` в `main.py`. По новому правилу каждый запрос должен нести заголовок `X-Token`: без него `422`, с неверным значением `401`. Проверка токена уже написана, это зависимость `verify_token` из `deps.py`. Подключите её так, чтобы действовала на все маршруты сразу, включая `/health`, и не трогая сами обработчики.

Идея проверки: `/openapi.json` вашего приложения сравнивается с эталонным. Если зависимость подключена ко всем маршрутам, у каждой операции описан обязательный заголовок `x-token` и ответ `422`; проверяются набор маршрутов, параметры и коды ответов.

```python starter path=main.py
from fastapi import FastAPI

from routers.tasks import router as tasks_router

app = FastAPI(title="Tracker")
app.include_router(tasks_router)


@app.get("/health")
def health():
    return {"ok": True}
```

```python starter path=deps.py
from typing import Annotated

from fastapi import Header, HTTPException


def verify_token(x_token: Annotated[str, Header()]) -> None:
    if x_token != "t-1":
        raise HTTPException(status_code=401, detail="Bad token")
```

```python starter path=routers/__init__.py
```

```python starter path=routers/tasks.py
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/tasks", tags=["tasks"])
TASKS = {1: "Write report"}


@router.get("")
def list_tasks():
    return list(TASKS.values())


@router.get("/{task_id}")
def read_task(task_id: int):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"id": task_id, "title": TASKS[task_id]}
```

```python solution path=main.py
from fastapi import Depends, FastAPI

from deps import verify_token
from routers.tasks import router as tasks_router

app = FastAPI(title="Tracker", dependencies=[Depends(verify_token)])
app.include_router(tasks_router)


@app.get("/health")
def health():
    return {"ok": True}
```

```python solution path=deps.py
from typing import Annotated

from fastapi import Header, HTTPException


def verify_token(x_token: Annotated[str, Header()]) -> None:
    if x_token != "t-1":
        raise HTTPException(status_code=401, detail="Bad token")
```

```python solution path=routers/__init__.py
```

```python solution path=routers/tasks.py
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/tasks", tags=["tasks"])
TASKS = {1: "Write report"}


@router.get("")
def list_tasks():
    return list(TASKS.values())


@router.get("/{task_id}")
def read_task(task_id: int):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"id": task_id, "title": TASKS[task_id]}
```

```python wrong id=no-global path=main.py
from fastapi import FastAPI

from routers.tasks import router as tasks_router

app = FastAPI(title="Tracker")
app.include_router(tasks_router)


@app.get("/health")
def health():
    return {"ok": True}
```

```python wrong id=only-router path=main.py
from fastapi import Depends, FastAPI

from deps import verify_token
from routers.tasks import router as tasks_router

app = FastAPI(title="Tracker")
app.include_router(tasks_router, dependencies=[Depends(verify_token)])


@app.get("/health")
def health():
    return {"ok": True}
```
