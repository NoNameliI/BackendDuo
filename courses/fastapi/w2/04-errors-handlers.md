# Ошибки и обработчики

Клиент магазина просит заказ, которого нет, присылает пустое имя или повторяет запрос слишком часто. Каждый раз сервер должен ответить понятно: правильным кодом, сообщением и, если нужно, заголовком. Если ошибки отдаются как попало, фронтенд-разработчики пишут десяток особых случаев. В этом уроке вы научитесь отвечать ошибками осознанно и приводить их к одному формату.

### HTTPException: ошибка с кодом

`HTTPException` прерывает работу обработчика и отправляет клиенту ответ-ошибку. Код после `raise` не выполняется.

```python
from fastapi import HTTPException

raise HTTPException(status_code=404, detail="Текст", headers={"Имя": "значение"})
```

- `status_code` — код ответа: `400` — запрос неверен, `401` — не представились, `403` — нет прав, `404` — не найдено, `409` — конфликт с текущим состоянием, `410` — данные удалены навсегда, `429` — слишком много запросов, `503` — сервис временно недоступен.
- `detail` — то, что попадёт в тело ответа как `{"detail": ...}`. Это может быть строка, словарь или список: всё, что превращается в JSON.
- `headers` — необязательный словарь заголовков ответа. Они нужны не для красоты: `401` сопровождают `WWW-Authenticate: Bearer`, а `429` и `503` — `Retry-After: секунды`, чтобы клиент знал, когда повторить.
- `raise`, а не `return`: ошибку именно «бросают»; `return HTTPException(...)` ничего не сделает.

```python example
from fastapi import FastAPI, HTTPException

app = FastAPI()
CARDS = {"G-100": 500, "G-200": 0}
MAINTENANCE = True


@app.get("/gift-cards/{code}")
def read_card(code: str):
    if code not in CARDS:
        raise HTTPException(status_code=404, detail={"code": "unknown_card", "card": code})
    return {"code": code, "balance": CARDS[code]}


@app.get("/reports/sales")
def sales_report():
    if MAINTENANCE:
        raise HTTPException(
            status_code=503,
            detail="Report is being rebuilt",
            headers={"Retry-After": "120"},
        )
    return {"total": 1000}
###
GET /gift-cards/G-100
###
GET /gift-cards/X-1
###
GET /reports/sales
```

Первый запрос: `200` и `{"code": "G-100", "balance": 500}`. Второй: `404` и `{"detail": {"code": "unknown_card", "card": "X-1"}}`: детали стали словарём. Третий: `503`, тело `{"detail": "Report is being rebuilt"}` и заголовок `retry-after: 120`.

### Свои исключения и @app.exception_handler

В большой программе не стоит бросать `HTTPException` из каждой функции: код бизнес-логики не должен знать про HTTP. Лучше бросить своё исключение, а в одном месте объяснить, как его превращать в ответ.

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class МояОшибка(Exception):
    def __init__(self, поле: str) -> None:
        self.поле = поле


app = FastAPI()


@app.exception_handler(МояОшибка)
async def обработчик(request: Request, exc: МояОшибка):
    return JSONResponse(status_code=409, content={"error": "my_error", "поле": exc.поле})
```

- `class МояОшибка(Exception)` — обычный класс исключения. В `__init__` складывают данные, которые понадобятся в ответе.
- `@app.exception_handler(МояОшибка)` — «если из обработчика маршрута вылетело `МояОшибка`, вызови эту функцию».
- Обработчик принимает два параметра: `request` (запрос, `Request` из `fastapi`) и `exc` (само исключение с его полями).
- Он **возвращает** ответ: `JSONResponse` из `fastapi.responses` принимает `status_code` и `content` (словарь для JSON).
- Исключение бросают обычным `raise МояОшибка("...")` в любом месте, даже в функции, которую вызывает обработчик маршрута.

Пример: платёж отклонён, и клиент должен получить `402` с причиной.

```python example
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()


class PaymentDeclined(Exception):
    def __init__(self, reason: str) -> None:
        self.reason = reason


@app.exception_handler(PaymentDeclined)
async def payment_declined_handler(request: Request, exc: PaymentDeclined):
    return JSONResponse(status_code=402, content={"error": "payment_declined", "reason": exc.reason})


def charge(card: str, amount: float) -> None:
    if amount > 1000:
        raise PaymentDeclined("limit exceeded")


@app.post("/pay/{card}")
def pay(card: str, amount: float):
    charge(card, amount)
    return {"paid": amount}
###
POST /pay/c1?amount=300
###
POST /pay/c1?amount=5000
```

Первый платёж: `200` и `{"paid": 300.0}`. Второй: функция `charge` бросила исключение, и клиент получил `402` и `{"error": "payment_declined", "reason": "limit exceeded"}`. Заметьте: `charge` ничего не знает про HTTP.

### RequestValidationError: свой формат ошибок проверки

Когда данные запроса не проходят проверку, FastAPI бросает `RequestValidationError` и отвечает `422` со списком `detail`. Если фронтенд ждёт другой формат, обработчик этого исключения можно заменить.

```python
from fastapi.exceptions import RequestValidationError


@app.exception_handler(RequestValidationError)
async def обработчик(request: Request, exc: RequestValidationError):
    ...
```

- `RequestValidationError` — из `fastapi.exceptions`.
- `exc.errors()` — список ошибок, тот самый, что обычно лежит в `detail`. У каждой ошибки есть `loc` (путь: `["body", "qty"]`), `msg` (описание) и `type` (код).
- В `loc` первый элемент — откуда пришло значение (`body`, `query`, `path`, `header`), дальше имена полей и индексы. Для ответа его часто отбрасывают: `loc[1:]`.
- Не кладите `exc.errors()` в ответ целиком: внутри могут быть объекты, которые не превращаются в JSON. Собирайте свой словарь из `loc` и `msg`.

Ещё одна деталь. Ошибки «маршрута нет» (`404`) и «метод не тот» (`405`) бросает Starlette под капотом. Чтобы поймать и их, обработчик регистрируют для `StarletteHTTPException` (`from starlette.exceptions import HTTPException as StarletteHTTPException`). Исключение FastAPI `HTTPException` — его наследник, поэтому такой обработчик увидит и ошибки, брошенные вашим кодом.

```python example
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

app = FastAPI()


class Review(BaseModel):
    author: str = Field(min_length=2)
    rating: int = Field(ge=1, le=5)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    problems = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"error": "invalid_request", "problems": problems})


@app.exception_handler(StarletteHTTPException)
async def http_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": "http_error", "message": str(exc.detail)})


@app.post("/reviews", status_code=201)
def add_review(review: Review):
    return review
###
POST /reviews
Content-Type: application/json

{"author": "A", "rating": 9}
###
GET /nothing
```

Первый запрос: `422` и `{"error": "invalid_request", "problems": [{"field": "author", "message": "String should have at least 2 characters"}, {"field": "rating", "message": "Input should be less than or equal to 5"}]}`. Второй запрос тоже получил наш формат: `404` и `{"error": "http_error", "message": "Not Found"}`.

### Чего избегать

- `200` с ошибкой в теле: `return {"status": "error"}`. Клиент, прокси и мониторинг смотрят на код, и для них всё прошло хорошо.
- `except Exception: pass` и `return None`. Ошибка пропадает, а на следующем шаге падает что-то другое. Перехватывайте конкретные исключения и отвечайте по делу.
- Утечка внутренностей: `detail=str(exc)` или трассировка в ответе показывают клиенту устройство сервера. Подробности пишут в журнал, а клиенту отдают короткое понятное сообщение.
- Неподходящий код: `404` для «неверный пароль» или `400` для «не найдено». Код — часть контракта.
- Разные форматы ошибок в разных маршрутах. Договоритесь об одном и соберите его в обработчиках.
- `HTTPException` внутри бизнес-логики. Функция расчёта цены не должна знать про HTTP: пусть бросает своё исключение.

### Частые ошибки

- `return` вместо `raise`. Неверно: `return HTTPException(404, "...")` — клиент получит `200` со странным телом. Верно: `raise HTTPException(status_code=404, detail="...")`.
- Обработчик не возвращает ответ. Неверно: `async def handler(request, exc): print(exc)`. Верно: `return JSONResponse(status_code=..., content=...)`.
- Обработчик для неподходящего исключения. Неверно: `@app.exception_handler(ValueError)`, когда клиенту нужно переопределить ответ проверки. Верно: `RequestValidationError` из `fastapi.exceptions`.
- Забыт параметр `request`. Неверно: `async def handler(exc): ...`. Верно: `async def handler(request: Request, exc: МояОшибка)`: FastAPI вызывает обработчик с двумя аргументами.
- Заголовки не те. Неверно: `headers=["Retry-After", "120"]`. Верно: `headers={"Retry-After": "120"}` — словарь.

### Шпаргалка

- `raise HTTPException(status_code=, detail=, headers={...})`; `detail` — строка или словарь.
- `401` + `WWW-Authenticate`, `429`/`503` + `Retry-After`.
- Своё исключение: `class E(Exception)`; `@app.exception_handler(E)`; `async def h(request: Request, exc: E): return JSONResponse(status_code=, content={...})`.
- Проверка запроса: `RequestValidationError` из `fastapi.exceptions`; `exc.errors()` → `loc`, `msg`, `type`; `loc[1:]` без источника.
- Для `404`/`405` без своего кода: `StarletteHTTPException` из `starlette.exceptions`.
- Не отдавайте `200` с ошибкой, не глотайте `Exception`, не показывайте `str(exc)` клиенту.

## task fa-admin-errors
```json
{
  "type": "fastapi",
  "title": "Закрытая статистика и купоны",
  "xp": 15,
  "hints": [
    "Раздел «HTTPException: ошибка с кодом»: код, detail и заголовки задаются в одном raise.",
    "Для статистики нужен заголовок запроса X-Admin-Token (параметр x_admin_token) и ответ 401 с WWW-Authenticate: Bearer. Для купона — 404, если кода нет, и 410, если он просрочен.",
    "Шаблон: raise HTTPException(status_code=401, detail=\"Invalid admin token\", headers={\"WWW-Authenticate\": \"Bearer\"}); coupon = COUPONS.get(code); if coupon is None: raise HTTPException(status_code=404, detail=…)."
  ],
  "check": { "headers": ["www-authenticate"] },
  "wrong": {
    "no-header": "ответ 401 отправлен без заголовка WWW-Authenticate",
    "same-code": "просроченный купон получает 404, как и несуществующий, вместо 410"
  }
}
```
Магазин открывает два маршрута.

- `GET /admin/stats` отдаёт `{"orders": 42}`, но только если в заголовке `X-Admin-Token` значение `s3cret`. Без заголовка или с другим значением — `401`, тело `{"detail": "Invalid admin token"}` и заголовок `WWW-Authenticate: Bearer`.
- `POST /coupons/{code}/use` «использует» купон. Если кода нет в словаре `COUPONS` — `404` и `{"detail": "Coupon not found"}`. Если значение купона `"expired"` — `410` и `{"detail": "Coupon expired"}`. Иначе `200` и `{"code": код, "discount": скидка}`.

Заготовка отдаёт данные всем и не знает про ошибки. Проверка сравнивает ещё и заголовок `WWW-Authenticate`.

```python starter
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException

app = FastAPI()
COUPONS = {"SPRING": 15, "OLD": "expired"}


@app.get("/admin/stats")
def admin_stats(x_admin_token: Annotated[str | None, Header()] = None):
    return {"orders": 42}


@app.post("/coupons/{code}/use")
def use_coupon(code: str):
    return {"code": code, "discount": COUPONS.get(code)}
```

```python solution
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException

app = FastAPI()
COUPONS = {"SPRING": 15, "OLD": "expired"}


@app.get("/admin/stats")
def admin_stats(x_admin_token: Annotated[str | None, Header()] = None):
    if x_admin_token != "s3cret":
        raise HTTPException(status_code=401, detail="Invalid admin token", headers={"WWW-Authenticate": "Bearer"})
    return {"orders": 42}


@app.post("/coupons/{code}/use")
def use_coupon(code: str):
    discount = COUPONS.get(code)
    if discount is None:
        raise HTTPException(status_code=404, detail="Coupon not found")
    if discount == "expired":
        raise HTTPException(status_code=410, detail="Coupon expired")
    return {"code": code, "discount": discount}
```

```python wrong id=no-header
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException

app = FastAPI()
COUPONS = {"SPRING": 15, "OLD": "expired"}


@app.get("/admin/stats")
def admin_stats(x_admin_token: Annotated[str | None, Header()] = None):
    if x_admin_token != "s3cret":
        raise HTTPException(status_code=401, detail="Invalid admin token")
    return {"orders": 42}


@app.post("/coupons/{code}/use")
def use_coupon(code: str):
    discount = COUPONS.get(code)
    if discount is None:
        raise HTTPException(status_code=404, detail="Coupon not found")
    if discount == "expired":
        raise HTTPException(status_code=410, detail="Coupon expired")
    return {"code": code, "discount": discount}
```

```python wrong id=same-code
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException

app = FastAPI()
COUPONS = {"SPRING": 15, "OLD": "expired"}


@app.get("/admin/stats")
def admin_stats(x_admin_token: Annotated[str | None, Header()] = None):
    if x_admin_token != "s3cret":
        raise HTTPException(status_code=401, detail="Invalid admin token", headers={"WWW-Authenticate": "Bearer"})
    return {"orders": 42}


@app.post("/coupons/{code}/use")
def use_coupon(code: str):
    discount = COUPONS.get(code)
    if discount is None or discount == "expired":
        raise HTTPException(status_code=404, detail="Coupon not found")
    return {"code": code, "discount": discount}
```

```http tests
GET /admin/stats
X-Admin-Token: s3cret
###
GET /admin/stats
###
GET /admin/stats
X-Admin-Token: guess
###
POST /coupons/SPRING/use
###
POST /coupons/NOPE/use
###
POST /coupons/OLD/use
```

## task fa-stock-handler
```json
{
  "type": "fastapi",
  "title": "Нет на складе: свой обработчик",
  "xp": 15,
  "hints": [
    "Раздел «Свои исключения и @app.exception_handler»: обработчик регистрируется для класса исключения и возвращает JSONResponse.",
    "Маршрут уже бросает OutOfStock, но обработчика нет, поэтому клиент видит 500. Нужен обработчик с кодом 409 и телом из полей исключения.",
    "Шаблон: @app.exception_handler(OutOfStock) async def out_of_stock_handler(request: Request, exc: OutOfStock): return JSONResponse(status_code=409, content={\"error\": \"out_of_stock\", \"sku\": exc.sku, \"available\": exc.available})."
  ],
  "wrong": {
    "wrong-code": "обработчик отвечает кодом 400 вместо 409",
    "no-details": "в ответе нет полей sku и available, клиент не узнает, сколько осталось"
  }
}
```
Маршрут `POST /cart/add` принимает `{"sku": "...", "qty": целое ≥ 1}`. Если товара на складе хватает, ответ `200` и `{"sku": ..., "added": qty}`. Если не хватает, код бросает исключение `OutOfStock`, а клиент должен получить `409` и `{"error": "out_of_stock", "sku": ..., "available": сколько_осталось}`. Неизвестный товар — `404` и `{"detail": "Unknown sku"}`; плохие данные — `422`, как обычно.

Исключение и маршрут уже написаны. Не хватает обработчика исключения.

```python starter
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()
STOCK = {"PEN": 10, "BOOK": 2}


class OutOfStock(Exception):
    def __init__(self, sku: str, available: int) -> None:
        self.sku = sku
        self.available = available


class CartItem(BaseModel):
    sku: str
    qty: int = Field(ge=1)


# добавьте обработчик исключения OutOfStock


@app.post("/cart/add")
def add_to_cart(item: CartItem):
    if item.sku not in STOCK:
        raise HTTPException(status_code=404, detail="Unknown sku")
    if item.qty > STOCK[item.sku]:
        raise OutOfStock(item.sku, STOCK[item.sku])
    return {"sku": item.sku, "added": item.qty}
```

```python solution
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()
STOCK = {"PEN": 10, "BOOK": 2}


class OutOfStock(Exception):
    def __init__(self, sku: str, available: int) -> None:
        self.sku = sku
        self.available = available


class CartItem(BaseModel):
    sku: str
    qty: int = Field(ge=1)


@app.exception_handler(OutOfStock)
async def out_of_stock_handler(request: Request, exc: OutOfStock):
    return JSONResponse(
        status_code=409,
        content={"error": "out_of_stock", "sku": exc.sku, "available": exc.available},
    )


@app.post("/cart/add")
def add_to_cart(item: CartItem):
    if item.sku not in STOCK:
        raise HTTPException(status_code=404, detail="Unknown sku")
    if item.qty > STOCK[item.sku]:
        raise OutOfStock(item.sku, STOCK[item.sku])
    return {"sku": item.sku, "added": item.qty}
```

```python wrong id=wrong-code
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()
STOCK = {"PEN": 10, "BOOK": 2}


class OutOfStock(Exception):
    def __init__(self, sku: str, available: int) -> None:
        self.sku = sku
        self.available = available


class CartItem(BaseModel):
    sku: str
    qty: int = Field(ge=1)


@app.exception_handler(OutOfStock)
async def out_of_stock_handler(request: Request, exc: OutOfStock):
    return JSONResponse(
        status_code=400,
        content={"error": "out_of_stock", "sku": exc.sku, "available": exc.available},
    )


@app.post("/cart/add")
def add_to_cart(item: CartItem):
    if item.sku not in STOCK:
        raise HTTPException(status_code=404, detail="Unknown sku")
    if item.qty > STOCK[item.sku]:
        raise OutOfStock(item.sku, STOCK[item.sku])
    return {"sku": item.sku, "added": item.qty}
```

```python wrong id=no-details
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()
STOCK = {"PEN": 10, "BOOK": 2}


class OutOfStock(Exception):
    def __init__(self, sku: str, available: int) -> None:
        self.sku = sku
        self.available = available


class CartItem(BaseModel):
    sku: str
    qty: int = Field(ge=1)


@app.exception_handler(OutOfStock)
async def out_of_stock_handler(request: Request, exc: OutOfStock):
    return JSONResponse(status_code=409, content={"error": "out_of_stock"})


@app.post("/cart/add")
def add_to_cart(item: CartItem):
    if item.sku not in STOCK:
        raise HTTPException(status_code=404, detail="Unknown sku")
    if item.qty > STOCK[item.sku]:
        raise OutOfStock(item.sku, STOCK[item.sku])
    return {"sku": item.sku, "added": item.qty}
```

```http tests
POST /cart/add
Content-Type: application/json

{"sku": "PEN", "qty": 3}
###
POST /cart/add
Content-Type: application/json

{"sku": "BOOK", "qty": 5}
###
POST /cart/add
Content-Type: application/json

{"sku": "LAMP", "qty": 1}
###
POST /cart/add
Content-Type: application/json

{"sku": "PEN", "qty": 0}
```

## task fa-fix-validation-format
```json
{
  "type": "fix-bug",
  "title": "Свой формат ошибок не срабатывает",
  "xp": 20,
  "hints": [
    "Раздел «RequestValidationError: свой формат ошибок проверки»: ошибки запроса ловит обработчик для RequestValidationError, а в loc первый элемент — источник данных.",
    "Ошибок две. Обработчик зарегистрирован для ValueError, поэтому не вызывается и клиент видит обычный ответ 422. И в поле field попадает весь путь, включая «body».",
    "Шаблон: from fastapi.exceptions import RequestValidationError; @app.exception_handler(RequestValidationError); \".\".join(str(part) for part in error[\"loc\"][1:])."
  ],
  "wrong": {
    "wrong-class": "формат собран верно, но обработчик зарегистрирован для ValueError и не вызывается: клиент видит обычный ответ 422",
    "with-body": "обработчик вызывается, но в поле field остаётся «body.», путь начинается с источника"
  }
}
```
Фронтенд магазина ждёт, что при неверных данных ответ будет таким: код `400` и тело

```json
{"error": "bad_request", "fields": [{"field": "address.city", "message": "Field required"}]}
```

Здесь `field` — путь к полю **без** слова `body` (источника данных), а `message` — описание ошибки. Для `POST /checkout` с телом `{"email": "...", "address": {"city": "..."}}` приложение отвечает обычным `422`. Исправьте код так, чтобы формат стал таким, как описано. Остальное поведение (`201` при верных данных) не меняйте.

```python starter
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()


class Address(BaseModel):
    city: str = Field(min_length=1)
    street: str = ""


class Checkout(BaseModel):
    email: str = Field(min_length=3)
    address: Address


@app.exception_handler(ValueError)
async def bad_request_handler(request: Request, exc: ValueError):
    fields = [
        {"field": ".".join(str(part) for part in error["loc"]), "message": error["msg"]}
        for error in exc.errors()
    ]
    return JSONResponse(status_code=400, content={"error": "bad_request", "fields": fields})


@app.post("/checkout", status_code=201)
def checkout(data: Checkout):
    return {"email": data.email, "city": data.address.city}
```

```python solution
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()


class Address(BaseModel):
    city: str = Field(min_length=1)
    street: str = ""


class Checkout(BaseModel):
    email: str = Field(min_length=3)
    address: Address


@app.exception_handler(RequestValidationError)
async def bad_request_handler(request: Request, exc: RequestValidationError):
    fields = [
        {"field": ".".join(str(part) for part in error["loc"][1:]), "message": error["msg"]}
        for error in exc.errors()
    ]
    return JSONResponse(status_code=400, content={"error": "bad_request", "fields": fields})


@app.post("/checkout", status_code=201)
def checkout(data: Checkout):
    return {"email": data.email, "city": data.address.city}
```

```python wrong id=wrong-class
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()


class Address(BaseModel):
    city: str = Field(min_length=1)
    street: str = ""


class Checkout(BaseModel):
    email: str = Field(min_length=3)
    address: Address


@app.exception_handler(ValueError)
async def bad_request_handler(request: Request, exc: ValueError):
    fields = [
        {"field": ".".join(str(part) for part in error["loc"][1:]), "message": error["msg"]}
        for error in exc.errors()
    ]
    return JSONResponse(status_code=400, content={"error": "bad_request", "fields": fields})


@app.post("/checkout", status_code=201)
def checkout(data: Checkout):
    return {"email": data.email, "city": data.address.city}
```

```python wrong id=with-body
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

app = FastAPI()


class Address(BaseModel):
    city: str = Field(min_length=1)
    street: str = ""


class Checkout(BaseModel):
    email: str = Field(min_length=3)
    address: Address


@app.exception_handler(RequestValidationError)
async def bad_request_handler(request: Request, exc: RequestValidationError):
    fields = [
        {"field": ".".join(str(part) for part in error["loc"]), "message": error["msg"]}
        for error in exc.errors()
    ]
    return JSONResponse(status_code=400, content={"error": "bad_request", "fields": fields})


@app.post("/checkout", status_code=201)
def checkout(data: Checkout):
    return {"email": data.email, "city": data.address.city}
```

```http tests
POST /checkout
Content-Type: application/json

{"email": "ann@shop.ru", "address": {"city": "Kazan"}}
###
POST /checkout
Content-Type: application/json

{"email": "ann@shop.ru", "address": {}}
###
POST /checkout
Content-Type: application/json

{"email": "a", "address": {"city": ""}}
###
POST /checkout
Content-Type: application/json

{"address": {"city": "Kazan"}}
```

## task fa-refactor-not-found
```json
{
  "type": "refactor",
  "title": "Единая ошибка «не найдено»",
  "xp": 20,
  "hints": [
    "Разделы «Свои исключения и @app.exception_handler» и «Чего избегать»: бизнес-логика бросает своё исключение, а ответ собирается в одном месте.",
    "Создайте класс NotFound(Exception) с полем what, один обработчик с кодом 404 и телом {\"error\": \"not_found\", \"what\": ...}, а в трёх маршрутах замените return JSONResponse(...) на raise NotFound(\"…\").",
    "Шаблон: class NotFound(Exception): def __init__(self, what: str) -> None: self.what = what; @app.exception_handler(NotFound) async def …(request: Request, exc: NotFound): return JSONResponse(status_code=404, content={\"error\": \"not_found\", \"what\": exc.what}); в маршруте: raise NotFound(\"order\")."
  ],
  "check": {
    "static": [
      { "rule": "uses", "name": "exception_handler", "message": "Зарегистрируйте обработчик своего исключения через @app.exception_handler." },
      { "rule": "pattern", "regex": "raise NotFound\\(", "message": "Маршруты должны бросать исключение: raise NotFound(...), а не возвращать JSONResponse." }
    ]
  },
  "wrong": {
    "unchanged": "маршруты по-прежнему сами собирают ответ 404, исключения нет",
    "http-exception": "используется HTTPException с detail, поэтому формат ответа изменился: вместо error и what приходит detail"
  }
}
```
В коде три маршрута, и каждый сам собирает один и тот же ответ `404`: `{"error": "not_found", "what": "order"}` (для заказа), `"product"` (для товара) и `"customer"` (для покупателя). Повторять это в каждом маршруте неудобно: формат придётся менять в трёх местах.

Вынесите ответ в одно место: сделайте исключение `NotFound` с полем `what` и обработчик, а маршруты пусть бросают `raise NotFound("...")`. Ответы всех маршрутов не должны измениться, а проверка кода убедится, что обработчик есть и исключение используется.

```python starter
from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI()
ORDERS = {1: "pen set"}
PRODUCTS = {1: "Lamp"}
CUSTOMERS = {1: "Ann"}


@app.get("/orders/{order_id}")
def read_order(order_id: int):
    if order_id not in ORDERS:
        return JSONResponse(status_code=404, content={"error": "not_found", "what": "order"})
    return {"id": order_id, "items": ORDERS[order_id]}


@app.get("/products/{product_id}")
def read_product(product_id: int):
    if product_id not in PRODUCTS:
        return JSONResponse(status_code=404, content={"error": "not_found", "what": "product"})
    return {"id": product_id, "title": PRODUCTS[product_id]}


@app.get("/customers/{customer_id}")
def read_customer(customer_id: int):
    if customer_id not in CUSTOMERS:
        return JSONResponse(status_code=404, content={"error": "not_found", "what": "customer"})
    return {"id": customer_id, "name": CUSTOMERS[customer_id]}
```

```python solution
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()
ORDERS = {1: "pen set"}
PRODUCTS = {1: "Lamp"}
CUSTOMERS = {1: "Ann"}


class NotFound(Exception):
    def __init__(self, what: str) -> None:
        self.what = what


@app.exception_handler(NotFound)
async def not_found_handler(request: Request, exc: NotFound):
    return JSONResponse(status_code=404, content={"error": "not_found", "what": exc.what})


@app.get("/orders/{order_id}")
def read_order(order_id: int):
    if order_id not in ORDERS:
        raise NotFound("order")
    return {"id": order_id, "items": ORDERS[order_id]}


@app.get("/products/{product_id}")
def read_product(product_id: int):
    if product_id not in PRODUCTS:
        raise NotFound("product")
    return {"id": product_id, "title": PRODUCTS[product_id]}


@app.get("/customers/{customer_id}")
def read_customer(customer_id: int):
    if customer_id not in CUSTOMERS:
        raise NotFound("customer")
    return {"id": customer_id, "name": CUSTOMERS[customer_id]}
```

```python wrong id=unchanged
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()
ORDERS = {1: "pen set"}
PRODUCTS = {1: "Lamp"}
CUSTOMERS = {1: "Ann"}


class NotFound(Exception):
    def __init__(self, what: str) -> None:
        self.what = what


@app.exception_handler(NotFound)
async def not_found_handler(request: Request, exc: NotFound):
    return JSONResponse(status_code=404, content={"error": "not_found", "what": exc.what})


@app.get("/orders/{order_id}")
def read_order(order_id: int):
    if order_id not in ORDERS:
        return JSONResponse(status_code=404, content={"error": "not_found", "what": "order"})
    return {"id": order_id, "items": ORDERS[order_id]}


@app.get("/products/{product_id}")
def read_product(product_id: int):
    if product_id not in PRODUCTS:
        return JSONResponse(status_code=404, content={"error": "not_found", "what": "product"})
    return {"id": product_id, "title": PRODUCTS[product_id]}


@app.get("/customers/{customer_id}")
def read_customer(customer_id: int):
    if customer_id not in CUSTOMERS:
        return JSONResponse(status_code=404, content={"error": "not_found", "what": "customer"})
    return {"id": customer_id, "name": CUSTOMERS[customer_id]}
```

```python wrong id=http-exception
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

app = FastAPI()
ORDERS = {1: "pen set"}
PRODUCTS = {1: "Lamp"}
CUSTOMERS = {1: "Ann"}


class NotFound(Exception):
    def __init__(self, what: str) -> None:
        self.what = what


@app.exception_handler(NotFound)
async def not_found_handler(request: Request, exc: NotFound):
    return JSONResponse(status_code=404, content={"error": "not_found", "what": exc.what})


@app.get("/orders/{order_id}")
def read_order(order_id: int):
    if order_id not in ORDERS:
        raise HTTPException(status_code=404, detail="order")
    return {"id": order_id, "items": ORDERS[order_id]}


@app.get("/products/{product_id}")
def read_product(product_id: int):
    if product_id not in PRODUCTS:
        raise NotFound("product")
    return {"id": product_id, "title": PRODUCTS[product_id]}


@app.get("/customers/{customer_id}")
def read_customer(customer_id: int):
    if customer_id not in CUSTOMERS:
        raise NotFound("customer")
    return {"id": customer_id, "name": CUSTOMERS[customer_id]}
```

```http tests
GET /orders/1
###
GET /orders/9
###
GET /products/1
###
GET /products/9
###
GET /customers/1
###
GET /customers/9
```
