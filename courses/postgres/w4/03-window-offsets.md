# Оконные функции: соседи и накопление

Финансист «Полки» готовит отчёт: сколько дней прошло с прошлой покупки клиента, как росла выручка заказ за заказом и какую долю приносит каждая категория. Во всех этих расчётах важен порядок строк в окне.

- `lag(x)` — значение `x` из предыдущей строки окна, `lead(x)` — из следующей. Если соседа нет, вернётся `NULL`.
- `sum(x) OVER (ORDER BY …)` — накопительный итог: сумма от первой строки окна до текущей.
- `sum(x) OVER ()` — итог по всем строкам. Разделите значение на него, и получится доля.

```sql
SELECT day, revenue,
       revenue - lag(revenue) OVER (ORDER BY day) AS change
FROM daily_revenue;
```

**Рамка окна** уточняет, какие строки участвуют в расчёте для текущей. Скользящее среднее за 7 дней — текущая строка и шесть предыдущих:

```sql
avg(revenue) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
```

Если в окне есть `ORDER BY`, а рамка не указана, PostgreSQL берёт `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. `RANGE` считает строки с одинаковым ключом сортировки одной точкой и включает их в итог все сразу. Поэтому для накопительных итогов сортируйте по уникальному ключу или пишите рамку `ROWS` явно.

## task w4-next-hire
```json
{
  "type": "result",
  "title": "Кто пришёл следом",
  "xp": 10,
  "dataset": "hr",
  "check": { "ordered": true },
  "hints": [
    "Значение из следующей строки окна возвращает `lead()`. Порядок строк в окне задаёт `ORDER BY hired_on` внутри `OVER`.",
    "`lead(full_name) OVER (ORDER BY hired_on) AS next_hire`."
  ]
}
```
Отдел кадров восстанавливает историю найма. Выведите `full_name`, `hired_on` и `next_hire` — имя сотрудника, которого компания наняла сразу после него. У последнего нанятого `next_hire` равен `NULL`. Отсортируйте по `hired_on`.

```sql solution
SELECT full_name, hired_on,
       lead(full_name) OVER (ORDER BY hired_on) AS next_hire
FROM employees
ORDER BY hired_on;
```

## task w4-days-between-orders
```json
{
  "type": "result",
  "title": "Когда клиент вернулся",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Предыдущий заказ того же клиента даёт `lag()` в окне `PARTITION BY customer_id ORDER BY created_at`. Разность двух дат — число дней.",
    "`created_at::date - lag(created_at::date) OVER (PARTITION BY customer_id ORDER BY created_at) AS days_since_prev`."
  ]
}
```
Отдел лояльности изучает, как часто клиенты возвращаются. Для каждого заказа выведите `customer_id`, `id` и `days_since_prev` — сколько дней прошло с предыдущего заказа того же клиента (разность дат `created_at::date`). У первого заказа клиента `days_since_prev` равен `NULL`. Отсортируйте по `customer_id`, затем по `created_at`.

```sql solution
SELECT customer_id, id,
       created_at::date - lag(created_at::date) OVER (PARTITION BY customer_id ORDER BY created_at) AS days_since_prev
FROM orders
ORDER BY customer_id, created_at;
```

## task w4-running-revenue
```json
{
  "type": "result",
  "title": "Выручка нарастающим итогом",
  "xp": 20,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Сначала посчитайте `total` каждого заказа в CTE с `GROUP BY o.id, o.created_at`, затем снаружи примените `sum(total) OVER (ORDER BY created_at)`.",
    "Каркас: `WITH totals AS (SELECT o.id, o.created_at, sum(oi.quantity * oi.price) AS total FROM … GROUP BY o.id, o.created_at) SELECT id, total, sum(total) OVER (ORDER BY created_at) AS running_total FROM totals …`."
  ]
}
```
Финансисту нужен график роста выручки. Для каждого неотменённого заказа (`status <> 'cancelled'`) выведите `id`, `total` (сумма `quantity * price` по позициям заказа) и `running_total` (выручка всех неотменённых заказов с первого по текущий включительно). Отсортируйте по времени заказа (`created_at`).

```sql solution
WITH totals AS (
  SELECT o.id, o.created_at, sum(oi.quantity * oi.price) AS total
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status <> 'cancelled'
  GROUP BY o.id, o.created_at
)
SELECT id, total,
       sum(total) OVER (ORDER BY created_at) AS running_total
FROM totals
ORDER BY created_at;
```

## task w4-category-share
```json
{
  "type": "result",
  "title": "Доля категорий",
  "xp": 25,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Итог по всем строкам результата — окно без параметров `OVER ()`. Его можно взять от групповой суммы: `sum(sum(oi.quantity * oi.price)) OVER ()`.",
    "`round(100 * sum(oi.quantity * oi.price) / sum(sum(oi.quantity * oi.price)) OVER (), 1) AS share_pct` при `GROUP BY c.id, c.name`."
  ]
}
```
Совет директоров хочет знать вклад каждой категории в выручку. Выручка — сумма `quantity * price` по позициям неотменённых заказов. Выведите `category` (название категории товара), `revenue` (выручка категории) и `share_pct` (доля категории в общей выручке в процентах, округлённая до одного знака после запятой). Сначала самые доходные категории.

```sql solution
SELECT c.name AS category,
       sum(oi.quantity * oi.price) AS revenue,
       round(100 * sum(oi.quantity * oi.price) / sum(sum(oi.quantity * oi.price)) OVER (), 1) AS share_pct
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
JOIN categories c ON c.id = p.category_id
WHERE o.status <> 'cancelled'
GROUP BY c.id, c.name
ORDER BY revenue DESC;
```

## task w4-default-frame
```json
{
  "type": "choice",
  "title": "Рамка по умолчанию",
  "xp": 10,
  "options": [
    "100 и 300",
    "300 и 300",
    "100 и 200",
    "300 и 350"
  ],
  "answer": [1],
  "explanation": "Без явной рамки при `ORDER BY` действует `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. Обе строки за 1 марта имеют одинаковый ключ `paid_on`, поэтому каждая получает сумму обеих — 300. «100 и 300» дала бы рамка `ROWS`, но и тогда порядок двух строк внутри дня не гарантирован. «100 и 200» — это просто `amount`. 350 — итог по всем трём строкам, его получит только строка за 2 марта.",
  "hints": ["Какую рамку PostgreSQL берёт по умолчанию и что `RANGE` делает со строками с равным ключом?"]
}
```
В таблице `payments` три строки: (`2024-03-01`, 100), (`2024-03-01`, 200) и (`2024-03-02`, 50). Что запрос вернёт в столбце `running` для двух строк за 1 марта?

```sql
SELECT paid_on, amount,
       sum(amount) OVER (ORDER BY paid_on) AS running
FROM payments;
```

## task w4-moving-avg
```json
{
  "type": "result",
  "title": "Скользящее среднее доставок",
  "xp": 20,
  "check": { "ordered": true },
  "hints": [
    "Рамка пишется внутри `OVER` после `ORDER BY`: `ROWS BETWEEN … PRECEDING AND CURRENT ROW`.",
    "`round(avg(delivered) OVER (ORDER BY day ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 1) AS avg_3d`."
  ]
}
```
Курьерская служба «Полки» планирует смены. Дневные цифры скачут, поэтому диспетчер смотрит на среднее за три дня: текущий и два предыдущих, а в первые два дня — за те дни, что есть. Выведите `day`, `delivered` и `avg_3d` — это среднее, округлённое до одного знака после запятой. Отсортируйте по `day`.

Сейчас запрос в редакторе считает среднее с начала периода. Ограничьте рамку окна.

```sql setup
CREATE TABLE deliveries (
  day date PRIMARY KEY,
  delivered int NOT NULL CHECK (delivered >= 0)
);
INSERT INTO deliveries (day, delivered) VALUES
  ('2024-04-01', 120),
  ('2024-04-02', 135),
  ('2024-04-03', 128),
  ('2024-04-04', 150),
  ('2024-04-05', 162),
  ('2024-04-06', 90),
  ('2024-04-07', 85),
  ('2024-04-08', 140),
  ('2024-04-09', 155),
  ('2024-04-10', 170);
```

```sql starter
SELECT day, delivered,
       round(avg(delivered) OVER (ORDER BY day), 1) AS avg_3d
FROM deliveries
ORDER BY day;
```

```sql solution
SELECT day, delivered,
       round(avg(delivered) OVER (ORDER BY day ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 1) AS avg_3d
FROM deliveries
ORDER BY day;
```
