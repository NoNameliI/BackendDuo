# Параметры запроса и тело

Фронтенд магазина показывает каталог с фильтром «только кухня, не дороже 700 ₽» и отправляет оформленный заказ. Фильтр едет в адресе как параметры запроса: `/products?category=kitchen&max_price=700`. Заказ едет в теле запроса как JSON. В FastAPI и то и другое — просто аргументы функции-обработчика: FastAPI сам достаёт значения, проверяет типы и ограничения и, если данные не подходят, отвечает `422`, не вызывая вашу функцию.

### Параметры запроса

Параметр функции, которого нет в пути в фигурных скобках, FastAPI ищет в параметрах запроса — в части адреса после `?`:

```python
@app.get("/ресурс")
def функция(параметр: тип):
    ...
```

- Адрес запроса тогда выглядит так: `/ресурс?параметр=значение`.
- `: тип` — аннотация, как у параметра пути: `str` — строка как есть, `int` — целое число. Текст `abc` для `int` даст ответ `422`.
- Параметр без значения по умолчанию обязательный. Если его нет в адресе, FastAPI ответит `422` с ошибкой `missing`.
- Несколько параметров перечисляются в скобках функции через запятую. В адресе они идут через `&`, их порядок не важен. Параметры, которых функция не объявила, FastAPI просто не замечает.

```python example
from fastapi import FastAPI

app = FastAPI()
PRODUCTS = [
    {"id": 1, "name": "Чайник", "category": "kitchen", "price": 2490},
    {"id": 2, "name": "Кружка", "category": "kitchen", "price": 390},
    {"id": 3, "name": "Задачник по Python", "category": "books", "price": 650},
]

@app.get("/products")
def list_products(category: str):
    result = []
    for product in PRODUCTS:
        if product["category"] == category:
            result.append(product)
    return result
###
GET /products?category=kitchen
###
GET /products
```

Функция собирает ответ в пустой список `result`: `result.append(product)` добавляет товар в конец списка. На первый запрос пришли чайник и кружка: список Python FastAPI превращает в массив JSON. На второй функция не вызывалась: параметра `category` нет, и FastAPI ответил `422`, где `"loc": ["query", "category"]` и `"type": "missing"` — «в параметрах запроса не передано поле category».

### Значение по умолчанию и необязательный параметр

Чтобы параметр можно было не передавать, ему дают значение по умолчанию:

```python
def функция(параметр: тип = значение, другой: тип | None = None):
    ...
```

- `= значение` после аннотации — значение по умолчанию: если параметра нет в адресе, функция получит это значение.
- `None` — особое значение Python «ничего нет». В JSON оно превращается в `null`.
- `str | None` читается «строка или ничего»: знак `|` в аннотации означает «или». Вместе с `= None` это необязательный параметр, у которого по умолчанию нет значения.
- Проверять «передали или нет» принято через `is`: `параметр is None` — не передали, `параметр is not None` — передали.
- `условие_1 or условие_2` истинно, если истинно хотя бы одно из условий.
- `список[:n]` — **срез**: первые `n` элементов списка (если элементов меньше — все, сколько есть).

```python example
from fastapi import FastAPI

app = FastAPI()
MESSAGES = [
    {"id": 1, "author": "anna", "text": "Привет"},
    {"id": 2, "author": "oleg", "text": "Привет, как дела?"},
    {"id": 3, "author": "anna", "text": "Отлично. Созвонимся вечером?"},
]

@app.get("/messages")
def list_messages(author: str | None = None, limit: int = 2):
    result = []
    for message in MESSAGES:
        if author is None or message["author"] == author:
            result.append(message)
    return result[:limit]
###
GET /messages
###
GET /messages?author=anna&limit=5
```

Без параметров `author` равен `None`, условие пропускает все сообщения, а `limit` равен `2` — пришли первые два. Во втором запросе остались только сообщения `anna`, и их меньше пяти, поэтому пришли оба.

### Ограничения через Query

Иногда тип подходит, а значение нет: `limit=0` или `limit=100000`. Правила для параметра запроса задаёт `Query`:

```python
from fastapi import FastAPI, Query

def функция(параметр: int = Query(default=значение, ge=минимум, le=максимум)):
    ...
```

- `Query` подключается из `fastapi` в той же строке импорта, через запятую.
- `Query(...)` пишут вместо простого значения по умолчанию. `default=` — значение по умолчанию; без `default=` параметр обязательный.
- Правила для чисел: `ge` — не меньше (≥), `le` — не больше (≤), `gt` — больше (>), `lt` — меньше (<). Буквы — от английских greater/less и equal.
- Правила для строк: `min_length` и `max_length` — наименьшая и наибольшая длина.
- Если правило нарушено, функция не вызывается: FastAPI отвечает `422` и называет правило в поле `ctx`.

```python example
from fastapi import FastAPI, Query

app = FastAPI()
PRODUCTS = [
    {"id": 1, "name": "Чайник", "price": 2490},
    {"id": 2, "name": "Кружка", "price": 390},
    {"id": 3, "name": "Задачник по Python", "price": 650},
]

@app.get("/products/cheap")
def cheap_products(max_price: int = Query(gt=0), limit: int = Query(default=10, ge=1, le=20)):
    result = []
    for product in PRODUCTS:
        if product["price"] <= max_price:
            result.append(product)
    return result[:limit]
###
GET /products/cheap?max_price=700
###
GET /products/cheap?max_price=0
###
GET /products/cheap?max_price=700&limit=50
```

Первый запрос вернул кружку и задачник. На `max_price=0` пришёл `422` с `"type": "greater_than"` и `"ctx": {"gt": 0}`: значение должно быть больше нуля. На `limit=50` — `422` с `"type": "less_than_equal"` и `"ctx": {"le": 20}`.

В документации FastAPI и в чужом коде встречается запись `limit: Annotated[int, Query(ge=1, le=20)] = 10`. Она значит то же самое; в курсе используется короткая форма с `default=`.

### Тело запроса и модель Pydantic

Данные для создания записи (заказ, сообщение, задача) клиент отправляет в теле запроса `POST` в формате JSON. Чтобы FastAPI знал, какие поля ждать, вы описываете форму тела **моделью** — классом Pydantic:

```python
from pydantic import BaseModel

class ИмяМодели(BaseModel):
    поле: тип
    необязательное_поле: тип = значение

@app.post("/путь")
def функция(данные: ИмяМодели):
    ... данные.поле ...
```

- Pydantic — библиотека проверки данных, на которой построен FastAPI. `BaseModel` — основа для всех моделей; подключается из `pydantic`, а не из `fastapi`.
- `class ИмяМодели(BaseModel):` — **класс**, то есть описание формы данных. Имя модели пишут слитно с большой буквы: `CartItem`, `OrderIn`. После двоеточия идут поля с отступом в 4 пробела.
- Каждое поле — имя и аннотация типа. Поле без значения по умолчанию обязательно, поле с `= значение` или `тип | None = None` — нет.
- Если аннотация параметра функции — модель, FastAPI читает этот параметр из тела запроса, а не из адреса. Тело проверяется целиком, и обо всех ошибках сразу сообщает один ответ `422`.
- Значение поля достают через точку: `данные.поле`.
- Вернуть можно словарь или саму модель — модель FastAPI превратит в JSON со всеми её полями.
- Запрос с телом, как вы уже знаете: заголовок `Content-Type: application/json`, пустая строка, затем JSON с двойными кавычками.

```python example
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()
PRICES = {1: 2490, 2: 390, 3: 650}

class CartItem(BaseModel):
    product_id: int
    quantity: int = 1

@app.post("/cart/items")
def add_to_cart(item: CartItem):
    return {"product_id": item.product_id, "quantity": item.quantity, "sum": PRICES[item.product_id] * item.quantity}
###
POST /cart/items
Content-Type: application/json

{"product_id": 2, "quantity": 3}
###
POST /cart/items
Content-Type: application/json

{"product_id": 3}
###
POST /cart/items
Content-Type: application/json

{"quantity": "два"}
```

Первый ответ — `{"product_id": 2, "quantity": 3, "sum": 1170}`. Во втором `quantity` не передали, и модель подставила `1`. Третий запрос получил `422` с двумя ошибками сразу: не передан `product_id` и `quantity` не целое число.

### Ограничения полей: Field

Для полей модели правила задаёт `Field` — так же, как `Query` для параметров запроса:

```python
from pydantic import BaseModel, Field

class Модель(BaseModel):
    строка: str = Field(min_length=минимум, max_length=максимум)
    число: int = Field(gt=0)
    с_умолчанием: int = Field(default=значение, ge=минимум, le=максимум)
```

- `Field` подключается из `pydantic`, в одной строке с `BaseModel`.
- Те же правила: `ge`, `le`, `gt`, `lt` для чисел, `min_length`, `max_length` для строк.
- `default=` делает поле необязательным; без него поле с `Field` обязательно.

В примере ниже сохраняется новое сообщение. Пригодятся три приёма обычного Python:

- `список.append(значение)` добавляет значение в конец списка;
- `len(список)` — сколько в нём элементов. Номер новой записи здесь — `len(MESSAGES) + 1`: в учебном приложении записи не удаляются, а в настоящем номера выдаёт база данных;
- параметр пути и тело можно объявить в одной функции: `chat_id` FastAPI возьмёт из пути, модель — из тела.

```python example
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()
MESSAGES = []

class MessageIn(BaseModel):
    author: str = Field(min_length=3, max_length=20)
    text: str = Field(min_length=1, max_length=500)

@app.post("/chats/{chat_id}/messages")
def send_message(chat_id: int, message: MessageIn):
    new_message = {"id": len(MESSAGES) + 1, "chat_id": chat_id, "author": message.author, "text": message.text}
    MESSAGES.append(new_message)
    return new_message
###
POST /chats/7/messages
Content-Type: application/json

{"author": "anna", "text": "Встреча в 15:00"}
###
POST /chats/7/messages
Content-Type: application/json

{"author": "oleg", "text": "Буду"}
###
POST /chats/7/messages
Content-Type: application/json

{"author": "li", "text": ""}
```

Первые два сообщения сохранились с номерами `1` и `2`. Третье не прошло проверку: автор короче трёх символов и текст пустой, ответ `422`, а функция не вызывалась — в `MESSAGES` по-прежнему два сообщения.

Успешный `POST` пока отвечает кодом `200`. Как вернуть `201 Created`, вы узнаете в следующем уроке.

### Как читать ошибку 422

Ответ `422` FastAPI строит по одному образцу:

```json
{"detail": [{"type": "вид_ошибки", "loc": ["часть_запроса", "поле"], "msg": "текст", "input": "что_пришло", "ctx": {"правило": значение}}]}
```

- `detail` — список: по одному элементу на каждую найденную ошибку.
- `loc` — где ошибка. Первый элемент — часть запроса: `path` (путь), `query` (параметры запроса), `body` (тело). Второй — имя поля.
- `type` — вид ошибки: `missing` — поле не передано, `int_parsing` — не целое число, `string_too_short` — строка короче `min_length`, `greater_than_equal` — нарушено `ge`, `less_than_equal` — нарушено `le`, `greater_than` — нарушено `gt`, `json_invalid` — тело не JSON (например, лишняя запятая или одинарные кавычки).
- `msg` — описание по-английски, `input` — значение, которое пришло, `ctx` — правило, которое нарушено (есть не у всех ошибок).
- В композере под ответом `422` каждая ошибка пересказана по-русски.

Читайте ошибку так: сначала `loc` (где), потом `type` (что не так), потом `input` (что прислали). Например, `"loc": ["body", "quantity"]`, `"type": "greater_than_equal"`, `"input": 0`, `"ctx": {"ge": 1}` — «в теле поле `quantity` должно быть не меньше 1, а пришло 0». Код `422` значит, что виноват запрос, а не сервер: функция даже не вызывалась.

### Частые ошибки

- `if author == None:` → `if author is None:` — с `None` сравнивают через `is`.
- `from fastapi import Field` → `from pydantic import BaseModel, Field`: в `fastapi` нет `Field`, приложение не запустится с `ImportError`.
- `class OrderIn:` → `class OrderIn(BaseModel):` — без `BaseModel` это обычный класс, и FastAPI не знает, как прочитать его из тела.
- `quantity: int = Field(ge=1)` в надежде, что поле необязательное → `Field(default=1, ge=1)`: без `default=` поле обязательно.
- Тело `{'quantity': 2}` → `{"quantity": 2}`: JSON требует двойных кавычек, иначе `422` с `json_invalid`.

### Шпаргалка

- `def f(x: str)` — обязательный параметр запроса `?x=...`; `x: int = 10` — со значением по умолчанию; `x: str | None = None` — необязательный.
- `x: int = Query(default=10, ge=1, le=50)` — ограничения параметра запроса (`from fastapi import Query`).
- `class M(BaseModel): поле: тип` — модель тела; `def f(data: M)` — тело из JSON; `data.поле` — значение.
- `поле: str = Field(min_length=3)`, `поле: int = Field(gt=0)` — ограничения поля (`from pydantic import BaseModel, Field`).
- `ge` ≥, `le` ≤, `gt` >, `lt` <.
- `422`: `detail` → `loc` (где), `type` (что), `input` (что пришло), `ctx` (правило).

## task fa-tasks-by-status

```json
{
  "type": "fastapi",
  "title": "Задачи по статусу",
  "hints": [
    "Раздел «Параметры запроса».",
    "Параметр функции `status: str` станет обязательным параметром запроса. В цикле сравнивайте `task[\"status\"]` со `status`.",
    "```python\ndef list_tasks(status: …):\n    …\n        if task[\"…\"] == …:\n```"
  ]
}
```

В трекере задач есть список `TASKS`. Доска фронтенда показывает колонки по статусам и для каждой колонки запрашивает `GET /tasks?status=open`, `GET /tasks?status=done` и так далее.

Допишите обработчик `GET /tasks`:

- параметр запроса `status` — строка, обязательный (без него FastAPI сам отвечает `422`);
- ответ — список задач из `TASKS`, у которых `status` совпадает с переданным, в том же порядке, что и в `TASKS`;
- если таких задач нет — пустой список `[]`.

```python starter
from fastapi import FastAPI

app = FastAPI()
TASKS = [
    {"id": 1, "title": "Сверстать форму входа", "status": "open", "assignee": "mira"},
    {"id": 2, "title": "Починить экспорт отчёта", "status": "done", "assignee": "ivan"},
    {"id": 3, "title": "Обновить зависимости", "status": "open", "assignee": "ivan"},
    {"id": 4, "title": "Написать тесты API", "status": "review", "assignee": "mira"},
    {"id": 5, "title": "Настроить CI", "status": "open", "assignee": "mira"},
]

@app.get("/tasks")
def list_tasks(…):
    result = []
    for task in TASKS:
        if …:
            result.append(task)
    return result
```

```python solution
from fastapi import FastAPI

app = FastAPI()
TASKS = [
    {"id": 1, "title": "Сверстать форму входа", "status": "open", "assignee": "mira"},
    {"id": 2, "title": "Починить экспорт отчёта", "status": "done", "assignee": "ivan"},
    {"id": 3, "title": "Обновить зависимости", "status": "open", "assignee": "ivan"},
    {"id": 4, "title": "Написать тесты API", "status": "review", "assignee": "mira"},
    {"id": 5, "title": "Настроить CI", "status": "open", "assignee": "mira"},
]

@app.get("/tasks")
def list_tasks(status: str):
    result = []
    for task in TASKS:
        if task["status"] == status:
            result.append(task)
    return result
```

```http starter
GET /tasks?status=open
```

```http tests
GET /tasks?status=open
###
GET /tasks?status=done
###
GET /tasks?status=archived
###
GET /tasks?status=review&page=2
###
GET /tasks
```

## task fa-tasks-filter

```json
{
  "type": "fastapi",
  "title": "Фильтр и лимит",
  "hints": [
    "Разделы «Значение по умолчанию и необязательный параметр» и «Ограничения через Query».",
    "`assignee: str | None = None` — необязательный параметр. Для `limit` нужен `Query` с `default=3`, `ge=1` и `le=10`, а в конце — срез `result[:limit]`.",
    "```python\nfrom fastapi import FastAPI, Query\n…\ndef list_tasks(assignee: … = None, limit: int = Query(default=…, ge=…, le=…)):\n    …\n        if assignee is None or …:\n    …\n    return result[:…]\n```"
  ],
  "check": {
    "code": [{ "pattern": "Query\\(", "message": "Ограничения для limit задайте через Query — раздел «Ограничения через Query»." }]
  }
}
```

Теперь сделайте `GET /tasks` трекера удобным для страницы «Мои задачи». Сейчас обработчик просто отдаёт все задачи. Измените его:

- `assignee` — необязательный параметр запроса, строка. Если он передан, в ответ попадают только задачи этого исполнителя; если нет — задачи всех;
- `limit` — необязательный параметр запроса, целое число не меньше 1 и не больше 10, по умолчанию `3`. В ответе не больше `limit` задач;
- задачи идут в том же порядке, что и в `TASKS`.

Если `limit` вне границ или не число, FastAPI сам должен ответить `422`.

```python starter
from fastapi import FastAPI

app = FastAPI()
TASKS = [
    {"id": 1, "title": "Сверстать форму входа", "status": "open", "assignee": "mira"},
    {"id": 2, "title": "Починить экспорт отчёта", "status": "done", "assignee": "ivan"},
    {"id": 3, "title": "Обновить зависимости", "status": "open", "assignee": "ivan"},
    {"id": 4, "title": "Написать тесты API", "status": "review", "assignee": "mira"},
    {"id": 5, "title": "Настроить CI", "status": "open", "assignee": "mira"},
]

@app.get("/tasks")
def list_tasks():
    return TASKS
```

```python solution
from fastapi import FastAPI, Query

app = FastAPI()
TASKS = [
    {"id": 1, "title": "Сверстать форму входа", "status": "open", "assignee": "mira"},
    {"id": 2, "title": "Починить экспорт отчёта", "status": "done", "assignee": "ivan"},
    {"id": 3, "title": "Обновить зависимости", "status": "open", "assignee": "ivan"},
    {"id": 4, "title": "Написать тесты API", "status": "review", "assignee": "mira"},
    {"id": 5, "title": "Настроить CI", "status": "open", "assignee": "mira"},
]

@app.get("/tasks")
def list_tasks(assignee: str | None = None, limit: int = Query(default=3, ge=1, le=10)):
    result = []
    for task in TASKS:
        if assignee is None or task["assignee"] == assignee:
            result.append(task)
    return result[:limit]
```

```http starter
GET /tasks?assignee=mira
```

```http tests
GET /tasks
###
GET /tasks?assignee=mira
###
GET /tasks?assignee=ivan&limit=1
###
GET /tasks?limit=10
###
GET /tasks?assignee=nobody
###
GET /tasks?limit=0
###
GET /tasks?limit=11
###
GET /tasks?limit=many
```

## task fa-create-order

```json
{
  "type": "fastapi",
  "title": "Оформление заказа",
  "hints": [
    "Разделы «Тело запроса и модель Pydantic» и «Ограничения полей: Field»; для ответа 404 — HTTPException из прошлого урока.",
    "Модель `OrderIn` с тремя полями: `product_id: int`, `quantity` с `Field(default=1, ge=1, le=10)`, `address` с `Field(min_length=5)`. В обработчике сначала проверьте `product_id not in PRICES`, потом сохраняйте.",
    "```python\nclass OrderIn(BaseModel):\n    product_id: …\n    quantity: int = Field(default=…, ge=…, le=…)\n    address: str = Field(…)\n\n@app.post(\"/orders\")\ndef create_order(order: OrderIn):\n    if … not in PRICES:\n        raise HTTPException(status_code=404, detail=\"…\")\n    new_order = {\"id\": len(ORDERS) + 1, …, \"total\": PRICES[…] * …}\n    ORDERS.append(new_order)\n    return new_order\n```"
  ],
  "check": {
    "code": [{ "pattern": "class\\s+\\w+\\s*\\(\\s*BaseModel\\s*\\)", "message": "Опишите тело запроса моделью: class ...(BaseModel) — раздел «Тело запроса и модель Pydantic»." }]
  }
}
```

Магазину нужен приём заказов. В приложении есть цены `PRICES` (номер товара → цена в рублях) и пустой список `ORDERS`.

Добавьте обработчик `POST /orders`. Тело запроса — JSON с полями:

- `product_id` — целое число, обязательное;
- `quantity` — целое число не меньше 1 и не больше 10, необязательное, по умолчанию `1`;
- `address` — строка не короче 5 символов, обязательная.

Опишите поля модели в этом же порядке: от него зависит порядок ошибок в ответе `422`.

Поведение:

- если товара с таким `product_id` нет в `PRICES` — ответ `404` с `detail` `Товар не найден`, заказ не сохраняется;
- иначе заказ добавляется в `ORDERS`, а ответ (код `200`) — JSON с ключами в таком порядке: `id`, `product_id`, `quantity`, `address`, `total`. Номер `id` — `len(ORDERS) + 1` до добавления (первый заказ — `1`), `total` — цена товара, умноженная на количество.

Неправильное тело FastAPI должен отклонять ответом `422` сам.

```python starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
PRICES = {1: 2490, 2: 390, 3: 650}
ORDERS = []
```

```python solution
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()
PRICES = {1: 2490, 2: 390, 3: 650}
ORDERS = []

class OrderIn(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1, le=10)
    address: str = Field(min_length=5)

@app.post("/orders")
def create_order(order: OrderIn):
    if order.product_id not in PRICES:
        raise HTTPException(status_code=404, detail="Товар не найден")
    new_order = {
        "id": len(ORDERS) + 1,
        "product_id": order.product_id,
        "quantity": order.quantity,
        "address": order.address,
        "total": PRICES[order.product_id] * order.quantity,
    }
    ORDERS.append(new_order)
    return new_order
```

```http starter
POST /orders
Content-Type: application/json

{"product_id": 2, "quantity": 3, "address": "Казань, ул. Баумана, 5"}
```

```http tests
POST /orders
Content-Type: application/json

{"product_id": 2, "quantity": 3, "address": "Казань, ул. Баумана, 5"}
###
POST /orders
Content-Type: application/json

{"product_id": 1, "address": "Самара, пр. Ленина, 1"}
###
POST /orders
Content-Type: application/json

{"product_id": 9, "quantity": 1, "address": "Пермь, ул. Мира, 2"}
###
POST /orders
Content-Type: application/json

{"product_id": 3, "quantity": 0, "address": "Омск"}
###
POST /orders
Content-Type: application/json

{"quantity": 2, "address": "Тверь, ул. Советская, 3"}
###
POST /orders
Content-Type: application/json

{"product_id": 3, "quantity": 11, "address": "Тверь, ул. Советская, 3"}
###
POST /orders
Content-Type: application/json

{"product_id": 3, "quantity": 2, "address": "Тверь, ул. Советская, 3"}
```

## task fa-read-422

```json
{
  "type": "choice",
  "title": "Что говорит 422",
  "hints": [
    "Раздел «Как читать ошибку 422».",
    "Начните с `loc`: первый элемент — часть запроса, второй — поле. Потом посмотрите `type` и `input`.",
    "`loc` равен `[\"body\", \"product_id\"]` — это отбрасывает варианты про параметр запроса и про поле `quantity`, а код `422` вместо `500` — вариант про упавший обработчик. Что тогда говорят `type` `int_parsing` и `input`?"
  ],
  "options": [
    "В адресе не хватает параметра запроса `product_id`",
    "В теле поле `product_id` должно быть целым числом, а пришла строка «два»",
    "Обработчик упал с ошибкой: в нём нужно добавить `HTTPException`",
    "В теле не передано поле `quantity`"
  ],
  "answer": [1],
  "explanation": "`loc` равен `[\"body\", \"product_id\"]` — ошибка в теле, в поле `product_id`; `type` `int_parsing` и `input` «два» говорят, что вместо целого числа пришла строка. Это не параметр запроса: тогда в `loc` стояло бы `query`. Обработчик не падал — при `422` FastAPI его даже не вызывает, а упавший обработчик дал бы `500`. Поле `quantity` у модели заказа необязательное, и в `detail` о нём ничего нет."
}
```

Фронтенд отправил на `POST /orders` из прошлого задания запрос

```http
POST /orders
Content-Type: application/json

{"product_id": "два", "address": "Казань, ул. Баумана, 5"}
```

и получил ответ `422`:

```json
{"detail": [{"type": "int_parsing", "loc": ["body", "product_id"], "msg": "Input should be a valid integer, unable to parse string as an integer", "input": "два"}]}
```

Что не так с запросом?
