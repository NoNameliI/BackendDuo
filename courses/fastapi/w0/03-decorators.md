# Декораторы: как @app.get регистрирует обработчик

Строка `@app.get("/posts")` над функцией выглядит как магия: обычная функция вдруг начинает отвечать на запросы. На самом деле это декоратор, то есть самая обычная функция, которая принимает вашу функцию. В этом уроке вы разберёте декораторы на простых примерах и напишете свои: добавляющие поле в ответ или считающие вызовы.

### Функции как объекты

В Python функцию можно положить в переменную, передать в другую функцию и вернуть из функции. Скобки вызова нужны только тогда, когда её надо выполнить.

```python
def shout(text):
    return text.upper()

action = shout
print(action("hi"))
```

- `shout` без скобок — сама функция; `shout("hi")` — её вызов;
- `action = shout` — второе имя для той же функции;
- функции можно описывать внутри других функций, и внутренняя видит параметры внешней.

### Декоратор: функция, которая принимает функцию

**Декоратор** принимает функцию и возвращает функцию-замену. Запись `@имя` над `def` — сокращение: Python определяет функцию, затем подставляет `функция = имя(функция)`.

```python
def имя_декоратора(func):
    def wrapper(*args, **kwargs):
        действия_до
        result = func(*args, **kwargs)
        действия_после
        return result
    return wrapper
```

- `func` — исходная функция, которую оборачивают;
- `wrapper` — «обёртка»: новая функция, которая вызывает исходную и добавляет своё;
- `*args, **kwargs` — «принять любые аргументы и передать их дальше»: `*args` — все позиционные, `**kwargs` — все именованные. В вызове `func(*args, **kwargs)` они распаковываются обратно. Так обёртка подходит к функции с любой сигнатурой;
- `return result` — вернуть то, что вернула исходная функция. Если забыть, обёртка вернёт `None`;
- `return wrapper` — декоратор возвращает обёртку, без скобок.

### Как это связано с @app.get

`@app.get("/путь")` тоже декоратор, но с параметром. Он делает две вещи: записывает функцию в таблицу маршрутов приложения вместе с путём и методом и возвращает ту же функцию. Своя упрощённая версия:

```python example
from fastapi import FastAPI

app = FastAPI()
HANDLERS = {}


def register(path: str):
    def decorator(func):
        HANDLERS[path] = func
        return func
    return decorator


@register("/hello")
def hello():
    return "hi"


@app.get("/registry")
def read_registry():
    return {"paths": list(HANDLERS), "result": HANDLERS["/hello"]()}
###
GET /registry
```

Ответ `200`: `{"paths": ["/hello"], "result": "hi"}`. Функция `hello` попала в словарь `HANDLERS` под ключом `/hello`, а вызывали её уже из словаря. Настоящий `@app.get` устроен так же, только таблица маршрутов у него умнее: по аннотациям параметров он строит проверку данных (первый урок мира).

### Декоратор с параметрами

Чтобы передать декоратору настройку, добавляют ещё один уровень: внешняя функция принимает параметр и возвращает сам декоратор.

```python
def имя_декоратора(параметр):
    def decorator(func):
        def wrapper(*args, **kwargs):
            ...использует параметр и func
        return wrapper
    return decorator
```

Читается изнутри: `@имя_декоратора("значение")` сначала вызывает внешнюю функцию, она возвращает `decorator`, а уже он применяется к вашей функции. Поэтому у такого декоратора в записи всегда есть скобки: `@register("/hello")`, `@app.get("/posts")`.

### functools.wraps: сохранить лицо функции

У каждой функции есть имя, строка описания и список параметров. Обёртка `wrapper(*args, **kwargs)` всё это теряет: её имя `wrapper`, а параметры — `*args, **kwargs`. Это важно для FastAPI: он читает аннотации параметров **обработчика**, чтобы построить проверку. Если обёртка скрыла сигнатуру, он не узнает про `post_id` и других.

Декоратор `wraps` из модуля `functools` копирует сведения исходной функции на обёртку и запоминает ссылку на оригинал, по которой инструменты находят настоящую сигнатуру.

```python
from functools import wraps


def имя_декоратора(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        ...
    return wrapper
```

- `from functools import wraps` — подключение;
- `@wraps(func)` — над `wrapper`, в скобках исходная функция. Это декоратор с параметром, как в предыдущем разделе.

```python example
from functools import wraps

from fastapi import FastAPI

app = FastAPI()


def shout_title(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        result["title"] = result["title"].upper()
        return result
    return wrapper


@app.get("/articles/{article_id}")
@shout_title
def read_article(article_id: int):
    return {"id": article_id, "title": "release notes"}
###
GET /articles/5
###
GET /articles/x
```

Первый запрос даёт `200` и `{"id": 5, "title": "RELEASE NOTES"}`: параметр `article_id` пришёл в обёртку через `kwargs` и дошёл до исходной функции. Второй запрос получает `422`: FastAPI всё ещё знает, что `article_id` — число, потому что `wraps` сохранил сигнатуру. Без `@wraps` он увидел бы лишь `*args, **kwargs` и не смог бы связать параметр пути с функцией.

### Порядок декораторов

Декораторы применяются снизу вверх: ближайший к `def` — первым.

```python
@app.get("/articles/{article_id}")
@shout_title
def read_article(...):
```

Здесь `shout_title` оборачивает функцию, а `@app.get` регистрирует **уже обёрнутый** результат. Если поменять порядок, `@app.get` зарегистрирует исходную функцию, а ваш декоратор обернёт то, что вернёт `@app.get`: на маршрут это уже не повлияет. Правило простое: `@app.get(...)` всегда самый верхний.

### Частые ошибки

- Забыт `return`. Неверно: в обёртке `func(*args, **kwargs)` без `return`, ответ становится `null`. Верно: `result = func(...)`, затем `return result`.
- Нет `@wraps`. Неверно: обёртка без `@wraps(func)`, FastAPI теряет параметры. Верно: `@wraps(func)` над `wrapper`.
- Неверный порядок. Неверно: свой декоратор выше `@app.get`, он не попадает в маршрут. Верно: `@app.get` сверху, свой декоратор ниже.
- Скобки у декоратора. Неверно: `@register` вместо `@register("/hello")` для декоратора с параметром, функция уйдёт в параметр `path`. Верно: скобки с аргументом. И наоборот: у простого декоратора скобок нет.
- Вернули вызов. Неверно: `return wrapper()`. Верно: `return wrapper` — вернуть функцию, не вызывать.

### Шпаргалка

- `@имя` над `def f` = `f = имя(f)`.
- Декоратор: `def d(func): def wrapper(*args, **kwargs): ...; return wrapper`.
- Внутри обёртки `result = func(*args, **kwargs)`, затем `return result`.
- С параметрами: `def d(param): def decorator(func): def wrapper(...)`; запись `@d("x")`.
- `from functools import wraps` и `@wraps(func)` над `wrapper`.
- Декораторы применяются снизу вверх; `@app.get(...)` — самый верхний.
- `@app.get(...)` записывает функцию в таблицу маршрутов и возвращает её.

## task fa-py-deco-stamp

```json
{
  "type": "fastapi",
  "title": "Декоратор, который метит ответ",
  "xp": 15,
  "hints": [
    "Разделы «Декоратор с параметрами» и «functools.wraps»: нужны три уровня функций и @wraps над обёрткой.",
    "Внешняя функция add_source(source) возвращает decorator(func); wrapper вызывает func(*args, **kwargs), кладёт в результат ключ \"source\" со значением параметра и возвращает результат.",
    "Шаблон: def add_source(source): def decorator(func): @wraps(func) def wrapper(*args, **kwargs): result = func(*args, **kwargs); result[\"source\"] = source; return result; return wrapper; return decorator."
  ],
  "wrong": {
    "no-wraps": "обёртка не использует @wraps, и FastAPI не видит параметры обработчика",
    "fixed-source": "значение source зашито в декоратор, и черновики помечаются как blog"
  }
}
```
В блоге два обработчика возвращают словари: `GET /posts/{post_id}` и `GET /drafts/{draft_id}`. К каждому ответу нужно добавлять поле `source`: для постов `"blog"`, для черновиков `"draft"`. Чтобы не копировать строку в каждую функцию, нужен декоратор `add_source(source)`, который принимает это значение. Сейчас декоратор возвращает функцию без изменений.

Напишите декоратор: он вызывает обработчик и добавляет в его словарь ключ `source` со значением параметра. Используйте `@wraps`, иначе FastAPI не найдёт параметры пути. Ожидаемые ответы: `GET /posts/1` даёт `{"id": 1, "title": "Hello", "source": "blog"}`; `GET /drafts/2` даёт `{"id": 2, "title": "Idea", "source": "draft"}`; несуществующий номер отвечает `404` с `{"detail": "Not found"}`.

```python starter
from functools import wraps

from fastapi import FastAPI, HTTPException

app = FastAPI()
POSTS = {1: "Hello"}
DRAFTS = {2: "Idea"}


def add_source(source: str):
    def decorator(func):
        return func
    return decorator


@app.get("/posts/{post_id}")
@add_source("blog")
def read_post(post_id: int):
    if post_id not in POSTS:
        raise HTTPException(status_code=404, detail="Not found")
    return {"id": post_id, "title": POSTS[post_id]}


@app.get("/drafts/{draft_id}")
@add_source("draft")
def read_draft(draft_id: int):
    if draft_id not in DRAFTS:
        raise HTTPException(status_code=404, detail="Not found")
    return {"id": draft_id, "title": DRAFTS[draft_id]}
```

```python solution
from functools import wraps

from fastapi import FastAPI, HTTPException

app = FastAPI()
POSTS = {1: "Hello"}
DRAFTS = {2: "Idea"}


def add_source(source: str):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)
            result["source"] = source
            return result
        return wrapper
    return decorator


@app.get("/posts/{post_id}")
@add_source("blog")
def read_post(post_id: int):
    if post_id not in POSTS:
        raise HTTPException(status_code=404, detail="Not found")
    return {"id": post_id, "title": POSTS[post_id]}


@app.get("/drafts/{draft_id}")
@add_source("draft")
def read_draft(draft_id: int):
    if draft_id not in DRAFTS:
        raise HTTPException(status_code=404, detail="Not found")
    return {"id": draft_id, "title": DRAFTS[draft_id]}
```

```python wrong id=no-wraps
from functools import wraps

from fastapi import FastAPI, HTTPException

app = FastAPI()
POSTS = {1: "Hello"}
DRAFTS = {2: "Idea"}


def add_source(source: str):
    def decorator(func):
        def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)
            result["source"] = source
            return result
        return wrapper
    return decorator


@app.get("/posts/{post_id}")
@add_source("blog")
def read_post(post_id: int):
    if post_id not in POSTS:
        raise HTTPException(status_code=404, detail="Not found")
    return {"id": post_id, "title": POSTS[post_id]}


@app.get("/drafts/{draft_id}")
@add_source("draft")
def read_draft(draft_id: int):
    if draft_id not in DRAFTS:
        raise HTTPException(status_code=404, detail="Not found")
    return {"id": draft_id, "title": DRAFTS[draft_id]}
```

```python wrong id=fixed-source
from functools import wraps

from fastapi import FastAPI, HTTPException

app = FastAPI()
POSTS = {1: "Hello"}
DRAFTS = {2: "Idea"}


def add_source(source: str):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            result = func(*args, **kwargs)
            result["source"] = "blog"
            return result
        return wrapper
    return decorator


@app.get("/posts/{post_id}")
@add_source("blog")
def read_post(post_id: int):
    if post_id not in POSTS:
        raise HTTPException(status_code=404, detail="Not found")
    return {"id": post_id, "title": POSTS[post_id]}


@app.get("/drafts/{draft_id}")
@add_source("draft")
def read_draft(draft_id: int):
    if draft_id not in DRAFTS:
        raise HTTPException(status_code=404, detail="Not found")
    return {"id": draft_id, "title": DRAFTS[draft_id]}
```

```http tests
GET /posts/1
###
GET /drafts/2
###
GET /posts/9
###
GET /drafts/9
###
GET /posts/abc
```

## task fa-py-deco-counted

```json
{
  "type": "fix-bug",
  "title": "Счётчик вызовов не считает",
  "xp": 20,
  "hints": [
    "Разделы «Порядок декораторов» и «Декоратор: функция, которая принимает функцию»: ошибок две, обе в декораторе и в его применении.",
    "Ответы handler приходят как null, а счётчик остаётся пустым. Проверьте, возвращает ли обёртка результат, и какой декоратор записан выше: @app.get или @counted.",
    "Шаблон: в wrapper после вызова func добавьте return result; над read_post сверху должен стоять @app.get(...), под ним @counted."
  ],
  "wrong": {
    "only-return": "результат возвращается, но декораторы стоят в неверном порядке, и счётчик остаётся пустым",
    "only-order": "порядок декораторов исправлен, но обёртка по-прежнему не возвращает результат, и ответы пустые"
  }
}
```
Декоратор `counted` должен считать, сколько раз вызвали каждый обработчик, и записывать счёт в словарь `CALLS` по имени функции. `GET /stats` показывает этот словарь. После двух запросов `GET /posts/1` ожидается `{"read_post": 2}`. Сейчас ответы обработчика пустые, а счётчик не растёт. Найдите две ошибки и исправьте их. Маршруты и тексты ответов менять не нужно.

```python starter
from functools import wraps

from fastapi import FastAPI

app = FastAPI()
CALLS: dict[str, int] = {}
POSTS = {1: "Hello", 2: "Notes"}


def counted(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        CALLS[func.__name__] = CALLS.get(func.__name__, 0) + 1
        func(*args, **kwargs)
    return wrapper


@counted
@app.get("/posts/{post_id}")
def read_post(post_id: int):
    return {"id": post_id, "title": POSTS.get(post_id, "unknown")}


@app.get("/stats")
def read_stats():
    return CALLS
```

```python solution
from functools import wraps

from fastapi import FastAPI

app = FastAPI()
CALLS: dict[str, int] = {}
POSTS = {1: "Hello", 2: "Notes"}


def counted(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        CALLS[func.__name__] = CALLS.get(func.__name__, 0) + 1
        return func(*args, **kwargs)
    return wrapper


@app.get("/posts/{post_id}")
@counted
def read_post(post_id: int):
    return {"id": post_id, "title": POSTS.get(post_id, "unknown")}


@app.get("/stats")
def read_stats():
    return CALLS
```

```python wrong id=only-return
from functools import wraps

from fastapi import FastAPI

app = FastAPI()
CALLS: dict[str, int] = {}
POSTS = {1: "Hello", 2: "Notes"}


def counted(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        CALLS[func.__name__] = CALLS.get(func.__name__, 0) + 1
        return func(*args, **kwargs)
    return wrapper


@counted
@app.get("/posts/{post_id}")
def read_post(post_id: int):
    return {"id": post_id, "title": POSTS.get(post_id, "unknown")}


@app.get("/stats")
def read_stats():
    return CALLS
```

```python wrong id=only-order
from functools import wraps

from fastapi import FastAPI

app = FastAPI()
CALLS: dict[str, int] = {}
POSTS = {1: "Hello", 2: "Notes"}


def counted(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        CALLS[func.__name__] = CALLS.get(func.__name__, 0) + 1
        func(*args, **kwargs)
    return wrapper


@app.get("/posts/{post_id}")
@counted
def read_post(post_id: int):
    return {"id": post_id, "title": POSTS.get(post_id, "unknown")}


@app.get("/stats")
def read_stats():
    return CALLS
```

```http tests
GET /stats
###
GET /posts/1
###
GET /posts/2
###
GET /stats
```

## task fa-py-deco-wraps

```json
{
  "type": "static",
  "title": "Сохранить сигнатуру обёртки",
  "xp": 10,
  "hints": [
    "Раздел «functools.wraps: сохранить лицо функции»: без @wraps FastAPI не видит параметры исходного обработчика.",
    "Импортируйте wraps из functools и поставьте @wraps(func) прямо над определением wrapper.",
    "Шаблон: from functools import wraps; def labeled(func): @wraps(func) def wrapper(*args, **kwargs): ..."
  ],
  "check": {
    "static": [
      { "rule": "imports", "module": "functools", "name": "wraps", "message": "Подключите wraps: from functools import wraps." },
      { "rule": "pattern", "regex": "^\\s*@wraps\\(\\s*\\w+\\s*\\)\\s*$", "message": "Поставьте @wraps(func) над определением wrapper: нужна именно запись с исходной функцией в скобках." }
    ]
  },
  "wrong": {
    "import-only": "wraps импортирован, но не применён к обёртке",
    "bare-decorator": "@wraps записан без скобок и без исходной функции"
  }
}
```
Декоратор `labeled` добавляет ко всем ответам поле `label`, но его обёртка скрывает сигнатуру обработчика `read_item`: параметр `item_id` перестаёт быть виден FastAPI. Исправьте декоратор, сохранив сигнатуру исходной функции. Проверка разбирает код, не запуская его.

```python starter
from fastapi import FastAPI

app = FastAPI()


def labeled(func):
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        result["label"] = "shop"
        return result
    return wrapper


@app.get("/items/{item_id}")
@labeled
def read_item(item_id: int):
    return {"id": item_id}
```

```python solution
from functools import wraps

from fastapi import FastAPI

app = FastAPI()


def labeled(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        result["label"] = "shop"
        return result
    return wrapper


@app.get("/items/{item_id}")
@labeled
def read_item(item_id: int):
    return {"id": item_id}
```

```python wrong id=import-only
from functools import wraps

from fastapi import FastAPI

app = FastAPI()


def labeled(func):
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        result["label"] = "shop"
        return result
    return wrapper


@app.get("/items/{item_id}")
@labeled
def read_item(item_id: int):
    return {"id": item_id}
```

```python wrong id=bare-decorator
from functools import wraps

from fastapi import FastAPI

app = FastAPI()


def labeled(func):
    @wraps
    def wrapper(*args, **kwargs):
        result = func(*args, **kwargs)
        result["label"] = "shop"
        return result
    return wrapper


@app.get("/items/{item_id}")
@labeled
def read_item(item_id: int):
    return {"id": item_id}
```

## task fa-py-deco-choice

```json
{
  "type": "choice",
  "title": "Что делает @app.get",
  "hints": [
    "Раздел «Как это связано с @app.get»: сравните с функцией register из примера.",
    "Декоратор с параметром — это функция, возвращающая декоратор. Что она делает с вашей функцией и что возвращает?",
    "Ответ «запускает сервер» неверен: сервер запускает команда в терминале. Ответ «копирует» неверен: функция одна и та же."
  ],
  "options": [
    "Запускает сервер и ждёт запросов на указанном пути",
    "Записывает функцию в таблицу маршрутов приложения вместе с путём и методом и возвращает её",
    "Создаёт копию функции, которая отвечает только на запросы GET",
    "Превращает функцию в класс-перечисление путей"
  ],
  "answer": [1],
  "explanation": "`@app.get(\"/путь\")` вызывается с путём, возвращает декоратор, и тот регистрирует вашу функцию в таблице маршрутов, как `register` из примера, а затем возвращает функцию. Сервер запускается отдельной командой, копии функции не создаётся, а перечислений путей здесь нет."
}
```
Что происходит на строке `@app.get("/posts")` над функцией `list_posts`?
