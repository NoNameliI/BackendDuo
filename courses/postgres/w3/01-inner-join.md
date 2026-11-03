# INNER JOIN

В «Полке» клиент записан один раз в `customers`, а каждый его заказ — отдельной строкой в `orders` со столбцом `customer_id`. Это связь **один-ко-многим**: у клиента много заказов, у заказа ровно один клиент. `customer_id` — **внешний ключ** (`FOREIGN KEY`), он ссылается на `customers.id`.

Курьеру в накладной нужны имя и город, а не номер клиента. Для этого таблицы соединяют. `INNER JOIN` (или просто `JOIN`) склеивает пары строк, для которых истинно условие в `ON`. Строки без пары в результат не попадают.

```sql
SELECT o.id AS order_id, c.full_name, o.status
FROM orders AS o
JOIN customers AS c ON c.id = o.customer_id;
```

`o` и `c` — **псевдонимы** таблиц. Они короче полных имён и снимают неоднозначность: столбец `id` есть в обеих таблицах, и без префикса PostgreSQL ответит ошибкой `column reference "id" is ambiguous`.

Соединений в запросе может быть несколько. Товары заказа лежат в `order_items`, поэтому путь от заказа к названию товара состоит из двух шагов:

```sql
SELECT o.id, p.name, oi.quantity
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN products AS p ON p.id = oi.product_id;
```

После соединений работают привычные `WHERE`, `GROUP BY` и агрегаты. Каждая строка такого результата — одна позиция заказа, и позиции можно суммировать по клиенту, заказу или категории.

## task w3-shipped-orders
```json
{
  "type": "result",
  "title": "Накладные для курьеров",
  "xp": 10,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Соедините `orders` и `customers` по условию `c.id = o.customer_id`, а статус проверьте в `WHERE`.",
    "`SELECT o.id AS order_id, c.full_name, c.city FROM orders AS o JOIN customers AS c ON c.id = o.customer_id WHERE …`"
  ]
}
```
Служба доставки сверяет отгруженные заказы. Для заказов в статусе `shipped` выведите `order_id` — номер заказа, а также `full_name` и `city` клиента. Отсортируйте по `order_id`.

```sql solution
SELECT o.id AS order_id, c.full_name, c.city
FROM orders AS o
JOIN customers AS c ON c.id = o.customer_id
WHERE o.status = 'shipped'
ORDER BY o.id;
```

## task w3-join-row-count
```json
{
  "type": "choice",
  "title": "Сколько строк",
  "xp": 5,
  "options": [
    "8 — по строке на клиента",
    "12 — по строке на заказ",
    "13 — все заказы плюс клиент без заказов",
    "96 — каждый клиент с каждым заказом"
  ],
  "answer": [1],
  "explanation": "`JOIN` склеивает каждый заказ с его единственным клиентом, поэтому строк столько же, сколько заказов, — 12. Клиент без заказов пары не находит и в результат не попадает: 13 строк дал бы `LEFT JOIN`. 8 строк получилось бы, только если бы у каждого клиента был ровно один заказ. 96 = 8 × 12 — это `CROSS JOIN`, соединение без условия.",
  "hints": ["Посчитайте пары «клиент — заказ», для которых выполняется условие в `ON`."]
}
```
В `customers` 8 клиентов, в `orders` 12 заказов. У каждого заказа есть клиент, а у одного клиента нет ни одного заказа. Сколько строк вернёт запрос?

```sql
SELECT c.full_name, o.id
FROM customers AS c
JOIN orders AS o ON o.customer_id = c.id;
```

## task w3-paid-order-items
```json
{
  "type": "result",
  "title": "Сборка оплаченных заказов",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Цепочка такая: `orders` → `order_items` по `order_id` → `products` по `product_id`. Статус проверьте в `WHERE`.",
    "`FROM orders AS o JOIN order_items AS oi ON oi.order_id = o.id JOIN products AS p ON p.id = oi.product_id`"
  ]
}
```
Склад собирает оплаченные заказы. Для заказов в статусе `paid` выведите `order_id`, название товара как `product` и количество `quantity`. Отсортируйте по `order_id`, а внутри заказа — по названию товара.

```sql solution
SELECT o.id AS order_id, p.name AS product, oi.quantity
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN products AS p ON p.id = oi.product_id
WHERE o.status = 'paid'
ORDER BY o.id, p.name;
```

## task w3-customer-totals
```json
{
  "type": "result",
  "title": "Сумма покупок клиента",
  "xp": 20,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Соедините `customers`, `orders` и `order_items`, отфильтруйте отменённые заказы в `WHERE` и сгруппируйте по клиенту.",
    "`SELECT c.full_name, SUM(oi.quantity * oi.price) AS total … WHERE o.status <> 'cancelled' GROUP BY c.id, c.full_name ORDER BY total DESC`"
  ]
}
```
Маркетинг отбирает клиентов для программы лояльности. Для каждого клиента посчитайте `total` — сумму `quantity * price` по всем позициям его заказов. Цена берётся из `order_items`: это цена на момент покупки. Отменённые заказы (`cancelled`) не учитывайте, клиенты без заказов в отчёт не попадают.

Выведите `full_name` и `total`, по убыванию `total`.

```sql solution
SELECT c.full_name, SUM(oi.quantity * oi.price) AS total
FROM customers AS c
JOIN orders AS o ON o.customer_id = c.id
JOIN order_items AS oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled'
GROUP BY c.id, c.full_name
ORDER BY total DESC;
```
