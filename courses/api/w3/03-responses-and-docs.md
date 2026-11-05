# Ответы, коды и документация

Фронтенд трекера после создания задачи ждёт код `201` и новую запись, после удаления — `204` без тела. Экран профиля в магазине получает данные покупателя, но пароль туда попадать не должен ни при каких условиях. А разработчик фронтенда хочет знать, какие адреса и поля есть в API, не читая ваш код. В этом уроке — как FastAPI управляет кодом и содержимым ответа и как он сам описывает API в формате OpenAPI.

### Код успешного ответа: status_code

По умолчанию успешный ответ FastAPI идёт с кодом `200`. Другой код указывают в декораторе:

```python
@app.post("/путь", status_code=201)
def функция(данные: Модель):
    ...
```

- `status_code=` — код ответа, когда функция завершилась обычным `return`.
- Для создания записи по правилам REST нужен `201 Created`.
- Ошибки по-прежнему идут со своими кодами: `422` от проверки FastAPI, `404` и другие — от `HTTPException`.
- Значения Python в ответе превращаются в JSON: `True` → `true`, `False` → `false`, `None` → `null`.

```python example
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()
CHATS = []

class ChatIn(BaseModel):
    title: str = Field(min_length=1, max_length=50)

@app.post("/chats", status_code=201)
def create_chat(chat: ChatIn):
    new_chat = {"id": len(CHATS) + 1, "title": chat.title, "archived": False}
    CHATS.append(new_chat)
    return new_chat
###
POST /chats
Content-Type: application/json

{"title": "Команда"}
###
POST /chats
Content-Type: application/json

{"title": ""}
```

Первый запрос получил `201` и `{"id": 1, "title": "Команда", "archived": false}`. Второй не прошёл проверку модели — код `422`, а не `201`: `status_code` касается только успешного ответа.

### Ответ без тела: 204

После удаления клиенту нечего показывать — достаточно знать, что всё прошло. Для этого есть `204 No Content`:

```python
@app.delete("/ресурс/{номер}", status_code=204)
def функция(номер: int):
    if номер not in СЛОВАРЬ:
        raise HTTPException(status_code=404, detail="...")
    del СЛОВАРЬ[номер]
```

- `status_code=204` в декораторе `@app.delete`.
- Функция ничего не возвращает — у ответа `204` нет тела, поэтому `return` не нужен.
- `del словарь[ключ]` удаляет запись из словаря. Если ключа нет, Python выбросит `KeyError`, и клиент получит `500`. Поэтому сначала проверка `not in` и `404`.

```python example
from fastapi import FastAPI, HTTPException

app = FastAPI()
MESSAGES = {1: "Привет", 2: "Созвонимся?", 3: "Да, в 15:00"}

@app.delete("/messages/{message_id}", status_code=204)
def delete_message(message_id: int):
    if message_id not in MESSAGES:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    del MESSAGES[message_id]
###
DELETE /messages/2
###
DELETE /messages/2
```

Первый `DELETE` получил `204` с пустым телом. Второй — `404 {"detail": "Сообщение не найдено"}`: сообщения уже нет. Повторное удаление не меняет состояние сервера — `DELETE` идемпотентен, хотя код ответа другой.

### Модель ответа: response_model

Обычно данные, которые приходят, и данные, которые уходят, различаются. При регистрации клиент присылает пароль, а в ответе пароля быть не должно. Форму ответа задаёт отдельная модель:

```python
class МодельОтвета(BaseModel):
    поле: тип

@app.post("/путь", status_code=201, response_model=МодельОтвета)
def функция(данные: МодельВхода):
    return словарь
```

- `response_model=` в декораторе — модель, по которой FastAPI строит ответ. Из того, что вернула функция, в ответ попадают только поля этой модели, в её порядке. Лишние (например, `password`) отбрасываются.
- Модели обычно называют парой: `UserIn` — что приходит, `UserOut` — что уходит.
- Аргументы декоратора пишутся через запятую в любом порядке: `status_code=201, response_model=UserOut`.
- Для списка записей — `response_model=list[UserOut]`: каждый элемент списка пройдёт через модель.
- Если в возвращённом словаре нет поля, которое требует модель ответа, это ошибка сервера: клиент получит `500`.

```python example
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()
USERS = []

class UserIn(BaseModel):
    login: str = Field(min_length=3)
    password: str = Field(min_length=8)

class UserOut(BaseModel):
    id: int
    login: str

@app.post("/users", status_code=201, response_model=UserOut)
def register(user: UserIn):
    new_user = {"id": len(USERS) + 1, "login": user.login, "password": user.password}
    USERS.append(new_user)
    return new_user

@app.get("/users", response_model=list[UserOut])
def list_users():
    return USERS
###
POST /users
Content-Type: application/json

{"login": "anna", "password": "demo-pass-123"}
###
POST /users
Content-Type: application/json

{"login": "oleg", "password": "demo-pass-456"}
###
GET /users
```

`USERS` хранит пароли (в настоящем приложении — не сами пароли, а их хеши), но ни один ответ их не показал: `POST` вернул `{"id": 1, "login": "anna"}`, а `GET /users` — список из двух записей с полями `id` и `login`.

### Ошибки 404 и 409 через HTTPException

`HTTPException` из первого урока подходит для любого кода ошибки. Чаще всего в API встречаются два:

- `404 Not Found` — записи с таким номером нет;
- `409 Conflict` — запрос правильный, но противоречит тому, что уже есть на сервере: логин занят, email уже зарегистрирован.

Поиск в списке словарей — обычный цикл:

```python
for запись in СПИСОК:
    if запись["поле"] == значение:
        raise HTTPException(status_code=409, detail="...")   # или return запись
```

- `return` внутри цикла сразу завершает функцию — так возвращают найденную запись.
- Если цикл дошёл до конца и ничего не нашёл, выполняется код после цикла — там и пишут `raise HTTPException(status_code=404, ...)`.
- `response_model` действует и на ответы `GET`: найденную запись с паролем FastAPI тоже очистит.

```python example
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
USERS = [{"id": 1, "login": "anna", "password": "demo-pass-123"}]

class UserIn(BaseModel):
    login: str = Field(min_length=3)
    password: str = Field(min_length=8)

class UserOut(BaseModel):
    id: int
    login: str

@app.post("/users", status_code=201, response_model=UserOut)
def register(user: UserIn):
    for existing in USERS:
        if existing["login"] == user.login:
            raise HTTPException(status_code=409, detail="Логин уже занят")
    new_user = {"id": len(USERS) + 1, "login": user.login, "password": user.password}
    USERS.append(new_user)
    return new_user

@app.get("/users/{user_id}", response_model=UserOut)
def get_user(user_id: int):
    for user in USERS:
        if user["id"] == user_id:
            return user
    raise HTTPException(status_code=404, detail="Пользователь не найден")
###
POST /users
Content-Type: application/json

{"login": "anna", "password": "other-pass-789"}
###
GET /users/1
###
GET /users/5
```

Регистрация с занятым логином получила `409 {"detail": "Логин уже занят"}`. `GET /users/1` вернул `{"id": 1, "login": "anna"}` без пароля, а `GET /users/5` — `404`.

### OpenAPI: договор API

FastAPI собирает описание всего приложения в стандартном формате **OpenAPI**: адреса, методы, параметры, модели тела и ответа, коды ответов. Вы ничего для этого не пишете — описание строится из декораторов, аннотаций и моделей и отдаётся по адресу `GET /openapi.json`.

```python example
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Мессенджер")

class ChatIn(BaseModel):
    title: str

@app.post("/chats", status_code=201)
def create_chat(chat: ChatIn):
    return {"id": 1, "title": chat.title}
###
GET /openapi.json
```

Ответ большой. Главное в нём (сокращённо):

```json
{
  "openapi": "3.1.0",
  "info": {"title": "Мессенджер", "version": "0.1.0"},
  "paths": {
    "/chats": {
      "post": {
        "summary": "Create Chat",
        "requestBody": {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/ChatIn"}}}, "required": true},
        "responses": {"201": {"description": "Successful Response"}, "422": {"description": "Validation Error"}}
      }
    }
  },
  "components": {"schemas": {"ChatIn": {"properties": {"title": {"type": "string"}}, "required": ["title"]}}}
}
```

- `info` — название и версия API; название задаёт `FastAPI(title="...")`.
- `paths` — каждый адрес и его методы. У метода: `summary` (FastAPI делает его из имени функции: `create_chat` → «Create Chat», поэтому давайте функциям понятные имена), `requestBody` (какое тело ждать), `responses` (какие коды возможны — `201` из `status_code` и `422` от проверки).
- `components.schemas` — модели Pydantic: поля, их типы и список обязательных (`required`). Ссылка `$ref` в `paths` указывает на модель отсюда.

Это **договор** между бэкендом и его клиентами. По нему фронтенд-разработчик узнаёт, что отправлять и что придёт; по нему же специальные программы создают готовый код клиентов и проверяют, не сломалось ли API. Поменяли модель — поменялся договор: удалённое или переименованное поле ломает клиентов, которые на него рассчитывали.

**Swagger UI на `/docs`.** На своём компьютере после `uvicorn main:app --reload` откройте в браузере `http://127.0.0.1:8000/docs`. Там интерактивная страница, построенная из `/openapi.json`: список адресов, у каждого — поля, модели и коды ответов, а кнопка «Try it out» отправляет запрос прямо из браузера. По адресу `/redoc` — то же описание в виде документа для чтения.

В учебной среде `/docs` не работает: страница Swagger UI загружает свои скрипты и стили из интернета, а приложение здесь работает без сети. Запрос `GET /docs` вернёт только заготовку HTML со ссылками на эти скрипты. Сам договор — `GET /openapi.json` — доступен полностью, а всё, что показывает Swagger UI, берётся именно оттуда.

### Частые ошибки

- `return HTTPException(status_code=404, ...)` → `raise HTTPException(...)`: с `return` клиент получит код `200` и странный JSON вместо ошибки.
- `del TASKS[task_id]` без проверки → сначала `if task_id not in TASKS: raise HTTPException(status_code=404, ...)`, иначе для несуществующей записи ответ `500`.
- Вернуть словарь с паролем без `response_model` → пароль уйдёт клиенту. Задайте модель ответа без этого поля.
- `response_model=UserOut`, а в возвращённом словаре нет `id` → `500`: модель ответа требует все свои обязательные поля.
- `@app.post("/users")` без `status_code=201` → создание ответит `200`; для новых записей по правилам REST нужен `201`.

### Шпаргалка

- `@app.post("/путь", status_code=201)` — код успешного ответа.
- `@app.delete("/путь/{id}", status_code=204)` и функция без `return` — ответ без тела; `del словарь[ключ]` — удалить запись.
- `response_model=ModelOut` — в ответ попадут только поля модели; `response_model=list[ModelOut]` — для списка.
- `raise HTTPException(status_code=404 | 409, detail="...")` — нет записи / конфликт с уже существующей.
- `GET /openapi.json` — договор API; `/docs` (Swagger UI) и `/redoc` — страницы на его основе, на своём компьютере.

## task fa-task-create

```json
{
  "type": "fastapi",
  "title": "Новая задача — 201",
  "hints": [
    "Раздел «Код успешного ответа: status_code».",
    "Нужен декоратор `@app.post` с путём `/tasks` и `status_code=201`. Новая задача — словарь с `id`, `title` и `done`, его добавляют в `TASKS` и возвращают.",
    "```python\n@app.post(\"/tasks\", status_code=…)\ndef create_task(task: TaskIn):\n    new_task = {\"id\": …, \"title\": task.…, \"done\": …}\n    TASKS.append(new_task)\n    return …\n```"
  ]
}
```

В трекере задач нужен адрес для создания задачи. Модель тела `TaskIn` уже описана: поле `title` — строка от 3 до 100 символов.

Допишите обработчик `POST /tasks`:

- успешный ответ — с кодом `201`;
- новая задача — словарь с ключами в таком порядке: `id` (`len(TASKS) + 1` до добавления), `title` (из тела), `done` (`False`);
- задача добавляется в `TASKS`, ответ — эта задача.

```python starter
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()
TASKS = []

class TaskIn(BaseModel):
    title: str = Field(min_length=3, max_length=100)

@app.post("/tasks", …)
def create_task(task: TaskIn):
    new_task = …
    TASKS.append(new_task)
    return new_task
```

```python solution
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()
TASKS = []

class TaskIn(BaseModel):
    title: str = Field(min_length=3, max_length=100)

@app.post("/tasks", status_code=201)
def create_task(task: TaskIn):
    new_task = {"id": len(TASKS) + 1, "title": task.title, "done": False}
    TASKS.append(new_task)
    return new_task
```

```http starter
POST /tasks
Content-Type: application/json

{"title": "Сверстать форму входа"}
```

```http tests
POST /tasks
Content-Type: application/json

{"title": "Сверстать форму входа"}
###
POST /tasks
Content-Type: application/json

{"title": "Починить экспорт отчёта"}
###
POST /tasks
Content-Type: application/json

{"title": "ok"}
###
POST /tasks
Content-Type: application/json

{}
###
POST /tasks
Content-Type: application/json

{"title": "Настроить CI"}
```

## task fa-task-delete

```json
{
  "type": "fastapi",
  "title": "Удаление задачи — 204",
  "hints": [
    "Раздел «Ответ без тела: 204».",
    "Декоратор `@app.delete` с путём `/tasks/{task_id}` и `status_code=204`. Сначала `task_id not in TASKS` → `HTTPException` с кодом `404`, затем `del TASKS[task_id]`; `return` не нужен.",
    "```python\n@app.delete(\"/tasks/{task_id}\", status_code=…)\ndef delete_task(task_id: …):\n    if … not in TASKS:\n        raise HTTPException(status_code=…, detail=\"…\")\n    del …\n```"
  ]
}
```

В трекере задачи хранятся в словаре `TASKS` (номер → задача), и уже есть `GET /tasks/{task_id}`. Добавьте удаление — обработчик `DELETE /tasks/{task_id}`:

- номер задачи — целое число;
- если задача есть — удалить её из `TASKS` и ответить `204` без тела. После этого `GET /tasks/{task_id}` для неё отвечает `404`;
- если задачи нет — ответ `404` с `detail` `Задача не найдена`.

```python starter
from fastapi import FastAPI, HTTPException

app = FastAPI()
TASKS = {
    1: {"id": 1, "title": "Сверстать форму входа"},
    2: {"id": 2, "title": "Починить экспорт отчёта"},
    3: {"id": 3, "title": "Обновить зависимости"},
}

@app.get("/tasks/{task_id}")
def get_task(task_id: int):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return TASKS[task_id]
```

```python solution
from fastapi import FastAPI, HTTPException

app = FastAPI()
TASKS = {
    1: {"id": 1, "title": "Сверстать форму входа"},
    2: {"id": 2, "title": "Починить экспорт отчёта"},
    3: {"id": 3, "title": "Обновить зависимости"},
}

@app.get("/tasks/{task_id}")
def get_task(task_id: int):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return TASKS[task_id]

@app.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int):
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    del TASKS[task_id]
```

```http starter
DELETE /tasks/2
```

```http tests
DELETE /tasks/2
###
GET /tasks/2
###
DELETE /tasks/2
###
GET /tasks/1
###
DELETE /tasks/abc
###
DELETE /tasks/3
###
GET /tasks/3
```

## task fa-customers

```json
{
  "type": "fastapi",
  "title": "Покупатели без паролей",
  "hints": [
    "Разделы «Модель ответа: response_model» и «Ошибки 404 и 409 через HTTPException».",
    "Две модели: `CustomerIn` (`email`, `name`, `password` с `Field(min_length=8)`) и `CustomerOut` (`id`, `email`, `name`). В `POST` сначала цикл по `CUSTOMERS` — при совпадении `email` ответ `409`; в `GET` цикл с `return`, после цикла `404`. Оба декоратора — с `response_model=CustomerOut`.",
    "```python\n@app.post(\"/customers\", status_code=…, response_model=…)\ndef register(customer: CustomerIn):\n    for existing in CUSTOMERS:\n        if existing[\"email\"] == …:\n            raise HTTPException(status_code=…, detail=\"…\")\n    new_customer = {\"id\": …, \"email\": …, \"name\": …, \"password\": …}\n    …\n\n@app.get(\"/customers/{customer_id}\", response_model=…)\ndef get_customer(customer_id: int):\n    for customer in CUSTOMERS:\n        if …:\n            return customer\n    raise …\n```"
  ],
  "check": {
    "code": [{ "pattern": "response_model\\s*=", "message": "Лишние поля уберите через response_model — раздел «Модель ответа: response_model»." }]
  }
}
```

Магазину нужна регистрация покупателей. Покупатели хранятся в списке `CUSTOMERS` — сейчас он пуст.

**`POST /customers`** — регистрация. Тело — JSON с полями `email` (строка), `name` (строка) и `password` (строка не короче 8 символов), все обязательные.

- Если покупатель с таким `email` уже есть в `CUSTOMERS` — ответ `409` с `detail` `Email уже зарегистрирован`.
- Иначе в `CUSTOMERS` добавляется словарь `{"id": ..., "email": ..., "name": ..., "password": ...}`, где `id` — `len(CUSTOMERS) + 1` до добавления. Ответ — код `201` и JSON с полями `id`, `email`, `name` (в таком порядке) без пароля.

**`GET /customers/{customer_id}`** — покупатель по номеру (целое число): те же три поля `id`, `email`, `name` без пароля, код `200`. Если покупателя нет — `404` с `detail` `Покупатель не найден`.

Пароль не должен уходить клиенту ни в одном ответе.

```python starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
CUSTOMERS = []
```

```python solution
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
CUSTOMERS = []

class CustomerIn(BaseModel):
    email: str
    name: str
    password: str = Field(min_length=8)

class CustomerOut(BaseModel):
    id: int
    email: str
    name: str

@app.post("/customers", status_code=201, response_model=CustomerOut)
def register(customer: CustomerIn):
    for existing in CUSTOMERS:
        if existing["email"] == customer.email:
            raise HTTPException(status_code=409, detail="Email уже зарегистрирован")
    new_customer = {"id": len(CUSTOMERS) + 1, "email": customer.email, "name": customer.name, "password": customer.password}
    CUSTOMERS.append(new_customer)
    return new_customer

@app.get("/customers/{customer_id}", response_model=CustomerOut)
def get_customer(customer_id: int):
    for customer in CUSTOMERS:
        if customer["id"] == customer_id:
            return customer
    raise HTTPException(status_code=404, detail="Покупатель не найден")
```

```http starter
POST /customers
Content-Type: application/json

{"email": "anna@example.com", "name": "Анна", "password": "demo-pass-1"}
```

```http tests
POST /customers
Content-Type: application/json

{"email": "anna@example.com", "name": "Анна", "password": "demo-pass-1"}
###
POST /customers
Content-Type: application/json

{"email": "oleg@example.com", "name": "Олег", "password": "demo-pass-2"}
###
POST /customers
Content-Type: application/json

{"email": "anna@example.com", "name": "Анна К.", "password": "demo-pass-3"}
###
POST /customers
Content-Type: application/json

{"email": "ivan@example.com", "name": "Иван", "password": "123"}
###
POST /customers
Content-Type: application/json

{"email": "ivan@example.com", "name": "Иван", "password": "demo-pass-4"}
###
GET /customers/1
###
GET /customers/3
###
GET /customers/7
###
GET /customers/abc
```

## task fa-openapi-contract

```json
{
  "type": "choice",
  "title": "Где смотреть договор",
  "hints": [
    "Раздел «OpenAPI: договор API».",
    "Вспомните, откуда Swagger UI берёт данные и почему он не открывается в учебной среде.",
    "Swagger UI на `/docs` — только страница над файлом описания, и в учебной среде она не грузится. По какому адресу FastAPI отдаёт сам этот файл и в каких его разделах лежат путь `/customers` и модели?"
  ],
  "options": [
    "Отправить `GET /docs`: в учебной среде откроется Swagger UI со списком полей",
    "Отправить `GET /openapi.json`: в `paths` найти `/customers` → `post` → `requestBody`, а саму модель — в `components.schemas`",
    "Отправить `OPTIONS /customers`: FastAPI ответит списком полей тела",
    "Никак: FastAPI не описывает API сам, нужно прочитать `main.py`"
  ],
  "answer": [1],
  "explanation": "FastAPI сам строит описание OpenAPI из декораторов и моделей и отдаёт его по `GET /openapi.json`: в `paths` у `/customers` → `post` есть `requestBody` со ссылкой на модель, а поля и обязательные из них — в `components.schemas`. Swagger UI на `/docs` строится из того же файла, но грузит скрипты из интернета, поэтому в учебной среде вернёт только заготовку HTML; на своём компьютере он работает. `OPTIONS` — служебный метод, который браузер отправляет перед некоторыми запросами (о нём — в мире «Фронтенд и бэкенд»); списка полей он не возвращает, а без дополнительных настроек FastAPI ответит на него `405`. Вариант «никак» неверен: читать код не нужно, договор FastAPI строит сам."
}
```

Разработчик фронтенда магазина делает форму регистрации и хочет узнать, какие поля принимает `POST /customers` из прошлого задания и какие из них обязательные. Код `main.py` ему недоступен, приложение запущено в учебной среде. Как ему получить ответ?
