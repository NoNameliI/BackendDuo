# Источники курса FastAPI

Официальные страницы, на которые опирается содержание уроков. Адреса проверены запросом (ответ 200) 2026-11-14; текст страниц не копируется, задания и примеры написаны заново.

## Мир 0. Мост от Python к FastAPI

### Урок «Аннотации типов, Annotated и Enum» (`w0/01-types-annotated.md`)

- Аннотации и `Annotated`, объединение `|`: https://docs.python.org/3/library/typing.html
- `Enum`: https://docs.python.org/3/library/enum.html
- Типы Python в FastAPI: https://fastapi.tiangolo.com/python-types/
- `Query` и ограничения строковых параметров: https://fastapi.tiangolo.com/tutorial/query-params-str-validations/
- Параметры пути и `Enum`: https://fastapi.tiangolo.com/tutorial/path-params/
- Команда `fastapi dev`: https://fastapi.tiangolo.com/fastapi-cli/

### Урок «Генераторы, yield и менеджеры контекста» (`w0/02-generators-context.md`)

- Выражение `yield`: https://docs.python.org/3/reference/expressions.html
- `contextmanager`: https://docs.python.org/3/library/contextlib.html
- Зависимости с `yield`: https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/

### Урок «Декораторы: как @app.get регистрирует обработчик» (`w0/03-decorators.md`)

- `functools.wraps`: https://docs.python.org/3/library/functools.html
- Термин «декоратор»: https://docs.python.org/3/glossary.html
- Первые шаги: `@app.get`: https://fastapi.tiangolo.com/tutorial/first-steps/

### Урок «async и await: почему нельзя блокировать цикл» (`w0/04-async-await.md`)

- Корутины, `gather`, `sleep`: https://docs.python.org/3/library/asyncio-task.html
- `async def` и `def` в FastAPI: https://fastapi.tiangolo.com/async/
- Виртуальные окружения `venv`: https://docs.python.org/3/library/venv.html

## Мир 1. Основы

### Урок «FastAPI, ASGI и def против async def» (`w1/01-asgi-def-async.md`)

- Обзор: роли Starlette и Pydantic: https://fastapi.tiangolo.com/
- Первые шаги: https://fastapi.tiangolo.com/tutorial/first-steps/
- `def` и `async def`, пул потоков: https://fastapi.tiangolo.com/async/
- `fastapi dev` и `fastapi run`: https://fastapi.tiangolo.com/fastapi-cli/
- ASGI: `scope`, `receive`, `send`: https://asgi.readthedocs.io/
- Запуск сервера `uvicorn`: https://uvicorn.dev/

### Урок «Параметры пути и запроса, проверки» (`w1/02-path-query-validation.md`)

- Параметры пути: https://fastapi.tiangolo.com/tutorial/path-params/
- Параметры запроса: https://fastapi.tiangolo.com/tutorial/query-params/
- Проверки строк и списков в запросе: https://fastapi.tiangolo.com/tutorial/query-params-str-validations/
- Проверки чисел и `Path`: https://fastapi.tiangolo.com/tutorial/path-params-numeric-validations/
- `HTTPException`: https://fastapi.tiangolo.com/tutorial/handling-errors/
- Коды ошибок проверки (`type` в ответе 422): https://docs.pydantic.dev/latest/errors/validation_errors/

### Урок «Enum в пути, порядок маршрутов и пути с косой чертой» (`w1/03-enum-route-order.md`)

- `Enum`, порядок маршрутов, `:path`: https://fastapi.tiangolo.com/tutorial/path-params/
- Модуль `enum`: https://docs.python.org/3/library/enum.html
- Конвертеры путей Starlette: https://starlette.dev/routing/

## Мир 2. Данные и модели

### Урок «Pydantic v2: модели и проверка данных» (`w2/01-pydantic-v2.md`)

- Модели: https://docs.pydantic.dev/latest/concepts/models/
- `Field`: ограничения и алиасы: https://docs.pydantic.dev/latest/concepts/fields/
- `field_validator`, `model_validator`: https://docs.pydantic.dev/latest/concepts/validators/
- `ConfigDict`: https://docs.pydantic.dev/latest/concepts/config/
- `model_dump`, сериализация: https://docs.pydantic.dev/latest/concepts/serialization/
- Переход с v1: что чем заменено: https://docs.pydantic.dev/latest/migration/
- Тело запроса: https://fastapi.tiangolo.com/tutorial/body/
- `Field` в теле: https://fastapi.tiangolo.com/tutorial/body-fields/
- Вложенные модели: https://fastapi.tiangolo.com/tutorial/body-nested-models/

### Урок «Модели In, Out и DB: что принимать и что отдавать» (`w2/02-in-out-models.md`)

- `response_model`, `exclude_unset`: https://fastapi.tiangolo.com/tutorial/response-model/
- Модели In, Out и DB: https://fastapi.tiangolo.com/tutorial/extra-models/
- Коды успеха: 201, 204: https://fastapi.tiangolo.com/tutorial/response-status-code/
- `responses` и документация ответов: https://fastapi.tiangolo.com/advanced/additional-responses/

### Урок «Формы, файлы, заголовки и cookie» (`w2/03-forms-files-headers.md`)

- `Form`: https://fastapi.tiangolo.com/tutorial/request-forms/
- `File` и `UploadFile`: https://fastapi.tiangolo.com/tutorial/request-files/
- `Header`: https://fastapi.tiangolo.com/tutorial/header-params/
- `Cookie`: https://fastapi.tiangolo.com/tutorial/cookie-params/
- Cookie в ответе: https://fastapi.tiangolo.com/advanced/response-cookies/
- Заголовки в ответе: https://fastapi.tiangolo.com/advanced/response-headers/

### Урок «Ошибки и обработчики» (`w2/04-errors-handlers.md`)

- `HTTPException`, `exception_handler`, `RequestValidationError`: https://fastapi.tiangolo.com/tutorial/handling-errors/
- Исключения Starlette: https://starlette.dev/exceptions/

## Мир 3. Структура и зависимости

### Урок «Depends: общие части обработчиков» (`w3/01-depends.md`)

- Зависимости: https://fastapi.tiangolo.com/tutorial/dependencies/
- Классы как зависимости: https://fastapi.tiangolo.com/tutorial/dependencies/classes-as-dependencies/
- Цепочки зависимостей: https://fastapi.tiangolo.com/tutorial/dependencies/sub-dependencies/
- Зависимости с `yield`: https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/

### Урок «APIRouter и структура проекта» (`w3/02-routers-structure.md`)

- `APIRouter`, `include_router`, структура проекта: https://fastapi.tiangolo.com/tutorial/bigger-applications/
- Пакеты и относительные импорты: https://docs.python.org/3/reference/import.html
- Циклические импорты: https://docs.python.org/3/faq/programming.html

### Урок «Lifespan, состояние и настройки» (`w3/03-lifespan-settings.md`)

- `lifespan`: https://fastapi.tiangolo.com/advanced/events/
- Настройки в FastAPI: https://fastapi.tiangolo.com/advanced/settings/
- `BaseSettings`: https://docs.pydantic.dev/latest/concepts/pydantic_settings/
- `asynccontextmanager`: https://docs.python.org/3/library/contextlib.html
- `lru_cache`: https://docs.python.org/3/library/functools.html

### Урок «Middleware, CORS и глобальные зависимости» (`w3/04-middleware-cors.md`)

- Middleware: https://fastapi.tiangolo.com/tutorial/middleware/
- CORS: https://fastapi.tiangolo.com/tutorial/cors/
- Middleware в Starlette: https://starlette.dev/middleware/
- Глобальные зависимости: https://fastapi.tiangolo.com/tutorial/dependencies/global-dependencies/

## Мир 4. База данных

### Урок «SQLAlchemy и сессия» (`w4/01-sqlalchemy-session.md`)

- Быстрый старт ORM: https://docs.sqlalchemy.org/en/20/orm/quickstart.html
- Основы работы с сессией: https://docs.sqlalchemy.org/en/20/orm/session_basics.html
- Движок и строка подключения: https://docs.sqlalchemy.org/en/20/core/engines.html
- SQLite: база в памяти, `StaticPool`, `check_same_thread`: https://docs.sqlalchemy.org/en/20/dialects/sqlite.html
- Запросы `select()`: https://docs.sqlalchemy.org/en/20/orm/queryguide/select.html
- SQL-базы в учебнике FastAPI (там используется SQLModel, в курсе вместо него SQLAlchemy): https://fastapi.tiangolo.com/tutorial/sql-databases/
- Модель ответа `response_model`: https://fastapi.tiangolo.com/tutorial/response-model/

### Урок «CRUD и транзакции» (`w4/02-crud-transactions.md`)

- `add`, `commit`, `refresh`, `delete`, `rollback`: https://docs.sqlalchemy.org/en/20/orm/session_basics.html
- `IntegrityError` и состояние сессии после ошибки: https://docs.sqlalchemy.org/en/20/errors.html
- Обновление через `model_dump(exclude_unset=True)`: https://fastapi.tiangolo.com/tutorial/sql-databases/

### Урок «Связи и проблема N+1» (`w4/03-relations-n-plus-1.md`)

- `relationship`, `back_populates`: https://docs.sqlalchemy.org/en/20/orm/basic_relationships.html
- Ленивая загрузка, `selectinload`, `joinedload`, `unique()`: https://docs.sqlalchemy.org/en/20/orm/queryguide/relationships.html
- Событие `before_cursor_execute`: https://docs.sqlalchemy.org/en/20/core/events.html

### Урок «Пагинация, фильтры и миграции» (`w4/04-pagination-migrations.md`)

- `limit`, `offset`, `order_by`: https://docs.sqlalchemy.org/en/20/orm/queryguide/select.html
- Alembic: `init`, `revision`, `upgrade`, `downgrade`, `current`, `history`: https://alembic.sqlalchemy.org/en/latest/tutorial.html
- Что умеет и чего не умеет автогенерация: https://alembic.sqlalchemy.org/en/latest/autogenerate.html
- Пакетный режим для SQLite: https://alembic.sqlalchemy.org/en/latest/batch.html

## Мир 5. Безопасность

### Урок «Пароли: хеширование и вход» (`w5/01-password-hashing.md`)

- Хеширование паролей, `pwdlib` и Argon2 в учебнике FastAPI: https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/
- `bcrypt`: `hashpw`, `gensalt(rounds=)`, `checkpw`, предел 72 байта: https://pypi.org/project/bcrypt/
- `sha256`: https://docs.python.org/3/library/hashlib.html

### Урок «OAuth2 и JWT: вход по токену» (`w5/02-oauth2-jwt.md`)

- Обзор безопасности: https://fastapi.tiangolo.com/tutorial/security/
- `OAuth2PasswordRequestForm`, `OAuth2PasswordBearer`, `WWW-Authenticate`: https://fastapi.tiangolo.com/tutorial/security/simple-oauth2/
- Выдача и проверка JWT: https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/
- `jwt.encode`, `jwt.decode`, `algorithms`, исключения: https://pyjwt.readthedocs.io/en/stable/usage.html
- Рекомендации по безопасности OAuth 2.0 (RFC 9700, поток «пароль» не рекомендован): https://datatracker.ietf.org/doc/rfc9700/

### Урок «Текущий пользователь, роли и API-ключи» (`w5/03-roles-scopes-api-keys.md`)

- `get_current_user` как зависимость: https://fastapi.tiangolo.com/tutorial/security/get-current-user/
- Scopes (`Security`, `SecurityScopes`), только как идея: https://fastapi.tiangolo.com/advanced/security/oauth2-scopes/
- `APIKeyHeader`: https://fastapi.tiangolo.com/reference/security/
- `hmac.compare_digest`: https://docs.python.org/3/library/hmac.html

### Урок «Безопасные модели и типичные уязвимости» (`w5/04-safe-models-vulns.md`)

- OWASP API Security Top 10 (2023): https://api-security.owasp.org/editions/2023/en/0x11-t10/
- `response_model`: https://fastapi.tiangolo.com/tutorial/response-model/
- `ConfigDict(extra="forbid")`: https://docs.pydantic.dev/latest/api/config/

## Мир 7. Тестирование и качество

### Урок «Тесты: pytest и TestClient» (`w7/01-pytest-testclient.md`)

- TestClient, запросы, ответ: https://fastapi.tiangolo.com/tutorial/testing/
- Lifespan в тестах (`with TestClient(app)`): https://fastapi.tiangolo.com/advanced/testing-events/
- Подмена зависимостей (`dependency_overrides`): https://fastapi.tiangolo.com/advanced/testing-dependencies/
- Роутеры и `include_router`: https://fastapi.tiangolo.com/tutorial/bigger-applications/
- Теги, `summary`, коды ответов: https://fastapi.tiangolo.com/tutorial/path-operation-configuration/
- Метаданные и документация: https://fastapi.tiangolo.com/tutorial/metadata/
- `operation_id`: https://fastapi.tiangolo.com/advanced/path-operation-advanced-configuration/
- Дополнительные ответы (`responses`): https://fastapi.tiangolo.com/advanced/additional-responses/
- `async def` и `def`, блокирующие вызовы: https://fastapi.tiangolo.com/async/
- pytest, фикстуры и `conftest.py`: https://docs.pytest.org/en/stable/how-to/fixtures.html
- pytest, `parametrize`: https://docs.pytest.org/en/stable/how-to/parametrize.html
- pytest, `assert`: https://docs.pytest.org/en/stable/how-to/assert.html
