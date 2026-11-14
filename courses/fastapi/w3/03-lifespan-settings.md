# Lifespan, состояние и настройки

Трекеру задач при запуске нужно загрузить справочник меток, а при остановке — сбросить буфер. Адрес базы и ключ подписи у него свои на каждом сервере: на ноутбуке разработчика одни, на боевом сервере другие, и в репозитории им быть нельзя. В этом уроке два инструмента: **lifespan** — код запуска и остановки приложения, и **настройки** — значения, которые приложение читает снаружи.

### Lifespan: запуск и остановка

**Lifespan** («жизненный цикл») — одна асинхронная функция-генератор. Всё до `yield` выполняется один раз при запуске приложения, всё после — один раз при остановке. Идея та же, что у `yield`-зависимости, только не на запрос, а на всё приложение.

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # запуск: открыть, загрузить, подготовить
    yield
    # остановка: закрыть, сохранить


app = FastAPI(lifespan=lifespan)
```

- `from contextlib import asynccontextmanager` — декоратор из стандартной библиотеки. Он превращает функцию с `yield` в менеджер контекста, который умеет обслуживать `async with`. Вызывать его самому не нужно: FastAPI сделает это при запуске.
- `async def lifespan(app: FastAPI)` — функция получает приложение; через него кладут общие данные.
- `yield` — граница. Пока приложение работает, функция «стоит» на этой строке.
- `FastAPI(lifespan=lifespan)` — подключает функцию. Без этого аргумента код никогда не выполнится.

### app.state и request.state

- `app.state` — пустой «ящик» приложения: в него кладут любые атрибуты (`app.state.rooms = ...`) и читают в любом обработчике. Живёт, пока работает приложение.
- `request.state` — такой же ящик, но на один запрос: в нём передают данные от зависимости к обработчику. К следующему запросу он пуст.
- `request` — объект запроса. Обработчик получает его параметром `request: Request` (`from fastapi import Request`); приложение доступно как `request.app`.

```python example
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.rooms = {"alpha": 4, "beta": 8}
    yield
    app.state.rooms.clear()


app = FastAPI(lifespan=lifespan)


@app.get("/rooms/{name}")
def read_room(name: str, request: Request):
    return {"name": name, "seats": request.app.state.rooms.get(name)}
###
GET /rooms/beta
###
GET /rooms/gamma
```

Справочник загружен при запуске и доступен через `request.app.state.rooms`. Ответы: `{"name": "beta", "seats": 8}` и `{"name": "gamma", "seats": null}` (для неизвестной переговорной `get` вернул `None`).

Разница между двумя ящиками видна на счётчике:

```python example
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.hits = 0
    yield


async def count_hit(request: Request) -> None:
    request.app.state.hits += 1
    request.state.number = request.app.state.hits


app = FastAPI(lifespan=lifespan)


@app.get("/visit", dependencies=[Depends(count_hit)])
def visit(request: Request):
    return {"visit": request.state.number}
###
GET /visit
###
GET /visit
```

Ответы: `{"visit": 1}` и `{"visit": 2}`. Общий счётчик `app.state.hits` растёт между запросами, а `request.state.number` создаётся заново в каждом. Зависимость в `dependencies=[...]` ничего не возвращает: она только записала число в `request.state`.

Правило выбора: общее на всё приложение (справочники, клиенты, настройки) — `app.state`; временное в пределах запроса — `request.state`. Данные в `app.state`, которые меняют обработчики, превращаются в общую переменную, поэтому записывать туда нужно осторожно.

### Чего избегать: on_event

В старом коде встречаются декораторы `@app.on_event("startup")` и `@app.on_event("shutdown")`. Они объявлены устаревшими: запуск и остановка разнесены по двум функциям, которые не могут делиться локальными переменными, а общий ресурс приходится хранить в глобальных переменных. В новых проектах пишут lifespan. Если в одном приложении задан `lifespan`, обработчики `on_event` перестают вызываться.

```python
# так не делайте в новом коде
@app.on_event("startup")
def load_labels():
    ...
```

### Настройки: pydantic-settings

Значения, которые меняются от сервера к серверу (адрес базы, ключ подписи, лимиты), берут из окружения. Для этого есть пакет `pydantic-settings`. Настройки описывают классом, как модель pydantic: типы и значения по умолчанию. Значения класс берёт из переменных окружения и из файла `.env` в корне проекта, а читает этот файл пакет `python-dotenv` (он ставится вместе с настройками).

```python
# config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    hall_name: str = "Main hall"
    max_guests: int = 10
    secret_key: str


settings = Settings()
```

```text
# .env
MAX_GUESTS=25
SECRET_KEY=local-dev-only
```

- `BaseSettings` — базовый класс настроек (вместо `BaseModel`).
- `model_config = SettingsConfigDict(env_file=".env")` — где искать файл. Путь считается от папки, из которой запущено приложение.
- Поле `hall_name: str = "Main hall"` — значение по умолчанию: если нигде ничего не задано, берётся оно.
- Поле без значения (`secret_key: str`) — обязательное. Если его нет ни в окружении, ни в файле, приложение не запустится и сообщит, какого поля не хватает.
- Имя переменной — имя поля заглавными буквами: `max_guests` ↔ `MAX_GUESTS`. Регистр не важен.
- Значение приходит строкой, а класс приводит его к типу поля: `MAX_GUESTS=25` станет числом `25`, `DEBUG=true` — `True`. Если привести нельзя (`MAX_GUESTS=many`), запуск завершится ошибкой `ValidationError`.
- Порядок приоритета: переменная окружения главнее файла, файл главнее значения по умолчанию. Тем и удобно: боевой сервер задаёт окружение, а файл остаётся для разработки.
- `settings = Settings()` — создаёт объект один раз; дальше его импортируют: `from config import settings`.

Файл `.env` с секретами не добавляют в репозиторий, а в репозитории хранят шаблон `.env.example` с пустыми значениями.

**Как это устроено в студии.** Файл `.env` лежит в проекте как обычный файл. Своих переменных окружения в студии нет, так что приоритет окружения вы не проверите; остальное работает как описано.

Типы и значения по умолчанию можно проверить и без файла: значения можно передать прямо в `Settings(...)`, они главнее всех остальных источников. Приведение типов работает так же, как при чтении из окружения.

```python example
from fastapi import FastAPI
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    hall_name: str = "Main hall"
    max_guests: int = 10
    debug: bool = False


settings = Settings(max_guests="25", debug="true")
app = FastAPI(title=settings.hall_name)


@app.get("/config")
def read_config():
    return {"hall": settings.hall_name, "max_guests": settings.max_guests, "debug": settings.debug}
###
GET /config
```

Ответ: `{"hall": "Main hall", "max_guests": 25, "debug": true}`. Строки `"25"` и `"true"` стали числом и логическим значением, а `hall_name` взял значение по умолчанию. Чтение файла `.env` показано в проекте ниже.

Пример проекта из трёх файлов, которые лежат рядом.

```python
# config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    hall_name: str = "Main hall"
    max_guests: int = 10
    debug: bool = False


settings = Settings()
```

```text
# .env
MAX_GUESTS=25
DEBUG=true
```

```python
# main.py
from fastapi import FastAPI

from config import settings

app = FastAPI(title=settings.hall_name)


@app.get("/config")
def read_config():
    return {"hall": settings.hall_name, "max_guests": settings.max_guests, "debug": settings.debug}
```

Запрос `GET /config` вернёт `200` и `{"hall": "Main hall", "max_guests": 25, "debug": true}`. Название зала не задано в файле, поэтому взято значение по умолчанию; `max_guests` и `debug` пришли из файла и приведены к `int` и `bool`. Если в файле написать `MAX_GUESTS=many`, приложение не загрузится: `ValidationError ... max_guests ... Input should be a valid integer`.

### Настройки как зависимость

Модуль, который при импорте создаёт `Settings()`, неудобно подменять. Чаще настройки отдают через функцию-зависимость и кэшируют, чтобы файл читался один раз:

```python
from functools import lru_cache
from typing import Annotated

from fastapi import Depends


@lru_cache
def get_settings() -> Settings:
    return Settings()


SettingsDep = Annotated[Settings, Depends(get_settings)]
```

- `@lru_cache` — декоратор из стандартной библиотеки: при повторных вызовах функция возвращает уже созданный объект, а не создаёт новый.
- В обработчике: `def info(settings: SettingsDep): ...`.
- Такую зависимость легко подменить в тесте, это пригодится в уроке про тестирование.

### Секреты не пишут в код

Ключ подписи, пароль базы, токен сервиса — секреты. Если они лежат в коде, они попадают в репозиторий, в отчёты об ошибках и к каждому, кто видел код. Правила:

- секрет приходит из окружения или `.env`, в коде его нет;
- у секрета в настройках нет значения по умолчанию: пропущенный секрет должен остановить запуск, а не тихо заменить настоящий слабым;
- `os.getenv("SECRET_KEY", "dev")` — та же ошибка: запасное значение из кода станет боевым при первой опечатке в окружении.

Проверка в студии разбирает код и ищет строковые значения у имён вроде `SECRET_KEY`, `API_KEY`, в том числе запасное значение в `getenv`.

### Частые ошибки

- Запуск из другой папки. Неверно: надеяться, что `.env` найдётся откуда угодно. Верно: путь относительный, запускайте из корня проекта.
- Секрет по умолчанию. Неверно: `secret_key: str = "dev"`. Верно: `secret_key: str` без значения.
- `lifespan` написан, но не подключён. Неверно: `app = FastAPI()`. Верно: `app = FastAPI(lifespan=lifespan)`.
- Забыт `yield`. Неверно: функция с `@asynccontextmanager` без `yield` не работает как менеджер контекста. Верно: ровно один `yield` между запуском и остановкой.
- `on_event` в новом коде. Неверно: `@app.on_event("startup")`. Верно: `lifespan`.

### Шпаргалка

- `@asynccontextmanager async def lifespan(app): ...; yield; ...` и `FastAPI(lifespan=lifespan)`.
- `app.state.имя` — на всё приложение; `request.state.имя` — на запрос; `request: Request`, `request.app`.
- `on_event` — устарел.
- `class Settings(BaseSettings)` + `model_config = SettingsConfigDict(env_file=".env")`.
- Поле без значения — обязательное; имена переменных — `ПОЛЕ` заглавными; приоритет: окружение, файл, значение по умолчанию.
- Типы приводятся, ошибка приведения — `ValidationError` при запуске.
- `@lru_cache def get_settings()` + `Depends(get_settings)`.
- Секреты не в коде и без значений по умолчанию. Файл настроек в студии — обычный файл проекта `.env`.

## task fa-lifespan-labels
```json
{
  "type": "fastapi",
  "title": "Справочник меток при запуске",
  "xp": 15,
  "hints": [
    "Разделы «Lifespan: запуск и остановка» и «app.state и request.state»: справочник кладут в `app.state` до `yield`.",
    "Нужны: функция `lifespan` с декоратором `@asynccontextmanager`, строка `app.state.labels = …` до `yield` и аргумент `lifespan=lifespan` в `FastAPI(...)`.",
    "Шаблон: `@asynccontextmanager`, `async def lifespan(app: FastAPI): app.state.labels = {…}`, `yield`; затем `app = FastAPI(title=\"Tracker\", lifespan=lifespan)`."
  ],
  "wrong": {
    "not-connected": "lifespan написан, но не передан в FastAPI: справочника нет, запросы падают с ошибкой 500",
    "missing-label": "при запуске загружена только одна метка из двух"
  }
}
```
Трекер задач хранит справочник меток в `app.state`. Справочник нужно загрузить один раз при запуске приложения: словарь `labels`, где ключ — название метки, а значение — её цвет:

- `bug` — `red`;
- `feature` — `green`.

Обработчики уже готовы и читают `request.app.state.labels`. Напишите `lifespan` и подключите его.

Ответы:

- `GET /labels` — список названий в алфавитном порядке: `["bug", "feature"]`;
- `GET /labels/{name}` — `{"name": имя, "color": цвет}` или `404` с `{"detail": "Label not found"}`.

```python starter
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request


@asynccontextmanager
async def lifespan(app: FastAPI):
    …
    yield


app = FastAPI(title="Tracker")


@app.get("/labels")
def list_labels(request: Request):
    return sorted(request.app.state.labels)


@app.get("/labels/{name}")
def read_label(name: str, request: Request):
    color = request.app.state.labels.get(name)
    if color is None:
        raise HTTPException(status_code=404, detail="Label not found")
    return {"name": name, "color": color}
```

```python solution
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.labels = {"bug": "red", "feature": "green"}
    yield


app = FastAPI(title="Tracker", lifespan=lifespan)


@app.get("/labels")
def list_labels(request: Request):
    return sorted(request.app.state.labels)


@app.get("/labels/{name}")
def read_label(name: str, request: Request):
    color = request.app.state.labels.get(name)
    if color is None:
        raise HTTPException(status_code=404, detail="Label not found")
    return {"name": name, "color": color}
```

```python wrong id=not-connected
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.labels = {"bug": "red", "feature": "green"}
    yield


app = FastAPI(title="Tracker")


@app.get("/labels")
def list_labels(request: Request):
    return sorted(request.app.state.labels)


@app.get("/labels/{name}")
def read_label(name: str, request: Request):
    color = request.app.state.labels.get(name)
    if color is None:
        raise HTTPException(status_code=404, detail="Label not found")
    return {"name": name, "color": color}
```

```python wrong id=missing-label
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.labels = {"bug": "red"}
    yield


app = FastAPI(title="Tracker", lifespan=lifespan)


@app.get("/labels")
def list_labels(request: Request):
    return sorted(request.app.state.labels)


@app.get("/labels/{name}")
def read_label(name: str, request: Request):
    color = request.app.state.labels.get(name)
    if color is None:
        raise HTTPException(status_code=404, detail="Label not found")
    return {"name": name, "color": color}
```

```http tests
GET /labels
###
GET /labels/bug
###
GET /labels/feature
###
GET /labels/idea
```

## task fa-settings-env
```json
{
  "type": "fastapi",
  "title": "Настройки трекера из файла",
  "xp": 20,
  "packages": ["settings"],
  "hints": [
    "Раздел «Настройки: pydantic-settings»: класс наследует `BaseSettings`, файл подключается через `model_config = SettingsConfigDict(env_file=...)`.",
    "Три поля: `app_name` (строка, по умолчанию `Tracker`), `max_tasks` (целое, по умолчанию `3`) и `admin_email` (строка без значения: обязательное). Значения из `.env` перекроют умолчания.",
    "Шаблон: `class Settings(BaseSettings): model_config = SettingsConfigDict(env_file=\".env\")`, затем `app_name: str = …`, `max_tasks: int = …`, `admin_email: str`."
  ],
  "readonly": ["main.py", ".env"],
  "wrong": {
    "no-env-file": "настройки не читают .env и работают на значениях по умолчанию",
    "string-limit": "лимит описан строкой, а не числом: сравнение количества с ним падает с ошибкой"
  }
}
```
Лимиты трекера вынесены в настройки. `main.py` и файл `.env` готовы и закрыты для правки, нужно написать класс `Settings` в `config.py`.

Поля настроек:

- `app_name` — строка, по умолчанию `Tracker`;
- `max_tasks` — целое число, по умолчанию `3`;
- `admin_email` — строка, обязательная, значения по умолчанию нет.

Файл `.env` задаёт `ADMIN_EMAIL` и `MAX_TASKS`, значит, приложение должно ответить на `GET /info` значениями оттуда: `{"app": "Tracker", "max_tasks": 2, "admin": "lead@example.com"}`. `POST /tasks` принимает `{"title": "..."}` и отвечает `201`; когда задач уже `max_tasks`, отвечает `409` и `{"detail": "Limit reached"}`.

```python starter path=main.py
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

from config import Settings, get_settings

app = FastAPI()
TASKS: list[dict] = []
SettingsDep = Annotated[Settings, Depends(get_settings)]


@app.get("/info")
def info(settings: SettingsDep):
    return {"app": settings.app_name, "max_tasks": settings.max_tasks, "admin": settings.admin_email}


@app.post("/tasks", status_code=201)
def create_task(data: dict, settings: SettingsDep):
    if len(TASKS) >= settings.max_tasks:
        raise HTTPException(status_code=409, detail="Limit reached")
    task = {"id": len(TASKS) + 1, "title": data["title"]}
    TASKS.append(task)
    return task
```

```python starter path=config.py
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    …


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

```python starter path=.env
ADMIN_EMAIL=lead@example.com
MAX_TASKS=2
```

```python solution path=main.py
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException

from config import Settings, get_settings

app = FastAPI()
TASKS: list[dict] = []
SettingsDep = Annotated[Settings, Depends(get_settings)]


@app.get("/info")
def info(settings: SettingsDep):
    return {"app": settings.app_name, "max_tasks": settings.max_tasks, "admin": settings.admin_email}


@app.post("/tasks", status_code=201)
def create_task(data: dict, settings: SettingsDep):
    if len(TASKS) >= settings.max_tasks:
        raise HTTPException(status_code=409, detail="Limit reached")
    task = {"id": len(TASKS) + 1, "title": data["title"]}
    TASKS.append(task)
    return task
```

```python solution path=config.py
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    app_name: str = "Tracker"
    max_tasks: int = 3
    admin_email: str


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

```python solution path=.env
ADMIN_EMAIL=lead@example.com
MAX_TASKS=2
```

```python wrong id=no-env-file path=config.py
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Tracker"
    max_tasks: int = 3
    admin_email: str = "nobody@example.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

```python wrong id=string-limit path=config.py
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    app_name: str = "Tracker"
    max_tasks: str = "3"
    admin_email: str


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

```http tests
GET /info
###
POST /tasks
Content-Type: application/json

{"title": "First"}
###
POST /tasks
Content-Type: application/json

{"title": "Second"}
###
POST /tasks
Content-Type: application/json

{"title": "Third"}
```

## task fa-settings-secret
```json
{
  "type": "static",
  "title": "Секрет не в коде",
  "xp": 15,
  "packages": ["settings"],
  "readonly": [".env"],
  "hints": [
    "Раздел «Секреты не пишут в код»: ключ приходит из окружения, а в настройках у него нет значения по умолчанию.",
    "Опишите класс настроек `Settings(BaseSettings)` с полем `secret_key: str` без значения и берите ключ из него. Присваивание `SECRET_KEY = \"...\"` и запасное значение в `getenv` проверка отклонит.",
    "Шаблон: `class Settings(BaseSettings): model_config = SettingsConfigDict(env_file=\".env\"); secret_key: str`, а в функции — `Settings().secret_key`."
  ],
  "check": {
    "static": [
      { "rule": "no-literal-secret", "names": ["secret_key", "api_key"], "message": "Ключ записан в коде. Уберите значение: пусть его читает класс настроек из окружения или файла .env." },
      { "rule": "uses", "name": "BaseSettings", "message": "Опишите настройки классом, который наследует BaseSettings из pydantic_settings." }
    ]
  },
  "wrong": {
    "default-secret": "у поля secret_key в настройках есть значение по умолчанию, то есть секрет всё равно записан в коде",
    "getenv-fallback": "ключ берётся из окружения, но с запасным значением в коде"
  }
}
```
Сервис подписывает ссылки на задачи ключом, который записан прямо в `main.py`. Ключ лежит в репозитории, значит, его видят все, кто видел код. Исправьте код: опишите настройки классом `Settings`, унаследованным от `BaseSettings`, с обязательным полем `secret_key`, и берите ключ оттуда.

В проекте уже есть файл `.env` со значением `SECRET_KEY`: он закрыт для правки, а ваш класс настроек должен читать ключ из него. Поведение `GET /link/{task_id}` менять не нужно: он возвращает `{"link": "https://tracker.example/t/<номер>?sig=<ключ>"}`. Проверка разбирает код, не запуская его: в нём не должно быть строкового значения у `secret_key` и `api_key`, зато должен быть `BaseSettings`.

```python starter
from fastapi import FastAPI

app = FastAPI()
SECRET_KEY = "change-me-123"


@app.get("/link/{task_id}")
def make_link(task_id: int):
    return {"link": f"https://tracker.example/t/{task_id}?sig={SECRET_KEY}"}
```

```python starter path=.env
SECRET_KEY=local-demo-key
```

```python solution
from fastapi import FastAPI
from pydantic_settings import BaseSettings, SettingsConfigDict

app = FastAPI()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    secret_key: str


@app.get("/link/{task_id}")
def make_link(task_id: int):
    secret_key = Settings().secret_key
    return {"link": f"https://tracker.example/t/{task_id}?sig={secret_key}"}
```

```python solution path=.env
SECRET_KEY=local-demo-key
```

```python wrong id=default-secret
from fastapi import FastAPI
from pydantic_settings import BaseSettings, SettingsConfigDict

app = FastAPI()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    secret_key: str = "change-me-123"


@app.get("/link/{task_id}")
def make_link(task_id: int):
    secret_key = Settings().secret_key
    return {"link": f"https://tracker.example/t/{task_id}?sig={secret_key}"}
```

```python wrong id=getenv-fallback
import os

from fastapi import FastAPI
from pydantic_settings import BaseSettings

app = FastAPI()


class Settings(BaseSettings):
    app_name: str = "Tracker"


@app.get("/link/{task_id}")
def make_link(task_id: int):
    secret_key = os.getenv("SECRET_KEY", "change-me-123")
    return {"link": f"https://tracker.example/t/{task_id}?sig={secret_key}"}
```

## task fa-lifespan-review
```json
{
  "type": "review",
  "title": "Старый способ запуска",
  "xp": 15,
  "lines": [7, 9],
  "hints": [
    "Разделы «Чего избегать: on_event» и «Секреты не пишут в код».",
    "В коде два замечания к строкам с декораторами и присваиванием: одно про способ запуска и остановки, другое про значение, которое нельзя хранить в репозитории.",
    "Верные варианты: заменить `on_event` на `lifespan` и убрать пароль из кода в настройки. Остальное либо не помогает, либо вредит."
  ],
  "options": [
    "Заменить `on_event(\"startup\")` и `on_event(\"shutdown\")` одной функцией `lifespan` с `yield` и передать её в `FastAPI(lifespan=...)`",
    "Взять пароль базы из настроек (`BaseSettings`, переменная окружения или файл `.env`), а в коде оставить только поле без значения",
    "Заменить `app.state` глобальной переменной: так обработчики быстрее получат доступ к соединению",
    "Заменить пароль в коде на другой, более сложный: так он будет надёжнее"
  ],
  "answer": [0, 1],
  "explanation": "Декораторы `on_event` устарели: запуск и остановка разделены на две функции, и общий ресурс приходится держать в глобальной переменной. Один `lifespan` с `yield` решает это и подключается к `FastAPI(lifespan=...)`. Пароль в коде попадает в репозиторий, как бы сложен он ни был, поэтому его читают из окружения через настройки. Замена `app.state` глобальной переменной не ускоряет ничего и возвращает проблему общего изменяемого состояния. Более сложный пароль в коде остаётся в коде."
}
```
Ниже фрагмент сервиса, который при запуске открывает соединение с базой. Какие изменения нужны? Выберите все верные.

```python code
from fastapi import FastAPI

app = FastAPI()
DB = {"conn": None}


@app.on_event("startup")
def connect():
    DB["conn"] = "postgres://tracker:s3cret-pass@db/tracker"


@app.on_event("shutdown")
def disconnect():
    DB["conn"] = None
```
