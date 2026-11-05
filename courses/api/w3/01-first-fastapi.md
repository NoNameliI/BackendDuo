# Первое приложение на FastAPI

До сих пор вы отправляли запросы на готовый сервер доставки. Теперь вы напишете сервер сами. **FastAPI** — библиотека Python для API: вы описываете, какой функцией отвечать на какой запрос, а FastAPI сам читает адрес, проверяет данные и превращает ответ в JSON. В этом уроке код выполняет настоящий Python с настоящим FastAPI прямо в приложении. Первый запуск занимает несколько секунд: Python загружается, пока вы читаете.

### Приложение и первый обработчик

Минимальное приложение — это файл `main.py`:

```python
from fastapi import FastAPI

app = FastAPI()

@app.метод("/путь")
def имя_функции():
    return {"ключ": "значение"}
```

- `from fastapi import FastAPI` — подключает класс приложения из библиотеки.
- `app = FastAPI()` — создаёт приложение. Переменная должна называться `app`: по этому имени сервер его находит.
- `@app.get("/путь")` — **декоратор**: строка над функцией, которая говорит «отвечай этой функцией на `GET /путь`». Для других методов — `@app.post`, `@app.put`, `@app.patch`, `@app.delete`.
- `def имя_функции():` — обычная функция Python, её называют **обработчиком**. Двоеточие в конце обязательно, тело функции сдвигается на 4 пробела.
- `return {...}` — словарь Python, который FastAPI отправит клиенту как JSON с кодом `200`.

```python example
from fastapi import FastAPI

app = FastAPI()

@app.get("/hello")
def hello():
    return {"message": "Привет из FastAPI"}
###
GET /hello
###
GET /bye
```

На `GET /hello` пришёл JSON из функции. На `GET /bye` FastAPI сам ответил `404 {"detail": "Not Found"}`: такого маршрута нет.

На своём компьютере такой файл запускают командой `uvicorn main:app --reload`, и сервер слушает адрес `http://127.0.0.1:8000`. Здесь запускать ничего не нужно: в заданиях справа редактор `main.py`, а запросы из композера уходят прямо в ваше приложение. После правки кода следующий запрос уже идёт в новую версию.

### Параметр пути

Часть пути может быть переменной — например, номер курьера в `/couriers/2`. В декораторе её пишут в фигурных скобках, а в функции объявляют параметр с тем же именем:

```python
@app.get("/ресурс/{имя_параметра}")
def функция(имя_параметра: тип):
    ...
```

- `{courier_id}` в пути и `courier_id` в скобках функции должны называться одинаково.
- `: int` после имени — **аннотация типа**. FastAPI превратит текст из адреса в целое число. Если в адресе не число, обработчик не вызовется: FastAPI сам ответит `422` и объяснит, что не так.

```python example
from fastapi import FastAPI

app = FastAPI()
COURIERS = {1: "Алина", 2: "Тимур"}

@app.get("/couriers/{courier_id}")
def get_courier(courier_id: int):
    return {"id": courier_id, "name": COURIERS[courier_id]}
###
GET /couriers/2
###
GET /couriers/abc
### 500
GET /couriers/7
```

Первый запрос вернул курьера. На `/couriers/abc` FastAPI ответил `422` до вызова функции. А `/couriers/7` уронил обработчик: в словаре нет ключа `7`, Python выбросил ошибку `KeyError`, и клиент получил `500 Internal Server Error`. Код `500` означает ошибку в коде сервера — так отвечать на «нет такой записи» нельзя.

### Ответ 404 через HTTPException

Чтобы сказать клиенту «такой записи нет», обработчик **выбрасывает** исключение `HTTPException` с нужным кодом:

```python
from fastapi import FastAPI, HTTPException

if условие_что_записи_нет:
    raise HTTPException(status_code=404, detail="текст для клиента")
```

- `HTTPException` нужно подключить в той же строке импорта, через запятую после `FastAPI`.
- `raise` прерывает функцию: строки после него не выполняются.
- `status_code` — код ответа, `detail` — текст, который придёт в JSON как `{"detail": "..."}`.
- Проверить, есть ли ключ в словаре, можно выражением `ключ not in словарь` — оно истинно, если ключа нет.

```python example
from fastapi import FastAPI, HTTPException

app = FastAPI()
COURIERS = {1: "Алина", 2: "Тимур"}

@app.get("/couriers/{courier_id}")
def get_courier(courier_id: int):
    if courier_id not in COURIERS:
        raise HTTPException(status_code=404, detail="Курьер не найден")
    return {"id": courier_id, "name": COURIERS[courier_id]}
###
GET /couriers/7
```

### Частые ошибки

- `app = FastApi()` → `app = FastAPI()`: имена в Python чувствительны к регистру.
- `def ping()` без двоеточия → `def ping():` — иначе синтаксическая ошибка.
- `@app.get("/dishes/{id}")` и `def get_dish(dish_id: int)` → имя в пути и в функции должно совпадать.
- `return COURIERS[courier_id]` без проверки → сначала `if ... not in ...: raise HTTPException(404, ...)`, иначе клиент получит `500`.

### Шпаргалка

- `app = FastAPI()` — приложение; `@app.get("/путь")` над функцией — обработчик `GET /путь`.
- `return {...}` — ответ JSON с кодом `200`.
- `/ресурс/{x}` и `def f(x: int)` — параметр пути с проверкой типа (`422`, если не подходит).
- `raise HTTPException(status_code=404, detail="...")` — ответ с ошибкой.

## task api-fa-ping

```json
{
  "type": "fastapi",
  "title": "Сервер жив?",
  "hints": [
    "Раздел «Приложение и первый обработчик».",
    "Нужен декоратор `@app.get` с путём `/ping` и функция, которая возвращает словарь с одним ключом.",
    "```python\n@app.get(\"/…\")\ndef ping():\n    return {\"…\": \"…\"}\n```"
  ]
}
```

Мониторинг каждую минуту проверяет, что сервис доставки отвечает. Добавьте в приложение обработчик `GET /ping`, который возвращает JSON `{"status": "ok"}`.

Проверьте ответ, отправив запрос из композера справа, затем нажмите «Проверить».

```python starter
from fastapi import FastAPI

app = FastAPI()

# Обработчик GET /ping здесь
```

```python solution
from fastapi import FastAPI

app = FastAPI()

@app.get("/ping")
def ping():
    return {"status": "ok"}
```

```http starter
GET /ping
```

```http tests
GET /ping
###
GET /ping?verbose=1
```

## task api-fa-dish

```json
{
  "type": "fastapi",
  "title": "Блюдо по номеру",
  "hints": [
    "Разделы «Параметр пути» и «Ответ 404 через HTTPException».",
    "Путь `/dishes/{dish_id}`, параметр функции `dish_id: int`. Перед тем как читать словарь, проверьте `dish_id not in DISHES`.",
    "```python\nif dish_id not in DISHES:\n    raise HTTPException(status_code=404, detail=\"…\")\nreturn {\"id\": dish_id, \"name\": DISHES[dish_id]}\n```"
  ],
  "check": {
    "code": [{ "pattern": "HTTPException", "message": "Ответ 404 нужно вернуть через HTTPException — см. раздел «Ответ 404 через HTTPException»." }]
  }
}
```

В приложении уже есть меню `DISHES`: номер блюда → название. Добавьте обработчик `GET /dishes/{dish_id}`:

- если блюдо есть, вернуть `{"id": номер, "name": название}`;
- если нет — ответ `404` с `detail` `Блюдо не найдено`;
- номер блюда — целое число.

```python starter
from fastapi import FastAPI, HTTPException

app = FastAPI()
DISHES = {1: "Маргарита", 2: "Филадельфия", 3: "Том ям"}
```

```python solution
from fastapi import FastAPI, HTTPException

app = FastAPI()
DISHES = {1: "Маргарита", 2: "Филадельфия", 3: "Том ям"}

@app.get("/dishes/{dish_id}")
def get_dish(dish_id: int):
    if dish_id not in DISHES:
        raise HTTPException(status_code=404, detail="Блюдо не найдено")
    return {"id": dish_id, "name": DISHES[dish_id]}
```

```http starter
GET /dishes/1
```

```http tests
GET /dishes/1
###
GET /dishes/3
###
GET /dishes/42
###
GET /dishes/pizza
```

## task api-fa-422

```json
{
  "type": "choice",
  "title": "Кто ответит на /dishes/pizza",
  "hints": [
    "Раздел «Параметр пути».",
    "Подумайте, успеет ли вызваться ваша функция, если текст из адреса не превращается в `int`.",
    "Аннотацию `dish_id: int` FastAPI проверяет до вызова `get_dish`. Если функция не вызывалась, могла ли она упасть с `500` или сама вернуть `404`?"
  ],
  "options": [
    "Функция `get_dish` получит строку `pizza` и упадёт с кодом `500`",
    "FastAPI сам ответит `422`: `pizza` не целое число, функция не вызовется",
    "FastAPI ответит `404`: такого блюда нет"
  ],
  "answer": [1],
  "explanation": "Аннотация `dish_id: int` заставляет FastAPI проверить параметр до вызова функции. `pizza` не превращается в целое число, поэтому клиент получает `422` с описанием ошибки, а функция не вызывается вовсе. `404` вернул бы ваш код для числа, которого нет в меню, а `500` — необработанная ошибка внутри функции."
}
```

Обработчик объявлен как `def get_dish(dish_id: int)`. Клиент отправляет `GET /dishes/pizza`. Что произойдёт?
