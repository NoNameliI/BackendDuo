# GROUP BY и HAVING

Итог по всему магазину полезен, но директору «Полки» нужен разрез: сколько заказов в каждом статусе, какая средняя цена в каждой категории, сколько продаж в каждом месяце. Для этого есть `GROUP BY`: строки с одинаковым значением собираются в группу, и агрегатные функции считаются для каждой группы отдельно. Одна группа — одна строка результата.

Примеры работают на базе «Полки»: `products (id, name, category_id, price, stock)`, `orders (id, customer_id, status, created_at)`, `order_items (order_id, product_id, quantity, price)`.

### GROUP BY — итоги по группам

`GROUP BY столбец` раскладывает строки по «стопкам» с одинаковым значением этого столбца. Агрегат в `SELECT` считается отдельно по каждой стопке.

```sql
SELECT столбец_группы, агрегат(столбец) AS имя
FROM таблица
WHERE условие
GROUP BY столбец_группы
ORDER BY столбец_группы;
```

- `GROUP BY` стоит после `FROM` и `WHERE`, но перед `ORDER BY` и `LIMIT`.
- В `SELECT` можно писать только столбцы из `GROUP BY` и агрегаты. Для любого другого столбца в группе много значений, PostgreSQL не знает, какое взять, и выдаёт ошибку: `column "products.name" must appear in the GROUP BY clause or be used in an aggregate function`.
- Можно группировать по нескольким столбцам через запятую: `GROUP BY a, b` создаёт группу на каждое сочетание `a` и `b`.
- Без `ORDER BY` порядок групп в результате не гарантирован.

Сколько товаров в каждой категории и какая в ней самая низкая цена:

```sql example
SELECT category_id,
       count(*)   AS products,
       min(price) AS min_price
FROM products
GROUP BY category_id
ORDER BY category_id;
```

| category_id | products | min_price |
|---|---|---|
| 3 | 3 | 450.00 |
| 4 | 3 | 760.00 |
| 5 | 3 | 95.00 |
| 6 | 3 | 35.00 |

Двенадцать строк таблицы `products` превратились в четыре — по одной на категорию.

### Сортировка по агрегату

Результат с группировкой можно сортировать по агрегату: самые продаваемые товары, самые частые статусы.

```sql
SELECT столбец_группы, агрегат(столбец) AS имя
FROM таблица
GROUP BY столбец_группы
ORDER BY имя DESC, столбец_группы;
```

- В `ORDER BY` можно написать псевдоним из `SELECT` (`ORDER BY units DESC`) или сам агрегат (`ORDER BY sum(quantity) DESC`).
- Если у двух групп одинаковое значение агрегата, их взаимный порядок случаен. Добавьте второй столбец сортировки, чтобы порядок был всегда одним и тем же.
- `LIMIT` после `ORDER BY` оставляет первые группы — так получают «топ-5».

Пять самых продаваемых товаров по числу проданных штук:

```sql example
SELECT product_id, sum(quantity) AS units
FROM order_items
GROUP BY product_id
ORDER BY units DESC, product_id
LIMIT 5;
```

| product_id | units |
|---|---|
| 8 | 14 |
| 11 | 10 |
| 10 | 8 |
| 7 | 3 |
| 9 | 3 |

У товаров 7 и 9 по 3 штуки, и второй ключ `product_id` ставит 7 первым.

### HAVING — условие на группы

`WHERE` проверяет отдельные строки и ничего не знает о группах. Условие на итог группы — «категории со средней ценой больше 500 ₽», «заказы дороже 1000 ₽» — пишут в `HAVING`.

```sql
SELECT столбец_группы, агрегат(столбец) AS имя
FROM таблица
GROUP BY столбец_группы
HAVING агрегат(столбец) > значение
ORDER BY столбец_группы;
```

- `HAVING` стоит сразу после `GROUP BY` и перед `ORDER BY`.
- В условии `HAVING` обычно агрегат: `count(*) >= 3`, `sum(stock) > 100`, `avg(price) > 500`. Работают и `AND`, `OR`.
- Псевдоним из `SELECT` в `HAVING` не виден: `HAVING avg_price > 500` даёт ошибку `column "avg_price" does not exist`. Повторите сам агрегат: `HAVING avg(price) > 500`.
- Группы, не прошедшие условие, исчезают из результата целиком.

Категории, где средняя цена товара больше 500 ₽:

```sql example
SELECT category_id, round(avg(price), 2) AS avg_price
FROM products
GROUP BY category_id
HAVING avg(price) > 500
ORDER BY category_id;
```

| category_id | avg_price |
|---|---|
| 3 | 776.67 |
| 4 | 1033.33 |

### WHERE и HAVING вместе: порядок выполнения

В одном запросе могут быть оба фильтра: `WHERE` отбирает строки до группировки, `HAVING` — группы после неё. PostgreSQL выполняет части запроса не в том порядке, в каком они написаны:

`FROM` → `WHERE` → `GROUP BY` → `HAVING` → `SELECT` → `ORDER BY` → `LIMIT`

- Агрегат в `WHERE` запрещён: на этом шаге групп ещё нет, считать не по чему. Ошибка: `aggregate functions are not allowed in WHERE`.
- Псевдонимы из `SELECT` появляются только на шаге `SELECT`. Поэтому в `ORDER BY` они работают, а в `WHERE` и `HAVING` — нет.
- Исключение для удобства: в `GROUP BY` PostgreSQL разрешает написать псевдоним из `SELECT` вместо длинного выражения. Пример — в следующем разделе.

```sql
SELECT столбец_группы, агрегат(столбец) AS имя
FROM таблица
WHERE условие_на_строки
GROUP BY столбец_группы
HAVING условие_на_группы
ORDER BY имя DESC;
```

Категории, где в наличии все три товара. `WHERE stock > 0` убирает строки с нулевым остатком до группировки, `HAVING count(*) = 3` оставляет категории, в которых после этого остались три товара:

```sql example
SELECT category_id, count(*) AS in_stock, sum(stock) AS units
FROM products
WHERE stock > 0
GROUP BY category_id
HAVING count(*) = 3
ORDER BY units DESC;
```

| category_id | in_stock | units |
|---|---|---|
| 5 | 3 | 175 |
| 4 | 3 | 19 |

В категориях 3 и 6 есть товар с остатком 0, после `WHERE` в них по два товара, и `HAVING` их отбросил.

### date_trunc — итоги по месяцам

`date_trunc('единица', столбец)` обрезает дату и время до начала периода: месяца, дня, года. Все заказы одного месяца получают одинаковое значение, и по нему можно группировать.

```sql
SELECT date_trunc('month', столбец_времени) AS month,
       агрегат(столбец) AS имя
FROM таблица
GROUP BY month
ORDER BY month;
```

- Первый аргумент — единица в кавычках: `'year'`, `'month'`, `'week'`, `'day'`, `'hour'`. Второй — столбец с датой и временем.
- Результат — момент начала периода: `2024-03-05 08:50` с `'month'` превращается в `2024-03-01 00:00:00`.
- Группировать можно по самому выражению `GROUP BY date_trunc('month', created_at)` или по его псевдониму `GROUP BY month` — результат одинаковый.
- `ORDER BY month` сортирует периоды по времени, от ранних к поздним.

Что делает `date_trunc` с отдельными заказами:

```sql example
SELECT id, created_at, date_trunc('month', created_at) AS month
FROM orders
WHERE id <= 3
ORDER BY id;
```

| id | created_at | month |
|---|---|---|
| 1 | 2024-01-15 10:20:00 | 2024-01-01 00:00:00 |
| 2 | 2024-01-20 18:05:00 | 2024-01-01 00:00:00 |
| 3 | 2024-02-03 09:40:00 | 2024-02-01 00:00:00 |

Сколько заказов всех статусов оформлено в каждом месяце и когда был первый из них:

```sql example
SELECT date_trunc('month', created_at) AS month,
       count(*)                        AS orders,
       min(created_at)                 AS first_order
FROM orders
GROUP BY month
ORDER BY month;
```

| month | orders | first_order |
|---|---|---|
| 2024-01-01 00:00:00 | 2 | 2024-01-15 10:20:00 |
| 2024-02-01 00:00:00 | 3 | 2024-02-03 09:40:00 |
| 2024-03-01 00:00:00 | 7 | 2024-03-02 20:30:00 |

### Частые ошибки

- `SELECT category_id, name, count(*) FROM products GROUP BY category_id` → уберите `name` или добавьте его в `GROUP BY`. У группы много названий, и PostgreSQL не выбирает одно сам.
- `WHERE sum(stock) > 100 GROUP BY category_id` → `GROUP BY category_id HAVING sum(stock) > 100`. `WHERE` выполняется до группировки, агрегаты в нём запрещены.
- `HAVING avg_price > 500` → `HAVING avg(price) > 500`. `HAVING` выполняется раньше `SELECT`, псевдонима там ещё нет.
- `ORDER BY units DESC` при равных итогах → `ORDER BY units DESC, product_id`. Без второго ключа группы с одинаковым итогом выходят в случайном порядке.

### Шпаргалка

```sql
SELECT столбец, count(*) AS n, sum(x) AS total   -- только столбцы GROUP BY и агрегаты
FROM таблица
WHERE условие_на_строки                          -- до группировки
GROUP BY столбец                                 -- можно несколько: GROUP BY a, b
HAVING count(*) >= 2                             -- после группировки, агрегат, без псевдонимов
ORDER BY total DESC, столбец;                    -- псевдонимы здесь работают

date_trunc('month', created_at)                  -- начало месяца: 'year', 'week', 'day'
-- порядок выполнения: FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT
```

## task w2-group-statuses
```json
{
  "type": "result",
  "title": "Заказы по статусам",
  "xp": 10,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. разделы «GROUP BY — итоги по группам» и «Сортировка по агрегату»: группируйте по статусу, заказы в группе считает `count(*)`.",
    "`SELECT status, count(*) AS orders FROM orders GROUP BY … ORDER BY … DESC;`"
  ]
}
```
Сколько заказов в каждом статусе? Таблица `orders (id, customer_id, status, created_at)`. Выведите `status` и `orders` — число заказов с этим статусом. Сначала самые частые статусы.

```sql starter
SELECT status, … AS orders
FROM orders
GROUP BY …
ORDER BY …;
```

```sql solution
SELECT status, count(*) AS orders
FROM orders
GROUP BY status
ORDER BY orders DESC;
```

## task w2-group-big-orders
```json
{
  "type": "result",
  "title": "Бесплатная доставка",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «HAVING — условие на группы»: сумма заказа известна только после группировки, поэтому условие на неё пишут в `HAVING`, а не в `WHERE`.",
    "`GROUP BY order_id HAVING sum(… * …) > …`, затем `ORDER BY total DESC, …`."
  ]
}
```
Заказы дороже 1400 ₽ «Полка» доставляет бесплатно. Сумма заказа — это сумма `quantity * price` по его строкам в таблице `order_items (order_id, product_id, quantity, price)`.

Выведите `order_id` и `total` — сумму заказа — для заказов дороже 1400 ₽. Сначала самые крупные, при равной сумме — по `order_id`.

```sql starter
SELECT order_id, sum(…) AS total
FROM order_items
GROUP BY …
HAVING …
ORDER BY …;
```

```sql solution
SELECT order_id, sum(quantity * price) AS total
FROM order_items
GROUP BY order_id
HAVING sum(quantity * price) > 1400
ORDER BY total DESC, order_id;
```

## task w2-group-aggregate-review
```json
{
  "type": "review",
  "title": "Агрегат не на своём месте",
  "xp": 10,
  "options": [
    "Агрегат в `WHERE` недопустим: условие на `count(*)` нужно перенести в `HAVING` после `GROUP BY`",
    "`GROUP BY` должен стоять перед `WHERE`",
    "В `ORDER BY` нельзя использовать псевдоним `orders`",
    "`count(*)` нужно заменить на `count(customer_id)`"
  ],
  "answer": [0],
  "lines": [3],
  "explanation": "`WHERE` выполняется до группировки и проверяет отдельные строки: групп ещё нет, считать `count(*)` не по чему. Условия на агрегаты пишут в `HAVING`: `GROUP BY customer_id HAVING count(*) > 1`. `GROUP BY` всегда идёт после `WHERE`. Псевдоним из `SELECT` в `ORDER BY` использовать можно: сортировка выполняется последней. `count(customer_id)` — тоже агрегат, и в `WHERE` он запрещён так же.",
  "hints": [
    "См. раздел «WHERE и HAVING вместе: порядок выполнения»: что происходит раньше — `WHERE` или `GROUP BY`?"
  ]
}
```
Маркетолог ищет клиентов, у которых больше одного заказа. Таблица `orders (id, customer_id, status, created_at)`. Запрос завершается ошибкой. В чём причина?

```sql code
SELECT customer_id, count(*) AS orders
FROM orders
WHERE count(*) > 1
GROUP BY customer_id
ORDER BY orders DESC;
```

## task w2-group-regulars
```json
{
  "type": "result",
  "title": "Постоянные клиенты",
  "xp": 20,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «WHERE и HAVING вместе: порядок выполнения»: отменённые заказы — условие на строки (`WHERE`), «не меньше двух» — условие на группы (`HAVING`). Время последнего заказа даёт `max(created_at)`.",
    "`WHERE status <> '…' GROUP BY customer_id HAVING count(*) >= …`, затем `ORDER BY orders DESC, …`."
  ]
}
```
Отдел лояльности дарит скидку постоянным клиентам — тем, у кого не меньше двух заказов. Отменённые заказы (`status = 'cancelled'`) не считаются. Таблица `orders (id, customer_id, status, created_at)`.

Выведите `customer_id`, `orders` (число неотменённых заказов клиента) и `last_order` (время последнего из них). Сначала клиенты с наибольшим числом заказов, при равенстве — по `customer_id`.

```sql solution
SELECT customer_id, count(*) AS orders, max(created_at) AS last_order
FROM orders
WHERE status <> 'cancelled'
GROUP BY customer_id
HAVING count(*) >= 2
ORDER BY orders DESC, customer_id;
```

## task w2-group-monthly
```json
{
  "type": "result",
  "title": "Продажи по месяцам",
  "xp": 20,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «date_trunc — итоги по месяцам»: группируйте по выражению `date_trunc('month', created_at)` или по его псевдониму `month`. Разных клиентов считает `count(DISTINCT …)`.",
    "`SELECT date_trunc('month', created_at) AS month, count(*) AS orders, count(DISTINCT …) AS customers FROM orders WHERE … GROUP BY … ORDER BY …;`"
  ]
}
```
Директор смотрит динамику продаж. Таблица `orders (id, customer_id, status, created_at)`. Отменённые заказы (`status = 'cancelled'`) не учитывайте. Для каждого месяца выведите:

- `month` — начало месяца: `date_trunc('month', created_at)`;
- `orders` — число заказов за месяц;
- `customers` — сколько разных клиентов их сделали.

Отсортируйте по `month` по возрастанию.

```sql solution
SELECT date_trunc('month', created_at) AS month,
       count(*)                        AS orders,
       count(DISTINCT customer_id)     AS customers
FROM orders
WHERE status <> 'cancelled'
GROUP BY month
ORDER BY month;
```
