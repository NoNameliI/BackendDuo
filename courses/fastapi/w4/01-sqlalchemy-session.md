# SQLAlchemy и сессия

Блог хранит записи в словаре Python, и после перезапуска сервера все посты пропадают. Нужна база данных. Писать SQL строками в каждом обработчике неудобно: легко ошибиться в имени столбца, а результат приходит кортежами. Поэтому между кодом и базой ставят **ORM** (object-relational mapping): таблица описывается классом, строка таблицы становится объектом этого класса, а SQL-запросы библиотека собирает сама. В этом уроке вы подключите SQLAlchemy 2.0 к FastAPI, опишете модель, получите сессию через зависимость и отдадите строки из базы как JSON.

### Зачем ORM и что в студии

ORM не отменяет SQL. Она снимает рутину: превращает `SELECT`-ы в списки объектов, следит за изменениями объектов и сама пишет `INSERT` и `UPDATE`. Как работают таблицы, ключи и запросы, объясняет курс PostgreSQL этой же платформы: он пригодится, когда вы начнёте читать SQL, который порождает библиотека.

В этом курсе используется **SQLAlchemy 2.0**: современный стиль с аннотациями типов (`Mapped[...]`) и запросами через `select()`. Старый стиль (`declarative_base()`, `session.query(...)`, столбцы без аннотаций) встречается в старых статьях, но для нового кода его не выбирают.

Два факта о студии и о настоящем проекте:

- В студии база — **SQLite в памяти**: она живёт в оперативной памяти и исчезает вместе с приложением. Каждый запуск проверки загружает ваше приложение заново, поэтому база начинается пустой, а начальные данные кладёт ваш код.
- В настоящем проекте почти всегда стоит **PostgreSQL**: серверная база с настоящими транзакциями и параллельной работой. От SQLite к PostgreSQL переходят заменой строки подключения и драйвера, а код моделей и запросов остаётся тем же. Про сам PostgreSQL читайте в курсе PostgreSQL.

В официальном учебнике FastAPI для баз данных используется **SQLModel**: надстройка над SQLAlchemy и pydantic, где один класс служит и таблицей, и моделью pydantic. В студии её нет, а чтобы понимать, как всё устроено внутри, полезно знать SQLAlchemy: SQLModel строится на ней, и запросы `select()`, сессии и связи работают так же.

Асинхронный вариант SQLAlchemy (`create_async_engine`, `AsyncSession`, `await session.execute(...)`) устроен так же, но в студии недоступен: для него нужна библиотека, которой здесь нет. Все примеры курса синхронные, обработчики пишутся обычным `def`: настоящий сервер запускает их в отдельном потоке, и блокирующий вызов к базе не останавливает остальные запросы. В студии потоков нет, `def` выполняется на месте, но код от этого не меняется.

### Модель таблицы

**Модель** — класс, наследник общего базового класса. Атрибуты класса описывают столбцы.

```python
class Base(DeclarativeBase):
    pass


class Таблица(Base):
    __tablename__ = "имя_таблицы"

    id: Mapped[int] = mapped_column(primary_key=True)
    поле: Mapped[str] = mapped_column(String(100))
    другое_поле: Mapped[int]
```

- `from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column` — три нужных имени.
- `class Base(DeclarativeBase): pass` — общий родитель всех моделей. Он хранит список таблиц (`Base.metadata`).
- `__tablename__` — имя таблицы в базе. Принято множественное число: `posts`, `books`.
- `Mapped[int]` — тип значения в Python. Если написать `Mapped[int]` без `| None`, столбец получает `NOT NULL`. Столбец, где допустим `NULL`, пишут `Mapped[str | None]`.
- `mapped_column(...)` — дополнительные свойства столбца. Если они не нужны, его можно не писать: `year: Mapped[int]` достаточно.
- `primary_key=True` — первичный ключ. Для целого ключа SQLite сама выдаёт номера 1, 2, 3 при вставке.
- `String(100)` — тип столбца с длиной (`from sqlalchemy import String`). Для `Mapped[str]` без указания длины тоже работает; длину задают, когда она важна.
- `default=True` — значение по умолчанию, которое подставит Python при вставке, если вы его не передали.
- `unique=True` — значения не должны повторяться; база отклонит дубликат.

Объект модели создают обычным вызовом: `Book(title="Dune", year=1965)`. Номер `id` у него появится после записи в базу.

### Engine и сессия

**Engine** — объект подключения к базе. Он создаётся один раз на приложение. **Сессия** — рабочая область: через неё читают и пишут объекты, а затем фиксируют изменения. Сессию создаёт фабрика `sessionmaker`.

```python
engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
```

- `create_engine("sqlite://")` — строка подключения. Пустое имя файла после `sqlite://` означает базу в памяти. Для PostgreSQL она выглядела бы так: `postgresql+psycopg://пользователь:пароль@хост/база`. Пароль из строки не пишут в код, а берут из настроек (урок про `pydantic-settings` в мире 3).
- `connect_args={"check_same_thread": False}` — SQLite по умолчанию запрещает пользоваться соединением из другого потока. FastAPI запускает обработчики `def` в потоках, поэтому запрет отключают.
- `poolclass=StaticPool` — у базы в памяти каждое соединение получает собственную пустую базу. `StaticPool` держит одно общее соединение, и все сессии видят одни и те же таблицы. С файловой базой или PostgreSQL этот параметр не нужен.
- `sessionmaker(engine, ...)` — фабрика сессий. Вызов `SessionLocal()` создаёт новую сессию.
- `expire_on_commit=False` — после `commit()` объекты остаются заполненными. По умолчанию SQLAlchemy помечает их «устаревшими» и при следующем обращении к полю делает ещё один запрос к базе; в обработчике, который отдаёт объект в ответ, это лишний запрос.

### Таблицы и начальные данные в lifespan

Таблицы создают при запуске приложения, когда подключение уже настроено. Для этого подходит **lifespan** из мира 3.

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all([Book(...), Book(...)])
        session.commit()
    yield
```

- `Base.metadata.create_all(engine)` — создаёт все таблицы описанных моделей, которых ещё нет. Существующие она не меняет: добавить столбец в готовую таблицу ею нельзя (об этом в последнем уроке мира).
- `with SessionLocal() as session:` — открывает сессию и закрывает её при выходе из блока.
- `session.add_all([...])` — ставит несколько объектов в очередь на запись. В базе их пока нет.
- `session.commit()` — записывает очередь в базу и фиксирует транзакцию. Без `commit()` данные не сохранятся: при закрытии сессия отменит изменения.

### Сессия как зависимость с yield

Каждому запросу нужна своя сессия, и после ответа она должна закрыться. Это работа для `yield`-зависимости из мира 3.

```python
def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```

- `with SessionLocal() as session` — открывает сессию; выход из `with` закрывает её, даже если обработчик поднял исключение (поэтому отдельный `try ... finally` не нужен).
- `yield session` — выдаёт сессию обработчику и ждёт конца запроса.
- `Annotated[Session, Depends(get_session)]` — псевдоним типа. В обработчике пишут `session: SessionDep`.

Одна глобальная сессия на всё приложение — частая ошибка: запросы мешают друг другу, а незавершённая транзакция одного запроса видна другим.

### Запросы на чтение

Запрос в стиле 2.0 строится функцией `select(Модель)` и выполняется сессией.

```python
session.scalars(select(Модель).order_by(Модель.поле)).all()
session.scalars(select(Модель).where(Модель.поле == значение)).first()
session.get(Модель, ключ)
```

- `select(Book)` — «выбрать все столбцы модели `Book`»; сам по себе запрос ничего не делает, это описание.
- `.where(условие)` — отбор строк. Условие пишут обычными операторами Python над столбцом: `Book.year > 1970`, `Book.title == "Dune"`. Для булева столбца достаточно `.where(Book.available)`; сравнение с переменной `Book.available == flag` тоже работает. Несколько `.where(...)` подряд соединяются через `AND`.
- `Book.title.contains("ne")` — условие «строка содержит подстроку»; в SQL это `LIKE '%ne%'`. Латинские буквы SQLite сравнивает без учёта регистра, PostgreSQL с учётом (там для этого есть `.ilike(...)`).
- `.order_by(Book.id)` — сортировка. Без неё порядок строк не гарантирован.
- `session.scalars(запрос)` — выполняет запрос и возвращает по одному объекту модели на строку (а не кортеж).
- `.all()` — собрать результат в список. `.first()` — первый объект или `None`, если ничего не найдено.
- `session.get(Book, 5)` — найти строку по первичному ключу. Возвращает объект или `None`.

Условие можно собирать по частям: запрос — обычный объект, и `stmt = stmt.where(...)` возвращает новый запрос с добавленным условием.

```python example
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    seats: Mapped[int]
    has_projector: Mapped[bool] = mapped_column(default=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Room(name="Alpha", seats=4),
                Room(name="Beta", seats=12, has_projector=True),
                Room(name="Gamma", seats=30, has_projector=True),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
app = FastAPI(lifespan=lifespan)


@app.get("/rooms")
def list_rooms(session: SessionDep, min_seats: int = 0, projector: bool | None = None):
    stmt = select(Room).where(Room.seats >= min_seats).order_by(Room.id)
    if projector is not None:
        stmt = stmt.where(Room.has_projector == projector)
    return [{"id": room.id, "name": room.name} for room in session.scalars(stmt).all()]
###
GET /rooms
###
GET /rooms?min_seats=10
###
GET /rooms?projector=true&min_seats=20
###
GET /rooms?projector=false
```

Ответы: все три комнаты `[{"id": 1, "name": "Alpha"}, {"id": 2, "name": "Beta"}, {"id": 3, "name": "Gamma"}]`; при `min_seats=10` — `Beta` и `Gamma`; при `projector=true&min_seats=20` — только `Gamma`; при `projector=false` — только `Alpha`. Условие по `projector` добавляется, только если параметр передан: это и есть сборка запроса по частям. Здесь обработчик возвращает обычные словари, собранные из объектов вручную; следующий раздел показывает, как отдавать объекты напрямую.

### Ответ: response_model и from_attributes

Обработчик возвращает объекты модели, а клиенту нужен JSON. Что именно попадёт в JSON, определяет **модель ответа** — обычная модель pydantic.

```python
class BookOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


@app.get("/books", response_model=list[BookOut])
def list_books(session: SessionDep):
    return session.scalars(select(Book)).all()


@app.get("/books/{book_id}", response_model=BookOut)
def read_book(book_id: int, session: SessionDep):
    book = session.get(Book, book_id)
    ...
    return BookOut.model_validate(book)
```

- `response_model=list[BookOut]` — модель ответа. FastAPI проверяет по ней возвращённое значение и оставляет только перечисленные поля. Столбец, которого в модели нет (например, внутренняя пометка), наружу не попадёт. Без `response_model` FastAPI отдаст все столбцы объекта.
- Для `response_model` FastAPI сам читает значения из атрибутов объектов SQLAlchemy, поэтому `return session.scalars(...).all()` работает без дополнительных настроек.
- `model_config = ConfigDict(from_attributes=True)` — разрешает собирать модель из объекта с атрибутами, а не только из словаря (подробнее — в уроке про `from_attributes` мира 2).
- `BookOut.model_validate(book)` — ручное превращение объекта в модель. Здесь `from_attributes` обязателен: без него вызов упадёт с ошибкой проверки, и клиент получит `500`.
- Модель ответа можно унаследовать от другой: `class BookDetail(BookOut): description: str` содержит все поля `BookOut` и добавляет свои, а `model_config` переходит по наследству.
- Включайте `from_attributes=True` во всех моделях ответа: тогда они работают и с `response_model`, и с `model_validate`.
- Вместо параметра `response_model=...` можно записать тип результата: `-> BookOut`. Правило то же, но возвращаемое значение должно подходить под этот тип.

Полный пример: модель, настройка, начальные данные, зависимость и три маршрута. Один маршрут собирает ответ через `model_validate`, последний показывает SQL, который строит библиотека.

```python example
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    year: Mapped[int]
    available: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all([Book(title="Solaris", year=1961), Book(title="Dune", year=1965), Book(title="Neuromancer", year=1984, available=False)])
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class BookOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    year: int
    available: bool


app = FastAPI(lifespan=lifespan)


@app.get("/books", response_model=list[BookOut])
def list_books(session: SessionDep):
    return session.scalars(select(Book).order_by(Book.id)).all()


@app.get("/books/{book_id}", response_model=BookOut)
def read_book(book_id: int, session: SessionDep):
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return BookOut.model_validate(book)


@app.get("/sql")
def show_sql():
    return {"sql": str(select(Book).where(Book.year > 1970).order_by(Book.title))}
###
GET /books
###
GET /books/2
###
GET /books/9
###
GET /sql
```

Ответы: `GET /books` вернул три книги по порядку `id`; `GET /books/2` — `{"id": 2, "title": "Dune", "year": 1965, "available": true}` (объект превращён в модель вызовом `model_validate`); `GET /books/9` — `404` и `{"detail": "Book not found"}`, потому что `session.get` вернул `None`. Маршрут `/sql` показывает запрос, который собрала библиотека:

```text
SELECT books.id, books.title, books.year, books.available
FROM books
WHERE books.year > :year_1 ORDER BY books.title
```

`:year_1` — параметр запроса: значение `1970` в SQL-текст не вставляется, а передаётся отдельно. Так библиотека защищает от SQL-инъекций; строить запросы склейкой строк самому не нужно.

### Чего избегать

- `declarative_base()`, `Column(Integer)`, `session.query(Book).filter(...)` — API версии 1.x. Он ещё работает, но современный код использует `DeclarativeBase`, `Mapped` и `select()`.
- `orm_mode = True` и `class Config` в моделях pydantic — вместо них `model_config = ConfigDict(from_attributes=True)`.
- Глобальная сессия, созданная один раз на модуль, и сессия без закрытия.
- Создание таблиц на уровне модуля (`Base.metadata.create_all(engine)` сразу после объявления моделей): приложение должно готовить базу при запуске, в lifespan.

### Частые ошибки

- Забыт `commit()`. Неверно: `session.add_all([...])` и выход из `with`. Верно: после `add_all` вызвать `session.commit()`. Сессия отменит всё, что не зафиксировано.
- Нет `from_attributes` при ручном превращении. Неверно: `class BookOut(BaseModel)` с полями и `BookOut.model_validate(book)`. Верно: `model_config = ConfigDict(from_attributes=True)`; иначе клиент получает `500`.
- Нет `response_model`. Неверно: вернуть объект из базы без модели ответа: клиент получит все столбцы, включая внутренние. Верно: указать `response_model` с нужными полями.
- База «пустая» при каждом обращении. Неверно: `create_engine("sqlite://")` без `StaticPool` в приложении с потоками: каждое соединение видит свою пустую базу, таблиц нет. Верно: `poolclass=StaticPool` и `check_same_thread=False`.
- Порядок строк не задан. Неверно: `select(Book)` без `order_by`. Верно: всегда сортируйте, иначе порядок может меняться.
- Ожидание готовых данных без lifespan. Таблицы и начальные данные создаёт ваш код при запуске; сами они не появятся.

### Шпаргалка

- Модель: `class Имя(Base): __tablename__ = "..."`, поля `Mapped[тип] = mapped_column(...)`; `Mapped[str | None]` — допускает `NULL`.
- `create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)`; боевая база — PostgreSQL.
- `sessionmaker(engine, expire_on_commit=False)`; сессия — `with SessionLocal() as session`.
- Таблицы и данные: в `lifespan` — `Base.metadata.create_all(engine)`, `add_all`, `commit`.
- Зависимость: `def get_session(): with SessionLocal() as s: yield s`; `SessionDep = Annotated[Session, Depends(get_session)]`.
- Чтение: `session.scalars(select(M).where(...).order_by(...)).all()`, `.first()`, `session.get(M, id)`.
- Ответ: `response_model=...` отбирает поля; `ConfigDict(from_attributes=True)` нужен для `Модель.model_validate(объект)`.
- Асинхронная SQLAlchemy в студии недоступна; пишите обработчики `def`.

## task fa-orm-posts
```json
{
  "type": "fastapi",
  "title": "Посты блога из базы",
  "xp": 10,
  "hints": [
    "Разделы «Модель таблицы», «Запросы на чтение» и «Ответ: response_model и from_attributes». Структура решения повторяет первый пример урока.",
    "Нужны: столбцы модели `Post`, модели ответа `PostOut` (с `from_attributes`) и `PostDetail`, маршрут списка с `response_model` и `order_by(Post.id)`, маршрут одного поста с `session.get`, `404` и `model_validate`.",
    "Шаблон: `id: Mapped[int] = mapped_column(primary_key=True)`; `@app.get(\"/posts\", response_model=list[PostOut])` и `session.scalars(select(Post).order_by(Post.id)).all()`; `post = session.get(Post, post_id)`, при `None` — `HTTPException(404, ...)`, иначе `PostDetail.model_validate(post)`."
  ],
  "packages": [
    "db"
  ],
  "wrong": {
    "no-attributes": "в модели ответа нет from_attributes, и ответ для одного поста завершается ошибкой 500",
    "no-response-model": "список без response_model отдаёт все столбцы, в том числе текст постов",
    "no-404": "для несуществующего поста приложение отвечает 200 и null вместо 404"
  }
}
```

Блог хранит посты в базе SQLite в памяти. Движок, фабрика сессий, зависимость `SessionDep` и начальные данные в lifespan уже написаны: в базе три поста, второй из них — черновик (`published=False`). Дополните `main.py`:

- модель `Post` (таблица `posts`): `id` — первичный ключ, `title` — строка до 120 символов, `body` — строка, `published` — булево со значением по умолчанию `True`;
- модель ответа `PostOut` с полями `id`, `title`, `published` и модель `PostDetail`: те же поля плюс `body`; обе должны уметь читать объекты базы;
- `GET /posts` — список всех постов (черновики тоже) по возрастанию `id`, в виде `PostOut`: текста поста в списке нет;
- `GET /posts/{post_id}` — один пост в виде `PostDetail`, собранный вызовом `model_validate`; если поста нет, `404` и `{"detail": "Post not found"}`.

Идея проверки: те же запросы уходят в ваше приложение и в эталонное, сравниваются коды и тела ответов.

```python starter path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    # столбцы: id (ключ), title (строка до 120 символов), body (строка), published (булево, по умолчанию True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Hello, blog", body="First entry"),
                Post(title="Draft about SQL", body="Not ready", published=False),
                Post(title="Why sessions matter", body="One session per request"),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    # поля списка: id, title, published
    pass


class PostDetail(PostOut):
    # к полям списка добавляется body
    pass


app = FastAPI(lifespan=lifespan)


# маршруты GET /posts и GET /posts/{post_id}
```

```python solution path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Hello, blog", body="First entry"),
                Post(title="Draft about SQL", body="Not ready", published=False),
                Post(title="Why sessions matter", body="One session per request"),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts", response_model=list[PostOut])
def list_posts(session: SessionDep):
    return session.scalars(select(Post).order_by(Post.id)).all()


@app.get("/posts/{post_id}", response_model=PostDetail)
def read_post(post_id: int, session: SessionDep):
    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return PostDetail.model_validate(post)
```

```python wrong id=no-attributes path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Hello, blog", body="First entry"),
                Post(title="Draft about SQL", body="Not ready", published=False),
                Post(title="Why sessions matter", body="One session per request"),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts", response_model=list[PostOut])
def list_posts(session: SessionDep):
    return session.scalars(select(Post).order_by(Post.id)).all()


@app.get("/posts/{post_id}", response_model=PostDetail)
def read_post(post_id: int, session: SessionDep):
    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return PostDetail.model_validate(post)
```

```python wrong id=no-response-model path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Hello, blog", body="First entry"),
                Post(title="Draft about SQL", body="Not ready", published=False),
                Post(title="Why sessions matter", body="One session per request"),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts")
def list_posts(session: SessionDep):
    return session.scalars(select(Post).order_by(Post.id)).all()


@app.get("/posts/{post_id}", response_model=PostDetail)
def read_post(post_id: int, session: SessionDep):
    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return PostDetail.model_validate(post)
```

```python wrong id=no-404 path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Hello, blog", body="First entry"),
                Post(title="Draft about SQL", body="Not ready", published=False),
                Post(title="Why sessions matter", body="One session per request"),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts", response_model=list[PostOut])
def list_posts(session: SessionDep):
    return session.scalars(select(Post).order_by(Post.id)).all()


@app.get("/posts/{post_id}", response_model=PostDetail)
def read_post(post_id: int, session: SessionDep):
    post = session.get(Post, post_id)
    return PostDetail.model_validate(post)
```

```http tests
GET /posts
###
GET /posts/2
###
GET /posts/3
###
GET /posts/99
```

## task fa-orm-filter
```json
{
  "type": "fastapi",
  "title": "Фильтры списка постов",
  "xp": 15,
  "hints": [
    "Раздел «Запросы на чтение»: запрос собирается по частям, `.where(...)` добавляют только для переданных параметров.",
    "Добавьте в обработчик необязательные параметры `published: bool | None = None` и `q: str | None = None`. Условие по `q` — `Post.title.contains(q)`, по `published` — сравнение столбца с переменной.",
    "Шаблон: `stmt = select(Post).order_by(Post.id)`; `if published is not None: stmt = stmt.where(Post.published == published)`; то же для `q` с `contains`; в конце `session.scalars(stmt).all()`."
  ],
  "packages": [
    "db"
  ],
  "wrong": {
    "only-q": "фильтр по published не работает: параметр принимается, но к запросу не добавляется",
    "exact-title": "поиск q сравнивает заголовок целиком, а не ищет подстроку"
  }
}
```

В блоге пять постов; модель, зависимость и `PostOut` готовы, а `GET /posts` пока возвращает все посты по возрастанию `id`. Добавьте в `GET /posts` два необязательных параметра запроса:

- `published` (`true` или `false`): если передан, вернуть только посты с таким значением `published`;
- `q`: если передан, вернуть только посты, в заголовке которых есть эта подстрока.

Параметры можно сочетать: оба условия действуют вместе. Если параметров нет, вернуть все посты. Порядок всегда по возрастанию `id`. Регистр букв учитывает база: SQLite сравнивает латинские буквы без учёта регистра, и результат эталона получен именно так.

```python starter path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Intro to SQL", body="Basics"),
                Post(title="Draft: sql joins", body="Not ready", published=False),
                Post(title="Sessions in FastAPI", body="One per request"),
                Post(title="More SQL tips", body="Indexes"),
                Post(title="Draft: caching", body="Later", published=False),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts", response_model=list[PostOut])
def list_posts(session: SessionDep):
    return session.scalars(select(Post).order_by(Post.id)).all()
```

```python solution path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Intro to SQL", body="Basics"),
                Post(title="Draft: sql joins", body="Not ready", published=False),
                Post(title="Sessions in FastAPI", body="One per request"),
                Post(title="More SQL tips", body="Indexes"),
                Post(title="Draft: caching", body="Later", published=False),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts", response_model=list[PostOut])
def list_posts(session: SessionDep, published: bool | None = None, q: str | None = None):
    stmt = select(Post).order_by(Post.id)
    if published is not None:
        stmt = stmt.where(Post.published == published)
    if q is not None:
        stmt = stmt.where(Post.title.contains(q))
    return session.scalars(stmt).all()
```

```python wrong id=only-q path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Intro to SQL", body="Basics"),
                Post(title="Draft: sql joins", body="Not ready", published=False),
                Post(title="Sessions in FastAPI", body="One per request"),
                Post(title="More SQL tips", body="Indexes"),
                Post(title="Draft: caching", body="Later", published=False),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts", response_model=list[PostOut])
def list_posts(session: SessionDep, published: bool | None = None, q: str | None = None):
    stmt = select(Post).order_by(Post.id)
    if q is not None:
        stmt = stmt.where(Post.title.contains(q))
    return session.scalars(stmt).all()
```

```python wrong id=exact-title path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Intro to SQL", body="Basics"),
                Post(title="Draft: sql joins", body="Not ready", published=False),
                Post(title="Sessions in FastAPI", body="One per request"),
                Post(title="More SQL tips", body="Indexes"),
                Post(title="Draft: caching", body="Later", published=False),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts", response_model=list[PostOut])
def list_posts(session: SessionDep, published: bool | None = None, q: str | None = None):
    stmt = select(Post).order_by(Post.id)
    if published is not None:
        stmt = stmt.where(Post.published == published)
    if q is not None:
        stmt = stmt.where(Post.title == q)
    return session.scalars(stmt).all()
```

```http tests
GET /posts
###
GET /posts?published=true
###
GET /posts?published=false
###
GET /posts?q=SQL
###
GET /posts?q=SQL&published=true
###
GET /posts?q=nothing
```

## task fa-orm-empty-blog
```json
{
  "type": "fix-bug",
  "title": "Блог без постов",
  "xp": 15,
  "hints": [
    "Запустите проверку и посмотрите, чем ответ отличается от ожидаемого. Разделы «Таблицы и начальные данные в lifespan» и «Ответ: response_model и from_attributes».",
    "Ошибок две. Первая: начальные данные не попадают в базу, и список пуст. Вторая проявится, когда данные появятся: ответ для одного поста (`GET /posts/{post_id}`) завершается ошибкой 500.",
    "Шаблон: после `session.add_all([...])` нужен вызов `session.commit()`; в `PostOut` нужна строка `model_config = ConfigDict(from_attributes=True)`."
  ],
  "packages": [
    "db"
  ],
  "wrong": {
    "only-commit": "начальные данные сохраняются, но модель ответа не читает объекты базы, и ответ для одного поста завершается ошибкой 500",
    "only-attributes": "модель ответа исправлена, но начальные данные не сохраняются, и список остаётся пустым"
  }
}
```

Блог при запуске кладёт в базу три поста, но `GET /posts` возвращает пустой список, а `GET /posts/1` — `404`. Должно быть: список из трёх постов по возрастанию `id`, `GET /posts/{post_id}` отдаёт пост, для несуществующего — `404` и `{"detail": "Post not found"}`.

Найдите и исправьте ошибки в `main.py`. Их две, и вторая видна только после исправления первой. Маршруты менять не нужно.

```python starter path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Hello, blog", body="First entry"),
                Post(title="Draft about SQL", body="Not ready", published=False),
                Post(title="Why sessions matter", body="One session per request"),
            ]
        )
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts", response_model=list[PostOut])
def list_posts(session: SessionDep):
    return session.scalars(select(Post).order_by(Post.id)).all()


@app.get("/posts/{post_id}", response_model=PostDetail)
def read_post(post_id: int, session: SessionDep):
    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return PostDetail.model_validate(post)
```

```python solution path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Hello, blog", body="First entry"),
                Post(title="Draft about SQL", body="Not ready", published=False),
                Post(title="Why sessions matter", body="One session per request"),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts", response_model=list[PostOut])
def list_posts(session: SessionDep):
    return session.scalars(select(Post).order_by(Post.id)).all()


@app.get("/posts/{post_id}", response_model=PostDetail)
def read_post(post_id: int, session: SessionDep):
    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return PostDetail.model_validate(post)
```

```python wrong id=only-commit path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Hello, blog", body="First entry"),
                Post(title="Draft about SQL", body="Not ready", published=False),
                Post(title="Why sessions matter", body="One session per request"),
            ]
        )
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts", response_model=list[PostOut])
def list_posts(session: SessionDep):
    return session.scalars(select(Post).order_by(Post.id)).all()


@app.get("/posts/{post_id}", response_model=PostDetail)
def read_post(post_id: int, session: SessionDep):
    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return PostDetail.model_validate(post)
```

```python wrong id=only-attributes path=main.py
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str]
    published: Mapped[bool] = mapped_column(default=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all(
            [
                Post(title="Hello, blog", body="First entry"),
                Post(title="Draft about SQL", body="Not ready", published=False),
                Post(title="Why sessions matter", body="One session per request"),
            ]
        )
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    published: bool


class PostDetail(PostOut):
    body: str


app = FastAPI(lifespan=lifespan)


@app.get("/posts", response_model=list[PostOut])
def list_posts(session: SessionDep):
    return session.scalars(select(Post).order_by(Post.id)).all()


@app.get("/posts/{post_id}", response_model=PostDetail)
def read_post(post_id: int, session: SessionDep):
    post = session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return PostDetail.model_validate(post)
```

```http tests
GET /posts
###
GET /posts/1
###
GET /posts/3
###
GET /posts/8
```

## task fa-orm-session-choice
```json
{
  "type": "choice",
  "title": "Зачем сессия в зависимости",
  "xp": 10,
  "hints": [
    "Раздел «Сессия как зависимость с yield».",
    "Подумайте, что произойдёт, если два запроса работают одновременно с одной сессией, и когда закрывается сессия в зависимости.",
    "Верных утверждений два: одно про отдельную сессию на запрос, другое про закрытие сессии после обработчика."
  ],
  "options": [
    "Каждый запрос получает собственную сессию, и запросы не мешают друг другу",
    "Сессия, созданная один раз на модуль, не работает: SQLAlchemy запрещает её повторное использование",
    "Выход из `with` после `yield` закрывает сессию и отменяет незафиксированные изменения, даже если обработчик поднял исключение",
    "Благодаря `yield` данные из базы сохраняются на диск и переживают перезапуск сервера"
  ],
  "answer": [
    0,
    2
  ],
  "explanation": "Зависимость вызывается на каждый запрос, поэтому у каждого запроса своя сессия с собственной транзакцией: недописанные изменения одного запроса не видны другому. Код после `yield` выполняется после обработчика, в том числе при ошибке, и `with` закрывает сессию. Глобальную сессию SQLAlchemy не запрещает, но она общая для всех запросов, и это источник трудноуловимых ошибок. А сохранность данных зависит не от `yield`, а от базы: в студии это SQLite в памяти, и данные исчезают при закрытии приложения."
}
```

Ниже зависимость, которая выдаёт сессию обработчикам. Выберите все верные утверждения о том, почему сессию открывают так.

```python
def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
```
