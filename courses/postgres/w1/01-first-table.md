# Первая таблица

Интернет-магазин «Полка» продаёт книги и канцелярию. Каталог пока живёт в Excel: менеджеры правят один файл, цены записаны то «1 200», то «1200 руб.», а у одного товара вместо цены стоит «уточнить». Реляционная база такого не допустит: у каждого столбца есть **тип**, а у таблицы — **ограничения**.

**Таблица** — набор строк одинаковой структуры. **Столбец** задаёт имя и тип значения, **строка** — одну запись, например один товар. Столбец также называют колонкой: это слово вы встретите в сообщениях проверки.

```sql
CREATE TABLE products (
  id    serial PRIMARY KEY,       -- номер товара, база выдаёт его сама
  name  text NOT NULL,            -- название обязательно
  price numeric(10, 2) NOT NULL   -- деньги: до 10 цифр, 2 после запятой
);
```

- `PRIMARY KEY` — первичный ключ, уникальный идентификатор строки: двух товаров с одинаковым `id` не будет.
- `NOT NULL` — значение обязательно.
- `CHECK (условие)` — правило, которое база проверяет при каждой вставке и изменении.
- `DEFAULT значение` — что подставить, если значение не указано.

Деньги храните в `numeric`. Типы `real` и `double precision` приближённые: копейки в них «плывут».

## task w1-create-products
```json
{
  "type": "schema",
  "title": "Каталог товаров",
  "xp": 15,
  "hints": [
    "Ограничение цены пишется прямо в определении столбца: `price numeric(10, 2) NOT NULL CHECK (price > 0)`.",
    "Значение по умолчанию: `in_stock boolean NOT NULL DEFAULT true`."
  ]
}
```
Создайте таблицу `products`:

- `id` — первичный ключ, который база генерирует сама;
- `name` — название, текст, обязательно;
- `price` — цена `numeric(10, 2)`, обязательна и строго больше нуля;
- `in_stock` — есть ли товар на складе, `boolean`, обязательно, по умолчанию `true`.

```sql starter
CREATE TABLE products (

);
```

```sql solution
CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price numeric(10, 2) NOT NULL CHECK (price > 0),
  in_stock boolean NOT NULL DEFAULT true
);
```

## task w1-insert-products
```json
{
  "type": "state",
  "title": "Первые товары",
  "xp": 10,
  "hints": [
    "Перечислите столбцы после имени таблицы: `INSERT INTO products (name, price, in_stock) VALUES (…)`.",
    "Несколько строк вставляются одним запросом через запятую: `VALUES (…), (…), (…)`. `id` указывать не нужно."
  ]
}
```
Добавьте в каталог три товара:

| название | цена | на складе |
|---|---|---|
| Блокнот A5 | 249.90 | да |
| Ручка гелевая | 89 | да |
| Атлас мира | 1490 | нет |

```sql setup
CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price numeric(10, 2) NOT NULL CHECK (price > 0),
  in_stock boolean NOT NULL DEFAULT true
);
```

```sql solution
INSERT INTO products (name, price, in_stock) VALUES
  ('Блокнот A5', 249.90, true),
  ('Ручка гелевая', 89, true),
  ('Атлас мира', 1490, false);
```

```sql check
SELECT name, price, in_stock FROM products;
```

## task w1-select-cheap
```json
{
  "type": "result",
  "title": "Недорогое в наличии",
  "xp": 10,
  "check": { "ordered": true },
  "hints": [
    "Два условия соединяются через `AND`: `WHERE in_stock AND price < 500`.",
    "Сортировка по возрастанию — `ORDER BY price`."
  ]
}
```
Маркетологу нужна подборка «до 500 ₽». Выведите `name` и `price` товаров, которые есть на складе и стоят меньше 500 ₽. Сначала самые дешёвые.

```sql setup
CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price numeric(10, 2) NOT NULL CHECK (price > 0),
  in_stock boolean NOT NULL DEFAULT true
);
INSERT INTO products (name, price, in_stock) VALUES
  ('Блокнот A5', 249.90, true),
  ('Ручка гелевая', 89, true),
  ('Атлас мира', 1490, false),
  ('Стикеры', 120, false),
  ('Ежедневник', 690, true),
  ('Карандаш', 35, true);
```

```sql solution
SELECT name, price
FROM products
WHERE in_stock AND price < 500
ORDER BY price;
```

## task w1-money-type
```json
{
  "type": "choice",
  "title": "Тип для денег",
  "xp": 5,
  "options": [
    "real",
    "numeric(10, 2)",
    "text",
    "integer с ценой в рублях"
  ],
  "answer": [1],
  "explanation": "`numeric` хранит десятичные числа точно. `real` приближённый: 0.1 + 0.2 в нём не равно 0.3. В `text` цены нельзя сравнивать и складывать. `integer` годится, только если хранить сумму в копейках (24990): рубли с копейками в него не поместятся.",
  "hints": ["Подумайте, что будет с копейками при сложении сотни цен."]
}
```
Какой тип столбца подходит для цены товара в рублях с копейками?

## task w1-erd-catalog
```json
{
  "type": "schema",
  "ui": "erd",
  "title": "Категории и товары",
  "xp": 20,
  "check": { "tables": ["categories", "products"] },
  "hints": [
    "Добавьте две таблицы кнопкой «+ Таблица». Столбец `id` с PK конструктор создаёт сам.",
    "Для связи нажмите FK у `products.category_id`, а затем выберите `categories.id`. Не забудьте NN."
  ]
}
```
Каталог растёт, и товарам нужны категории. Соберите схему в конструкторе:

- `categories`: `id` — первичный ключ; `name` — текст, обязательный и уникальный;
- `products`: `id` — первичный ключ; `name` — текст, обязательный; `price` — `numeric(10, 2)`, обязательная; `category_id` — обязательная ссылка на `categories.id`.

```sql solution
CREATE TABLE categories (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);
CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price numeric(10, 2) NOT NULL,
  category_id integer NOT NULL REFERENCES categories (id)
);
```
