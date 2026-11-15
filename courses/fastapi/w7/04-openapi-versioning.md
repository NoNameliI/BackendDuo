# OpenAPI: описание и версии API

Мобильное приложение обращается к вашему API, и пользователи обновляют его месяцами. Если вы переименуете поле в ответе, старые версии приложения сломаются, а исправить их нельзя. Чтобы не ломать клиентов, API аккуратно описывают в документации и выпускают изменения новыми версиями рядом со старыми. В этом уроке вы доработаете описание API (теги, примеры, идентификаторы операций, устаревшие маршруты) и разведёте версии `/v1` и `/v2` через роутеры.

### Что FastAPI уже делает и что можно улучшить

FastAPI строит описание API по стандарту **OpenAPI** автоматически: список маршрутов, параметры, модели, коды ответов. Описание отдаётся на `/openapi.json`, а страницы `/docs` и `/redoc` рисуются по нему. Вы видели его в первом уроке этого мира. По тому же файлу генераторы создают клиентские библиотеки, а коллеги читают его как справочник.

Автоматическое описание точное, но бедное: заголовки берутся из имён функций (`Read Magazine`), у моделей нет примеров, а у тегов нет пояснений. Всё это можно улучшить без изменения логики.

### Метаданные приложения и теги

Название, версию и описание передают в `FastAPI(...)`. Описания тегов задаёт параметр `openapi_tags`.

```python
app = FastAPI(
    title="Название",
    summary="Короткое описание",
    version="1.2.0",
    openapi_tags=[{"name": "тег", "description": "Что в этом разделе"}],
)
```

- `title` — название API. Оно видно вверху страницы `/docs`.
- `summary` и `description` — короткое и подробное описание всего API (`description` понимает Markdown).
- `version` — версия **вашего API** (то, что вы публикуете), не версия FastAPI. Её меняют, когда меняется контракт.
- `openapi_tags` — список словарей. `name` совпадает с тегом, который указан у маршрутов (`tags=["тег"]` в `APIRouter` или в декораторе); `description` объясняет раздел. Порядок списка задаёт порядок разделов на странице `/docs`.

Описание отдельного маршрута задают в декораторе и в тексте функции:

- `summary="..."` — заголовок операции (вы уже писали его в первом уроке этого мира).
- Строка документации функции (`"""Текст."""` сразу под `def`) становится подробным описанием операции (`description`), в Markdown.
- `response_description="..."` — подпись к основному успешному ответу вместо «Successful Response».
- `Field(description="...")` — подпись поля модели: видна в схеме и в примере запроса.

### Примеры в моделях

Документации нужны примеры данных: клиентскому разработчику проще скопировать готовый JSON. Пример задают в модели, и он появляется в `/docs` как значение по умолчанию кнопки «Try it out».

```python
class ВходнаяМодель(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"поле": "значение"}]})

    поле: str = Field(description="Что это", examples=["значение"])
```

- `ConfigDict(json_schema_extra={"examples": [...]})` — пример **всей модели**: список словарей, каждый — готовый JSON тела.
- `Field(examples=[...])` — примеры значений **одного поля**: список допустимых значений.
- `Field(description="...")` — описание поля.
- `model_config` — настройки модели (вы использовали его для `from_attributes`).

Примеры только описывают API: приложение их не проверяет и не подставляет. Поэтому пример должен подчиняться правилам модели. Пример с ценой `-5` для поля `price` с условием `gt=0` вводит клиентов в заблуждение: документация обещает то, что сервер отклонит.

### Идентификаторы операций

У каждой операции в описании есть `operationId`: уникальное имя, по которому генераторы клиентов называют методы (`client.read_book(...)`). Без настройки FastAPI собирает его из имени функции и пути: `read_book_books__book_id__get`. Такие имена неудобны.

В первом уроке этого мира вы задавали `operation_id` для каждого маршрута вручную. Для всего приложения сразу идентификатор строит функция, которую передают в `generate_unique_id_function`:

```python
from fastapi.routing import APIRoute


def unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}_{route.name}"


app = FastAPI(generate_unique_id_function=unique_id)
```

- `from fastapi.routing import APIRoute` — тип описания маршрута.
- Функция получает `route` и возвращает строку-идентификатор. `route.name` — имя функции-обработчика, `route.tags` — список тегов маршрута.
- `route.tags[0]` — первый тег. Если у маршрута тегов нет, этот код упадёт с `IndexError`, поэтому тег ставят **всем** маршрутам (удобно в `APIRouter(tags=[...])`).
- `generate_unique_id_function=unique_id` — функция передаётся без скобок.
- Идентификаторы должны быть **уникальными** в пределах приложения. Если две операции получат одно имя, FastAPI предупредит о дубликате, а генераторы клиентов запутаются. Для двух версий API с одинаковыми именами функций тег версии (`v1`, `v2`) в идентификаторе спасает от конфликта.

### Устаревшие маршруты: deprecated

Маршрут, который скоро удалят, помечают `deprecated=True`: он остаётся рабочим, но в документации зачёркнут, а в описании стоит `"deprecated": true`. Клиенты и генераторы видят предупреждение.

```python
@router.get("/old/list", deprecated=True)
def old_list():
    ...
```

Пометка ничего не блокирует: запросы к такому маршруту по-прежнему работают. Это **предупреждение**, а не удаление.

Пример: описание API журналов целиком.

```python example
from fastapi import APIRouter, FastAPI
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field


def unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}_{route.name}"


app = FastAPI(
    title="Library",
    summary="Каталог журналов",
    version="1.2.0",
    openapi_tags=[{"name": "magazines", "description": "Журналы и выпуски"}],
    generate_unique_id_function=unique_id,
)
router = APIRouter(prefix="/magazines", tags=["magazines"])


class MagazineIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"title": "Nature", "issue": 12}]})

    title: str = Field(min_length=1, description="Название журнала", examples=["Nature"])
    issue: int = Field(gt=0, description="Номер выпуска")


@router.get("/{magazine_id}", summary="Один журнал", response_description="Найденный журнал")
def read_magazine(magazine_id: int):
    """Возвращает журнал по номеру.

    Если журнала нет, ответ 404.
    """
    return {"id": magazine_id, "title": "Nature", "issue": 12}


@router.get("/old/list", deprecated=True)
def old_list():
    return []


@router.post("", status_code=201)
def create_magazine(data: MagazineIn):
    return data


app.include_router(router)
###
GET /openapi.json
```

В ответе длинный JSON. Главное в нём:

- `info`: `title` равен `Library`, `summary` — `Каталог журналов`, `version` — `1.2.0`;
- у операций `operationId` равны `magazines_read_magazine`, `magazines_old_list`, `magazines_create_magazine`;
- у `GET /magazines/{magazine_id}` `summary` равен `Один журнал`, `description` — текст из строки документации, а у ответа `200` `description` равен `Найденный журнал`;
- у `GET /magazines/old/list` стоит `"deprecated": true`;
- в `components.schemas.MagazineIn`: у полей `description`, у `title` ещё `examples`, у самой модели `examples` с готовым JSON.

### Версии API

**Версия API** — набор маршрутов и форматов данных, которые обещаны клиентам. Новую версию выпускают тогда, когда без неё пришлось бы сломать старых клиентов.

Что **ломает** клиентов (нужна новая версия):

- убрать или переименовать поле, маршрут, параметр;
- изменить тип или смысл поля (цена была в рублях, стала в копейках: имя то же, значение другое);
- сделать обязательным то, что было необязательным;
- изменить код ответа или формат ошибки.

Что **не ломает** (версию можно не менять):

- добавить новое поле в ответ;
- добавить новый маршрут;
- добавить необязательный параметр запроса со значением по умолчанию.

Оговорка: клиент, который запрещает неизвестные поля в ответе, сломается и от нового поля. Поэтому в договорах с клиентами обычно прямо записывают: новые поля могут появляться.

Способы указать версию клиентом: в пути (`/v1/books`), в заголовке или в параметре запроса. В курсе используется путь: он самый простой, виден в журналах и в адресной строке, и каждая версия получает собственный раздел в `/docs`.

### Версии через роутеры

Каждая версия — свой роутер в своём файле, а подключают их в `main.py` с разными префиксами:

```python
# routers/v2.py
router = APIRouter(prefix="/books", tags=["v2"])
```

```python
# main.py
from routers import v1, v2

app = FastAPI(generate_unique_id_function=unique_id)
app.include_router(v1.router, prefix="/v1")
app.include_router(v2.router, prefix="/v2")
```

- `APIRouter(prefix="/books", tags=["v2"])` — маршруты роутера начинаются с `/books`, а тег `v2` отделяет версию в документации.
- `app.include_router(router, prefix="/v2")` — подключает роутер и **добавляет** префикс: итоговый путь `/v2/books`. Префиксы складываются: `/v2` из `include_router` и `/books` из `APIRouter`.
- Версии обычно используют общую логику и хранилище, а различаются моделями ответа и входа. Каждая версия имеет свои модели (`BookV1`, `BookV2`).
- Старая версия остаётся рабочей, пока на ней есть клиенты. Её помечают `deprecated=True`, предупреждают клиентов заранее и убирают только после объявленного срока. Для предупреждения в ответах есть стандартные заголовки `Deprecation` (RFC 9745) и `Sunset` (RFC 8594, дата отключения).

Альтернатива — отдельное приложение на версию, подключённое через `app.mount("/v1", v1_app)`: у него своя документация и свои настройки. В этом курсе версии строят роутерами.

### Частые ошибки

- Переименование поля без новой версии. Неверно: заменить `price` на `price_cents` в существующем ответе. Верно: оставить `/v1` как есть и выпустить `/v2` с новым полем.
- Повтор идентификатора. Неверно: одинаковые `operationId` у двух версий. Верно: тег версии в идентификаторе (`v1_read_book`, `v2_read_book`).
- `route.tags[0]` у маршрута без тегов. Неверно: роутер без `tags`. Верно: `APIRouter(tags=["books"])`.
- Пример, который не проходит проверку. Неверно: `examples=[-5]` для поля `gt=0`. Верно: пример из допустимых значений.
- Двойной префикс. Неверно: `prefix="/v2/books"` в роутере и `prefix="/v2"` в `include_router`. Верно: префикс версии в одном месте.
- `deprecated=True` как удаление. Неверно: считать маршрут отключённым. Верно: он работает, пока вы его не уберёте.

### Шпаргалка

- `FastAPI(title=, summary=, description=, version=, openapi_tags=[{"name":, "description":}])`.
- Маршрут: `summary=`, строка документации, `response_description=`, `deprecated=True`.
- `Field(description=, examples=[...])`; модель: `ConfigDict(json_schema_extra={"examples": [{...}]})`.
- `generate_unique_id_function=func`, где `func(route: APIRoute) -> str`; `route.name`, `route.tags`.
- Ломает клиентов: удалить или переименовать, изменить тип или смысл, сделать обязательным, изменить код ответа. Не ломает: новое поле, новый маршрут, необязательный параметр.
- Версии: `APIRouter` на версию, `app.include_router(router, prefix="/v1")`, тег версии.
- Устаревание: `deprecated=True`, заголовки `Deprecation` и `Sunset`, срок поддержки.

## task fa-openapi-ids
```json
{
  "type": "openapi",
  "title": "Идентификаторы и устаревший маршрут",
  "xp": 15,
  "hints": [
    "Разделы «Метаданные приложения и теги», «Идентификаторы операций» и «Устаревшие маршруты: deprecated». Функцию идентификатора передают в FastAPI(...), а deprecated ставят в декораторе маршрута.",
    "В main.py: функция unique_id(route: APIRoute) возвращает f\"{route.tags[0]}_{route.name}\"; её передайте в generate_unique_id_function и добавьте openapi_tags с описанием тега books. В routers/books.py: у GET /books/all поставьте deprecated=True и summary, а у остальных маршрутов задайте summary.",
    "Шаблон: from fastapi.routing import APIRoute; FastAPI(title=\"Bookshop\", version=\"1.0.0\", openapi_tags=[{\"name\": \"books\", \"description\": \"...\"}], generate_unique_id_function=unique_id); @router.get(\"/all\", summary=\"…\", deprecated=True)."
  ],
  "readonly": ["schemas.py"],
  "check": {
    "compare": ["operationId", "tags", "summary"],
    "static": [
      { "rule": "uses", "name": "generate_unique_id_function", "file": "main.py", "message": "Передайте функцию идентификаторов в FastAPI(generate_unique_id_function=...)." },
      { "rule": "uses", "name": "openapi_tags", "file": "main.py", "message": "Опишите тег books в FastAPI(openapi_tags=[...])." },
      { "rule": "uses", "name": "deprecated", "file": "routers/books.py", "message": "Пометьте устаревший маршрут GET /books/all через deprecated=True." }
    ]
  },
  "wrong": {
    "default-ids": "идентификаторы операций остались стандартными, функция генерации не подключена",
    "no-deprecated": "устаревший маршрут GET /books/all не помечен как deprecated"
  }
}
```
У книжного магазина есть роутер `routers/books.py` с тегом `books`. Доработайте документацию.

Нужно:

- в `main.py` ввести функцию `unique_id(route: APIRoute)`, которая возвращает `"<первый тег>_<имя функции>"`, и подключить её через `generate_unique_id_function`; добавить `version="1.0.0"` и описание тега `books` в `openapi_tags` (текст любой);
- в `routers/books.py` задать `summary`: у `GET /books` — `Список книг`, у `GET /books/all` — `Список книг (устарел)`, у `GET /books/{book_id}` — `Одна книга`, у `POST /books` — `Добавить книгу`;
- пометить `GET /books/all` как `deprecated`: это старый адрес списка, новый клиенты используют `GET /books`.

Идентификаторы после правки: `books_list_books`, `books_list_all_books`, `books_read_book`, `books_create_book`. Идея проверки: проверка читает `/openapi.json` и сравнивает с эталоном `operationId`, теги и `summary`, а затем смотрит код: `generate_unique_id_function` и `openapi_tags` в `main.py`, `deprecated` в роутере.

```python starter path=schemas.py
from pydantic import BaseModel, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class Book(BookIn):
    id: int
```

```python starter path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python starter path=routers/books.py
from fastapi import APIRouter, HTTPException

from schemas import Book, BookIn

router = APIRouter(prefix="/books", tags=["books"])
BOOKS: dict[int, Book] = {1: Book(id=1, title="Dune", price=9.5)}


@router.get("")
def list_books() -> list[Book]:
    return list(BOOKS.values())


@router.get("/all")
def list_all_books() -> list[Book]:
    return list(BOOKS.values())


@router.get("/{book_id}")
def read_book(book_id: int) -> Book:
    book = BOOKS.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn) -> Book:
    book = Book(id=max(BOOKS) + 1, **data.model_dump())
    BOOKS[book.id] = book
    return book
```

```python solution path=schemas.py
from pydantic import BaseModel, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class Book(BookIn):
    id: int
```

```python solution path=main.py
from fastapi import FastAPI
from fastapi.routing import APIRoute

from routers.books import router


def unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}_{route.name}"


app = FastAPI(
    title="Bookshop",
    version="1.0.0",
    openapi_tags=[{"name": "books", "description": "Каталог книг"}],
    generate_unique_id_function=unique_id,
)
app.include_router(router)
```

```python solution path=routers/books.py
from fastapi import APIRouter, HTTPException

from schemas import Book, BookIn

router = APIRouter(prefix="/books", tags=["books"])
BOOKS: dict[int, Book] = {1: Book(id=1, title="Dune", price=9.5)}


@router.get("", summary="Список книг")
def list_books() -> list[Book]:
    return list(BOOKS.values())


@router.get("/all", summary="Список книг (устарел)", deprecated=True)
def list_all_books() -> list[Book]:
    return list(BOOKS.values())


@router.get("/{book_id}", summary="Одна книга")
def read_book(book_id: int) -> Book:
    book = BOOKS.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201, summary="Добавить книгу")
def create_book(data: BookIn) -> Book:
    book = Book(id=max(BOOKS) + 1, **data.model_dump())
    BOOKS[book.id] = book
    return book
```

```python wrong id=default-ids path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(
    title="Bookshop",
    version="1.0.0",
    openapi_tags=[{"name": "books", "description": "Каталог книг"}],
)
app.include_router(router)
```

```python wrong id=no-deprecated path=routers/books.py
from fastapi import APIRouter, HTTPException

from schemas import Book, BookIn

router = APIRouter(prefix="/books", tags=["books"])
BOOKS: dict[int, Book] = {1: Book(id=1, title="Dune", price=9.5)}


@router.get("", summary="Список книг")
def list_books() -> list[Book]:
    return list(BOOKS.values())


@router.get("/all", summary="Список книг (устарел)")
def list_all_books() -> list[Book]:
    return list(BOOKS.values())


@router.get("/{book_id}", summary="Одна книга")
def read_book(book_id: int) -> Book:
    book = BOOKS.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201, summary="Добавить книгу")
def create_book(data: BookIn) -> Book:
    book = Book(id=max(BOOKS) + 1, **data.model_dump())
    BOOKS[book.id] = book
    return book
```

## task fa-openapi-examples
```json
{
  "type": "openapi",
  "title": "Примеры и описания в моделях",
  "xp": 15,
  "hints": [
    "Раздел «Примеры в моделях»: пример всей модели задают в model_config через json_schema_extra, примеры и описание поля — в Field.",
    "В schemas.py у BookIn добавьте model_config = ConfigDict(json_schema_extra={\"examples\": [...]}) с готовым телом запроса, а у полей title и price — description и examples. Названия и обязательность полей не меняйте.",
    "Шаблон: class BookIn(BaseModel): model_config = ConfigDict(json_schema_extra={\"examples\": [{\"title\": \"Dune\", \"price\": 9.5}]}); title: str = Field(min_length=1, description=\"…\", examples=[\"Dune\"]); price: float = Field(gt=0, description=\"…\", examples=[9.5])."
  ],
  "readonly": ["main.py", "routers/books.py"],
  "check": {
    "compare": ["schemas"],
    "static": [
      { "rule": "uses", "name": "json_schema_extra", "file": "schemas.py", "message": "Добавьте пример всей модели: ConfigDict(json_schema_extra={\"examples\": [...]})." },
      { "rule": "uses", "name": "description", "file": "schemas.py", "message": "Опишите поля моделей через Field(description=...)." },
      { "rule": "uses", "name": "examples", "file": "schemas.py", "message": "Добавьте примеры значений полей через Field(examples=[...])." }
    ]
  },
  "wrong": {
    "no-model-example": "примеры значений полей добавлены, но примера всей модели нет",
    "field-dropped": "примеры добавлены, но из модели пропало поле price"
  }
}
```
Документация книжного магазина показывает пустую форму запроса: у полей нет описаний и примеров. Дополните модель `BookIn` в `schemas.py`.

Нужно:

- у модели `BookIn` пример всей модели через `json_schema_extra` с готовым телом запроса;
- у каждого из двух полей — `description` и `examples`;
- поля, их типы, ограничения (`min_length=1`, `gt=0`) и обязательность не меняются; пример должен им соответствовать (цена больше нуля).

Идея проверки: проверка сравнивает модели из `/openapi.json` с эталоном (имена, поля, обязательность), поэтому лишнее или пропавшее поле будет замечено, а затем ищет в `schemas.py` `json_schema_extra`, `description` и `examples`.

```python starter path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python starter path=routers/books.py
from fastapi import APIRouter

from schemas import Book, BookIn

router = APIRouter(prefix="/books", tags=["books"])
BOOKS: dict[int, Book] = {1: Book(id=1, title="Dune", price=9.5)}


@router.get("")
def list_books() -> list[Book]:
    return list(BOOKS.values())


@router.post("", status_code=201)
def create_book(data: BookIn) -> Book:
    book = Book(id=max(BOOKS) + 1, **data.model_dump())
    BOOKS[book.id] = book
    return book
```

```python starter path=schemas.py
from pydantic import BaseModel, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class Book(BookIn):
    id: int
```

```python solution path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python solution path=routers/books.py
from fastapi import APIRouter

from schemas import Book, BookIn

router = APIRouter(prefix="/books", tags=["books"])
BOOKS: dict[int, Book] = {1: Book(id=1, title="Dune", price=9.5)}


@router.get("")
def list_books() -> list[Book]:
    return list(BOOKS.values())


@router.post("", status_code=201)
def create_book(data: BookIn) -> Book:
    book = Book(id=max(BOOKS) + 1, **data.model_dump())
    BOOKS[book.id] = book
    return book
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class BookIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"title": "Dune", "price": 9.5}]})

    title: str = Field(min_length=1, description="Название книги", examples=["Dune"])
    price: float = Field(gt=0, description="Цена в рублях, больше нуля", examples=[9.5])


class Book(BookIn):
    id: int
```

```python wrong id=no-model-example path=schemas.py
from pydantic import BaseModel, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1, description="Название книги", examples=["Dune"])
    price: float = Field(gt=0, description="Цена в рублях, больше нуля", examples=[9.5])


class Book(BookIn):
    id: int
```

```python wrong id=field-dropped path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class BookIn(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"title": "Dune"}]})

    title: str = Field(min_length=1, description="Название книги", examples=["Dune"])


class Book(BookIn):
    id: int
    price: float = 0.0
```

## task fa-versioning
```json
{
  "type": "fastapi",
  "title": "Версия v2: цена в копейках",
  "xp": 20,
  "hints": [
    "Раздел «Версии через роутеры»: каждая версия — свой роутер, подключённый с префиксом версии. Роутер v1 уже написан, смотрите на него как на образец.",
    "Создайте routers/v2.py с APIRouter(prefix=\"/books\", tags=[\"v2\"]) и тремя маршрутами с моделями BookV2 и BookInV2, затем подключите его в main.py с префиксом /v2. Роутер v1 не трогайте.",
    "Шаблон: router = APIRouter(prefix=\"/books\", tags=[\"v2\"]); @router.get(\"/{book_id}\") def read_book(book_id: int) -> BookV2: ...; в main.py: app.include_router(v2.router, prefix=\"/v2\")."
  ],
  "readonly": ["store.py", "schemas.py"],
  "check": {
    "static": [
      { "rule": "router", "file": "routers/v2.py", "message": "В routers/v2.py нужен APIRouter с маршрутами, подключённый в main.py." }
    ]
  },
  "wrong": {
    "no-prefix": "роутер v2 подключён без префикса /v2: маршруты версии не появились по нужному адресу",
    "v1-changed": "версия v1 изменена: клиенты старой версии получили новый формат цены"
  }
}
```
Магазин хранит цену в копейках (`price_cents`), а версия `v1` отдаёт её в рублях (`price`, дробное число): так её ждут старые клиенты. Нужна версия `v2`, где цена отдаётся в копейках, а `v1` остаётся неизменной.

Что есть: `store.py` (хранилище `BOOKS` и функция `next_id()`), `schemas.py` (модели `BookV1`, `BookInV1`, `BookV2`, `BookInV2`), `routers/v1.py` (готов, подключён как `/v1`). Напишите `routers/v2.py` и подключите его в `main.py` с префиксом `/v2`:

- `GET /v2/books` — список книг по возрастанию номера, формат `{"id", "title", "price_cents"}`;
- `GET /v2/books/{book_id}` — книга или `404` с `{"detail": "Book not found"}`;
- `POST /v2/books` с телом `{"title": "...", "price_cents": целое > 0}` — создаёт книгу, отвечает `201` и новой книгой в формате `v2`.

Книга, созданная через одну версию, видна через другую: хранилище общее. Роутер `v1` менять нельзя. Идея проверки: запросы к обеим версиям уходят в эталон и в ваш проект, ответы сравниваются.

```python starter path=store.py
BOOKS = {
    1: {"id": 1, "title": "Dune", "price_cents": 950},
    2: {"id": 2, "title": "Emma", "price_cents": 700},
}


def next_id() -> int:
    return max(BOOKS) + 1
```

```python starter path=schemas.py
from pydantic import BaseModel, Field


class BookV1(BaseModel):
    id: int
    title: str
    price: float


class BookInV1(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class BookV2(BaseModel):
    id: int
    title: str
    price_cents: int


class BookInV2(BaseModel):
    title: str = Field(min_length=1)
    price_cents: int = Field(gt=0)
```

```python starter path=routers/v1.py
from fastapi import APIRouter, HTTPException

import store
from schemas import BookInV1, BookV1

router = APIRouter(prefix="/books", tags=["v1"])


def to_v1(book: dict) -> BookV1:
    return BookV1(id=book["id"], title=book["title"], price=book["price_cents"] / 100)


@router.get("")
def list_books() -> list[BookV1]:
    return [to_v1(book) for _, book in sorted(store.BOOKS.items())]


@router.get("/{book_id}")
def read_book(book_id: int) -> BookV1:
    book = store.BOOKS.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return to_v1(book)


@router.post("", status_code=201)
def create_book(data: BookInV1) -> BookV1:
    book = {"id": store.next_id(), "title": data.title, "price_cents": round(data.price * 100)}
    store.BOOKS[book["id"]] = book
    return to_v1(book)
```

```python starter path=routers/v2.py
# Здесь нужен роутер версии v2.
```

```python starter path=main.py
from fastapi import FastAPI

from routers import v1

app = FastAPI(title="Bookshop")
app.include_router(v1.router, prefix="/v1")
```

```python solution path=store.py
BOOKS = {
    1: {"id": 1, "title": "Dune", "price_cents": 950},
    2: {"id": 2, "title": "Emma", "price_cents": 700},
}


def next_id() -> int:
    return max(BOOKS) + 1
```

```python solution path=schemas.py
from pydantic import BaseModel, Field


class BookV1(BaseModel):
    id: int
    title: str
    price: float


class BookInV1(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class BookV2(BaseModel):
    id: int
    title: str
    price_cents: int


class BookInV2(BaseModel):
    title: str = Field(min_length=1)
    price_cents: int = Field(gt=0)
```

```python solution path=routers/v1.py
from fastapi import APIRouter, HTTPException

import store
from schemas import BookInV1, BookV1

router = APIRouter(prefix="/books", tags=["v1"])


def to_v1(book: dict) -> BookV1:
    return BookV1(id=book["id"], title=book["title"], price=book["price_cents"] / 100)


@router.get("")
def list_books() -> list[BookV1]:
    return [to_v1(book) for _, book in sorted(store.BOOKS.items())]


@router.get("/{book_id}")
def read_book(book_id: int) -> BookV1:
    book = store.BOOKS.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return to_v1(book)


@router.post("", status_code=201)
def create_book(data: BookInV1) -> BookV1:
    book = {"id": store.next_id(), "title": data.title, "price_cents": round(data.price * 100)}
    store.BOOKS[book["id"]] = book
    return to_v1(book)
```

```python solution path=routers/v2.py
from fastapi import APIRouter, HTTPException

import store
from schemas import BookInV2, BookV2

router = APIRouter(prefix="/books", tags=["v2"])


@router.get("")
def list_books() -> list[BookV2]:
    return [BookV2(**book) for _, book in sorted(store.BOOKS.items())]


@router.get("/{book_id}")
def read_book(book_id: int) -> BookV2:
    book = store.BOOKS.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return BookV2(**book)


@router.post("", status_code=201)
def create_book(data: BookInV2) -> BookV2:
    book = {"id": store.next_id(), "title": data.title, "price_cents": data.price_cents}
    store.BOOKS[book["id"]] = book
    return BookV2(**book)
```

```python solution path=main.py
from fastapi import FastAPI

from routers import v1, v2

app = FastAPI(title="Bookshop")
app.include_router(v1.router, prefix="/v1")
app.include_router(v2.router, prefix="/v2")
```

```python wrong id=no-prefix path=main.py
from fastapi import FastAPI

from routers import v1, v2

app = FastAPI(title="Bookshop")
app.include_router(v1.router, prefix="/v1")
app.include_router(v2.router)
```

```python wrong id=v1-changed path=routers/v1.py
from fastapi import APIRouter, HTTPException

import store
from schemas import BookInV1, BookV2

router = APIRouter(prefix="/books", tags=["v1"])


@router.get("")
def list_books() -> list[BookV2]:
    return [BookV2(**book) for _, book in sorted(store.BOOKS.items())]


@router.get("/{book_id}")
def read_book(book_id: int) -> BookV2:
    book = store.BOOKS.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return BookV2(**book)


@router.post("", status_code=201)
def create_book(data: BookInV1) -> BookV2:
    book = {"id": store.next_id(), "title": data.title, "price_cents": round(data.price * 100)}
    store.BOOKS[book["id"]] = book
    return BookV2(**book)
```

```http tests
GET /v1/books
###
GET /v1/books/1
###
GET /v2/books
###
GET /v2/books/1
###
GET /v2/books/9
###
POST /v2/books
Content-Type: application/json

{"title": "Solaris", "price_cents": 1100}
###
GET /v1/books/3
###
POST /v2/books
Content-Type: application/json

{"title": "Free", "price_cents": 0}
###
POST /v1/books
Content-Type: application/json

{"title": "Ubik", "price": 7.5}
###
GET /v2/books/4
```

## task fa-version-choice
```json
{
  "type": "choice",
  "title": "Какие изменения не ломают клиентов",
  "xp": 10,
  "hints": [
    "Раздел «Версии API»: списки того, что ломает клиентов и что не ломает.",
    "Старый клиент не знает о новом. Подумайте, что он перестанет находить или поймёт иначе.",
    "Не ломают три изменения: новое необязательное поле в ответе, новый маршрут и необязательный параметр со значением по умолчанию."
  ],
  "options": [
    "Добавить в ответ новое необязательное поле `rating`",
    "Переименовать поле `price` в `price_rub`",
    "Добавить новый маршрут `GET /books/{id}/reviews`",
    "Сделать параметр запроса `limit`, который раньше был необязательным, обязательным",
    "Добавить необязательный параметр запроса `sort` со значением по умолчанию",
    "Оставить поле `price`, но начать отдавать в нём копейки вместо рублей"
  ],
  "answer": [0, 2, 4],
  "explanation": "Старый клиент не знает о новом поле, маршруте и параметре: он их просто не использует, поэтому эти три изменения совместимы (при условии, что клиент не запрещает лишние поля в ответе). Переименование поля ломает клиента: он ищет старое имя и не находит. Обязательный `limit` ломает всех, кто его не передавал: они начнут получать `422`. Самое коварное изменение — смысл поля при том же имени: код клиента продолжает работать, но показывает цену в сто раз больше. Такие изменения выпускают новой версией: `/v2` с новым полем (например, `price_cents`), а `/v1` остаётся прежней."
}
```
API книжного магазина используют мобильные приложения, которые обновляются месяцами. Выберите все изменения, после которых новую версию API выпускать **не нужно**: старые клиенты продолжат работать.
