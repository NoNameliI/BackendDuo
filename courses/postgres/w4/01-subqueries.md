# Подзапросы

Аналитик «Полки» хочет найти товары дороже среднего. Средняя цена заранее неизвестна, поэтому вписать её числом в `WHERE` нельзя. Её посчитает **подзапрос** — `SELECT` в скобках внутри другого запроса.

- **Скалярный подзапрос** возвращает одно значение, и с ним можно сравнивать: `price > (SELECT avg(price) FROM products)`.
- `x IN (подзапрос)` проверяет, есть ли значение в списке, который вернул подзапрос.
- `EXISTS (подзапрос)` проверяет, вернул ли подзапрос хотя бы одну строку.
- **Коррелированный подзапрос** ссылается на строку внешнего запроса и вычисляется заново для каждой такой строки.

```sql
-- клиенты, у которых есть хотя бы один отменённый заказ
SELECT c.full_name
FROM customers c
WHERE EXISTS (
  SELECT 1 FROM orders o
  WHERE o.customer_id = c.id AND o.status = 'cancelled'
);
```

Осторожно с `NOT IN`: если подзапрос вернул хотя бы один `NULL`, условие не выполнится ни для одной строки. У `NOT EXISTS` такой ловушки нет.

**CTE** — общее табличное выражение `WITH имя AS (…)` — даёт подзапросу имя. Длинный запрос читается сверху вниз как цепочка шагов, а к промежуточному результату можно обратиться несколько раз.

```sql
WITH paid AS (
  SELECT customer_id, count(*) AS paid_orders
  FROM orders
  WHERE status = 'paid'
  GROUP BY customer_id
)
SELECT c.full_name, p.paid_orders
FROM paid p
JOIN customers c ON c.id = p.customer_id;
```

## task w4-above-avg-price
```json
{
  "type": "result",
  "title": "Дороже среднего",
  "xp": 10,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Среднюю цену посчитает отдельный запрос в скобках: `(SELECT avg(price) FROM products)`.",
    "Целиком условие и сортировка: `WHERE price > (SELECT avg(price) FROM products) ORDER BY price DESC`."
  ]
}
```
Маркетолог собирает подборку «премиум». Выведите `name` и `price` товаров, цена которых выше средней цены по всему каталогу. Сначала самые дорогие.

```sql solution
SELECT name, price
FROM products
WHERE price > (SELECT avg(price) FROM products)
ORDER BY price DESC;
```

## task w4-unshipped-products
```json
{
  "type": "result",
  "title": "Не доехали до покупателя",
  "xp": 15,
  "dataset": "shop",
  "hints": [
    "Нужны товары, для которых не существует позиции в отправленном заказе: `WHERE NOT EXISTS (…)`, а внутри — связь с внешней строкой через `p.id`.",
    "Подзапрос: `SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status = 'shipped'`."
  ]
}
```
Склад ищет товары, которые ещё ни разу не уехали к покупателю. Выведите `name` товаров, которые не входили ни в один заказ со статусом `shipped`. Порядок строк не важен.

```sql solution
SELECT p.name
FROM products p
WHERE NOT EXISTS (
  SELECT 1
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.product_id = p.id AND o.status = 'shipped'
);
```

## task w4-not-in-null
```json
{
  "type": "choice",
  "title": "Ловушка NOT IN",
  "xp": 5,
  "options": [
    "11 сотрудников без подчинённых",
    "Ни одной строки",
    "Ошибку: подзапрос вернул повторяющиеся значения",
    "Всех 16 сотрудников"
  ],
  "answer": [1],
  "explanation": "У генерального директора `manager_id` равен `NULL`, и этот `NULL` попадает в список подзапроса. `id NOT IN (1, 2, …, NULL)` означает `id <> 1 AND id <> 2 AND … AND id <> NULL`. Сравнение с `NULL` даёт `NULL`, поэтому условие не бывает истинным, и строк ноль. Повторы внутри `IN` допустимы, ошибки не будет. Чтобы получить 11 сотрудников, используйте `NOT EXISTS` или добавьте в подзапрос `WHERE manager_id IS NOT NULL`.",
  "hints": ["Посмотрите, какой `manager_id` у генерального директора и что даёт сравнение с `NULL`."]
}
```
В таблице `employees` 16 сотрудников. У генерального директора нет руководителя, его `manager_id` равен `NULL`. Руководителей пятеро, сотрудников без подчинённых — 11. Что вернёт запрос?

```sql
SELECT full_name
FROM employees
WHERE id NOT IN (SELECT manager_id FROM employees);
```

## task w4-above-dept-avg
```json
{
  "type": "result",
  "title": "Выше среднего по отделу",
  "xp": 20,
  "dataset": "hr",
  "check": { "ordered": true },
  "hints": [
    "Подзапрос в `WHERE` может ссылаться на строку внешнего запроса: дайте внешней таблице псевдоним `e` и сравните отделы внутри подзапроса.",
    "`WHERE e.salary > (SELECT avg(salary) FROM employees WHERE department_id = e.department_id)`."
  ]
}
```
Отдел кадров пересматривает зарплатную сетку. Выведите `full_name` и `salary` сотрудников, чья зарплата выше средней зарплаты в их собственном отделе. Сначала самые высокие зарплаты.

```sql solution
SELECT e.full_name, e.salary
FROM employees e
WHERE e.salary > (
  SELECT avg(salary)
  FROM employees
  WHERE department_id = e.department_id
)
ORDER BY e.salary DESC;
```

## task w4-top-customers-cte
```json
{
  "type": "result",
  "title": "Лучшие клиенты",
  "xp": 25,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Сначала в `WITH revenue AS (…)` посчитайте выручку каждого клиента: `sum(oi.quantity * oi.price)` по неотменённым заказам с `GROUP BY o.customer_id`. Среднее по CTE — `(SELECT avg(revenue) FROM revenue)`.",
    "Основной запрос: `SELECT c.full_name, r.revenue FROM revenue r JOIN customers c ON c.id = r.customer_id WHERE r.revenue > (SELECT avg(revenue) FROM revenue) ORDER BY r.revenue DESC`."
  ]
}
```
Отдел лояльности выбирает клиентов для закрытой распродажи. Выручка клиента — сумма `quantity * price` по позициям всех его заказов, кроме отменённых (`status = 'cancelled'`). Выведите `full_name` и `revenue` клиентов, чья выручка выше средней выручки среди клиентов, у которых есть неотменённые заказы. Сначала самые крупные клиенты.

```sql solution
WITH revenue AS (
  SELECT o.customer_id, sum(oi.quantity * oi.price) AS revenue
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.customer_id
)
SELECT c.full_name, r.revenue
FROM revenue r
JOIN customers c ON c.id = r.customer_id
WHERE r.revenue > (SELECT avg(revenue) FROM revenue)
ORDER BY r.revenue DESC;
```
