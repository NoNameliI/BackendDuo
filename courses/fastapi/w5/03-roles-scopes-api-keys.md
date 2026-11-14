# Текущий пользователь, роли и API-ключи

Покупатель, редактор каталога и администратор открывают один и тот же сайт, но удалять товары может только администратор. Платёжная система присылает на магазин уведомления об оплате, и у неё нет логина: она представляется ключом. В этом уроке вы оформите «кто вы» как зависимость, добавите проверку ролей и защитите маршрут для другой программы ключом API.

Токены и ключ подписи те же, что в прошлом уроке: токен выдаётся входом, проверяется `jwt.decode`, ключ берётся из настроек.

### get_current_user: пользователь как зависимость

В каждом защищённом маршруте нужен «текущий пользователь». Раскодировать токен и искать пользователя в каждом обработчике — повторение. Это делают один раз в зависимости, а маршруты просто просят `user`.

```python
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> dict:
    ...  # раскодировать, найти пользователя, при неудаче 401
    return пользователь


CurrentUser = Annotated[dict, Depends(get_current_user)]


@app.get("/адрес")
def handler(user: CurrentUser):
    ...
```

- `get_current_user` — цепочка зависимостей: сначала `oauth2_scheme` достаёт токен, затем функция проверяет его и возвращает пользователя (из `USERS`, как в прошлом уроке);
- любая неудача в ней — `HTTPException(status_code=401, ...)` с заголовком `WWW-Authenticate: Bearer`: обработчик даже не вызывается;
- `CurrentUser = Annotated[dict, Depends(get_current_user)]` — псевдоним, как `StoreDep` и `SessionDep` из урока про зависимости. Параметр `user: CurrentUser` даёт обработчику словарь пользователя.

### 401 или 403

Два кода отвечают на разные вопросы:

- `401 Unauthorized` — «я не знаю, кто вы»: токена нет, он просрочен или подделан. Клиенту нужно войти заново. Всегда вместе с `WWW-Authenticate`.
- `403 Forbidden` — «я знаю, кто вы, но вам нельзя»: токен верный, роль не подходит. Входить заново бессмысленно.

Путаница в этих кодах ломает клиентов: приложение, получив `401`, отправляет человека на экран входа, а при `403` показывает «нет доступа».

### Роли: require_role

**Роль** — метка пользователя («покупатель», «редактор», «администратор»), по которой решают, что ему разрешено. В примере роль лежит в словаре `USERS`; в токен её можно не класть, и тогда смена роли действует сразу.

Проверку роли удобно сделать зависимостью, которая принимает список допустимых ролей. Для этого нужна «фабрика»: функция, возвращающая функцию.

```python
def require_role(*roles: str):
    def checker(user: CurrentUser) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return user

    return checker
```

- `*roles` — звёздочка собирает все переданные аргументы в кортеж: `require_role("editor", "admin")` даёт `roles == ("editor", "admin")`;
- `checker` — функция внутри функции; она запоминает `roles` из внешней (это называется замыканием);
- `user: CurrentUser` у `checker` — обычная зависимость: сначала проверится токен, потом роль. Без токена будет `401`, с токеном не той роли — `403`;
- `return checker` — фабрика возвращает саму функцию, без скобок.

Подключают так: `Depends(require_role("admin"))` — вызов фабрики даёт функцию `checker`, а `Depends` вызовет её при запросе.

```python
@app.delete("/адрес", dependencies=[Depends(require_role("admin"))])
def handler():
    ...
```

- `dependencies=[Depends(...)]` в декораторе — зависимости, которые выполняются перед обработчиком, но чьё значение ему не нужно. Если пользователь в обработчике нужен, пишут параметр `user: Annotated[dict, Depends(require_role("admin"))]`.

Пример. Блог: редактор удаляет записи, читатель только читает. Токены выпущены заранее с ключом примера (срок — 2100 год), поэтому запросы можно писать готовыми:

```python example
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordBearer

app = FastAPI()
KEY = "demo-key-only-for-this-example-0123456789"
USERS = {"kate": {"role": "editor"}, "tom": {"role": "reader"}}
POSTS = {1: "Hello"}
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]) -> dict:
    error = HTTPException(status_code=401, detail="Invalid token", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, KEY, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise error
    user = USERS.get(payload.get("sub", ""))
    if user is None:
        raise error
    return {"name": payload["sub"], **user}


CurrentUser = Annotated[dict, Depends(get_current_user)]


def require_role(*roles: str):
    def checker(user: CurrentUser) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return user

    return checker


@app.get("/posts")
def list_posts(user: CurrentUser):
    return {"reader": user["name"], "posts": list(POSTS.values())}


@app.delete("/posts/{post_id}")
def delete_post(post_id: int, user: Annotated[dict, Depends(require_role("editor"))]):
    if post_id not in POSTS:
        raise HTTPException(status_code=404, detail="Post not found")
    del POSTS[post_id]
    return {"deleted": post_id, "by": user["name"]}
###
GET /posts
###
GET /posts
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0b20iLCJleHAiOjQxMDI0NDQ4MDB9.fnN2k9lObdng9ldLQY_4c1WdZgvg6kVpW0WPBPnehlA
###
DELETE /posts/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0b20iLCJleHAiOjQxMDI0NDQ4MDB9.fnN2k9lObdng9ldLQY_4c1WdZgvg6kVpW0WPBPnehlA
###
DELETE /posts/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJrYXRlIiwiZXhwIjo0MTAyNDQ0ODAwfQ.XYo0qvnR1_vaou0Ukd2QLf-ygvoDLQbuoa61ywqWMWg
###
DELETE /posts/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJpdmFuIiwiZXhwIjo0MTAyNDQ0ODAwfQ.socgNpzCIC7cuFto1SDW8dYAsHw4wFRlUgQ6vft2hwg
```

Результаты по порядку:

- без токена `GET /posts` — `401`, `Not authenticated`;
- читатель `tom` получает `200` со списком;
- он же на `DELETE` — `403 Not enough permissions`: человек известен, права нет;
- редактор `kate` — `200`, `{"deleted": 1, "by": "kate"}`;
- `ivan` — токен подписан верно, но такого пользователя в `USERS` нет: `401`. Подпись доказывает, что токен выдали вы, но не что пользователь ещё существует.

Роль проверяют на сервере при каждом запросе. Скрытая кнопка «Удалить» в интерфейсе — удобство, а не защита: любой может отправить запрос вручную.

### Scopes: права в токене (идея)

Роль описывает пользователя, а **scope** («область») — что разрешено именно этому токену. Приложение «просмотр заказов» получает токен с правом `orders:read`, а владелец аккаунта, будь он администратором, этим токеном ничего удалить не сможет. Права перечисляют строкой в токене (claim `scope`: `"orders:read orders:write"`), и маршрут требует нужное.

В FastAPI для этого есть `Security(зависимость, scopes=["orders:read"])` и `SecurityScopes`; форма входа передаёт запрошенные права в `form.scopes`, а `OAuth2PasswordBearer(tokenUrl=..., scopes={...})` описывает их в документации. Подробности — в разделе OAuth2 scopes руководства FastAPI. В заданиях курса scopes не нужны: достаточно запомнить различие. **Роль** — кто вы. **Scope** — что разрешено этому токену.

### API-ключ: APIKeyHeader и compare_digest

Другая программа (платёжная система, склад, мониторинг) не вводит пароль. Ей выдают **API-ключ**: длинную случайную строку, которую она присылает в заголовке, например `X-API-Key`. Ключ — секрет, поэтому правила те же, что для пароля и ключа подписи: в коде его нет, он приходит из настроек, а в базе (если ключей много) лежит только хеш ключа.

```python
from fastapi.security import APIKeyHeader

api_key_header = APIKeyHeader(name="X-API-Key")


def verify_api_key(key: Annotated[str, Depends(api_key_header)]) -> None:
    if not hmac.compare_digest(key.encode(), settings.payment_api_key.encode()):
        raise HTTPException(status_code=401, detail="Invalid API key", headers={"WWW-Authenticate": "APIKey"})
```

- `APIKeyHeader(name="X-API-Key")` — зависимость, которая читает заголовок с этим именем. Если его нет, FastAPI сам отвечает `401` и `{"detail": "Not authenticated"}` с заголовком `WWW-Authenticate: APIKey`. Это то же правило, что для токенов: `401` всегда сообщает, какая схема входа нужна, только здесь она называется `APIKey`, а не `Bearer`. Свой `401` оформляйте так же: `headers={"WWW-Authenticate": "APIKey"}`;
- `hmac.compare_digest(a, b)` — сравнение двух значений за **одинаковое время**. Оно из стандартного модуля `hmac`: `import hmac`;
- `.encode()` — строки в байты: так `compare_digest` работает с любыми символами. Обе стороны должны быть одного типа (обе байты).

Почему не `key == settings.payment_api_key`? Обычное `==` останавливается на первом несовпавшем символе. Ключ, который верен на 5 символов, проверяется чуть дольше, чем неверный с первого. Злоумышленник замеряет время ответа тысяч запросов и подбирает ключ символ за символом. `compare_digest` всегда проходит строку целиком. Разница ничтожна, но при большом числе замеров её удаётся выделить, поэтому секреты сравнивают без неё.

```python example
import hmac
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import APIKeyHeader

app = FastAPI()
STOCK_KEY = "stock-key-example-98765"  # в реальном коде: из настроек
api_key_header = APIKeyHeader(name="X-API-Key")


def verify_key(key: Annotated[str, Depends(api_key_header)]) -> None:
    if not hmac.compare_digest(key.encode(), STOCK_KEY.encode()):
        raise HTTPException(status_code=401, detail="Invalid API key", headers={"WWW-Authenticate": "APIKey"})


@app.post("/stock/sync", dependencies=[Depends(verify_key)])
def sync_stock():
    return {"synced": True}
###
POST /stock/sync
###
POST /stock/sync
X-API-Key: stock-key-example-00000
###
POST /stock/sync
X-API-Key: stock-key-example-98765
```

Первый запрос без ключа получает `401` `Not authenticated` от FastAPI. Второй с неверным ключом — `401` `Invalid API key` от вашей проверки. Третий проходит: `200` и `{"synced": true}`.

### Частые ошибки

- Путают коды. Неверно: `403` для «нет токена» или `401` для «не та роль». Верно: `401` — не опознан, `403` — опознан, но нельзя.
- Роль проверяют после действия. Неверно: сначала `del PRODUCTS[id]`, потом `if user["role"] != "admin": raise ...`. Верно: проверка первой строкой, до любых изменений.
- Проверка только в интерфейсе. Неверно: полагаться на то, что кнопки нет. Верно: проверка на сервере в каждом маршруте или зависимости.
- Ключ сравнивают `==`. Неверно: `key == settings.payment_api_key`. Верно: `hmac.compare_digest(key.encode(), ...encode())`.
- Фабрика возвращает результат вызова. Неверно: `return checker(...)` или `Depends(require_role)` без скобок. Верно: `return checker` внутри и `Depends(require_role("admin"))` снаружи.
- Ключ API в коде. Неверно: `API_KEY = "..."` в репозитории. Верно: `settings.payment_api_key` из окружения.

### Шпаргалка

- `get_current_user(token: Annotated[str, Depends(oauth2_scheme)])` → `CurrentUser = Annotated[dict, Depends(get_current_user)]`.
- `401` — кто вы неизвестно (+ `WWW-Authenticate`); `403` — известно, но нельзя.
- `require_role(*roles)` возвращает `checker`; `Depends(require_role("admin"))`; `dependencies=[Depends(...)]` в декораторе.
- Роль проверяют до действия и на сервере.
- Scope — права токена (`Security(..., scopes=[...])`), роль — кто вы.
- `APIKeyHeader(name="X-API-Key")`; нет заголовка — `401 Not authenticated`; свой `401` с `headers={"WWW-Authenticate": "APIKey"}`.
- `hmac.compare_digest(a.encode(), b.encode())` вместо `==` для секретов.

## task fa-role-admin
```json
{
  "type": "fastapi",
  "title": "Удалять товары может только администратор",
  "xp": 15,
  "packages": ["jwt", "settings", "bcrypt"],
  "readonly": ["deps.py", "config.py", ".env", "users.py"],
  "hints": [
    "Разделы «get_current_user: пользователь как зависимость», «401 или 403» и «Роли: require_role». В `deps.py` уже есть `CurrentUser`: просто назовите её в параметрах.",
    "Порядок в `DELETE`: сначала роль (не `admin` — `403` и `Admin only`), потом поиск товара (нет — `404` и `Product not found`), затем удаление и ответ `{\"deleted\": номер}`. Без токена `401` даст сам `CurrentUser`.",
    "Шаблон: `def delete_product(product_id: int, user: CurrentUser): if user[\"role\"] != \"admin\": raise HTTPException(status_code=403, detail=…)`, дальше проверка `product_id not in PRODUCTS` и `del PRODUCTS[product_id]`."
  ],
  "wrong": {
    "any-user": "удалять может любой вошедший пользователь, роль не проверяется",
    "check-after": "товар удаляется до проверки роли: ответ 403, но товар уже пропал"
  }
}
```
В каталоге два товара. `GET /products` открыт всем и возвращает список `[{"id": 1, "name": "Lamp"}, {"id": 2, "name": "Desk"}]`. Напишите `DELETE /products/{product_id}`:

- нет токена — `401` (его даёт зависимость `CurrentUser`);
- пользователь не администратор (`ann`, `eva`) — `403` и `{"detail": "Admin only"}`; роль проверяется первой, даже для несуществующего товара;
- товара нет — `404` и `{"detail": "Product not found"}`;
- иначе товар удаляется, ответ `200` и `{"deleted": номер}`.

Закрыты для правки: `deps.py` (зависимость `CurrentUser`, она возвращает словарь `{"username": ..., "role": ...}`), `config.py`, `.env`, `users.py` (покупательница `ann`, редактор `eva`, администратор `root`).

```python starter
from fastapi import FastAPI, HTTPException

from deps import CurrentUser

app = FastAPI()
PRODUCTS = {1: "Lamp", 2: "Desk"}


@app.get("/products")
def list_products():
    return [{"id": key, "name": name} for key, name in PRODUCTS.items()]


@app.delete("/products/{product_id}")
def delete_product(product_id: int):
    # разрешите удаление только администратору
    ...
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
    "eva": {"role": "editor", "password_hash": _hash("editor-pass-17")},
    "root": {"role": "admin", "password_hash": _hash("root-pass-2026")},
}
```

```python solution
from fastapi import FastAPI, HTTPException

from deps import CurrentUser

app = FastAPI()
PRODUCTS = {1: "Lamp", 2: "Desk"}


@app.get("/products")
def list_products():
    return [{"id": key, "name": name} for key, name in PRODUCTS.items()]


@app.delete("/products/{product_id}")
def delete_product(product_id: int, user: CurrentUser):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    del PRODUCTS[product_id]
    return {"deleted": product_id}
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
    "eva": {"role": "editor", "password_hash": _hash("editor-pass-17")},
    "root": {"role": "admin", "password_hash": _hash("root-pass-2026")},
}
```

```python wrong id=any-user
from fastapi import FastAPI, HTTPException

from deps import CurrentUser

app = FastAPI()
PRODUCTS = {1: "Lamp", 2: "Desk"}


@app.get("/products")
def list_products():
    return [{"id": key, "name": name} for key, name in PRODUCTS.items()]


@app.delete("/products/{product_id}")
def delete_product(product_id: int, user: CurrentUser):
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    del PRODUCTS[product_id]
    return {"deleted": product_id}
```

```python wrong id=check-after
from fastapi import FastAPI, HTTPException

from deps import CurrentUser

app = FastAPI()
PRODUCTS = {1: "Lamp", 2: "Desk"}


@app.get("/products")
def list_products():
    return [{"id": key, "name": name} for key, name in PRODUCTS.items()]


@app.delete("/products/{product_id}")
def delete_product(product_id: int, user: CurrentUser):
    removed = PRODUCTS.pop(product_id, None)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if removed is None:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"deleted": product_id}
```

```http tests
GET /products
###
DELETE /products/1
###
DELETE /products/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.dqSrloOWc3xYATx4Ppo8MlGsH9GirgjlXCdBv4A2Grc
###
DELETE /products/99
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJldmEiLCJleHAiOjQxMDI0NDQ4MDB9.ark9O8YufkrNKIBsqBWHmkUihWdHVaXvMCCEUVhXfg0
###
GET /products
###
DELETE /products/99
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyb290IiwiZXhwIjo0MTAyNDQ0ODAwfQ.uSAGIPOqH1fCBKJQlIiSLXuS3-tdqPTIuslmJPZgI4w
###
DELETE /products/2
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyb290IiwiZXhwIjo0MTAyNDQ0ODAwfQ.uSAGIPOqH1fCBKJQlIiSLXuS3-tdqPTIuslmJPZgI4w
###
GET /products
```

## task fa-role-factory
```json
{
  "type": "refactor",
  "title": "Проверка роли в одном месте",
  "xp": 20,
  "packages": ["jwt", "settings", "bcrypt"],
  "readonly": ["config.py", ".env", "users.py"],
  "hints": [
    "Раздел «Роли: require_role»: функция внутри функции и `Depends(require_role(...))`.",
    "Три маршрута повторяют одну проверку роли. Поведение остаётся прежним: без токена `401`, не та роль — `403` и `Not enough permissions`. Добавьте в `deps.py` фабрику `require_role(*roles)` и подключите её во всех трёх маршрутах.",
    "Шаблон: `def require_role(*roles: str): def checker(user: CurrentUser) -> dict: if user[\"role\"] not in roles: raise HTTPException(status_code=403, …); return user; return checker`; в маршруте — `user: Annotated[dict, Depends(require_role(\"editor\", \"admin\"))]`."
  ],
  "check": {
    "static": [
      { "rule": "uses", "name": "require_role", "file": "main.py", "message": "Подключите фабрику require_role в маршрутах main.py." }
    ]
  },
  "wrong": {
    "admin-only": "фабрика игнорирует переданные роли и пускает только администратора: редактор не может создавать и менять товары",
    "status-401": "при неподходящей роли фабрика отвечает 401 вместо 403"
  }
}
```
Три маршрута каталога проверяют роль одинаковым кодом, скопированным в каждый обработчик. Вынесите проверку в зависимость-фабрику `require_role(*roles)` в `deps.py` и подключите её в `main.py`. Поведение менять нельзя:

- `POST /products` (тело `{"name": ...}`, ответ `201` и `{"id": номер, "name": ...}`) — для ролей `editor` и `admin`;
- `PATCH /products/{product_id}` (тело `{"name": ...}`, ответ `{"id", "name"}`, нет товара — `404` и `{"detail": "Product not found"}`) — для `editor` и `admin`;
- `DELETE /products/{product_id}` (ответ `{"deleted": номер}`, нет товара — `404`) — только для `admin`;
- `GET /products` — открытый список `[{"id": номер, "name": название}]`;
- нет токена — `401`; роль не подходит — `403` и `{"detail": "Not enough permissions"}`.

Проверка сравнивает ответы с эталоном и убеждается, что `main.py` использует `require_role`.

```python starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from deps import CurrentUser

app = FastAPI()
PRODUCTS: dict[int, str] = {}


class ProductIn(BaseModel):
    name: str


@app.post("/products", status_code=201)
def create_product(data: ProductIn, user: CurrentUser):
    if user["role"] not in ("editor", "admin"):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    product_id = len(PRODUCTS) + 1
    PRODUCTS[product_id] = data.name
    return {"id": product_id, "name": data.name}


@app.patch("/products/{product_id}")
def rename_product(product_id: int, data: ProductIn, user: CurrentUser):
    if user["role"] not in ("editor", "admin"):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    PRODUCTS[product_id] = data.name
    return {"id": product_id, "name": data.name}


@app.delete("/products/{product_id}")
def delete_product(product_id: int, user: CurrentUser):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not enough permissions")
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    del PRODUCTS[product_id]
    return {"deleted": product_id}


@app.get("/products")
def list_products():
    return [{"id": key, "name": name} for key, name in PRODUCTS.items()]
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
    "eva": {"role": "editor", "password_hash": _hash("editor-pass-17")},
    "root": {"role": "admin", "password_hash": _hash("root-pass-2026")},
}
```

```python solution
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from deps import require_role

app = FastAPI()
PRODUCTS: dict[int, str] = {}
Staff = Annotated[dict, Depends(require_role("editor", "admin"))]
AdminOnly = Annotated[dict, Depends(require_role("admin"))]


class ProductIn(BaseModel):
    name: str


@app.post("/products", status_code=201)
def create_product(data: ProductIn, user: Staff):
    product_id = len(PRODUCTS) + 1
    PRODUCTS[product_id] = data.name
    return {"id": product_id, "name": data.name}


@app.patch("/products/{product_id}")
def rename_product(product_id: int, data: ProductIn, user: Staff):
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    PRODUCTS[product_id] = data.name
    return {"id": product_id, "name": data.name}


@app.delete("/products/{product_id}")
def delete_product(product_id: int, user: AdminOnly):
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    del PRODUCTS[product_id]
    return {"deleted": product_id}


@app.get("/products")
def list_products():
    return [{"id": key, "name": name} for key, name in PRODUCTS.items()]
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


def require_role(*roles: str):
    def checker(user: CurrentUser) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return user

    return checker
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
    "eva": {"role": "editor", "password_hash": _hash("editor-pass-17")},
    "root": {"role": "admin", "password_hash": _hash("root-pass-2026")},
}
```

```python wrong id=admin-only path=deps.py
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


def require_role(*roles: str):
    def checker(user: CurrentUser) -> dict:
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return user

    return checker
```

```python wrong id=status-401 path=deps.py
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


def require_role(*roles: str):
    def checker(user: CurrentUser) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status_code=401, detail="Not enough permissions")
        return user

    return checker
```

```http tests
POST /products
Content-Type: application/json

{"name": "Lamp"}
###
POST /products
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.dqSrloOWc3xYATx4Ppo8MlGsH9GirgjlXCdBv4A2Grc
Content-Type: application/json

{"name": "Lamp"}
###
POST /products
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJldmEiLCJleHAiOjQxMDI0NDQ4MDB9.ark9O8YufkrNKIBsqBWHmkUihWdHVaXvMCCEUVhXfg0
Content-Type: application/json

{"name": "Lamp"}
###
PATCH /products/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJldmEiLCJleHAiOjQxMDI0NDQ4MDB9.ark9O8YufkrNKIBsqBWHmkUihWdHVaXvMCCEUVhXfg0
Content-Type: application/json

{"name": "Desk lamp"}
###
PATCH /products/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.dqSrloOWc3xYATx4Ppo8MlGsH9GirgjlXCdBv4A2Grc
Content-Type: application/json

{"name": "Hacked"}
###
GET /products
###
DELETE /products/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJldmEiLCJleHAiOjQxMDI0NDQ4MDB9.ark9O8YufkrNKIBsqBWHmkUihWdHVaXvMCCEUVhXfg0
###
DELETE /products/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyb290IiwiZXhwIjo0MTAyNDQ0ODAwfQ.uSAGIPOqH1fCBKJQlIiSLXuS3-tdqPTIuslmJPZgI4w
###
PATCH /products/1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyb290IiwiZXhwIjo0MTAyNDQ0ODAwfQ.uSAGIPOqH1fCBKJQlIiSLXuS3-tdqPTIuslmJPZgI4w
Content-Type: application/json

{"name": "Ghost"}
###
GET /products
```

## task fa-api-key
```json
{
  "type": "fastapi",
  "title": "Уведомление платёжной системы",
  "xp": 20,
  "packages": ["settings"],
  "readonly": ["config.py", ".env"],
  "hints": [
    "Раздел «API-ключ: APIKeyHeader и compare_digest». Заголовок читает `APIKeyHeader(name=\"X-API-Key\")`, а ключ из настроек — `settings.payment_api_key`.",
    "Нет заголовка — `401 Not authenticated` ответит сам `APIKeyHeader`. Неверный ключ — `401`, `Invalid API key` и заголовок `WWW-Authenticate: APIKey`; сравнивайте через `hmac.compare_digest` на байтах. Подключите проверку к маршруту через `dependencies=[Depends(...)]`.",
    "Шаблон: `def verify_api_key(key: Annotated[str, Depends(api_key_header)]): if not hmac.compare_digest(key.encode(), settings.payment_api_key.encode()): raise HTTPException(status_code=401, detail=…)`; `@app.post(\"/webhooks/payment\", dependencies=[Depends(verify_api_key)])`."
  ],
  "check": {
    "headers": ["www-authenticate"],
    "code": [
      { "pattern": "payment_api_key\\s*[!=]=|[!=]=\\s*settings\\.payment_api_key", "forbid": true, "message": "Ключ сравнивается через == или !=: используйте hmac.compare_digest." },
      { "pattern": "compare_digest", "message": "Сравнивайте ключи через hmac.compare_digest: обычное == выдаёт время сравнения." },
      { "pattern": "payment_api_key", "message": "Берите ключ из настроек: settings.payment_api_key." }
    ]
  },
  "wrong": {
    "plain-eq": "ключи сравниваются через ==, время ответа зависит от числа верных символов",
    "no-check": "заголовок читается, но неверный ключ тоже принимается"
  }
}
```
Платёжная система присылает в магазин уведомления `POST /webhooks/payment` с телом `{"order_id": число, "status": "paid" или "failed"}` и заголовком `X-API-Key`. Правильный ключ хранится в настройках: поле `payment_api_key` объекта `settings` (файлы `config.py` и `.env` готовы и закрыты для правки).

Поведение:

- заголовка нет — `401` и `{"detail": "Not authenticated"}`;
- ключ неверный — `401`, `{"detail": "Invalid API key"}` и заголовок `WWW-Authenticate: APIKey` (как у ответа без заголовка);
- ключ верный — `200` и `{"order_id": номер, "accepted": true}`;
- тело неверно (нет `order_id`, статус не из двух) — `422`.

Ключ нужно сравнивать через `hmac.compare_digest`: проверка кода это проверит.

```python starter
import hmac
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import APIKeyHeader
from pydantic import BaseModel

from config import settings

app = FastAPI()


class PaymentEvent(BaseModel):
    order_id: int
    status: Literal["paid", "failed"]


@app.post("/webhooks/payment")
def payment_webhook(event: PaymentEvent):
    # проверьте ключ из заголовка X-API-Key
    return {"order_id": event.order_id, "accepted": True}
```

```python starter path=config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")
    payment_api_key: str


settings = Settings()
```

```python starter path=.env
PAYMENT_API_KEY=pay-key-4f9c2a7e
```

```python solution
import hmac
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import APIKeyHeader
from pydantic import BaseModel

from config import settings

app = FastAPI()
api_key_header = APIKeyHeader(name="X-API-Key")


class PaymentEvent(BaseModel):
    order_id: int
    status: Literal["paid", "failed"]


def verify_api_key(key: Annotated[str, Depends(api_key_header)]) -> None:
    if not hmac.compare_digest(key.encode(), settings.payment_api_key.encode()):
        raise HTTPException(status_code=401, detail="Invalid API key", headers={"WWW-Authenticate": "APIKey"})


@app.post("/webhooks/payment", dependencies=[Depends(verify_api_key)])
def payment_webhook(event: PaymentEvent):
    return {"order_id": event.order_id, "accepted": True}
```

```python solution path=config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")
    payment_api_key: str


settings = Settings()
```

```python solution path=.env
PAYMENT_API_KEY=pay-key-4f9c2a7e
```

```python wrong id=plain-eq
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import APIKeyHeader
from pydantic import BaseModel

from config import settings

app = FastAPI()
api_key_header = APIKeyHeader(name="X-API-Key")


class PaymentEvent(BaseModel):
    order_id: int
    status: Literal["paid", "failed"]


def verify_api_key(key: Annotated[str, Depends(api_key_header)]) -> None:
    if key != settings.payment_api_key:
        raise HTTPException(status_code=401, detail="Invalid API key", headers={"WWW-Authenticate": "APIKey"})


@app.post("/webhooks/payment", dependencies=[Depends(verify_api_key)])
def payment_webhook(event: PaymentEvent):
    return {"order_id": event.order_id, "accepted": True}
```

```python wrong id=no-check
import hmac
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import APIKeyHeader
from pydantic import BaseModel

from config import settings

app = FastAPI()
api_key_header = APIKeyHeader(name="X-API-Key")


class PaymentEvent(BaseModel):
    order_id: int
    status: Literal["paid", "failed"]


def verify_api_key(key: Annotated[str, Depends(api_key_header)]) -> None:
    hmac.compare_digest(key.encode(), settings.payment_api_key.encode())


@app.post("/webhooks/payment", dependencies=[Depends(verify_api_key)])
def payment_webhook(event: PaymentEvent):
    return {"order_id": event.order_id, "accepted": True}
```

```http tests
POST /webhooks/payment
Content-Type: application/json

{"order_id": 17, "status": "paid"}
###
POST /webhooks/payment
X-API-Key: pay-key-0000000
Content-Type: application/json

{"order_id": 17, "status": "paid"}
###
POST /webhooks/payment
X-API-Key: pay-key-4f9c2a7e
Content-Type: application/json

{"order_id": 17, "status": "paid"}
###
POST /webhooks/payment
X-API-Key: pay-key-4f9c2a7e
Content-Type: application/json

{"order_id": 17, "status": "lost"}
```

## task fa-roles-choice
```json
{
  "type": "choice",
  "title": "401 или 403",
  "xp": 10,
  "hints": [
    "Раздел «401 или 403»: какой вопрос решает каждый код.",
    "Сервер читает токен, подпись верна, пользователь найден. Вопрос уже не «кто вы», а «можно ли вам это».",
    "Пользователь опознан, значит `401` не подходит. Опознанному, но не имеющему права, отвечают `403`."
  ],
  "options": [
    "`403`: пользователь опознан, но его роль не позволяет это действие",
    "`401`: у пользователя нет прав, а значит он не авторизован",
    "`404`: лучше сделать вид, что маршрута не существует для всех, кроме администраторов",
    "`200` с пустым телом: так сервер не раскрывает наличие маршрута"
  ],
  "answer": [0],
  "explanation": "`401` означает «не знаю, кто вы» (нет токена, он просрочен или подделан), и клиент должен войти заново. Здесь пользователь известен, поэтому нужен `403`: вход заново ничего не изменит. `404` вместо `403` иногда используют, чтобы скрыть сам факт существования ресурса, но для обычного административного маршрута это путает клиентов и логи. `200` с пустым телом вводит клиента в заблуждение: он решит, что действие выполнено."
}
```
Покупательница с верным токеном отправляет `DELETE /products/1`, а удалять товары может только администратор. Какой ответ правильный?
