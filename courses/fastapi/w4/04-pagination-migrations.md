# Пагинация, фильтры и миграции

Через год в блоге десять тысяч постов, и `GET /posts` отдаёт их все: ответ весит мегабайты, а страница думает полминуты. Список надо отдавать порциями, а читателю дать способ перейти к следующей. Ещё вы добавляете в модель новый столбец — и на боевой базе, где уже лежат данные, он не появляется сам. Этот урок про оба вопроса: как нарезать результат и как менять устройство базы, не теряя данные.

### Порции: limit и offset

Самая простая пагинация — «пропустить столько-то строк и взять столько-то». В SQL это `LIMIT` и `OFFSET`.

```python
select(Модель).order_by(...).limit(сколько).offset(сколько_пропустить)
```

- `.limit(n)` — взять не больше `n` строк.
- `.offset(m)` — пропустить первые `m` строк результата.
- Клиент передаёт их параметрами запроса: `GET /tickets?limit=3&offset=6`. Страница номер `k` (с нуля) — это `offset = k * limit`.
- Параметры проверяют, чтобы клиент не мог запросить миллион строк: `limit: Annotated[int, Query(ge=1, le=10)] = 3`. `Query(ge=1, le=10)` из `fastapi` — границы значения (мир 1), `= 3` — значение по умолчанию. Для `offset` достаточно `ge=0`.
- Вместе с порцией принято отдавать **общее число** строк (`total`): по нему клиент рисует номера страниц. Его считает отдельный запрос с `func.count()`:

```python
total = session.scalar(select(func.count()).select_from(base.subquery()))
```

- `from sqlalchemy import func` — функции SQL (`count`, `sum`, `max`). `func.count()` — «сколько строк».
- `base.subquery()` — превращает запрос `base` во вложенную таблицу; `select_from(...)` говорит, что считать нужно строки именно её. Так число совпадает с тем, сколько строк вернул бы запрос без `limit`, и фильтры не приходится писать дважды.
- `session.scalar(запрос)` — выполняет запрос и возвращает одно значение (первый столбец первой строки), а не список.

**Сортировка обязательна и должна быть однозначной.** `LIMIT` без `ORDER BY` вернёт «любые» строки, а когда по ключу сортировки есть одинаковые значения, их порядок между запросами может отличаться: на границе страниц строка окажется то на одной, то на другой, или пропадёт. Поэтому в конец сортировки добавляют уникальный ключ, обычно `id`: `order_by(Ticket.priority.desc(), Ticket.id)`. `.desc()` — сортировка по убыванию.

**Фильтры** работают вместе с пагинацией: условие `.where(...)` задаёт, какие строки вообще участвуют, а `total` считается по отфильтрованным.

```python example
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    subject: Mapped[str] = mapped_column(String(80))
    priority: Mapped[int]


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    subject: str
    priority: int


class TicketPage(BaseModel):
    items: list[TicketOut]
    total: int
    limit: int
    offset: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        priorities = [2, 3, 2, 1, 3, 2, 1]
        session.add_all([Ticket(subject=f"Ticket {number}", priority=p) for number, p in enumerate(priorities, start=1)])
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
app = FastAPI(lifespan=lifespan)


@app.get("/tickets", response_model=TicketPage)
def list_tickets(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=10)] = 3,
    offset: Annotated[int, Query(ge=0)] = 0,
    min_priority: int = 1,
):
    base = select(Ticket).where(Ticket.priority >= min_priority)
    total = session.scalar(select(func.count()).select_from(base.subquery()))
    items = session.scalars(base.order_by(Ticket.priority.desc(), Ticket.id).limit(limit).offset(offset)).all()
    return {"items": items, "total": total, "limit": limit, "offset": offset}
###
GET /tickets
###
GET /tickets?offset=3
###
GET /tickets?min_priority=2&limit=2&offset=2
###
GET /tickets?limit=0
```

Семь тикетов с приоритетами `2, 3, 2, 1, 3, 2, 1`. Порядок: приоритет по убыванию, внутри приоритета по `id`. Первая страница даёт тикеты `2`, `5`, `1` (приоритеты `3, 3, 2`), `total` равен `7`. С `offset=3` — тикеты `3`, `6`, `4`. При `min_priority=2` отбираются пять тикетов (`total` равен `5`), и `limit=2&offset=2` даёт тикеты `1` и `3`: третий и четвёртый в отфильтрованном порядке. Запрос с `limit=0` отклонён как `422`: проверка `ge=1` сработала.

### Слабые места offset

Пагинация через `offset` понятна, но у неё два недостатка:

- Чем больше `offset`, тем дольше запрос: база всё равно должна дойти до нужной строки и отбросить предыдущие.
- Если между запросами в начало списка добавили строку, всё сдвигается: последняя строка прошлой страницы окажется первой на следующей (повтор), а при удалении строка пропадёт.

Для лент, которые листают подряд и где записи добавляются (сообщения, события), используют **курсорную пагинацию**.

### Курсорная пагинация

Вместо «пропусти m строк» клиент говорит «дай записи после той, которую я видел последней». Эту запись (чаще её `id`) называют **курсором**.

```python
stmt = select(Message).order_by(Message.id.desc()).limit(limit + 1)
if after is not None:
    stmt = stmt.where(Message.id < after)
rows = session.scalars(stmt).all()
items = rows[:limit]
next_cursor = items[-1].id if len(rows) > limit else None
```

- Лента идёт от новых к старым (`id` по убыванию), поэтому «после курсора» значит `Message.id < after`. Условие по ключу база выполняет по индексу, а не перебором, и результат не сдвигается при добавлении новых записей.
- `.limit(limit + 1)` — запрашивают на одну строку больше, чем нужно. Если пришло больше `limit`, значит, есть следующая страница; лишняя строка в ответ не идёт.
- `rows[:limit]` — первые `limit` строк списка (срез Python).
- `next_cursor` — `id` последнего элемента страницы, если следующая страница есть, иначе `None` (в JSON `null`). Клиент подставляет его в `after`.
- Сортировка по ключу курсора обязательна. Если нужна сортировка по другому полю, курсор составляют из него и `id`: условие становится сложнее, и в этом уроке такой вариант не разбирается.

```python example
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str] = mapped_column(String(80))


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    text: str


class MessageFeed(BaseModel):
    items: list[MessageOut]
    next_cursor: int | None


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        session.add_all([Message(text=f"Message {number}") for number in range(1, 8)])
        session.commit()
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
app = FastAPI(lifespan=lifespan)


@app.get("/messages", response_model=MessageFeed)
def list_messages(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=10)] = 3,
    after: int | None = None,
):
    stmt = select(Message).order_by(Message.id.desc()).limit(limit + 1)
    if after is not None:
        stmt = stmt.where(Message.id < after)
    rows = session.scalars(stmt).all()
    items = rows[:limit]
    next_cursor = items[-1].id if len(rows) > limit else None
    return {"items": items, "next_cursor": next_cursor}
###
GET /messages
###
GET /messages?after=5
###
GET /messages?after=2
```

Семь сообщений. Первая страница — сообщения `7`, `6`, `5` и `next_cursor` равный `5`. Запрос с `after=5` даёт `4`, `3`, `2` и курсор `2`. Запрос с `after=2` даёт одно сообщение `1`, а `next_cursor` равен `null`: лента закончилась.

Недостаток курсора: на страницу с номером `k` нельзя перейти напрямую, только листая подряд. Поэтому выбирают по задаче: номера страниц нужны в каталоге и админке (`offset`), бесконечная лента — это курсор.

### Миграции: зачем нужен Alembic

Вы добавили в модель `Post` столбец `views`. `Base.metadata.create_all(engine)` создаёт только **отсутствующие таблицы**. Если таблица `posts` уже есть, `create_all` её не трогает: столбец не появится, а запросы начнут падать с ошибкой «no such column» (в PostgreSQL — «column does not exist»). В студии база каждый раз новая, и эта проблема не видна, но на сервере с настоящими данными она появляется сразу.

**Миграция** — файл с инструкцией, как перевести схему базы из одного состояния в другое, и обратно. Миграции лежат в репозитории, применяются по порядку и дают:

- историю изменений схемы вместе с кодом;
- один и тот же результат на ноутбуке, на тестовом и боевом серверах;
- откат при неудаче.

`create_all` этого не даёт: он не знает истории, не меняет существующие таблицы и не умеет откатывать. Для учебных примеров и тестов он годится, для живой базы нет.

Стандартный инструмент для SQLAlchemy — **Alembic**. В студии запустить его нельзя: в ней нет командной строки и установки пакетов, а база живёт в памяти. Ниже — как он работает в обычном проекте, команды выполняются в терминале из папки проекта.

```sh
pip install alembic
alembic init migrations
```

Команда создаёт файл `alembic.ini` (в нём `sqlalchemy.url` — адрес базы) и папку `migrations/` с настройкой `env.py` и пустой папкой `versions/`. В `env.py` указывают модели, чтобы Alembic мог сравнить их с базой:

```python
# migrations/env.py
from db import Base
import models  # noqa: F401

target_metadata = Base.metadata
```

- `target_metadata = Base.metadata` — описание таблиц по вашим моделям; импорт `models` нужен, чтобы они были выполнены и попали в `Base.metadata` (как и для `create_all`).

Дальше цикл работы такой:

```sh
alembic revision --autogenerate -m "add posts.views"
alembic upgrade head
alembic current
alembic downgrade -1
alembic history
```

- `alembic revision --autogenerate -m "текст"` — Alembic сравнивает модели с реальной базой и создаёт файл миграции в `migrations/versions/` с описанием разницы. `-m` — короткое описание.
- `alembic upgrade head` — применить все ещё не применённые миграции до последней (`head`).
- `alembic current` — какая миграция применена к этой базе сейчас.
- `alembic downgrade -1` — откатить последнюю миграцию.
- `alembic history` — список всех миграций по порядку.

Созданный файл выглядит так:

```python
# migrations/versions/3f2a1b9c_add_posts_views.py
"""add posts.views"""
import sqlalchemy as sa
from alembic import op

revision = "3f2a1b9c"
down_revision = "a81c0d44"


def upgrade() -> None:
    op.add_column("posts", sa.Column("views", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("posts", "views")
```

- `revision` — номер этой миграции, `down_revision` — номер предыдущей: так миграции выстраиваются в цепочку.
- `upgrade()` — что сделать при `upgrade`; `downgrade()` — как вернуть всё назад. Обе функции обязаны быть написаны: пустой `downgrade` означает, что откатить нельзя.
- `server_default="0"` — значение по умолчанию на стороне базы. В таблице `posts` уже есть строки, и столбцу `NOT NULL` без значения по умолчанию их нечем заполнить: миграция упадёт.

Правила работы с миграциями:

- Созданный `--autogenerate` файл **читают и проверяют**. Он не умеет угадывать намерение: переименование столбца для него — «удалить старый и добавить новый», и данные пропадут. Не замечаются и некоторые другие изменения (переименование таблицы, часть ограничений), так что итог всегда проверяют вручную.
- Применённую миграцию не правят. Нужно изменение — создают новую.
- Миграции применяют отдельной командой при выкладке, а не при каждом запуске приложения.
- SQLite плохо переносит `ALTER TABLE`: для неё Alembic предлагает пакетный режим `op.batch_alter_table`. В PostgreSQL он не нужен.

### Частые ошибки

- `offset` без сортировки. Неверно: `select(Post).limit(10).offset(20)`. Верно: добавить `order_by` и в конец уникальный ключ.
- Сортировка не однозначна. Неверно: `order_by(Post.views.desc())`, когда у многих постов одинаковое число просмотров. Верно: `order_by(Post.views.desc(), Post.id)`.
- `total` считается по всей таблице при фильтре. Неверно: `select(func.count()).select_from(Post)` для запроса с `where`. Верно: считать по тому же запросу через `.subquery()`.
- `limit` без верхней границы. Неверно: `limit: int = 10`. Верно: `Annotated[int, Query(ge=1, le=100)] = 10`.
- Курсор без лишней строки. Неверно: всегда отдавать `next_cursor` как `id` последней строки: на последней странице клиент получит ещё один пустой запрос. Верно: брать `limit + 1` и отдавать курсор только когда есть что листать.
- `create_all` вместо миграции. Неверно: добавить столбец в модель и перезапустить приложение. Верно: `alembic revision --autogenerate`, проверить файл, `alembic upgrade head`.
- `NOT NULL` без значения по умолчанию на таблице с данными. Неверно: `nullable=False` без `server_default`. Верно: добавить значение по умолчанию (или сначала разрешить `NULL`, заполнить данные, потом запретить).

### Шпаргалка

- `.order_by(поле.desc(), Модель.id).limit(n).offset(m)`; страница `k` — `offset = k * limit`.
- Границы: `Annotated[int, Query(ge=1, le=100)] = 10`, `Annotated[int, Query(ge=0)] = 0`.
- Общее число: `session.scalar(select(func.count()).select_from(stmt.subquery()))`.
- Фильтры добавляются `.where(...)` до подсчёта и до `limit`.
- Курсор: `order_by(id.desc())`, `.where(id < after)`, `limit + 1`, `next_cursor = items[-1].id` только если строк больше `limit`.
- `create_all` не меняет существующие таблицы. Миграции: `alembic revision --autogenerate -m "..."`, проверить файл, `alembic upgrade head`; откат `alembic downgrade -1`; состояние `alembic current`.
- В миграции: `upgrade()` и `downgrade()` обе заполнены; для `NOT NULL` на заполненной таблице нужен `server_default`.
- Alembic в студии запустить нельзя; здесь он разобран по тексту и заданиями на выбор.

## task fa-page-offset
```json
{
  "type": "fastapi",
  "title": "Страницы списка постов",
  "xp": 20,
  "hints": [
    "Раздел «Порции: limit и offset»: границы параметров, `func.count()`, однозначная сортировка.",
    "Нужны параметры `limit` (1–20, по умолчанию 5), `offset` (от 0) и `q`. Сортировка: просмотры по убыванию, затем `id`. Общее число считается по запросу с фильтром, но без `limit`.",
    "Шаблон: `base = select(Post)`; при `q` — `base = base.where(Post.title.contains(q))`; `total = session.scalar(select(func.count()).select_from(base.subquery()))`; `base.order_by(Post.views.desc(), Post.id).limit(limit).offset(offset)`."
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
  "wrong": {
    "total-page": "total равен числу постов на странице, а не числу всех подходящих постов",
    "by-id": "посты отсортированы по номеру, а не по числу просмотров",
    "no-validation": "границы limit и offset не проверяются: недопустимые значения проходят, вместо ответа 422"
  }
}
```

Список постов блога пора резать на страницы. Проект готов, закрыты все файлы, кроме `routers/posts.py`. В базе двенадцать постов с номерами от 1 до 12 (поля `id`, `title`, `views` — число просмотров); среди них есть посты с одинаковым числом просмотров.

Реализуйте `GET /posts`. Параметры запроса:

- `limit` — размер страницы: целое от 1 до 20, по умолчанию 5;
- `offset` — сколько постов пропустить: целое не меньше 0, по умолчанию 0;
- `q` — необязательная подстрока заголовка: если передана, в расчёт идут только посты, у которых она есть в `title`.

Порядок: больше просмотров раньше, при равенстве просмотров — меньший `id` раньше. Ответ (`PostPage`): `{"items": [посты страницы], "total": число всех подходящих постов (с учётом `q`), "limit": ..., "offset": ...}`. Недопустимые значения `limit` и `offset` дают `422`.

Идея проверки: ваши страницы сравниваются с эталонными целиком, поэтому порядок постов с одинаковыми просмотрами важен.

```python starter path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


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
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    views: Mapped[int]
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    views: int


class PostPage(BaseModel):
    items: list[PostOut]
    total: int
    limit: int
    offset: int


class PostFeed(BaseModel):
    items: list[PostOut]
    next_cursor: int | None
```

```python starter path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionLocal, init_db
from models import Post
from routers import posts

SEED = [
    ("SQL basics", 50),
    ("Sessions in depth", 30),
    ("SQL joins", 50),
    ("Caching tips", 10),
    ("Async myths", 30),
    ("SQL indexes", 50),
    ("Queues intro", 20),
    ("Testing habits", 20),
    ("Deploy checklist", 40),
    ("Logging basics", 10),
    ("SQL transactions", 30),
    ("Release notes", 60),
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all([Post(title=title, views=views) for title, views in SEED])
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)
app.include_router(posts.router)
```

```python starter path=routers/posts.py
from fastapi import APIRouter
from sqlalchemy import select

from db import SessionDep
from models import Post
from schemas import PostPage

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("", response_model=PostPage)
def list_posts(session: SessionDep):
    items = session.scalars(select(Post).order_by(Post.id)).all()
    return {"items": items, "total": len(items), "limit": 5, "offset": 0}
```

```python solution path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


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
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    views: Mapped[int]
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    views: int


class PostPage(BaseModel):
    items: list[PostOut]
    total: int
    limit: int
    offset: int


class PostFeed(BaseModel):
    items: list[PostOut]
    next_cursor: int | None
```

```python solution path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionLocal, init_db
from models import Post
from routers import posts

SEED = [
    ("SQL basics", 50),
    ("Sessions in depth", 30),
    ("SQL joins", 50),
    ("Caching tips", 10),
    ("Async myths", 30),
    ("SQL indexes", 50),
    ("Queues intro", 20),
    ("Testing habits", 20),
    ("Deploy checklist", 40),
    ("Logging basics", 10),
    ("SQL transactions", 30),
    ("Release notes", 60),
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all([Post(title=title, views=views) for title, views in SEED])
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)
app.include_router(posts.router)
```

```python solution path=routers/posts.py
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from db import SessionDep
from models import Post
from schemas import PostPage

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("", response_model=PostPage)
def list_posts(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=20)] = 5,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: str | None = None,
):
    base = select(Post)
    if q is not None:
        base = base.where(Post.title.contains(q))
    total = session.scalar(select(func.count()).select_from(base.subquery()))
    stmt = base.order_by(Post.views.desc(), Post.id).limit(limit).offset(offset)
    return {"items": session.scalars(stmt).all(), "total": total, "limit": limit, "offset": offset}
```

```python wrong id=total-page path=routers/posts.py
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from db import SessionDep
from models import Post
from schemas import PostPage

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("", response_model=PostPage)
def list_posts(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=20)] = 5,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: str | None = None,
):
    base = select(Post)
    if q is not None:
        base = base.where(Post.title.contains(q))
    total = len(session.scalars(base.order_by(Post.views.desc(), Post.id).limit(limit).offset(offset)).all())
    stmt = base.order_by(Post.views.desc(), Post.id).limit(limit).offset(offset)
    return {"items": session.scalars(stmt).all(), "total": total, "limit": limit, "offset": offset}
```

```python wrong id=by-id path=routers/posts.py
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from db import SessionDep
from models import Post
from schemas import PostPage

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("", response_model=PostPage)
def list_posts(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=20)] = 5,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: str | None = None,
):
    base = select(Post)
    if q is not None:
        base = base.where(Post.title.contains(q))
    total = session.scalar(select(func.count()).select_from(base.subquery()))
    stmt = base.order_by(Post.id).limit(limit).offset(offset)
    return {"items": session.scalars(stmt).all(), "total": total, "limit": limit, "offset": offset}
```

```python wrong id=no-validation path=routers/posts.py
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from db import SessionDep
from models import Post
from schemas import PostPage

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("", response_model=PostPage)
def list_posts(
    session: SessionDep,
    limit: int = 5,
    offset: int = 0,
    q: str | None = None,
):
    base = select(Post)
    if q is not None:
        base = base.where(Post.title.contains(q))
    total = session.scalar(select(func.count()).select_from(base.subquery()))
    stmt = base.order_by(Post.views.desc(), Post.id).limit(limit).offset(offset)
    return {"items": session.scalars(stmt).all(), "total": total, "limit": limit, "offset": offset}
```

```http tests
GET /posts
###
GET /posts?limit=3&offset=3
###
GET /posts?limit=5&offset=10
###
GET /posts?q=SQL
###
GET /posts?q=SQL&limit=2&offset=2
###
GET /posts?limit=0
###
GET /posts?limit=50
###
GET /posts?offset=-1
###
GET /posts?offset=100
```

## task fa-page-cursor
```json
{
  "type": "fastapi",
  "title": "Лента с курсором",
  "xp": 20,
  "hints": [
    "Раздел «Курсорная пагинация»: запрашивайте на одну строку больше, чем нужно, и условием по `id` отсекайте уже виденное.",
    "Лента идёт от новых постов к старым (`id` по убыванию). Курсор `after` означает «посты с `id` меньше этого». Следующий курсор — `id` последнего поста страницы, но только если есть ещё посты.",
    "Шаблон: `stmt = select(Post).order_by(Post.id.desc()).limit(limit + 1)`; при `after` — `.where(Post.id < after)`; `rows = ...all()`; `items = rows[:limit]`; `next_cursor = items[-1].id if len(rows) > limit else None`."
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
  "wrong": {
    "always-cursor": "курсор отдаётся всегда, даже на последней странице: клиент делает лишний пустой запрос",
    "inclusive": "условие включает сам курсор: последний пост страницы повторяется в начале следующей"
  }
}
```

Для ленты постов нужна курсорная пагинация. Проект готов, закрыты все файлы, кроме `routers/posts.py`. В базе двенадцать постов с номерами от 1 до 12 (поля `id`, `title`, `views` — число просмотров); среди них есть посты с одинаковым числом просмотров.

Реализуйте `GET /posts/feed`. Параметры запроса:

- `limit` — размер страницы: целое от 1 до 20, по умолчанию 4;
- `after` — необязательный курсор, целое: если передан, лента начинается с постов, у которых `id` меньше `after`.

Посты идут от больших `id` к меньшим. Ответ (`PostFeed`): `{"items": [посты страницы], "next_cursor": ...}`. `next_cursor` — `id` последнего поста страницы, если за страницей есть ещё посты, иначе `null`. Если страница ровно последняя (дальше постов нет), `next_cursor` тоже `null`. Недопустимый `limit` даёт `422`.

```python starter path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


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
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    views: Mapped[int]
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    views: int


class PostPage(BaseModel):
    items: list[PostOut]
    total: int
    limit: int
    offset: int


class PostFeed(BaseModel):
    items: list[PostOut]
    next_cursor: int | None
```

```python starter path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionLocal, init_db
from models import Post
from routers import posts

SEED = [
    ("SQL basics", 50),
    ("Sessions in depth", 30),
    ("SQL joins", 50),
    ("Caching tips", 10),
    ("Async myths", 30),
    ("SQL indexes", 50),
    ("Queues intro", 20),
    ("Testing habits", 20),
    ("Deploy checklist", 40),
    ("Logging basics", 10),
    ("SQL transactions", 30),
    ("Release notes", 60),
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all([Post(title=title, views=views) for title, views in SEED])
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)
app.include_router(posts.router)
```

```python starter path=routers/posts.py
from fastapi import APIRouter
from sqlalchemy import select

from db import SessionDep
from models import Post
from schemas import PostFeed

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("/feed", response_model=PostFeed)
def read_feed(session: SessionDep):
    items = session.scalars(select(Post).order_by(Post.id.desc())).all()
    return {"items": items, "next_cursor": None}
```

```python solution path=db.py
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


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
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    views: Mapped[int]
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    views: int


class PostPage(BaseModel):
    items: list[PostOut]
    total: int
    limit: int
    offset: int


class PostFeed(BaseModel):
    items: list[PostOut]
    next_cursor: int | None
```

```python solution path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionLocal, init_db
from models import Post
from routers import posts

SEED = [
    ("SQL basics", 50),
    ("Sessions in depth", 30),
    ("SQL joins", 50),
    ("Caching tips", 10),
    ("Async myths", 30),
    ("SQL indexes", 50),
    ("Queues intro", 20),
    ("Testing habits", 20),
    ("Deploy checklist", 40),
    ("Logging basics", 10),
    ("SQL transactions", 30),
    ("Release notes", 60),
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all([Post(title=title, views=views) for title, views in SEED])
        session.commit()
    yield


app = FastAPI(title="Blog", lifespan=lifespan)
app.include_router(posts.router)
```

```python solution path=routers/posts.py
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from db import SessionDep
from models import Post
from schemas import PostFeed

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("/feed", response_model=PostFeed)
def read_feed(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=20)] = 4,
    after: int | None = None,
):
    stmt = select(Post).order_by(Post.id.desc()).limit(limit + 1)
    if after is not None:
        stmt = stmt.where(Post.id < after)
    rows = session.scalars(stmt).all()
    items = rows[:limit]
    next_cursor = items[-1].id if len(rows) > limit else None
    return {"items": items, "next_cursor": next_cursor}
```

```python wrong id=always-cursor path=routers/posts.py
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from db import SessionDep
from models import Post
from schemas import PostFeed

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("/feed", response_model=PostFeed)
def read_feed(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=20)] = 4,
    after: int | None = None,
):
    stmt = select(Post).order_by(Post.id.desc()).limit(limit + 1)
    if after is not None:
        stmt = stmt.where(Post.id < after)
    rows = session.scalars(stmt).all()
    items = rows[:limit]
    next_cursor = items[-1].id if items else None
    return {"items": items, "next_cursor": next_cursor}
```

```python wrong id=inclusive path=routers/posts.py
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from db import SessionDep
from models import Post
from schemas import PostFeed

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("/feed", response_model=PostFeed)
def read_feed(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=20)] = 4,
    after: int | None = None,
):
    stmt = select(Post).order_by(Post.id.desc()).limit(limit + 1)
    if after is not None:
        stmt = stmt.where(Post.id <= after)
    rows = session.scalars(stmt).all()
    items = rows[:limit]
    next_cursor = items[-1].id if len(rows) > limit else None
    return {"items": items, "next_cursor": next_cursor}
```

```http tests
GET /posts/feed
###
GET /posts/feed?after=9
###
GET /posts/feed?after=5
###
GET /posts/feed?after=1
###
GET /posts/feed?limit=5&after=7
###
GET /posts/feed?limit=12
###
GET /posts/feed?limit=0
###
GET /posts/feed?limit=21
###
GET /posts/feed?after=abc
```

## task fa-migration-review
```json
{
  "type": "review",
  "title": "Миграция столбца views",
  "xp": 15,
  "hints": [
    "Раздел «Миграции: зачем нужен Alembic»: что делает миграция с таблицей, в которой уже есть строки, и что значит пустой `downgrade`.",
    "В коде два дефекта: один в строке с `add_column`, другой в `downgrade`. Подумайте, чем заполнится новый столбец `NOT NULL` в существующих строках и что произойдёт при откате.",
    "Верные исправления: значение по умолчанию на стороне базы (`server_default`) и `op.drop_column` в `downgrade`."
  ],
  "lines": [
    2,
    5
  ],
  "options": [
    "Добавить столбцу `server_default=\"0\"` (или сначала разрешить `NULL`): в таблице уже есть строки, а новый столбец `NOT NULL` нечем заполнить",
    "Написать в `downgrade` обратное действие: `op.drop_column(\"posts\", \"views\")`, иначе откат ничего не сделает",
    "Убрать миграцию и вызывать `Base.metadata.create_all(engine)` при запуске приложения: он добавит столбец в существующую таблицу",
    "Отредактировать предыдущую, уже применённую миграцию и добавить столбец туда: так история останется короче"
  ],
  "answer": [
    0,
    1
  ],
  "explanation": "В таблице `posts` на сервере уже есть строки. Столбец `NOT NULL` без значения по умолчанию заполнить нечем, поэтому `upgrade` упадёт; `server_default=\"0\"` даёт значение всем существующим строкам. Пустой `downgrade` означает, что откатить миграцию нельзя: команда `alembic downgrade -1` ничего не изменит, а схема и история разойдутся. `create_all` создаёт только отсутствующие таблицы и существующие не меняет, поэтому столбец не добавит. Применённую миграцию не правят: на других серверах она уже выполнена и повторно не запустится, нужна новая."
}
```

В модель `Post` добавили счётчик просмотров `views`, и разработчик написал миграцию. На боевой базе в таблице `posts` уже тысячи строк. Выберите все верные исправления.

```python code
def upgrade() -> None:
    op.add_column("posts", sa.Column("views", sa.Integer(), nullable=False))


def downgrade() -> None:
    pass
```

## task fa-migration-choice
```json
{
  "type": "choice",
  "title": "Как изменить схему живой базы",
  "xp": 10,
  "hints": [
    "Разделы «Миграции: зачем нужен Alembic» и «Шпаргалка» этого урока.",
    "Что делает `create_all` с таблицей, которая уже существует? И что нужно Alembic, чтобы применить изменение?",
    "Верна последовательность: изменить модель, создать файл миграции командой `alembic revision --autogenerate`, проверить его глазами и применить `alembic upgrade head`."
  ],
  "options": [
    "Изменить модель, создать файл миграции командой `alembic revision --autogenerate -m \"...\"`, проверить его и применить `alembic upgrade head`",
    "Изменить модель и перезапустить приложение: `create_all` добавит новый столбец в существующую таблицу",
    "Изменить модель и сразу выполнить `alembic upgrade head`: без файла миграции Alembic сам поймёт, что поменялось",
    "Выполнить `ALTER TABLE` вручную на боевом сервере и нигде его не сохранять"
  ],
  "answer": [
    0
  ],
  "explanation": "`alembic revision --autogenerate` сравнивает модели с базой и записывает разницу в файл миграции; его проверяют (переименование он не распознаёт: для него это удаление старого столбца и добавление нового), затем `alembic upgrade head` применяет его. `create_all` не меняет существующих таблиц, поэтому столбец не появится и запросы упадут. `upgrade head` применяет только уже существующие файлы миграций и сам их не создаёт. Ручной `ALTER TABLE` без файла не воспроизводится на других серверах и не попадает в историю изменений."
}
```

В модель `Post` добавили столбец `views`. Приложение уже работает на сервере, в таблице `posts` есть данные, база — PostgreSQL. Какая последовательность действий правильная?
