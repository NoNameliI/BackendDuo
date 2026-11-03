# Ограничения целостности

В «Полке» нашлись два клиента с одним e-mail, позиция заказа на −3 книги и доставка без статуса. Приложение всё это проверяло, но скрипт импорта проверки обошёл. **Ограничения** (constraints) защищают данные на уровне базы: их не обойдёт ни приложение, ни ручной запрос.

- `PRIMARY KEY` — идентификатор строки: уникален и не бывает `NULL`. Может состоять из нескольких столбцов.
- `NOT NULL` — значение обязательно.
- `UNIQUE` — повторы запрещены. `NULL` повтором не считается: сколько угодно клиентов могут не указать телефон.
- `CHECK (условие)` — строка отклоняется, если условие ложно. `NULL` проверку проходит.
- `DEFAULT` — значение для столбца, который не перечислили в `INSERT`. Явно переданный `NULL` оно не заменяет.

```sql
CREATE TABLE order_items (
  order_id   integer NOT NULL,
  product_id integer NOT NULL,
  quantity   integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  PRIMARY KEY (order_id, product_id)
);
```

Если запрос нарушает ограничение, PostgreSQL отменяет его целиком: из ста строк одного `INSERT` не сохранится ни одна. Причину назовёт код ошибки: `23502` — `NOT NULL`, `23505` — `UNIQUE`, `23514` — `CHECK`. Чтобы пропускать дубликаты без ошибки, допишите к `INSERT` конструкцию `ON CONFLICT (столбец) DO NOTHING`.

К готовой таблице ограничения добавляет `ALTER TABLE`. База сначала проверит все строки: если хоть одна нарушает правило, ограничение не появится.

```sql
ALTER TABLE customers ADD CONSTRAINT customers_email_key UNIQUE (email);
ALTER TABLE customers ALTER COLUMN city SET NOT NULL;
ALTER TABLE customers ALTER COLUMN city SET DEFAULT 'Москва';
```

Имя ограничения попадает в текст ошибки, поэтому давайте понятные имена: `таблица_столбец_key` для `UNIQUE`, `таблица_столбец_check` для `CHECK`.

## task w1-customers-constraints
```json
{
  "type": "schema",
  "title": "Клиенты без дублей",
  "xp": 15,
  "hints": [
    "Уникальность пишется в определении столбца: `email text NOT NULL UNIQUE`. Телефон необязателен, поэтому у `phone` есть `UNIQUE`, но нет `NOT NULL`.",
    "Баллы: `bonus integer NOT NULL DEFAULT 0 CHECK (bonus >= 0)`."
  ]
}
```
Создайте таблицу `customers` для клиентов «Полки»:

- `id` — первичный ключ, который база генерирует сама;
- `email` — текст, обязательный и уникальный;
- `full_name` — текст, обязательный;
- `phone` — текст, необязательный, но двух клиентов с одним номером быть не может;
- `bonus` — бонусные баллы, `integer`, обязательные, по умолчанию `0`, не меньше нуля.

```sql starter
CREATE TABLE customers (

);
```

```sql solution
CREATE TABLE customers (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text UNIQUE,
  bonus integer NOT NULL DEFAULT 0 CHECK (bonus >= 0)
);
```

## task w1-default-vs-null
```json
{
  "type": "choice",
  "title": "DEFAULT и явный NULL",
  "xp": 5,
  "options": [
    "Вставит строку со `stock = 0`: сработает `DEFAULT`",
    "Вставит строку со `stock = NULL`",
    "Завершится ошибкой: нарушено ограничение `NOT NULL`",
    "Молча пропустит строку и ничего не вставит"
  ],
  "answer": [2],
  "explanation": "`DEFAULT` подставляется, только когда столбец не перечислили в `INSERT` или вместо значения написали слово `DEFAULT`. Явный `NULL` — это переданное значение, и `NOT NULL` отклонит его с ошибкой `23502`. Поэтому `NULL` в столбце не окажется, а `0` не подставится. Молча пропускать строки PostgreSQL не умеет: так работает только `ON CONFLICT … DO NOTHING`, и только при конфликте уникальности.",
  "hints": ["Подумайте, чем «столбец не указали» отличается от «указали значение `NULL`»."]
}
```
В таблице товаров есть столбец `stock integer NOT NULL DEFAULT 0`. Что сделает запрос?

```sql
INSERT INTO products (name, price, stock)
VALUES ('Линейка', 50, NULL);
```

## task w1-import-customers
```json
{
  "type": "state",
  "title": "Импорт без дублей",
  "xp": 15,
  "dataset": "shop",
  "hints": [
    "Ошибка возникает на повторяющемся `email`. PostgreSQL умеет пропускать конфликтующие строки, не отменяя весь запрос.",
    "Допишите в конец запроса `ON CONFLICT (email) DO NOTHING`."
  ]
}
```
Маркетинг прислал список подписчиков рассылки, чтобы завести их как клиентов. Двое уже есть в базе, поэтому запрос в редакторе падает с ошибкой `23505` и никого не добавляет.

Исправьте запрос: новые клиенты должны добавиться, а данные существующих — остаться прежними, включая город и дату регистрации.

```sql starter
INSERT INTO customers (full_name, email, city, registered_on) VALUES
  ('Ирина Соколова', 'irina@polka.ru', 'Москва', '2024-04-01'),
  ('Анна Смирнова', 'anna@polka.ru', 'Казань', '2024-04-01'),
  ('Кирилл Белов', 'kirill@polka.ru', 'Казань', '2024-04-02'),
  ('Вера Ким', 'vera@polka.ru', 'Сочи', '2024-04-03');
```

```sql solution
INSERT INTO customers (full_name, email, city, registered_on) VALUES
  ('Ирина Соколова', 'irina@polka.ru', 'Москва', '2024-04-01'),
  ('Анна Смирнова', 'anna@polka.ru', 'Казань', '2024-04-01'),
  ('Кирилл Белов', 'kirill@polka.ru', 'Казань', '2024-04-02'),
  ('Вера Ким', 'vera@polka.ru', 'Сочи', '2024-04-03')
ON CONFLICT (email) DO NOTHING;
```

```sql check
SELECT full_name, email, city, registered_on FROM customers;
```

## task w1-deliveries-alter
```json
{
  "type": "schema",
  "title": "Порядок в доставках",
  "xp": 20,
  "hints": [
    "Для `NOT NULL` и `DEFAULT` нужен `ALTER TABLE deliveries ALTER COLUMN …`, для `UNIQUE` и `CHECK` — `ALTER TABLE deliveries ADD CONSTRAINT …`.",
    "Например: `ALTER TABLE deliveries ALTER COLUMN status SET DEFAULT 'new';` и `ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check CHECK (status IN ('new', 'on_the_way', 'delivered'));`"
  ]
}
```
Курьерская служба «Полки» завела таблицу `deliveries` в спешке, без ограничений. Данные в ней корректны. Добавьте правила с помощью `ALTER TABLE`, не пересоздавая таблицу:

- `order_id` — обязателен и уникален: на один заказ одна доставка;
- `status` — обязателен, по умолчанию `'new'`, допустимы только `new`, `on_the_way` и `delivered`;
- `weight_kg` — вес может быть неизвестен, но если указан, то строго больше нуля.

Столбцы `id` и `courier` не меняйте.

```sql setup
CREATE TABLE deliveries (
  id serial PRIMARY KEY,
  order_id integer,
  courier text NOT NULL,
  status text,
  weight_kg numeric(6, 2)
);
INSERT INTO deliveries (order_id, courier, status, weight_kg) VALUES
  (101, 'Илья', 'delivered', 1.20),
  (102, 'Илья', 'on_the_way', 0.45),
  (103, 'Марат', 'new', 3.00),
  (104, 'Марат', 'new', NULL);
```

```sql solution
ALTER TABLE deliveries ALTER COLUMN order_id SET NOT NULL;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_order_id_key UNIQUE (order_id);
ALTER TABLE deliveries ALTER COLUMN status SET NOT NULL;
ALTER TABLE deliveries ALTER COLUMN status SET DEFAULT 'new';
ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check
  CHECK (status IN ('new', 'on_the_way', 'delivered'));
ALTER TABLE deliveries ADD CONSTRAINT deliveries_weight_kg_check CHECK (weight_kg > 0);
```

