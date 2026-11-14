# Тесты: pytest и TestClient

Вы поправили обработчик, и всё вроде работает. Через неделю коллега меняет схему данных, а у вас ломается соседний маршрут, и узнаёте вы об этом от пользователей. Автоматические тесты нужны, чтобы узнавать о таких поломках сразу: тест отправляет запрос в приложение и сверяет ответ с тем, что вы ожидали. В этом уроке вы напишете такие тесты, найдёте ошибку по упавшему тесту, опишете API для документации и научитесь подменять зависимости.

### Зачем тестировать API

Тест фиксирует **контракт**: какой запрос какой ответ получает. Он проверяет три вещи:

- код ответа (`200`, `201`, `404`, `422`);
- тело ответа (JSON с нужными полями);
- ошибки: что будет, если записи нет или данные неверны.

Ошибки проверять важнее всего. «Счастливый путь» обычно работает сразу, а вот `404` вместо `null` с кодом `200` легко потерять при правке.

### TestClient: запросы без сервера

`TestClient` — клиент из FastAPI, который вызывает приложение напрямую, без сети и без запущенного `uvicorn`. Он устроен как библиотека `httpx`: методы `get`, `post`, `put`, `patch`, `delete`.

```python
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)
response = client.get("/путь")
response = client.post("/путь", json={"поле": "значение"})
```

- `from fastapi.testclient import TestClient` — подключает клиент.
- `from main import app` — берёт приложение из файла `main.py`.
- `TestClient(app)` — создаёт клиент для этого приложения.
- `client.get("/путь")` — отправляет запрос и возвращает ответ.
- `json={...}` — тело запроса: словарь Python станет JSON, заголовок `Content-Type` поставится сам.

У ответа три нужных свойства:

- `response.status_code` — код ответа, целое число;
- `response.json()` — тело, разобранное из JSON в словарь или список;
- `response.text` — тело как строка.

Приложение для примера. Журналы лежат в словаре, добавление отвечает `201`, а неверные данные отклоняет pydantic с кодом `422`:

```python example
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
MAGAZINES = {1: "Quantum"}


class MagazineIn(BaseModel):
    title: str = Field(min_length=1)


@app.get("/magazines/{magazine_id}")
def read_magazine(magazine_id: int):
    if magazine_id not in MAGAZINES:
        raise HTTPException(status_code=404, detail="Magazine not found")
    return {"id": magazine_id, "title": MAGAZINES[magazine_id]}


@app.post("/magazines", status_code=201)
def create_magazine(data: MagazineIn):
    new_id = max(MAGAZINES) + 1
    MAGAZINES[new_id] = data.title
    return {"id": new_id, "title": data.title}
###
GET /magazines/1
###
GET /magazines/9
###
POST /magazines
Content-Type: application/json

{"title": "Nature"}
###
POST /magazines
Content-Type: application/json

{"title": ""}
```

Здесь четыре запроса, и каждый превращается в проверку:

- `GET /magazines/1` даёт `200` и `{"id": 1, "title": "Quantum"}`;
- `GET /magazines/9` даёт `404` и `{"detail": "Magazine not found"}`;
- `POST` с названием даёт `201` и новую запись с номером `2`;
- `POST` с пустым названием даёт `422`: сработало `min_length=1`.

В тесте те же запросы пишутся кодом, а ожидаемые ответы — это `assert`.

### pytest: файлы, assert, запуск

**pytest** — стандартный инструмент для тестов на Python. Правила простые:

- файл с тестами называется `test_что-то.py` и лежит в папке `tests/`;
- тест — обычная функция, имя которой начинается с `test_`;
- внутри функции условия проверяются оператором `assert`.

```python
# tests/test_magazines.py
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_read_magazine():
    response = client.get("/magazines/1")
    assert response.status_code == 200
    assert response.json() == {"id": 1, "title": "Quantum"}


def test_missing_magazine():
    response = client.get("/magazines/9")
    assert response.status_code == 404
    assert response.json() == {"detail": "Magazine not found"}
```

- `assert условие` — если условие ложно, тест падает, и pytest показывает значения обеих сторон.
- Один тест — один сценарий. Несколько `assert` в тесте допустимы: тест падает на первом ложном.
- `==` для словарей сравнивает все ключи, поэтому лишнее поле в ответе тоже заметят.

На своём компьютере тесты запускают командой в терминале из папки проекта:

```text
$ pytest -q
..                                                          [100%]
2 passed in 0.21s
```

Каждая точка — пройденный тест, `F` — упавший. Время у вас будет другим. Сервер для этого запускать не нужно: приложение запускается и разрабатывается командой `fastapi dev main.py`, а тесты работают отдельно.

Как это устроено в студии: тесты выполняются внутри приложения, в том же Python, что и сервер, без отдельных процессов. Команды `pytest -q` и `fastapi dev` здесь запускать не нужно: кнопка проверки сама запускает все файлы из `tests/`. Есть и отличие, о котором стоит знать: пауза `asyncio.sleep(...)` в тестах проходит мгновенно, потому что часы виртуальные. На обычном компьютере тест с такой паузой будет ждать по-настоящему.

### Фикстуры и conftest.py

Если в каждом тесте создавать клиент и данные заново, код повторяется. **Фикстура** — функция, которую pytest вызывает сам и передаёт результат в тест. Она помечается декоратором `@pytest.fixture`, а тест просто называет её в параметрах.

```python
# tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
```

```python
# tests/test_magazines.py
def test_read_magazine(client):
    assert client.get("/magazines/1").status_code == 200
```

- `tests/conftest.py` — особое имя: pytest читает этот файл сам, и фикстуры из него видны во всех тестах папки. Импортировать их не нужно.
- `@pytest.fixture` — объявляет фикстуру; имя функции (`client`) и есть имя фикстуры.
- `def test_read_magazine(client)` — параметр с тем же именем получает значение фикстуры. Если имя написано иначе, pytest сообщит, что фикстура не найдена.
- `yield test_client` — выдаёт значение тесту. Всё, что написано после `yield`, выполнится после теста: так фикстуры «убирают за собой».
- `with TestClient(app) as ...` — вход в блок `with` запускает **lifespan** приложения (код запуска и остановки: открыть соединение, заполнить данные). Без `with` lifespan не запускается — состояние, созданное при старте, будет пустым. Для приложений без lifespan достаточно и `TestClient(app)`.

Фикстура вызывается заново для каждого теста, поэтому тесты не влияют друг на друга.

### parametrize: один тест на несколько входов

Когда сценарий один, а входных данных много, их передают в `@pytest.mark.parametrize`.

```python
import pytest


@pytest.mark.parametrize("payload", [{"title": ""}, {"title": 5}, {}])
def test_create_invalid(client, payload):
    assert client.post("/magazines", json=payload).status_code == 422
```

- первый аргумент — имя параметра теста, строкой (`"payload"`);
- второй — список значений; тест запустится по одному разу на каждое;
- параметр с этим именем появляется в аргументах функции рядом с фикстурами.

В отчёте это три отдельных теста, и упавший виден по значению. Для нескольких параметров имена перечисляют через запятую в одной строке: `"path, code"` и список пар `[("/a", 200), ("/b", 404)]`.

### dependency_overrides: подмена зависимости

Приложение часто получает от `Depends(...)` то, что в тесте нельзя взять настоящим: время, случайное число, внешний сервис, базу. Результат такой зависимости непредсказуем, и проверка `assert` превращается в лотерею. Решение — подменить функцию-зависимость на свою, заранее известную.

Обработчик ниже считает цену с налогом, а ставку налога берёт из зависимости (в примере ставка постоянная, чтобы результат не менялся):

```python example
from typing import Annotated

from fastapi import Depends, FastAPI

app = FastAPI()
PRICES = {"atlas": 40.0}


def get_tax() -> float:
    return 0.2


TaxDep = Annotated[float, Depends(get_tax)]


@app.get("/gross/{name}")
def gross_price(name: str, tax: TaxDep):
    return {"name": name, "gross": round(PRICES[name] * (1 + tax), 2)}
###
GET /gross/atlas
```

Зависимость `get_tax` вернула `0.2`, цена с налогом — `48.0`. В тесте её подменяют так:

```python
from deps import get_tax
from main import app

app.dependency_overrides[get_tax] = lambda: 0.25
...
app.dependency_overrides.clear()
```

- `app.dependency_overrides` — словарь приложения: ключ — **оригинальная** функция-зависимость, значение — функция-замена без параметров.
- `lambda: 0.25` — короткая безымянная функция, которая просто возвращает `0.25`. Можно написать и обычную `def`.
- `.clear()` — убирает все подмены. Подмена живёт в самом приложении и останется для следующих тестов, поэтому её обязательно снимают после теста.
- Ключ — именно функция (`get_tax`, без скобок), импортированная из того модуля, где она объявлена.
- Значение подмены выбирайте так, чтобы ошибка в формуле меняла результат. Ставка `0` скрывает забытую скидку: цена с ней и без неё одинакова. Ставка `0.5` скрывает путаницу «умножить вместо вычесть»: `8 * 0.5` и `8 * (1 - 0.5)` дают одно и то же. Подходит, например, `0.25`.

Подмену удобно прятать в фикстуру: до `yield` ставят, после — снимают.

```python
@pytest.fixture
def fixed_tax():
    app.dependency_overrides[get_tax] = lambda: 0.25
    yield
    app.dependency_overrides.clear()
```

### Что проверять

Для каждого маршрута достаточно небольшого набора:

1. Успешный запрос: код и тело целиком.
2. Запись не найдена: код `404` и текст `detail`. Проверяйте оба: `404` также приходит, когда маршрута нет совсем, и тест «на 404» тогда проходит по ложной причине.
3. Создание: код `201`, поля и номер новой записи.
4. Неверные данные: код `422` (несколько вариантов через `parametrize`).

Хороший тест не просто проходит, а падает, когда в приложении ошибка. Поэтому задание ниже проверяет ваши тесты на приложениях с намеренными ошибками.

### Напоминание: роутеры и статус ответа

Проект из нескольких файлов собирают из **роутеров**. Это нужно для заданий дальше.

```python
# routers/books.py
from fastapi import APIRouter

router = APIRouter(prefix="/books", tags=["books"])


@router.post("", status_code=201)
def create_book(...):
    ...
```

```python
# main.py
from fastapi import FastAPI
from routers.books import router

app = FastAPI()
app.include_router(router)
```

- `APIRouter(prefix="/books")` — группа маршрутов с общим началом пути; `@router.post("")` с пустым путём отвечает на `POST /books`.
- `status_code=201` в декоратор — код успешного ответа вместо `200`.
- `app.include_router(router)` — без этой строки маршруты роутера в приложении не появятся, и все запросы к ним получат `404`.
- Тип результата можно записать после стрелки: `def read(...) -> Book:` — FastAPI проверит и отфильтрует ответ по модели `Book`.

### Документация: tags, summary, operation_id, responses

FastAPI строит описание API по стандарту OpenAPI и отдаёт его на `/openapi.json`; по нему рисуется страница `/docs`. Описание можно уточнить в декораторе маршрута:

```python
@router.get(
    "/{book_id}",
    summary="Одна книга",
    operation_id="read_book",
    responses={404: {"description": "Книги нет"}},
)
```

- `tags=["группа"]` (в `APIRouter(...)` или в декораторе) — раздел на странице `/docs`; клиентские генераторы тоже группируют по тегам.
- `summary="..."` — короткий заголовок операции. Без него FastAPI берёт имя функции.
- `operation_id="..."` — уникальный идентификатор операции; по нему генераторы клиентов называют методы. Пишут его в `snake_case`.
- `responses={404: {"description": "..."}}` — ответы, которые код возвращает помимо основного. FastAPI сам знает про успешный ответ и про `422`, а вот `404` из `raise HTTPException` не видит, поэтому его описывают вручную. Ключ — код, значение — словарь с `description`.

### async def и блокирующие вызовы

Обработчик `async def` выполняется в одном потоке со всем сервером. Если внутри вызвать долгую блокирующую функцию (`time.sleep`, `requests.get`), остановится весь сервер, а не один запрос. Правила:

- в `async def` ждут через `await`: `await asyncio.sleep(2)`, а для сети используют асинхронный клиент `httpx.AsyncClient`;
- либо делают обработчик обычным `def`: FastAPI запускает такие функции в отдельном потоке (в студии они выполняются на месте, но правило от этого не меняется).

```python
import asyncio


async def build():
    await asyncio.sleep(2)
```

- `import asyncio` — модуль асинхронности из стандартной библиотеки;
- `await` — «подождать и отдать управление»; ставится перед вызовом корутины, как `asyncio.sleep`. Забытый `await` не даёт паузы и порождает предупреждение «coroutine was never awaited».

Эту ошибку ловит проверка кода: она разбирает файл и ищет вызовы вроде `time.sleep` или `requests.get` внутри `async def`, не запуская его.

### Частые ошибки

- Фикстура не найдена. Неверно: `def test_x(clinet):`. Верно: `def test_x(client):`. Имя параметра должно совпадать с именем фикстуры из `conftest.py`.
- Тест на 404 «проходит» без нужного маршрута. Неверно: `assert client.get("/books/9").status_code == 404` как единственная проверка. Верно: добавьте проверку `detail` и тест на существующую запись, который падает, если маршрута нет.
- Подмена осталась после теста. Неверно: поставить `app.dependency_overrides[get_tax] = ...` и не снять. Верно: `clear()` после теста или фикстура с `yield`.
- Ключ подмены — не та функция. Неверно: `app.dependency_overrides[get_tax()] = ...` (со скобками) или копия функции. Верно: ключ — сама функция `get_tax`, импортированная из места, откуда её берёт приложение.
- Блокирующий вызов в `async def`. Неверно: `time.sleep(2)`. Верно: `await asyncio.sleep(2)` или обычный `def`.

### Шпаргалка

- `TestClient(app)`, `with TestClient(app) as c:` — клиент; `with` запускает lifespan.
- `c.get(url)`, `c.post(url, json={...})` → `.status_code`, `.json()`.
- Файлы `tests/test_*.py`, функции `test_*`, проверка `assert`.
- `@pytest.fixture` + `yield` в `tests/conftest.py`; имя параметра теста = имя фикстуры.
- `@pytest.mark.parametrize("имя", [значения])`.
- `app.dependency_overrides[функция] = lambda: значение`; после теста `.clear()`.
- Проверяйте: успех, `404` с `detail`, `201`, `422`.
- Документация: `tags`, `summary`, `operation_id`, `responses={код: {"description": "..."}}`; `status_code=201`.
- В `async def` — `await asyncio.sleep`, не `time.sleep`.
- Локально: `pytest -q`, `fastapi dev main.py`.

## task fa-pytest-books
```json
{
  "type": "pytest",
  "title": "Тесты для книжного магазина",
  "xp": 20,
  "hints": [
    "Загляните в разделы «Фикстуры и conftest.py» и «Что проверять». Фикстура client уже есть в tests/conftest.py: просто назовите её в параметрах теста.",
    "Нужны тесты на чтение книги (код и тело), на 404 с текстом detail, на создание (201 и номер) и параметризованный тест на 422 с несколькими неверными телами.",
    "Шаблон: def test_имя(client): response = client.get(\"/books/1\"); assert response.status_code == ...; assert response.json() == ...; для 422 добавьте @pytest.mark.parametrize(\"payload\", [...])."
  ],
  "readonly": ["main.py", "schemas.py", "deps.py", "routers/books.py", "tests/conftest.py"],
  "check": { "minTests": 4 },
  "mutants": {
    "no-404": "для несуществующей книги вместо ответа 404 приходит 200 с null",
    "create-200": "создание книги отвечает 200 вместо 201",
    "no-validation": "приложение принимает пустое название и отрицательную цену вместо ответа 422"
  },
  "wrong": {
    "only-reads": "четыре теста проверяют только чтение существующей книги и не замечают поломок в ошибках и создании",
    "no-422": "тесты не проверяют неверные данные: ошибка валидации останется незамеченной"
  }
}
```
Приложение книжного магазина готово, ваша задача — тесты. Все файлы, кроме папки `tests/`, закрыты для правки: вы пишете `tests/test_books.py`.

Приложение работает так:

- `GET /books` — список книг;
- `GET /books/{book_id}` — книга `{"id", "title", "price"}`; если её нет, `404` с `{"detail": "Book not found"}`;
- `POST /books` с телом `{"title": "...", "price": число}` — создаёт книгу и отвечает `201`; название не может быть пустым, цена должна быть больше нуля, иначе `422`.

Фикстура `client` из `tests/conftest.py` даёт клиент, у которого в магазине одна книга: `{"id": 1, "title": "Dune", "price": 9.5}`. Подмена хранилища в ней сделана заранее, трогать её не нужно (о подмене зависимостей вы прочитаете в разделе `dependency_overrides`).

Идея проверки: ваши тесты сначала запускаются на правильном приложении и все должны пройти (не меньше четырёх штук). Затем они запускаются на копиях приложения с намеренной ошибкой, и на каждой копии хотя бы один тест должен упасть. Тест, который не падает при поломке, ничего не проверяет.

```python starter path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python starter path=schemas.py
from pydantic import BaseModel, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class Book(BookIn):
    id: int
```

```python starter path=deps.py
from typing import Annotated

from fastapi import Depends

from schemas import Book, BookIn


class BookStore:
    def __init__(self) -> None:
        self.books: dict[int, Book] = {}

    def add(self, data: BookIn) -> Book:
        book = Book(id=len(self.books) + 1, **data.model_dump())
        self.books[book.id] = book
        return book


_store = BookStore()


def get_store() -> BookStore:
    return _store


StoreDep = Annotated[BookStore, Depends(get_store)]
```

```python starter path=routers/books.py
from fastapi import APIRouter, HTTPException

from deps import StoreDep
from schemas import Book, BookIn

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(store: StoreDep) -> list[Book]:
    return list(store.books.values())


@router.get("/{book_id}")
def read_book(book_id: int, store: StoreDep) -> Book:
    book = store.books.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn, store: StoreDep) -> Book:
    return store.add(data)
```

```python starter path=tests/conftest.py
import pytest
from fastapi.testclient import TestClient

from deps import BookStore, get_store
from main import app
from schemas import BookIn


@pytest.fixture
def client():
    store = BookStore()
    store.add(BookIn(title="Dune", price=9.5))
    app.dependency_overrides[get_store] = lambda: store
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
```

```python starter path=tests/test_books.py
def test_read_book(client):
    response = client.get("/books/1")
    assert response.status_code == 200
```

```python solution path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python solution path=schemas.py
from pydantic import BaseModel, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class Book(BookIn):
    id: int
```

```python solution path=deps.py
from typing import Annotated

from fastapi import Depends

from schemas import Book, BookIn


class BookStore:
    def __init__(self) -> None:
        self.books: dict[int, Book] = {}

    def add(self, data: BookIn) -> Book:
        book = Book(id=len(self.books) + 1, **data.model_dump())
        self.books[book.id] = book
        return book


_store = BookStore()


def get_store() -> BookStore:
    return _store


StoreDep = Annotated[BookStore, Depends(get_store)]
```

```python solution path=routers/books.py
from fastapi import APIRouter, HTTPException

from deps import StoreDep
from schemas import Book, BookIn

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(store: StoreDep) -> list[Book]:
    return list(store.books.values())


@router.get("/{book_id}")
def read_book(book_id: int, store: StoreDep) -> Book:
    book = store.books.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn, store: StoreDep) -> Book:
    return store.add(data)
```

```python solution path=tests/conftest.py
import pytest
from fastapi.testclient import TestClient

from deps import BookStore, get_store
from main import app
from schemas import BookIn


@pytest.fixture
def client():
    store = BookStore()
    store.add(BookIn(title="Dune", price=9.5))
    app.dependency_overrides[get_store] = lambda: store
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
```

```python solution path=tests/test_books.py
import pytest


def test_read_book(client):
    response = client.get("/books/1")
    assert response.status_code == 200
    assert response.json() == {"id": 1, "title": "Dune", "price": 9.5}


def test_list_books(client):
    response = client.get("/books")
    assert response.status_code == 200
    assert [book["title"] for book in response.json()] == ["Dune"]


def test_missing_book(client):
    response = client.get("/books/99")
    assert response.status_code == 404
    assert response.json() == {"detail": "Book not found"}


def test_create_book(client):
    response = client.post("/books", json={"title": "Emma", "price": 7})
    assert response.status_code == 201
    assert response.json() == {"id": 2, "title": "Emma", "price": 7.0}


@pytest.mark.parametrize(
    "payload",
    [{"title": "", "price": 5}, {"title": "Emma", "price": -1}, {"title": "Emma"}],
)
def test_create_invalid(client, payload):
    assert client.post("/books", json=payload).status_code == 422
```

```python wrong id=only-reads path=tests/test_books.py
def test_read_book(client):
    response = client.get("/books/1")
    assert response.status_code == 200


def test_read_title(client):
    assert client.get("/books/1").json()["title"] == "Dune"


def test_read_price(client):
    assert client.get("/books/1").json()["price"] == 9.5


def test_list_books(client):
    assert len(client.get("/books").json()) == 1
```

```python wrong id=no-422 path=tests/test_books.py
def test_read_book(client):
    response = client.get("/books/1")
    assert response.status_code == 200
    assert response.json() == {"id": 1, "title": "Dune", "price": 9.5}


def test_list_books(client):
    assert len(client.get("/books").json()) == 1


def test_missing_book(client):
    response = client.get("/books/99")
    assert response.status_code == 404
    assert response.json() == {"detail": "Book not found"}


def test_create_book(client):
    response = client.post("/books", json={"title": "Emma", "price": 7})
    assert response.status_code == 201
    assert response.json()["id"] == 2
```

```python mutant id=no-404 path=routers/books.py
from fastapi import APIRouter

from deps import StoreDep
from schemas import Book, BookIn

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(store: StoreDep) -> list[Book]:
    return list(store.books.values())


@router.get("/{book_id}")
def read_book(book_id: int, store: StoreDep) -> Book | None:
    return store.books.get(book_id)


@router.post("", status_code=201)
def create_book(data: BookIn, store: StoreDep) -> Book:
    return store.add(data)
```

```python mutant id=create-200 path=routers/books.py
from fastapi import APIRouter, HTTPException

from deps import StoreDep
from schemas import Book, BookIn

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(store: StoreDep) -> list[Book]:
    return list(store.books.values())


@router.get("/{book_id}")
def read_book(book_id: int, store: StoreDep) -> Book:
    book = store.books.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("")
def create_book(data: BookIn, store: StoreDep) -> Book:
    return store.add(data)
```

```python mutant id=no-validation path=schemas.py
from pydantic import BaseModel


class BookIn(BaseModel):
    title: str
    price: float


class Book(BookIn):
    id: int
```

## task fa-fix-authors
```json
{
  "type": "fix-bug",
  "title": "Авторы не находятся",
  "xp": 15,
  "hints": [
    "Запустите тесты из tests/test_authors.py и прочитайте сообщения: «assert 404 == 200» значит, что маршрута нет совсем. Вспомните раздел «Напоминание: роутеры и статус ответа».",
    "Первая ошибка в main.py: роутер авторов создан, но не подключён. Вторая — в routers/authors.py: создание отвечает кодом по умолчанию, а нужен 201.",
    "Шаблон: в main.py добавьте from routers.authors import router и app.include_router(router); в декоратор создания — @router.post(\"\", status_code=…)."
  ],
  "readonly": ["schemas.py", "tests/test_authors.py"],
  "wrong": {
    "only-router": "роутер подключён, но создание автора по-прежнему отвечает 200 вместо 201",
    "only-status": "код создания исправлен, но роутер не подключён, и все маршруты авторов отвечают 404"
  }
}
```
В проекте книжного магазина есть раздел авторов: `GET /authors`, `GET /authors/{author_id}` и `POST /authors`. Тесты в `tests/test_authors.py` падают. Запустите их, прочитайте сообщения об ошибках и исправьте приложение. Сами тесты менять нельзя: они описывают правильное поведение.

Правильное поведение: список авторов содержит одного автора, несуществующий автор даёт `404` с `{"detail": "Author not found"}`, создание автора отвечает `201`. Ошибок две, и находятся они в разных файлах.

Обратите внимание на тест про `404`: до исправления он тоже падает, хотя ответ всё равно `404`. Он проверяет и текст `detail`, а «пустой» `404` от несуществующего маршрута говорит другое.

```python starter path=main.py
from fastapi import FastAPI

app = FastAPI(title="Bookshop")
```

```python starter path=schemas.py
from pydantic import BaseModel, Field


class AuthorIn(BaseModel):
    name: str = Field(min_length=1)


class Author(AuthorIn):
    id: int
```

```python starter path=routers/authors.py
from fastapi import APIRouter, HTTPException

from schemas import Author, AuthorIn

router = APIRouter(prefix="/authors", tags=["authors"])
AUTHORS: dict[int, Author] = {1: Author(id=1, name="Ursula Le Guin")}


@router.get("")
def list_authors() -> list[Author]:
    return list(AUTHORS.values())


@router.get("/{author_id}")
def read_author(author_id: int) -> Author:
    author = AUTHORS.get(author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author


@router.post("")
def create_author(data: AuthorIn) -> Author:
    author = Author(id=max(AUTHORS) + 1, **data.model_dump())
    AUTHORS[author.id] = author
    return author
```

```python starter path=tests/test_authors.py
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_list_authors():
    response = client.get("/authors")
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_create_author():
    response = client.post("/authors", json={"name": "Stanislaw Lem"})
    assert response.status_code == 201
    assert response.json()["name"] == "Stanislaw Lem"


def test_missing_author():
    response = client.get("/authors/9")
    assert response.status_code == 404
    assert response.json() == {"detail": "Author not found"}
```

```python solution path=main.py
from fastapi import FastAPI

from routers.authors import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python solution path=schemas.py
from pydantic import BaseModel, Field


class AuthorIn(BaseModel):
    name: str = Field(min_length=1)


class Author(AuthorIn):
    id: int
```

```python solution path=routers/authors.py
from fastapi import APIRouter, HTTPException

from schemas import Author, AuthorIn

router = APIRouter(prefix="/authors", tags=["authors"])
AUTHORS: dict[int, Author] = {1: Author(id=1, name="Ursula Le Guin")}


@router.get("")
def list_authors() -> list[Author]:
    return list(AUTHORS.values())


@router.get("/{author_id}")
def read_author(author_id: int) -> Author:
    author = AUTHORS.get(author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author


@router.post("", status_code=201)
def create_author(data: AuthorIn) -> Author:
    author = Author(id=max(AUTHORS) + 1, **data.model_dump())
    AUTHORS[author.id] = author
    return author
```

```python solution path=tests/test_authors.py
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_list_authors():
    response = client.get("/authors")
    assert response.status_code == 200
    assert len(response.json()) == 1


def test_create_author():
    response = client.post("/authors", json={"name": "Stanislaw Lem"})
    assert response.status_code == 201
    assert response.json()["name"] == "Stanislaw Lem"


def test_missing_author():
    response = client.get("/authors/9")
    assert response.status_code == 404
    assert response.json() == {"detail": "Author not found"}
```

```python wrong id=only-router path=routers/authors.py
from fastapi import APIRouter, HTTPException

from schemas import Author, AuthorIn

router = APIRouter(prefix="/authors", tags=["authors"])
AUTHORS: dict[int, Author] = {1: Author(id=1, name="Ursula Le Guin")}


@router.get("")
def list_authors() -> list[Author]:
    return list(AUTHORS.values())


@router.get("/{author_id}")
def read_author(author_id: int) -> Author:
    author = AUTHORS.get(author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author


@router.post("")
def create_author(data: AuthorIn) -> Author:
    author = Author(id=max(AUTHORS) + 1, **data.model_dump())
    AUTHORS[author.id] = author
    return author
```

```python wrong id=only-status path=main.py
from fastapi import FastAPI

app = FastAPI(title="Bookshop")
```

```http tests
GET /authors
###
GET /authors/1
###
GET /authors/9
###
POST /authors
Content-Type: application/json

{"name": "Stanislaw Lem"}
###
GET /authors
###
POST /authors
Content-Type: application/json

{"name": ""}
```

## task fa-openapi-books
```json
{
  "type": "openapi",
  "title": "Документация API магазина",
  "xp": 15,
  "hints": [
    "Раздел «Документация: tags, summary, operation_id, responses»: все четыре параметра пишутся в декораторе маршрута или в APIRouter.",
    "Тег books ставится один раз в APIRouter(...). Для каждого маршрута нужны summary и operation_id, у read_book ещё responses с кодом 404, у create_book — status_code=201.",
    "Шаблон: @router.get(\"/{book_id}\", summary=\"…\", operation_id=\"…\", responses={404: {\"description\": \"…\"}}); @router.post(\"\", status_code=…, summary=\"…\", operation_id=\"…\")."
  ],
  "readonly": ["main.py", "schemas.py", "deps.py"],
  "check": { "compare": ["operationId", "tags", "summary", "responses"] },
  "wrong": {
    "no-404-doc": "ответ 404 не описан в документации",
    "no-tags": "у маршрутов нет тега books"
  }
}
```
Приложение книжного магазина работает, но его документация на `/openapi.json` пустая: нет тегов, заголовков и идентификаторов, не описан ответ `404`. Дополните `routers/books.py`, чтобы документация совпала с эталонной.

Нужно:

- тег `books` у всех трёх маршрутов;
- у `GET /books`: `summary` равен `Список книг`, `operation_id` равен `list_books`;
- у `GET /books/{book_id}`: `summary` равен `Одна книга`, `operation_id` равен `read_book`, описан ответ `404` с любым текстом `description`;
- у `POST /books`: `summary` равен `Добавить книгу`, `operation_id` равен `create_book`, успешный код `201`.

Идея проверки: проверка читает `/openapi.json` вашего приложения и сравнивает с эталонным: набор маршрутов, `operationId`, теги, `summary` и набор описанных кодов ответа (код `422` у маршрутов с телом и параметрами FastAPI добавляет сам).

```python starter path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python starter path=schemas.py
from pydantic import BaseModel, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class Book(BookIn):
    id: int
```

```python starter path=deps.py
from typing import Annotated

from fastapi import Depends

from schemas import Book, BookIn


class BookStore:
    def __init__(self) -> None:
        self.books: dict[int, Book] = {}

    def add(self, data: BookIn) -> Book:
        book = Book(id=len(self.books) + 1, **data.model_dump())
        self.books[book.id] = book
        return book


_store = BookStore()


def get_store() -> BookStore:
    return _store


StoreDep = Annotated[BookStore, Depends(get_store)]
```

```python starter path=routers/books.py
from fastapi import APIRouter, HTTPException

from deps import StoreDep
from schemas import Book, BookIn

router = APIRouter(prefix="/books")


@router.get("")
def list_books(store: StoreDep) -> list[Book]:
    return list(store.books.values())


@router.get("/{book_id}")
def read_book(book_id: int, store: StoreDep) -> Book:
    book = store.books.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("")
def create_book(data: BookIn, store: StoreDep) -> Book:
    return store.add(data)
```

```python solution path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python solution path=schemas.py
from pydantic import BaseModel, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class Book(BookIn):
    id: int
```

```python solution path=deps.py
from typing import Annotated

from fastapi import Depends

from schemas import Book, BookIn


class BookStore:
    def __init__(self) -> None:
        self.books: dict[int, Book] = {}

    def add(self, data: BookIn) -> Book:
        book = Book(id=len(self.books) + 1, **data.model_dump())
        self.books[book.id] = book
        return book


_store = BookStore()


def get_store() -> BookStore:
    return _store


StoreDep = Annotated[BookStore, Depends(get_store)]
```

```python solution path=routers/books.py
from fastapi import APIRouter, HTTPException

from deps import StoreDep
from schemas import Book, BookIn

router = APIRouter(prefix="/books", tags=["books"])


@router.get("", summary="Список книг", operation_id="list_books")
def list_books(store: StoreDep) -> list[Book]:
    return list(store.books.values())


@router.get(
    "/{book_id}",
    summary="Одна книга",
    operation_id="read_book",
    responses={404: {"description": "Книги с таким номером нет"}},
)
def read_book(book_id: int, store: StoreDep) -> Book:
    book = store.books.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201, summary="Добавить книгу", operation_id="create_book")
def create_book(data: BookIn, store: StoreDep) -> Book:
    return store.add(data)
```

```python wrong id=no-404-doc path=routers/books.py
from fastapi import APIRouter, HTTPException

from deps import StoreDep
from schemas import Book, BookIn

router = APIRouter(prefix="/books", tags=["books"])


@router.get("", summary="Список книг", operation_id="list_books")
def list_books(store: StoreDep) -> list[Book]:
    return list(store.books.values())


@router.get("/{book_id}", summary="Одна книга", operation_id="read_book")
def read_book(book_id: int, store: StoreDep) -> Book:
    book = store.books.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201, summary="Добавить книгу", operation_id="create_book")
def create_book(data: BookIn, store: StoreDep) -> Book:
    return store.add(data)
```

```python wrong id=no-tags path=routers/books.py
from fastapi import APIRouter, HTTPException

from deps import StoreDep
from schemas import Book, BookIn

router = APIRouter(prefix="/books")


@router.get("", summary="Список книг", operation_id="list_books")
def list_books(store: StoreDep) -> list[Book]:
    return list(store.books.values())


@router.get(
    "/{book_id}",
    summary="Одна книга",
    operation_id="read_book",
    responses={404: {"description": "Книги с таким номером нет"}},
)
def read_book(book_id: int, store: StoreDep) -> Book:
    book = store.books.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201, summary="Добавить книгу", operation_id="create_book")
def create_book(data: BookIn, store: StoreDep) -> Book:
    return store.add(data)
```

## task fa-pytest-overrides
```json
{
  "type": "pytest",
  "title": "Цена со скидкой: подмена зависимости",
  "xp": 20,
  "hints": [
    "Раздел «dependency_overrides: подмена зависимости»: скидка берётся из get_discount, которая зависит от дня недели, поэтому без подмены результат нестабилен.",
    "Подмените get_discount в app.dependency_overrides на lambda с известной скидкой, снимите подмену через clear() (удобно в фикстуре с yield) и проверьте цену обеих книг и ответ 404.",
    "Шаблон: @pytest.fixture def discount(): app.dependency_overrides[get_discount] = lambda: 0.25; yield; app.dependency_overrides.clear(); тесты принимают discount и сравнивают response.json() с точной ценой."
  ],
  "readonly": ["main.py", "deps.py"],
  "check": {
    "minTests": 3,
    "static": [
      { "rule": "uses", "name": "dependency_overrides", "file": "tests/test_price.py", "message": "Подмените зависимость get_discount через app.dependency_overrides в тестах: настоящая скидка зависит от дня недели." }
    ]
  },
  "mutants": {
    "ignores-discount": "цена возвращается без скидки",
    "multiplies": "вместо вычета скидки цена умножается на её ставку",
    "no-404": "для несуществующей книги приложение падает с ошибкой вместо ответа 404"
  },
  "wrong": {
    "no-override": "тесты не подменяют зависимость, а настоящая скидка зависит от дня недели",
    "status-only": "тесты подменяют зависимость, но проверяют только коды ответов и не замечают неверной цены"
  }
}
```
В приложении есть маршрут `GET /books/{book_id}/price`: он возвращает название и цену книги с учётом скидки. Ставку скидки отдаёт зависимость `get_discount` из `deps.py`: по пятницам это `0.2`, в остальные дни `0.0`. Значит, обычный запрос даёт разный результат в разные дни.

Ответ: `{"title": "...", "price": цена * (1 - скидка)}`, цена округлена до двух знаков. В магазине две книги: `1` — «Dune» за `8.0` и `2` — «Emma» за `12.0`. Несуществующая книга даёт `404` и `{"detail": "Book not found"}`.

Напишите `tests/test_price.py`, который подменяет зависимость `get_discount` через `app.dependency_overrides` и проверяет точные цены, а также `404`. Выберите ставку скидки так, чтобы неверная формула давала другую цену: не `0` и не `0.5`, подойдёт `0.25`. Не меньше трёх тестов; подмену нужно снимать после теста. Проверка сначала смотрит, что в коде есть `dependency_overrides`, потом запускает ваши тесты на правильном приложении и на копиях с ошибками.

```python starter path=main.py
from fastapi import FastAPI, HTTPException

from deps import DiscountDep

app = FastAPI()
BOOKS = {1: {"title": "Dune", "price": 8.0}, 2: {"title": "Emma", "price": 12.0}}


@app.get("/books/{book_id}/price")
def read_price(book_id: int, discount: DiscountDep):
    book = BOOKS.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return {"title": book["title"], "price": round(book["price"] * (1 - discount), 2)}
```

```python starter path=deps.py
import datetime
from typing import Annotated

from fastapi import Depends


def get_discount() -> float:
    # по пятницам скидка 20%
    return 0.2 if datetime.date.today().weekday() == 4 else 0.0


DiscountDep = Annotated[float, Depends(get_discount)]
```

```python starter path=tests/test_price.py
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_price():
    response = client.get("/books/1/price")
    assert response.status_code == 200
```

```python solution path=main.py
from fastapi import FastAPI, HTTPException

from deps import DiscountDep

app = FastAPI()
BOOKS = {1: {"title": "Dune", "price": 8.0}, 2: {"title": "Emma", "price": 12.0}}


@app.get("/books/{book_id}/price")
def read_price(book_id: int, discount: DiscountDep):
    book = BOOKS.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return {"title": book["title"], "price": round(book["price"] * (1 - discount), 2)}
```

```python solution path=deps.py
import datetime
from typing import Annotated

from fastapi import Depends


def get_discount() -> float:
    # по пятницам скидка 20%
    return 0.2 if datetime.date.today().weekday() == 4 else 0.0


DiscountDep = Annotated[float, Depends(get_discount)]
```

```python solution path=tests/test_price.py
import pytest
from fastapi.testclient import TestClient

from deps import get_discount
from main import app

client = TestClient(app)


@pytest.fixture
def discount():
    app.dependency_overrides[get_discount] = lambda: 0.25
    yield
    app.dependency_overrides.clear()


def test_price_dune(discount):
    response = client.get("/books/1/price")
    assert response.status_code == 200
    assert response.json() == {"title": "Dune", "price": 6.0}


def test_price_emma(discount):
    assert client.get("/books/2/price").json() == {"title": "Emma", "price": 9.0}


def test_missing_book(discount):
    response = client.get("/books/9/price")
    assert response.status_code == 404
    assert response.json() == {"detail": "Book not found"}
```

```python wrong id=no-override path=tests/test_price.py
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_price_dune():
    assert client.get("/books/1/price").status_code == 200


def test_price_emma():
    assert client.get("/books/2/price").status_code == 200


def test_missing_book():
    assert client.get("/books/9/price").status_code == 404
```

```python wrong id=status-only path=tests/test_price.py
import pytest
from fastapi.testclient import TestClient

from deps import get_discount
from main import app

client = TestClient(app)


@pytest.fixture
def discount():
    app.dependency_overrides[get_discount] = lambda: 0.25
    yield
    app.dependency_overrides.clear()


def test_price_dune(discount):
    assert client.get("/books/1/price").status_code == 200


def test_price_emma(discount):
    assert client.get("/books/2/price").status_code == 200


def test_missing_book(discount):
    assert client.get("/books/9/price").status_code == 404
```

```python mutant id=ignores-discount path=main.py
from fastapi import FastAPI, HTTPException

from deps import DiscountDep

app = FastAPI()
BOOKS = {1: {"title": "Dune", "price": 8.0}, 2: {"title": "Emma", "price": 12.0}}


@app.get("/books/{book_id}/price")
def read_price(book_id: int, discount: DiscountDep):
    book = BOOKS.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return {"title": book["title"], "price": book["price"]}
```

```python mutant id=multiplies path=main.py
from fastapi import FastAPI, HTTPException

from deps import DiscountDep

app = FastAPI()
BOOKS = {1: {"title": "Dune", "price": 8.0}, 2: {"title": "Emma", "price": 12.0}}


@app.get("/books/{book_id}/price")
def read_price(book_id: int, discount: DiscountDep):
    book = BOOKS.get(book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return {"title": book["title"], "price": round(book["price"] * discount, 2)}
```

```python mutant id=no-404 path=main.py
from fastapi import FastAPI

from deps import DiscountDep

app = FastAPI()
BOOKS = {1: {"title": "Dune", "price": 8.0}, 2: {"title": "Emma", "price": 12.0}}


@app.get("/books/{book_id}/price")
def read_price(book_id: int, discount: DiscountDep):
    book = BOOKS[book_id]
    return {"title": book["title"], "price": round(book["price"] * (1 - discount), 2)}
```

## task fa-static-report
```json
{
  "type": "static",
  "title": "Отчёт без остановки сервера",
  "xp": 10,
  "hints": [
    "Раздел «async def и блокирующие вызовы»: в async def нельзя вызывать time.sleep, requests.get и подобные функции.",
    "Замените ожидание: либо await asyncio.sleep(...) с import asyncio, либо сделайте обработчик обычным def.",
    "Шаблон: import asyncio; async def build_report(report_id: int): await asyncio.sleep(2); return {...}."
  ],
  "check": {
    "static": [
      { "rule": "no-blocking-in-async", "message": "В async def нельзя вызывать блокирующие функции вроде time.sleep или requests.get: они остановят весь сервер." }
    ],
    "code": [
      { "pattern": "sleep\\(", "message": "Пауза «сборки отчёта» должна остаться: замените способ ожидания, а не удаляйте его." }
    ]
  },
  "wrong": {
    "requests-call": "блокирующий requests.get внутри async def",
    "from-import": "блокирующий sleep, импортированный из time, внутри async def"
  }
}
```
Обработчик `GET /reports/{report_id}` «собирает отчёт» две секунды, но из-за блокирующего вызова внутри `async def` на это время замирает весь сервер: другие запросы ждут. Исправьте код так, чтобы обработчик не блокировал сервер, а пауза осталась. Проверка разбирает код, не запуская его.

```python starter
import time

from fastapi import FastAPI

app = FastAPI()


@app.get("/reports/{report_id}")
async def build_report(report_id: int):
    time.sleep(2)
    return {"id": report_id, "status": "ready"}
```

```python solution
import asyncio

from fastapi import FastAPI

app = FastAPI()


@app.get("/reports/{report_id}")
async def build_report(report_id: int):
    await asyncio.sleep(2)
    return {"id": report_id, "status": "ready"}
```

```python wrong id=requests-call
import requests
from fastapi import FastAPI

app = FastAPI()


@app.get("/reports/{report_id}")
async def build_report(report_id: int):
    requests.get("http://localhost:9000/slow")
    return {"id": report_id, "status": "ready"}
```

```python wrong id=from-import
from time import sleep

from fastapi import FastAPI

app = FastAPI()


@app.get("/reports/{report_id}")
async def build_report(report_id: int):
    sleep(2)
    return {"id": report_id, "status": "ready"}
```
