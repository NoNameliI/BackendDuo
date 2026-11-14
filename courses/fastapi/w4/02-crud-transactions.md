# CRUD и транзакции

Трекер задач должен уметь четыре действия над задачей: создать, прочитать, изменить, удалить (по-английски CRUD). Чтение вы уже написали. Теперь запись: она меняет данные, и ошибка здесь стоит дороже. Если в середине операции что-то сломалось, в базе не должно остаться полдела. Для этого есть **транзакции**. С этого урока проект состоит из нескольких файлов: так он выглядит в реальной работе.

### Структура проекта

Код делят по ответственности: подключение к базе, модели таблиц, схемы запросов и ответов, маршруты.

```python
# db.py
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

```python
# models.py
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100), unique=True)
    done: Mapped[bool] = mapped_column(default=False)
```

```python
# main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import init_db
from routers import tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(tasks.router)
```

- `db.py` хранит всё, что относится к подключению: движок, фабрику сессий, `Base` и зависимость `SessionDep`. Модели и маршруты импортируют отсюда `Base` и `SessionDep`.
- `models.py` — только классы таблиц. Он импортирует `Base` из `db.py`, а не наоборот.
- `import models` внутри `init_db()` нужен, чтобы классы моделей были выполнены до `create_all`: `Base.metadata` знает только о тех моделях, модули которых уже импортированы. Импорт внутри функции, а не наверху файла, избегает цикла: `models` импортирует `db`, а `db` — `models`.
- `# noqa: F401` просит проверяющие инструменты не жаловаться на «неиспользуемый импорт»: здесь он нужен ради побочного эффекта.
- `main.py` собирает приложение: lifespan подготавливает базу, `include_router` подключает маршруты из `routers/tasks.py` (роутеры — урок про структуру проекта мира 3).
- Схемы запросов и ответов лежат в `schemas.py` по тем же правилам, что в мире 2.

### Создание: add, commit, refresh

```python
task = Task(**data.model_dump())
session.add(task)
session.commit()
session.refresh(task)
```

- `Task(**data.model_dump())` — объект модели из полей запроса: словарь `{"title": "...", "done": ...}` раскрывается в именованные аргументы (`**` распаковывает словарь, ключи становятся именами аргументов).
- `session.add(task)` — «поставить объект в очередь на вставку». В базу он пока не записан.
- `session.commit()` — выполнить `INSERT`, зафиксировать транзакцию. После этого у объекта появляется `id`.
- `session.refresh(task)` — заново прочитать поля объекта из базы. Нужен, если базу заполняет что-то помимо вашего кода (значение по умолчанию на стороне базы, триггер): объект будет точно таким же, как строка. В простых случаях это страховка, а не необходимость.
- Для ответа `201` в декоратор добавляют `status_code=201`.

### Частичное обновление: exclude_unset

Метод `PATCH` меняет только присланные поля. Модель запроса делают с необязательными полями, а при обновлении берут только те, которые клиент действительно прислал.

```python
changes = data.model_dump(exclude_unset=True)
for field, value in changes.items():
    setattr(task, field, value)
session.commit()
```

- `model_dump(exclude_unset=True)` — словарь только из тех полей, которые были в теле запроса (подробнее — в мире 2). Поле, которого в теле не было, не попадёт в словарь, даже если у него есть значение по умолчанию `None`.
- `setattr(task, "done", True)` — то же самое, что `task.done = True`, но имя поля берётся из строки. Цикл применяет все присланные поля.
- Отдельного вызова «сохранить» нет: сессия следит за объектами, которые она загрузила. Присваивание отмечает объект изменённым, а `commit()` пишет `UPDATE` только для изменённых столбцов.
- Тело `{}` не меняет ничего, и `commit()` ничего не пишет.
- Без `exclude_unset` в словаре окажутся все поля, непереданные — как `None`. Они затёрли бы данные или нарушили бы `NOT NULL`.

### Удаление

```python
session.delete(task)
session.commit()
```

- `session.delete(объект)` — ставит удаление в очередь; `commit()` выполняет `DELETE`.
- Ответ на удаление не имеет тела. В декоратор пишут `status_code=204`, а обработчик ничего не возвращает: FastAPI отправит пустой ответ с кодом `204`.
- Если записи нет, отвечают `404`: сначала `session.get`, потом проверка на `None`, как при чтении.

Все три операции в одном приложении (в примере всё в одном файле, чтобы его можно было запустить):

```python example
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Reminder(Base):
    __tablename__ = "reminders"

    id: Mapped[int] = mapped_column(primary_key=True)
    text: Mapped[str] = mapped_column(String(200))
    done: Mapped[bool] = mapped_column(default=False)
    minutes: Mapped[int] = mapped_column(default=15)


class ReminderIn(BaseModel):
    text: str
    minutes: int = 15


class ReminderUpdate(BaseModel):
    text: str | None = None
    done: bool | None = None
    minutes: int | None = None


class ReminderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    text: str
    done: bool
    minutes: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
app = FastAPI(lifespan=lifespan)


@app.post("/reminders", response_model=ReminderOut, status_code=201)
def create_reminder(data: ReminderIn, session: SessionDep):
    reminder = Reminder(**data.model_dump())
    session.add(reminder)
    session.commit()
    session.refresh(reminder)
    return reminder


@app.patch("/reminders/{reminder_id}", response_model=ReminderOut)
def update_reminder(reminder_id: int, data: ReminderUpdate, session: SessionDep):
    reminder = session.get(Reminder, reminder_id)
    if reminder is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(reminder, field, value)
    session.commit()
    return reminder


@app.delete("/reminders/{reminder_id}", status_code=204)
def delete_reminder(reminder_id: int, session: SessionDep):
    reminder = session.get(Reminder, reminder_id)
    if reminder is None:
        raise HTTPException(status_code=404, detail="Reminder not found")
    session.delete(reminder)
    session.commit()
###
POST /reminders
Content-Type: application/json

{"text": "Call the dentist"}
###
PATCH /reminders/1
Content-Type: application/json

{"done": true}
###
PATCH /reminders/1
Content-Type: application/json

{"minutes": 30}
###
DELETE /reminders/1
###
PATCH /reminders/1
Content-Type: application/json

{"done": false}
```

Ответы: создание дало `201` и напоминание с `id` `1`; первое `PATCH` изменило только `done`, второе — только `minutes`, и `done` осталось `true` (потому что поле не было в теле); `DELETE` вернул `204` без тела; последний `PATCH` — `404`, записи больше нет.

### Транзакция: commit и rollback

**Транзакция** — группа изменений, которая действует как одно целое: либо записывается всё, либо ничего. Сессия открывает транзакцию сама при первом обращении к базе.

- `session.commit()` — зафиксировать: все накопленные изменения записываются разом.
- `session.rollback()` — отменить: всё, что накоплено после последнего `commit`, пропадает.
- Если сессия закрывается без `commit`, она откатывает изменения сама.

Из этого вытекает правило: **один запрос — один `commit` в конце**. Если создаётся пять объектов, их добавляют через `add_all` и фиксируют одним `commit()`. Тогда при сбое на третьем в базе не окажется двух первых. Вызов `commit()` после каждого объекта делает запись по частям: упавший запрос оставит в базе часть данных.

### IntegrityError и ответ 409

Ограничение (`unique=True`, `NOT NULL`, внешний ключ) база проверяет при записи. Нарушение приходит как исключение `IntegrityError` из `sqlalchemy.exc`. Клиенту нужно не `500`, а понятный `409 Conflict`: данные верны по форме, но противоречат состоянию базы.

```python
try:
    session.commit()
except IntegrityError:
    session.rollback()
    raise HTTPException(status_code=409, detail="Название уже занято")
```

- `from sqlalchemy.exc import IntegrityError` — класс исключения.
- `try: session.commit()` — исключение возникает именно на `commit()` (точнее, при записи, которую он запускает), а не на `add`.
- `session.rollback()` — после неудачной записи транзакция сломана; сессию нужно откатить. Если после этого вы продолжите пользоваться сессией (например, сделаете запрос), без `rollback()` получите ошибку. Здесь запрос заканчивается сразу, но привычка полезна.
- `raise HTTPException(status_code=409, ...)` — ответ клиенту.
- Ловите именно `IntegrityError`, а не любое исключение: иначе настоящие ошибки в коде превратятся в `409`.

Пример объединяет оба правила: пакетное создание ярлыков одним `commit`, а при нарушении уникальности — `409` и откат всего пакета.

```python example
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Label(Base):
    __tablename__ = "labels"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(30), unique=True)


class LabelIn(BaseModel):
    name: str


class LabelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    yield


def get_session():
    with SessionLocal() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]
app = FastAPI(lifespan=lifespan)


@app.get("/labels", response_model=list[LabelOut])
def list_labels(session: SessionDep):
    return session.scalars(select(Label).order_by(Label.id)).all()


@app.post("/labels/batch", response_model=list[LabelOut], status_code=201)
def create_labels(items: list[LabelIn], session: SessionDep):
    labels = [Label(name=item.name) for item in items]
    session.add_all(labels)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Label name already exists")
    return labels
###
POST /labels/batch
Content-Type: application/json

[{"name": "bug"}, {"name": "idea"}]
###
POST /labels/batch
Content-Type: application/json

[{"name": "urgent"}, {"name": "bug"}, {"name": "later"}]
###
GET /labels
```

Ответы: первый пакет сохранён (`201`, два ярлыка). Во втором пакете `urgent` и `later` корректны, но `bug` уже существует: `commit()` вызвал `IntegrityError`, обработчик откатил транзакцию и ответил `409`. Последний запрос показывает, что `urgent` и `later` не сохранились: в списке только `bug` и `idea`. Если бы после каждого объекта стоял свой `commit()`, `urgent` остался бы в базе.

### Одна сессия на запрос

Сессия, пришедшая из зависимости, принадлежит одному запросу. Её не кладут в глобальную переменную, не передают в другой запрос и не используют после ответа. Объект модели (`Task`) тоже привязан к сессии, в которой загружен: отдавайте клиенту модель ответа, а не держите объект в памяти между запросами.

В тестах и в студии каждая проверка загружает приложение заново, поэтому база всегда начинается с данных из lifespan: порядок тестовых запросов внутри одной проверки значит, а между проверками ничего не сохраняется.

### Частые ошибки

- `commit()` в цикле. Неверно: `for item in items: session.add(...); session.commit()`. Верно: добавить всё, один `commit()` после цикла.
- Нет `commit()` после изменения. Неверно: `setattr(...)` или `session.delete(...)` без `commit()`. Верно: фиксируйте транзакцию; без этого изменения откатятся при закрытии сессии.
- `PATCH` без `exclude_unset`. Неверно: `data.model_dump()` — непереданные поля становятся `None` и затирают данные. Верно: `data.model_dump(exclude_unset=True)`.
- `IntegrityError` не ловится. Неверно: оставить дубликат без обработки — клиент получает `500`. Верно: `except IntegrityError`, `rollback()`, `HTTPException(409)`.
- Ловится слишком много. Неверно: `except Exception`. Верно: `except IntegrityError`; другие сбои должны оставаться видимыми.
- Таблиц нет. Неверно: вызвать `create_all`, не импортировав модели. Верно: импортировать модуль с моделями до `create_all` (в примере — `import models` в `init_db`).

### Шпаргалка

- Проект: `db.py` (engine, `SessionLocal`, `Base`, `SessionDep`, `init_db`), `models.py`, `schemas.py`, `routers/…`, `main.py` с lifespan.
- Создать: `session.add(obj)`, `session.commit()`, `session.refresh(obj)`, `status_code=201`.
- Обновить частично: `data.model_dump(exclude_unset=True)`, `setattr(obj, поле, значение)`, `commit()`.
- Удалить: `session.delete(obj)`, `commit()`, `status_code=204`.
- Нет записи — `HTTPException(404)` после `session.get`.
- Транзакция: один `commit()` на запрос; `rollback()` отменяет.
- Нарушение ограничения: `except IntegrityError:` → `session.rollback()` → `HTTPException(409)`.

## task fa-crud-create
```json
{
  "type": "fastapi",
  "title": "Создание и чтение задачи",
  "xp": 15,
  "hints": [
    "Разделы «Структура проекта», «Создание: add, commit, refresh» и «Запросы на чтение» прошлого урока: `session.get` и `404`.",
    "В `routers/tasks.py` нужны два маршрута: `GET /tasks/{task_id}` (с `404`) и `POST /tasks` со статусом `201`, в котором объект добавляется, фиксируется и перечитывается.",
    "Шаблон: `task = Task(**data.model_dump())`; `session.add(task)`; `session.commit()`; `session.refresh(task)`; `return task`; для чтения — `task = session.get(Task, task_id)` и проверка на `None`."
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
    "status-200": "создание отвечает кодом 200 вместо 201",
    "no-commit": "задача добавлена в сессию, но не зафиксирована: ответ создаётся с ошибкой, а в базу ничего не попадает"
  }
}
```

Проект трекера разделён на файлы: `db.py`, `models.py`, `schemas.py` и `main.py` готовы и закрыты для правки, ваша работа — `routers/tasks.py`. В базе три задачи: 1 — «Write report» (приоритет 3), 2 — «Review PR» (приоритет 1), 3 — «Deploy» (выполнена, приоритет 2). Ответ о задаче — `{"id", "title", "done", "priority"}`.

Сейчас в роутере есть только `GET /tasks`. Добавьте:

- `POST /tasks` с телом `TaskIn` (`title` и необязательный `priority`, по умолчанию 1): создаёт задачу и отвечает `201` с созданной задачей (включая новый `id` и `done`: `false`);
- `GET /tasks/{task_id}`: задача или `404` и `{"detail": "Task not found"}`.

Повтор названия обрабатывать не нужно: этому посвящено одно из следующих заданий. Идея проверки: запросы уходят в ваш проект и в эталон, сравниваются коды и тела, причём созданная задача должна быть видна следующим запросам.

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


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100), unique=True)
    done: Mapped[bool] = mapped_column(default=False)
    priority: Mapped[int] = mapped_column(default=1)
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    priority: int = Field(default=1, ge=1, le=5)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    done: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=5)


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    done: bool
    priority: int
```

```python starter path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionLocal, init_db
from models import Task
from routers import tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Task(title="Write report", priority=3),
                Task(title="Review PR"),
                Task(title="Deploy", done=True, priority=2),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Tracker", lifespan=lifespan)
app.include_router(tasks.router)
```

```python starter path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()
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


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100), unique=True)
    done: Mapped[bool] = mapped_column(default=False)
    priority: Mapped[int] = mapped_column(default=1)
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    priority: int = Field(default=1, ge=1, le=5)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    done: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=5)


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    done: bool
    priority: int
```

```python solution path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionLocal, init_db
from models import Task
from routers import tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Task(title="Write report", priority=3),
                Task(title="Review PR"),
                Task(title="Deploy", done=True, priority=2),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Tracker", lifespan=lifespan)
app.include_router(tasks.router)
```

```python solution path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()


@router.get("/{task_id}", response_model=TaskOut)
def read_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskIn, session: SessionDep):
    task = Task(**data.model_dump())
    session.add(task)
    session.commit()
    session.refresh(task)
    return task
```

```python wrong id=status-200 path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()


@router.get("/{task_id}", response_model=TaskOut)
def read_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut)
def create_task(data: TaskIn, session: SessionDep):
    task = Task(**data.model_dump())
    session.add(task)
    session.commit()
    session.refresh(task)
    return task
```

```python wrong id=no-commit path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()


@router.get("/{task_id}", response_model=TaskOut)
def read_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskIn, session: SessionDep):
    task = Task(**data.model_dump())
    session.add(task)
    session.refresh(task)
    return task
```

```http tests
GET /tasks
###
POST /tasks
Content-Type: application/json

{"title": "Plan sprint", "priority": 4}
###
POST /tasks
Content-Type: application/json

{"title": "Quick fix"}
###
GET /tasks/4
###
GET /tasks/5
###
GET /tasks/99
###
POST /tasks
Content-Type: application/json

{"title": ""}
###
GET /tasks
```

## task fa-crud-update-delete
```json
{
  "type": "fastapi",
  "title": "Обновление и удаление задачи",
  "xp": 15,
  "hints": [
    "Разделы «Частичное обновление: exclude_unset» и «Удаление».",
    "Для `PATCH` берите из тела только присланные поля: `data.model_dump(exclude_unset=True)`, применяйте их через `setattr` и вызовите `commit()`. Для `DELETE` — `session.delete(task)`, `commit()` и код `204`.",
    "Шаблон: `for field, value in data.model_dump(exclude_unset=True).items(): setattr(task, field, value)`; `@router.delete(\"/{task_id}\", status_code=204)`. Обоим маршрутам нужна проверка на `None` и `404`."
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
    "no-exclude-unset": "в обновление попадают и непереданные поля со значением None: они затирают данные и нарушают NOT NULL",
    "delete-no-commit": "удаление не фиксируется, и задача остаётся в базе"
  }
}
```

Проект трекера готов (`db.py`, `models.py`, `schemas.py`, `main.py` закрыты для правки). В базе три задачи: 1 — «Write report» (приоритет 3), 2 — «Review PR» (приоритет 1), 3 — «Deploy» (выполнена, приоритет 2). Ответ о задаче — `{"id", "title", "done", "priority"}`. В `routers/tasks.py` уже есть список, чтение одной задачи и создание. Добавьте:

- `PATCH /tasks/{task_id}` с телом `TaskUpdate` (все поля необязательные): меняются только присланные поля; ответ `200` и задача целиком; пустое тело `{}` ничего не меняет; если задачи нет, `404` и `{"detail": "Task not found"}`;
- `DELETE /tasks/{task_id}`: удаляет задачу и отвечает `204` без тела; если задачи нет, `404` с тем же `detail`.

Идея проверки: после изменений тестовые запросы читают задачи и сравнивают их с эталонными, поэтому неверно затёртое поле или не удалённая запись будут видны.

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


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100), unique=True)
    done: Mapped[bool] = mapped_column(default=False)
    priority: Mapped[int] = mapped_column(default=1)
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    priority: int = Field(default=1, ge=1, le=5)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    done: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=5)


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    done: bool
    priority: int
```

```python starter path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionLocal, init_db
from models import Task
from routers import tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Task(title="Write report", priority=3),
                Task(title="Review PR"),
                Task(title="Deploy", done=True, priority=2),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Tracker", lifespan=lifespan)
app.include_router(tasks.router)
```

```python starter path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()


@router.get("/{task_id}", response_model=TaskOut)
def read_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskIn, session: SessionDep):
    task = Task(**data.model_dump())
    session.add(task)
    session.commit()
    session.refresh(task)
    return task
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


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100), unique=True)
    done: Mapped[bool] = mapped_column(default=False)
    priority: Mapped[int] = mapped_column(default=1)
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    priority: int = Field(default=1, ge=1, le=5)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    done: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=5)


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    done: bool
    priority: int
```

```python solution path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionLocal, init_db
from models import Task
from routers import tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Task(title="Write report", priority=3),
                Task(title="Review PR"),
                Task(title="Deploy", done=True, priority=2),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Tracker", lifespan=lifespan)
app.include_router(tasks.router)
```

```python solution path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()


@router.get("/{task_id}", response_model=TaskOut)
def read_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskIn, session: SessionDep):
    task = Task(**data.model_dump())
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, data: TaskUpdate, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    session.commit()
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    session.delete(task)
    session.commit()
```

```python wrong id=no-exclude-unset path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()


@router.get("/{task_id}", response_model=TaskOut)
def read_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskIn, session: SessionDep):
    task = Task(**data.model_dump())
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, data: TaskUpdate, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    for field, value in data.model_dump().items():
        setattr(task, field, value)
    session.commit()
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    session.delete(task)
    session.commit()
```

```python wrong id=delete-no-commit path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()


@router.get("/{task_id}", response_model=TaskOut)
def read_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskIn, session: SessionDep):
    task = Task(**data.model_dump())
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, data: TaskUpdate, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    session.commit()
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    session.delete(task)
```

```http tests
PATCH /tasks/1
Content-Type: application/json

{"done": true}
###
PATCH /tasks/1
Content-Type: application/json

{"priority": 5}
###
GET /tasks/1
###
PATCH /tasks/2
Content-Type: application/json

{}
###
PATCH /tasks/99
Content-Type: application/json

{"done": true}
###
PATCH /tasks/1
Content-Type: application/json

{"priority": 9}
###
DELETE /tasks/3
###
GET /tasks/3
###
DELETE /tasks/3
###
GET /tasks
```

## task fa-crud-conflict
```json
{
  "type": "fastapi",
  "title": "Дубликаты и пакетное создание",
  "xp": 20,
  "hints": [
    "Разделы «IntegrityError и ответ 409» и «Транзакция: commit и rollback».",
    "Оберните `session.commit()` в `try` / `except IntegrityError`: в `except` вызовите `session.rollback()` и поднимите `HTTPException(409)`. Это нужно и в `POST /tasks`, и в `PATCH`. Пакетный маршрут добавляет все задачи через `add_all` и фиксирует их одним `commit()`.",
    "Шаблон: `session.add_all(tasks)`; `try: session.commit()`; `except IntegrityError: session.rollback(); raise HTTPException(status_code=409, detail=\"Task title already exists\")`; в конце `return tasks`."
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
    "commit-per-item": "пакет сохраняется по одной задаче, поэтому при конфликте на середине часть задач остаётся в базе",
    "only-create": "конфликт обработан только при создании; переименование в занятое название заканчивается ошибкой сервера"
  }
}
```

В проекте трекера название задачи уникально. Проект готов (`db.py`, `models.py`, `schemas.py`, `main.py` закрыты для правки). В базе три задачи: 1 — «Write report» (приоритет 3), 2 — «Review PR» (приоритет 1), 3 — «Deploy» (выполнена, приоритет 2). Ответ о задаче — `{"id", "title", "done", "priority"}`. Сейчас повторное название ломает `POST /tasks` и `PATCH /tasks/{task_id}` ошибкой сервера. Исправьте `routers/tasks.py`:

- при нарушении уникальности `POST` и `PATCH` отвечают `409` и `{"detail": "Task title already exists"}`, а изменения откатываются;
- добавьте `POST /tasks/batch`: тело — список `TaskIn`; все задачи создаются вместе. Успех — `201` и список созданных задач по порядку. Если хотя бы одно название занято (в базе или повторено в самом пакете), отвечает `409` с тем же `detail`, и ни одна задача пакета не сохраняется.

Идея проверки: после конфликтов тестовые запросы читают список, и в нём не должно быть лишнего.

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


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100), unique=True)
    done: Mapped[bool] = mapped_column(default=False)
    priority: Mapped[int] = mapped_column(default=1)
```

```python starter path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    priority: int = Field(default=1, ge=1, le=5)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    done: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=5)


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    done: bool
    priority: int
```

```python starter path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionLocal, init_db
from models import Task
from routers import tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Task(title="Write report", priority=3),
                Task(title="Review PR"),
                Task(title="Deploy", done=True, priority=2),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Tracker", lifespan=lifespan)
app.include_router(tasks.router)
```

```python starter path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()


@router.get("/{task_id}", response_model=TaskOut)
def read_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskIn, session: SessionDep):
    task = Task(**data.model_dump())
    session.add(task)
    session.commit()
    session.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, data: TaskUpdate, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    session.commit()
    return task
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


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(100), unique=True)
    done: Mapped[bool] = mapped_column(default=False)
    priority: Mapped[int] = mapped_column(default=1)
```

```python solution path=schemas.py
from pydantic import BaseModel, ConfigDict, Field


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    priority: int = Field(default=1, ge=1, le=5)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    done: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=5)


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    done: bool
    priority: int
```

```python solution path=main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from db import SessionLocal, init_db
from models import Task
from routers import tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with SessionLocal() as session:
        session.add_all(
            [
                Task(title="Write report", priority=3),
                Task(title="Review PR"),
                Task(title="Deploy", done=True, priority=2),
            ]
        )
        session.commit()
    yield


app = FastAPI(title="Tracker", lifespan=lifespan)
app.include_router(tasks.router)
```

```python solution path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()


@router.post("/batch", response_model=list[TaskOut], status_code=201)
def create_batch(items: list[TaskIn], session: SessionDep):
    tasks = [Task(**item.model_dump()) for item in items]
    session.add_all(tasks)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Task title already exists")
    return tasks


@router.get("/{task_id}", response_model=TaskOut)
def read_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskIn, session: SessionDep):
    task = Task(**data.model_dump())
    session.add(task)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Task title already exists")
    session.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, data: TaskUpdate, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Task title already exists")
    return task
```

```python wrong id=commit-per-item path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()


@router.post("/batch", response_model=list[TaskOut], status_code=201)
def create_batch(items: list[TaskIn], session: SessionDep):
    tasks = []
    try:
        for item in items:
            task = Task(**item.model_dump())
            session.add(task)
            session.commit()
            tasks.append(task)
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Task title already exists")
    return tasks


@router.get("/{task_id}", response_model=TaskOut)
def read_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskIn, session: SessionDep):
    task = Task(**data.model_dump())
    session.add(task)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Task title already exists")
    session.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, data: TaskUpdate, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Task title already exists")
    return task
```

```python wrong id=only-create path=routers/tasks.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from db import SessionDep
from models import Task
from schemas import TaskIn, TaskOut, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
def list_tasks(session: SessionDep):
    return session.scalars(select(Task).order_by(Task.id)).all()


@router.post("/batch", response_model=list[TaskOut], status_code=201)
def create_batch(items: list[TaskIn], session: SessionDep):
    tasks = [Task(**item.model_dump()) for item in items]
    session.add_all(tasks)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Task title already exists")
    return tasks


@router.get("/{task_id}", response_model=TaskOut)
def read_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskOut, status_code=201)
def create_task(data: TaskIn, session: SessionDep):
    task = Task(**data.model_dump())
    session.add(task)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Task title already exists")
    session.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, data: TaskUpdate, session: SessionDep):
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    session.commit()
    return task
```

```http tests
POST /tasks
Content-Type: application/json

{"title": "Deploy"}
###
GET /tasks
###
PATCH /tasks/1
Content-Type: application/json

{"title": "Review PR"}
###
PATCH /tasks/1
Content-Type: application/json

{"title": "Write the report"}
###
POST /tasks/batch
Content-Type: application/json

[{"title": "Plan"}, {"title": "Review PR"}, {"title": "Retro"}]
###
GET /tasks
###
POST /tasks/batch
Content-Type: application/json

[{"title": "Plan"}, {"title": "Retro", "priority": 3}]
###
POST /tasks/batch
Content-Type: application/json

[{"title": "Same"}, {"title": "Same"}]
###
GET /tasks
```

## task fa-crud-transaction-review
```json
{
  "type": "review",
  "title": "Две задачи за один запрос",
  "xp": 15,
  "hints": [
    "Раздел «Транзакция: commit и rollback» и раздел про `IntegrityError`.",
    "Что окажется в базе, если вторая задача нарушит уникальность названия? И что увидит клиент?",
    "Верных изменений два: один `commit()` в конце и обработка `IntegrityError` с `rollback()` и ответом `409`."
  ],
  "lines": [
    5,
    8
  ],
  "options": [
    "Оставить один `commit()` после обоих `add`: обе задачи записываются вместе или не записываются вовсе",
    "Обернуть `commit()` в `try` / `except IntegrityError`, откатить транзакцию и ответить `409` вместо ошибки сервера",
    "Добавить `session.refresh(a)` после первого `commit()`: так вторая запись не помешает первой",
    "Оставить два `commit()` и ловить `IntegrityError` только на втором: первая задача уже сохранена, и это нормально"
  ],
  "answer": [
    0,
    1
  ],
  "explanation": "Сейчас первый `commit()` записывает задачу `a` навсегда. Если вторая задача нарушит уникальность названия, `IntegrityError` не будет обработан: клиент получит `500`, а в базе останется половина операции. Один `commit()` в конце делает обе записи единым целым, а перехват `IntegrityError` с `rollback()` превращает сбой в понятный `409`. `refresh` только перечитывает объект и ничего не защищает. Вариант с двумя `commit()` сохраняет именно ту неполную запись, от которой транзакция должна защищать: клиент получит ошибку, а первая задача останется в базе."
}
```

Маршрут должен создать две задачи за один запрос: либо обе, либо ни одной. Название задачи уникально. Что нужно исправить? Выберите все верные варианты.

```python code
@router.post("/pair", response_model=list[TaskOut], status_code=201)
def create_pair(first: TaskIn, second: TaskIn, session: SessionDep):
    a = Task(**first.model_dump())
    session.add(a)
    session.commit()
    b = Task(**second.model_dump())
    session.add(b)
    session.commit()
    return [a, b]
```
