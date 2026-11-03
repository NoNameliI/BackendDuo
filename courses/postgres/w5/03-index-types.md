# Виды индексов

У «Полки» 200 тысяч клиентов, а характеристики товаров хранятся в `jsonb`. Индекс «по столбцу» помогает не всегда: тип индекса и его состав подбирают под конкретный запрос.

- **B-Tree** — индекс по умолчанию. Работает для `=`, `<`, `>`, `BETWEEN`, `IN` и `ORDER BY`.
- **Hash** — только `=`. Выигрыш перед B-Tree обычно мал, поэтому встречается он редко.
- **GIN** — «обратный» индекс по элементам: ключам и значениям `jsonb`, элементам массива, словам текста. Ускоряет операторы `@>`, `?`, `&&`.

B-Tree тоже бывает разным:

- **составной** `(status, created_at)` работает как телефонный справочник: ищет по первому столбцу или по нескольким первым, но не по второму в отрыве от первого. Сначала ставьте столбцы из условий `=`, затем диапазон или сортировку;
- **частичный** `… WHERE status = 'new'` хранит только нужные строки, поэтому он маленький;
- **по выражению** `(lower(email))` хранит результат функции. Запрос должен содержать то же выражение.

```sql
CREATE INDEX customers_email_lower_idx ON customers (lower(email));
CREATE INDEX orders_new_idx ON orders (created_at) WHERE status = 'new';
CREATE INDEX products_attributes_idx ON products USING gin (attributes);
```

Индекс по столбцу бесполезен, если условие прячет его в функцию или приведение типа: `created_at::date = '2024-03-08'` заставит прочитать всю таблицу. Перепишите такое условие как диапазон по самому столбцу.

`EXPLAIN ANALYZE` выполняет запрос и рядом с оценкой показывает факт: `actual time` — время в миллисекундах, `rows` — сколько строк получено на самом деле, `loops` — сколько раз выполнялся узел. Строка `Rows Removed by Filter: 199999` означает, что база прочитала почти всё ради одной строки. Если оценка `rows` и факт расходятся в десятки раз, обновите статистику командой `ANALYZE`.

## task w5-index-lower-email
```json
{
  "type": "plan",
  "title": "Вход без учёта регистра",
  "xp": 20,
  "check": { "forbidSeqScan": ["customers"], "maxCostRatio": 0.05 },
  "hints": [
    "Запрос сравнивает не `email`, а `lower(email)`. Обычный индекс хранит исходные значения столбца, а не результат функции.",
    "Индекс по выражению: `CREATE INDEX имя ON customers (lower(email));`"
  ]
}
```
Клиенты вводят e-mail при входе в разном регистре: `Client4242@Polka.ru`, `client4242@polka.ru`. Поэтому сайт сравнивает адреса в нижнем регистре. Уникальный индекс по `email` в таблице уже есть, но запрос его не использует. Создайте индекс, после которого PostgreSQL перестанет читать таблицу `customers` целиком, а стоимость плана упадёт хотя бы в 20 раз.

```sql setup
CREATE TABLE customers (
  id int PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  city text NOT NULL
);
INSERT INTO customers
SELECT g,
       'Клиент ' || g,
       CASE WHEN g % 3 = 0 THEN 'Client' || g || '@Polka.ru' ELSE 'client' || g || '@polka.ru' END,
       (ARRAY['Москва', 'Казань', 'Самара', 'Пермь'])[g % 4 + 1]
FROM generate_series(1, 200000) AS g;
```

```sql query
SELECT id, full_name, email
FROM customers
WHERE lower(email) = 'client4242@polka.ru';
```

```sql solution
CREATE INDEX customers_email_lower_idx ON customers (lower(email));
```

## task w5-index-gin-attributes
```json
{
  "type": "plan",
  "title": "Фильтр по характеристикам",
  "xp": 20,
  "check": { "forbidSeqScan": ["products"], "requireIndexOn": ["products"] },
  "hints": [
    "Оператор `@>` («содержит») проверяет, входит ли пара «ключ — значение» в документ. B-Tree по всему столбцу `jsonb` такой поиск не ускорит.",
    "Индекс по ключам и значениям документа: `CREATE INDEX имя ON products USING gin (attributes);`"
  ]
}
```
Фильтр каталога ищет товары по характеристикам. Они хранятся в столбце `attributes` типа `jsonb`, например `{"brand": "brand-17", "color": "синий", "format": "A5"}`. Набор ключей у разных товаров может отличаться, поэтому фильтр пишет условие через `@>`. Создайте индекс, который ускорит этот запрос.

```sql setup
CREATE TABLE products (
  id int PRIMARY KEY,
  name text NOT NULL,
  price numeric(10, 2) NOT NULL,
  attributes jsonb NOT NULL
);
INSERT INTO products
SELECT g,
       'Товар ' || g,
       (g % 5000) / 10.0 + 50,
       jsonb_build_object(
         'brand', 'brand-' || g % 400,
         'color', (ARRAY['белый', 'чёрный', 'синий', 'красный', 'зелёный'])[g % 5 + 1],
         'format', (ARRAY['A4', 'A5', 'A6'])[g % 3 + 1]
       )
FROM generate_series(1, 200000) AS g;
```

```sql query
SELECT id, name, price
FROM products
WHERE attributes @> '{"brand": "brand-17", "format": "A5"}';
```

```sql solution
CREATE INDEX products_attributes_idx ON products USING gin (attributes);
```

## task w5-sargable-date
```json
{
  "type": "plan",
  "title": "Заказы за день",
  "xp": 25,
  "check": { "mode": "query", "forbidSeqScan": ["orders"], "maxCostRatio": 0.05 },
  "hints": [
    "`created_at::date` вычисляется для каждой строки, поэтому индекс по самой `created_at` не подходит. Условие должно сравнивать столбец напрямую.",
    "Сутки — это полуоткрытый диапазон: `created_at >= '2024-03-08' AND created_at < '2024-03-09'`."
  ]
}
```
Отчёт показывает заказы за 8 марта 2024 года. Индекс по `created_at` в таблице есть, но план показывает `Seq Scan`. Перепишите запрос так, чтобы он использовал индекс и вернул те же строки с теми же столбцами `id` и `total`. Новые индексы не создавайте.

```sql setup
CREATE TABLE orders (
  id int PRIMARY KEY,
  customer_id int NOT NULL,
  total numeric(10, 2) NOT NULL,
  created_at timestamp NOT NULL
);
INSERT INTO orders
SELECT g,
       (g * 7919) % 20000 + 1,
       ((g * 37) % 50000) / 10.0 + 99,
       TIMESTAMP '2024-01-01' + g * 3 * INTERVAL '1 minute'
FROM generate_series(1, 200000) AS g;
CREATE INDEX orders_created_at_idx ON orders (created_at);
```

```sql query
SELECT id, total
FROM orders
WHERE created_at::date = DATE '2024-03-08';
```

```sql solution
SELECT id, total
FROM orders
WHERE created_at >= DATE '2024-03-08'
  AND created_at < DATE '2024-03-09';
```

## task w5-partial-index-choice
```json
{
  "type": "choice",
  "title": "Индекс для очереди",
  "xp": 10,
  "options": [
    "`CREATE INDEX ON orders USING hash (status);`",
    "`CREATE INDEX ON orders (created_at) WHERE status = 'new';`",
    "`CREATE INDEX ON orders USING gin (status);`",
    "`CREATE INDEX ON orders (created_at, status);`"
  ],
  "answer": [1],
  "explanation": "Частичный индекс хранит только около двух тысяч новых заказов и уже отсортирован по `created_at`: запрос берёт первые 20 записей индекса и останавливается. Hash находит строки по равенству, но не умеет отдавать их по порядку и хранит все 5 млн строк. GIN для обычного текстового столбца не создать: у него нет класса операторов для `text`, он нужен для `jsonb`, массивов и полнотекстового поиска. В индексе `(created_at, status)` статус стоит вторым: база пойдёт по датам и будет отбрасывать миллионы старых заказов, а сам индекс займёт место под все строки.",
  "hints": ["Запросу нужны две вещи: только новые заказы и порядок по дате. Какой индекс даёт обе и при этом мал?"]
}
```
В таблице `orders` 5 млн строк, статус `new` — примерно у двух тысяч. Очередь менеджеров выполняет запрос ниже, других запросов по статусу нет. Какой индекс подойдёт лучше всего?

```sql
SELECT id, created_at FROM orders
WHERE status = 'new'
ORDER BY created_at
LIMIT 20;
```

## task w5-explain-analyze-read
```json
{
  "type": "choice",
  "title": "Читаем EXPLAIN ANALYZE",
  "xp": 10,
  "options": [
    "Запрос вернул 1000 строк",
    "Запрос выполнялся 5240 миллисекунд",
    "База прочитала всю таблицу ради одной строки: условию не хватает подходящего индекса",
    "Индекс по `email` использован, но статистика устарела"
  ],
  "answer": [2],
  "explanation": "`Seq Scan` и `Rows Removed by Filter: 199999` говорят, что база проверила все 200 000 строк и оставила одну. Индекс по `email` не подошёл: условие сравнивает `lower(email)`, поэтому нужен индекс по выражению. `rows=1000` в первой скобке — оценка планировщика, а реально получена одна строка (`actual … rows=1`). `cost=0.00..5240.00` — условные единицы, а не миллисекунды: время выполнения — 61 мс.",
  "hints": ["Первая скобка — оценка планировщика, вторая — то, что произошло на самом деле."]
}
```
Что показывает этот план?

```text
Seq Scan on customers  (cost=0.00..5240.00 rows=1000 width=40) (actual time=0.052..61.310 rows=1 loops=1)
  Filter: (lower(email) = 'client4242@polka.ru'::text)
  Rows Removed by Filter: 199999
Planning Time: 0.120 ms
Execution Time: 61.402 ms
```
