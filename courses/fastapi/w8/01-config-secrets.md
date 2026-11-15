# Настройки по окружениям и секреты

Интернет-магазин работает в трёх местах: на ноутбуке разработчика, на тестовом сервере и в продакшене. Код один, а адрес базы, ключ подписи и включённая отладка у каждого места свои. Если эти значения вписаны в код, то одно забытое исправление раскрывает пароль или оставляет открытой страницу `/docs`. В этом уроке вы вынесете всё, что зависит от места запуска, в настройки, научитесь проверять их при старте и закрывать в продакшене лишнее.

Класс `BaseSettings`, файл `.env` и приведение типов вы уже знаете из урока про lifespan и настройки. Здесь они нужны для нового: различать окружения и останавливать запуск, если конфигурация неверна.

### Окружение как поле настроек

**Окружение** — место, где запущено приложение: `development` (разработка), `staging` (тестовый стенд), `production` (боевой сервер). Название окружения хранят в настройках, как любое другое значение.

```python
class Settings(BaseSettings):
    environment: str = "development"
    debug: bool = False
    database_url: str = "sqlite:///shop.db"
    secret_key: str
```

- `environment: str = "development"` — по умолчанию приложение считает себя запущенным на ноутбуке. Боевой сервер явно задаёт `ENVIRONMENT=production`.
- `debug: bool = False` — отладка по умолчанию выключена. Опасное значение (`True`) должно включаться явно, а не наоборот.
- `database_url` — на ноутбуке удобен файл, на сервере в переменной окружения придёт адрес настоящей базы.
- `secret_key: str` — обязательное поле без значения: нет ключа — нет запуска.

Каждое значение приходит снаружи: переменной окружения на сервере или строкой в `.env` на ноутбуке. Приоритет вы знаете: окружение главнее файла, файл главнее умолчания. Принцип «конфигурация живёт вне кода» заложен в методологию «двенадцати факторов»; для вас важен практический вывод: один и тот же образ или архив с кодом запускается везде, а различается только окружение.

### Что закрывают в продакшене

У FastAPI есть три адреса, которые удобны разработчику и не нужны посторонним: интерактивная документация `/docs`, её второй вариант `/redoc` и описание API `/openapi.json`. Они показывают все маршруты, поля и примеры. Их отключают параметрами приложения:

```python
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
```

- `docs_url="/docs"` — адрес страницы документации. `None` отключает её: запрос получит обычный `404`.
- `redoc_url="/redoc"` — то же для второй страницы.
- `openapi_url="/openapi.json"` — адрес описания API. Если отключить только страницы, а описание оставить, посторонний всё равно прочтёт полный список маршрутов. Поэтому отключают все три.

Условное значение в Python записывается так: `значение_если_да if условие else значение_если_нет`.

```python example
from fastapi import FastAPI
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    hotel_name: str = "Seaside"


settings = Settings(environment="production")
is_prod = settings.environment == "production"

app = FastAPI(
    title=settings.hotel_name,
    docs_url=None if is_prod else "/docs",
    redoc_url=None if is_prod else "/redoc",
    openapi_url=None if is_prod else "/openapi.json",
)


@app.get("/rooms")
def list_rooms():
    return ["101", "102"]
###
GET /rooms
###
GET /docs
###
GET /openapi.json
```

Первый запрос возвращает `200` и `["101", "102"]`. Второй и третий возвращают `404` и `{"detail": "Not Found"}`: маршрутов `/docs` и `/openapi.json` в приложении нет. Если заменить `"production"` на `"development"`, оба адреса заработают. Значение передано прямо в `Settings(...)`, чтобы пример не зависел от окружения студии.

Скрытая документация — не защита. Сами маршруты остаются открытыми, и безопасность обеспечивает авторизация. Отключение лишь не раздаёт карту API каждому прохожему. Если документация нужна команде, её публикуют отдельно или защищают входом.

Ещё один параметр: `FastAPI(debug=True)` включает режим отладки, в котором при необработанной ошибке клиент получает страницу с трассировкой: путями к файлам и кусками кода. В продакшене `debug` всегда выключен. Его значение берут из настроек, а умолчание — `False`.

### Проверка конфигурации при старте

Неверная конфигурация должна остановить запуск, а не проявиться через неделю на первом запросе. Такой подход называют **fail fast** («падать сразу»). Если приложение не стартовало, оркестратор или администратор увидит ошибку сразу, а старая рабочая версия продолжит работать. Если же приложение запустилось с `secret_key="1"`, оно будет работать месяцами и ничем не выдаст проблему.

Типы и обязательные поля `BaseSettings` проверяет сам. Правила смысла добавляют уже знакомыми валидаторами: `field_validator` для одного поля и `model_validator(mode="after")` для связи полей. Ошибку проверки при создании настроек поднимает pydantic как `ValidationError`.

```python
from pydantic import ValidationError

try:
    settings = Settings(**данные)
except ValidationError as exc:
    problems = [error["msg"] for error in exc.errors()]
```

- `from pydantic import ValidationError` — класс исключения проверки.
- `Settings(**данные)` — создаёт настройки из словаря; значения, переданные напрямую, главнее окружения и файла.
- `exc.errors()` — список словарей, по одному на каждую найденную проблему. У словаря есть `loc` (где ошибка: имя поля) и `msg` (текст).
- `error["msg"]` — сообщение. Для своего правила это `Value error, ` и текст из `ValueError`, для неверного типа — стандартный текст pydantic, для пропущенного поля — `Field required`.

На настоящем сервере проверка короче: строка `settings = Settings()` на уровне модуля. Если конфигурация неверна, при импорте модуля случится `ValidationError`, процесс завершится с трассировкой, и контейнер не станет «здоровым». Пример ниже показывает ту же проверку на сервисе бронирования. Он принимает набор значений и отвечает, годятся ли они для запуска: так выглядит проверка конфигурации перед выкладкой.

```python example
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError, field_validator
from pydantic_settings import BaseSettings


class BookingSettings(BaseSettings):
    max_guests: int = 4
    hold_minutes: int

    @field_validator("hold_minutes")
    @classmethod
    def hold_is_positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("hold_minutes must be positive")
        return value


app = FastAPI()


@app.post("/check")
def check_config(data: dict):
    try:
        settings = BookingSettings(**data)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=[error["msg"] for error in exc.errors()])
    return {"hold": settings.hold_minutes, "max_guests": settings.max_guests}
###
POST /check
Content-Type: application/json

{"hold_minutes": 15}
###
POST /check
Content-Type: application/json

{"hold_minutes": 0}
###
POST /check
Content-Type: application/json

{"max_guests": "many", "hold_minutes": 10}
###
POST /check
Content-Type: application/json

{}
```

Результаты:

- первый запрос: `200` и `{"hold": 15, "max_guests": 4}`, `max_guests` взял умолчание;
- второй: `422` и `["Value error, hold_minutes must be positive"]`, сработал наш валидатор;
- третий: `422` и сообщение pydantic о том, что `many` не целое число;
- четвёртый: `422` и `["Field required"]`, обязательного поля нет.

Здесь `detail` — список строк, а не словарь: `HTTPException` принимает любой JSON-совместимый `detail`.

Какие правила стоит писать для боевых настроек:

- ключ подписи не короче 16 символов и не равен значению-заготовке вроде `change-me`;
- `debug` выключен, когда `environment == "production"`;
- название окружения входит в известный список: опечатка `prodution` не должна тихо включить режим разработки;
- адрес базы не указывает на файл в боевом окружении.

### Откуда берутся секреты

**Секрет** — значение, которое даёт доступ: пароль базы, ключ подписи токенов, токен платёжного сервиса. Правила те же, что в уроке про настройки: секретов нет в коде и нет значений по умолчанию. Остаётся вопрос, как секрет попадает в процесс на сервере. Варианты от простого к надёжному:

- **Переменные окружения.** Секрет задаёт тот, кто запускает процесс: администратор, скрипт выкладки, оркестратор. Приложение читает их через `BaseSettings`. Минус: переменные окружения видны в описании контейнера и в списке процессов тем, у кого есть доступ к серверу.
- **Файлы секретов.** Оркестратор монтирует секрет файлом, например `/run/secrets/secret_key`. `pydantic-settings` умеет читать такие файлы: `SettingsConfigDict(secrets_dir="/run/secrets")`, имя файла совпадает с именем поля. Это команда в конфигурации, а не рабочий пример: в студии такой папки нет.
- **Секрет-хранилище облака или отдельный сервис** (менеджер секретов): значения выдаются по запросу с проверкой прав, ведётся журнал обращений, их можно менять без пересборки. Это отдельная тема эксплуатации. Для приложения результат тот же: значение приходит в окружение или файл, а в код не попадает.
- **Файл `.env`** — только локально, для ноутбука. Его не добавляют в репозиторий и не кладут в образ; в репозитории лежит `.env.example` с пустыми значениями.

Секрет, который хоть раз попал в репозиторий, считается раскрытым: его меняют, а не просто удаляют из следующего коммита. История репозитория помнит всё.

### Чего избегать

- Значение по умолчанию для секрета: `secret_key: str = "dev"` и `os.getenv("SECRET_KEY", "dev")`. При опечатке в имени переменной боевой сервер молча запустится со слабым ключом.
- `debug: bool = True` по умолчанию. Сначала безопасное значение, потом явное включение на ноутбуке.
- Секрет в `Dockerfile` строкой `ENV SECRET_KEY=...`: он попадает в образ и виден в его истории.
- Печать настроек целиком в журнал или в ответ `/config`: вместе с остальным выйдут и секреты.

### Частые ошибки

- Отключены только страницы документации. Неверно: `FastAPI(docs_url=None)`. Верно: ещё `redoc_url=None` и `openapi_url=None`, иначе `/openapi.json` остаётся открытым.
- Запасной секрет. Неверно: `getenv("SECRET_KEY", "dev")`. Верно: поле без значения, ошибка при старте.
- Проверка есть, но настройки создаются лениво. Неверно: `Settings()` вызывается внутри обработчика, и ошибка придёт на первом запросе. Верно: создать настройки при запуске (на уровне модуля или в lifespan).
- Сравнение окружения с опечаткой. Неверно: `if settings.environment == "prodution"` тихо не сработает. Верно: ограничить допустимые значения валидатором.

### Шпаргалка

- `environment`, `debug`, `database_url`, `secret_key` — поля `BaseSettings`; секрет без умолчания.
- `FastAPI(docs_url=None, redoc_url=None, openapi_url=None)` в продакшене; `значение if условие else значение`.
- `debug` по умолчанию `False`.
- Fail fast: `field_validator`, `model_validator(mode="after")`, `except ValidationError as exc:`, `exc.errors()`, `error["msg"]`.
- Секреты: окружение, файлы секретов (`secrets_dir`), секрет-хранилище; `.env` только локально и вне репозитория.

## task fa-prod-docs-off
```json
{
  "type": "fastapi",
  "title": "Документация только для разработки",
  "xp": 15,
  "packages": ["settings"],
  "readonly": ["config.py", ".env"],
  "hints": [
    "Раздел «Что закрывают в продакшене»: у FastAPI три адреса — docs_url, redoc_url и openapi_url; значение None отключает адрес.",
    "Решение зависит от settings.environment: в «production» все три параметра равны None, в остальных окружениях — стандартные адреса. Условие пишется как значение if условие else значение.",
    "Шаблон: is_prod = settings.environment == \"production\"; app = FastAPI(title=…, docs_url=None if is_prod else \"/docs\", redoc_url=…, openapi_url=…)."
  ],
  "check": {
    "code": [
      { "pattern": "environment\\s*(==|!=|in)\\s", "message": "Решение должно зависеть от окружения: сравните settings.environment с \"production\", а не отключайте документацию всегда." }
    ]
  },
  "wrong": {
    "only-docs": "отключена только страница /docs, а /redoc и /openapi.json остаются открытыми",
    "always-off": "документация отключена безусловно, без учёта окружения из настроек"
  }
}
```
Магазин `Book Corner` запускается в продакшене: файл `.env` задаёт `ENVIRONMENT=production`, класс настроек лежит в `config.py`. Оба файла закрыты для правки. В `main.py` документация пока доступна всем.

Дополните `main.py`: если `settings.environment` равно `production`, адреса `/docs`, `/redoc` и `/openapi.json` не должны существовать, запросы к ним получают `404`. В остальных окружениях они остаются стандартными. Остальное поведение сохраните:

- `GET /info` — `{"environment": …, "shop": …}` из настроек;
- `GET /books` — список `["Dune", "Emma"]`.

```python starter path=main.py
from fastapi import FastAPI

from config import settings

app = FastAPI(title=settings.shop_name)


@app.get("/info")
def info():
    return {"environment": settings.environment, "shop": settings.shop_name}


@app.get("/books")
def list_books():
    return ["Dune", "Emma"]
```

```python starter path=config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    environment: str = "development"
    shop_name: str = "Book Corner"


settings = Settings()
```

```python starter path=.env
ENVIRONMENT=production
```

```python solution path=main.py
from fastapi import FastAPI

from config import settings

is_prod = settings.environment == "production"

app = FastAPI(
    title=settings.shop_name,
    docs_url=None if is_prod else "/docs",
    redoc_url=None if is_prod else "/redoc",
    openapi_url=None if is_prod else "/openapi.json",
)


@app.get("/info")
def info():
    return {"environment": settings.environment, "shop": settings.shop_name}


@app.get("/books")
def list_books():
    return ["Dune", "Emma"]
```

```python solution path=config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    environment: str = "development"
    shop_name: str = "Book Corner"


settings = Settings()
```

```python solution path=.env
ENVIRONMENT=production
```

```python wrong id=only-docs path=main.py
from fastapi import FastAPI

from config import settings

is_prod = settings.environment == "production"

app = FastAPI(title=settings.shop_name, docs_url=None if is_prod else "/docs")


@app.get("/info")
def info():
    return {"environment": settings.environment, "shop": settings.shop_name}


@app.get("/books")
def list_books():
    return ["Dune", "Emma"]
```

```python wrong id=always-off path=main.py
from fastapi import FastAPI

from config import settings

app = FastAPI(title=settings.shop_name, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/info")
def info():
    return {"environment": settings.environment, "shop": settings.shop_name}


@app.get("/books")
def list_books():
    return ["Dune", "Emma"]
```

```http tests
GET /info
###
GET /books
###
GET /docs
###
GET /redoc
###
GET /openapi.json
```

## task fa-prod-preflight
```json
{
  "type": "fastapi",
  "title": "Проверка настроек перед выкладкой",
  "xp": 20,
  "packages": ["settings"],
  "hints": [
    "Разделы «Проверка конфигурации при старте» и «field_validator»/«model_validator» из урока про pydantic: правило для одного поля — field_validator, правило про два поля — model_validator(mode=\"after\").",
    "Нужны три правила. Ключ не короче 16 символов (field_validator). Окружение из списка development, staging, production (field_validator). В production отладка выключена (model_validator). Обработчик уже превращает ValidationError в ответ 422.",
    "Шаблон: @field_validator(\"secret_key\") @classmethod def …(cls, value: str) -> str: if len(value) < 16: raise ValueError(…); return value. Для связи полей: @model_validator(mode=\"after\") def …(self) -> Self: if self.environment == \"production\" and self.debug: raise ValueError(…); return self."
  ],
  "wrong": {
    "no-debug-rule": "отладка в production не запрещена: настройки с debug=true принимаются",
    "no-length-rule": "короткий ключ подписи принимается без ошибки"
  }
}
```
Перед выкладкой CI отправляет набор настроек на `POST /preflight`, и сервис отвечает, годятся ли они для запуска. Класс `Settings` и обработчик готовы, но настройки принимаются любые. Допишите правила:

- `secret_key` — не короче 16 символов, иначе ошибка `secret_key must be at least 16 characters`;
- `environment` — одно из `development`, `staging`, `production`, иначе `unknown environment: <значение>`;
- в окружении `production` поле `debug` должно быть `false`, иначе `debug must be off in production`.

Ответ на верные настройки — `200` и `{"ok": true, "environment": …}`. Неверные дают `422` и список сообщений, например `["Value error, debug must be off in production"]`: слова `Value error, ` pydantic добавляет сам, их писать не нужно. Подсказка про порядок: если поле не прошло свою проверку, проверка модели целиком не выполняется.

```python starter
from typing import Self

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings

app = FastAPI(title="Shop preflight")


class Settings(BaseSettings):
    environment: str = "development"
    debug: bool = False
    secret_key: str

    …


@app.post("/preflight")
def preflight(data: dict):
    try:
        settings = Settings(**data)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=[error["msg"] for error in exc.errors()])
    return {"ok": True, "environment": settings.environment}
```

```python solution
from typing import Self

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings

app = FastAPI(title="Shop preflight")


class Settings(BaseSettings):
    environment: str = "development"
    debug: bool = False
    secret_key: str

    @field_validator("secret_key")
    @classmethod
    def secret_is_long(cls, value: str) -> str:
        if len(value) < 16:
            raise ValueError("secret_key must be at least 16 characters")
        return value

    @field_validator("environment")
    @classmethod
    def environment_is_known(cls, value: str) -> str:
        if value not in {"development", "staging", "production"}:
            raise ValueError(f"unknown environment: {value}")
        return value

    @model_validator(mode="after")
    def debug_is_off_in_production(self) -> Self:
        if self.environment == "production" and self.debug:
            raise ValueError("debug must be off in production")
        return self


@app.post("/preflight")
def preflight(data: dict):
    try:
        settings = Settings(**data)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=[error["msg"] for error in exc.errors()])
    return {"ok": True, "environment": settings.environment}
```

```python wrong id=no-debug-rule
from typing import Self

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError, field_validator
from pydantic_settings import BaseSettings

app = FastAPI(title="Shop preflight")


class Settings(BaseSettings):
    environment: str = "development"
    debug: bool = False
    secret_key: str

    @field_validator("secret_key")
    @classmethod
    def secret_is_long(cls, value: str) -> str:
        if len(value) < 16:
            raise ValueError("secret_key must be at least 16 characters")
        return value

    @field_validator("environment")
    @classmethod
    def environment_is_known(cls, value: str) -> str:
        if value not in {"development", "staging", "production"}:
            raise ValueError(f"unknown environment: {value}")
        return value


@app.post("/preflight")
def preflight(data: dict):
    try:
        settings = Settings(**data)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=[error["msg"] for error in exc.errors()])
    return {"ok": True, "environment": settings.environment}
```

```python wrong id=no-length-rule
from typing import Self

from fastapi import FastAPI, HTTPException
from pydantic import ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings

app = FastAPI(title="Shop preflight")


class Settings(BaseSettings):
    environment: str = "development"
    debug: bool = False
    secret_key: str

    @field_validator("environment")
    @classmethod
    def environment_is_known(cls, value: str) -> str:
        if value not in {"development", "staging", "production"}:
            raise ValueError(f"unknown environment: {value}")
        return value

    @model_validator(mode="after")
    def debug_is_off_in_production(self) -> Self:
        if self.environment == "production" and self.debug:
            raise ValueError("debug must be off in production")
        return self


@app.post("/preflight")
def preflight(data: dict):
    try:
        settings = Settings(**data)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=[error["msg"] for error in exc.errors()])
    return {"ok": True, "environment": settings.environment}
```

```http tests
POST /preflight
Content-Type: application/json

{"environment": "development", "debug": true, "secret_key": "local-dev-secret-key"}
###
POST /preflight
Content-Type: application/json

{"environment": "production", "debug": false, "secret_key": "kF3p9Lq2Zx8Wm4Rt7Yb1"}
###
POST /preflight
Content-Type: application/json

{"environment": "production", "debug": true, "secret_key": "kF3p9Lq2Zx8Wm4Rt7Yb1"}
###
POST /preflight
Content-Type: application/json

{"environment": "staging", "secret_key": "short"}
###
POST /preflight
Content-Type: application/json

{"environment": "prodution", "secret_key": "kF3p9Lq2Zx8Wm4Rt7Yb1"}
###
POST /preflight
Content-Type: application/json

{"environment": "production"}
```

## task fa-prod-secret-store
```json
{
  "type": "choice",
  "title": "Как пароль базы попадает на сервер",
  "xp": 10,
  "hints": [
    "Раздел «Откуда берутся секреты»: секрет приходит снаружи в окружение или файл, а в образе и репозитории его нет.",
    "Образ контейнера и репозиторий копируются, архивируются и читаются многими людьми. Значение, записанное в них, раскрыто.",
    "Верен вариант, где секрет задаёт тот, кто запускает контейнер, а приложение читает его через настройки."
  ],
  "options": [
    "Записать пароль строкой `ENV DATABASE_PASSWORD=...` в `Dockerfile`: так он всегда окажется в контейнере",
    "Положить пароль в `config.py` рядом с остальными настройками и закрыть репозиторий для посторонних",
    "Передать пароль контейнеру при запуске (окружение или файл секрета из хранилища оркестратора), а приложение читает его через `BaseSettings`",
    "Закоммитить файл `.env` с боевыми значениями: он нужен на сервере, значит должен лежать вместе с кодом"
  ],
  "answer": [2],
  "explanation": "Секрет, записанный в Dockerfile, остаётся в образе и в истории его слоёв: любой, кто получит образ, прочитает пароль. Пароль в config.py или в закоммиченном .env попадает в историю репозитория, а доступ к репозиторию шире, чем доступ к серверу; удалить значение из истории потом нельзя, пароль придётся менять. Правильный путь: значение задаёт тот, кто запускает контейнер, через окружение или смонтированный файл секрета, а код только описывает поле без значения по умолчанию. Тогда один образ годится для любого окружения, а при смене пароля пересобирать его не нужно."
}
```
Команда готовит выкладку интернет-магазина в контейнере. Приложение читает пароль базы через `BaseSettings`. Как пароль должен попасть на сервер?

## task fa-prod-config-review
```json
{
  "type": "review",
  "title": "Конфигурация, которую нельзя выпускать",
  "xp": 15,
  "lines": [4, 5, 6, 13],
  "hints": [
    "Разделы «Что закрывают в продакшене», «Откуда берутся секреты» и «Чего избегать».",
    "Проверьте по порядку: значение отладки, пароль в строке, запасной секрет в getenv, режим debug у приложения и содержимое ответа /config.",
    "Верных замечаний четыре: отладка, пароль в коде, запасной секрет и секреты в ответе. Два последних варианта придуманы: имя `app` и модуль `os` ни при чём."
  ],
  "options": [
    "Строка 4: `DEBUG = True` включена по умолчанию, а в продакшене режим отладки должен быть выключен и включаться только явной настройкой",
    "Строка 5: пароль базы записан прямо в код, его нужно читать из окружения через настройки и сменить, раз он уже попал в репозиторий",
    "Строка 6: запасное значение `dev-secret` в `getenv` станет боевым ключом при первой опечатке в имени переменной",
    "Строка 13: возврат в обработчике `/config` отдаёт в ответе пароль базы и ключ подписи любому, кто сделает запрос",
    "Строка 8: имя `app` нужно заменить на `application`, иначе сервер не найдёт приложение",
    "Строка 1: модуль `os` в продакшене использовать нельзя"
  ],
  "answer": [0, 1, 2, 3],
  "explanation": "Четыре проблемы настоящие. Включённая по умолчанию отладка в продакшене показывает посторонним трассировки; безопасное значение должно быть умолчанием. Пароль в коде попадает в репозиторий и раскрыт, его нужно хранить вне кода и сменить. Запасной секрет в getenv молча заменит настоящий при ошибке в имени переменной: приложение должно падать при старте. Ответ /config с секретами раскрывает их любому клиенту, показывать можно только несекретные значения. Имя app можно выбирать любое, главное, чтобы оно совпадало с командой запуска. Модуль os безопасен: проблема в том, как с его помощью читают секрет, а не в самом модуле."
}
```
Ниже фрагмент сервиса бронирования, который собираются выпустить в продакшен. Какие замечания верны? Выберите все.

```python code
import os
from fastapi import FastAPI

DEBUG = True
DATABASE_URL = "postgresql://booking:Zx81pass@db.internal/booking"
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret")

app = FastAPI(debug=DEBUG)


@app.get("/config")
def show_config():
    return {"database": DATABASE_URL, "secret": SECRET_KEY}
```
