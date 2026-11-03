# Нормализация

Первые полгода «Полка» хранила продажи в одной таблице `order_lines_flat` — так их выгружала касса. Одна строка — одна позиция заказа, а вместе с ней каждый раз записаны дата заказа, данные клиента и название товара. Пока заказов мало, это удобно. Но такая таблица сама порождает ошибки в данных. В этом уроке вы разберёте, откуда они берутся, разложите выгрузку на несколько связанных таблиц и перенесёте в них данные одним запросом.

Все примеры работают с этой выгрузкой. Её столбцы: `order_lines_flat (order_id, ordered_on, customer_email, customer_name, customer_city, product_name, unit_price, qty)`.

### Аномалии: что ломается в одной большой таблице

Посмотрите на выгрузку целиком:

```sql example
SELECT order_id, ordered_on, customer_email, customer_city, product_name, unit_price, qty
FROM order_lines_flat
ORDER BY order_id, product_name;
```

| order_id | ordered_on | customer_email | customer_city | product_name | unit_price | qty |
|---|---|---|---|---|---|---|
| 1001 | 2024-03-01 | anna@polka.ru | Казань | Блокнот A5 | 249.90 | 2 |
| 1001 | 2024-03-01 | anna@polka.ru | Казань | Ручка гелевая | 89.00 | 5 |
| 1002 | 2024-03-02 | boris@polka.ru | Москва | Чистый код | 1450.00 | 1 |
| 1003 | 2024-03-02 | anna@polka.ru | Казань | Ручка гелевая | 95.00 | 10 |
| 1004 | 2024-03-05 | vera@polka.ru | NULL | Sapiens | 890.00 | 1 |
| 1004 | 2024-03-05 | vera@polka.ru | NULL | Блокнот A5 | 249.90 | 3 |
| 1005 | 2024-03-06 | boris@polka.ru | Москва | Блокнот A5 | 259.90 | 1 |

Город Анны записан три раза, дата заказа 1001 — дважды. Один и тот же факт хранится в нескольких строках, и это порождает **аномалии** — ситуации, когда данные становятся противоречивыми или теряются:

- **аномалия обновления** — Анна переехала, город исправили в одной её строке и забыли в двух других. Теперь непонятно, где она живёт;
- **аномалия вставки** — нового клиента не сохранить, пока он ничего не купил: строка выгрузки — это позиция заказа, без заказа её нет;
- **аномалия удаления** — удалили единственный заказ Веры и вместе с ним потеряли её e-mail и имя.

**Нормализация** — это раскладка данных по нескольким таблицам так, чтобы каждый факт хранился ровно один раз. Насколько хорошо разложены данные, проверяют по **нормальным формам**: 1NF, 2NF, 3NF. Каждая следующая включает требования предыдущей.

### Функциональная зависимость

Столбец B **зависит** от столбца A, если по значению A всегда можно однозначно узнать B. Пишут это так: `A → B`.

- `customer_email → customer_name, customer_city`: по e-mail клиента известны его имя и город;
- `order_id → ordered_on, customer_email`: у заказа одна дата и один покупатель;
- `(order_id, product_name) → qty, unit_price`: количество и цена — свойства конкретной позиции заказа.

Зависимость можно проверить запросом: сгруппировать строки по A и посчитать разные значения B. Если в каждой группе одно значение, зависимость есть.

```sql example
SELECT order_id,
       count(*) AS lines,
       count(DISTINCT ordered_on) AS dates
FROM order_lines_flat
GROUP BY order_id
ORDER BY order_id;
```

| order_id | lines | dates |
|---|---|---|
| 1001 | 2 | 1 |
| 1002 | 1 | 1 |
| 1003 | 1 | 1 |
| 1004 | 2 | 1 |
| 1005 | 1 | 1 |

У каждого заказа ровно одна дата, хотя строк бывает две: дата зависит от `order_id`, а не от позиции.

### Первая нормальная форма (1NF)

В каждой ячейке хранится одно значение, и в таблице нет повторяющихся групп столбцов.

- Нарушение: столбец `products` со значением `'Блокнот A5, Ручка гелевая'` — список в одной ячейке. Найти все заказы с ручкой или посчитать ручки уже не получится простым `WHERE`.
- Нарушение: столбцы `item1`, `item2`, `item3` — а если в заказе четыре товара?
- Решение: каждая позиция — отдельная строка. Выгрузка кассы уже в 1NF.

Текстовый столбец 1NF не нарушает: важно, чтобы в ячейке было одно значение, а не тип столбца.

### Вторая нормальная форма (2NF)

Таблица в 1NF, и каждый неключевой столбец зависит от **всего** первичного ключа, а не от его части. Вопрос возникает только при составном ключе.

- Ключ выгрузки — пара `(order_id, product_name)`.
- `qty` зависит от всей пары: сколько штук этого товара в этом заказе. Это нормально.
- `ordered_on` зависит только от `order_id` — от части ключа. Это нарушение 2NF: дата повторяется в каждой позиции заказа.
- Решение: вынести то, что зависит от `order_id`, в отдельную таблицу `orders`.

Простой способ проверки: для каждого неключевого столбца спросите, нужен ли весь ключ, чтобы узнать его значение, или хватит части.

### Третья нормальная форма (3NF)

Таблица во 2NF, и неключевые столбцы зависят только от ключа, а не друг от друга.

- В таблице заказов `orders (id, ordered_on, customer_email, customer_city)` город зависит от `customer_email`, а уже e-mail — от номера заказа. Это транзитивная зависимость: `id → customer_email → customer_city`.
- Решение: вынести клиента в таблицу `customers`, а в заказе хранить только ссылку на него.

Требования 2NF и 3NF удобно запомнить одной фразой: каждый неключевой столбец зависит от ключа, от всего ключа и ни от чего, кроме ключа.

### Нормализованная схема «Полки»

После раскладки получаются четыре таблицы, связанные внешними ключами:

- `customers (id, email, full_name, city)` — клиент записан один раз;
- `products (id, name)` — товар записан один раз;
- `orders (id, customer_id, ordered_on)` — заказ ссылается на клиента;
- `order_items (order_id, product_id, qty, price)` — позиция заказа ссылается на заказ и на товар, первичный ключ — пара `(order_id, product_id)`.

Смена города теперь касается одной строки `customers`, а клиента можно сохранить до первого заказа. Цена остаётся в `order_items`: это факт сделки. Ручка стоила 89 ₽, потом 95 ₽, и старые заказы не должны меняться вместе с каталогом. Цена нужна именно на момент покупки, поэтому это не дублирование.

У нормализации есть цена: чтобы показать заказ с городом клиента, теперь нужен `JOIN`. Иногда данные сознательно **денормализуют** — хранят копию ради быстрых отчётов. Это компромисс, на который идут осознанно, а не отправная точка.

### Таблицы со ссылками: напоминание

Синтаксис из первого мира. Таблицу, на которую ссылаются, создают раньше той, которая ссылается.

```sql
CREATE TABLE таблица (
  id serial PRIMARY KEY,
  столбец тип NOT NULL UNIQUE,
  ссылка integer NOT NULL REFERENCES другая_таблица (id),
  число integer NOT NULL CHECK (условие),
  PRIMARY KEY (столбец1, столбец2)
);
```

- `serial PRIMARY KEY` — база сама выдаёт номера 1, 2, 3… Если номер приходит извне, например номер заказа из кассы, пишите `integer PRIMARY KEY`;
- `NOT NULL` — значение обязательно, `UNIQUE` — повторы запрещены. Их можно писать подряд;
- `REFERENCES другая_таблица (id)` — внешний ключ: значение должно существовать в другой таблице;
- `CHECK (qty > 0)` — условие, которое проверяется для каждой строки;
- составной первичный ключ пишут отдельной строкой в конце списка: `PRIMARY KEY (a, b)`. Тогда у самих столбцов `PRIMARY KEY` не указывают;
- столбцы разделяются запятыми, после последнего запятой нет, в конце — `;`.

```sql example
CREATE TABLE demo_cities (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);
CREATE TABLE demo_price_history (
  product_name text NOT NULL,
  price numeric(10, 2) NOT NULL CHECK (price > 0),
  first_seen date NOT NULL,
  PRIMARY KEY (product_name, price)
);
```

Результат: обе таблицы созданы и пока пусты. `demo_cities` — справочник городов, `demo_price_history` — какие цены были у товара и когда цена впервые встретилась.

### INSERT … SELECT: перенос данных запросом

Вместо `VALUES` после `INSERT` можно написать `SELECT`. Тогда в таблицу попадут все строки, которые вернёт запрос.

```sql
INSERT INTO таблица (столбец1, столбец2)
SELECT выражение1, выражение2
FROM другая_таблица
WHERE условие;
```

- список столбцов в скобках и список в `SELECT` сопоставляются по порядку: первое выражение идёт в первый столбец, второе — во второй. Имена при этом могут не совпадать;
- столбцов в списке должно быть столько же, сколько выражений в `SELECT`;
- `VALUES` не пишут, и `SELECT` не берут в скобки;
- столбец `serial`, которого нет в списке, база заполнит сама;
- `SELECT DISTINCT` убирает повторы: из семи строк выгрузки получится по одной строке на город, клиента или товар;
- `ORDER BY` в конце задаёт, в каком порядке строки будут вставлены, а значит, какие номера `serial` они получат.

```sql example
INSERT INTO demo_cities (name)
SELECT DISTINCT customer_city
FROM order_lines_flat
WHERE customer_city IS NOT NULL
ORDER BY customer_city;

SELECT id, name FROM demo_cities ORDER BY id;
```

| id | name |
|---|---|
| 1 | Казань |
| 2 | Москва |

В `SELECT` можно использовать всё, что вы уже знаете, в том числе группировку и агрегаты:

```sql example
INSERT INTO demo_price_history (product_name, price, first_seen)
SELECT product_name, unit_price, min(ordered_on)
FROM order_lines_flat
GROUP BY product_name, unit_price;

SELECT product_name, price, first_seen
FROM demo_price_history
ORDER BY product_name, price;
```

| product_name | price | first_seen |
|---|---|---|
| Sapiens | 890.00 | 2024-03-05 |
| Блокнот A5 | 249.90 | 2024-03-01 |
| Блокнот A5 | 259.90 | 2024-03-06 |
| Ручка гелевая | 89.00 | 2024-03-01 |
| Ручка гелевая | 95.00 | 2024-03-02 |
| Чистый код | 1450.00 | 2024-03-02 |

Таблицы со ссылками заполняют в порядке внешних ключей: сначала справочники, потом таблицы, которые на них ссылаются. Иначе ссылке не на что будет указывать, и база вернёт ошибку внешнего ключа.

### Ссылки по естественному ключу: INSERT … SELECT с JOIN

Номера в справочнике выдала база, а в выгрузке их нет — там только названия и e-mail. Чтобы записать ссылку, присоедините справочник по **естественному ключу**: столбцу, который однозначно определяет запись в реальном мире (название города, e-mail клиента, название товара).

```sql
INSERT INTO таблица (ссылка_id, столбец)
SELECT d.id, f.столбец
FROM выгрузка f
JOIN справочник d ON d.естественный_ключ = f.столбец_выгрузки;
```

- `f` и `d` — псевдонимы таблиц из третьего мира: `f.столбец` — столбец выгрузки, `d.id` — номер из справочника;
- `JOIN … ON` находит для каждой строки выгрузки строку справочника с тем же значением;
- если одна сущность встречается в выгрузке несколько раз, добавьте `DISTINCT`.

```sql example
CREATE TABLE demo_customer_cities (
  email text PRIMARY KEY,
  city_id integer NOT NULL REFERENCES demo_cities (id)
);

INSERT INTO demo_customer_cities (email, city_id)
SELECT DISTINCT f.customer_email, c.id
FROM order_lines_flat f
JOIN demo_cities c ON c.name = f.customer_city;

SELECT email, city_id FROM demo_customer_cities ORDER BY email;
```

| email | city_id |
|---|---|
| anna@polka.ru | 1 |
| boris@polka.ru | 2 |

Без `DISTINCT` Анна попала бы в запрос трижды, и первичный ключ `email` не пустил бы повторы. Веры в результате нет: её город `NULL`, а `JOIN` не находит пары для `NULL`. Обратно данные собираются тем же `JOIN`:

```sql example
SELECT d.email, c.name AS city
FROM demo_customer_cities d
JOIN demo_cities c ON c.id = d.city_id
ORDER BY d.email;
```

| email | city |
|---|---|
| anna@polka.ru | Казань |
| boris@polka.ru | Москва |

### Частые ошибки

- `INSERT INTO demo_cities (name) VALUES (SELECT customer_city FROM order_lines_flat);` → `INSERT INTO demo_cities (name) SELECT customer_city FROM order_lines_flat;`. С запросом `VALUES` не пишут.
- `INSERT INTO demo_cities (name) SELECT customer_city FROM order_lines_flat WHERE customer_city IS NOT NULL;` → добавьте `DISTINCT`. Без него один город попадёт несколько раз, и `UNIQUE` вернёт ошибку о повторяющемся значении ключа.
- Заполнять таблицу со ссылкой раньше справочника → сначала справочник. Пустой справочник не даст `JOIN` ни одной пары, а прямые номера нарушат внешний ключ.
- `INSERT INTO demo_price_history (product_name, price) SELECT product_name, unit_price, min(ordered_on) …` → `INSERT INTO demo_price_history (product_name, price, first_seen) SELECT …`. Столбцов в списке должно быть столько же, сколько выражений в `SELECT`, иначе база вернёт ошибку.

### Шпаргалка

- 1NF — одно значение в ячейке; 2NF — зависимость от всего ключа; 3NF — только от ключа.
- `A → B` проверяется так: `SELECT A, count(DISTINCT B) FROM t GROUP BY A;`
- `id serial PRIMARY KEY` · `столбец text NOT NULL UNIQUE` · `ссылка integer NOT NULL REFERENCES t (id)`
- `PRIMARY KEY (a, b)` — отдельной строкой в конце `CREATE TABLE`.
- `INSERT INTO t (a, b) SELECT DISTINCT x, y FROM src;`
- `INSERT INTO t (ref_id, a) SELECT d.id, f.a FROM src f JOIN dict d ON d.name = f.name;`
- Порядок создания и заполнения: справочники → таблицы со ссылками.

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
  "hints": [
    "См. раздел «Аномалии: что ломается в одной большой таблице»: там три вида аномалий. Проверьте, какие из них исчезают.",
    "Про последний вариант см. конец раздела «Нормализованная схема «Полки»»: что нужно, чтобы снова увидеть заказ рядом с городом клиента?"
  ]
}
```
Из выгрузки `order_lines_flat (order_id, ordered_on, customer_email, customer_name, customer_city, product_name, unit_price, qty)` вынесли клиентов в отдельную таблицу `customers (id, email, full_name, city)`, а в заказах оставили только `customer_id`. Какие проблемы это решило? Отметьте все верные варианты.

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
  "hints": [
    "См. раздел «Вторая нормальная форма (2NF)»: проверьте каждый неключевой столбец.",
    "Для `product_name` и `qty` спросите: чтобы узнать значение, нужен весь ключ `(order_id, product_id)` или хватит его части?"
  ]
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
    "См. раздел «Таблицы со ссылками: напоминание». Создавайте таблицы в порядке зависимостей: сначала `customers` и `products`, потом `orders`, последней — `order_items`.",
    "Каркас последней таблицы: `CREATE TABLE order_items (order_id integer NOT NULL REFERENCES … (…), product_id …, qty integer NOT NULL CHECK (…), price numeric(10, 2) NOT NULL, PRIMARY KEY (…, …));`"
  ]
}
```
В песочнице лежит выгрузка кассы `order_lines_flat (order_id, ordered_on, customer_email, customer_name, customer_city, product_name, unit_price, qty)`. Спроектируйте для неё нормализованную схему из четырёх таблиц. Саму выгрузку не трогайте.

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
    "См. разделы «INSERT … SELECT: перенос данных запросом» и «Ссылки по естественному ключу». Заполняйте таблицы в порядке внешних ключей: `customers`, `products`, `orders`, `order_items`. Справочники — через `SELECT DISTINCT`.",
    "Заказы и позиции получают номера справочников через `JOIN`: `INSERT INTO orders (id, customer_id, ordered_on) SELECT DISTINCT f.…, c.id, f.… FROM order_lines_flat f JOIN customers c ON c.… = f.…;` Позиции — так же, но с `JOIN products p ON p.… = f.…`."
  ]
}
```
Схема готова, таблицы пусты. Перенесите в них все данные из выгрузки `order_lines_flat (order_id, ordered_on, customer_email, customer_name, customer_city, product_name, unit_price, qty)`.

Таблицы:

- `customers (id, email, full_name, city)` — `id` типа `serial`;
- `products (id, name)` — `id` типа `serial`;
- `orders (id, customer_id, ordered_on)` — `customer_id` ссылается на `customers.id`;
- `order_items (order_id, product_id, qty, price)` — ссылки на `orders.id` и `products.id`.

Требования:

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
