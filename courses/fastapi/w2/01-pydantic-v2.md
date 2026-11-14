# Pydantic v2: модели и проверка данных

Магазин принимает товары от поставщика в виде JSON. Цена приходит отрицательной, у названия лишние пробелы, а вместо числа лежит строка «много». Если такие данные попадут в базу, ошибка вылезет позже и в другом месте. Pydantic проверяет данные на входе: описываете форму один раз в модели, а FastAPI сам отвечает `422`, когда данные не подходят. В этом уроке вы научитесь описывать такие модели.

### BaseModel: модель как описание данных

**Модель** — класс, наследник `BaseModel`. Поля описываются аннотациями типов; Pydantic проверяет их при создании объекта и приводит значения к нужному типу.

```python
from pydantic import BaseModel


class Название(BaseModel):
    поле: тип
    поле_с_умолчанием: тип = значение
```

- `class Название(BaseModel)` — модель; имя пишут в `CamelCase`.
- `поле: тип` — обязательное поле. Нет в данных — ошибка «Field required».
- `= значение` — значение по умолчанию; такое поле можно не передавать.

Если в обработчике FastAPI параметр имеет тип-модель, то FastAPI читает его из **тела запроса** (JSON), создаёт объект модели и проверяет данные. Неверные данные не доходят до вашего кода: клиент получает `422` со списком ошибок.

Для примера отзывы о товарах. Названия полей и ограничения подробнее разобраны ниже, здесь важен сам ход:

```python example
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()


class Review(BaseModel):
    author: str = Field(min_length=2, max_length=30)
    rating: int = Field(ge=1, le=5)
    text: str = ""


@app.post("/reviews", status_code=201)
def add_review(review: Review):
    return review
###
POST /reviews
Content-Type: application/json

{"author": "Ann", "rating": 5}
###
POST /reviews
Content-Type: application/json

{"author": "A", "rating": "x"}
```

Первый запрос вернул `201` и `{"author": "Ann", "rating": 5, "text": ""}`: поле `text` взяло значение по умолчанию. Второй получил `422`. В `detail` по одной записи на каждое неверное поле: `loc` — путь к полю (`["body", "author"]`), `msg` — описание, `type` — код ошибки (`string_too_short`, `int_parsing`). Обе ошибки перечислены сразу, а не только первая.

Pydantic приводит типы: строка `"5"` в поле `int` станет числом `5`, а `"x"` — нет. Это называется **мягким режимом**, он по умолчанию.

### Field: ограничения и примеры

`Field(...)` ставят справа от `=` и описывают в нём ограничения поля.

```python
from pydantic import BaseModel, Field


class Название(BaseModel):
    число: int = Field(ge=0, le=100, default=0)
    текст: str = Field(min_length=1, max_length=50, pattern="^[a-z]+$")
```

- `gt`, `ge`, `lt`, `le` — для чисел: больше, больше или равно, меньше, меньше или равно. `gt=0` значит «строго больше нуля».
- `min_length`, `max_length` — длина строки или списка.
- `pattern` — регулярное выражение, которому должна соответствовать вся строка.
- `default=...` — значение по умолчанию. Если его нет, поле обязательное.
- `description="..."` — описание поля для документации `/docs`.
- `examples=[...]` — список примеров значений для документации; на проверку они не влияют.

Ограничения можно записывать и через `Annotated`: `rating: Annotated[int, Field(ge=1, le=5)]`. Это тот же `Field`, только рядом с типом, а не после `=`. Такую запись удобно вынести в имя и использовать в нескольких моделях: `Rating = Annotated[int, Field(ge=1, le=5)]`.

### field_validator: своя проверка поля

Ограничений `Field` не всегда хватает: «адрес должен содержать `@`», «код приводим к верхнему регистру». Для таких правил пишут **валидатор поля**.

```python
from pydantic import BaseModel, field_validator


class Название(BaseModel):
    поле: str

    @field_validator("поле")
    @classmethod
    def проверить(cls, value: str) -> str:
        if условие_не_выполнено:
            raise ValueError("сообщение")
        return value
```

- `@field_validator("поле")` — «эта функция проверяет поле `поле`». В скобках можно перечислить несколько полей через запятую.
- `@classmethod` — обязательно, и стоит **под** `field_validator`. Первый параметр `cls`, второй — значение поля.
- Валидатор выполняется **после** встроенной проверки типа и `Field`, поэтому `value` уже нужного типа.
- Функция обязана **вернуть** значение: то, что вернёте, и станет значением поля. Так можно менять его (`return value.upper()`).
- `raise ValueError("сообщение")` — сообщает об ошибке. FastAPI превратит её в `422`, сообщение попадёт в `msg` с приставкой «Value error, ».

### model_validator: проверка модели целиком

Если правило касается сразу нескольких полей (пароль и его повтор), используют `model_validator`. В режиме `mode="after"` он вызывается, когда все поля уже проверены и объект создан.

```python
from typing import Self

from pydantic import BaseModel, model_validator


class Название(BaseModel):
    а: int
    б: int

    @model_validator(mode="after")
    def проверить(self) -> Self:
        if self.а > self.б:
            raise ValueError("сообщение")
        return self
```

- `mode="after"` — проверка после создания объекта; метод обычный (`self`), без `@classmethod`.
- Поля читают как `self.а`, `self.б`.
- Метод должен вернуть `self`. Тип результата — `Self` из модуля `typing` («тот же класс»).
- Ошибка такого валидатора относится ко всему телу, а не к полю: в `loc` будет только `["body"]`.

Пример с регистрацией покупателя. Адрес приводится к нижнему регистру, а пароль сверяется с повтором:

```python example
from typing import Self

from fastapi import FastAPI
from pydantic import BaseModel, Field, field_validator, model_validator

app = FastAPI()


class Signup(BaseModel):
    email: str
    password: str = Field(min_length=8)
    repeat: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value:
            raise ValueError("email must contain @")
        return value

    @model_validator(mode="after")
    def passwords_match(self) -> Self:
        if self.password != self.repeat:
            raise ValueError("passwords do not match")
        return self


@app.post("/signup", status_code=201)
def signup(data: Signup):
    return {"email": data.email}
###
POST /signup
Content-Type: application/json

{"email": "  Ann@Shop.RU ", "password": "secret-pass", "repeat": "secret-pass"}
###
POST /signup
Content-Type: application/json

{"email": "ann.shop.ru", "password": "secret-pass", "repeat": "other-pass"}
###
POST /signup
Content-Type: application/json

{"email": "ann@shop.ru", "password": "secret-pass", "repeat": "other-pass"}
```

Первый запрос: `201` и `{"email": "ann@shop.ru"}`, пробелы убраны, регистр понижен. Второй: валидатор поля сработал, а валидатор модели нет — модель с неверным полем не создаётся, поэтому `model_validator(mode="after")` не вызывается. Третий: поля верны, сработал `model_validator`, и в `msg` написано «Value error, passwords do not match» при `loc` `["body"]`.

### Вложенные модели и списки

Поле модели может иметь тип другой модели или список моделей. Pydantic проверяет их рекурсивно, а в `loc` ошибки виден весь путь.

```python
class Адрес(BaseModel):
    город: str


class Посылка(BaseModel):
    куда: Адрес
    вес: list[float]
```

- `куда: Адрес` — в JSON это вложенный объект `{"куда": {"город": "..."}}`.
- `list[float]` — список чисел; `list[Адрес]` — список объектов. Длину списка ограничивают через `Field(min_length=1)`.
- Ошибка внутри списка называет индекс: `["body", "вес", 1]` — второй элемент.

### model_config: настройки модели

Поведение всей модели задаёт атрибут `model_config` со значением `ConfigDict(...)`:

```python
from pydantic import BaseModel, ConfigDict


class Название(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    поле: str
```

- `extra="forbid"` — лишние поля в данных запрещены, клиент получит `422` с ошибкой `extra_forbidden`. По умолчанию (`extra="ignore"`) лишнее молча отбрасывается, и опечатка в имени необязательного поля остаётся незамеченной.
- `str_strip_whitespace=True` — пробелы по краям всех строковых полей обрезаются **до** проверки длины, так что строка из одних пробелов не пройдёт `min_length=1`.
- Настройки действуют только на ту модель, где записаны. У вложенной модели нужен свой `model_config`.

Пример с посылкой:

```python example
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI()


class Address(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    city: str = Field(min_length=1)
    street: str = Field(min_length=1)


class Parcel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    recipient: str = Field(min_length=1)
    address: Address
    weights: list[float] = Field(min_length=1)


@app.post("/parcels")
def create_parcel(parcel: Parcel):
    return {"to": parcel.recipient, "city": parcel.address.city, "kg": sum(parcel.weights)}
###
POST /parcels
Content-Type: application/json

{"recipient": "  Ivan ", "address": {"city": "Kazan", "street": "Lenina 1"}, "weights": [1.5, 2]}
###
POST /parcels
Content-Type: application/json

{"recipient": "Ivan", "address": {"city": "Kazan", "street": "Lenina 1", "flat": 4}, "weights": [1.5, "-"]}
```

Первый запрос: `{"to": "Ivan", "city": "Kazan", "kg": 3.5}`. Второй даёт две ошибки с путями `["body", "address", "flat"]` (`extra_forbidden`) и `["body", "weights", 1]` (`float_parsing`).

### Алиасы и сериализация

**Алиас** — другое имя поля в JSON. Клиент JS пишет `unitPrice`, а в Python принято `unit_price`.

```python
class Название(BaseModel):
    unit_price: float = Field(alias="unitPrice")
    sale_price: float = Field(default=0, serialization_alias="salePrice")
```

- `alias="unitPrice"` — имя поля в JSON при чтении, а при выдаче — когда включён `by_alias=True` (FastAPI с `response_model` включает его сам). По имени `unit_price` такое поле уже не прочитать.
- `serialization_alias="salePrice"` — имя только при выдаче; читается поле по обычному имени.

**Сериализация** — превращение модели в словарь. Метод `model_dump()` делает словарь с именами полей Python. У него есть параметры:

- `model_dump(by_alias=True)` — вместо имён полей использовать алиасы;
- `model_dump(exclude_unset=True)` — убрать поля, которые не передавали при создании (значения по умолчанию не попадут);
- `model_dump(exclude={"поле"})` — убрать перечисленные поля;
- `model_dump_json()` — то же, но сразу строка JSON.

```python example
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()


class Item(BaseModel):
    title: str
    unit_price: float = Field(alias="unitPrice")
    sale_price: float = Field(default=0, serialization_alias="salePrice")


@app.get("/demo")
def demo():
    item = Item(title="Lamp", unitPrice=40)
    return {
        "plain": item.model_dump(),
        "by_alias": item.model_dump(by_alias=True),
        "unset_only": item.model_dump(exclude_unset=True),
    }
###
GET /demo
```

В ответе `plain` — `{"title": "Lamp", "unit_price": 40.0, "sale_price": 0}`, `by_alias` — `{"title": "Lamp", "unitPrice": 40.0, "salePrice": 0}`, `unset_only` — `{"title": "Lamp", "unit_price": 40.0}`. Объект создан с `unitPrice=40`: поле с алиасом при создании тоже называют алиасом.

### from_attributes: модель из обычного объекта

Данные не всегда приходят словарём: строка из базы данных — это объект, у которого есть атрибуты. Чтобы собрать модель из такого объекта, включают `from_attributes=True` и вызывают `model_validate(объект)`.

```python
class Название(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    поле: тип


модель = Название.model_validate(объект)
```

- `from_attributes=True` — читать значения полей как атрибуты (`объект.поле`), а не только как ключи словаря.
- `Название.model_validate(...)` — метод класса: проверяет данные и возвращает объект модели; принимает и словарь, и объект с атрибутами.

```python example
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict

app = FastAPI()


class CategoryRow:
    def __init__(self, id: int, title: str) -> None:
        self.id = id
        self.title = title


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str


@app.get("/category")
def category():
    return CategoryOut.model_validate(CategoryRow(3, "Lamps")).model_dump()
###
GET /category
```

Ответ: `{"id": 3, "title": "Lamps"}`. Без `from_attributes=True` вызов упал бы с ошибкой проверки «Input should be a valid dictionary or instance of CategoryOut», и клиент увидел бы `500`.

### Чего избегать

Старые формы Pydantic v1 ещё встречаются в чужом коде и в старых статьях. Узнавайте их и заменяйте:

- `class Config:` внутри модели (с `orm_mode = True`) → `model_config = ConfigDict(from_attributes=True)`;
- `@validator("поле")` → `@field_validator("поле")` с `@classmethod`; `@root_validator` → `@model_validator`;
- `.dict()`, `.json()`, `.parse_obj()`, `.from_orm()` → `.model_dump()`, `.model_dump_json()`, `.model_validate()`;
- `Field(regex=...)` → `Field(pattern=...)`; `Field(min_items=...)` → `Field(min_length=...)`.

### Частые ошибки

- Лишний `default=...` в ограничениях. Неверно: `price: float = Field(gt=0, default=...)`. Верно: `price: float = Field(gt=0)`. Многоточие не нужно: без `default` поле и так обязательное.
- Валидатор ничего не возвращает. Неверно: `def check(cls, value): if ...: raise ValueError("x")` без `return`. Верно: в конце `return value`, иначе поле станет `None`.
- Забыли `@classmethod` у `field_validator`. Неверно: `@field_validator("a") def check(self, value)`. Верно: `@field_validator("a")` и под ним `@classmethod`, первый параметр `cls`.
- Ожидали, что лишнее поле даст `422`. Неверно: модель без `model_config`, клиент прислал `{"flat": 4}` — оно молча пропало. Верно: `ConfigDict(extra="forbid")`.
- Алиас вместо имени. Неверно: `Item(unit_price=40)` при `alias="unitPrice"`. Верно: `Item(unitPrice=40)` либо `serialization_alias`, если читать нужно по имени.

### Шпаргалка

- `class M(BaseModel): поле: тип = значение` — модель; параметр обработчика с типом-моделью читается из тела JSON, ошибки — `422`.
- `Field(gt, ge, lt, le, min_length, max_length, pattern, default, description, examples)`.
- `@field_validator("поле")` + `@classmethod` + `return value`; ошибка — `raise ValueError("...")`.
- `@model_validator(mode="after")`: метод с `self`, возвращает `self` (`Self` из `typing`).
- Вложенные модели и `list[Модель]`; `loc` показывает весь путь.
- `model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, from_attributes=True)`.
- `Field(alias=...)`, `Field(serialization_alias=...)`.
- `m.model_dump(by_alias=True, exclude_unset=True, exclude={...})`, `m.model_dump_json()`, `М.model_validate(данные)`.
- Не использовать: `class Config`, `orm_mode`, `@validator`, `.dict()`, `.json()`.

## task fa-product-fields
```json
{
  "type": "fastapi",
  "title": "Приём товара от поставщика",
  "xp": 10,
  "hints": [
    "Раздел «Field: ограничения и примеры»: для чисел есть gt, ge, lt, le, для строк — min_length и max_length.",
    "Название: от 1 до 60 символов. Цена строго больше нуля (gt). Остаток — целое от нуля (ge) и по умолчанию 0.",
    "Шаблон: name: str = Field(min_length=…, max_length=…); price: float = Field(gt=…); stock: int = Field(ge=…, default=…)."
  ],
  "wrong": {
    "price-zero": "цена ноль проходит проверку, а должна быть строго больше нуля",
    "no-name-limit": "слишком длинное название проходит проверку"
  }
}
```
Поставщик отправляет новые товары запросом `POST /products` с JSON `{"name": "...", "price": число, "stock": целое}`. Приложение должно отвечать `201` и возвращать принятый товар теми же тремя полями.

Правила:

- `name` — строка от 1 до 60 символов;
- `price` — число строго больше нуля;
- `stock` — целое не меньше нуля; поле можно не передавать, тогда оно равно `0`;
- товар, не подходящий под правила, получает `422`.

Идея: опишите модель с ограничениями в `Field` и сделайте её типом параметра обработчика. Остальное сделает FastAPI.

```python starter
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()


class ProductIn(BaseModel):
    name: str  # добавьте ограничения длины
    price: float  # цена строго больше нуля
    stock: int = 0  # не меньше нуля


@app.post("/products", status_code=201)
def create_product(product: ProductIn):
    return product
```

```python solution
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    price: float = Field(gt=0)
    stock: int = Field(ge=0, default=0)


@app.post("/products", status_code=201)
def create_product(product: ProductIn):
    return product
```

```python wrong id=price-zero
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    price: float = Field(ge=0)
    stock: int = Field(ge=0, default=0)


@app.post("/products", status_code=201)
def create_product(product: ProductIn):
    return product
```

```python wrong id=no-name-limit
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI()


class ProductIn(BaseModel):
    name: str = Field(min_length=1)
    price: float = Field(gt=0)
    stock: int = Field(ge=0, default=0)


@app.post("/products", status_code=201)
def create_product(product: ProductIn):
    return product
```

```http tests
POST /products
Content-Type: application/json

{"name": "Lamp", "price": 19.5, "stock": 4}
###
POST /products
Content-Type: application/json

{"name": "Pen", "price": 2}
###
POST /products
Content-Type: application/json

{"name": "Free", "price": 0}
###
POST /products
Content-Type: application/json

{"name": "", "price": 5}
###
POST /products
Content-Type: application/json

{"name": "Pen", "price": 5, "stock": -1}
###
POST /products
Content-Type: application/json

{"name": "Pen", "price": "много"}
###
POST /products
Content-Type: application/json

{"name": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "price": 5}
###
POST /products
Content-Type: application/json

{"price": 5}
```

## task fa-promo-validators
```json
{
  "type": "fastapi",
  "title": "Промокод: свои проверки",
  "xp": 15,
  "hints": [
    "Разделы «field_validator: своя проверка поля» и «model_validator: проверка модели целиком».",
    "Валидатор поля code обрезает пробелы, переводит в верхний регистр и отклоняет всё, кроме букв и цифр. Валидатор модели сравнивает min_total и max_total.",
    "Шаблон: @field_validator(\"code\") @classmethod def …(cls, value): value = value.strip().upper(); if not value.isalnum(): raise ValueError(…); return value. И @model_validator(mode=\"after\") def …(self) -> Self: if …: raise ValueError(…); return self."
  ],
  "wrong": {
    "no-upper": "код не приводится к верхнему регистру",
    "no-range-check": "промокод с минимальной суммой больше максимальной принимается"
  }
}
```
Маркетолог заводит промокоды запросом `POST /promos` с телом `{"code": "...", "percent": целое, "min_total": число, "max_total": число}`. При успехе ответ `201` и те же четыре поля.

Правила:

- `code` — приводится к виду без пробелов по краям и в верхнем регистре: `" spring25 "` станет `"SPRING25"`. После этого в нём должны остаться только буквы и цифры (`isalnum()`), иначе `422`;
- `percent` — целое от 1 до 90;
- `min_total` и `max_total` — числа не меньше нуля, причём `min_total` не больше `max_total` (равные допустимы), иначе `422`.

Метод строки `.isalnum()` возвращает `True`, если в строке только буквы и цифры и она не пустая.

```python starter
from typing import Self

from fastapi import FastAPI
from pydantic import BaseModel, Field, field_validator, model_validator

app = FastAPI()


class Promo(BaseModel):
    code: str
    percent: int = Field(ge=1, le=90)
    min_total: float = Field(ge=0)
    max_total: float = Field(ge=0)

    # добавьте валидатор поля code и валидатор модели


@app.post("/promos", status_code=201)
def create_promo(promo: Promo):
    return promo
```

```python solution
from typing import Self

from fastapi import FastAPI
from pydantic import BaseModel, Field, field_validator, model_validator

app = FastAPI()


class Promo(BaseModel):
    code: str
    percent: int = Field(ge=1, le=90)
    min_total: float = Field(ge=0)
    max_total: float = Field(ge=0)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        value = value.strip().upper()
        if not value.isalnum():
            raise ValueError("code must contain letters and digits only")
        return value

    @model_validator(mode="after")
    def check_range(self) -> Self:
        if self.min_total > self.max_total:
            raise ValueError("min_total must not exceed max_total")
        return self


@app.post("/promos", status_code=201)
def create_promo(promo: Promo):
    return promo
```

```python wrong id=no-upper
from typing import Self

from fastapi import FastAPI
from pydantic import BaseModel, Field, field_validator, model_validator

app = FastAPI()


class Promo(BaseModel):
    code: str
    percent: int = Field(ge=1, le=90)
    min_total: float = Field(ge=0)
    max_total: float = Field(ge=0)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        value = value.strip()
        if not value.isalnum():
            raise ValueError("code must contain letters and digits only")
        return value

    @model_validator(mode="after")
    def check_range(self) -> Self:
        if self.min_total > self.max_total:
            raise ValueError("min_total must not exceed max_total")
        return self


@app.post("/promos", status_code=201)
def create_promo(promo: Promo):
    return promo
```

```python wrong id=no-range-check
from fastapi import FastAPI
from pydantic import BaseModel, Field, field_validator

app = FastAPI()


class Promo(BaseModel):
    code: str
    percent: int = Field(ge=1, le=90)
    min_total: float = Field(ge=0)
    max_total: float = Field(ge=0)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        value = value.strip().upper()
        if not value.isalnum():
            raise ValueError("code must contain letters and digits only")
        return value


@app.post("/promos", status_code=201)
def create_promo(promo: Promo):
    return promo
```

```http tests
POST /promos
Content-Type: application/json

{"code": " spring25 ", "percent": 15, "min_total": 100, "max_total": 5000}
###
POST /promos
Content-Type: application/json

{"code": "SALE", "percent": 10, "min_total": 300, "max_total": 300}
###
POST /promos
Content-Type: application/json

{"code": "spring 25", "percent": 15, "min_total": 100, "max_total": 5000}
###
POST /promos
Content-Type: application/json

{"code": "   ", "percent": 15, "min_total": 100, "max_total": 5000}
###
POST /promos
Content-Type: application/json

{"code": "SALE", "percent": 10, "min_total": 900, "max_total": 100}
###
POST /promos
Content-Type: application/json

{"code": "SALE", "percent": 95, "min_total": 0, "max_total": 100}
```

## task fa-order-nested
```json
{
  "type": "fastapi",
  "title": "Заказ: вложенные модели",
  "xp": 15,
  "hints": [
    "Разделы «Вложенные модели и списки» и «model_config: настройки модели».",
    "Customer и Order — вложенные модели; model_config нужен каждой из них отдельно. Список позиций ограничьте через Field(min_length=…, max_length=…).",
    "Шаблон: model_config = ConfigDict(extra=\"forbid\", str_strip_whitespace=True) в Customer и Order; lines: list[Line] = Field(min_length=1, max_length=5)."
  ],
  "wrong": {
    "no-forbid": "лишние поля в заказе молча отбрасываются вместо ответа 422",
    "no-strip": "пробелы в имени покупателя не обрезаются, а строка из одних пробелов проходит проверку"
  }
}
```
Интернет-магазин принимает заказ запросом `POST /orders`. Тело:

```json
{"customer": {"name": "...", "email": "..."}, "lines": [{"sku": "...", "qty": 2, "price": 3.5}], "note": "..."}
```

Ответ `201`: `{"customer": имя, "lines": число позиций, "total": сумма цена × количество, округлённая до двух знаков}`. Обработчик уже написан, а модели ждут правил:

- `customer.name` и `customer.email` — непустые строки; пробелы по краям обрезаются (имя `"  Ann "` попадёт в ответ как `"Ann"`, а строка из пробелов — это `422`);
- `lines` — от 1 до 5 позиций; у позиции `sku` — непустая строка, `qty` — целое от 1 до 10, `price` — число строго больше нуля;
- `note` — необязательная строка, по умолчанию пустая; обрезка пробелов действует и на неё;
- любые лишние поля в заказе, в покупателе и в позиции запрещены: ответ `422`.

```python starter
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI()


class Customer(BaseModel):
    name: str
    email: str


class Line(BaseModel):
    sku: str
    qty: int
    price: float


class Order(BaseModel):
    customer: Customer
    lines: list[Line]
    note: str = ""


@app.post("/orders", status_code=201)
def create_order(order: Order):
    total = sum(line.qty * line.price for line in order.lines)
    return {"customer": order.customer.name, "lines": len(order.lines), "total": round(total, 2)}
```

```python solution
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI()


class Customer(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1)
    email: str = Field(min_length=1)


class Line(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    sku: str = Field(min_length=1)
    qty: int = Field(ge=1, le=10)
    price: float = Field(gt=0)


class Order(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    customer: Customer
    lines: list[Line] = Field(min_length=1, max_length=5)
    note: str = ""


@app.post("/orders", status_code=201)
def create_order(order: Order):
    total = sum(line.qty * line.price for line in order.lines)
    return {"customer": order.customer.name, "lines": len(order.lines), "total": round(total, 2)}
```

```python wrong id=no-forbid
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI()


class Customer(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1)
    email: str = Field(min_length=1)


class Line(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    sku: str = Field(min_length=1)
    qty: int = Field(ge=1, le=10)
    price: float = Field(gt=0)


class Order(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    customer: Customer
    lines: list[Line] = Field(min_length=1, max_length=5)
    note: str = ""


@app.post("/orders", status_code=201)
def create_order(order: Order):
    total = sum(line.qty * line.price for line in order.lines)
    return {"customer": order.customer.name, "lines": len(order.lines), "total": round(total, 2)}
```

```python wrong id=no-strip
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI()


class Customer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    email: str = Field(min_length=1)


class Line(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sku: str = Field(min_length=1)
    qty: int = Field(ge=1, le=10)
    price: float = Field(gt=0)


class Order(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer: Customer
    lines: list[Line] = Field(min_length=1, max_length=5)
    note: str = ""


@app.post("/orders", status_code=201)
def create_order(order: Order):
    total = sum(line.qty * line.price for line in order.lines)
    return {"customer": order.customer.name, "lines": len(order.lines), "total": round(total, 2)}
```

```http tests
POST /orders
Content-Type: application/json

{"customer": {"name": "  Ann ", "email": "ann@shop.ru"}, "lines": [{"sku": "PEN", "qty": 2, "price": 3.5}, {"sku": "BOOK", "qty": 1, "price": 12.25}]}
###
POST /orders
Content-Type: application/json

{"customer": {"name": "   ", "email": "ann@shop.ru"}, "lines": [{"sku": "PEN", "qty": 1, "price": 3}]}
###
POST /orders
Content-Type: application/json

{"customer": {"name": "Ann", "email": "ann@shop.ru"}, "lines": [{"sku": "PEN", "qty": 1, "price": 3}], "coupon": "X"}
###
POST /orders
Content-Type: application/json

{"customer": {"name": "Ann", "email": "ann@shop.ru", "phone": "1"}, "lines": [{"sku": "PEN", "qty": 1, "price": 3}]}
###
POST /orders
Content-Type: application/json

{"customer": {"name": "Ann", "email": "ann@shop.ru"}, "lines": [{"sku": "PEN", "qty": 1, "price": 3, "gift": true}]}
###
POST /orders
Content-Type: application/json

{"customer": {"name": "Ann", "email": "ann@shop.ru"}, "lines": []}
###
POST /orders
Content-Type: application/json

{"customer": {"name": "Ann", "email": "ann@shop.ru"}, "lines": [{"sku": "A", "qty": 1, "price": 1}, {"sku": "B", "qty": 1, "price": 1}, {"sku": "C", "qty": 1, "price": 1}, {"sku": "D", "qty": 1, "price": 1}, {"sku": "E", "qty": 1, "price": 1}, {"sku": "F", "qty": 1, "price": 1}]}
###
POST /orders
Content-Type: application/json

{"customer": {"name": "Ann", "email": "ann@shop.ru"}, "lines": [{"sku": "PEN", "qty": 11, "price": 3}]}
###
POST /orders
Content-Type: application/json

{"customer": {"name": "Ann", "email": "ann@shop.ru"}, "lines": [{"sku": "PEN", "qty": 1, "price": 0}], "note": "  call me "}
```

## task fa-fix-product-view
```json
{
  "type": "fix-bug",
  "title": "Карточка товара не собирается",
  "xp": 15,
  "hints": [
    "Раздел «from_attributes: модель из обычного объекта» и раздел «Алиасы и сериализация».",
    "Ошибок две. Первая: модель не умеет читать атрибуты объекта, поэтому model_validate падает и клиент видит 500. Вторая: в ответе поле должно называться unitPrice, а не unit_price.",
    "Шаблон: в модели model_config = ConfigDict(from_attributes=True); в обработчике — .model_dump(by_alias=True)."
  ],
  "wrong": {
    "only-attributes": "модель читает объект, но поле в ответе называется unit_price вместо unitPrice",
    "only-alias": "алиас в ответе есть, но модель не умеет читать атрибуты объекта и обработчик падает с 500"
  }
}
```
Каталог магазина хранит товары как объекты `ProductRow`. Маршрут `GET /products/{product_id}` должен собрать из строки модель `ProductView` и вернуть её JSON: `{"id": 1, "title": "Lamp", "unitPrice": 40.0}`. Сейчас маршрут отвечает `500`, а когда падение исправлено, поле называется не так, как требует фронтенд.

Известны два товара: `1` и `2`. Исправьте код так, чтобы оба ответа были `200` с полем `unitPrice`.

```python starter
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI()


class ProductRow:
    def __init__(self, id: int, title: str, unit_price: float) -> None:
        self.id = id
        self.title = title
        self.unit_price = unit_price


ROWS = {1: ProductRow(1, "Lamp", 40), 2: ProductRow(2, "Desk", 120.5)}


class ProductView(BaseModel):
    id: int
    title: str
    unit_price: float = Field(serialization_alias="unitPrice")


@app.get("/products/{product_id}")
def read_product(product_id: int):
    return ProductView.model_validate(ROWS[product_id]).model_dump()
```

```python solution
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI()


class ProductRow:
    def __init__(self, id: int, title: str, unit_price: float) -> None:
        self.id = id
        self.title = title
        self.unit_price = unit_price


ROWS = {1: ProductRow(1, "Lamp", 40), 2: ProductRow(2, "Desk", 120.5)}


class ProductView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    unit_price: float = Field(serialization_alias="unitPrice")


@app.get("/products/{product_id}")
def read_product(product_id: int):
    return ProductView.model_validate(ROWS[product_id]).model_dump(by_alias=True)
```

```python wrong id=only-attributes
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI()


class ProductRow:
    def __init__(self, id: int, title: str, unit_price: float) -> None:
        self.id = id
        self.title = title
        self.unit_price = unit_price


ROWS = {1: ProductRow(1, "Lamp", 40), 2: ProductRow(2, "Desk", 120.5)}


class ProductView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    unit_price: float = Field(serialization_alias="unitPrice")


@app.get("/products/{product_id}")
def read_product(product_id: int):
    return ProductView.model_validate(ROWS[product_id]).model_dump()
```

```python wrong id=only-alias
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI()


class ProductRow:
    def __init__(self, id: int, title: str, unit_price: float) -> None:
        self.id = id
        self.title = title
        self.unit_price = unit_price


ROWS = {1: ProductRow(1, "Lamp", 40), 2: ProductRow(2, "Desk", 120.5)}


class ProductView(BaseModel):
    id: int
    title: str
    unit_price: float = Field(serialization_alias="unitPrice")


@app.get("/products/{product_id}")
def read_product(product_id: int):
    return ProductView.model_validate(ROWS[product_id]).model_dump(by_alias=True)
```

```http tests
GET /products/1
###
GET /products/2
```
