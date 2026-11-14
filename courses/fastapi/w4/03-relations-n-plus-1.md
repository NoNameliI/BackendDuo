# Связи и проблема N+1

В блоге у автора много постов, у поста один автор. Клиенту нужен список авторов с их постами, и самый короткий код для этого оказывается медленным: для каждого автора библиотека делает отдельный запрос к базе. На тестовых данных этого не видно, на десяти тысячах авторов сервер ложится. В этом уроке вы опишете связь между таблицами, вложите связанные объекты в ответ, научитесь считать запросы и исправлять проблему, которая называется **N+1**.

### Связь «один ко многим»

В базе связь выражает **внешний ключ**: столбец дочерней таблицы хранит номер строки родителя. В SQLAlchemy поверх него описывают `relationship`: атрибут, через который объекты ходят друг к другу без ручных запросов.

```python
class Author(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    posts: Mapped[list["Post"]] = relationship(back_populates="author", order_by="Post.id")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id"))
    author: Mapped["Author"] = relationship(back_populates="posts")
```

- `ForeignKey("authors.id")` (`from sqlalchemy import ForeignKey`) — внешний ключ: «значение этого столбца — `id` из таблицы `authors`». Строка `"authors.id"` — имя таблицы и столбца в базе.
- `relationship(...)` (`from sqlalchemy.orm import relationship`) — связь на уровне объектов. Это не столбец: в таблице он не появляется.
- `Mapped[list["Post"]]` — со стороны родителя связь даёт список. Класс `Post` записан строкой, потому что при объявлении `Author` он ещё не существует.
- `Mapped["Author"]` — со стороны ребёнка связь даёт один объект.
- `back_populates="author"` и `back_populates="posts"` — имена зеркальных атрибутов. Они связывают две стороны: добавили пост в `author.posts`, и у поста сам заполнится `author`.
- `order_by="Post.id"` — порядок элементов в `author.posts`. Без него порядок не гарантирован.

Объекты создают, вкладывая детей в родителя, а сессия запишет оба и сама проставит `author_id`:

```python
author = Author(name="Ann", posts=[Post(title="First"), Post(title="Second")])
session.add(author)
session.commit()
```

Присвоить связь можно и со стороны ребёнка: `Post(title="Third", author=author)`.

**Про внешние ключи в студии.** SQLite по умолчанию не проверяет, что значение внешнего ключа существует в родительской таблице (проверку включают отдельной настройкой), а PostgreSQL проверяет всегда. Поэтому наличие родителя проверяют в коде: прочитали `session.get(Author, id)` и при `None` ответили `404`. Так нужно в любом случае, потому что клиент ждёт понятный ответ, а не ошибку базы.

### Вложенные модели ответа

Связь — обычный атрибут, поэтому её можно положить в модель ответа так же, как поле.

```python
class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


class AuthorWithPosts(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    posts: list[PostOut]
```

- `posts: list[PostOut]` — «список вложенных постов». Когда FastAPI собирает ответ, он читает `author.posts`, и SQLAlchemy при первом обращении сама делает запрос за постами.
- Вложенная модель тоже нуждается в `from_attributes=True`: её значения читаются из объектов, а не из словарей.
- Родитель в ответе ребёнка не вкладывают обратно в родителя: если `PostOut` содержит автора, а `AuthorWithPosts` содержит посты с авторами, получится бесконечная вложенность. Выбирайте для каждого маршрута свою модель: «автор с постами» и «пост с автором» — разные модели.

### Ленивая загрузка и N+1

По умолчанию связи **ленивые**: данные подгружаются при первом обращении к атрибуту. Для одного автора это один дополнительный запрос. Но если вернуть список из N авторов, то при выдаче каждого вызывается `author.posts`, и это N запросов за постами плюс один запрос за самим списком. Отсюда название **N+1**: «один запрос и ещё N».

Запросы можно сосчитать: движок позволяет подписаться на событие «перед выполнением SQL».

```python
QUERIES = {"count": 0}


@event.listens_for(engine, "before_cursor_execute")
def count_query(conn, cursor, statement, parameters, context, executemany):
    QUERIES["count"] += 1
```

- `from sqlalchemy import event` — модуль событий.
- `@event.listens_for(engine, "before_cursor_execute")` — функция будет вызвана перед каждым SQL-запросом движка. Пять параметров — те, что передаёт библиотека, имена и порядок менять нельзя.
- Счётчик лежит в словаре, чтобы функция могла его менять без `global`.

Чтобы видеть число запросов у каждого ответа, его кладут в заголовок через middleware (урок про middleware мира 3):

```python
@app.middleware("http")
async def add_query_count(request: Request, call_next):
    QUERIES["count"] = 0
    response = await call_next(request)
    response.headers["X-Query-Count"] = str(QUERIES["count"])
    return response
```

Такой общий счётчик подходит для учебного примера и для одного разработчика. В боевом сервисе, где запросы идут параллельно, его заменяют настоящим журналом: `create_engine(..., echo=True)` печатает каждый SQL в лог.

### selectinload и joinedload

Чтобы убрать N+1, говорят запросу, какие связи загрузить сразу. Для этого есть **загрузчики**, они передаются в `.options(...)`.

```python
select(Author).options(selectinload(Author.posts))
select(Post).options(joinedload(Post.author))
```

- `from sqlalchemy.orm import selectinload, joinedload` — оба загрузчика.
- `selectinload(Author.posts)` — после основного запроса делает ещё один: `SELECT ... FROM posts WHERE author_id IN (1, 2, 3, ...)`, и раскладывает посты по авторам. Всего **два запроса**, сколько бы авторов ни было. Подходит для связей-списков.
- `joinedload(Post.author)` — присоединяет родителя к основному запросу через `JOIN`: **один запрос**. Подходит для связи «к одному» (пост → автор).
- Для связей-списков `joinedload` тоже работает, но строки размножаются (один автор на каждый его пост), и результат нужно склеить: `session.scalars(stmt).unique().all()`. Без `.unique()` SQLAlchemy отказывается собирать такой результат. Для списков проще и надёжнее `selectinload`.
- Загрузчик не меняет результат запроса: те же объекты, лишь меньше обращений к базе.

Пример сравнивает три способа. Заголовок `X-Query-Count` каждого ответа показывает число запросов.

```python example
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import ForeignKey, String, create_engine, event, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, joinedload, mapped_column, relationship, selectinload, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
QUERIES = {"count": 0}


@event.listens_for(engine, "before_cursor_execute")
def count_query(conn, cursor, statement, parameters, context, executemany):
    QUERIES["count"] += 1


class Base(DeclarativeBase):
    pass


class Shelf(Base):
    __tablename__ = "shelves"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    books: Mapped[list["Book"]] = relationship(back_populates="shelf", order_by="Book.id")


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    shelf_id: Mapped[int] = mapped_column(ForeignKey("shelves.id"))
    shelf: Mapped[Shelf] = relationship(back_populates="books")


class BookOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


class ShelfOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    books: list[BookOut]


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Shelf(name="Fiction", books=[Book(title="Solaris"), Book(title="Dune")]),
                Shelf(name="Science", books=[Book(title="Cosmos")]),
                Shelf(name="Poetry", books=[Book(title="Odes"), Book(title="Sonnets")]),
                Shelf(name="Empty"),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def add_query_count(request: Request, call_next):
    QUERIES["count"] = 0
    response = await call_next(request)
    response.headers["X-Query-Count"] = str(QUERIES["count"])
    return response


@app.get("/lazy", response_model=list[ShelfOut])
def shelves_lazy(session: SessionDep):
    return session.scalars(select(Shelf).order_by(Shelf.id)).all()


@app.get("/eager", response_model=list[ShelfOut])
def shelves_eager(session: SessionDep):
    stmt = select(Shelf).options(selectinload(Shelf.books)).order_by(Shelf.id)
    return session.scalars(stmt).all()


@app.get("/books")
def list_books(session: SessionDep):
    stmt = select(Book).options(joinedload(Book.shelf)).order_by(Book.id)
    return [{"title": book.title, "shelf": book.shelf.name} for book in session.scalars(stmt).all()]
###
GET /lazy
###
GET /eager
###
GET /books
```

Три полки с книгами и одна пустая. Маршрут `/lazy` (без загрузчика) сделал **5** запросов: один за полками и по одному за книгами каждой из четырёх. Маршрут `/eager` с `selectinload` — **2** запроса. Маршрут `/books` с `joinedload` — **1** запрос: книги вместе с полкой. Тела ответов у `/lazy` и `/eager` одинаковые, меняется только цена.

Для связи «к одному» обычный запрос без загрузчика устроен мягче: SQLAlchemy запоминает уже загруженные объекты сессии и не читает полку повторно. Запросов будет столько, сколько разных полок встретилось, плюс один. Но это всё равно N+1 на неудачных данных, поэтому загрузчик нужен и тут.

### Создание дочернего объекта

Маршрут вида `POST /authors/{author_id}/posts` создаёт пост для существующего автора:

```python
author = session.get(Author, author_id)
if author is None:
    raise HTTPException(status_code=404, detail="Author not found")
post = Post(title=data.title, author=author)
session.add(post)
session.commit()
```

- Сначала находят родителя; если его нет, `404`. Проверка нужна ещё и потому, что SQLite не проверяет внешний ключ (см. выше).
- `Post(title=..., author=author)` — связь присваивается объектом; номер `author_id` сессия проставит при записи.
- Дальше — обычные `add` и `commit`, как в прошлом уроке. `refresh` здесь не нужен: при `expire_on_commit=False` объект после `commit()` остаётся заполненным, включая новый `id`. Для ответа добавляют `status_code=201`.

Удаление родителя с детьми в этом уроке не разбирается: для него в `relationship` задают правило каскада (`cascade="all, delete-orphan"`), и без него удаление автора, у которого есть посты, заканчивается ошибкой.

### Частые ошибки

- Список связей без загрузчика. Неверно: `select(Author)` и вложенный `posts` в модели ответа — N+1. Верно: `.options(selectinload(Author.posts))`.
- `joinedload` для списка без `unique()`. Неверно: `session.scalars(select(Author).options(joinedload(Author.posts))).all()` — ошибка. Верно: `selectinload` или `.unique()` перед `.all()`.
- Обращение к связи после закрытия сессии. Неверно: сохранить объект и читать `author.posts` вне обработчика — сессия уже закрыта, и данные не подгрузятся. Верно: загрузить связи в запросе (`options`) и отдавать ответ внутри обработчика.
- Нет проверки родителя. Неверно: `Post(title=..., author_id=author_id)` без `session.get`: в SQLite запись сохранится с несуществующим автором. Верно: проверить родителя и ответить `404`.
- Взаимная вложенность моделей ответа (автор с постами, пост с автором, у которого посты…). Верно: отдельные модели для разных маршрутов.
- Порядок элементов связи не задан. Неверно: `relationship(...)` без `order_by`, затем сравнение списка с ожидаемым. Верно: `order_by="Post.id"`.

### Шпаргалка

- `ForeignKey("таблица.столбец")` в дочерней таблице; `relationship(back_populates="...")` в обеих.
- Родитель: `Mapped[list["Ребёнок"]] = relationship(back_populates="родитель", order_by="Ребёнок.id")`; ребёнок: `Mapped["Родитель"] = relationship(back_populates="дети")`.
- Создание: `Author(name=..., posts=[Post(...)])` или `Post(..., author=author)`.
- Вложенный ответ: `posts: list[PostOut]` с `from_attributes=True`.
- N+1: лениво загруженный список связей на каждом элементе. Счёт запросов: `event.listens_for(engine, "before_cursor_execute")`.
- Список связей: `.options(selectinload(Модель.связь))` — 2 запроса.
- Связь «к одному»: `.options(joinedload(Модель.связь))` — 1 запрос; для списков с `joinedload` нужен `.unique()`.
- Родителя проверяют кодом: `session.get`, `None` → `404`.

## task fa-rel-author-posts
```json
{
  "type": "fastapi",
  "title": "Автор с постами",
  "xp": 15,
  "hints": [
    "Раздел «Связь „один ко многим“»: связь описывают с обеих сторон, зеркальные атрибуты связывает `back_populates`.",
    "В `models.py` добавьте `Author.posts` (список, `order_by=\"Post.id\"`) и `Post.author`. В `routers/authors.py` нужен `GET /authors/{author_id}` с моделью ответа `AuthorWithPosts` и `404`.",
    "Шаблон: `posts: Mapped[list[\"Post\"]] = relationship(back_populates=\"author\", order_by=\"Post.id\")` и `author: Mapped[\"Author\"] = relationship(back_populates=\"posts\")`; в маршруте `author = session.get(Author, author_id)`, при `None` — `HTTPException(404, ...)`."
  ],
  "packages": [
    "db"
  ],
  "readonly": [
    "db.py",
    "schemas.py",
    "main.py"
  ],
  "wrong": {
    "one-way": "связь описана только со стороны автора: приложение не запускается, потому что у поста нет зеркального атрибута author",
    "no-404": "для несуществующего автора приложение отвечает 200 и null вместо 404"
  }
}
```

Блог хранит авторов и посты. Файлы `db.py`, `schemas.py` и `main.py` готовы и закрыты для правки. При запуске в базу кладутся авторы: Ann (три поста), Bob (два), Cy (без постов) и Dee (один). Схемы уже есть: `AuthorOut` (`id`, `name`), `AuthorWithPosts` (то же плюс `posts`) и `PostOut` (`id`, `title`).

Сейчас модели описаны без связей, поэтому приложение не запускается. Вам нужно:

- в `models.py` описать связь между авторами и постами: `Author.posts` — список постов по возрастанию `id`, `Post.author` — автор поста; обе стороны связаны зеркально;
- в `routers/authors.py` добавить `GET /authors/{author_id}`: автор вместе с постами (`AuthorWithPosts`), а если автора нет, `404` и `{"detail": "Author not found"}`.

`GET /authors` (список авторов без постов) уже написан.

```python starter path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
QUERIES = {"count": 0}


@event.listens_for(engine, "before_cursor_execute")
def count_query(conn, cursor, statement, parameters, context, executemany):
    QUERIES["count"] += 1


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    import models  # noqa: F401

    Base.metadata.create_all(engine)


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class PostIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


class AuthorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class AuthorWithPosts(AuthorOut):
    posts: list[PostOut]


class PostWithAuthor(PostOut):
    author: AuthorOut
```

```python starter path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from db import QUERIES, SessionLocal, init_db
from models import Author, Post
from routers import authors


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Author(name="Ann", posts=[Post(title="Intro to SQL"), Post(title="Sessions"), Post(title="Indexes")]),
                Author(name="Bob", posts=[Post(title="Caching"), Post(title="Queues")]),
                Author(name="Cy"),
                Author(name="Dee", posts=[Post(title="Testing")]),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)


@app.middleware("http")
async def add_query_count(request: Request, call_next):
    QUERIES["count"] = 0
    response = await call_next(request)
    if request.method == "GET":
        response.headers["X-Query-Count"] = str(QUERIES["count"])
    return response


app.include_router(authors.router)
```

```python starter path=models.py
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    # связь posts: список постов автора, порядок по Post.id


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id"))
    # связь author: автор поста
```

```python starter path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Author
from schemas import AuthorOut, AuthorWithPosts

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("", response_model=list[AuthorOut])
def list_authors(session: SessionDep):
    return session.scalars(select(Author).order_by(Author.id)).all()
```

```python solution path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
QUERIES = {"count": 0}


@event.listens_for(engine, "before_cursor_execute")
def count_query(conn, cursor, statement, parameters, context, executemany):
    QUERIES["count"] += 1


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    import models  # noqa: F401

    Base.metadata.create_all(engine)


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class PostIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


class AuthorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class AuthorWithPosts(AuthorOut):
    posts: list[PostOut]


class PostWithAuthor(PostOut):
    author: AuthorOut
```

```python solution path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from db import QUERIES, SessionLocal, init_db
from models import Author, Post
from routers import authors


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Author(name="Ann", posts=[Post(title="Intro to SQL"), Post(title="Sessions"), Post(title="Indexes")]),
                Author(name="Bob", posts=[Post(title="Caching"), Post(title="Queues")]),
                Author(name="Cy"),
                Author(name="Dee", posts=[Post(title="Testing")]),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)


@app.middleware("http")
async def add_query_count(request: Request, call_next):
    QUERIES["count"] = 0
    response = await call_next(request)
    if request.method == "GET":
        response.headers["X-Query-Count"] = str(QUERIES["count"])
    return response


app.include_router(authors.router)
```

```python solution path=models.py
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    posts: Mapped[list["Post"]] = relationship(back_populates="author", order_by="Post.id")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id"))
    author: Mapped["Author"] = relationship(back_populates="posts")
```

```python solution path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Author
from schemas import AuthorOut, AuthorWithPosts

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("", response_model=list[AuthorOut])
def list_authors(session: SessionDep):
    return session.scalars(select(Author).order_by(Author.id)).all()


@router.get("/{author_id}", response_model=AuthorWithPosts)
def read_author(author_id: int, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author
```

```python wrong id=one-way path=models.py
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    posts: Mapped[list["Post"]] = relationship(back_populates="author", order_by="Post.id")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id"))
```

```python wrong id=no-404 path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Author
from schemas import AuthorOut, AuthorWithPosts

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("", response_model=list[AuthorOut])
def list_authors(session: SessionDep):
    return session.scalars(select(Author).order_by(Author.id)).all()


@router.get("/{author_id}", response_model=AuthorWithPosts)
def read_author(author_id: int, session: SessionDep):
    author = session.get(Author, author_id)
    return author
```

```http tests
GET /authors
###
GET /authors/1
###
GET /authors/3
###
GET /authors/4
###
GET /authors/9
```

## task fa-n1-authors
```json
{
  "type": "fix-bug",
  "title": "Лишние запросы в списке авторов",
  "xp": 20,
  "hints": [
    "Раздел «Ленивая загрузка и N+1»: заголовок `X-Query-Count` показывает, сколько SQL-запросов выполнил обработчик.",
    "Список авторов вкладывает посты каждого автора, а посты подгружаются лениво: на каждого автора отдельный запрос. Загрузчик из раздела «selectinload и joinedload» подходит для связей-списков.",
    "Шаблон: `stmt = select(Author).options(selectinload(Author.posts)).order_by(Author.id)`, не забудьте импорт `from sqlalchemy.orm import selectinload`."
  ],
  "packages": [
    "db"
  ],
  "readonly": [
    "db.py",
    "models.py",
    "schemas.py",
    "main.py"
  ],
  "check": {
    "headers": [
      "x-query-count"
    ]
  },
  "wrong": {
    "joined": "joinedload с unique() делает один запрос вместо двух: ответ тот же, но число запросов не совпадает с эталонным"
  }
}
```

Блог отдаёт список авторов с их постами: `GET /authors`. Данные верные, но обработчик делает слишком много запросов: каждому ответу сервер добавляет заголовок `X-Query-Count` с числом SQL-запросов (его ставят только ответам на `GET`) и для четырёх авторов он равен `5` (один запрос за авторов и по запросу за постами каждого). Исправьте `routers/authors.py` так, чтобы запросов было ровно два: один за авторами и один за всеми их постами. Содержимое ответа менять нельзя.

В базе четыре автора: Ann (три поста), Bob (два), Cy (без постов), Dee (один). Маршрут `GET /authors/{author_id}` не трогайте. Проверка сравнивает с эталоном тело и заголовок: у `GET /authors` он должен быть `2`, у `GET /authors/3` — `2` (в эталоне этот маршрут не менялся).

```python starter path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
QUERIES = {"count": 0}


@event.listens_for(engine, "before_cursor_execute")
def count_query(conn, cursor, statement, parameters, context, executemany):
    QUERIES["count"] += 1


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    import models  # noqa: F401

    Base.metadata.create_all(engine)


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python starter path=models.py
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    posts: Mapped[list["Post"]] = relationship(back_populates="author", order_by="Post.id")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id"))
    author: Mapped["Author"] = relationship(back_populates="posts")
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class PostIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


class AuthorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class AuthorWithPosts(AuthorOut):
    posts: list[PostOut]


class PostWithAuthor(PostOut):
    author: AuthorOut
```

```python starter path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from db import QUERIES, SessionLocal, init_db
from models import Author, Post
from routers import authors


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Author(name="Ann", posts=[Post(title="Intro to SQL"), Post(title="Sessions"), Post(title="Indexes")]),
                Author(name="Bob", posts=[Post(title="Caching"), Post(title="Queues")]),
                Author(name="Cy"),
                Author(name="Dee", posts=[Post(title="Testing")]),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)


@app.middleware("http")
async def add_query_count(request: Request, call_next):
    QUERIES["count"] = 0
    response = await call_next(request)
    if request.method == "GET":
        response.headers["X-Query-Count"] = str(QUERIES["count"])
    return response


app.include_router(authors.router)
```

```python starter path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Author
from schemas import AuthorOut, AuthorWithPosts

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("", response_model=list[AuthorWithPosts])
def list_authors(session: SessionDep):
    return session.scalars(select(Author).order_by(Author.id)).all()


@router.get("/{author_id}", response_model=AuthorWithPosts)
def read_author(author_id: int, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author
```

```python solution path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
QUERIES = {"count": 0}


@event.listens_for(engine, "before_cursor_execute")
def count_query(conn, cursor, statement, parameters, context, executemany):
    QUERIES["count"] += 1


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    import models  # noqa: F401

    Base.metadata.create_all(engine)


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python solution path=models.py
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    posts: Mapped[list["Post"]] = relationship(back_populates="author", order_by="Post.id")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id"))
    author: Mapped["Author"] = relationship(back_populates="posts")
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class PostIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


class AuthorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class AuthorWithPosts(AuthorOut):
    posts: list[PostOut]


class PostWithAuthor(PostOut):
    author: AuthorOut
```

```python solution path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from db import QUERIES, SessionLocal, init_db
from models import Author, Post
from routers import authors


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Author(name="Ann", posts=[Post(title="Intro to SQL"), Post(title="Sessions"), Post(title="Indexes")]),
                Author(name="Bob", posts=[Post(title="Caching"), Post(title="Queues")]),
                Author(name="Cy"),
                Author(name="Dee", posts=[Post(title="Testing")]),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)


@app.middleware("http")
async def add_query_count(request: Request, call_next):
    QUERIES["count"] = 0
    response = await call_next(request)
    if request.method == "GET":
        response.headers["X-Query-Count"] = str(QUERIES["count"])
    return response


app.include_router(authors.router)
```

```python solution path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from db import SessionDep
from models import Author
from schemas import AuthorOut, AuthorWithPosts

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("", response_model=list[AuthorWithPosts])
def list_authors(session: SessionDep):
    stmt = select(Author).options(selectinload(Author.posts)).order_by(Author.id)
    return session.scalars(stmt).all()


@router.get("/{author_id}", response_model=AuthorWithPosts)
def read_author(author_id: int, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author
```

```python wrong id=joined path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from db import SessionDep
from models import Author
from schemas import AuthorOut, AuthorWithPosts

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("", response_model=list[AuthorWithPosts])
def list_authors(session: SessionDep):
    stmt = select(Author).options(joinedload(Author.posts)).order_by(Author.id)
    return session.scalars(stmt).unique().all()


@router.get("/{author_id}", response_model=AuthorWithPosts)
def read_author(author_id: int, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author
```

```http tests
GET /authors
###
GET /authors/3
```

## task fa-rel-posts
```json
{
  "type": "fastapi",
  "title": "Посты с автором и новый пост",
  "xp": 20,
  "hints": [
    "Разделы «selectinload и joinedload» и «Создание дочернего объекта».",
    "Для связи «пост → автор» подходит `joinedload(Post.author)`: он делает один запрос с `JOIN`. В создании сначала найдите автора через `session.get` и ответьте `404`, если его нет.",
    "Шаблон: `select(Post).options(joinedload(Post.author)).order_by(Post.id)`; `post = Post(title=data.title, author=author)`; `session.add(post)`; `session.commit()`; `status_code=201`."
  ],
  "packages": [
    "db"
  ],
  "readonly": [
    "db.py",
    "models.py",
    "schemas.py",
    "main.py",
    "routers/authors.py"
  ],
  "check": {
    "headers": [
      "x-query-count"
    ]
  },
  "wrong": {
    "lazy": "список постов без загрузчика: ответ верный, но число запросов больше эталонного",
    "no-author-check": "пост создаётся для несуществующего автора: SQLite не проверяет внешний ключ, и ответ 201 вместо 404"
  }
}
```

В блоге те же четыре автора: Ann (три поста), Bob (два), Cy (без постов), Dee (один). Закрыты для правки все файлы, кроме `routers/posts.py`. В нём сейчас есть только `GET /posts`, который работает медленно. Доработайте файл:

- `GET /posts` — все посты по возрастанию `id`, у каждого вложен автор (`PostWithAuthor`: `id`, `title`, `author` с `id` и `name`). Запрос к базе должен быть один: заголовок `X-Query-Count` у ответа должен быть равен `1`;
- `POST /authors/{author_id}/posts` с телом `{"title": "..."}`: создаёт пост этого автора и отвечает `201` и `PostOut` (`id`, `title`); если автора нет, `404` и `{"detail": "Author not found"}`.

Заголовок `X-Query-Count` приложение ставит только на ответы `GET`, поэтому для `POST` число запросов не проверяется. Проверка сравнивает с эталоном тело ответа и заголовок: у `GET /posts` он должен быть `1`.

```python starter path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
QUERIES = {"count": 0}


@event.listens_for(engine, "before_cursor_execute")
def count_query(conn, cursor, statement, parameters, context, executemany):
    QUERIES["count"] += 1


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    import models  # noqa: F401

    Base.metadata.create_all(engine)


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python starter path=models.py
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    posts: Mapped[list["Post"]] = relationship(back_populates="author", order_by="Post.id")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id"))
    author: Mapped["Author"] = relationship(back_populates="posts")
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class PostIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


class AuthorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class AuthorWithPosts(AuthorOut):
    posts: list[PostOut]


class PostWithAuthor(PostOut):
    author: AuthorOut
```

```python starter path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from db import QUERIES, SessionLocal, init_db
from models import Author, Post
from routers import authors, posts


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Author(name="Ann", posts=[Post(title="Intro to SQL"), Post(title="Sessions"), Post(title="Indexes")]),
                Author(name="Bob", posts=[Post(title="Caching"), Post(title="Queues")]),
                Author(name="Cy"),
                Author(name="Dee", posts=[Post(title="Testing")]),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)


@app.middleware("http")
async def add_query_count(request: Request, call_next):
    QUERIES["count"] = 0
    response = await call_next(request)
    if request.method == "GET":
        response.headers["X-Query-Count"] = str(QUERIES["count"])
    return response


app.include_router(authors.router)
app.include_router(posts.router)
```

```python starter path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Author
from schemas import AuthorOut, AuthorWithPosts

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("", response_model=list[AuthorOut])
def list_authors(session: SessionDep):
    return session.scalars(select(Author).order_by(Author.id)).all()


@router.get("/{author_id}", response_model=AuthorWithPosts)
def read_author(author_id: int, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author
```

```python starter path=routers/posts.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Author, Post
from schemas import PostIn, PostOut, PostWithAuthor

router = APIRouter(tags=["posts"])


@router.get("/posts", response_model=list[PostWithAuthor])
def list_posts(session: SessionDep):
    return session.scalars(select(Post).order_by(Post.id)).all()
```

```python solution path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
QUERIES = {"count": 0}


@event.listens_for(engine, "before_cursor_execute")
def count_query(conn, cursor, statement, parameters, context, executemany):
    QUERIES["count"] += 1


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    import models  # noqa: F401

    Base.metadata.create_all(engine)


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python solution path=models.py
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    posts: Mapped[list["Post"]] = relationship(back_populates="author", order_by="Post.id")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id"))
    author: Mapped["Author"] = relationship(back_populates="posts")
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class PostIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


class AuthorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class AuthorWithPosts(AuthorOut):
    posts: list[PostOut]


class PostWithAuthor(PostOut):
    author: AuthorOut
```

```python solution path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from db import QUERIES, SessionLocal, init_db
from models import Author, Post
from routers import authors, posts


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Author(name="Ann", posts=[Post(title="Intro to SQL"), Post(title="Sessions"), Post(title="Indexes")]),
                Author(name="Bob", posts=[Post(title="Caching"), Post(title="Queues")]),
                Author(name="Cy"),
                Author(name="Dee", posts=[Post(title="Testing")]),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)


@app.middleware("http")
async def add_query_count(request: Request, call_next):
    QUERIES["count"] = 0
    response = await call_next(request)
    if request.method == "GET":
        response.headers["X-Query-Count"] = str(QUERIES["count"])
    return response


app.include_router(authors.router)
app.include_router(posts.router)
```

```python solution path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Author
from schemas import AuthorOut, AuthorWithPosts

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("", response_model=list[AuthorOut])
def list_authors(session: SessionDep):
    return session.scalars(select(Author).order_by(Author.id)).all()


@router.get("/{author_id}", response_model=AuthorWithPosts)
def read_author(author_id: int, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author
```

```python solution path=routers/posts.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from db import SessionDep
from models import Author, Post
from schemas import PostIn, PostOut, PostWithAuthor

router = APIRouter(tags=["posts"])


@router.get("/posts", response_model=list[PostWithAuthor])
def list_posts(session: SessionDep):
    stmt = select(Post).options(joinedload(Post.author)).order_by(Post.id)
    return session.scalars(stmt).all()


@router.post("/authors/{author_id}/posts", response_model=PostOut, status_code=201)
def create_post(author_id: int, data: PostIn, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    post = Post(title=data.title, author=author)
    session.add(post)
    session.commit()
    return post
```

```python wrong id=lazy path=routers/posts.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from db import SessionDep
from models import Author, Post
from schemas import PostIn, PostOut, PostWithAuthor

router = APIRouter(tags=["posts"])


@router.get("/posts", response_model=list[PostWithAuthor])
def list_posts(session: SessionDep):
    stmt = select(Post).order_by(Post.id)
    return session.scalars(stmt).all()


@router.post("/authors/{author_id}/posts", response_model=PostOut, status_code=201)
def create_post(author_id: int, data: PostIn, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    post = Post(title=data.title, author=author)
    session.add(post)
    session.commit()
    return post
```

```python wrong id=no-author-check path=routers/posts.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from db import SessionDep
from models import Author, Post
from schemas import PostIn, PostOut, PostWithAuthor

router = APIRouter(tags=["posts"])


@router.get("/posts", response_model=list[PostWithAuthor])
def list_posts(session: SessionDep):
    stmt = select(Post).options(joinedload(Post.author)).order_by(Post.id)
    return session.scalars(stmt).all()


@router.post("/authors/{author_id}/posts", response_model=PostOut, status_code=201)
def create_post(author_id: int, data: PostIn, session: SessionDep):
    post = Post(title=data.title, author_id=author_id)
    session.add(post)
    session.commit()
    return post
```

```http tests
GET /posts
###
POST /authors/3/posts
Content-Type: application/json

{"title": "Cy's first post"}
###
POST /authors/99/posts
Content-Type: application/json

{"title": "Ghost"}
###
POST /authors/1/posts
Content-Type: application/json

{"title": ""}
###
GET /posts
```

## task fa-rel-openapi
```json
{
  "type": "openapi",
  "title": "Документация вложенных ответов",
  "xp": 15,
  "hints": [
    "Раздел «Вложенные модели ответа»: модель из `response_model` попадает в `/openapi.json` как схема. Код `404` из `HTTPException` FastAPI сам не видит, его описывают в `responses` (мир 2).",
    "Каждому из четырёх маршрутов нужна модель ответа из `schemas.py`; у создания поста ещё `status_code=201`, а у чтения автора и создания поста `404` в `responses`.",
    "Шаблон: `@router.get(\"/{author_id}\", response_model=AuthorWithPosts, responses={404: {\"description\": \"…\"}})`; `@router.post(\"...\", response_model=PostOut, status_code=201, responses={404: {...}})`; для списков `response_model=list[AuthorOut]` и `list[PostWithAuthor]`."
  ],
  "packages": [
    "db"
  ],
  "readonly": [
    "db.py",
    "models.py",
    "schemas.py",
    "main.py"
  ],
  "check": {
    "compare": [
      "responses",
      "schemas"
    ]
  },
  "wrong": {
    "no-404-doc": "ответ 404 не описан в документации",
    "flat-author": "у автора в документации нет списка постов: для чтения автора указана модель без вложенных постов"
  }
}
```

В блоге уже работают четыре маршрута: `GET /authors`, `GET /authors/{author_id}`, `GET /posts` и `POST /authors/{author_id}/posts`. Но на `/openapi.json` у них нет моделей ответа: клиент не узнает ни формата ответа, ни того, что бывает `404`. Доработайте `routers/authors.py` и `routers/posts.py` (остальные файлы закрыты), не меняя поведения:

- `GET /authors` отдаёт список `AuthorOut`;
- `GET /authors/{author_id}` отдаёт `AuthorWithPosts` и документирует ответ `404`;
- `GET /posts` отдаёт список `PostWithAuthor`;
- `POST /authors/{author_id}/posts` отдаёт `PostOut` с кодом `201` и документирует ответ `404`.

Идея проверки: `/openapi.json` вашего проекта сравнивается с эталонным: набор маршрутов, описанные коды ответов и схемы (имена, поля, обязательные поля). Описание `404` может быть любым.

```python starter path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
QUERIES = {"count": 0}


@event.listens_for(engine, "before_cursor_execute")
def count_query(conn, cursor, statement, parameters, context, executemany):
    QUERIES["count"] += 1


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    import models  # noqa: F401

    Base.metadata.create_all(engine)


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python starter path=models.py
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    posts: Mapped[list["Post"]] = relationship(back_populates="author", order_by="Post.id")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id"))
    author: Mapped["Author"] = relationship(back_populates="posts")
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class PostIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


class AuthorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class AuthorWithPosts(AuthorOut):
    posts: list[PostOut]


class PostWithAuthor(PostOut):
    author: AuthorOut
```

```python starter path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from db import QUERIES, SessionLocal, init_db
from models import Author, Post
from routers import authors, posts


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Author(name="Ann", posts=[Post(title="Intro to SQL"), Post(title="Sessions"), Post(title="Indexes")]),
                Author(name="Bob", posts=[Post(title="Caching"), Post(title="Queues")]),
                Author(name="Cy"),
                Author(name="Dee", posts=[Post(title="Testing")]),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)


@app.middleware("http")
async def add_query_count(request: Request, call_next):
    QUERIES["count"] = 0
    response = await call_next(request)
    if request.method == "GET":
        response.headers["X-Query-Count"] = str(QUERIES["count"])
    return response


app.include_router(authors.router)
app.include_router(posts.router)
```

```python starter path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Author

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("")
def list_authors(session: SessionDep):
    return session.scalars(select(Author).order_by(Author.id)).all()


@router.get("/{author_id}")
def read_author(author_id: int, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author
```

```python starter path=routers/posts.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from db import SessionDep
from models import Author, Post
from schemas import PostIn

router = APIRouter(tags=["posts"])


@router.get("/posts")
def list_posts(session: SessionDep):
    stmt = select(Post).options(joinedload(Post.author)).order_by(Post.id)
    return session.scalars(stmt).all()


@router.post("/authors/{author_id}/posts")
def create_post(author_id: int, data: PostIn, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    post = Post(title=data.title, author=author)
    session.add(post)
    session.commit()
    return post
```

```python solution path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
QUERIES = {"count": 0}


@event.listens_for(engine, "before_cursor_execute")
def count_query(conn, cursor, statement, parameters, context, executemany):
    QUERIES["count"] += 1


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    import models  # noqa: F401

    Base.metadata.create_all(engine)


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

```python solution path=models.py
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    posts: Mapped[list["Post"]] = relationship(back_populates="author", order_by="Post.id")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    author_id: Mapped[int] = mapped_column(ForeignKey("authors.id"))
    author: Mapped["Author"] = relationship(back_populates="posts")
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class PostIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


class AuthorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class AuthorWithPosts(AuthorOut):
    posts: list[PostOut]


class PostWithAuthor(PostOut):
    author: AuthorOut
```

```python solution path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from db import QUERIES, SessionLocal, init_db
from models import Author, Post
from routers import authors, posts


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Author(name="Ann", posts=[Post(title="Intro to SQL"), Post(title="Sessions"), Post(title="Indexes")]),
                Author(name="Bob", posts=[Post(title="Caching"), Post(title="Queues")]),
                Author(name="Cy"),
                Author(name="Dee", posts=[Post(title="Testing")]),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)


@app.middleware("http")
async def add_query_count(request: Request, call_next):
    QUERIES["count"] = 0
    response = await call_next(request)
    if request.method == "GET":
        response.headers["X-Query-Count"] = str(QUERIES["count"])
    return response


app.include_router(authors.router)
app.include_router(posts.router)
```

```python solution path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Author
from schemas import AuthorOut, AuthorWithPosts

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("", response_model=list[AuthorOut])
def list_authors(session: SessionDep):
    return session.scalars(select(Author).order_by(Author.id)).all()


@router.get("/{author_id}", response_model=AuthorWithPosts, responses={404: {"description": "Author not found"}})
def read_author(author_id: int, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author
```

```python solution path=routers/posts.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from db import SessionDep
from models import Author, Post
from schemas import PostIn, PostOut, PostWithAuthor

router = APIRouter(tags=["posts"])


@router.get("/posts", response_model=list[PostWithAuthor])
def list_posts(session: SessionDep):
    stmt = select(Post).options(joinedload(Post.author)).order_by(Post.id)
    return session.scalars(stmt).all()


@router.post(
    "/authors/{author_id}/posts",
    response_model=PostOut,
    status_code=201,
    responses={404: {"description": "Author not found"}},
)
def create_post(author_id: int, data: PostIn, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    post = Post(title=data.title, author=author)
    session.add(post)
    session.commit()
    return post
```

```python wrong id=no-404-doc path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Author
from schemas import AuthorOut, AuthorWithPosts

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("", response_model=list[AuthorOut])
def list_authors(session: SessionDep):
    return session.scalars(select(Author).order_by(Author.id)).all()


@router.get("/{author_id}", response_model=AuthorWithPosts)
def read_author(author_id: int, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author
```

```python wrong id=flat-author path=routers/authors.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Author
from schemas import AuthorOut, AuthorWithPosts

router = APIRouter(prefix="/authors", tags=["authors"])


@router.get("", response_model=list[AuthorOut])
def list_authors(session: SessionDep):
    return session.scalars(select(Author).order_by(Author.id)).all()


@router.get("/{author_id}", response_model=AuthorOut, responses={404: {"description": "Author not found"}})
def read_author(author_id: int, session: SessionDep):
    author = session.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")
    return author
```
