# CORS и preflight

Фронтенд трекера открыт по адресу `https://tracker.local`, а API живёт на `https://api.tracker.local`. Разработчик пишет `fetch`, сервер отвечает `200`, а страница получает ошибку, и в консоли браузера: `blocked by CORS policy`. Сервер ответил, но браузер не отдал ответ странице. В этом уроке вы разберёте, почему так происходит и как бэкенд на FastAPI разрешает своему фронтенду читать ответы.

### Origin и политика одного источника

**Origin** (источник) — это схема, домен и порт страницы:

```
схема://домен:порт
```

- **Схема** — `http` или `https`.
- **Домен** — например, `tracker.local` или `api.tracker.local`.
- **Порт** — число после двоеточия. Если его нет, подразумевается стандартный: `443` для `https`, `80` для `http`.
- Путь, параметры и `/` в конце в origin не входят: у страницы `https://tracker.local/board?id=1` origin `https://tracker.local`.

Два адреса — один origin, только если совпадают все три части:

| Страница | API | Один origin? |
|---|---|---|
| `https://tracker.local` | `https://tracker.local/tasks` | да |
| `https://tracker.local` | `https://api.tracker.local` | нет: другой домен |
| `http://tracker.local` | `https://tracker.local` | нет: другая схема |
| `https://tracker.local` | `https://tracker.local:8000` | нет: другой порт |

**Политика одного источника** (same-origin policy) — правило браузера: код страницы свободно читает ответы только своего origin. Запрос на чужой origin браузер всё равно отправит, но добавит заголовок `Origin` со своим источником, а ответ покажет странице, только если сервер это разрешил.

Зачем это нужно: вы вошли в трекер, и браузер хранит вашу сессию. Если бы любой открытый сайт мог читать ответы трекера, чужая страница незаметно прочитала бы ваши задачи. Политика защищает **пользователя в браузере**. Композер, `curl` и другие серверы её не соблюдают — поэтому в композере тот же запрос работает.

### Access-Control-Allow-Origin: сервер разрешает

Механизм, которым сервер разрешает чужим origin читать свои ответы, называется **CORS** (Cross-Origin Resource Sharing). Для обычного запроса всё решает один заголовок ответа:

```
Access-Control-Allow-Origin: origin-фронтенда
```

- Браузер сравнивает значение с origin страницы. Совпало — страница получает ответ.
- Значение `*` означает «любой origin» (с оговоркой про cookie, см. ниже).
- Заголовка нет или в нём другой origin — браузер блокирует ответ. При этом сервер запрос **получил и выполнил**: блокирует не сервер, а браузер.

### CORSMiddleware в FastAPI

В FastAPI эти заголовки добавляет `CORSMiddleware`. **Middleware** — прослойка, через которую проходит каждый запрос и каждый ответ приложения. Подключают её так:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["origin", "ещё origin"],
    allow_methods=["МЕТОД", "МЕТОД"],
    allow_headers=["Заголовок"],
    allow_credentials=False,
)
```

- `app.add_middleware(...)` — подключить прослойку к приложению; первым аргументом идёт класс `CORSMiddleware`.
- `allow_origins` — список разрешённых origin, каждый точно: схема, домен, порт, без `/` в конце. `["*"]` — все.
- `allow_methods` — какие методы разрешены. По умолчанию только `["GET"]`.
- `allow_headers` — какие дополнительные заголовки может присылать фронтенд, например `Authorization`. Простые заголовки (`Accept`, `Accept-Language`, `Content-Language`, `Content-Type`) `CORSMiddleware` разрешает всегда, даже `Content-Type: application/json`.
- `allow_credentials` — можно ли присылать запросы с cookie (раздел ниже). По умолчанию `False`.
- Аргументы пишут через запятую в виде `имя=значение`; списки — в квадратных скобках.

В примере магазин разрешает свой фронтенд `https://shop.local`. Первый запрос пришёл с этого origin, второй — с чужого:

```python example
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://shop.local"],
    allow_methods=["GET", "PATCH"],
    allow_headers=["Authorization"],
)

@app.get("/orders")
def list_orders():
    return [{"id": 1, "status": "new"}]
###
GET /orders
Origin: https://shop.local
###
GET /orders
Origin: https://evil.example
```

Оба раза сервер ответил `200` с данными. Но только в первом ответе есть `access-control-allow-origin: https://shop.local`. Второй ответ браузер страницы `https://evil.example` не отдаст.

### Простые запросы и preflight

Не всякий запрос браузер отправляет сразу. **Простой запрос** уходит сразу (и потом браузер проверяет `Access-Control-Allow-Origin`). Простой — это когда одновременно:

- метод `GET`, `HEAD` или `POST` (`HEAD` — как `GET`, но сервер присылает только строку статуса и заголовки, без тела);
- заголовки только из простого списка: `Accept`, `Accept-Language`, `Content-Language`, `Content-Type`;
- `Content-Type`, если есть, — один из `text/plain`, `multipart/form-data`, `application/x-www-form-urlencoded`.

Всё остальное — `PUT`, `PATCH`, `DELETE`, заголовок `Authorization`, `Content-Type: application/json` — требует **preflight**: предварительного запроса `OPTIONS`. Браузер спрашивает сервер, можно ли, и отправляет настоящий запрос, только если сервер согласился:

```
OPTIONS путь
Origin: origin-страницы
Access-Control-Request-Method: МЕТОД
Access-Control-Request-Headers: заголовки-через-запятую
```

- `Access-Control-Request-Method` — каким методом страница хочет отправить настоящий запрос.
- `Access-Control-Request-Headers` — какие непростые заголовки в нём будут, маленькими буквами.
- Сервер отвечает `200` и перечисляет разрешённое в `Access-Control-Allow-Methods` и `Access-Control-Allow-Headers`. Если что-то не разрешено, `CORSMiddleware` отвечает `400`, и браузер настоящий запрос не отправляет вовсе.

Тот же магазин: страница просит разрешения на `PATCH` с JSON и заголовком `Authorization` (в нём токен пользователя, о нём — в следующем уроке), а потом на `DELETE`:

```python example
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://shop.local"],
    allow_methods=["GET", "PATCH"],
    allow_headers=["Authorization"],
)

@app.patch("/orders/{order_id}")
def update_order(order_id: int):
    return {"id": order_id}
###
OPTIONS /orders/1
Origin: https://shop.local
Access-Control-Request-Method: PATCH
Access-Control-Request-Headers: authorization,content-type
###
OPTIONS /orders/1
Origin: https://shop.local
Access-Control-Request-Method: DELETE
```

На `PATCH` сервер ответил `200`: в `access-control-allow-methods` есть `PATCH`, а в `access-control-allow-headers` — `Authorization` и простые заголовки. На `DELETE` — `400 Disallowed CORS method`: метода нет в `allow_methods`, и браузер удаление не отправит.

### Cookie и allow_credentials

**Cookie** — короткая строка вида `имя=значение`, которую сервер однажды выдал браузеру (например, после входа), а браузер потом сам прикладывает к запросам на этот сервер в заголовке `Cookie`:

```http
GET /адрес
Cookie: session=номер-сессии
```

По cookie сервер узнаёт вошедшего пользователя. Как сервер выдаёт cookie и чем она отличается от токена, разберём в следующем уроке.

По умолчанию `fetch` на чужой origin не отправляет cookie. Чтобы отправить (например, cookie сессии), фронтенд пишет `credentials: 'include'`:

```javascript
await fetch('https://api.tracker.local/me', { credentials: 'include' });
```

Тогда браузер строже. Ответ он отдаст странице, только если:

- в ответе `Access-Control-Allow-Credentials: true` — в FastAPI это `allow_credentials=True`;
- в `Access-Control-Allow-Origin` стоит **точный** origin страницы. Ответ с `*` на запрос с cookie браузер отвергает.

Почему так: запрос с cookie выполняется от имени пользователя. Если разрешить его всем, любой сайт, который пользователь откроет, сможет читать его данные.

Здесь есть ловушка FastAPI. Если написать `allow_origins=["*"]` вместе с `allow_credentials=True`, `CORSMiddleware` не отправит `*`, а подставит в ответ origin того, кто спросил. Браузер будет доволен, а данные получит любой сайт:

```python example
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
)

@app.get("/orders")
def list_orders():
    return [{"id": 1, "status": "new"}]
###
GET /orders
Origin: https://evil.example
Cookie: session=demo-session-7
```

В ответе `access-control-allow-origin: https://evil.example` и `access-control-allow-credentials: true`: чужой сайт получил заказы пользователя. Правило: с `allow_credentials=True` перечисляйте origin явно.

### Как работать в тренажёре

В заданиях CORS слева — код фронтенда: с какого origin и каким `fetch` он обращается к API. Справа — форма настроек `CORSMiddleware` и код, который из неё получается. Кнопка «Запустить фронтенд» выполняет `fetch` как браузер: в журнале видно preflight, сам запрос и, если браузер заблокировал ответ, текст ошибки, как в консоли Chrome, с пояснением. Списки в полях пишутся через запятую.

### Частые ошибки

- `allow_origins=["https://tracker.local/"]` → без `/` в конце: `["https://tracker.local"]`. Origin сравнивается посимвольно.
- Разрешили `http://tracker.local`, а фронтенд открыт по `https` → схема тоже часть origin.
- Фронтенд отправляет `PATCH` с заголовком `Authorization`, а в настройках только `GET` и пустой `allow_headers` → добавьте метод в `allow_methods`, а заголовок в `allow_headers`, иначе preflight получит `400`.
- `allow_origins=["*"]` вместе с `allow_credentials=True` → перечислите нужные origin; иначе запросы с cookie сможет делать любой сайт.

### Шпаргалка

- Origin = `схема://домен:порт`; разные домены, схемы или порты — разные origin.
- Браузер добавляет `Origin`, сервер разрешает заголовком `Access-Control-Allow-Origin`.
- Простой запрос: `GET`/`HEAD`/`POST` и только простые заголовки. Иначе — preflight `OPTIONS` с `Access-Control-Request-Method` и `Access-Control-Request-Headers`.
- `app.add_middleware(CORSMiddleware, allow_origins=[...], allow_methods=[...], allow_headers=[...], allow_credentials=...)`.
- Cookie: `credentials: 'include'` во `fetch` + `allow_credentials=True` + точные origin.

## task web-cors-origin

```json
{
  "type": "cors",
  "title": "Пустить свой фронтенд",
  "server": "tracker",
  "fetch": { "origin": "https://tracker.local", "request": "GET /tasks?project_id=1" },
  "check": { "mustBlock": [{ "origin": "https://evil.example" }] },
  "hints": [
    "Разделы «Access-Control-Allow-Origin: сервер разрешает» и «CORSMiddleware в FastAPI».",
    "Это простой `GET` без особых заголовков, preflight не нужен. Достаточно разрешить origin страницы — точно, без пути и `/` в конце.",
    "`allow_origins`: `https://…`"
  ]
}
```

Фронтенд трекера открыт по адресу `https://tracker.local` и загружает задачи проекта `1` запросом `GET /tasks?project_id=1` к `https://api.tracker.local`. Сейчас `CORSMiddleware` на сервере не разрешает ни одного origin, и браузер блокирует ответ.

Настройте `CORSMiddleware` так, чтобы страница `https://tracker.local` получила ответ, а остальные сайты, например `https://evil.example`, — нет. Нажмите «Запустить фронтенд», посмотрите журнал, затем «Проверить».

```json starter
{ "allowOrigins": [], "allowMethods": ["GET"], "allowHeaders": [] }
```

```json solution
{ "allowOrigins": ["https://tracker.local"], "allowMethods": ["GET"], "allowHeaders": [] }
```

## task web-cors-simple

```json
{
  "type": "choice",
  "title": "Кому нужен preflight",
  "hints": [
    "Раздел «Простые запросы и preflight».",
    "Проверьте у каждого вызова метод и заголовки. Простому запросу подходят только `GET`, `HEAD`, `POST` и простые заголовки.",
    "Отбросьте вызов с методом не из списка `GET`, `HEAD`, `POST`. Затем — вызовы с `Authorization` и с `Content-Type: application/json`: такого заголовка и такого типа тела нет среди простых."
  ],
  "options": [
    "`fetch(url)` — обычный `GET` без настроек",
    "`POST` с заголовком `Content-Type: application/json`",
    "`DELETE` без тела и заголовков",
    "`GET` с заголовком `Authorization: Bearer demo-token-123`"
  ],
  "answer": [0],
  "explanation": "Без preflight уходит только `GET` без дополнительных заголовков. `POST` с `Content-Type: application/json` — непростой тип тела, `DELETE` — непростой метод, а `Authorization` нет в списке простых заголовков. Во всех трёх случаях браузер сначала отправит `OPTIONS`."
}
```

Страница `https://tracker.local` обращается к `https://api.tracker.local`. Какой из запросов браузер отправит сразу, **без** предварительного `OPTIONS`?

## task web-cors-preflight

```json
{
  "type": "cors",
  "title": "Разрешить смену статуса",
  "server": "tracker",
  "fetch": { "origin": "https://tracker.local", "request": "PATCH /tasks/3\nContent-Type: application/json\nAuthorization: Bearer demo-token-123\n\n{\"status\": \"done\"}" },
  "check": { "mustBlock": [{ "origin": "https://tracker.local", "request": "DELETE /tasks/3" }] },
  "hints": [
    "Раздел «Простые запросы и preflight».",
    "Запрос непростой: метод `PATCH` и заголовок `Authorization`. `Content-Type` разрешён всегда. Запустите фронтенд и прочитайте в журнале, почему не прошёл preflight; после первой правки — ещё раз.",
    "`allow_methods`: `GET, …`; `allow_headers`: `…`"
  ]
}
```

На доске `https://tracker.local` задачу перетаскивают в колонку «Готово». Фронтенд отправляет `PATCH /tasks/3` с заголовками `Content-Type: application/json` и `Authorization: Bearer demo-token-123` (токен пользователя, о нём — в следующем уроке) и телом `{"status": "done"}`. Origin фронтенда уже разрешён, но браузер всё равно не отправляет запрос.

Допишите настройки `CORSMiddleware`, чтобы смена статуса заработала. Разрешайте только нужное: удаление задач (`DELETE`) с этой страницы должно остаться запрещённым.

```json starter
{ "allowOrigins": ["https://tracker.local"], "allowMethods": ["GET"], "allowHeaders": [] }
```

```json solution
{ "allowOrigins": ["https://tracker.local"], "allowMethods": ["GET", "PATCH"], "allowHeaders": ["Authorization"] }
```

## task web-cors-credentials

```json
{
  "type": "cors",
  "title": "Cookie, но не для всех",
  "server": "tracker",
  "fetch": { "origin": "https://app.tracker.local", "request": "GET /tasks?assignee=anna", "credentials": true },
  "check": { "mustBlock": [{ "origin": "https://evil.example", "credentials": true }] },
  "hints": [
    "Раздел «Cookie и allow_credentials».",
    "Запустите фронтенд: сейчас он работает, но с такими настройками ответ с cookie получит и любой другой сайт. Замените `*` на точный origin, `allow_credentials` оставьте включённым.",
    "`allow_origins`: `https://app.…`; `allow_credentials` включён"
  ]
}
```

Личный кабинет `https://app.tracker.local` показывает задачи пользователя `anna`: отправляет `GET /tasks?assignee=anna` с `credentials: 'include'`, чтобы ушла cookie сессии. Коллега настроил сервер так: `allow_origins=["*"]` и `allow_credentials=True`. Кабинет работает, но так данные пользователя с его cookie может прочитать любой сайт.

Исправьте настройки: кабинет `https://app.tracker.local` должен получать ответ с cookie, а другие сайты, например `https://evil.example`, — нет.

```json starter
{ "allowOrigins": ["*"], "allowMethods": ["GET"], "allowHeaders": [], "allowCredentials": true }
```

```json solution
{ "allowOrigins": ["https://app.tracker.local"], "allowMethods": ["GET"], "allowHeaders": [], "allowCredentials": true }
```
