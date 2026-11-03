# Нормализация

Первые полгода «Полка» хранила продажи в одной таблице — так их выгружала касса:

| order_id | ordered_on | customer_email | customer_city | product_name | unit_price | qty |
|---|---|---|---|---|---|---|
| 1001 | 2024-03-01 | anna@polka.ru | Казань | Блокнот A5 | 249.90 | 2 |
| 1001 | 2024-03-01 | anna@polka.ru | Казань | Ручка гелевая | 89.00 | 5 |
| 1003 | 2024-03-02 | anna@polka.ru | Самара | Ручка гелевая | 95.00 | 10 |

Один и тот же факт записан много раз, и это порождает **аномалии**:

- **обновления** — Анна переехала, город исправили в одной строке и забыли в другой. Где она живёт?
- **вставки** — новый товар не добавить, пока его никто не купил;
- **удаления** — удалили единственный заказ клиента и потеряли его контакты.

**Нормализация** раскладывает данные по таблицам так, чтобы каждый факт хранился один раз. Проверяют её по нормальным формам:

- **1NF** — в ячейке одно значение: никаких «Блокнот, Ручка» через запятую и столбцов `item1`, `item2`;
- **2NF** — 1NF, и неключевые столбцы зависят от всего составного ключа. При ключе `(order_id, product_name)` дата заказа зависит только от `order_id` — это нарушение;
- **3NF** — 2NF, и неключевые столбцы зависят только от ключа, а не друг от друга. Город зависит от клиента, а не от заказа.

Итог — четыре таблицы: `customers`, `products`, `orders` и `order_items`, связанные внешними ключами. Смена города теперь касается одной строки:

```sql
UPDATE customers SET city = 'Самара' WHERE email = 'anna@polka.ru';
```

Цена остаётся в `order_items`: это факт сделки. Ручка стоила 89 ₽, потом 95 ₽, и старые заказы не должны меняться вместе с каталогом. Иногда данные денормализуют ради быстрых отчётов, но это осознанный компромисс, а не отправная точка.

## task w5-anomalies-gone
```json
{
  "type": "choice",
  "title": "Что даёт отдельная таблица",
  "xp": 10,
  "options": [
    "Город клиента меняется в одной строке, а не во всех его заказах",
    "Клиента можно сохранить до его первого заказа",
    "Удаление заказа больше не стирает контакты клиента",
    "Отчёт «заказы с городом клиента» больше не требует `JOIN`"
  ],
  "answer": [0, 1, 2],
  "explanation": "Все три аномалии — обновления, вставки и удаления — возникали потому, что данные клиента жили внутри строк заказа. Теперь клиент — отдельная строка, и заказы лишь ссылаются на неё. А вот `JOIN`, наоборот, понадобится: город лежит в `customers`, и его нужно присоединить к заказам. Это обычная цена нормализации.",
  "hints": ["Вспомните три вида аномалий из теории и проверьте каждый вариант по очереди."]
}
```
Из `order_lines_flat` вынесли клиентов в отдельную таблицу `customers`, а в заказах оставили только `customer_id`. Какие проблемы это решило? Отметьте все верные варианты.

## task w5-nf-violation
```json
{
  "type": "choice",
  "title": "Какая форма нарушена",
  "xp": 10,
  "options": [
    "1NF: в таблице есть текстовый столбец",
    "2NF: `product_name` зависит только от `product_id`, то есть от части ключа",
    "3NF: `qty` зависит от `product_name`",
    "Никакая: первичный ключ задан, значит таблица нормализована"
  ],
  "answer": [1],
  "explanation": "Название товара определяется одним `product_id`, номер заказа на него не влияет. Это зависимость от части составного ключа — нарушение 2NF. Название будет повторяться в каждой продаже, а переименование товара придётся делать во всех строках. Текстовые столбцы 1NF не нарушают: важно, чтобы в ячейке было одно значение. `qty` зависит от пары «заказ, товар», то есть от ключа целиком. Сам по себе первичный ключ не гарантирует ни 2NF, ни 3NF.",
  "hints": ["Для каждого неключевого столбца спросите: чтобы узнать его значение, нужен весь ключ `(order_id, product_id)` или хватит его части?"]
}
```
Таблица `order_items (order_id, product_id, product_name, qty)` с первичным ключом `(order_id, product_id)`. Какую нормальную форму она нарушает?

## task w5-normalize-orders
```json
{
  "type": "schema",
  "title": "Раскладываем выгрузку",
  "xp": 25,
  "check": { "tables": ["customers", "products", "orders", "order_items"] },
  "hints": [
    "Создавайте таблицы в порядке зависимостей: сначала `customers` и `products`, потом `orders`, последней — `order_items`.",
    "Составной ключ задаётся отдельной строкой в конце таблицы: `PRIMARY KEY (order_id, product_id)`. Ссылка: `order_id integer NOT NULL REFERENCES orders (id)`."
  ]
}
```
В песочнице лежит выгрузка кассы `order_lines_flat`. Спроектируйте для неё нормализованную схему из четырёх таблиц. Саму выгрузку не трогайте.

- `customers`: `id` — первичный ключ, база генерирует его сама; `email` — текст, обязательный и уникальный; `full_name` — текст, обязательный; `city` — текст, необязательный.
- `products`: `id` — первичный ключ, база генерирует его сама; `name` — текст, обязательный и уникальный.
- `orders`: `id` — целое число и первичный ключ. Это номер заказа из кассы, поэтому база его **не** генерирует. `customer_id` — обязательная ссылка на `customers.id`; `ordered_on` — дата, обязательная.
- `order_items`: `order_id` — обязательная ссылка на `orders.id`; `product_id` — обязательная ссылка на `products.id`; `qty` — целое число, обязательное и больше нуля; `price` — `numeric(10, 2)`, обязательная цена на момент покупки. Первичный ключ — пара `(order_id, product_id)`.

```sql setup
CREATE TABLE order_lines_flat (
  order_id int NOT NULL,
  ordered_on date NOT NULL,
  customer_email text NOT NULL,
  customer_name text NOT NULL,
  customer_city text,
  product_name text NOT NULL,
  unit_price numeric(10, 2) NOT NULL,
  qty int NOT NULL,
  PRIMARY KEY (order_id, product_name)
);
INSERT INTO order_lines_flat VALUES
  (1001, '2024-03-01', 'anna@polka.ru', 'Анна Смирнова', 'Казань', 'Блокнот A5', 249.90, 2),
  (1001, '2024-03-01', 'anna@polka.ru', 'Анна Смирнова', 'Казань', 'Ручка гелевая', 89.00, 5),
  (1002, '2024-03-02', 'boris@polka.ru', 'Борис Петров', 'Москва', 'Чистый код', 1450.00, 1),
  (1003, '2024-03-02', 'anna@polka.ru', 'Анна Смирнова', 'Казань', 'Ручка гелевая', 95.00, 10),
  (1004, '2024-03-05', 'vera@polka.ru', 'Вера Ким', NULL, 'Sapiens', 890.00, 1),
  (1004, '2024-03-05', 'vera@polka.ru', 'Вера Ким', NULL, 'Блокнот A5', 249.90, 3),
  (1005, '2024-03-06', 'boris@polka.ru', 'Борис Петров', 'Москва', 'Блокнот A5', 259.90, 1);
```

```sql solution
CREATE TABLE customers (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  city text
);
CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);
CREATE TABLE orders (
  id integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers (id),
  ordered_on date NOT NULL
);
CREATE TABLE order_items (
  order_id integer NOT NULL REFERENCES orders (id),
  product_id integer NOT NULL REFERENCES products (id),
  qty integer NOT NULL CHECK (qty > 0),
  price numeric(10, 2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
```

## task w5-migrate-flat-orders
```json
{
  "type": "state",
  "title": "Переносим данные",
  "xp": 25,
  "hints": [
    "Заполняйте таблицы в порядке внешних ключей. Справочники — через `INSERT INTO … SELECT DISTINCT … FROM order_lines_flat`.",
    "Для заказов и позиций заказа присоедините справочники по естественным ключам: `JOIN customers c ON c.email = f.customer_email`, `JOIN products p ON p.name = f.product_name`."
  ]
}
```
Схема готова, таблицы пусты. Перенесите в них все данные из `order_lines_flat`:

- каждый клиент и каждый товар — ровно одна строка, `id` пусть выдаёт база;
- номера заказов сохраните как есть;
- в `order_items.price` запишите цену из выгрузки (`unit_price`).

В выгрузке уже нет противоречий: у каждого клиента одно имя и один город.

```sql setup
CREATE TABLE order_lines_flat (
  order_id int NOT NULL,
  ordered_on date NOT NULL,
  customer_email text NOT NULL,
  customer_name text NOT NULL,
  customer_city text,
  product_name text NOT NULL,
  unit_price numeric(10, 2) NOT NULL,
  qty int NOT NULL,
  PRIMARY KEY (order_id, product_name)
);
INSERT INTO order_lines_flat VALUES
  (1001, '2024-03-01', 'anna@polka.ru', 'Анна Смирнова', 'Казань', 'Блокнот A5', 249.90, 2),
  (1001, '2024-03-01', 'anna@polka.ru', 'Анна Смирнова', 'Казань', 'Ручка гелевая', 89.00, 5),
  (1002, '2024-03-02', 'boris@polka.ru', 'Борис Петров', 'Москва', 'Чистый код', 1450.00, 1),
  (1003, '2024-03-02', 'anna@polka.ru', 'Анна Смирнова', 'Казань', 'Ручка гелевая', 95.00, 10),
  (1004, '2024-03-05', 'vera@polka.ru', 'Вера Ким', NULL, 'Sapiens', 890.00, 1),
  (1004, '2024-03-05', 'vera@polka.ru', 'Вера Ким', NULL, 'Блокнот A5', 249.90, 3),
  (1005, '2024-03-06', 'boris@polka.ru', 'Борис Петров', 'Москва', 'Блокнот A5', 259.90, 1);

CREATE TABLE customers (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  city text
);
CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);
CREATE TABLE orders (
  id integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers (id),
  ordered_on date NOT NULL
);
CREATE TABLE order_items (
  order_id integer NOT NULL REFERENCES orders (id),
  product_id integer NOT NULL REFERENCES products (id),
  qty integer NOT NULL CHECK (qty > 0),
  price numeric(10, 2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
```

```sql solution
INSERT INTO customers (email, full_name, city)
SELECT DISTINCT customer_email, customer_name, customer_city
FROM order_lines_flat;

INSERT INTO products (name)
SELECT DISTINCT product_name
FROM order_lines_flat;

INSERT INTO orders (id, customer_id, ordered_on)
SELECT DISTINCT f.order_id, c.id, f.ordered_on
FROM order_lines_flat f
JOIN customers c ON c.email = f.customer_email;

INSERT INTO order_items (order_id, product_id, qty, price)
SELECT f.order_id, p.id, f.qty, f.unit_price
FROM order_lines_flat f
JOIN products p ON p.name = f.product_name;
```

```sql check
SELECT email, full_name, city FROM customers;
SELECT name FROM products;
SELECT o.id, c.email, o.ordered_on
FROM orders o
JOIN customers c ON c.id = o.customer_id;
SELECT i.order_id, p.name AS product, i.qty, i.price
FROM order_items i
JOIN products p ON p.id = i.product_id;
```
