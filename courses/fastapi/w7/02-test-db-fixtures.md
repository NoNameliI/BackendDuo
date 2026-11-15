# Тестовая база и фикстуры

Магазин хранит книги в базе. Тесты из прошлого урока работали со словарём в памяти, а настоящий проект пишет в SQL-базу. Если тесты ходят в ту же базу, что и приложение, они портят данные и зависят друг от друга: один тест создал книгу, второй не ожидал её увидеть. Решение: у каждого теста своя свежая пустая база, которую приложение получает через зависимость. В этом уроке вы подмените сессию SQLAlchemy на тестовую, научитесь управлять временем жизни фикстур и заводить данные через фабрики.

### Что нужно от тестовой базы

Хорошая тестовая база обладает тремя свойствами:

- **Своя.** Тест никогда не трогает рабочую базу.
- **Чистая.** Каждый тест начинает с пустых таблиц, поэтому результат не зависит от порядка тестов.
- **Быстрая.** База в памяти создаётся за миллисекунды, и сотня тестов не замедляет разработку.

В студии рабочая база тоже SQLite в памяти, как в мире 4. В настоящем проекте рабочая — PostgreSQL, а тестовая часто остаётся SQLite в памяти. Это удобно, но у способа есть цена: SQLite и PostgreSQL отличаются в мелочах (типы, регистр строк, блокировки), и тест может пройти там, где настоящая база ответит иначе. Тесты, где важна именно PostgreSQL, запускают на настоящем PostgreSQL (в курсе PostgreSQL этой платформы он описан подробно).

### Проект, который удобно тестировать

Тестируемость закладывают в структуру. Сессия приходит в обработчик **через зависимость**, а не создаётся внутри: тогда тест подменяет одну функцию и получает свою базу.

```python
# database.py
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def make_engine():
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


engine = make_engine()
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def make_session_factory():
    """Свежая база в памяти с таблицами: для тестов."""
    test_engine = make_engine()
    Base.metadata.create_all(test_engine)
    return sessionmaker(test_engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

Обработчик берёт `session: SessionDep` и ничего не знает о том, откуда сессия. Все детали (`create_engine`, `StaticPool`, `sessionmaker`) уже знакомы вам из мира 4.

- `make_session_factory()` — функция для тестов: она создаёт **новую** базу в памяти, создаёт в ней таблицы (`create_all`) и возвращает фабрику сессий этой базы. Каждый вызов даёт отдельную базу.
- Модели (`Book`) должны быть импортированы к моменту вызова `create_all`, иначе таблицы не создадутся. В проекте они импортируются вместе с приложением (`from main import app`).

Одна оговорка про студию. В настоящих тестах можно писать `from sqlalchemy import create_engine` прямо в `conftest.py`. В заданиях студии тесты могут импортировать только `pytest`, `fastapi`, `httpx` и стандартные модули вроде `json`, а ещё модули вашего проекта: так тесты общаются с приложением только через его открытый интерфейс. Поэтому создание тестовой базы вынесено в `make_session_factory()` внутри проекта; тесты вызывают эту функцию. Приём рабочий и в обычных проектах: вспомогательные функции для тестов часто живут рядом с приложением.

Примечание про `lifespan`. Если в приложении есть `lifespan`, который создаёт таблицы рабочей базы, то `TestClient(app)` без `with` его **не запускает**, а `with TestClient(app)` запускает. Для тестов с подменой сессии `with` не нужен: рабочая база тестам не нужна совсем.

```python example
from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Magazine(Base):
    __tablename__ = "magazines"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100))


Base.metadata.create_all(engine)
with SessionLocal() as setup:
    setup.add(Magazine(title="Quantum"))
    setup.commit()


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
app = FastAPI()


@app.get("/magazines")
def list_magazines(session: SessionDep):
    return [{"id": m.id, "title": m.title} for m in session.scalars(select(Magazine).order_by(Magazine.id))]
###
GET /magazines
```

Приложение отдало `[{"id": 1, "title": "Quantum"}]` из базы в памяти. В тесте то же самое приложение получит другую сессию: подмену вы сейчас напишете.

### Подмена сессии через dependency_overrides

Подмену зависимости вы знаете из прошлого урока: `app.dependency_overrides[оригинал] = замена`. Для `yield`-зависимости замена — тоже функция с `yield`.

```python
# tests/conftest.py
import pytest
from fastapi.testclient import TestClient

from database import get_session, make_session_factory
from main import app


@pytest.fixture
def session_factory():
    return make_session_factory()


@pytest.fixture
def client(session_factory):
    def override_session():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    yield TestClient(app)
    app.dependency_overrides.clear()
```

- `session_factory` — фикстура: каждый тест получает фабрику сессий своей свежей базы.
- `client(session_factory)` — фикстура может **принимать другие фикстуры** через параметры. pytest сначала создаст `session_factory`, потом передаст её в `client`. Обе работают на один тест, значит, клиент и тест видят одну и ту же базу.
- `override_session` — функция-замена. Она устроена как оригинальный `get_session`, но сессию берёт у тестовой фабрики. Ключом в `dependency_overrides` остаётся **оригинал** `get_session`.
- `yield TestClient(app)` — тест получает клиента; всё после `yield` выполнится после теста.
- `app.dependency_overrides.clear()` — снимает подмену. Приложение `app` — один общий объект на все тесты, и без `clear()` подмена переживёт тест.

Тест теперь выглядит как обычно:

```python
def test_create_book(client):
    response = client.post("/books", json={"title": "Dune", "price": 9.5})
    assert response.status_code == 201
    assert response.json()["id"] == 1
```

Номер `1` здесь не случаен: база свежая, и первая запись всегда получает единицу. Если номер оказался другим, значит, тесты делят базу.

### Фикстуры: время жизни и порядок

Фикстура создаётся, когда она нужна тесту, и уничтожается после него. Этим управляет параметр `scope`:

```python
@pytest.fixture(scope="module")
def имя():
    ...
```

- `scope="function"` — значение по умолчанию: фикстура создаётся заново **для каждого теста**.
- `scope="module"` — один раз на файл с тестами: все тесты файла получают один и тот же объект.
- `scope="session"` — один раз на весь запуск pytest.

Чем шире область, тем меньше повторной работы, и тем больше риск, что тесты начнут влиять друг на друга. Тяжёлые неизменяемые вещи (чтение справочника, настройка логирования) выгодно держать в `module` или `session`. Всё, что тесты **меняют**, включая базу данных, должно жить на уровне `function`.

Порядок работы фикстуры с `yield`:

1. выполняется код до `yield`;
2. значение выдаётся тесту;
3. тест работает;
4. выполняется код после `yield`, даже если тест упал.

Когда фикстура зависит от другой, области учитывают: фикстура с широкой областью не может принимать фикстуру с узкой. `scope="module"` с параметром, у которого область `function`, pytest отклонит с ошибкой `ScopeMismatch`.

### Фабрики данных

Часто тесту нужно заранее положить в базу несколько книг. Копировать в каждый тест `session.add(...)` и `commit()` — много шума. **Фабрика** — фикстура, которая возвращает не данные, а функцию, создающую данные:

```python
# tests/conftest.py (продолжение)
from models import Book


@pytest.fixture
def make_book(session_factory):
    def make(title="Dune", price=9.5, in_stock=True):
        with session_factory() as session:
            book = Book(title=title, price=price, in_stock=in_stock)
            session.add(book)
            session.commit()
            return book.id

    return make
```

- `make_book` — фикстура; тест получает функцию `make` и вызывает её столько раз, сколько нужно.
- Параметры `make` имеют значения по умолчанию: тест называет только то, что для него важно (`make_book(price=3)`), остальное заполнено разумно. Так сразу видно, что именно проверяется.
- `with session_factory() as session` — работаем в той же базе, что и клиент, потому что фабрика берёт `session_factory` той же фикстуры.
- `session.add(...)` и `session.commit()` — вы знаете их из мира 4: поставить объект в очередь и записать. `expire_on_commit=False` позволяет прочитать `book.id` после записи.
- Фабрика возвращает номер записи, чтобы тест мог запросить её по адресу.

```python
def test_read_book(client, make_book):
    book_id = make_book("Emma", 7.0)
    response = client.get(f"/books/{book_id}")
    assert response.json()["title"] == "Emma"
```

Данные делят на два вида: те, что важны для теста (передаются явно), и «фон». Тест, где название и цена видны прямо в вызове, читается без перехода в `conftest.py`.

### parametrize для нескольких значений

Когда один сценарий проверяют на разных входах и результатах, имена параметров перечисляют в одной строке:

```python
@pytest.mark.parametrize(
    "max_price, titles",
    [(7.0, ["Emma"]), (9.5, ["Dune", "Emma"]), (5, [])],
)
def test_price_filter(client, make_book, max_price, titles):
    make_book("Dune", 9.5)
    make_book("Emma", 7.0)
    response = client.get("/books", params={"max_price": max_price})
    assert [book["title"] for book in response.json()] == titles
```

- `"max_price, titles"` — два имени в одной строке через запятую; второй аргумент — список пар в том же порядке.
- В аргументах теста параметры стоят рядом с фикстурами. Порядок не важен, важны имена.
- `params={...}` в `client.get` — параметры запроса: `?max_price=7.0`.
- Данные базы создаются заново для каждой пары значений, потому что `client` и `make_book` имеют область `function`.

Обратите внимание на значения `7.0` и `9.5`: они **равны** цене книги. Граничные значения ловят ошибку `<` вместо `<=`, а значение посередине (скажем, `8`) её пропустит.

### Изоляция тестов

Тест изолирован, если его результат не зависит от того, какие тесты шли до него и пойдут после. Признаки нарушения:

- тест проходит в одиночку и падает в составе файла;
- тесты проходят в одном порядке и падают в другом;
- номера записей «плавают» (ожидали `1`, получили `3`);
- ответ `409` там, где ждали `201`: запись с таким названием осталась от прошлого теста.

Причины почти всегда одни и те же: база с широкой областью, подмена, которую не сняли, глобальный словарь или счётчик в приложении. Лечение: база и подмена на уровне `function`, `clear()` после теста, начальные данные кладёт фабрика, а не общий модуль.

На своём компьютере упавший тест запускают отдельно: `pytest tests/test_books.py::test_create_book` — одна функция; `pytest -k duplicate` — все тесты, в имени которых есть слово; `pytest -x` — остановиться на первом упавшем. Если одиночный запуск проходит, а общий нет, ищите разделяемое состояние. В студии такие команды не нужны: кнопка проверки запускает все файлы из `tests/` сама.

### Частые ошибки

- База на уровне модуля. Неверно: `@pytest.fixture(scope="module") def session_factory(): ...` — тесты делят данные, номера плавают, дубликаты дают `409`. Верно: область по умолчанию (`function`).
- Подмена не снята. Неверно: после `yield TestClient(app)` ничего нет. Верно: `app.dependency_overrides.clear()` после `yield`, иначе подмена достанется следующему файлу тестов.
- Подмена не того ключа. Неверно: `app.dependency_overrides[SessionDep] = ...` (псевдоним типа). Верно: ключ — функция `get_session`, та же, что в `Depends(get_session)`.
- Данные в базе рабочего приложения. Неверно: `from database import SessionLocal` в тесте. Верно: фабрика тестовой базы и фикстура `make_book`.
- Тест без базы. Неверно: `TestClient(app)` без подмены и без `lifespan`: в рабочей базе нет таблиц. Верно: подмена сессии в фикстуре `client`.

### Шпаргалка

- `make_session_factory()` — свежая база в памяти с таблицами; одна на тест.
- Фикстура `client(session_factory)`: подмена `app.dependency_overrides[get_session] = override_session`, `yield TestClient(app)`, `clear()` после.
- `override_session` — функция с `yield`, берущая сессию у тестовой фабрики.
- `scope`: `function` (по умолчанию), `module`, `session`; изменяемое состояние только на `function`.
- Фабрика: фикстура возвращает функцию с параметрами по умолчанию.
- `parametrize("a, b", [(1, 2), (3, 4)])` и `params={...}` в запросе.
- Граничные значения ловят `<` вместо `<=`.
- Изоляция: тест не зависит от порядка и от соседей.
- `TestClient(app)` без `with` не запускает `lifespan`.

## task fa-testdb-refactor
```json
{
  "type": "refactor",
  "title": "Сессия через зависимость",
  "xp": 15,
  "hints": [
    "Разделы «Проект, который удобно тестировать» и «Подмена сессии через dependency_overrides»: сессия должна приходить в обработчик через зависимость с yield.",
    "В database.py добавьте get_session (with SessionLocal() as session: yield session) и SessionDep. В routers/books.py уберите with SessionLocal() из обработчиков и принимайте session: SessionDep.",
    "Шаблон: def get_session(): with SessionLocal() as session: yield session; SessionDep = Annotated[Session, Depends(get_session)]; def list_books(session: SessionDep) -> list[BookOut]: return list(session.scalars(...))."
  ],
  "packages": ["db"],
  "readonly": ["main.py", "models.py", "schemas.py"],
  "check": {
    "static": [
      { "rule": "uses", "name": "SessionDep", "file": "routers/books.py", "message": "Обработчики должны принимать session: SessionDep." },
      { "rule": "pattern", "regex": "def get_session\\([\\s\\S]*?\\byield\\b", "message": "Зависимость get_session должна выдавать сессию через yield и закрывать её после запроса." }
    ]
  },
  "wrong": {
    "global-session": "одна глобальная сессия на всё приложение: она не закрывается и общая для всех запросов",
    "still-direct": "зависимость объявлена, но обработчики по-прежнему открывают SessionLocal() сами"
  }
}
```
Роутер книг открывает сессию в каждом обработчике сам: `with SessionLocal() as session:`. В тесте такую сессию нельзя подменить. Перенесите создание сессии в зависимость `get_session` и тип `SessionDep` в `database.py` и используйте их в роутере. Поведение API не меняется.

Маршруты: `GET /books` (список по возрастанию номера), `GET /books/{book_id}` (`404` с `{"detail": "Book not found"}`, если нет), `POST /books` (`201`). Идея проверки: проверка отправляет те же запросы в эталон и в ваш проект и сравнивает ответы, затем смотрит структуру кода: `SessionDep` в роутере и `yield` в зависимости.

```python starter path=database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
```

```python starter path=models.py
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    price: Mapped[float]
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class BookOut(BookIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
```

```python starter path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from database import Base, SessionLocal, engine
from models import Book
from routers.books import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all([Book(title="Dune", price=9.5), Book(title="Emma", price=7.0)])
        session.commit()
    yield


app = FastAPI(title="Bookshop", lifespan=lifespan)
app.include_router(router)
```

```python starter path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionLocal
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books() -> list[BookOut]:
    with SessionLocal() as session:
        return list(session.scalars(select(Book).order_by(Book.id)))


@router.get("/{book_id}")
def read_book(book_id: int) -> BookOut:
    with SessionLocal() as session:
        book = session.get(Book, book_id)
        if book is None:
            raise HTTPException(status_code=404, detail="Book not found")
        return book


@router.post("", status_code=201)
def create_book(data: BookIn) -> BookOut:
    with SessionLocal() as session:
        book = Book(**data.model_dump())
        session.add(book)
        session.commit()
        return book
```

```python solution path=database.py
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python solution path=models.py
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    price: Mapped[float]
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class BookOut(BookIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
```

```python solution path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from database import Base, SessionLocal, engine
from models import Book
from routers.books import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all([Book(title="Dune", price=9.5), Book(title="Emma", price=7.0)])
        session.commit()
    yield


app = FastAPI(title="Bookshop", lifespan=lifespan)
app.include_router(router)
```

```python solution path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionDep
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(session: SessionDep) -> list[BookOut]:
    return list(session.scalars(select(Book).order_by(Book.id)))


@router.get("/{book_id}")
def read_book(book_id: int, session: SessionDep) -> BookOut:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn, session: SessionDep) -> BookOut:
    book = Book(**data.model_dump())
    session.add(book)
    session.commit()
    return book
```

```python wrong id=global-session path=database.py
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
_shared = SessionLocal()


def get_session() -> Session:
    return _shared


SessionDep = Annotated[Session, Depends(get_session)]
```

```python wrong id=still-direct path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionLocal
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books() -> list[BookOut]:
    with SessionLocal() as session:
        return list(session.scalars(select(Book).order_by(Book.id)))


@router.get("/{book_id}")
def read_book(book_id: int) -> BookOut:
    with SessionLocal() as session:
        book = session.get(Book, book_id)
        if book is None:
            raise HTTPException(status_code=404, detail="Book not found")
        return book


@router.post("", status_code=201)
def create_book(data: BookIn) -> BookOut:
    with SessionLocal() as session:
        book = Book(**data.model_dump())
        session.add(book)
        session.commit()
        return book
```

```http tests
GET /books
###
GET /books/2
###
GET /books/99
###
POST /books
Content-Type: application/json

{"title": "Solaris", "price": 11}
###
GET /books
###
POST /books
Content-Type: application/json

{"title": "", "price": 5}
```

## task fa-testdb-scope-review
```json
{
  "type": "review",
  "title": "Тесты зависят друг от друга",
  "xp": 15,
  "hints": [
    "Разделы «Фикстуры: время жизни и порядок» и «Изоляция тестов»: какая область у фикстуры, которая создаёт базу, и что остаётся после теста.",
    "Дефектов два. Один в строке с `scope`: база создаётся один раз на файл. Второй в `client`: после `yield` подмена остаётся в приложении.",
    "Верны два исправления: убрать `scope=\"module\"` и вызвать `app.dependency_overrides.clear()` после `yield`."
  ],
  "lines": [1, 13],
  "options": [
    "Убрать `scope=\"module\"`: фикстура с областью по умолчанию создаёт новую базу для каждого теста",
    "Добавить после `yield TestClient(app)` вызов `app.dependency_overrides.clear()`: иначе подмена останется в приложении после теста",
    "Заменить `scope=\"module\"` на `scope=\"session\"`: тогда база создаётся один раз, и тесты станут быстрее и независимее",
    "Запускать тесты в алфавитном порядке: тогда тест, создающий книгу, идёт после тестов, которые её не ждут"
  ],
  "answer": [0, 1],
  "explanation": "Область `module` создаёт `session_factory` один раз на файл, поэтому все тесты файла работают с одной базой: запись, созданная первым тестом, видна следующим, номера плавают, а повторное создание книги с тем же названием даёт `409`. Область по умолчанию (`function`) создаёт базу заново для каждого теста. Без `clear()` подмена остаётся в `app.dependency_overrides` после теста, и следующий файл тестов получит чужую базу. Область `session` делает ровно обратное тому, что нужно: база становится общей на весь запуск, тесты зависят друг от друга ещё сильнее. Порядок запуска не лечит зависимость, а скрывает её: тесты по-прежнему сломаются при выборочном запуске или перестановке."
}
```
Тесты книжного магазина проходят, когда их запускают по одному, а в составе файла часть падает: то номер новой книги оказывается не `1`, то создание возвращает `409`. Ниже `conftest.py`. Выберите все верные исправления.

```python code
@pytest.fixture(scope="module")
def session_factory():
    return make_session_factory()


@pytest.fixture
def client(session_factory):
    def override_session():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    yield TestClient(app)
```

## task fa-testdb-client
```json
{
  "type": "pytest",
  "title": "Фикстура клиента с тестовой базой",
  "xp": 20,
  "hints": [
    "Раздел «Подмена сессии через dependency_overrides»: фикстура client принимает session_factory, подменяет get_session и снимает подмену после теста.",
    "Нужны две фикстуры в tests/conftest.py: session_factory (одна свежая база на тест) и client, которая подменяет get_session функцией с yield и делает clear() после теста. Тесты в tests/test_books.py уже написаны, открыты только для чтения.",
    "Шаблон: @pytest.fixture def session_factory(): return make_session_factory(); @pytest.fixture def client(session_factory): def override_session(): with session_factory() as session: yield session; app.dependency_overrides[get_session] = override_session; yield TestClient(app); app.dependency_overrides.clear()."
  ],
  "packages": ["db"],
  "readonly": ["main.py", "database.py", "models.py", "schemas.py", "routers/books.py", "tests/test_books.py"],
  "check": {
    "minTests": 4,
    "static": [
      { "rule": "uses", "name": "dependency_overrides", "file": "tests/conftest.py", "message": "Подмените get_session через app.dependency_overrides в tests/conftest.py." }
    ]
  },
  "mutants": {
    "create-200": "создание книги отвечает 200 вместо 201",
    "no-404": "для несуществующей книги вместо ответа 404 приходит 200 с null"
  },
  "wrong": {
    "shared-db": "база создаётся один раз на модуль: тесты делят данные, и номера книг и повторные названия ломают соседние тесты",
    "no-override": "клиент не подменяет get_session и ходит в рабочую базу, где нет таблиц"
  }
}
```
Магазин из урока готов, и тесты `tests/test_books.py` уже написаны (файл закрыт для правки). Не хватает `tests/conftest.py`: напишите в нём две фикстуры.

- `session_factory` возвращает `make_session_factory()` из `database.py`: новая пустая база для каждого теста.
- `client` подменяет `get_session` в `app.dependency_overrides` функцией с `yield`, которая открывает сессию у `session_factory`, выдаёт тесту `TestClient(app)` и после теста снимает подмену через `clear()`.

Тесты рассчитывают на то, что каждый получает **чистую** базу: в одном создаётся книга с номером `1`, в другом то же название создаётся снова. Если база общая, часть тестов упадёт. Идея проверки: ваша `conftest.py` и готовые тесты запускаются на правильном приложении (все проходят), затем на копиях приложения с ошибками (хотя бы один тест должен упасть).

```python starter path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python starter path=database.py
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def make_engine():
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


engine = make_engine()
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def make_session_factory():
    """Свежая база в памяти с таблицами: для тестов."""
    test_engine = make_engine()
    Base.metadata.create_all(test_engine)
    return sessionmaker(test_engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python starter path=models.py
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    price: Mapped[float]
    in_stock: Mapped[bool] = mapped_column(default=True)
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class BookOut(BookIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    in_stock: bool
```

```python starter path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionDep
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(session: SessionDep, max_price: float | None = None) -> list[BookOut]:
    stmt = select(Book).order_by(Book.id)
    if max_price is not None:
        stmt = stmt.where(Book.price <= max_price)
    return list(session.scalars(stmt))


@router.get("/{book_id}")
def read_book(book_id: int, session: SessionDep) -> BookOut:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn, session: SessionDep) -> BookOut:
    exists = session.scalars(select(Book).where(Book.title == data.title)).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail="Book already exists")
    book = Book(**data.model_dump())
    session.add(book)
    session.commit()
    return book


@router.delete("/{book_id}", status_code=204)
def delete_book(book_id: int, session: SessionDep) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    session.delete(book)
    session.commit()
```

```python starter path=tests/conftest.py
# Здесь нужны фикстуры session_factory и client.
```

```python starter path=tests/test_books.py
def test_create_book(client):
    response = client.post("/books", json={"title": "Dune", "price": 9.5})
    assert response.status_code == 201
    assert response.json() == {"id": 1, "title": "Dune", "price": 9.5, "in_stock": True}


def test_list_has_only_created(client):
    client.post("/books", json={"title": "Dune", "price": 9.5})
    response = client.get("/books")
    assert [book["id"] for book in response.json()] == [1]


def test_list_starts_empty(client):
    assert client.get("/books").json() == []


def test_missing_book(client):
    response = client.get("/books/99")
    assert response.status_code == 404
    assert response.json() == {"detail": "Book not found"}
```

```python solution path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python solution path=database.py
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def make_engine():
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


engine = make_engine()
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def make_session_factory():
    """Свежая база в памяти с таблицами: для тестов."""
    test_engine = make_engine()
    Base.metadata.create_all(test_engine)
    return sessionmaker(test_engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python solution path=models.py
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    price: Mapped[float]
    in_stock: Mapped[bool] = mapped_column(default=True)
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class BookOut(BookIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    in_stock: bool
```

```python solution path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionDep
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(session: SessionDep, max_price: float | None = None) -> list[BookOut]:
    stmt = select(Book).order_by(Book.id)
    if max_price is not None:
        stmt = stmt.where(Book.price <= max_price)
    return list(session.scalars(stmt))


@router.get("/{book_id}")
def read_book(book_id: int, session: SessionDep) -> BookOut:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn, session: SessionDep) -> BookOut:
    exists = session.scalars(select(Book).where(Book.title == data.title)).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail="Book already exists")
    book = Book(**data.model_dump())
    session.add(book)
    session.commit()
    return book


@router.delete("/{book_id}", status_code=204)
def delete_book(book_id: int, session: SessionDep) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    session.delete(book)
    session.commit()
```

```python solution path=tests/conftest.py
import pytest
from fastapi.testclient import TestClient

from database import get_session, make_session_factory
from main import app


@pytest.fixture
def session_factory():
    return make_session_factory()


@pytest.fixture
def client(session_factory):
    def override_session():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    yield TestClient(app)
    app.dependency_overrides.clear()
```

```python solution path=tests/test_books.py
def test_create_book(client):
    response = client.post("/books", json={"title": "Dune", "price": 9.5})
    assert response.status_code == 201
    assert response.json() == {"id": 1, "title": "Dune", "price": 9.5, "in_stock": True}


def test_list_has_only_created(client):
    client.post("/books", json={"title": "Dune", "price": 9.5})
    response = client.get("/books")
    assert [book["id"] for book in response.json()] == [1]


def test_list_starts_empty(client):
    assert client.get("/books").json() == []


def test_missing_book(client):
    response = client.get("/books/99")
    assert response.status_code == 404
    assert response.json() == {"detail": "Book not found"}
```

```python wrong id=shared-db path=tests/conftest.py
import pytest
from fastapi.testclient import TestClient

from database import get_session, make_session_factory
from main import app

SHARED = make_session_factory()


@pytest.fixture
def session_factory():
    return SHARED


@pytest.fixture
def client(session_factory):
    def override_session():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    yield TestClient(app)
    app.dependency_overrides.clear()
```

```python wrong id=no-override path=tests/conftest.py
import pytest
from fastapi.testclient import TestClient

from database import make_session_factory
from main import app


@pytest.fixture
def session_factory():
    return make_session_factory()


@pytest.fixture
def client(session_factory):
    yield TestClient(app)
    app.dependency_overrides.clear()
```

```python mutant id=create-200 path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionDep
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(session: SessionDep, max_price: float | None = None) -> list[BookOut]:
    stmt = select(Book).order_by(Book.id)
    if max_price is not None:
        stmt = stmt.where(Book.price <= max_price)
    return list(session.scalars(stmt))


@router.get("/{book_id}")
def read_book(book_id: int, session: SessionDep) -> BookOut:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("")
def create_book(data: BookIn, session: SessionDep) -> BookOut:
    exists = session.scalars(select(Book).where(Book.title == data.title)).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail="Book already exists")
    book = Book(**data.model_dump())
    session.add(book)
    session.commit()
    return book


@router.delete("/{book_id}", status_code=204)
def delete_book(book_id: int, session: SessionDep) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    session.delete(book)
    session.commit()
```

```python mutant id=no-404 path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionDep
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(session: SessionDep, max_price: float | None = None) -> list[BookOut]:
    stmt = select(Book).order_by(Book.id)
    if max_price is not None:
        stmt = stmt.where(Book.price <= max_price)
    return list(session.scalars(stmt))


@router.get("/{book_id}")
def read_book(book_id: int, session: SessionDep) -> BookOut | None:
    return session.get(Book, book_id)


@router.post("", status_code=201)
def create_book(data: BookIn, session: SessionDep) -> BookOut:
    exists = session.scalars(select(Book).where(Book.title == data.title)).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail="Book already exists")
    book = Book(**data.model_dump())
    session.add(book)
    session.commit()
    return book


@router.delete("/{book_id}", status_code=204)
def delete_book(book_id: int, session: SessionDep) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    session.delete(book)
    session.commit()
```

## task fa-testdb-factory
```json
{
  "type": "pytest",
  "title": "Тесты каталога с фабрикой данных",
  "xp": 20,
  "hints": [
    "Разделы «Фабрики данных» и «parametrize для нескольких значений». Фикстуры client и make_book уже есть в tests/conftest.py (только для чтения).",
    "Проверьте: пустой список, порядок по номеру, фильтр max_price на границе цены, чтение книги и 404, создание (201) и повтор названия (409), удаление и повторное чтение, удаление несуществующей книги.",
    "Шаблон: def test_имя(client, make_book): make_book(\"Dune\", 9.5); response = client.get(\"/books\", params={\"max_price\": ...}); assert ...; фильтр — @pytest.mark.parametrize(\"max_price, titles\", [(7.0, [...]), ...]) с граничным значением, равным цене."
  ],
  "packages": ["db"],
  "readonly": ["main.py", "database.py", "models.py", "schemas.py", "routers/books.py", "tests/conftest.py"],
  "check": {
    "minTests": 7,
    "static": [
      { "rule": "uses", "name": "parametrize", "file": "tests/test_books.py", "message": "Для проверки фильтра по цене используйте @pytest.mark.parametrize." }
    ]
  },
  "mutants": {
    "price-strict": "фильтр max_price отбрасывает книги, цена которых равна границе (< вместо <=)",
    "delete-keeps": "удаление отвечает 204, но книга остаётся в базе",
    "dup-allowed": "повторное название принимается вместо ответа 409",
    "no-delete-404": "удаление несуществующей книги отвечает 204 вместо 404"
  },
  "wrong": {
    "reads-only": "тесты проверяют только чтение и создание: поломки удаления и повторного названия остаются незамеченными",
    "no-boundary": "фильтр по цене проверен только на значениях, не равных цене книги, поэтому ошибка на границе остаётся незамеченной"
  }
}
```
Приложение магазина и фикстуры готовы. В `tests/conftest.py` есть `client` (с чистой тестовой базой) и фабрика `make_book(title, price, in_stock)`, которая кладёт книгу в базу и возвращает её номер. Напишите `tests/test_books.py`: не меньше семи тестов (случаи `parametrize` считаются отдельно).

Приложение работает так:

- `GET /books` — список по возрастанию номера; параметр `max_price` оставляет книги с ценой **не выше** указанной;
- `GET /books/{book_id}` — книга или `404` с `{"detail": "Book not found"}`;
- `POST /books` — создаёт книгу и отвечает `201`; такое же название второй раз даёт `409` с `{"detail": "Book already exists"}`; пустое название или цена не больше нуля — `422`;
- `DELETE /books/{book_id}` — `204`; несуществующая книга даёт `404`.

Фильтр по цене проверьте через `@pytest.mark.parametrize`, включив значения, равные цене книги. Идея проверки: ваши тесты запускаются на правильном приложении (все проходят), затем на копиях с ошибками; на каждой копии хотя бы один тест должен упасть. Если не заметили ошибку, в сообщении будет её описание.

```python starter path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python starter path=database.py
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def make_engine():
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


engine = make_engine()
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def make_session_factory():
    """Свежая база в памяти с таблицами: для тестов."""
    test_engine = make_engine()
    Base.metadata.create_all(test_engine)
    return sessionmaker(test_engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python starter path=models.py
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    price: Mapped[float]
    in_stock: Mapped[bool] = mapped_column(default=True)
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class BookOut(BookIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    in_stock: bool
```

```python starter path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionDep
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(session: SessionDep, max_price: float | None = None) -> list[BookOut]:
    stmt = select(Book).order_by(Book.id)
    if max_price is not None:
        stmt = stmt.where(Book.price <= max_price)
    return list(session.scalars(stmt))


@router.get("/{book_id}")
def read_book(book_id: int, session: SessionDep) -> BookOut:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn, session: SessionDep) -> BookOut:
    exists = session.scalars(select(Book).where(Book.title == data.title)).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail="Book already exists")
    book = Book(**data.model_dump())
    session.add(book)
    session.commit()
    return book


@router.delete("/{book_id}", status_code=204)
def delete_book(book_id: int, session: SessionDep) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    session.delete(book)
    session.commit()
```

```python starter path=tests/conftest.py
import pytest
from fastapi.testclient import TestClient

from database import get_session, make_session_factory
from main import app
from models import Book


@pytest.fixture
def session_factory():
    return make_session_factory()


@pytest.fixture
def client(session_factory):
    def override_session():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def make_book(session_factory):
    def make(title="Dune", price=9.5, in_stock=True):
        with session_factory() as session:
            book = Book(title=title, price=price, in_stock=in_stock)
            session.add(book)
            session.commit()
            return book.id

    return make
```

```python starter path=tests/test_books.py
def test_list_starts_empty(client):
    assert client.get("/books").json() == []
```

```python solution path=main.py
from fastapi import FastAPI

from routers.books import router

app = FastAPI(title="Bookshop")
app.include_router(router)
```

```python solution path=database.py
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def make_engine():
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


engine = make_engine()
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def make_session_factory():
    """Свежая база в памяти с таблицами: для тестов."""
    test_engine = make_engine()
    Base.metadata.create_all(test_engine)
    return sessionmaker(test_engine, expire_on_commit=False)


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python solution path=models.py
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    price: Mapped[float]
    in_stock: Mapped[bool] = mapped_column(default=True)
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class BookIn(BaseModel):
    title: str = Field(min_length=1)
    price: float = Field(gt=0)


class BookOut(BookIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    in_stock: bool
```

```python solution path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionDep
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(session: SessionDep, max_price: float | None = None) -> list[BookOut]:
    stmt = select(Book).order_by(Book.id)
    if max_price is not None:
        stmt = stmt.where(Book.price <= max_price)
    return list(session.scalars(stmt))


@router.get("/{book_id}")
def read_book(book_id: int, session: SessionDep) -> BookOut:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn, session: SessionDep) -> BookOut:
    exists = session.scalars(select(Book).where(Book.title == data.title)).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail="Book already exists")
    book = Book(**data.model_dump())
    session.add(book)
    session.commit()
    return book


@router.delete("/{book_id}", status_code=204)
def delete_book(book_id: int, session: SessionDep) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    session.delete(book)
    session.commit()
```

```python solution path=tests/conftest.py
import pytest
from fastapi.testclient import TestClient

from database import get_session, make_session_factory
from main import app
from models import Book


@pytest.fixture
def session_factory():
    return make_session_factory()


@pytest.fixture
def client(session_factory):
    def override_session():
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def make_book(session_factory):
    def make(title="Dune", price=9.5, in_stock=True):
        with session_factory() as session:
            book = Book(title=title, price=price, in_stock=in_stock)
            session.add(book)
            session.commit()
            return book.id

    return make
```

```python solution path=tests/test_books.py
import pytest


def test_list_starts_empty(client):
    assert client.get("/books").json() == []


def test_list_is_ordered_by_id(client, make_book):
    make_book("Dune", 9.5)
    make_book("Emma", 7.0)
    assert [book["title"] for book in client.get("/books").json()] == ["Dune", "Emma"]


@pytest.mark.parametrize(
    "max_price, titles",
    [(7.0, ["Emma"]), (9.5, ["Dune", "Emma"]), (5, [])],
)
def test_price_filter(client, make_book, max_price, titles):
    make_book("Dune", 9.5)
    make_book("Emma", 7.0)
    response = client.get("/books", params={"max_price": max_price})
    assert [book["title"] for book in response.json()] == titles


def test_read_book(client, make_book):
    book_id = make_book("Emma", 7.0)
    response = client.get(f"/books/{book_id}")
    assert response.status_code == 200
    assert response.json() == {"id": book_id, "title": "Emma", "price": 7.0, "in_stock": True}


def test_missing_book(client):
    response = client.get("/books/99")
    assert response.status_code == 404
    assert response.json() == {"detail": "Book not found"}


def test_create_book(client):
    response = client.post("/books", json={"title": "Dune", "price": 9.5})
    assert response.status_code == 201
    assert response.json()["id"] == 1


def test_duplicate_title(client, make_book):
    make_book("Dune")
    response = client.post("/books", json={"title": "Dune", "price": 5})
    assert response.status_code == 409
    assert response.json() == {"detail": "Book already exists"}


def test_delete_book(client, make_book):
    book_id = make_book("Dune")
    assert client.delete(f"/books/{book_id}").status_code == 204
    assert client.get(f"/books/{book_id}").status_code == 404


def test_delete_missing_book(client):
    assert client.delete("/books/99").status_code == 404
```

```python wrong id=reads-only path=tests/test_books.py
import pytest


def test_list_starts_empty(client):
    assert client.get("/books").json() == []


def test_list_is_ordered_by_id(client, make_book):
    make_book("Dune", 9.5)
    make_book("Emma", 7.0)
    assert [book["title"] for book in client.get("/books").json()] == ["Dune", "Emma"]


@pytest.mark.parametrize(
    "max_price, titles",
    [(7.0, ["Emma"]), (9.5, ["Dune", "Emma"]), (5, [])],
)
def test_price_filter(client, make_book, max_price, titles):
    make_book("Dune", 9.5)
    make_book("Emma", 7.0)
    response = client.get("/books", params={"max_price": max_price})
    assert [book["title"] for book in response.json()] == titles


def test_read_book(client, make_book):
    book_id = make_book("Emma", 7.0)
    assert client.get(f"/books/{book_id}").json()["title"] == "Emma"


def test_missing_book(client):
    assert client.get("/books/99").status_code == 404


def test_create_book(client):
    assert client.post("/books", json={"title": "Dune", "price": 9.5}).status_code == 201


def test_read_after_create(client):
    book_id = client.post("/books", json={"title": "Dune", "price": 9.5}).json()["id"]
    assert client.get(f"/books/{book_id}").json()["price"] == 9.5
```

```python wrong id=no-boundary path=tests/test_books.py
import pytest


def test_list_starts_empty(client):
    assert client.get("/books").json() == []


def test_list_is_ordered_by_id(client, make_book):
    make_book("Dune", 9.5)
    make_book("Emma", 7.0)
    assert [book["title"] for book in client.get("/books").json()] == ["Dune", "Emma"]


@pytest.mark.parametrize(
    "max_price, titles",
    [(8, ["Emma"]), (10, ["Dune", "Emma"]), (5, [])],
)
def test_price_filter(client, make_book, max_price, titles):
    make_book("Dune", 9.5)
    make_book("Emma", 7.0)
    response = client.get("/books", params={"max_price": max_price})
    assert [book["title"] for book in response.json()] == titles


def test_read_book(client, make_book):
    book_id = make_book("Emma", 7.0)
    assert client.get(f"/books/{book_id}").json()["title"] == "Emma"


def test_missing_book(client):
    response = client.get("/books/99")
    assert response.status_code == 404
    assert response.json() == {"detail": "Book not found"}


def test_create_book(client):
    assert client.post("/books", json={"title": "Dune", "price": 9.5}).status_code == 201


def test_duplicate_title(client, make_book):
    make_book("Dune")
    assert client.post("/books", json={"title": "Dune", "price": 5}).status_code == 409


def test_delete_book(client, make_book):
    book_id = make_book("Dune")
    assert client.delete(f"/books/{book_id}").status_code == 204
    assert client.get(f"/books/{book_id}").status_code == 404


def test_delete_missing_book(client):
    assert client.delete("/books/99").status_code == 404
```

```python mutant id=price-strict path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionDep
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(session: SessionDep, max_price: float | None = None) -> list[BookOut]:
    stmt = select(Book).order_by(Book.id)
    if max_price is not None:
        stmt = stmt.where(Book.price < max_price)
    return list(session.scalars(stmt))


@router.get("/{book_id}")
def read_book(book_id: int, session: SessionDep) -> BookOut:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn, session: SessionDep) -> BookOut:
    exists = session.scalars(select(Book).where(Book.title == data.title)).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail="Book already exists")
    book = Book(**data.model_dump())
    session.add(book)
    session.commit()
    return book


@router.delete("/{book_id}", status_code=204)
def delete_book(book_id: int, session: SessionDep) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    session.delete(book)
    session.commit()
```

```python mutant id=delete-keeps path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionDep
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(session: SessionDep, max_price: float | None = None) -> list[BookOut]:
    stmt = select(Book).order_by(Book.id)
    if max_price is not None:
        stmt = stmt.where(Book.price <= max_price)
    return list(session.scalars(stmt))


@router.get("/{book_id}")
def read_book(book_id: int, session: SessionDep) -> BookOut:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn, session: SessionDep) -> BookOut:
    exists = session.scalars(select(Book).where(Book.title == data.title)).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail="Book already exists")
    book = Book(**data.model_dump())
    session.add(book)
    session.commit()
    return book


@router.delete("/{book_id}", status_code=204)
def delete_book(book_id: int, session: SessionDep) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
```

```python mutant id=dup-allowed path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionDep
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(session: SessionDep, max_price: float | None = None) -> list[BookOut]:
    stmt = select(Book).order_by(Book.id)
    if max_price is not None:
        stmt = stmt.where(Book.price <= max_price)
    return list(session.scalars(stmt))


@router.get("/{book_id}")
def read_book(book_id: int, session: SessionDep) -> BookOut:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn, session: SessionDep) -> BookOut:
    book = Book(**data.model_dump())
    session.add(book)
    session.commit()
    return book


@router.delete("/{book_id}", status_code=204)
def delete_book(book_id: int, session: SessionDep) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    session.delete(book)
    session.commit()
```

```python mutant id=no-delete-404 path=routers/books.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from database import SessionDep
from models import Book
from schemas import BookIn, BookOut

router = APIRouter(prefix="/books", tags=["books"])


@router.get("")
def list_books(session: SessionDep, max_price: float | None = None) -> list[BookOut]:
    stmt = select(Book).order_by(Book.id)
    if max_price is not None:
        stmt = stmt.where(Book.price <= max_price)
    return list(session.scalars(stmt))


@router.get("/{book_id}")
def read_book(book_id: int, session: SessionDep) -> BookOut:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return book


@router.post("", status_code=201)
def create_book(data: BookIn, session: SessionDep) -> BookOut:
    exists = session.scalars(select(Book).where(Book.title == data.title)).first()
    if exists is not None:
        raise HTTPException(status_code=409, detail="Book already exists")
    book = Book(**data.model_dump())
    session.add(book)
    session.commit()
    return book


@router.delete("/{book_id}", status_code=204)
def delete_book(book_id: int, session: SessionDep) -> None:
    book = session.get(Book, book_id)
    if book is not None:
        session.delete(book)
        session.commit()
```
