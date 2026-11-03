# GROUP BY и HAVING

Итог по всему магазину полезен, но директору «Полки» нужен разрез: сколько заказов в каждом статусе, сколько продаж в каждом месяце. Для этого есть `GROUP BY`. Строки с одинаковым значением собираются в группу, и агрегат считается для каждой группы отдельно: одна группа — одна строка результата.

```sql
SELECT category_id, count(*) AS products, max(price) AS max_price
FROM products
WHERE stock > 0          -- строки: только товары в наличии
GROUP BY category_id
HAVING count(*) >= 3     -- группы: категории от трёх товаров
ORDER BY max_price DESC;
```

- В `SELECT` стоят только столбцы из `GROUP BY` и агрегаты. Для любого другого столбца PostgreSQL не знает, какое из значений группы взять, и выдаёт ошибку. Исключение — группировка по первичному ключу таблицы: остальные её столбцы тогда однозначны, и их можно выводить.
- `WHERE` фильтрует строки **до** группировки, `HAVING` — группы **после**. Агрегат в `WHERE` запрещён: групп на этом шаге ещё нет.
- Группировать можно по выражению. `date_trunc('month', created_at)` обрезает время до начала месяца: `2024-03-05 08:50` превращается в `2024-03-01 00:00`. Так получаются помесячные итоги.
- Сортировать можно по агрегату или по его псевдониму: `ORDER BY max_price DESC`.

Порядок выполнения запроса: `FROM` → `WHERE` → `GROUP BY` → `HAVING` → `SELECT` → `ORDER BY` → `LIMIT`.

## task w2-group-statuses
```json
{
  "type": "result",
  "title": "Заказы по статусам",
  "xp": 10,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Группируйте по статусу: `GROUP BY status`. Заказы в группе считает `count(*)`.",
    "Сортировать можно по псевдониму агрегата: `ORDER BY orders DESC`."
  ]
}
```
Сколько заказов в каждом статусе? Таблица `orders (id, customer_id, status, created_at)`. Выведите `status` и `orders` — число заказов с этим статусом. Сначала самые частые статусы.

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
    "Условие на сумму заказа проверяется после группировки — в `HAVING`, а не в `WHERE`.",
    "`GROUP BY order_id HAVING sum(quantity * price) > 1400`"
  ]
}
```
Заказы дороже 1400 ₽ «Полка» доставляет бесплатно. Сумма заказа — это сумма `quantity * price` по его строкам в таблице `order_items (order_id, product_id, quantity, price)`.

Выведите `order_id` и `total` — сумму заказа — для заказов дороже 1400 ₽. Сначала самые крупные, при равной сумме — по `order_id`.

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
  "hints": ["Вспомните порядок выполнения: что происходит раньше — `WHERE` или `GROUP BY`?"]
}
```
Маркетолог ищет клиентов, у которых больше одного заказа. Запрос завершается ошибкой. В чём причина?

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
    "Отменённые заказы — условие на строки (`WHERE`), «не меньше двух» — условие на группы (`HAVING`).",
    "`WHERE status <> 'cancelled' GROUP BY customer_id HAVING count(*) >= 2`"
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
    "Группируйте по выражению: `GROUP BY date_trunc('month', created_at)` или по его псевдониму `GROUP BY month`.",
    "Разных клиентов в группе считает `count(DISTINCT customer_id)`, отменённые заказы убирает `WHERE status <> 'cancelled'`."
  ]
}
```
Директор смотрит динамику продаж. Таблица `orders (id, customer_id, status, created_at)`. Отменённые заказы не учитывайте. Для каждого месяца выведите:

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
