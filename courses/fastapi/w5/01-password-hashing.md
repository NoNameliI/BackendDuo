# Пароли: хеширование и вход

У интернет-магазина утекла база данных. Если в ней лежали пароли как есть, злоумышленник сразу входит в чужие аккаунты, а люди часто используют один пароль на нескольких сайтах. Если лежали хеши, у него в руках только набор строк, из которых пароль восстанавливается долго и дорого. В этом уроке вы научитесь хранить пароли так, чтобы утечка базы не превращалась в утечку паролей, и сделаете регистрацию и вход.

Пользователей здесь хранит обычный словарь в памяти: так проще видеть суть. В следующих уроках к нему добавятся токены и роли.

### Почему нельзя хранить пароль как есть

Правило одно: сервер не должен уметь прочитать пароль пользователя. Это защищает от трёх бед:

- утечка базы или резервной копии: пароли не попадают к посторонним;
- администратор или разработчик с доступом к базе не видит чужих паролей;
- ошибка в логах или в ответе API не раскрывает пароль.

Но сервер должен проверять, что введён верный пароль. Для этого хранят не пароль, а его **хеш**: результат функции, которую легко посчитать в одну сторону и нельзя «развернуть» обратно. При входе хешируют введённый пароль и сравнивают результаты.

### Хеш, соль и «просто sha256»

Хеш-функция из учебников (`sha256`, `md5`) быстрая. Это хорошо для проверки файлов и плохо для паролей: видеокарта перебирает миллиарды таких хешей в секунду. Есть ещё одна проблема: у одинаковых паролей одинаковые хеши. Злоумышленник видит в базе два одинаковых значения и знает, что у двух людей один пароль; а по готовой таблице «пароль → хеш» вскрывает самые частые сразу.

Для паролей нужны две вещи:

- **соль** — случайная строка, которая добавляется к паролю перед хешированием и хранится рядом с хешем. У двух людей с одним паролем хеши получаются разными, а готовые таблицы бесполезны;
- **медленный алгоритм** с настраиваемой «ценой»: `bcrypt`, `argon2`, `scrypt`. Один хеш считается десятки миллисекунд, пользователь этого не замечает, а перебор миллиардов вариантов становится невозможным.

Сравните на примере. Библиотека `bcrypt` готова в уроке; разберём её вызовы ниже, пока смотрите на результат:

```python example
import hashlib

import bcrypt
from fastapi import FastAPI

app = FastAPI()


@app.get("/compare")
def compare():
    fast_a = hashlib.sha256(b"summer2026").hexdigest()
    fast_b = hashlib.sha256(b"summer2026").hexdigest()
    slow_a = bcrypt.hashpw(b"summer2026", bcrypt.gensalt(rounds=4))
    slow_b = bcrypt.hashpw(b"summer2026", bcrypt.gensalt(rounds=4))
    return {
        "sha256_equal": fast_a == fast_b,
        "sha256_length": len(fast_a),
        "bcrypt_equal": slow_a == slow_b,
        "bcrypt_prefix": slow_a[:7].decode(),
        "bcrypt_length": len(slow_a),
        "check_right": bcrypt.checkpw(b"summer2026", slow_a),
        "check_wrong": bcrypt.checkpw(b"summer2027", slow_a),
    }
###
GET /compare
```

`sha256` дал одинаковый результат дважды, а `bcrypt` для того же пароля — разные хеши, потому что при каждом вызове выбрана новая соль. Но проверка `checkpw` всё равно узнаёт верный пароль и отвергает неверный. Как это возможно, объясняет следующий раздел.

### bcrypt: hashpw и checkpw

`bcrypt` — проверенный алгоритм для паролей. В студии доступна настоящая библиотека `bcrypt`, она подключается к заданиям урока.

```python
import bcrypt

хеш = bcrypt.hashpw(пароль_в_байтах, bcrypt.gensalt(rounds=число))
верно = bcrypt.checkpw(пароль_в_байтах, хеш)
```

- `bcrypt.gensalt(rounds=число)` — создаёт случайную соль и задаёт цену (о ней ниже);
- `bcrypt.hashpw(пароль, соль)` — считает хеш. Результат — байты длиной 60: `$2b$04$` (версия и цена), затем соль и сам хеш. Соль лежит внутри строки;
- `bcrypt.checkpw(пароль, хеш)` — берёт соль и цену из старого хеша, хеширует пароль так же и сравнивает. Возвращает `True` или `False`.

Библиотека работает с **байтами**, а не со строками. Строку превращают в байты методом `.encode()`, а байты хеша для хранения в строку — `.decode()`:

```python
password = "tulip-field-9"
hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()
bcrypt.checkpw("tulip-field-9".encode(), hashed.encode())
```

- `password.encode()` — строка в байты (кодировка UTF-8);
- `.decode()` после `hashpw` — байты в строку, чтобы хранить хеш в словаре, JSON или базе текстом;
- `hashed.encode()` — обратно в байты перед `checkpw`.

Почему нельзя написать `bcrypt.hashpw(password, соль) == hashed`? Соль каждый раз новая, и результаты не совпадут никогда. Для проверки есть только `checkpw`: он использует соль из сохранённого хеша.

Ограничение: bcrypt смотрит только на первые 72 байта пароля, а библиотека версии 5 на более длинный пароль отвечает ошибкой `ValueError`. Поэтому длину пароля при регистрации ограничивают: `Field(max_length=72)`. Для паролей из латиницы символ равен байту; для кириллицы байтов вдвое больше, и в настоящем сервисе длину считают в байтах.

### Сколько раундов

Параметр `rounds` — это логарифм: цена `rounds=12` в два раза выше, чем `rounds=11`, и в 256 раз выше, чем `rounds=4`. Чем больше, тем дольше хеширование и тем дороже перебор.

- В настоящем сервисе берут 12 и больше: хеширование занимает порядка 0,25 секунды. Для вашего сервера это допустимая нагрузка, для злоумышленника перебор остаётся неподъёмным.
- В заданиях студии стоит `rounds=4`: это минимум, он нужен, чтобы проверка сотни запросов не тормозила. Такие хеши в жизни использовать нельзя.

Значение по умолчанию у `bcrypt.gensalt()` — 12, поэтому в боевом коде `rounds` обычно не пишут вовсе.

### Argon2 и pwdlib (теория)

Новым проектам рекомендуют **Argon2**: он не только медленный, но и требовательный к памяти, что мешает перебору на видеокартах. Официальное руководство FastAPI использует для него пакет `pwdlib`. В студии он недоступен (Argon2 слишком медленный для проверок), поэтому только код для локальной работы:

```sh
pip install "pwdlib[argon2]"
```

```python
from pwdlib import PasswordHash

password_hash = PasswordHash.recommended()
hashed = password_hash.hash("tulip-field-9")
password_hash.verify("tulip-field-9", hashed)
```

- `PasswordHash.recommended()` — объект с рекомендуемыми настройками (Argon2);
- `.hash(пароль)` — строка с хешем, соль внутри;
- `.verify(пароль, хеш)` — `True` или `False`, как `checkpw`.

Идея та же: хеш медленный, с солью, проверка через специальную функцию. Старый пакет `passlib` больше не развивается, новый код на нём не пишут.

### Регистрация и вход

Регистрация принимает пароль, сохраняет хеш и отвечает без пароля и без хеша. Вход ищет хеш и сверяет пароль. Пример со своими словами: блог принимает авторов по адресу почты.

```python example
import bcrypt
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
AUTHORS: dict[str, str] = {}


class Signup(BaseModel):
    email: str
    secret: str = Field(min_length=8, max_length=72)


@app.post("/signup", status_code=201)
def signup(data: Signup):
    if data.email in AUTHORS:
        raise HTTPException(status_code=409, detail="Email already used")
    salt = bcrypt.gensalt(rounds=4)
    AUTHORS[data.email] = bcrypt.hashpw(data.secret.encode(), salt).decode()
    return {"email": data.email}


@app.post("/signin")
def signin(data: Signup):
    stored = AUTHORS.get(data.email)
    if stored is None or not bcrypt.checkpw(data.secret.encode(), stored.encode()):
        raise HTTPException(status_code=401, detail="Wrong email or password")
    return {"welcome": data.email}
###
POST /signup
Content-Type: application/json

{"email": "kate@blog.test", "secret": "paper-boat-31"}
###
POST /signup
Content-Type: application/json

{"email": "kate@blog.test", "secret": "paper-boat-31"}
###
POST /signin
Content-Type: application/json

{"email": "kate@blog.test", "secret": "paper-boat-31"}
###
POST /signin
Content-Type: application/json

{"email": "kate@blog.test", "secret": "paper-boat-99"}
###
POST /signin
Content-Type: application/json

{"email": "nobody@blog.test", "secret": "paper-boat-31"}
```

Ответы по порядку: `201` с `{"email": "kate@blog.test"}`; `409`: адрес уже занят; `200` с `{"welcome": "kate@blog.test"}`; `401` на неверный пароль; `401` на неизвестный адрес.

Что здесь важно:

- ответ регистрации содержит только `email`: ни пароля, ни хеша. Если вернуть сохранённую запись целиком, хеш уйдёт клиенту, а по хешу можно подбирать пароль на своём компьютере. Модель ответа и `response_model` из второго мира убирают поля из ответа, об этом ещё будет урок «Безопасные модели»;
- вход отвечает одинаково (`401`, одно и то же сообщение) и на неверный пароль, и на неизвестное имя. Если отвечать по-разному, злоумышленник перебирает имена и узнаёт, кто у вас зарегистрирован;
- `stored is None or not bcrypt.checkpw(...)`: если пользователя нет, `checkpw` не вызывается. Порядок важен: `or` останавливается на первом истинном условии.

Есть тонкость: на несуществующее имя ответ приходит быстрее, чем на неверный пароль (хеш не считается), и по времени можно угадать имена. Это защищают тем, что для несуществующего пользователя тоже считают хеш «пустышки». Для учебных заданий достаточно одинакового ответа.

### Частые ошибки

- Хеш сравнивают через `==`. Неверно: `bcrypt.hashpw(пароль, bcrypt.gensalt()) == хеш` (соль новая, результат всегда разный). Верно: `bcrypt.checkpw(пароль.encode(), хеш.encode())`.
- Строку передают в bcrypt без `.encode()`. Неверно: `bcrypt.hashpw("секрет", salt)` — ошибка `TypeError`. Верно: `"секрет".encode()`.
- Хеш возвращают клиенту. Неверно: `return USERS[name]` или модель с полем `password_hash` в ответе. Верно: отдельная модель ответа без этого поля.
- Быстрый хеш вместо медленного. Неверно: `hashlib.sha256(пароль).hexdigest()`. Верно: `bcrypt` (или Argon2): быстрая функция даёт перебор в миллиарды попыток в секунду.
- Разные ответы на «нет такого пользователя» и «неверный пароль». Верно: одинаковые `401` и текст.

### Шпаргалка

- Хранят хеш, не пароль; хеш для паролей — медленный и с солью.
- `bcrypt.hashpw(пароль.encode(), bcrypt.gensalt(rounds=12))` → байты длиной 60; `.decode()` для хранения.
- `bcrypt.checkpw(пароль.encode(), хеш.encode())` → `True` или `False`; сравнивать `==` нельзя.
- В студии `rounds=4`, в жизни 12 и больше (или Argon2 через `pwdlib`).
- Пароль не длиннее 72 байт: `Field(max_length=72)`.
- Ответ регистрации без пароля и хеша; вход отвечает одинаково на «нет пользователя» и «неверный пароль».

## task fa-pw-register
```json
{
  "type": "fastapi",
  "title": "Регистрация и вход покупателя",
  "xp": 15,
  "packages": ["bcrypt"],
  "hints": [
    "Разделы «bcrypt: hashpw и checkpw» и «Регистрация и вход»: пароль превращают в байты, хешируют, хеш хранят строкой.",
    "Регистрация: имя занято — 409 с `Username taken`; иначе сохраните хеш в `USERS` и верните только имя. Вход: нет имени или `checkpw` вернул `False` — 401 с `Invalid credentials` (одинаково для обоих случаев).",
    "Шаблон: `hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=4)).decode()`; `if stored is None or not bcrypt.checkpw(data.password.encode(), stored.encode()): raise HTTPException(status_code=401, detail=…)`."
  ],
  "check": {
    "code": [
      { "pattern": "bcrypt\\.hashpw", "message": "Пароль нельзя хранить открытым текстом: сохраните результат bcrypt.hashpw." },
      { "pattern": "bcrypt\\.checkpw", "message": "Проверяйте пароль через bcrypt.checkpw." },
      { "pattern": "USERS\\[[^\\]]+\\]\\s*=\\s*data\\.password\\b", "forbid": true, "message": "В USERS записан пароль открытым текстом: сохраняйте хеш." },
      { "pattern": "hashlib|sha256|md5", "forbid": true, "message": "Быстрые хеши для паролей не годятся: используйте bcrypt." }
    ]
  },
  "wrong": {
    "plain-text": "пароль хранится открытым текстом и сравнивается через ==",
    "user-404": "на неизвестное имя вход отвечает 404, и по ответу можно узнать, кто зарегистрирован"
  }
}
```
Магазину нужны регистрация и вход покупателей. Пользователи лежат в словаре `USERS` (имя → хеш пароля). Реализуйте два маршрута.

`POST /register` с телом `{"username": ..., "password": ...}`:

- имя должно быть не короче 3 символов, пароль — от 8 до 72 символов, иначе `422` (модель `Credentials` уже описана);
- если имя занято — `409` и `{"detail": "Username taken"}`;
- иначе пароль хешируется bcrypt с `rounds=4`, хеш в виде строки записывается в `USERS`, ответ — `201` и `{"username": имя}`.

`POST /login` с таким же телом:

- верный пароль — `200` и `{"status": "ok"}`;
- неизвестное имя или неверный пароль — `401` и `{"detail": "Invalid credentials"}`, одинаково в обоих случаях.

Хранить пароль открытым текстом нельзя: проверка кода требует `bcrypt.hashpw` и `bcrypt.checkpw`.

```python starter
import bcrypt
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
USERS: dict[str, str] = {}


class Credentials(BaseModel):
    username: str = Field(min_length=3)
    password: str = Field(min_length=8, max_length=72)


@app.post("/register", status_code=201)
def register(data: Credentials):
    # проверьте, что имя свободно, и сохраните хеш пароля
    ...


@app.post("/login")
def login(data: Credentials):
    # найдите хеш пользователя и сверьте пароль
    ...
```

```python solution
import bcrypt
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
USERS: dict[str, str] = {}


class Credentials(BaseModel):
    username: str = Field(min_length=3)
    password: str = Field(min_length=8, max_length=72)


@app.post("/register", status_code=201)
def register(data: Credentials):
    if data.username in USERS:
        raise HTTPException(status_code=409, detail="Username taken")
    hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=4))
    USERS[data.username] = hashed.decode()
    return {"username": data.username}


@app.post("/login")
def login(data: Credentials):
    stored = USERS.get(data.username)
    if stored is None or not bcrypt.checkpw(data.password.encode(), stored.encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"status": "ok"}
```

```python wrong id=plain-text
import bcrypt
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
USERS: dict[str, str] = {}


class Credentials(BaseModel):
    username: str = Field(min_length=3)
    password: str = Field(min_length=8, max_length=72)


@app.post("/register", status_code=201)
def register(data: Credentials):
    if data.username in USERS:
        raise HTTPException(status_code=409, detail="Username taken")
    USERS[data.username] = data.password
    return {"username": data.username}


@app.post("/login")
def login(data: Credentials):
    if USERS.get(data.username) != data.password:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"status": "ok"}
```

```python wrong id=user-404
import bcrypt
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
USERS: dict[str, str] = {}


class Credentials(BaseModel):
    username: str = Field(min_length=3)
    password: str = Field(min_length=8, max_length=72)


@app.post("/register", status_code=201)
def register(data: Credentials):
    if data.username in USERS:
        raise HTTPException(status_code=409, detail="Username taken")
    hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=4))
    USERS[data.username] = hashed.decode()
    return {"username": data.username}


@app.post("/login")
def login(data: Credentials):
    stored = USERS.get(data.username)
    if stored is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not bcrypt.checkpw(data.password.encode(), stored.encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"status": "ok"}
```

```http tests
POST /register
Content-Type: application/json

{"username": "ann", "password": "correct-horse"}
###
POST /register
Content-Type: application/json

{"username": "ann", "password": "another-pass1"}
###
POST /register
Content-Type: application/json

{"username": "bob", "password": "short"}
###
POST /login
Content-Type: application/json

{"username": "ann", "password": "correct-horse"}
###
POST /login
Content-Type: application/json

{"username": "ann", "password": "wrong-horse-1"}
###
POST /login
Content-Type: application/json

{"username": "zed", "password": "correct-horse"}
```

## task fa-pw-verify
```json
{
  "type": "fix-bug",
  "title": "Вход всегда отвечает 401",
  "xp": 15,
  "packages": ["bcrypt"],
  "hints": [
    "Раздел «bcrypt: hashpw и checkpw»: почему результат `hashpw` с новой солью нельзя сравнивать с сохранённым хешем.",
    "Покупательница `ann` с паролем `tulip-field-9` создана при запуске, но вход с верным паролем отвечает 401. Ошибка в функции `verify_password` из `security.py`.",
    "Шаблон: `return bcrypt.checkpw(password.encode(), hashed.encode())`. Менять нужно только `security.py`."
  ],
  "readonly": ["main.py"],
  "wrong": {
    "plain-compare": "пароль сравнивается с хешем напрямую, верный пароль по-прежнему отвергается",
    "always-true": "функция всегда возвращает True, и в систему входят с любым паролем"
  }
}
```
В магазине есть покупательница `ann` с паролем `tulip-field-9`: её хеш создаётся при запуске. `POST /login` должен отвечать `200` и `{"status": "ok"}` на верный пароль и `401` с `{"detail": "Invalid credentials"}` на неверный или неизвестное имя. Сейчас даже верный пароль отвергается.

Найдите причину и исправьте `security.py`. `main.py` менять нельзя: маршрут написан верно.

```python starter path=main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from security import hash_password, verify_password

app = FastAPI()
USERS = {"ann": hash_password("tulip-field-9")}


class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/login")
def login(data: LoginIn):
    hashed = USERS.get(data.username)
    if hashed is None or not verify_password(data.password, hashed):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"status": "ok"}
```

```python starter path=security.py
import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode() == hashed
```

```python solution path=main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from security import hash_password, verify_password

app = FastAPI()
USERS = {"ann": hash_password("tulip-field-9")}


class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/login")
def login(data: LoginIn):
    hashed = USERS.get(data.username)
    if hashed is None or not verify_password(data.password, hashed):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"status": "ok"}
```

```python solution path=security.py
import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())
```

```python wrong id=plain-compare path=security.py
import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()


def verify_password(password: str, hashed: str) -> bool:
    return password == hashed
```

```python wrong id=always-true path=security.py
import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=4)).decode()


def verify_password(password: str, hashed: str) -> bool:
    return True
```

```http tests
POST /login
Content-Type: application/json

{"username": "ann", "password": "tulip-field-9"}
###
POST /login
Content-Type: application/json

{"username": "ann", "password": "tulip-field-0"}
###
POST /login
Content-Type: application/json

{"username": "zed", "password": "tulip-field-9"}
```

## task fa-pw-leak
```json
{
  "type": "fix-bug",
  "title": "Хеш в ответе",
  "xp": 15,
  "packages": ["bcrypt"],
  "hints": [
    "Раздел «Регистрация и вход»: ответ не должен содержать ни пароль, ни хеш. Модели ответа и `response_model` вы уже видели в уроке про модели In/Out.",
    "Оба маршрута отдают модель `Customer` вместе с полем `password_hash`. Нужна вторая модель для ответа, и подключить её надо к обоим маршрутам, не к одному.",
    "Шаблон: в `schemas.py` — `class CustomerOut(BaseModel): id: int; email: str`; в `main.py` — `@app.post(\"/customers\", status_code=201, response_model=CustomerOut)` и `@app.get(\"/customers/{customer_id}\", response_model=CustomerOut)`."
  ],
  "check": {
    "static": [
      { "rule": "response-model-hides", "field": "password_hash", "message": "Модель ответа содержит поле password_hash: опишите отдельную модель ответа без него." }
    ]
  },
  "wrong": {
    "only-create": "хеш убран из ответа регистрации, но чтение покупателя по номеру по-прежнему его отдаёт",
    "only-read": "хеш убран из чтения покупателя, но ответ регистрации по-прежнему его содержит"
  }
}
```
Маршрут `POST /customers` создаёт покупателя (адрес почты и пароль, который сохраняется хешем), а `GET /customers/{customer_id}` возвращает его. Сейчас оба ответа содержат поле `password_hash`: хеш пароля уходит клиенту.

Нужно, чтобы оба ответа содержали только `id` и `email`: регистрация отвечает `201` и `{"id": 1, "email": ...}`, чтение — `200` и то же самое; для неизвестного номера — `404` и `{"detail": "Customer not found"}`. В хранилище по-прежнему лежит полная запись с хешем.

Проверка разбирает код и находит модели ответа, в которых есть поле `password_hash`.

```python starter path=schemas.py
from pydantic import BaseModel


class CustomerIn(BaseModel):
    email: str
    password: str


class Customer(BaseModel):
    id: int
    email: str
    password_hash: str
```

```python starter path=main.py
import bcrypt
from fastapi import FastAPI, HTTPException

from schemas import Customer, CustomerIn

app = FastAPI()
CUSTOMERS: dict[int, Customer] = {}


@app.post("/customers", status_code=201, response_model=Customer)
def create_customer(data: CustomerIn):
    hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=4)).decode()
    customer = Customer(id=len(CUSTOMERS) + 1, email=data.email, password_hash=hashed)
    CUSTOMERS[customer.id] = customer
    return customer


@app.get("/customers/{customer_id}", response_model=Customer)
def read_customer(customer_id: int):
    customer = CUSTOMERS.get(customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer
```

```python solution path=schemas.py
from pydantic import BaseModel


class CustomerIn(BaseModel):
    email: str
    password: str


class Customer(BaseModel):
    id: int
    email: str
    password_hash: str


class CustomerOut(BaseModel):
    id: int
    email: str
```

```python solution path=main.py
import bcrypt
from fastapi import FastAPI, HTTPException

from schemas import Customer, CustomerIn, CustomerOut

app = FastAPI()
CUSTOMERS: dict[int, Customer] = {}


@app.post("/customers", status_code=201, response_model=CustomerOut)
def create_customer(data: CustomerIn):
    hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=4)).decode()
    customer = Customer(id=len(CUSTOMERS) + 1, email=data.email, password_hash=hashed)
    CUSTOMERS[customer.id] = customer
    return customer


@app.get("/customers/{customer_id}", response_model=CustomerOut)
def read_customer(customer_id: int):
    customer = CUSTOMERS.get(customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer
```

```python wrong id=only-create path=main.py
import bcrypt
from fastapi import FastAPI, HTTPException

from schemas import Customer, CustomerIn, CustomerOut

app = FastAPI()
CUSTOMERS: dict[int, Customer] = {}


@app.post("/customers", status_code=201, response_model=CustomerOut)
def create_customer(data: CustomerIn):
    hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=4)).decode()
    customer = Customer(id=len(CUSTOMERS) + 1, email=data.email, password_hash=hashed)
    CUSTOMERS[customer.id] = customer
    return customer


@app.get("/customers/{customer_id}")
def read_customer(customer_id: int):
    customer = CUSTOMERS.get(customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer
```

```python wrong id=only-read path=main.py
import bcrypt
from fastapi import FastAPI, HTTPException

from schemas import Customer, CustomerIn, CustomerOut

app = FastAPI()
CUSTOMERS: dict[int, Customer] = {}


@app.post("/customers", status_code=201)
def create_customer(data: CustomerIn):
    hashed = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt(rounds=4)).decode()
    customer = Customer(id=len(CUSTOMERS) + 1, email=data.email, password_hash=hashed)
    CUSTOMERS[customer.id] = customer
    return customer


@app.get("/customers/{customer_id}", response_model=CustomerOut)
def read_customer(customer_id: int):
    customer = CUSTOMERS.get(customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer
```

```http tests
POST /customers
Content-Type: application/json

{"email": "lena@shop.test", "password": "blue-lamp-77"}
###
GET /customers/1
###
GET /customers/9
```

## task fa-pw-choice
```json
{
  "type": "choice",
  "title": "Почему не sha256",
  "xp": 10,
  "hints": [
    "Раздел «Хеш, соль и „просто sha256“»: что нужно паролю от алгоритма.",
    "Подумайте, что делает злоумышленник с украденной базой: перебирает варианты на своём оборудовании как можно быстрее.",
    "У `sha256` нет соли и он очень быстрый. Нужны соль и медленный алгоритм с настраиваемой ценой."
  ],
  "options": [
    "`sha256` слишком быстрый: перебор миллиардов паролей в секунду возможен, а у одинаковых паролей одинаковые хеши",
    "`sha256` слишком медленный для регистрации с большим числом пользователей",
    "`sha256` нельзя записать в базу данных, потому что хеш получается слишком длинным",
    "`sha256` можно «развернуть» обратно в пароль простой формулой, если знать длину пароля"
  ],
  "answer": [0],
  "explanation": "Скорость, которая хороша для проверки файлов, превращается в слабость: чем быстрее хеш, тем быстрее перебор. Без соли одинаковые пароли дают одинаковые хеши, а готовые таблицы «пароль → хеш» вскрывают частые пароли мгновенно. Вариант про медленность неверен: наоборот, для паролей нужна медлительность. Длина хеша не мешает хранению: bcrypt даёт 60 символов, sha256 — 64. Обратной формулы у хеш-функции нет: пароли подбирают перебором, а не вычисляют."
}
```
Сервис хранит пароли как `hashlib.sha256(пароль).hexdigest()`. Что в этом плохого?
