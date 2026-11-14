# Аннотации типов, Annotated и Enum

Вы пишете обработчик `GET /posts/{post_id}` и хотите, чтобы по адресу `/posts/abc` пользователь получил понятную ошибку, а не падение сервера. Вручную проверять каждый параметр утомительно. FastAPI делает это сам, если вы подписали параметры типами. Этот урок про то, как Python записывает типы и что с ними делает FastAPI. Мир необязательный: если аннотации вам знакомы, пропустите его через тест.

### Что нужно знать о FastAPI, чтобы начать

Остальное вы подробно разберёте в мире «Основы». Здесь достаточно четырёх фактов:

- `app = FastAPI()` создаёт приложение;
- `@app.get("/путь")` над функцией превращает её в **обработчик** запросов `GET` по этому пути;
- обработчик возвращает словарь или список, а FastAPI отправляет их как JSON;
- часть пути в фигурных скобках (`/posts/{post_id}`) — **параметр пути**: его значение приходит в функцию под тем же именем. Параметры функции, которых нет в пути, FastAPI читает из строки запроса: `/posts?tag=python` передаёт `tag="python"`.

Приложение запускается командой в терминале, в студии она не нужна:

```sh
fastapi dev main.py
```

### Аннотации типов

**Аннотация** — подпись типа у параметра или у результата функции. Python сам её не проверяет: это подсказка для людей, редакторов и библиотек.

```python
def функция(параметр: тип = значение) -> тип_результата:
```

- `параметр: тип` — двоеточие и тип сразу после имени;
- `= значение` — необязательное значение по умолчанию, пробелы вокруг `=` ставятся, когда есть аннотация;
- `-> тип_результата` — тип возвращаемого значения.

Python запомнит аннотации в самой функции, но не станет их проверять: `def f(x: int)` спокойно примет строку. FastAPI поступает иначе. Когда вы пишете `@app.get(...)`, он **читает** аннотации обработчика и строит по ним проверку данных, преобразование и документацию. Поэтому подпись типа здесь работает как настоящее правило.

```python example
from fastapi import FastAPI

app = FastAPI()

TITLES = {1: "Первый пост", 2: "О типах"}


@app.get("/posts/{post_id}")
def read_post(post_id: int):
    title = TITLES.get(post_id, "такого поста нет")
    return {"id": post_id, "title": title, "python_type": type(post_id).__name__}
###
GET /posts/2
###
GET /posts/abc
```

Первый запрос отвечает `200` и `{"id": 2, "title": "О типах", "python_type": "int"}`: в пути пришла строка `"2"`, а FastAPI превратил её в число. Второй запрос получает код `422` (Unprocessable Content, «данные не прошли проверку»): в теле ответа указано, что параметр `post_id` не является целым числом. Обработчик при этом даже не вызывался.

Здесь встретились два вспомогательных выражения: `TITLES.get(ключ, запасное)` берёт значение по ключу или запасное, если ключа нет; `type(x).__name__` — имя типа значения.

### Необязательные значения и объединение типов

Тип `str | None` читается «строка или `None`». Это **объединение** типов, значок `|` разделяет варианты. Параметр с таким типом и значением `= None` необязателен: если его не передали, в функции окажется `None`.

```python
параметр: тип | None = None
```

- `тип | None` — допустимое значение или его отсутствие;
- `= None` — значение по умолчанию; без него параметр останется обязательным, даже если `None` разрешён.

Старая запись `Optional[str]` из модуля `typing` означает то же самое, что `str | None`. В новом коде пишите короткий вариант.

### Типы коллекций

Для списков и словарей в квадратных скобках указывают тип содержимого:

- `list[int]` — список целых чисел;
- `dict[str, int]` — словарь, где ключи — строки, а значения — целые числа;
- `list[str] | None` — список строк или `None`.

Такие подписи FastAPI тоже понимает: ими описывают результат обработчика и тело запроса (подробнее — в мире «Данные и модели»).

### Annotated: тип плюс правила

Обычная аннотация говорит только «целое число». Чтобы добавить правило («от 1 до 20»), используют `Annotated`:

```python
from typing import Annotated
from fastapi import Query

параметр: Annotated[тип, Query(правила)] = значение_по_умолчанию
```

- `Annotated[тип, метаданные]` — «это `тип`, и вот дополнительные сведения». Для самого Python это просто `тип`, метаданные он не трогает;
- `Query(...)` — объект FastAPI с правилами для параметра из строки запроса;
- `ge=1` — значение должно быть не меньше 1 (greater or equal), `le=20` — не больше 20 (less or equal); строгие границы — `gt` и `lt`;
- значение по умолчанию записывается после `Annotated[...]`, через `=`.

```python example
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI()

BOOKS = ["Dune", "Emma", "Solaris", "Ubik", "Hyperion"]


@app.get("/books")
def list_books(
    prefix: str | None = None,
    count: Annotated[int, Query(ge=1, le=3)] = 2,
):
    found = [b for b in BOOKS if prefix is None or b.startswith(prefix)]
    return {"prefix": prefix, "count": count, "books": found[:count]}
###
GET /books
###
GET /books?prefix=S&count=3
###
GET /books?count=5
```

Результаты:

- без параметров: `count` равен `2` по умолчанию, ответ `200` и `{"prefix": null, "count": 2, "books": ["Dune", "Emma"]}`;
- `prefix=S&count=3`: ответ `200`, подходит одна книга `["Solaris"]`;
- `count=5`: значение больше `le=3`, ответ `422` с указанием на параметр `count`.

Выражение `[b for b in BOOKS if ...]` собирает новый список из подходящих элементов, а `found[:count]` берёт первые `count` из них (срез).

### Enum: ограниченный набор значений

Иногда параметр может принимать только несколько значений: раздел блога, статус заказа. Для этого есть **перечисление** (`Enum`).

```python
from enum import Enum


class Название(str, Enum):
    имя_члена = "значение"
```

- `class Название(str, Enum)` — класс-перечисление; `str` в скобках делает значения строками, а ещё сообщает FastAPI и JSON, что это строковый тип;
- `имя_члена = "значение"` — один допустимый вариант. Имя используется в коде (`Название.имя_члена`), значение приходит в запросе;
- у члена есть `.value` (строка значения) и `.name` (имя).

Если подписать параметр пути этим классом, FastAPI пропустит только перечисленные значения, остальным ответит `422`. Заодно все варианты попадут в документацию.

```python example
from enum import Enum

from fastapi import FastAPI

app = FastAPI()


class Currency(str, Enum):
    rub = "rub"
    usd = "usd"
    eur = "eur"


RATES = {"rub": 1.0, "usd": 90.0, "eur": 98.0}


@app.get("/rates/{currency}")
def read_rate(currency: Currency):
    return {"currency": currency.value, "member": currency.name, "rate": RATES[currency.value]}
###
GET /rates/usd
###
GET /rates/gbp
```

Запрос `usd` даёт `200` и `{"currency": "usd", "member": "usd", "rate": 90.0}`. Запрос `gbp` получает `422`: в ответе перечислены допустимые значения `rub`, `usd`, `eur`. Внутри обработчика `currency` — уже член перечисления, поэтому для обращения к словарю берут `currency.value`.

### Частые ошибки

- Аннотация не проверяется Python. Неверно: ждать, что `def f(x: int)` откажется принять строку. Верно: проверку выполняет FastAPI на границе запроса; внутри ваших функций типы остаются подсказкой.
- Параметр `str` вместо перечисления. Неверно: `section: str` и ручная проверка внутри. Верно: `section: Section` — лишние значения будут отклонены до вызова функции.
- Забыли значение по умолчанию. Неверно: `limit: Annotated[int, Query(ge=1)]` — параметр обязателен, запрос без него получит `422`. Верно: `limit: Annotated[int, Query(ge=1)] = 10`.
- Неверная граница. Неверно: `ge=1, le=20`, когда нужно «меньше 20». Верно: `lt=20` исключает 20, `le=20` включает.
- Старый стиль. Неверно: `limit: int = Query(10, ge=1)`. Верно: `limit: Annotated[int, Query(ge=1)] = 10` — это современная форма из документации FastAPI.

### Шпаргалка

- `параметр: тип = значение`, результат — `-> тип`.
- `тип | None = None` — необязательный параметр.
- `list[int]`, `dict[str, int]` — коллекции с типом содержимого.
- `Annotated[int, Query(ge=1, le=20)] = 10` — правила; `ge`, `le`, `gt`, `lt`.
- `class Имя(str, Enum): член = "значение"`; `.value`, `.name`.
- Неверный тип или значение вне набора — ответ `422`, обработчик не вызывается.
- Запуск на своём компьютере: `fastapi dev main.py`.

## task fa-py-types-enum

```json
{
  "type": "fastapi",
  "title": "Разделы блога через Enum",
  "xp": 10,
  "hints": [
    "Раздел «Enum: ограниченный набор значений»: класс-перечисление и подпись параметра этим классом.",
    "Создайте класс `Section(str, Enum)` с тремя членами (`news`, `guides`, `notes`), подпишите им параметр `section` и в словаре обращайтесь по `section.value`.",
    "Шаблон: class Section(str, Enum): news = \"news\" ...; def read_section(section: Section): return {\"section\": section.value, \"posts\": COUNTS[section.value]}."
  ],
  "wrong": {
    "enum-unused": "перечисление объявлено, но параметр остался строкой, и неизвестный раздел получает ответ 200",
    "typo": "значение члена guides записано с опечаткой, и допустимый раздел guides отклоняется"
  }
}
```
У блога три раздела: `news`, `guides` и `notes`. Число постов в каждом лежит в словаре `COUNTS`. Обработчик `GET /sections/{section}` уже есть, но он принимает любую строку и для неизвестного раздела отвечает `200` с нулём.

Нужно, чтобы допустимыми были только три раздела: ответ `200` и `{"section": "<раздел>", "posts": <число>}`. Для любого другого значения (`/sections/travel`) FastAPI должен ответить `422`. Объявите для этого перечисление `Section` и подпишите им параметр.

```python starter
from fastapi import FastAPI

app = FastAPI()

COUNTS = {"news": 12, "guides": 5, "notes": 31}


@app.get("/sections/{section}")
def read_section(section: str):
    return {"section": section, "posts": COUNTS.get(section, 0)}
```

```python solution
from enum import Enum

from fastapi import FastAPI

app = FastAPI()

COUNTS = {"news": 12, "guides": 5, "notes": 31}


class Section(str, Enum):
    news = "news"
    guides = "guides"
    notes = "notes"


@app.get("/sections/{section}")
def read_section(section: Section):
    return {"section": section.value, "posts": COUNTS[section.value]}
```

```python wrong id=enum-unused
from enum import Enum

from fastapi import FastAPI

app = FastAPI()

COUNTS = {"news": 12, "guides": 5, "notes": 31}


class Section(str, Enum):
    news = "news"
    guides = "guides"
    notes = "notes"


@app.get("/sections/{section}")
def read_section(section: str):
    return {"section": section, "posts": COUNTS.get(section, 0)}
```

```python wrong id=typo
from enum import Enum

from fastapi import FastAPI

app = FastAPI()

COUNTS = {"news": 12, "guides": 5, "notes": 31}


class Section(str, Enum):
    news = "news"
    guides = "guide"
    notes = "notes"


@app.get("/sections/{section}")
def read_section(section: Section):
    return {"section": section.value, "posts": COUNTS.get(section.value, 0)}
```

```http tests
GET /sections/news
###
GET /sections/guides
###
GET /sections/notes
###
GET /sections/travel
###
GET /sections/News
```

## task fa-py-types-query

```json
{
  "type": "fastapi",
  "title": "Список постов с ограничением",
  "xp": 15,
  "hints": [
    "Раздел «Annotated: тип плюс правила»: границы задаются в Query(...) внутри Annotated.",
    "Подпишите limit как Annotated[int, Query(ge=1, le=20)] и не забудьте значение по умолчанию 10 после скобок. Импортируйте Annotated из typing и Query из fastapi.",
    "Шаблон: limit: Annotated[int, Query(ge=…, le=…)] = 10, остальное в обработчике не меняйте."
  ],
  "wrong": {
    "only-ge": "задана только нижняя граница, и limit=21 принимается вместо 422",
    "no-default": "значение по умолчанию потеряно, и запрос без limit получает 422"
  }
}
```
Обработчик `GET /posts` возвращает названия постов блога: `{"tag": ..., "limit": ..., "titles": [...]}`. Параметр `tag` необязателен и фильтрует посты по тегу, параметр `limit` задаёт, сколько названий вернуть. Сейчас `limit` — просто целое число, поэтому `limit=0` и `limit=500` проходят.

Нужно: `limit` должен быть от `1` до `20` включительно, по умолчанию `10`. Значения вне диапазона отклоняются кодом `422`. Остальное поведение сохраните.

```python starter
from fastapi import FastAPI

app = FastAPI()

POSTS = [
    {"title": "Первый пост", "tag": "python"},
    {"title": "Про Enum", "tag": "python"},
    {"title": "Рецепт чая", "tag": "food"},
    {"title": "Про Annotated", "tag": "python"},
]


@app.get("/posts")
def list_posts(tag: str | None = None, limit: int = 10):
    found = [p["title"] for p in POSTS if tag is None or p["tag"] == tag]
    return {"tag": tag, "limit": limit, "titles": found[:limit]}
```

```python solution
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI()

POSTS = [
    {"title": "Первый пост", "tag": "python"},
    {"title": "Про Enum", "tag": "python"},
    {"title": "Рецепт чая", "tag": "food"},
    {"title": "Про Annotated", "tag": "python"},
]


@app.get("/posts")
def list_posts(tag: str | None = None, limit: Annotated[int, Query(ge=1, le=20)] = 10):
    found = [p["title"] for p in POSTS if tag is None or p["tag"] == tag]
    return {"tag": tag, "limit": limit, "titles": found[:limit]}
```

```python wrong id=only-ge
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI()

POSTS = [
    {"title": "Первый пост", "tag": "python"},
    {"title": "Про Enum", "tag": "python"},
    {"title": "Рецепт чая", "tag": "food"},
    {"title": "Про Annotated", "tag": "python"},
]


@app.get("/posts")
def list_posts(tag: str | None = None, limit: Annotated[int, Query(ge=1)] = 10):
    found = [p["title"] for p in POSTS if tag is None or p["tag"] == tag]
    return {"tag": tag, "limit": limit, "titles": found[:limit]}
```

```python wrong id=no-default
from typing import Annotated

from fastapi import FastAPI, Query

app = FastAPI()

POSTS = [
    {"title": "Первый пост", "tag": "python"},
    {"title": "Про Enum", "tag": "python"},
    {"title": "Рецепт чая", "tag": "food"},
    {"title": "Про Annotated", "tag": "python"},
]


@app.get("/posts")
def list_posts(limit: Annotated[int, Query(ge=1, le=20)], tag: str | None = None):
    found = [p["title"] for p in POSTS if tag is None or p["tag"] == tag]
    return {"tag": tag, "limit": limit, "titles": found[:limit]}
```

```http tests
GET /posts
###
GET /posts?tag=python&limit=2
###
GET /posts?tag=food
###
GET /posts?limit=1
###
GET /posts?limit=20
###
GET /posts?limit=0
###
GET /posts?limit=21
###
GET /posts?limit=abc
```

## task fa-py-types-choice

```json
{
  "type": "choice",
  "title": "Что вернёт адрес с буквами",
  "hints": [
    "Раздел «Аннотации типов»: FastAPI читает подпись параметра до вызова функции.",
    "Параметр объявлен как `int`, а в адресе стоит `abc`. Подумайте, дойдёт ли дело до тела обработчика.",
    "Вариант `500` означает ошибку внутри вашего кода, а обработчик здесь не запускается вовсе. Вариант `404` значит «такого адреса нет», а адрес есть."
  ],
  "options": [
    "`200` и пустой ответ: FastAPI подставит ноль",
    "`404`: такого поста нет",
    "`422`: параметр не прошёл проверку, обработчик не вызывается",
    "`500`: обработчик упадёт при преобразовании"
  ],
  "answer": [2],
  "explanation": "FastAPI пробует превратить `abc` в `int` ещё до вызова функции, не получается и отвечает `422` с описанием ошибки параметра. Ноль никто не подставляет. `404` означает, что нет самого маршрута или записи, а маршрут `/posts/{post_id}` есть. `500` бывает при ошибке внутри обработчика, но здесь он вообще не запускается."
}
```
Обработчик объявлен так: `@app.get("/posts/{post_id}")` и `def read_post(post_id: int)`. Что ответит приложение на запрос `GET /posts/abc`?

## task fa-py-types-review

```json
{
  "type": "review",
  "title": "Почему падает следующий пост",
  "hints": [
    "Разделы «Аннотации типов» и «Что нужно знать о FastAPI»: параметр пути приходит строкой, а тип его преобразует.",
    "Посмотрите, какой тип у `post_id` и что делает `post_id + 1` со строкой.",
    "Ошибка в строке 2, в подписи параметра: из `str` число не получится, поэтому прибавление единицы падает с `TypeError`."
  ],
  "code": "@app.get(\"/posts/{post_id}\")\ndef next_post(post_id: str):\n    return {\"next\": post_id + 1}",
  "codeLanguage": "python",
  "lines": [2],
  "options": [
    "Обработчик не может возвращать словарь",
    "`post_id` объявлен как `str`, и сложить строку с числом нельзя: запрос `/posts/7` закончится ошибкой `500`",
    "Имя параметра `post_id` нельзя использовать в пути",
    "Перед `def` нужно написать `async`"
  ],
  "answer": [1],
  "explanation": "Из пути приходит строка `\"7\"`, и при подписи `str` FastAPI оставляет её строкой. Выражение `\"7\" + 1` вызывает `TypeError`, то есть ответ `500`. Подпись `post_id: int` превратит значение в число `7` и вернёт `{\"next\": 8}`. Словарь из обработчика вернуть можно, имя параметра любое подходящее, а `async` для этого не нужен."
}
```
Коллега написал обработчик, который должен вернуть номер следующего поста, но на запрос `GET /posts/7` приходит ошибка сервера. Найдите причину.
