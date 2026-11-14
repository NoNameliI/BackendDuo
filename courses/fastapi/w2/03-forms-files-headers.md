# Формы, файлы, заголовки и cookie

Не всё приходит в виде JSON. Форма оформления заказа отправляет поля в «форменном» виде, фотография товара загружается файлом, язык и валюта лежат в заголовках, а номер корзины запоминается в cookie. В этом уроке вы научитесь читать такие данные в FastAPI и отвечать с заголовками и cookie.

### Откуда FastAPI берёт параметры

У каждого параметра обработчика есть источник. Вы уже знаете три: путь, строка запроса и тело JSON. В этом уроке добавляются четыре:

- `Form()` — поля HTML-формы в теле запроса;
- `File()` и `UploadFile` — загруженные файлы;
- `Header()` — заголовки запроса;
- `Cookie()` — cookie запроса.

Все они записываются одинаково: `имя: Annotated[тип, Источник()]`. `Annotated` — запись из модуля `typing`: первый аргумент — тип, остальные — пометки для FastAPI. Источники принимают те же ограничения, что и `Field`: `min_length`, `ge`, `pattern` и другие.

### Form: поля формы

Браузерная форма отправляет данные не как JSON, а в виде `ключ=значение&ключ=значение` с заголовком `Content-Type: application/x-www-form-urlencoded`. Чтобы прочитать такие поля, параметр помечают `Form()`.

```python
from typing import Annotated

from fastapi import FastAPI, Form

app = FastAPI()


@app.post("/путь")
def handler(поле: Annotated[str, Form(min_length=1)], число: Annotated[int, Form(ge=1)] = 1):
    ...
```

- `Annotated[str, Form(min_length=1)]` — строка из поля формы `поле`; ограничения те же, что у `Field`.
- `= 1` — значение по умолчанию: поле можно не передавать.
- В одном маршруте нельзя смешивать `Form` и тело JSON: у запроса один тип тела.

Запрос с формой:

```text
POST /newsletter
Content-Type: application/x-www-form-urlencoded

email=ann%40shop.ru&weekly=true
```

Знак `@` в форме кодируется как `%40`, пробел — как `+` или `%20`. Если поле не передано, а значения по умолчанию нет, ответ `422` с `loc` вида `["body", "email"]`. Пустое поле (`email=`) FastAPI считает не переданным, так что ответ тот же.

Важное ограничение. Чтение форм и файлов делает отдельная библиотека `python-multipart`. На своём компьютере её ставят командой:

```sh
pip install python-multipart
```

Без неё приложение с `Form` не запустится: FastAPI сообщит, что для данных формы нужна `python-multipart`. В студии она подключается сама: примеры этого урока и задания с `Form` и `File` работают без установки.

Пример приложения для рассылки:

```python example
from typing import Annotated

from fastapi import FastAPI, Form

app = FastAPI()


@app.post("/newsletter", status_code=201)
def subscribe(email: Annotated[str, Form(min_length=3)], weekly: Annotated[bool, Form()] = False):
    return {"email": email, "weekly": weekly}
###
POST /newsletter
Content-Type: application/x-www-form-urlencoded

email=ann%40shop.ru&weekly=true
###
POST /newsletter
Content-Type: application/x-www-form-urlencoded

email=ann%40shop.ru
###
POST /newsletter
Content-Type: application/json

{"email": "ann@shop.ru"}
```

Результаты:

- `email=ann%40shop.ru&weekly=true` → `201` и `{"email": "ann@shop.ru", "weekly": true}`;
- `email=ann%40shop.ru` → `201` и `{"email": "ann@shop.ru", "weekly": false}`;
- пустое тело или JSON вместо формы → `422`: поле `email` не найдено.

`bool` из формы понимает `true`, `false`, `1`, `0`, `on`, `off`.

### File и UploadFile: загрузка файлов

Файл отправляется в формате `multipart/form-data`: тело состоит из частей, разделённых специальной строкой-границей, и у каждой есть имя, а у файла ещё и имя файла. Читают его двумя способами:

```python example
from fastapi import FastAPI, File, UploadFile

app = FastAPI()


@app.post("/photos")
async def upload_photo(photo: UploadFile):
    data = await photo.read()
    return {"name": photo.filename, "type": photo.content_type, "size": len(data)}


@app.post("/avatars")
def upload_avatar(avatar: bytes = File()):
    return {"size": len(avatar)}
###
POST /photos
Content-Type: multipart/form-data; boundary=XX

--XX
Content-Disposition: form-data; name="photo"; filename="lamp.png"
Content-Type: image/png

12345
--XX--
###
POST /avatars
Content-Type: multipart/form-data; boundary=XX

--XX
Content-Disposition: form-data; name="avatar"; filename="me.png"
Content-Type: image/png

abc
--XX--
```

Первый запрос: `{"name": "lamp.png", "type": "image/png", "size": 5}`. Второй: `{"size": 3}`.

- `photo: UploadFile` — объект загруженного файла. Он не держит файл целиком в памяти: большие файлы временно уходят на диск.
- `photo.filename` — имя файла у клиента; `photo.content_type` — тип, который заявил клиент (`image/png`). Клиенту нельзя верить: тип легко подделать, поэтому для надёжности содержимое проверяют отдельно.
- `await photo.read()` — прочитать содержимое как `bytes`. Метод асинхронный, поэтому перед ним нужен `await`, а обработчик — `async def`. Без `await` вернётся «корутина», а не данные.
- `bytes = File()` — самый простой вариант: файл целиком в `bytes` и никаких свойств. Для небольших файлов годится, для остальных лучше `UploadFile`.
- Файл вместе с обычными полями формы отправляют в одном запросе `multipart/form-data`; тогда в обработчике рядом стоят `Form()` и `UploadFile`.

Как записать такой запрос текстом, как в примере выше:

- заголовок `Content-Type: multipart/form-data; boundary=XX` задаёт границу, слово `XX` вы выбираете сами;
- каждая часть начинается со строки `--XX`, затем идут её заголовки (`Content-Disposition: form-data; name="photo"; filename="lamp.png"` и, для файла, `Content-Type: image/png`), пустая строка и содержимое;
- тело заканчивается строкой `--XX--`.

Студия сама приводит переводы строк к тем, что нужны для `multipart/form-data`. На своём компьютере файл отправляют проще: `curl -F "photo=@lamp.png" http://127.0.0.1:8000/photos` или страницей `/docs`.

### Header: заголовки запроса

Заголовок читают параметром с пометкой `Header()`. Имя в Python пишут через подчёркивание, а FastAPI сам превращает его в имя заголовка через дефис:

```python
from typing import Annotated

from fastapi import FastAPI, Header

app = FastAPI()


@app.get("/путь")
def handler(x_currency: Annotated[str, Header()] = "RUB"):
    ...
```

- `x_currency` ↔ заголовок `X-Currency`. Регистр букв не важен (`x-currency` тоже подойдёт).
- `= "RUB"` — значение, если заголовка нет. Без значения заголовок обязателен: его отсутствие даёт `422` с `loc` `["header", "x-currency"]`.
- `str | None = None` — необязательный заголовок без значения по умолчанию.
- Заголовки с подчёркиванием в имени (`X_Token`) плохо переносятся: прокси такие заголовки часто выбрасывают. Называйте заголовки через дефис.

Для чтения cookie параметр помечают `Cookie()`:

```python
def handler(visited: Annotated[str | None, Cookie()] = None):
    ...
```

- Имя параметра совпадает с именем cookie (`visited`). Клиент отправляет cookie заголовком `Cookie: visited=1`.
- `str | None = None` — cookie может отсутствовать.

### Response: ответ с заголовками и cookie

Чтобы добавить заголовок или cookie к ответу, в обработчик добавляют параметр типа `Response`. FastAPI подставит объект ответа сам, а вы дополните его; тело ответа при этом по-прежнему то, что вы вернёте.

```python
from fastapi import Response


def handler(response: Response):
    response.set_cookie(key="visited", value="1", max_age=3600, httponly=True)
    response.headers["X-Currency-Used"] = "USD"
    response.status_code = 200
```

- `Response` — класс из `fastapi`; параметр с таким типом не берётся из запроса.
- `response.set_cookie(key=, value=, max_age=, httponly=True)` — отправить cookie клиенту. `max_age` — срок жизни в секундах; `httponly=True` закрывает cookie от кода JavaScript на странице.
- `response.headers["Имя"] = "значение"` — добавить заголовок ответа.
- `response.delete_cookie("visited")` — попросить клиента удалить cookie.

Пример: цены в выбранной валюте и cookie о том, что покупатель уже был в магазине.

```python example
from typing import Annotated

from fastapi import Cookie, FastAPI, Header, Response

app = FastAPI()


@app.get("/prices")
def prices(
    response: Response,
    x_currency: Annotated[str, Header()] = "RUB",
    visited: Annotated[str | None, Cookie()] = None,
):
    response.set_cookie(key="visited", value="1", max_age=3600, httponly=True)
    response.headers["X-Currency-Used"] = x_currency
    return {"currency": x_currency, "returning": visited is not None}
###
GET /prices
###
GET /prices
X-Currency: USD
Cookie: visited=1
```

Первый запрос: `{"currency": "RUB", "returning": false}`, в ответе заголовок `set-cookie: visited=1; HttpOnly; Max-Age=3600; Path=/; SameSite=lax` и `X-Currency-Used: RUB`. Второй, с заголовком и cookie: `{"currency": "USD", "returning": true}` и `X-Currency-Used: USD`.

### Чего избегать

- Нельзя хранить в cookie пароль или данные, которым нужна тайна: cookie видна клиенту. В cookie кладут идентификатор сессии, а данные хранят на сервере.
- Не называйте параметры заголовков по-другому, чем ожидает клиент: `x_currency` и `X-Currency` — одно и то же, а `currency` — уже другой заголовок.
- Файл в памяти целиком (`bytes = File()`) не годится для больших загрузок: размер ограничивают и лучше читать `UploadFile`.

### Частые ошибки

- Приложение с `Form` не запускается. Причина: не установлена `python-multipart`. Решение: `pip install python-multipart`.
- Отправили JSON на маршрут с `Form`. Неверно: `Content-Type: application/json` и тело `{"email": "..."}`. Верно: `application/x-www-form-urlencoded` и тело `email=...`; иначе `422`.
- Забыли `await`. Неверно: `data = photo.read()` — получите корутину, а не байты. Верно: `data = await photo.read()` в `async def`.
- Заголовок читается как параметр запроса. Неверно: `def f(x_currency: str)` — это параметр строки запроса `?x_currency=`. Верно: `x_currency: Annotated[str, Header()]`.
- Cookie не появляется в ответе. Неверно: `set_cookie` вызван на новой переменной `Response()`, не связанной с ответом. Верно: параметр `response: Response` самого обработчика.

### Шпаргалка

- `имя: Annotated[тип, Form()]` — поле формы (`application/x-www-form-urlencoded`), нужна `python-multipart`.
- `Form` и тело JSON в одном маршруте не смешиваются.
- `UploadFile`: `.filename`, `.content_type`, `await .read()`; `bytes = File()` — файл целиком.
- Файлы идут как `multipart/form-data`: части с границей `--XX`, тело заканчивается `--XX--`.
- `Annotated[str, Header()]`: `x_currency` ↔ `X-Currency`; `Annotated[str | None, Cookie()] = None`.
- `response: Response` → `response.set_cookie(key=, value=, max_age=, httponly=True)`, `response.headers["X"] = "…"`, `response.delete_cookie("…")`.

## task fa-checkout-form
```json
{
  "type": "fastapi",
  "title": "Форма оформления заказа",
  "xp": 10,
  "packages": ["multipart"],
  "hints": [
    "Раздел «Form: поля формы»: параметр записывается как Annotated[тип, Form(...)], а из модуля fastapi нужно импортировать Form.",
    "Поля: name — непустая строка, phone — строка из 10–12 цифр (pattern), qty — целое от 1 до 20 по умолчанию 1. Ответ 201.",
    "Шаблон: name: Annotated[str, Form(min_length=…)], phone: Annotated[str, Form(pattern=\"^…$\")], qty: Annotated[int, Form(ge=…, le=…)] = …."
  ],
  "wrong": {
    "no-pattern": "телефон с буквами или слишком короткий принимается",
    "qty-required": "поле qty обязательно, хотя при его отсутствии должно быть значение 1"
  }
}
```
Оформление заказа отправляет браузерную форму `POST /checkout` с полями `name`, `phone` и `qty`. Ответ при успехе — `201` и `{"name": ..., "phone": ..., "qty": ...}`.

Правила:

- `name` — непустая строка;
- `phone` — строка из 10–12 цифр (регулярное выражение `^[0-9]{10,12}$`);
- `qty` — целое от 1 до 20; если поля нет, то `1`;
- неверные данные — `422`.

Тест отправляет данные как `application/x-www-form-urlencoded`, то есть в теле `name=Ann&phone=...`. Приложению нужна библиотека `python-multipart`: в задании она уже подключена.

```python starter
from typing import Annotated

from fastapi import FastAPI, Form

app = FastAPI()


@app.post("/checkout", status_code=201)
def checkout(name, phone, qty):
    # прочитайте поля формы и добавьте ограничения
    return {"name": name, "phone": phone, "qty": qty}
```

```python solution
from typing import Annotated

from fastapi import FastAPI, Form

app = FastAPI()


@app.post("/checkout", status_code=201)
def checkout(
    name: Annotated[str, Form(min_length=1)],
    phone: Annotated[str, Form(pattern="^[0-9]{10,12}$")],
    qty: Annotated[int, Form(ge=1, le=20)] = 1,
):
    return {"name": name, "phone": phone, "qty": qty}
```

```python wrong id=no-pattern
from typing import Annotated

from fastapi import FastAPI, Form

app = FastAPI()


@app.post("/checkout", status_code=201)
def checkout(
    name: Annotated[str, Form(min_length=1)],
    phone: Annotated[str, Form()],
    qty: Annotated[int, Form(ge=1, le=20)] = 1,
):
    return {"name": name, "phone": phone, "qty": qty}
```

```python wrong id=qty-required
from typing import Annotated

from fastapi import FastAPI, Form

app = FastAPI()


@app.post("/checkout", status_code=201)
def checkout(
    name: Annotated[str, Form(min_length=1)],
    phone: Annotated[str, Form(pattern="^[0-9]{10,12}$")],
    qty: Annotated[int, Form(ge=1, le=20)],
):
    return {"name": name, "phone": phone, "qty": qty}
```

```http tests
POST /checkout
Content-Type: application/x-www-form-urlencoded

name=Ann&phone=89001112233&qty=3
###
POST /checkout
Content-Type: application/x-www-form-urlencoded

name=Ann&phone=89001112233
###
POST /checkout
Content-Type: application/x-www-form-urlencoded

name=&phone=89001112233
###
POST /checkout
Content-Type: application/x-www-form-urlencoded

name=Ann&phone=12ab
###
POST /checkout
Content-Type: application/x-www-form-urlencoded

name=Ann&phone=89001112233&qty=21
###
POST /checkout
Content-Type: application/x-www-form-urlencoded

phone=89001112233
###
POST /checkout
Content-Type: application/json

{"name": "Ann", "phone": "89001112233"}
```

## task fa-login-cookie
```json
{
  "type": "fastapi",
  "title": "Вход, cookie и язык",
  "xp": 20,
  "packages": ["multipart"],
  "hints": [
    "Разделы «Header: заголовки запроса», «Cookie» и «Response: ответ с заголовками и cookie». Вход принимает форму, поэтому нужен ещё Form.",
    "В POST /login добавьте параметр response: Response и вызовите set_cookie. В GET /me прочитайте cookie session и заголовок X-Shop-Lang (параметр x_shop_lang); нет cookie — 401.",
    "Шаблон: response.set_cookie(key=\"session\", value=…, httponly=True); session: Annotated[str | None, Cookie()] = None; x_shop_lang: Annotated[str, Header()] = \"ru\"; if session is None: raise HTTPException(status_code=401, detail=\"Not logged in\")."
  ],
  "check": { "headers": ["set-cookie"] },
  "wrong": {
    "cookie-not-http-only": "cookie отправляется без httponly, и её может прочитать JavaScript страницы",
    "no-lang-header": "язык берётся всегда «ru» и заголовок X-Shop-Lang не читается"
  }
}
```
Магазин входит по форме и запоминает покупателя в cookie.

- `POST /login`: поля формы `username` и `password` (непустые). В ответ `200` с `{"ok": true}` и cookie `session` со значением `s-` и именем пользователя (для `ann` — `s-ann`), параметры `httponly=True` и `max_age=3600`.
- `GET /me`: читает cookie `session` и заголовок `X-Shop-Lang` (по умолчанию `ru`). Ответ `{"user": имя, "lang": язык}`, где имя — часть cookie после `s-`. Нет cookie — `401` с `{"detail": "Not logged in"}`.

Две строковые операции Python пригодятся. F-строка `f"s-{имя}"` подставляет переменную в текст: для `ann` получится `s-ann`. Метод `текст.removeprefix("s-")` отрезает начало `s-`, если оно есть: из `s-ann` выйдет `ann`.

Проверка сравнивает ещё и заголовок `Set-Cookie` целиком, поэтому параметры cookie должны быть теми, что названы выше. Тесты отправляют форму как `application/x-www-form-urlencoded`.

```python starter
from typing import Annotated

from fastapi import Cookie, FastAPI, Form, Header, HTTPException, Response

app = FastAPI()


@app.post("/login")
def login(username: Annotated[str, Form(min_length=1)], password: Annotated[str, Form(min_length=1)]):
    return {"ok": True}


@app.get("/me")
def me():
    return {"user": None, "lang": "ru"}
```

```python solution
from typing import Annotated

from fastapi import Cookie, FastAPI, Form, Header, HTTPException, Response

app = FastAPI()


@app.post("/login")
def login(
    response: Response,
    username: Annotated[str, Form(min_length=1)],
    password: Annotated[str, Form(min_length=1)],
):
    response.set_cookie(key="session", value=f"s-{username}", httponly=True, max_age=3600)
    return {"ok": True}


@app.get("/me")
def me(
    session: Annotated[str | None, Cookie()] = None,
    x_shop_lang: Annotated[str, Header()] = "ru",
):
    if session is None:
        raise HTTPException(status_code=401, detail="Not logged in")
    return {"user": session.removeprefix("s-"), "lang": x_shop_lang}
```

```python wrong id=cookie-not-http-only
from typing import Annotated

from fastapi import Cookie, FastAPI, Form, Header, HTTPException, Response

app = FastAPI()


@app.post("/login")
def login(
    response: Response,
    username: Annotated[str, Form(min_length=1)],
    password: Annotated[str, Form(min_length=1)],
):
    response.set_cookie(key="session", value=f"s-{username}", max_age=3600)
    return {"ok": True}


@app.get("/me")
def me(
    session: Annotated[str | None, Cookie()] = None,
    x_shop_lang: Annotated[str, Header()] = "ru",
):
    if session is None:
        raise HTTPException(status_code=401, detail="Not logged in")
    return {"user": session.removeprefix("s-"), "lang": x_shop_lang}
```

```python wrong id=no-lang-header
from typing import Annotated

from fastapi import Cookie, FastAPI, Form, Header, HTTPException, Response

app = FastAPI()


@app.post("/login")
def login(
    response: Response,
    username: Annotated[str, Form(min_length=1)],
    password: Annotated[str, Form(min_length=1)],
):
    response.set_cookie(key="session", value=f"s-{username}", httponly=True, max_age=3600)
    return {"ok": True}


@app.get("/me")
def me(session: Annotated[str | None, Cookie()] = None):
    if session is None:
        raise HTTPException(status_code=401, detail="Not logged in")
    return {"user": session.removeprefix("s-"), "lang": "ru"}
```

```http tests
POST /login
Content-Type: application/x-www-form-urlencoded

username=ann&password=secret
###
POST /login
Content-Type: application/x-www-form-urlencoded

username=&password=secret
###
GET /me
Cookie: session=s-ann
###
GET /me
Cookie: session=s-bob
X-Shop-Lang: en
###
GET /me
```

## task fa-upload-photo
```json
{
  "type": "fastapi",
  "title": "Загрузка фото товара",
  "xp": 20,
  "packages": ["multipart"],
  "hints": [
    "Разделы «File и UploadFile: загрузка файлов» и «Form: поля формы»: в одном запросе multipart рядом стоят поле формы и файл.",
    "Нужны параметры title (Form) и photo (UploadFile). Тип проверяйте по photo.content_type: не начинается с image/ — 415; пустое содержимое — 400.",
    "Шаблон: async def upload(title: Annotated[str, Form(min_length=1)], photo: UploadFile): data = await photo.read(); if not photo.content_type.startswith(\"image/\"): raise HTTPException(status_code=415, …); if not data: raise HTTPException(status_code=400, …)."
  ],
  "wrong": {
    "no-type-check": "файл любого типа принимается, например text/plain",
    "no-empty-check": "пустой файл принимается вместо ответа 400"
  }
}
```
`POST /products/photo` принимает `multipart/form-data` с полем `title` (непустая строка) и файлом `photo`. Правила:

- тип файла (`content_type`) должен начинаться с `image/`, иначе `415` и `{"detail": "Only images are accepted"}`;
- пустой файл — `400` и `{"detail": "Empty file"}`;
- иначе `201` и `{"title": ..., "name": имя файла, "size": размер в байтах}`;
- нет файла или заголовка — `422`.

```python starter
from typing import Annotated

from fastapi import FastAPI, Form, HTTPException, UploadFile

app = FastAPI()


@app.post("/products/photo", status_code=201)
async def upload_photo(title: Annotated[str, Form(min_length=1)]):
    # добавьте файл photo и проверки
    return {"title": title}
```

```python solution
from typing import Annotated

from fastapi import FastAPI, Form, HTTPException, UploadFile

app = FastAPI()


@app.post("/products/photo", status_code=201)
async def upload_photo(title: Annotated[str, Form(min_length=1)], photo: UploadFile):
    if not (photo.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="Only images are accepted")
    data = await photo.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    return {"title": title, "name": photo.filename, "size": len(data)}
```

```python wrong id=no-type-check
from typing import Annotated

from fastapi import FastAPI, Form, HTTPException, UploadFile

app = FastAPI()


@app.post("/products/photo", status_code=201)
async def upload_photo(title: Annotated[str, Form(min_length=1)], photo: UploadFile):
    data = await photo.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    return {"title": title, "name": photo.filename, "size": len(data)}
```

```python wrong id=no-empty-check
from typing import Annotated

from fastapi import FastAPI, Form, HTTPException, UploadFile

app = FastAPI()


@app.post("/products/photo", status_code=201)
async def upload_photo(title: Annotated[str, Form(min_length=1)], photo: UploadFile):
    if not (photo.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="Only images are accepted")
    data = await photo.read()
    return {"title": title, "name": photo.filename, "size": len(data)}
```

```http tests
POST /products/photo
Content-Type: multipart/form-data; boundary=XX

--XX
Content-Disposition: form-data; name="title"

Lamp
--XX
Content-Disposition: form-data; name="photo"; filename="lamp.png"
Content-Type: image/png

12345
--XX--
###
POST /products/photo
Content-Type: multipart/form-data; boundary=XX

--XX
Content-Disposition: form-data; name="title"

Lamp
--XX
Content-Disposition: form-data; name="photo"; filename="notes.txt"
Content-Type: text/plain

hello
--XX--
###
POST /products/photo
Content-Type: multipart/form-data; boundary=XX

--XX
Content-Disposition: form-data; name="title"

Lamp
--XX
Content-Disposition: form-data; name="photo"; filename="empty.png"
Content-Type: image/png


--XX--
###
POST /products/photo
Content-Type: multipart/form-data; boundary=XX

--XX
Content-Disposition: form-data; name="title"

Lamp
--XX--
```

## task fa-static-upload
```json
{
  "type": "static",
  "title": "Загрузка фото товара",
  "xp": 15,
  "hints": [
    "Раздел «File и UploadFile: загрузка файлов»: загруженный файл — параметр типа UploadFile, содержимое читается через await ….read().",
    "Замените параметр photo: str на photo: UploadFile, импортируйте UploadFile из fastapi, прочитайте файл через await и верните photo.content_type.",
    "Шаблон: from fastapi import FastAPI, UploadFile; async def upload_photo(photo: UploadFile): data = await photo.read(); return {…, \"type\": photo.content_type, \"size\": len(data)}."
  ],
  "check": {
    "static": [
      { "rule": "imports", "module": "fastapi", "name": "UploadFile", "message": "Импортируйте UploadFile из fastapi: файл принимается параметром этого типа." },
      { "rule": "uses", "name": "UploadFile", "message": "Параметр photo должен иметь тип UploadFile." },
      { "rule": "pattern", "regex": "await\\s+photo\\.read\\(\\)", "message": "Прочитайте содержимое файла через await photo.read()." },
      { "rule": "pattern", "regex": "photo\\.content_type", "message": "Верните тип файла: photo.content_type." }
    ]
  },
  "wrong": {
    "no-await": "содержимое читается без await, вместо байтов будет корутина",
    "plain-str": "photo остался обычной строкой, а не загруженным файлом"
  }
}
```
Маршрут `POST /photos` должен принимать загруженную фотографию товара и отвечать `{"name": имя файла, "type": тип файла, "size": размер в байтах}`. Сейчас параметр `photo` объявлен строкой, и файл принять нельзя.

Исправьте код. Проверка разбирает код и не запускает его: ищет `UploadFile`, чтение через `await` и использование `content_type`.

```python starter
from fastapi import FastAPI

app = FastAPI()


@app.post("/photos")
async def upload_photo(photo: str):
    return {"name": photo, "type": "unknown", "size": 0}
```

```python solution
from fastapi import FastAPI, UploadFile

app = FastAPI()


@app.post("/photos")
async def upload_photo(photo: UploadFile):
    data = await photo.read()
    return {"name": photo.filename, "type": photo.content_type, "size": len(data)}
```

```python wrong id=no-await
from fastapi import FastAPI, UploadFile

app = FastAPI()


@app.post("/photos")
async def upload_photo(photo: UploadFile):
    data = photo.read()
    return {"name": photo.filename, "type": photo.content_type, "size": len(data)}
```

```python wrong id=plain-str
from fastapi import FastAPI, UploadFile

app = FastAPI()


@app.post("/photos")
async def upload_photo(photo: str):
    return {"name": photo, "type": "image/png", "size": 0}
```

## task fa-review-upload
```json
{
  "type": "review",
  "title": "Загрузка падает с ошибкой",
  "xp": 10,
  "hints": [
    "Раздел «File и UploadFile: загрузка файлов»: какие методы UploadFile асинхронные?",
    "Ошибка в сообщении: «object of type 'coroutine' has no len()». Корутина — результат вызова асинхронной функции без await.",
    "Смотрите на строку, где читается содержимое файла: перед вызовом photo.read() нет await."
  ],
  "code": "@app.post(\"/photos\")\nasync def upload_photo(photo: UploadFile):\n    data = photo.read()\n    return {\"name\": photo.filename, \"size\": len(data)}",
  "codeLanguage": "python",
  "lines": [3],
  "options": [
    "`photo.read()` не дожидается результата: нужно `await photo.read()`",
    "`UploadFile` нельзя использовать в `async def`, нужен обычный `def`",
    "Вместо `photo.filename` нужно `photo.name`",
    "Для файлов обязательно указывать `status_code=201`"
  ],
  "answer": [0],
  "explanation": "`read()` у `UploadFile` — асинхронный метод: без `await` он возвращает корутину, и `len(data)` падает с ошибкой, а клиент видит `500`. `UploadFile` как раз удобен в `async def`, `filename` — настоящее имя атрибута, а код ответа от наличия файла не зависит."
}
```
Загрузка фотографий падает с ошибкой «object of type 'coroutine' has no len()». Найдите причину в коде.
