# OAuth2 и JWT: вход по токену

Мобильное приложение магазина входит по паролю, а дальше сотни раз в час обращается к API. Присылать пароль в каждом запросе опасно, а проверять его хеш каждый раз дорого. Поэтому после входа сервер выдаёт **токен**: короткую подписанную строку, которую приложение прикладывает к запросам. В этом уроке вы реализуете такой вход по схеме OAuth2 (вариант «пароль») и токены JWT.

Хранилище пользователей по-прежнему в памяти. Ключ подписи приходит из настроек, как вы делали в уроке про lifespan и настройки: в коде его нет.

### Как устроен вход по токену

Схема из четырёх шагов:

1. Клиент отправляет `POST /token` с формой: поля `username` и `password`.
2. Сервер проверяет пароль и отвечает `{"access_token": "...", "token_type": "bearer"}`.
3. Клиент добавляет в каждый следующий запрос заголовок `Authorization: Bearer <токен>`.
4. Сервер проверяет токен и узнаёт пользователя, не обращаясь к паролю.

Это стандартное поведение OAuth2 с «потоком пароля»: так работает и страница `/docs` с кнопкой «Authorize». Слово `Bearer` («предъявитель») означает: кто предъявил токен, тот и пользователь. Поэтому токен нужно беречь так же, как пароль.

Ограничение: в проекте OAuth 2.1 и в рекомендациях RFC 9700 «поток пароля» признан устаревшим, потому что клиент получает пароль пользователя. Он подходит только собственному клиенту (приложению вашей же компании, как в этом курсе); для сторонних приложений используют другие потоки OAuth2.

### OAuth2PasswordRequestForm: форма входа

Поля входа приходят не JSON, а формой `application/x-www-form-urlencoded`. FastAPI читает её готовым классом `OAuth2PasswordRequestForm`. Для форм нужна библиотека `python-multipart`: в заданиях урока она подключена.

```python
from typing import Annotated

from fastapi import Depends
from fastapi.security import OAuth2PasswordRequestForm


@app.post("/token")
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()]):
    ...
```

- `from fastapi.security import OAuth2PasswordRequestForm` — класс из модуля безопасности FastAPI;
- `Annotated[OAuth2PasswordRequestForm, Depends()]` — класс как зависимость: FastAPI сам прочитает форму и создаст объект, как вы делали с классами-зависимостями;
- `form.username` и `form.password` — поля формы; `form.scopes` — список прав (о них в следующем уроке), по умолчанию пустой.

Поля называются именно `username` и `password`, даже если у вас вход по почте: этого требует стандарт.

```python example
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.security import OAuth2PasswordRequestForm

app = FastAPI()


@app.post("/token")
def show_form(form: Annotated[OAuth2PasswordRequestForm, Depends()]):
    return {"username": form.username, "password_length": len(form.password), "scopes": form.scopes}
###
POST /token
Content-Type: application/x-www-form-urlencoded

username=kate&password=paper-boat-31
###
POST /token
Content-Type: application/x-www-form-urlencoded

username=kate
```

Первый запрос возвращает имя, длину пароля и пустой список прав. Во втором нет пароля, и FastAPI отвечает `422`: оба поля обязательны.

### OAuth2PasswordBearer: чтение токена

`OAuth2PasswordBearer` — зависимость, которая достаёт токен из заголовка `Authorization: Bearer ...`.

```python
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


@app.get("/адрес")
def handler(token: Annotated[str, Depends(oauth2_scheme)]):
    ...
```

- `OAuth2PasswordBearer(tokenUrl="token")` — создаётся один раз на приложение. `tokenUrl` — адрес входа без начального слэша; по нему страница `/docs` знает, куда отправлять логин;
- `Depends(oauth2_scheme)` — зависимость отдаёт токен строкой без слова `Bearer`;
- если заголовка нет или он другой схемы, FastAPI сам отвечает `401` и `{"detail": "Not authenticated"}` с заголовком `WWW-Authenticate: Bearer`.

Заголовок `WWW-Authenticate` по стандарту сопровождает `401`: он сообщает клиенту, какая схема входа нужна. Когда вы сами отвечаете `401`, добавляйте его через `headers={"WWW-Authenticate": "Bearer"}`.

Зависимость только **читает** токен и ничего не проверяет. Любая строка в заголовке будет принята как токен. Проверка подписи и срока — следующий шаг.

### JWT: что в токене

**JWT** (JSON Web Token) — строка из трёх частей через точку: `заголовок.данные.подпись`.

- заголовок: алгоритм подписи, например `HS256`;
- данные (**payload**): JSON с утверждениями — **claims**;
- подпись: хеш (HMAC-SHA256) от первых двух частей с секретным ключом, известным только серверу.

Две части закодированы base64, но **не зашифрованы**: любой может их прочитать. Поэтому в токен не кладут пароли и личные данные. Защищает токен подпись: изменить payload и не сломать подпись без ключа нельзя.

Стандартные claims, которые нужны здесь:

- `sub` (subject) — кому выдан токен: имя или номер пользователя, строкой;
- `exp` (expiration) — когда токен перестаёт действовать: время в секундах с 1 января 1970 (по UTC).

### PyJWT: encode и decode

Для токенов в Python используют пакет `pyjwt`, модуль называется `jwt`. В студии он подключается группой пакетов `jwt`.

```python
import jwt

токен = jwt.encode({"sub": "имя", "exp": срок}, ключ, algorithm="HS256")
данные = jwt.decode(токен, ключ, algorithms=["HS256"])
```

- `jwt.encode(данные, ключ, algorithm="HS256")` — подписывает словарь и возвращает токен-строку. `exp` можно передать числом или `datetime`: пакет сам переведёт его в секунды;
- `jwt.decode(токен, ключ, algorithms=["HS256"])` — проверяет подпись и срок и возвращает словарь. Параметр `algorithms` — **список**, и писать его обязательно: он перечисляет, какие алгоритмы вы принимаете. Без него библиотека откажется работать;
- ошибки проверки — исключения из `jwt`: `jwt.ExpiredSignatureError` (срок вышел) и `jwt.InvalidSignatureError` (подпись не сошлась). У них общий родитель `jwt.InvalidTokenError`: он же ловит и мусор вместо токена (`jwt.DecodeError`).

Срок обычно задают от текущего времени:

```python
from datetime import datetime, timedelta, timezone

expire = datetime.now(timezone.utc) + timedelta(minutes=30)
```

- `datetime.now(timezone.utc)` — текущее время по UTC;
- `timedelta(minutes=30)` — промежуток в тридцать минут; сумма даёт момент, когда токен «протухнет».

Все ловушки видно на примере. Ключ записан прямо в код только ради краткости: в заданиях он приходит из настроек.

```python example
import jwt
from fastapi import FastAPI

app = FastAPI()
KEY = "demo-key-only-for-this-example-0123456789"


@app.get("/jwt-demo")
def jwt_demo():
    token = jwt.encode({"sub": "kate", "exp": 4102444800}, KEY, algorithm="HS256")
    result = {"parts": len(token.split(".")), "payload": jwt.decode(token, KEY, algorithms=["HS256"])}
    expired = jwt.encode({"sub": "kate", "exp": 946684800}, KEY, algorithm="HS256")
    wrong_key = "another-key-another-key-another-1234"
    for name, value, key in [("expired", expired, KEY), ("forged", token, wrong_key), ("garbage", "abc.def.ghi", KEY)]:
        try:
            jwt.decode(value, key, algorithms=["HS256"])
            result[name] = "accepted"
        except jwt.ExpiredSignatureError:
            result[name] = "ExpiredSignatureError"
        except jwt.InvalidTokenError as error:
            result[name] = type(error).__name__
    return result
###
GET /jwt-demo
```

Ответ: три части токена, данные `{"sub": "kate", "exp": 4102444800}` (это 2100 год), для просроченного токена — `ExpiredSignatureError`, для токена с чужим ключом — `InvalidSignatureError`, для мусора — `DecodeError`.

Обратите внимание на порядок `except`. `ExpiredSignatureError` — частный случай `InvalidTokenError`, поэтому его ловят **раньше** общего: если поставить общий первым, частный никогда не сработает.

### Выдача токена и проверка в обработчике

Вход собирает всё вместе: проверка пароля, токен с `sub` и `exp`, ответ в стандартной форме.

```python
@app.post("/token")
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()]):
    if not authenticate(form.username, form.password):
        raise HTTPException(status_code=401, detail="Incorrect username or password",
                            headers={"WWW-Authenticate": "Bearer"})
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    token = jwt.encode({"sub": form.username, "exp": expire}, settings.secret_key, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer"}
```

- `authenticate(...)` — ваша функция проверки пароля через `checkpw`, как в прошлом уроке;
- неверные данные — `401` с `WWW-Authenticate: Bearer`, текст одинаковый для неизвестного имени и неверного пароля;
- `settings.secret_key` — ключ из настроек (объект `Settings` с полем `secret_key` без значения по умолчанию);
- ответ `{"access_token": токен, "token_type": "bearer"}` — формат, который ждёт `/docs` и все OAuth2-клиенты.

Проверка токена в защищённом маршруте:

```python
@app.get("/me")
def read_me(token: Annotated[str, Depends(oauth2_scheme)]):
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="...", headers={"WWW-Authenticate": "Bearer"})
    return {"username": payload["sub"]}
```

Что видно в студии: токен, который выдаёт вход, содержит текущее время и поэтому отличается при каждом запуске. Проверка сравнивает такие ответы без поля `access_token` (само поле должно быть), а защищённые маршруты проверяет заранее выпущенными токенами со сроком в 2100 году.

Токен выдан до `exp` и действует до него, даже если пароль уже сменили: отозвать его нельзя. Поэтому срок делают коротким (минуты или час), а для долгой сессии добавляют второй токен — refresh. Это за рамками урока.

### Частые ошибки

- Нет `algorithms`. Неверно: `jwt.decode(token, key)`. Верно: `jwt.decode(token, key, algorithms=["HS256"])`. Без списка алгоритмов библиотека отказывается работать, а старый приём «принять любой алгоритм» привёл к известным взломам.
- Подпись отключена. Неверно: `jwt.decode(token, options={"verify_signature": False})` — клиент выписывает себе любой токен. Верно: ключ и `algorithms`.
- Общий `except` стоит раньше частного. Неверно: `except jwt.InvalidTokenError` перед `except jwt.ExpiredSignatureError`. Верно: сначала частный.
- Ловят слишком узко. Неверно: `except jwt.ExpiredSignatureError` один: мусор вместо токена даст `500`. Верно: `except jwt.InvalidTokenError`.
- Секрет в коде. Неверно: `SECRET = "abc"` в репозитории. Верно: `settings.secret_key` из окружения или `.env`.
- Забыли заголовок. Неверно: `401` без `WWW-Authenticate`. Верно: `headers={"WWW-Authenticate": "Bearer"}`.
- Личное в payload. Неверно: класть в токен пароль или номер карты: payload читает любой. Верно: только `sub` и срок.

### Шпаргалка

- Вход: `POST /token`, форма `username` и `password`, ответ `{"access_token", "token_type": "bearer"}`.
- `OAuth2PasswordRequestForm` — `Annotated[OAuth2PasswordRequestForm, Depends()]`; нужна библиотека `python-multipart` (группа пакетов `multipart`).
- `OAuth2PasswordBearer(tokenUrl="token")` — токен из заголовка; нет заголовка — `401 Not authenticated`.
- `jwt.encode({"sub": ..., "exp": ...}, ключ, algorithm="HS256")`; `jwt.decode(токен, ключ, algorithms=["HS256"])`.
- Ловить `jwt.InvalidTokenError`; `ExpiredSignatureError` — раньше него.
- `401` всегда с `headers={"WWW-Authenticate": "Bearer"}`.
- Payload не шифруется; ключ из настроек, срок короткий.

## task fa-jwt-token
```json
{
  "type": "fastapi",
  "title": "Вход выдаёт токен",
  "xp": 20,
  "packages": ["bcrypt", "jwt", "multipart", "settings"],
  "readonly": ["config.py", ".env", "users.py", "deps.py"],
  "hints": [
    "Разделы «OAuth2PasswordRequestForm: форма входа» и «Выдача токена и проверка в обработчике».",
    "Если `authenticate` вернула `False`, ответ — 401 с `Incorrect username or password` и заголовком `WWW-Authenticate: Bearer`. Иначе подпишите payload с `sub` и `exp` (30 минут от сейчас) ключом `settings.secret_key` алгоритмом HS256.",
    "Шаблон: `expire = datetime.now(timezone.utc) + timedelta(minutes=30)`; `token = jwt.encode({\"sub\": form.username, \"exp\": expire}, settings.secret_key, algorithm=\"HS256\")`; `return {\"access_token\": token, \"token_type\": \"bearer\"}`."
  ],
  "check": {
    "headers": ["www-authenticate"],
    "code": [
      { "pattern": "[\"']exp[\"']\\s*:", "message": "В токене нужен claim exp: срок действия." },
      { "pattern": "jwt\\.encode\\(\\{[^}]*\\}\\s*,\\s*[\"']", "forbid": true, "message": "Ключ подписи записан в коде строкой: берите его из settings.secret_key." }
    ]
  },
  "wrong": {
    "no-header": "при неверном пароле нет заголовка WWW-Authenticate",
    "no-exp": "в токене нет срока действия: он будет действовать вечно"
  }
}
```
Магазин переходит на вход по токену. `POST /token` принимает форму с полями `username` и `password` и отвечает:

- верные данные: `200` и `{"access_token": <JWT>, "token_type": "bearer"}`;
- неверный пароль или неизвестное имя: `401`, `{"detail": "Incorrect username or password"}` и заголовок `WWW-Authenticate: Bearer`.

В токене должны быть claims `sub` (имя пользователя) и `exp` (через 30 минут от момента выдачи), подпись — HS256 с ключом из `settings.secret_key`.

Готово: маршрут `GET /me` в `main.py`. Закрыто для правки: `deps.py`, `config.py` с объектом `settings` (ключ читается из `.env`) и `users.py` с хранилищем `USERS` и функцией `authenticate(username, password)`, которая возвращает `True`, если пароль верный. Покупательница в хранилище одна: `ann`, пароль `tulip-field-9`. Токены в ответах различаются между запусками, поэтому проверка сравнивает ответ входа без поля `access_token` (но само поле должно быть). Проверка входит через ваш `/token`, сохраняет токен и вызывает с ним готовый `GET /me` (он живёт в `main.py` и использует закрытый `deps.py`): токен должен быть подписан ключом из настроек и содержать `sub`. Наличие `exp` проверяет разбор кода: по ответу срок не виден.

```python starter
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordRequestForm

from config import settings
from deps import CurrentUser
from users import authenticate

app = FastAPI()


@app.post("/token")
def login(form):
    # проверьте пароль и выдайте токен
    ...


@app.get("/me")
def read_me(user: CurrentUser):
    return user
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

USERS = {
    "ann": {"role": "customer", "password_hash": bcrypt.hashpw(b"tulip-field-9", bcrypt.gensalt(rounds=4)).decode()},
}


def authenticate(username: str, password: str) -> bool:
    user = USERS.get(username)
    return user is not None and bcrypt.checkpw(password.encode(), user["password_hash"].encode())
```

```python solution
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordRequestForm

from config import settings
from deps import CurrentUser
from users import authenticate

app = FastAPI()


@app.post("/token")
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()]):
    if not authenticate(form.username, form.password):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    token = jwt.encode({"sub": form.username, "exp": expire}, settings.secret_key, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer"}


@app.get("/me")
def read_me(user: CurrentUser):
    return user
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

USERS = {
    "ann": {"role": "customer", "password_hash": bcrypt.hashpw(b"tulip-field-9", bcrypt.gensalt(rounds=4)).decode()},
}


def authenticate(username: str, password: str) -> bool:
    user = USERS.get(username)
    return user is not None and bcrypt.checkpw(password.encode(), user["password_hash"].encode())
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

```python wrong id=no-header
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordRequestForm

from config import settings
from deps import CurrentUser
from users import authenticate

app = FastAPI()


@app.post("/token")
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()]):
    if not authenticate(form.username, form.password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    expire = datetime.now(timezone.utc) + timedelta(minutes=30)
    token = jwt.encode({"sub": form.username, "exp": expire}, settings.secret_key, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer"}


@app.get("/me")
def read_me(user: CurrentUser):
    return user
```

```python wrong id=no-exp
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordRequestForm

from config import settings
from deps import CurrentUser
from users import authenticate

app = FastAPI()


@app.post("/token")
def login(form: Annotated[OAuth2PasswordRequestForm, Depends()]):
    if not authenticate(form.username, form.password):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = jwt.encode({"sub": form.username}, settings.secret_key, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer"}


@app.get("/me")
def read_me(user: CurrentUser):
    return user
```

```http tests
### ignore: access_token; save token = access_token
POST /token
Content-Type: application/x-www-form-urlencoded

username=ann&password=tulip-field-9
###
GET /me
Authorization: Bearer {{token}}
###
POST /token
Content-Type: application/x-www-form-urlencoded

username=ann&password=wrong-pass-1
###
POST /token
Content-Type: application/x-www-form-urlencoded

username=zed&password=tulip-field-9
###
POST /token
Content-Type: application/x-www-form-urlencoded

username=ann
```

## task fa-jwt-bug
```json
{
  "type": "fix-bug",
  "title": "Мусор вместо токена роняет сервер",
  "xp": 15,
  "packages": ["jwt", "settings"],
  "readonly": ["main.py", "config.py", ".env"],
  "hints": [
    "Раздел «PyJWT: encode и decode» и частые ошибки: какие исключения бросает `jwt.decode` и от какого класса они наследуются.",
    "Просроченный токен обрабатывается, а подделанный и мусорный дают ответ 500: на них `decode` бросает другие исключения, которых нет в `except`. Все они наследуют `jwt.InvalidTokenError`.",
    "Шаблон: после `except jwt.ExpiredSignatureError: ...` добавьте `except jwt.InvalidTokenError: raise HTTPException(status_code=401, detail=\"Invalid token\", headers=...)`. Частное исключение остаётся первым. Менять нужно только `deps.py`."
  ],
  "check": { "headers": ["www-authenticate"] },
  "wrong": {
    "one-message": "просроченный токен получает то же сообщение, что и подделанный: ответ «Token expired» потерян",
    "no-header": "для подделанного токена нет заголовка WWW-Authenticate"
  }
}
```
В блоге `GET /drafts` отдаёт черновики автора, чей токен предъявлен. Зависимость `get_username` из `deps.py` проверяет токен. Правильное поведение:

- верный токен — `200` и `{"author": имя}`;
- просроченный токен — `401` и `{"detail": "Token expired"}`;
- токен с чужой подписью или мусор вместо токена — `401` и `{"detail": "Invalid token"}`;
- нет заголовка — `401` и `{"detail": "Not authenticated"}` (отвечает сам FastAPI);
- каждый `401` с заголовком `WWW-Authenticate: Bearer`.

Сейчас просроченный токен обрабатывается верно, а подделанный и мусорный роняют сервер. Исправьте `deps.py`; остальные файлы менять нельзя.

```python starter path=main.py
from fastapi import FastAPI

from deps import UsernameDep

app = FastAPI()


@app.get("/drafts")
def read_drafts(author: UsernameDep):
    return {"author": author}
```

```python starter path=deps.py
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

from config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_username(token: Annotated[str, Depends(oauth2_scheme)]) -> str:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired", headers={"WWW-Authenticate": "Bearer"})
    return payload["sub"]


UsernameDep = Annotated[str, Depends(get_username)]
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

```python solution path=main.py
from fastapi import FastAPI

from deps import UsernameDep

app = FastAPI()


@app.get("/drafts")
def read_drafts(author: UsernameDep):
    return {"author": author}
```

```python solution path=deps.py
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

from config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_username(token: Annotated[str, Depends(oauth2_scheme)]) -> str:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired", headers={"WWW-Authenticate": "Bearer"})
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token", headers={"WWW-Authenticate": "Bearer"})
    return payload["sub"]


UsernameDep = Annotated[str, Depends(get_username)]
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

```python wrong id=one-message path=deps.py
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

from config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_username(token: Annotated[str, Depends(oauth2_scheme)]) -> str:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token", headers={"WWW-Authenticate": "Bearer"})
    return payload["sub"]


UsernameDep = Annotated[str, Depends(get_username)]
```

```python wrong id=no-header path=deps.py
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

from config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def get_username(token: Annotated[str, Depends(oauth2_scheme)]) -> str:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired", headers={"WWW-Authenticate": "Bearer"})
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload["sub"]


UsernameDep = Annotated[str, Depends(get_username)]
```

```http tests
GET /drafts
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.dqSrloOWc3xYATx4Ppo8MlGsH9GirgjlXCdBv4A2Grc
###
GET /drafts
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjk0NjY4NDgwMH0.vzqOSvzVxye2YTZrGKcetjnrk_J9ht9vVl7yolAfkUQ
###
GET /drafts
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.OYGKSD0gmp-JrU8vs9RcpillU0pLbbgyyRbUAKGe9rU
###
GET /drafts
Authorization: Bearer abc.def.ghi
###
GET /drafts
```

## task fa-jwt-me
```json
{
  "type": "fastapi",
  "title": "Кто я: проверка токена",
  "xp": 20,
  "packages": ["jwt", "settings", "bcrypt"],
  "readonly": ["config.py", ".env", "users.py"],
  "hints": [
    "Разделы «OAuth2PasswordBearer: чтение токена» и «PyJWT: encode и decode». Токен читает зависимость, проверяет его `jwt.decode`.",
    "Любая неудача (мусор, чужая подпись, просроченный токен, имя, которого нет в `USERS`) — один и тот же ответ: 401, `Could not validate credentials` и заголовок `WWW-Authenticate: Bearer`. Верный токен — `{\"username\": имя, \"role\": роль}`.",
    "Шаблон: `oauth2_scheme = OAuth2PasswordBearer(tokenUrl=\"token\")`; `try: payload = jwt.decode(token, settings.secret_key, algorithms=[\"HS256\"])`; `except jwt.InvalidTokenError: raise …`; затем `user = USERS.get(payload.get(\"sub\", \"\"))`."
  ],
  "check": { "headers": ["www-authenticate"] },
  "wrong": {
    "no-expiry": "срок действия не проверяется: просроченный токен принимается",
    "no-signature": "подпись не проверяется: подойдёт токен с любым ключом"
  }
}
```
Маршрут `GET /me` возвращает данные текущего покупателя по токену. Правила:

- верный токен существующего пользователя — `200` и `{"username": имя, "role": роль}` (роль берётся из `USERS`);
- нет заголовка `Authorization` — `401` и `{"detail": "Not authenticated"}` (ответ даёт сам FastAPI);
- просроченный токен, токен с неверной подписью, мусор вместо токена и токен пользователя, которого нет в `USERS` — `401`, `{"detail": "Could not validate credentials"}`; у каждого `401` заголовок `WWW-Authenticate: Bearer`.

В проекте уже есть закрытые для правки `config.py`, `.env` (ключ подписи) и `users.py` (покупательница `ann` с ролью `customer`, администратор `root`). Токены тестовых запросов выпущены заранее с тем же ключом.

```python starter
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordBearer

from config import settings
from users import USERS

app = FastAPI()


def credentials_error() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.get("/me")
def read_me():
    # прочитайте токен, проверьте его и найдите пользователя
    ...
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

USERS = {
    "ann": {"role": "customer", "password_hash": bcrypt.hashpw(b"tulip-field-9", bcrypt.gensalt(rounds=4)).decode()},
    "root": {"role": "admin", "password_hash": bcrypt.hashpw(b"root-pass-2026", bcrypt.gensalt(rounds=4)).decode()},
}
```

```python solution
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordBearer

from config import settings
from users import USERS

app = FastAPI()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def credentials_error() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.get("/me")
def read_me(token: Annotated[str, Depends(oauth2_scheme)]):
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise credentials_error()
    user = USERS.get(payload.get("sub", ""))
    if user is None:
        raise credentials_error()
    return {"username": payload["sub"], "role": user["role"]}
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

USERS = {
    "ann": {"role": "customer", "password_hash": bcrypt.hashpw(b"tulip-field-9", bcrypt.gensalt(rounds=4)).decode()},
    "root": {"role": "admin", "password_hash": bcrypt.hashpw(b"root-pass-2026", bcrypt.gensalt(rounds=4)).decode()},
}
```

```python wrong id=no-expiry
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordBearer

from config import settings
from users import USERS

app = FastAPI()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def credentials_error() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.get("/me")
def read_me(token: Annotated[str, Depends(oauth2_scheme)]):
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"], options={"verify_exp": False})
    except jwt.InvalidTokenError:
        raise credentials_error()
    user = USERS.get(payload.get("sub", ""))
    if user is None:
        raise credentials_error()
    return {"username": payload["sub"], "role": user["role"]}
```

```python wrong id=no-signature
from typing import Annotated

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import OAuth2PasswordBearer

from config import settings
from users import USERS

app = FastAPI()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def credentials_error() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


@app.get("/me")
def read_me(token: Annotated[str, Depends(oauth2_scheme)]):
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
    except jwt.InvalidTokenError:
        raise credentials_error()
    user = USERS.get(payload.get("sub", ""))
    if user is None:
        raise credentials_error()
    return {"username": payload["sub"], "role": user["role"]}
```

```http tests
GET /me
###
GET /me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.dqSrloOWc3xYATx4Ppo8MlGsH9GirgjlXCdBv4A2Grc
###
GET /me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyb290IiwiZXhwIjo0MTAyNDQ0ODAwfQ.uSAGIPOqH1fCBKJQlIiSLXuS3-tdqPTIuslmJPZgI4w
###
GET /me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjk0NjY4NDgwMH0.vzqOSvzVxye2YTZrGKcetjnrk_J9ht9vVl7yolAfkUQ
###
GET /me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJleHAiOjQxMDI0NDQ4MDB9.OYGKSD0gmp-JrU8vs9RcpillU0pLbbgyyRbUAKGe9rU
###
GET /me
Authorization: Bearer abc.def.ghi
###
GET /me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJnaG9zdCIsImV4cCI6NDEwMjQ0NDgwMH0.6MKkEibSH_wHD2WYoaf3z3uJBCRWy1YH_OJ2sdspCps
```

## task fa-jwt-choice
```json
{
  "type": "choice",
  "title": "Подмена payload",
  "xp": 10,
  "hints": [
    "Раздел «JWT: что в токене»: что именно защищает подпись, а что открыто всем.",
    "Payload закодирован base64, его прочитает и изменит кто угодно. Вопрос в том, что произойдёт с подписью.",
    "Подпись считается от payload с секретным ключом. Без ключа новую подпись под изменённый payload не посчитать."
  ],
  "options": [
    "Подпись не совпадёт с изменённым payload, `jwt.decode` бросит `InvalidSignatureError`, ответ — `401`",
    "Токен будет принят: сервер проверяет только срок `exp`, а не содержимое",
    "Токен будет принят, если новая роль есть в базе пользователей",
    "Сервер не заметит подмены, пока токен не истечёт"
  ],
  "answer": [0],
  "explanation": "Подпись — HMAC от заголовка и payload с секретным ключом. Изменив payload, злоумышленник не может пересчитать подпись, и `jwt.decode` отвергает токен. Остальные варианты описывают сервер, который не проверяет подпись: это ошибка кода (например, `verify_signature: False`), а не свойство JWT. Поэтому payload может прочитать любой, но верить ему можно только после проверки подписи, а секреты в него класть нельзя."
}
```
Клиент взял свой токен, раскодировал payload (это обычный base64), заменил `"sub": "ann"` на `"sub": "root"` и отправил токен с прежней подписью. Что сделает правильно написанный сервер?
