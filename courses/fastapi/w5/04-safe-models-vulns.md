# Безопасные модели и типичные уязвимости

Вход и роли работают, но магазин всё равно можно взломать, не угадывая ни одного пароля. Достаточно, чтобы ответ API содержал лишнее поле, чтобы тело запроса принимало поле `role`, а маршрут `GET /orders/5` не спрашивал, чей это заказ. Эти ошибки не ловит ни компилятор, ни тип данных: их находят чтением кода. В этом уроке вы разберёте самые частые и научитесь их исправлять.

Классификация, на которую опираются разработчики, — список **OWASP API Security Top 10**: десять самых распространённых уязвимостей API. Из него здесь три главные: слишком широкий доступ к объектам (BOLA, в просторечии IDOR), слишком широкий доступ к полям объекта (лишние поля в ответе и подмена полей в запросе) и ошибки настройки (секреты в коде).

### Безопасные модели ответа

Если обработчик возвращает объект целиком, клиент получает все его поля, включая внутренние: хеш пароля, служебные пометки, признак блокировки. Правило: **ответ описывается отдельной моделью, где перечислено только то, что клиенту нужно**.

```python
class User(BaseModel):          # хранится на сервере
    id: int
    email: str
    password_hash: str

class UserOut(BaseModel):       # уходит клиенту
    id: int
    email: str

@app.get("/users/{user_id}", response_model=UserOut)
def read_user(user_id: int):
    return USERS[user_id]
```

- `response_model=UserOut` — FastAPI проверяет возвращённое значение по этой модели и отбрасывает поля, которых в ней нет. Вы это уже использовали в уроке про модели In/Out;
- `User` с хешем остаётся внутри сервера.

Что важно:

- модель ответа пишется как **список разрешённого**, а не «всё, кроме»: новое поле, добавленное в `User` завтра, не попадёт в ответ случайно;
- `response_model_exclude={"password_hash"}` тоже работает, но это список запрещённого: про новое поле легко забыть. Отдельный класс надёжнее;
- наследовать `UserOut` от `User` нельзя: поле `password_hash` перенесётся в ответ вместе с наследством;
- модель ответа нужна на **каждом** маршруте, который отдаёт этот объект, в том числе в списках: `response_model=list[UserOut]`. Забытый маршрут остаётся утечкой.

### Mass assignment: лишнее поле в теле

**Mass assignment** («массовое присваивание») — когда обработчик переносит в объект все поля тела запроса, не разбирая, какие из них клиенту разрешено задавать. Типичный пример: регистрация принимает `role`.

Опасный вариант:

```python
class UserIn(BaseModel):
    email: str
    role: str = "customer"      # клиент сам выбирает роль


user = User(id=1, email=data.email, role=data.role)
```

Клиент отправляет `{"email": "...", "role": "admin"}` и становится администратором. Исправление — модель запроса **без** полей, которые решает сервер:

```python
class SignupIn(BaseModel):
    email: str


user = User(id=1, email=data.email, role="customer")
```

- поля, которых нет в модели запроса, pydantic по умолчанию **игнорирует**: лишний `role` в теле пропадёт, и ответ будет таким, как будто его не было;
- чтобы лишние поля вместо этого вызывали ошибку, модели добавляют `model_config = ConfigDict(extra="forbid")` (`ConfigDict` из `pydantic`). Тогда запрос с `role` получит `422`: это строже, и тоже допустимо;
- служебные значения (`role`, `is_admin`, `owner_id`, `price` в заказе) всегда задаёт сервер, а не клиент.

```python example
from pydantic import BaseModel
from fastapi import FastAPI

app = FastAPI()
USERS: list[dict] = []


class SignupIn(BaseModel):
    email: str


class UserOut(BaseModel):
    id: int
    email: str
    role: str


@app.post("/signup", status_code=201, response_model=UserOut)
def signup(data: SignupIn):
    user = {"id": len(USERS) + 1, "email": data.email, "role": "customer", "password_hash": "$2b$04$..."}
    USERS.append(user)
    return user
###
POST /signup
Content-Type: application/json

{"email": "kate@blog.test", "role": "admin"}
```

Ответ: `201` и `{"id": 1, "email": "kate@blog.test", "role": "customer"}`. Поле `role` из тела проигнорировано, а `password_hash` из записи в ответ не попало.

### Проверка владельца: IDOR

**IDOR** (insecure direct object reference) — когда маршрут принимает номер объекта и отдаёт его любому вошедшему пользователю, не проверив, чей он. Вход в систему (аутентификация) и роли тут не помогают: пользователь `ann` вошла честно и просто подставила чужой номер заказа вместо своего. Это уязвимость №1 в списке OWASP.

Правило: каждый маршрут, который работает с объектом по номеру, проверяет, что объект принадлежит текущему пользователю (или у него есть особая роль).

```python
def get_own_order(order_id: int, user: CurrentUser) -> dict:
    order = ORDERS.get(order_id)
    if order is None or order["owner"] != user["username"]:
        raise HTTPException(status_code=404, detail="Order not found")
    return order
```

- `order["owner"] != user["username"]` — заказ принадлежит другому;
- ответ в обоих случаях один и тот же, `404`: пользователь не должен узнать, что заказ с таким номером существует. Ответ `403` выдаёт «такой заказ есть, но не ваш»;
- проверка живёт в одном месте (функция или зависимость), и все маршруты (`GET`, `PATCH`, `DELETE`) ею пользуются. Если проверить только `GET`, чужой заказ можно удалить;
- в списке (`GET /orders`) показывают только заказы текущего пользователя.

Пример: два покупателя и один общий склад заказов. Токены для `kate` и `tom` выпущены заранее.

```python example
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordBearer

app = FastAPI()
KEY = "demo-key-only-for-this-example-0123456789"
ORDERS = {1: {"id": 1, "owner": "kate", "total": 90}, 2: {"id": 2, "owner": "tom", "total": 15}}
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def current_name(token: Annotated[str, Depends(oauth2_scheme)]) -> str:
    try:
        return jwt.decode(token, KEY, algorithms=["HS256"])["sub"]
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token", headers={"WWW-Authenticate": "Bearer"})


def own_order(order_id: int, name: Annotated[str, Depends(current_name)]) -> dict:
    order = ORDERS.get(order_id)
    if order is None or order["owner"] != name:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.get("/orders/{order_id}")
def read_order(order: Annotated[dict, Depends(own_order)]):
    return order
###
GET /orders/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJrYXRlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.XYo0qvnR1_vaou0Ukd2QLf-ygvoDLQbuoa61ywqWMWg
###
GET /orders/2
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJrYXRlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.XYo0qvnR1_vaou0Ukd2QLf-ygvoDLQbuoa61ywqWMWg
###
GET /orders/77
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJrYXRlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.XYo0qvnR1_vaou0Ukd2QLf-ygvoDLQbuoa61ywqWMWg
```

`kate` получает свой заказ (`200`). Заказ `tom` и несуществующий заказ дают одинаковый ответ `404 Order not found`: по ответам их не отличить. Зависимость `own_order` принимает `order_id` из пути: параметры зависимости разбираются так же, как параметры обработчика.

### Секреты вне кода

Ключ подписи токенов, ключи API, пароль базы не пишут в код: репозиторий читают все, кто к нему допущен, а история Git помнит и удалённое. Читают из окружения или файла `.env` через `BaseSettings` (разбирали в уроке про настройки): поле без значения по умолчанию, файл `.env` не попадает в репозиторий (его добавляют в `.gitignore`). Если секрет уже попал в репозиторий, его считают скомпрометированным и **заменяют**: простого удаления из кода мало.

### SQL из строк (теория)

Запрос, собранный из строки пользователя, даёт **SQL-инъекцию**: пользователь пишет в поле не имя, а кусок запроса.

```python
query = f"SELECT id FROM users WHERE email = '{email}'"      # так нельзя
cursor.execute("SELECT id FROM users WHERE email = ?", (email,))   # так верно
```

Если `email` равен `x' OR '1'='1`, первый запрос возвращает всех пользователей. Во втором запросе значение передаётся отдельно, как данные, и база никогда не принимает его за часть запроса. Любая библиотека для баз данных, включая SQLAlchemy из предыдущего мира, подставляет значения именно так. Правило: никогда не склеивайте SQL из пользовательских строк (`f""`, `+`, `%`, `.format`). Запускать эту уязвимость в студии не нужно: работа с PostgreSQL разобрана в отдельном курсе.

### Как искать уязвимости в коде

При ревью задают себе по порядку шесть вопросов:

1. Есть ли в ответе поля, которые клиенту знать не нужно? (модель ответа)
2. Берутся ли из тела запроса поля, которые решает сервер? (`role`, `owner`, цена)
3. Проверяется ли владелец объекта в каждом маршруте с номером в пути?
4. Нет ли секретов в коде?
5. Сравниваются ли секреты через `compare_digest`?
6. Не склеен ли SQL из строк?

### Частые ошибки

- Ответ без модели. Неверно: `return user` без `response_model` (уходит всё, что есть в объекте). Верно: `response_model=UserOut`.
- Модель ответа наследует модель хранения. Неверно: `class UserOut(User)`. Верно: отдельный `BaseModel` только с нужными полями.
- Роль из тела. Неверно: `role=data.role`. Верно: `role="customer"`.
- Владельца проверили не везде. Неверно: проверка в `GET`, но не в `DELETE`. Верно: одна функция-проверка во всех маршрутах.
- `403` вместо `404` для чужого объекта. Так раскрывается, что объект существует. Верно: `404`, одинаковый для «нет» и «не ваш».
- Секрет «спрятан» в другом файле кода. Неверно: `config.py` с `SECRET = "..."`. Верно: значение приходит из окружения.

### Шпаргалка

- Ответ — отдельная модель (`response_model=...Out`), без наследования от модели хранения; на всех маршрутах объекта и списках.
- Запрос — модель без служебных полей; лишние поля игнорируются или (`extra="forbid"`) дают `422`.
- Владелец: `obj["owner"] != user["username"]` → `404`, одна проверка на все маршруты, список только свой.
- Секреты из окружения (`BaseSettings`, `.env`), скомпрометированный секрет заменяют.
- SQL только с параметрами (`?`, `:name`), не из строк.
- Шесть вопросов ревью: поля ответа, поля запроса, владелец, секреты, сравнение секретов, SQL.

## task fa-vuln-role
```json
{
  "type": "fix-bug",
  "title": "Роль из тела запроса",
  "xp": 15,
  "packages": ["bcrypt"],
  "hints": [
    "Раздел «Mass assignment: лишнее поле в теле»: что решает сервер, а что клиент.",
    "Регистрация создаёт пользователя с `role=data.role`, поэтому запрос `{\"role\": \"admin\"}` делает администратора. Роль новой учётной записи всегда `customer`, а `role` в теле игнорируется (ответ при этом `201`).",
    "Шаблон: уберите поле `role` из `UserIn` в `schemas.py` и создавайте `User(..., role=\"customer\", ...)` в `main.py`. Блокировать только значение `admin` недостаточно: роли бывают и другие."
  ],
  "wrong": {
    "block-admin-only": "значение admin заменяется на customer, но роль staff из тела всё равно принимается",
    "forbid-extra": "лишнее поле role приводит к ответу 422, а должно игнорироваться"
  }
}
```
`POST /users` регистрирует покупателя: тело `{"email": ..., "password": ...}`, ответ `201` и `{"id": номер, "email": ..., "role": "customer"}`. `GET /users/{user_id}` отдаёт то же самое или `404` с `{"detail": "User not found"}`. Пароль хранится хешем и в ответы не попадает.

Сейчас модель регистрации принимает необязательное поле `role`, и клиент сам назначает себе любую роль. Исправьте код: роль новой учётной записи всегда `customer`, а если в теле пришёл `role` с любым значением, он игнорируется, ответ остаётся `201`.

```python starter path=schemas.py
from pydantic import BaseModel


class UserIn(BaseModel):
    email: str
    password: str
    role: str = "customer"


class User(BaseModel):
    id: int
    email: str
    role: str
    password_hash: str


class UserOut(BaseModel):
    id: int
    email: str
    role: str
```

```python starter path=main.py
import bcrypt
from fastapi import FastAPI, HTTPException

from schemas import User, UserIn, UserOut

app = FastAPI()
USERS: dict[int, User] = {}


@app.post("/users", status_code=201, response_model=UserOut)
def register(data: UserIn):
    hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=4)).decode()
    user = User(id=len(USERS) + 1, email=data.email, role=data.role, password_hash=hashed)
    USERS[user.id] = user
    return user


@app.get("/users/{user_id}", response_model=UserOut)
def read_user(user_id: int):
    user = USERS.get(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
```

```python solution path=schemas.py
from pydantic import BaseModel


class UserIn(BaseModel):
    email: str
    password: str


class User(BaseModel):
    id: int
    email: str
    role: str
    password_hash: str


class UserOut(BaseModel):
    id: int
    email: str
    role: str
```

```python solution path=main.py
import bcrypt
from fastapi import FastAPI, HTTPException

from schemas import User, UserIn, UserOut

app = FastAPI()
USERS: dict[int, User] = {}


@app.post("/users", status_code=201, response_model=UserOut)
def register(data: UserIn):
    hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=4)).decode()
    user = User(id=len(USERS) + 1, email=data.email, role="customer", password_hash=hashed)
    USERS[user.id] = user
    return user


@app.get("/users/{user_id}", response_model=UserOut)
def read_user(user_id: int):
    user = USERS.get(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
```

```python wrong id=block-admin-only path=main.py
import bcrypt
from fastapi import FastAPI, HTTPException

from schemas import User, UserIn, UserOut

app = FastAPI()
USERS: dict[int, User] = {}


@app.post("/users", status_code=201, response_model=UserOut)
def register(data: UserIn):
    hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=4)).decode()
    role = "customer" if data.role == "admin" else data.role
    user = User(id=len(USERS) + 1, email=data.email, role=role, password_hash=hashed)
    USERS[user.id] = user
    return user


@app.get("/users/{user_id}", response_model=UserOut)
def read_user(user_id: int):
    user = USERS.get(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
```

```python wrong id=forbid-extra path=schemas.py
from pydantic import BaseModel, ConfigDict


class UserIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str
    password: str


class User(BaseModel):
    id: int
    email: str
    role: str
    password_hash: str


class UserOut(BaseModel):
    id: int
    email: str
    role: str
```

```python wrong id=forbid-extra path=main.py
import bcrypt
from fastapi import FastAPI, HTTPException

from schemas import User, UserIn, UserOut

app = FastAPI()
USERS: dict[int, User] = {}


@app.post("/users", status_code=201, response_model=UserOut)
def register(data: UserIn):
    hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=4)).decode()
    user = User(id=len(USERS) + 1, email=data.email, role="customer", password_hash=hashed)
    USERS[user.id] = user
    return user


@app.get("/users/{user_id}", response_model=UserOut)
def read_user(user_id: int):
    user = USERS.get(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
```

```http tests
POST /users
Content-Type: application/json

{"email": "lena@shop.test", "password": "blue-lamp-77"}
###
POST /users
Content-Type: application/json

{"email": "boss@shop.test", "password": "blue-lamp-77", "role": "admin"}
###
POST /users
Content-Type: application/json

{"email": "clerk@shop.test", "password": "blue-lamp-77", "role": "staff"}
###
GET /users/2
###
GET /users/3
###
GET /users/9
```

## task fa-vuln-owner
```json
{
  "type": "fix-bug",
  "title": "Чужие заказы",
  "xp": 20,
  "packages": ["jwt", "settings", "bcrypt"],
  "readonly": ["deps.py", "config.py", ".env", "users.py"],
  "hints": [
    "Раздел «Проверка владельца: IDOR»: что проверяют, когда маршрут принимает номер объекта.",
    "Покупательница видит и удаляет заказы других людей, а список показывает все заказы. Нужно: чужой заказ даёт `404 Order not found` (как несуществующий) в `GET` и `DELETE`, список возвращает только свои заказы.",
    "Шаблон: `def get_own_order(order_id: int, user: CurrentUser): order = ORDERS.get(order_id); if order is None or order[\"owner\"] != user[\"username\"]: raise HTTPException(status_code=404, …)`. Используйте её в обоих маршрутах; список — `[o for o in ORDERS.values() if o[\"owner\"] == user[\"username\"]]`."
  ],
  "wrong": {
    "only-get": "проверка добавлена только в GET: чужой заказ по-прежнему можно удалить",
    "status-403": "для чужого заказа отвечает 403 вместо 404, и по ответу видно, что заказ существует"
  }
}
```
В магазине три заказа: №1 и №3 принадлежат `ann`, №2 — `bob`. Маршруты (все требуют токен, зависимость `CurrentUser` из `deps.py` уже готова и возвращает `{"username": ..., "role": ...}`):

- `GET /orders` — список заказов текущего пользователя;
- `GET /orders/{order_id}` — заказ целиком;
- `DELETE /orders/{order_id}` — удаляет заказ, ответ `{"deleted": номер}`.

Сейчас любая покупательница видит и удаляет чужие заказы. Исправьте `main.py`: с чужим заказом нужно обращаться так же, как с несуществующим, то есть `404` и `{"detail": "Order not found"}`; в списке только свои заказы (в порядке номеров). Остальные файлы закрыты для правки.

```python starter
from fastapi import FastAPI, HTTPException

from deps import CurrentUser

app = FastAPI()
ORDERS = {
    1: {"id": 1, "owner": "ann", "total": 120},
    2: {"id": 2, "owner": "bob", "total": 45},
    3: {"id": 3, "owner": "ann", "total": 30},
}


@app.get("/orders")
def list_orders(user: CurrentUser):
    return list(ORDERS.values())


@app.get("/orders/{order_id}")
def read_order(order_id: int, user: CurrentUser):
    order = ORDERS.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.delete("/orders/{order_id}")
def delete_order(order_id: int, user: CurrentUser):
    if order_id not in ORDERS:
        raise HTTPException(status_code=404, detail="Order not found")
    del ORDERS[order_id]
    return {"deleted": order_id}
```

```python starter path=deps.py
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

from config import settings
from users import USERS

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> dict:
    error = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise error
    user = USERS.get(payload.get("sub", ""))
    if user is None:
        raise error
    return {"username": payload["sub"], "role": user["role"]}


CurrentUser = Annotated[dict, Depends(get_current_user)]
```

```python starter path=config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")
    secret_key: str


settings = Settings()
```

```python starter path=.env
SECRET_KEY=study-secret-key-not-for-real-use-32b
```

```python starter path=users.py
import bcrypt


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()


USERS = {
    "ann": {"role": "customer", "password_hash": _hash("tulip-field-9")},
    "bob": {"role": "customer", "password_hash": _hash("bob-pass-4455")},
}
```

```python solution
from fastapi import FastAPI, HTTPException

from deps import CurrentUser

app = FastAPI()
ORDERS = {
    1: {"id": 1, "owner": "ann", "total": 120},
    2: {"id": 2, "owner": "bob", "total": 45},
    3: {"id": 3, "owner": "ann", "total": 30},
}


def get_own_order(order_id: int, user: CurrentUser) -> dict:
    order = ORDERS.get(order_id)
    if order is None or order["owner"] != user["username"]:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.get("/orders")
def list_orders(user: CurrentUser):
    return [order for order in ORDERS.values() if order["owner"] == user["username"]]


@app.get("/orders/{order_id}")
def read_order(order_id: int, user: CurrentUser):
    return get_own_order(order_id, user)


@app.delete("/orders/{order_id}")
def delete_order(order_id: int, user: CurrentUser):
    order = get_own_order(order_id, user)
    del ORDERS[order["id"]]
    return {"deleted": order_id}
```

```python solution path=deps.py
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

from config import settings
from users import USERS

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> dict:
    error = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise error
    user = USERS.get(payload.get("sub", ""))
    if user is None:
        raise error
    return {"username": payload["sub"], "role": user["role"]}


CurrentUser = Annotated[dict, Depends(get_current_user)]
```

```python solution path=config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")
    secret_key: str


settings = Settings()
```

```python solution path=.env
SECRET_KEY=study-secret-key-not-for-real-use-32b
```

```python solution path=users.py
import bcrypt


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()


USERS = {
    "ann": {"role": "customer", "password_hash": _hash("tulip-field-9")},
    "bob": {"role": "customer", "password_hash": _hash("bob-pass-4455")},
}
```

```python wrong id=only-get
from fastapi import FastAPI, HTTPException

from deps import CurrentUser

app = FastAPI()
ORDERS = {
    1: {"id": 1, "owner": "ann", "total": 120},
    2: {"id": 2, "owner": "bob", "total": 45},
    3: {"id": 3, "owner": "ann", "total": 30},
}


def get_own_order(order_id: int, user: CurrentUser) -> dict:
    order = ORDERS.get(order_id)
    if order is None or order["owner"] != user["username"]:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.get("/orders")
def list_orders(user: CurrentUser):
    return [order for order in ORDERS.values() if order["owner"] == user["username"]]


@app.get("/orders/{order_id}")
def read_order(order_id: int, user: CurrentUser):
    return get_own_order(order_id, user)


@app.delete("/orders/{order_id}")
def delete_order(order_id: int, user: CurrentUser):
    if order_id not in ORDERS:
        raise HTTPException(status_code=404, detail="Order not found")
    del ORDERS[order_id]
    return {"deleted": order_id}
```

```python wrong id=status-403
from fastapi import FastAPI, HTTPException

from deps import CurrentUser

app = FastAPI()
ORDERS = {
    1: {"id": 1, "owner": "ann", "total": 120},
    2: {"id": 2, "owner": "bob", "total": 45},
    3: {"id": 3, "owner": "ann", "total": 30},
}


def get_own_order(order_id: int, user: CurrentUser) -> dict:
    order = ORDERS.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["owner"] != user["username"]:
        raise HTTPException(status_code=403, detail="Forbidden")
    return order


@app.get("/orders")
def list_orders(user: CurrentUser):
    return [order for order in ORDERS.values() if order["owner"] == user["username"]]


@app.get("/orders/{order_id}")
def read_order(order_id: int, user: CurrentUser):
    return get_own_order(order_id, user)


@app.delete("/orders/{order_id}")
def delete_order(order_id: int, user: CurrentUser):
    order = get_own_order(order_id, user)
    del ORDERS[order["id"]]
    return {"deleted": order_id}
```

```http tests
GET /orders
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.dqSrloOWc3xYATx4Ppo8MlGsH9GirgjlXCdBv4A2Grc
###
GET /orders/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.dqSrloOWc3xYATx4Ppo8MlGsH9GirgjlXCdBv4A2Grc
###
GET /orders/2
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.dqSrloOWc3xYATx4Ppo8MlGsH9GirgjlXCdBv4A2Grc
###
GET /orders/99
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.dqSrloOWc3xYATx4Ppo8MlGsH9GirgjlXCdBv4A2Grc
###
DELETE /orders/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJib2IiLCJleHAiOjQxMDI0NDQ4MDB9.-MQm7N1Jgw-39drhYaKYXDc904ZpvDg1nA5A4BmBYhY
###
GET /orders/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.dqSrloOWc3xYATx4Ppo8MlGsH9GirgjlXCdBv4A2Grc
###
DELETE /orders/3
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.dqSrloOWc3xYATx4Ppo8MlGsH9GirgjlXCdBv4A2Grc
###
GET /orders
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJib2IiLCJleHAiOjQxMDI0NDQ4MDB9.-MQm7N1Jgw-39drhYaKYXDc904ZpvDg1nA5A4BmBYhY
```

## task fa-vuln-hide
```json
{
  "type": "fix-bug",
  "title": "Лишние поля в ответе",
  "xp": 15,
  "hints": [
    "Раздел «Безопасные модели ответа»: отдельный класс ответа с перечнем разрешённых полей.",
    "Нужен новый класс `AccountPublic` с полями `id` и `email`, который не наследует `Account`. Его надо указать в `response_model` обоих маршрутов: и для одной записи, и для списка.",
    "Шаблон: `class AccountPublic(BaseModel): id: int; email: str`; `@app.get(\"/accounts\", response_model=list[AccountPublic])`; `@app.get(\"/accounts/{account_id}\", response_model=AccountPublic)`."
  ],
  "check": {
    "static": [
      { "rule": "response-model-hides", "field": "password_hash", "message": "В модели ответа есть password_hash: хеш пароля уйдёт клиенту." },
      { "rule": "response-model-hides", "field": "internal_note", "message": "В модели ответа есть internal_note: служебная пометка уйдёт клиенту." }
    ]
  },
  "wrong": {
    "only-one": "новая модель подключена к маршруту одной записи, а список по-прежнему отдаёт модель Account",
    "inherits": "модель ответа унаследована от Account и несёт все его поля"
  }
}
```
Сервис отдаёт данные учётных записей: `GET /accounts` (список) и `GET /accounts/{account_id}` (одна запись). Оба маршрута возвращают модель `Account`, в которой есть хеш пароля (`password_hash`) и внутренняя пометка сотрудников (`internal_note`). Клиенту нужны только `id` и `email`.

Сейчас ответы содержат все поля. Исправьте код: опишите отдельную модель ответа с этими двумя полями и подключите её к обоим маршрутам. Хранилище и модель `Account` остаются как есть. Проверка запрашивает список, запись `1` и несуществующую запись (`404` и `{"detail": "Account not found"}`) и сравнивает ответы с эталоном: лишнее поле в ответе — ошибка. Разбор кода дополнительно ищет `password_hash` и `internal_note` в моделях ответа.

```python starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class Account(BaseModel):
    id: int
    email: str
    password_hash: str
    internal_note: str = ""
    is_blocked: bool = False


ACCOUNTS = {
    1: Account(id=1, email="ann@shop.test", password_hash="$2b$04$aaa", internal_note="vip"),
    2: Account(id=2, email="bob@shop.test", password_hash="$2b$04$bbb"),
}


@app.get("/accounts", response_model=list[Account])
def list_accounts():
    return list(ACCOUNTS.values())


@app.get("/accounts/{account_id}", response_model=Account)
def read_account(account_id: int):
    account = ACCOUNTS.get(account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account
```

```python solution
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class Account(BaseModel):
    id: int
    email: str
    password_hash: str
    internal_note: str = ""
    is_blocked: bool = False


class AccountPublic(BaseModel):
    id: int
    email: str


ACCOUNTS = {
    1: Account(id=1, email="ann@shop.test", password_hash="$2b$04$aaa", internal_note="vip"),
    2: Account(id=2, email="bob@shop.test", password_hash="$2b$04$bbb"),
}


@app.get("/accounts", response_model=list[AccountPublic])
def list_accounts():
    return list(ACCOUNTS.values())


@app.get("/accounts/{account_id}", response_model=AccountPublic)
def read_account(account_id: int):
    account = ACCOUNTS.get(account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account
```

```python wrong id=only-one
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class Account(BaseModel):
    id: int
    email: str
    password_hash: str
    internal_note: str = ""
    is_blocked: bool = False


class AccountPublic(BaseModel):
    id: int
    email: str


ACCOUNTS = {
    1: Account(id=1, email="ann@shop.test", password_hash="$2b$04$aaa", internal_note="vip"),
    2: Account(id=2, email="bob@shop.test", password_hash="$2b$04$bbb"),
}


@app.get("/accounts", response_model=list[Account])
def list_accounts():
    return list(ACCOUNTS.values())


@app.get("/accounts/{account_id}", response_model=AccountPublic)
def read_account(account_id: int):
    account = ACCOUNTS.get(account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account
```

```python wrong id=inherits
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class Account(BaseModel):
    id: int
    email: str
    password_hash: str
    internal_note: str = ""
    is_blocked: bool = False


class AccountPublic(Account):
    pass


ACCOUNTS = {
    1: Account(id=1, email="ann@shop.test", password_hash="$2b$04$aaa", internal_note="vip"),
    2: Account(id=2, email="bob@shop.test", password_hash="$2b$04$bbb"),
}


@app.get("/accounts", response_model=list[AccountPublic])
def list_accounts():
    return list(ACCOUNTS.values())


@app.get("/accounts/{account_id}", response_model=AccountPublic)
def read_account(account_id: int):
    account = ACCOUNTS.get(account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account
```

```http tests
GET /accounts
###
GET /accounts/1
###
GET /accounts/9
```

## task fa-vuln-review
```json
{
  "type": "review",
  "title": "Найдите уязвимости",
  "xp": 20,
  "lines": [9, 25, 32],
  "hints": [
    "Шесть вопросов из раздела «Как искать уязвимости в коде»: секреты, сравнение секретов, SQL, владелец, поля.",
    "В коде есть три настоящие проблемы: одна в константах в начале файла, одна в сравнении ключа, одна в запросе к базе. Остальные варианты описывают то, что сделано правильно.",
    "Верные варианты: секреты записаны в коде, API-ключ сравнивается через `==`, SQL склеен из строки пользователя. Хеширование через `bcrypt.checkpw` и `jwt.decode` с `algorithms` — как раз верный способ."
  ],
  "options": [
    "Секреты `SECRET_KEY` и `PAYMENT_KEY` записаны прямо в коде: их увидит каждый, у кого есть репозиторий",
    "SQL-запрос склеен из пользовательской строки f-строкой: возможна SQL-инъекция",
    "API-ключ сравнивается через `==`: по времени ответа его можно подобрать, нужен `hmac.compare_digest`",
    "Пароль проверяется через `bcrypt.checkpw`: этот способ уязвим к перебору, надо сравнивать хеши через `==`",
    "Токен раскодируется через `jwt.decode(..., algorithms=[\"HS256\"])`: список алгоритмов делает проверку небезопасной"
  ],
  "answer": [0, 1, 2],
  "explanation": "Три проблемы: секрет в коде (его нужно читать из настроек и заменить, раз он уже в репозитории), запрос из f-строки (нужны параметры вида `?`, значение передаётся отдельно) и сравнение ключа через `==` (нужен `hmac.compare_digest`). Четвёртый вариант наоборот: `checkpw` и есть правильная проверка, а сравнение хешей через `==` сломало бы вход, потому что у каждого хеша своя соль. Пятый тоже перевёрнут: параметр `algorithms` защищает от подмены алгоритма, а его отсутствие или значение `none` как раз опасно."
}
```
Ниже фрагмент сервиса, который проверяет запросы платёжной системы и ищет заказы в базе. Какие из замечаний к этому коду верны? Выберите все верные.

```python code
import sqlite3

import bcrypt
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.security import OAuth2PasswordBearer

app = FastAPI()
SECRET_KEY = "shop-secret-2026"
PAYMENT_KEY = "pay-4f9c2a7e"
db = sqlite3.connect("shop.db", check_same_thread=False)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def check_login(password: str, stored: bytes) -> bool:
    return bcrypt.checkpw(password.encode(), stored)


def current_email(token: str = Depends(oauth2_scheme)) -> str:
    return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])["sub"]


@app.post("/webhooks/payment")
def payment(x_api_key: str = Header()):
    if x_api_key == PAYMENT_KEY:
        return {"ok": True}
    raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/orders")
def find_orders(email: str = Depends(current_email)):
    rows = db.execute(f"SELECT id, total FROM orders WHERE email = '{email}'").fetchall()
    return [{"id": r[0], "total": r[1]} for r in rows]
```
