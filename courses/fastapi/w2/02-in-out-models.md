# Модели In, Out и DB: что принимать и что отдавать

Покупатель регистрируется в магазине и присылает имя, почту и пароль. В базе лежит хэш пароля, а в ответ клиенту нужны только номер, имя и почта. Если вернуть из обработчика ту же запись, что хранится в базе, хэш уйдёт наружу. Для таких случаев данные описывают несколькими моделями: одна для входа, одна для хранения, одна для ответа. В этом уроке вы научитесь отделять то, что принимаете, от того, что отдаёте.

### Три модели вместо одной

Одна модель на все случаи не годится: у входных данных, записи в базе и ответа разные наборы полей.

- **In** — то, что присылает клиент: `name`, `email`, `password`. Номера ещё нет, пароль открытый.
- **DB** — то, что хранится: `id`, `name`, `email`, `password_hash`. Открытого пароля здесь нет.
- **Out** — то, что видит клиент: `id`, `name`, `email`. Ни пароля, ни хэша.

Названия `In`, `Out`, `DB` — договорённость, а не требование FastAPI. Важно, что у каждой модели своя задача. Общие поля можно вынести в базовый класс и наследовать:

```python
class CourierBase(BaseModel):
    name: str
    phone: str


class CourierIn(CourierBase):
    pin: str


class CourierOut(CourierBase):
    id: int
```

- `class CourierIn(CourierBase)` — наследник получает поля родителя (`name`, `phone`) и добавляет свои.
- Поля, которых нет в `CourierOut`, в ответ не попадут.

### response_model: фильтр на выходе

Параметр `response_model` в декораторе маршрута говорит FastAPI: «ответ приведи к этой модели». Лишние поля отбрасываются, недостающие проверяются.

```python
@app.post("/путь", response_model=ModelOut, status_code=201)
def create(data: ModelIn):
    ...
    return запись_из_базы
```

- `response_model=ModelOut` — модель ответа. Обработчик может вернуть объект `ModelDB` или словарь: FastAPI оставит в ответе только поля `ModelOut`.
- `status_code=201` — код успешного ответа (подробнее ниже).

Второй способ — тип результата после стрелки: `def create(...) -> ModelOut:`. Он работает так же, но только когда функция возвращает именно `ModelOut` или его наследника. Если функция возвращает объект другой модели (`ModelDB`), честнее записать `response_model=ModelOut` в декораторе, а стрелку оставить для настоящего типа результата.

Если маршрут отдаёт список записей, модель оборачивают в `list[...]`: `@app.get("/couriers", response_model=list[CourierOut])`. Каждый элемент списка приводится к `CourierOut`, лишние поля отбрасываются в каждом.

`response_model` ещё и описывает ответ в документации `/docs`: клиентские разработчики видят именно поля `Out`, а не `DB`.

Пример с курьерами. Пин-код хранится только в записи `CourierDB`, а клиент получает `CourierOut`:

```python example
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()


class CourierBase(BaseModel):
    name: str = Field(min_length=1)
    phone: str


class CourierIn(CourierBase):
    pin: str = Field(min_length=4)


class CourierOut(CourierBase):
    id: int


class CourierDB(CourierOut):
    pin_hash: str


COURIERS: dict[int, CourierDB] = {}


@app.post("/couriers", response_model=CourierOut, status_code=201)
def create_courier(data: CourierIn) -> CourierDB:
    courier = CourierDB(id=len(COURIERS) + 1, name=data.name, phone=data.phone, pin_hash="x" + data.pin)
    COURIERS[courier.id] = courier
    return courier


@app.get("/couriers/{courier_id}", response_model=CourierOut)
def read_courier(courier_id: int) -> CourierDB:
    if courier_id not in COURIERS:
        raise HTTPException(status_code=404, detail="Courier not found")
    return COURIERS[courier_id]
###
POST /couriers
Content-Type: application/json

{"name": "Oleg", "phone": "+7 900 111-22-33", "pin": "4821"}
###
GET /couriers/1
###
GET /couriers/7
```

Первый запрос вернул `201` и `{"name": "Oleg", "phone": "+7 900 111-22-33", "id": 1}`. Поля `pin` и `pin_hash` в ответе нет, хотя обработчик вернул запись `CourierDB` целиком. Второй запрос отдал ту же запись без хэша. Третий — `404`.

В примере хэш изображён простой строкой `"x" + pin`: настоящие хэши паролей (`bcrypt`) появятся в уроках про безопасность. Для этого урока важен не способ хэширования, а то, что поле `pin_hash` не доходит до клиента.

Короткая справка по `HTTPException`, который встретился в примере. `raise HTTPException(status_code=404, detail="текст")` прерывает обработчик, и клиент получает ответ с этим кодом и телом `{"detail": "текст"}`. Подробно он разобран в последнем уроке мира.

### status_code: коды успеха

По умолчанию успешный ответ — `200`. Для разных операций принято разное:

- `201 Created` — запись создана (`POST`);
- `204 No Content` — действие выполнено, тела в ответе нет (`DELETE`, иногда `PUT`);
- `200 OK` — всё остальное.

Код задают в декораторе: `@app.post("/couriers", status_code=201)`. Для `204` обработчик ничего не возвращает:

```python example
from fastapi import FastAPI, HTTPException

app = FastAPI()
WISHLIST = {1: "Lamp", 2: "Desk"}


@app.delete("/wishlist/{item_id}", status_code=204)
def remove_item(item_id: int):
    if item_id not in WISHLIST:
        raise HTTPException(status_code=404, detail="Item not in wishlist")
    del WISHLIST[item_id]
###
DELETE /wishlist/1
###
DELETE /wishlist/1
```

Первое удаление: `204` и пустое тело. Повторное: `404` с `{"detail": "Item not in wishlist"}`, потому что записи уже нет. У ответа `204` тела нет, поэтому обработчик ничего не возвращает и тип результата не указывает.

### Документация ответов: /openapi.json и responses

FastAPI строит описание API по вашему коду и отдаёт его по адресу `/openapi.json` (страница `/docs` показывает то же красиво). В описании у каждого маршрута есть коды ответов и схемы моделей: `response_model` и `status_code` попадают туда сами.

Ответ-ошибку, который обработчик бросает через `HTTPException`, FastAPI сам не увидит. Его описывают параметром `responses` в декораторе:

```python
@app.get("/путь/{id}", response_model=ModelOut, responses={404: {"description": "Не найдено"}})
def read(id: int): ...
```

- `responses` — словарь: ключ — код ответа, значение — словарь с описанием; `description` — короткий текст для читателя документации;
- кодов можно перечислить несколько: `responses={404: {...}, 409: {...}}`;
- на поведение обработчика `responses` не влияет: это только описание.

Если проверка сравнивает ваш `/openapi.json` с эталонным, она смотрит на наборы кодов ответа, параметры и имена моделей с полями. Поэтому `status_code=204` и `responses={404: ...}` нужно указать, даже если обработчик уже работает верно.

### Необязательные поля и response_model_exclude_unset

В моделях ответа часто есть необязательные поля: описание товара или скидка. Запись `str | None = None` означает «строка или `None`, по умолчанию `None`». Если клиенту отдать все такие поля, он увидит много `null` и нулей, которых никто не задавал.

Параметр `response_model_exclude_unset=True` в декораторе убирает из ответа поля, значения которых не задавались явно (остались по умолчанию).

```python example
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class Coupon(BaseModel):
    code: str
    percent: int = 5
    note: str | None = None


COUPONS = {
    "A": {"code": "A", "percent": 10},
    "B": {"code": "B"},
}


@app.get("/full/{code}", response_model=Coupon)
def read_full(code: str):
    return COUPONS[code]


@app.get("/short/{code}", response_model=Coupon, response_model_exclude_unset=True)
def read_short(code: str):
    return COUPONS[code]
###
GET /full/B
###
GET /short/B
###
GET /short/A
```

- `/full/B` отдал все поля: `{"code": "B", "percent": 5, "note": null}`;
- `/short/B` — только то, что было в словаре: `{"code": "B"}`;
- `/short/A` — `{"code": "A", "percent": 10}`.

Родственные параметры: `response_model_exclude_none=True` убирает поля со значением `None`, `response_model_exclude={"поле"}` убирает названные поля. Но для безопасности они хуже, чем отдельная модель `Out`: забытый параметр — утечка, а отдельная модель без поля утечь не может.

### Проверка кода: поле не должно попасть в Out

Утечки полей ловит и проверка кода. Правило «модель ответа не содержит поле» разбирает файлы и смотрит все `response_model=...` и типы результата маршрутов, не запуская код. В заданиях оно называется так: «модель ответа не должна отдавать поле `password_hash`».

### Частые ошибки

- Вернули запись из базы без `response_model`. Неверно: `def read(...) -> CourierDB:` — клиент получит и хэш. Верно: `response_model=CourierOut` в декораторе.
- Поле секрета осталось в модели ответа. Неверно: `CourierOut` с полем `pin_hash`. Верно: секретные поля только в `DB`-модели.
- `status_code` забыт. Неверно: создание отвечает `200`. Верно: `@app.post(..., status_code=201)`.
- Тело в ответе `204`. Неверно: возвращать словарь с `status_code=204`. Верно: обработчик ничего не возвращает.
- Стрелка вместо `response_model` при разных типах. Неверно: `-> CourierOut`, а возвращается `CourierDB` — читателю кода и проверкам типов неясно, что происходит. Верно: `response_model=CourierOut`, а возвращаемый тип — настоящий.

### Шпаргалка

- `In` (что принимаем), `DB` (что храним), `Out` (что отдаём); общие поля — в базовом классе.
- `@app.post(путь, response_model=Out, status_code=201)`.
- `-> Out` работает, когда функция возвращает `Out` или наследника.
- `201` — создание, `204` — без тела, `200` — по умолчанию.
- `raise HTTPException(status_code=404, detail="текст")` — ответ-ошибка.
- `response_model_exclude_unset=True`, `response_model_exclude_none=True`, `response_model_exclude={...}`.
- `поле: str | None = None` — необязательное поле.

## task fa-customer-out
```json
{
  "type": "fastapi",
  "title": "Покупатель без пароля",
  "xp": 10,
  "hints": [
    "Раздел «response_model: фильтр на выходе». Запись CustomerDB нельзя отдавать клиенту целиком.",
    "Создайте модель CustomerOut с полями id, name и email и укажите её в response_model у обоих маршрутов.",
    "Шаблон: class CustomerOut(BaseModel): id: int; name: str; email: str. В декораторе: @app.post(\"/customers\", status_code=201, response_model=CustomerOut)."
  ],
  "wrong": {
    "hash-in-out": "модель ответа содержит password_hash, хэш виден клиенту",
    "get-leaks": "создание отдаёт безопасную модель, а чтение покупателя по номеру по-прежнему возвращает хэш"
  }
}
```
Магазин регистрирует покупателей: `POST /customers` принимает `{"name", "email", "password"}`, отвечает `201`. `GET /customers/{customer_id}` возвращает покупателя, а если его нет, — `404` с `{"detail": "Customer not found"}`. Эти два обработчика и модели `CustomerIn`, `CustomerDB` уже написаны, но ответ содержит `password_hash`.

Нужно, чтобы оба маршрута отдавали ровно `{"id", "name", "email"}`, без пароля и хэша. Остальное поведение не меняйте.

```python starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()


class CustomerIn(BaseModel):
    name: str = Field(min_length=1)
    email: str
    password: str = Field(min_length=8)


class CustomerDB(BaseModel):
    id: int
    name: str
    email: str
    password_hash: str


CUSTOMERS: dict[int, CustomerDB] = {}


@app.post("/customers", status_code=201)
def create_customer(data: CustomerIn) -> CustomerDB:
    customer = CustomerDB(
        id=len(CUSTOMERS) + 1,
        name=data.name,
        email=data.email,
        password_hash="hash:" + data.password[::-1],
    )
    CUSTOMERS[customer.id] = customer
    return customer


@app.get("/customers/{customer_id}")
def read_customer(customer_id: int) -> CustomerDB:
    if customer_id not in CUSTOMERS:
        raise HTTPException(status_code=404, detail="Customer not found")
    return CUSTOMERS[customer_id]
```

```python solution
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()


class CustomerIn(BaseModel):
    name: str = Field(min_length=1)
    email: str
    password: str = Field(min_length=8)


class CustomerOut(BaseModel):
    id: int
    name: str
    email: str


class CustomerDB(CustomerOut):
    password_hash: str


CUSTOMERS: dict[int, CustomerDB] = {}


@app.post("/customers", status_code=201, response_model=CustomerOut)
def create_customer(data: CustomerIn) -> CustomerDB:
    customer = CustomerDB(
        id=len(CUSTOMERS) + 1,
        name=data.name,
        email=data.email,
        password_hash="hash:" + data.password[::-1],
    )
    CUSTOMERS[customer.id] = customer
    return customer


@app.get("/customers/{customer_id}", response_model=CustomerOut)
def read_customer(customer_id: int) -> CustomerDB:
    if customer_id not in CUSTOMERS:
        raise HTTPException(status_code=404, detail="Customer not found")
    return CUSTOMERS[customer_id]
```

```python wrong id=hash-in-out
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()


class CustomerIn(BaseModel):
    name: str = Field(min_length=1)
    email: str
    password: str = Field(min_length=8)


class CustomerOut(BaseModel):
    id: int
    name: str
    email: str
    password_hash: str


class CustomerDB(CustomerOut):
    pass


CUSTOMERS: dict[int, CustomerDB] = {}


@app.post("/customers", status_code=201, response_model=CustomerOut)
def create_customer(data: CustomerIn) -> CustomerDB:
    customer = CustomerDB(
        id=len(CUSTOMERS) + 1,
        name=data.name,
        email=data.email,
        password_hash="hash:" + data.password[::-1],
    )
    CUSTOMERS[customer.id] = customer
    return customer


@app.get("/customers/{customer_id}", response_model=CustomerOut)
def read_customer(customer_id: int) -> CustomerDB:
    if customer_id not in CUSTOMERS:
        raise HTTPException(status_code=404, detail="Customer not found")
    return CUSTOMERS[customer_id]
```

```python wrong id=get-leaks
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()


class CustomerIn(BaseModel):
    name: str = Field(min_length=1)
    email: str
    password: str = Field(min_length=8)


class CustomerOut(BaseModel):
    id: int
    name: str
    email: str


class CustomerDB(CustomerOut):
    password_hash: str


CUSTOMERS: dict[int, CustomerDB] = {}


@app.post("/customers", status_code=201, response_model=CustomerOut)
def create_customer(data: CustomerIn) -> CustomerDB:
    customer = CustomerDB(
        id=len(CUSTOMERS) + 1,
        name=data.name,
        email=data.email,
        password_hash="hash:" + data.password[::-1],
    )
    CUSTOMERS[customer.id] = customer
    return customer


@app.get("/customers/{customer_id}")
def read_customer(customer_id: int) -> CustomerDB:
    if customer_id not in CUSTOMERS:
        raise HTTPException(status_code=404, detail="Customer not found")
    return CUSTOMERS[customer_id]
```

```http tests
POST /customers
Content-Type: application/json

{"name": "Ann", "email": "ann@shop.ru", "password": "long-secret"}
###
POST /customers
Content-Type: application/json

{"name": "Bob", "email": "bob@shop.ru", "password": "another-one"}
###
GET /customers/1
###
GET /customers/2
###
GET /customers/9
###
POST /customers
Content-Type: application/json

{"name": "Eve", "email": "eve@shop.ru", "password": "short"}
```

## task fa-static-no-leak
```json
{
  "type": "static",
  "title": "Ключ поставщика не уходит наружу",
  "xp": 10,
  "hints": [
    "Раздел «Проверка кода: поле не должно попасть в Out» и раздел «response_model: фильтр на выходе».",
    "Модель SupplierDB содержит api_key, и оба маршрута отдают именно её. Нужна отдельная модель ответа без ключа, указанная в response_model обоих маршрутов.",
    "Шаблон: class SupplierOut(BaseModel): id: int; name: str. В декораторах: response_model=SupplierOut и response_model=list[SupplierOut]."
  ],
  "check": {
    "static": [
      { "rule": "response-model-hides", "field": "api_key", "message": "Модель ответа отдаёт поле api_key: создайте SupplierOut без него и укажите в response_model." },
      { "rule": "pattern", "regex": "response_model\\s*=", "message": "Укажите response_model в декораторах маршрутов: без него обработчик отдаёт запись базы целиком." }
    ]
  },
  "wrong": {
    "key-in-out": "модель ответа SupplierOut тоже содержит поле api_key",
    "no-response-model": "модель ответа не указана, обработчик отдаёт запись SupplierDB целиком"
  }
}
```
Приложение отдаёт данные поставщиков: `GET /suppliers` — список, `GET /suppliers/{supplier_id}` — один поставщик. Записи хранятся как `SupplierDB` с секретным `api_key`, который партнёрам видеть нельзя. Сейчас маршруты отдают запись целиком.

Исправьте код: введите модель `SupplierOut` с полями `id` и `name` и сделайте её моделью ответа обоих маршрутов. Проверка разбирает код и не запускает его.

```python starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class SupplierDB(BaseModel):
    id: int
    name: str
    api_key: str


SUPPLIERS = {
    1: SupplierDB(id=1, name="Acme", api_key="k-111"),
    2: SupplierDB(id=2, name="Borealis", api_key="k-222"),
}


@app.get("/suppliers", response_model=list[SupplierDB])
def list_suppliers():
    return list(SUPPLIERS.values())


@app.get("/suppliers/{supplier_id}", response_model=SupplierDB)
def read_supplier(supplier_id: int):
    if supplier_id not in SUPPLIERS:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return SUPPLIERS[supplier_id]
```

```python solution
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class SupplierOut(BaseModel):
    id: int
    name: str


class SupplierDB(SupplierOut):
    api_key: str


SUPPLIERS = {
    1: SupplierDB(id=1, name="Acme", api_key="k-111"),
    2: SupplierDB(id=2, name="Borealis", api_key="k-222"),
}


@app.get("/suppliers", response_model=list[SupplierOut])
def list_suppliers():
    return list(SUPPLIERS.values())


@app.get("/suppliers/{supplier_id}", response_model=SupplierOut)
def read_supplier(supplier_id: int):
    if supplier_id not in SUPPLIERS:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return SUPPLIERS[supplier_id]
```

```python wrong id=key-in-out
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class SupplierOut(BaseModel):
    id: int
    name: str
    api_key: str


class SupplierDB(SupplierOut):
    pass


SUPPLIERS = {
    1: SupplierDB(id=1, name="Acme", api_key="k-111"),
    2: SupplierDB(id=2, name="Borealis", api_key="k-222"),
}


@app.get("/suppliers", response_model=list[SupplierOut])
def list_suppliers():
    return list(SUPPLIERS.values())


@app.get("/suppliers/{supplier_id}", response_model=SupplierOut)
def read_supplier(supplier_id: int):
    if supplier_id not in SUPPLIERS:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return SUPPLIERS[supplier_id]
```

```python wrong id=no-response-model
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class SupplierOut(BaseModel):
    id: int
    name: str


class SupplierDB(SupplierOut):
    api_key: str


SUPPLIERS = {
    1: SupplierDB(id=1, name="Acme", api_key="k-111"),
    2: SupplierDB(id=2, name="Borealis", api_key="k-222"),
}


@app.get("/suppliers")
def list_suppliers():
    return list(SUPPLIERS.values())


@app.get("/suppliers/{supplier_id}")
def read_supplier(supplier_id: int):
    if supplier_id not in SUPPLIERS:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return SUPPLIERS[supplier_id]
```

## task fa-openapi-products
```json
{
  "type": "openapi",
  "title": "Документация каталога",
  "xp": 15,
  "hints": [
    "Разделы «response_model: фильтр на выходе», «status_code: коды успеха» и «Документация ответов: /openapi.json и responses»: модель ответа и код успеха попадают в /openapi.json, а ответ 404 описывается параметром responses.",
    "Создание — 201 и ProductOut, удаление — 204 с описанным ответом 404, чтение — ProductOut и описанный ответ 404. Ответ 404 описывается параметром responses.",
    "Шаблон: @app.post(\"/products\", status_code=201, response_model=ProductOut); @app.delete(\"/products/{product_id}\", status_code=204, responses={404: {\"description\": \"…\"}})."
  ],
  "check": { "compare": ["responses", "schemas", "params"] },
  "wrong": {
    "no-out-model": "ответы не привязаны к ProductOut, в документации нет описания полей ответа",
    "default-codes": "создание и удаление отвечают кодом 200 вместо 201 и 204"
  }
}
```
У каталога магазина три маршрута, и документация на `/openapi.json` почти пустая. Опишите их так, чтобы она совпала с эталонной.

Нужно:

- `POST /products` — успешный код `201`, модель ответа `ProductOut`;
- `GET /products/{product_id}` — модель ответа `ProductOut`, описан ответ `404` (любое `description`);
- `DELETE /products/{product_id}` — успешный код `204`, описан ответ `404`.

Поведение обработчиков менять не нужно. Идея проверки: проверка читает `/openapi.json` вашего приложения и сравнивает с эталонным наборы кодов ответа, параметры и схемы (имена моделей и их поля).

```python starter
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()


class ProductIn(BaseModel):
    name: str = Field(min_length=1)
    price: float = Field(gt=0)


class ProductOut(ProductIn):
    id: int


PRODUCTS: dict[int, ProductOut] = {1: ProductOut(id=1, name="Lamp", price=40)}


@app.post("/products")
def create_product(data: ProductIn):
    product = ProductOut(id=max(PRODUCTS) + 1, **data.model_dump())
    PRODUCTS[product.id] = product
    return product


@app.get("/products/{product_id}")
def read_product(product_id: int):
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    return PRODUCTS[product_id]


@app.delete("/products/{product_id}")
def delete_product(product_id: int):
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    del PRODUCTS[product_id]
```

```python solution
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()


class ProductIn(BaseModel):
    name: str = Field(min_length=1)
    price: float = Field(gt=0)


class ProductOut(ProductIn):
    id: int


PRODUCTS: dict[int, ProductOut] = {1: ProductOut(id=1, name="Lamp", price=40)}


@app.post("/products", status_code=201, response_model=ProductOut)
def create_product(data: ProductIn):
    product = ProductOut(id=max(PRODUCTS) + 1, **data.model_dump())
    PRODUCTS[product.id] = product
    return product


@app.get("/products/{product_id}", response_model=ProductOut, responses={404: {"description": "Product not found"}})
def read_product(product_id: int):
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    return PRODUCTS[product_id]


@app.delete("/products/{product_id}", status_code=204, responses={404: {"description": "Product not found"}})
def delete_product(product_id: int):
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    del PRODUCTS[product_id]
```

```python wrong id=no-out-model
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()


class ProductIn(BaseModel):
    name: str = Field(min_length=1)
    price: float = Field(gt=0)


class ProductOut(ProductIn):
    id: int


PRODUCTS: dict[int, ProductOut] = {1: ProductOut(id=1, name="Lamp", price=40)}


@app.post("/products", status_code=201)
def create_product(data: ProductIn):
    product = ProductOut(id=max(PRODUCTS) + 1, **data.model_dump())
    PRODUCTS[product.id] = product
    return product


@app.get("/products/{product_id}", responses={404: {"description": "Product not found"}})
def read_product(product_id: int):
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    return PRODUCTS[product_id]


@app.delete("/products/{product_id}", status_code=204, responses={404: {"description": "Product not found"}})
def delete_product(product_id: int):
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    del PRODUCTS[product_id]
```

```python wrong id=default-codes
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()


class ProductIn(BaseModel):
    name: str = Field(min_length=1)
    price: float = Field(gt=0)


class ProductOut(ProductIn):
    id: int


PRODUCTS: dict[int, ProductOut] = {1: ProductOut(id=1, name="Lamp", price=40)}


@app.post("/products", response_model=ProductOut)
def create_product(data: ProductIn):
    product = ProductOut(id=max(PRODUCTS) + 1, **data.model_dump())
    PRODUCTS[product.id] = product
    return product


@app.get("/products/{product_id}", response_model=ProductOut, responses={404: {"description": "Product not found"}})
def read_product(product_id: int):
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    return PRODUCTS[product_id]


@app.delete("/products/{product_id}", responses={404: {"description": "Product not found"}})
def delete_product(product_id: int):
    if product_id not in PRODUCTS:
        raise HTTPException(status_code=404, detail="Product not found")
    del PRODUCTS[product_id]
```

## task fa-exclude-unset
```json
{
  "type": "fastapi",
  "title": "Карточка без лишних полей",
  "xp": 15,
  "hints": [
    "Раздел «Необязательные поля и response_model_exclude_unset»: параметр пишется в декораторе, рядом с response_model.",
    "Маршрут GET /cards/{card_id} должен отдавать только поля, которые были заданы в записи. Нужный параметр — response_model_exclude_unset=True. Для несуществующей карточки — 404.",
    "Шаблон: @app.get(\"/cards/{card_id}\", response_model=Card, response_model_exclude_unset=True); при отсутствии карточки — raise HTTPException(status_code=404, detail=\"Card not found\")."
  ],
  "wrong": {
    "no-exclude": "в ответе есть все поля модели, включая те, что в записи не заданы",
    "exclude-none": "убираются только поля со значением None, а поля со значениями по умолчанию (например, discount) остаются"
  }
}
```
Каталог хранит карточки товаров в словаре `CARDS`. В записи есть только те поля, которые заполнил менеджер: у карточки `1` задан и `discount`, и `description`, у карточки `2` — только название и цена. Маршрут `GET /cards/{card_id}` должен возвращать **только заданные поля**: для карточки `2` ответ `{"title": "Desk", "price": 120.0}`, а для `1` — все четыре поля.

Если карточки нет, ответ `404` с `{"detail": "Card not found"}`. Идея: модель `Card` с полями по умолчанию и параметр маршрута, который убирает незаданные поля.

```python starter
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class Card(BaseModel):
    title: str
    price: float
    discount: int = 0
    description: str | None = None


CARDS = {
    1: {"title": "Lamp", "price": 40, "discount": 10, "description": "Table lamp"},
    2: {"title": "Desk", "price": 120},
}


@app.get("/cards/{card_id}", response_model=Card)
def read_card(card_id: int):
    return CARDS[card_id]
```

```python solution
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class Card(BaseModel):
    title: str
    price: float
    discount: int = 0
    description: str | None = None


CARDS = {
    1: {"title": "Lamp", "price": 40, "discount": 10, "description": "Table lamp"},
    2: {"title": "Desk", "price": 120},
}


@app.get("/cards/{card_id}", response_model=Card, response_model_exclude_unset=True)
def read_card(card_id: int):
    if card_id not in CARDS:
        raise HTTPException(status_code=404, detail="Card not found")
    return CARDS[card_id]
```

```python wrong id=no-exclude
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class Card(BaseModel):
    title: str
    price: float
    discount: int = 0
    description: str | None = None


CARDS = {
    1: {"title": "Lamp", "price": 40, "discount": 10, "description": "Table lamp"},
    2: {"title": "Desk", "price": 120},
}


@app.get("/cards/{card_id}", response_model=Card)
def read_card(card_id: int):
    if card_id not in CARDS:
        raise HTTPException(status_code=404, detail="Card not found")
    return CARDS[card_id]
```

```python wrong id=exclude-none
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class Card(BaseModel):
    title: str
    price: float
    discount: int = 0
    description: str | None = None


CARDS = {
    1: {"title": "Lamp", "price": 40, "discount": 10, "description": "Table lamp"},
    2: {"title": "Desk", "price": 120},
}


@app.get("/cards/{card_id}", response_model=Card, response_model_exclude_none=True)
def read_card(card_id: int):
    if card_id not in CARDS:
        raise HTTPException(status_code=404, detail="Card not found")
    return CARDS[card_id]
```

```http tests
GET /cards/1
###
GET /cards/2
###
GET /cards/9
```
