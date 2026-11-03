# Оконные функции: соседи и накопление

Финансист «Полки» готовит отчёт: сколько дней прошло с прошлой покупки клиента, как росла выручка заказ за заказом, какую долю приносит каждая категория и каким было среднее за последние дни. Всё это — оконные функции из прошлого урока, но здесь главное — порядок строк в окне.

Примеры работают на таблице `employees (id, full_name, department_id, manager_id, position, salary, hired_on)` и на учебной таблице, которую мы создадим в разделе о рамке окна. Отделы: 2 — разработка, 3 — маркетинг, 4 — склад, 5 — поддержка.

### lag и lead: соседние строки

`lag(выражение)` берёт значение из предыдущей строки окна, `lead(выражение)` — из следующей. Какая строка предыдущая, а какая следующая, решает `ORDER BY` внутри `OVER`.

```sql
SELECT столбцы,
       lag(выражение)  OVER (PARTITION BY группа ORDER BY порядок) AS предыдущее,
       lead(выражение) OVER (PARTITION BY группа ORDER BY порядок) AS следующее
FROM таблица;
```

- `выражение` — столбец или вычисление над ним, например `hired_on` или `created_at::date`.
- `ORDER BY` в окне нужен всегда: без него «соседи» случайны.
- `PARTITION BY` необязателен. С ним соседи ищутся только внутри своей группы.
- Если соседа нет — у первой строки для `lag`, у последней для `lead`, — функция возвращает `NULL`.

Разработчики (отдел 2) в порядке найма: кого наняли перед каждым и когда наняли следующего:

```sql example
SELECT full_name, hired_on,
       lag(full_name) OVER (ORDER BY hired_on) AS prev_hire,
       lead(hired_on) OVER (ORDER BY hired_on) AS next_hired_on
FROM employees
WHERE department_id = 2
ORDER BY hired_on;
```

| full_name | hired_on | prev_hire | next_hired_on |
|---|---|---|---|
| Олег Савин | 2019-06-17 | NULL | 2020-02-10 |
| Мария Котова | 2020-02-10 | Олег Савин | 2021-04-05 |
| Денис Фролов | 2021-04-05 | Мария Котова | 2022-01-24 |
| Алина Гусева | 2022-01-24 | Денис Фролов | 2022-09-12 |
| Тимур Хасанов | 2022-09-12 | Алина Гусева | NULL |

### Даты: приведение и разность

Разность двух значений типа `date` — целое число дней. Значение типа `timestamp` (дата со временем) приводят к дате записью `::date`, так же как `::numeric` приводит к числу: время отбрасывается.

```sql
выражение::date
дата2 - дата1
```

- `'2024-03-20 19:25'::timestamp` — строка, приведённая к дате со временем; `::date` после неё оставляет только день.
- `дата2 - дата1` даёт число дней. Более позднюю дату пишут первой, иначе число будет отрицательным.
- Разность двух `timestamp` — не число, а интервал вида `19 days 11:25:00`. Чтобы получить дни, сначала приведите оба значения к `date`.
- `SELECT` без `FROM` просто вычисляет выражения — так удобно проверять формулы.

```sql example
SELECT '2024-03-20 19:25'::timestamp AS moment,
       '2024-03-20 19:25'::timestamp::date AS day,
       '2024-03-20'::date - '2024-03-01'::date AS days_between;
```

| moment | day | days_between |
|---|---|---|
| 2024-03-20 19:25:00 | 2024-03-20 | 19 |

Теперь вместе с `lag`: сколько дней прошло с предыдущего найма в том же отделе. На границе отделов окно начинается заново, и `lag` снова даёт `NULL`:

```sql example
SELECT department_id, full_name, hired_on,
       hired_on - lag(hired_on) OVER (PARTITION BY department_id ORDER BY hired_on) AS days_after_prev
FROM employees
WHERE department_id IN (3, 4)
ORDER BY department_id, hired_on;
```

| department_id | full_name | hired_on | days_after_prev |
|---|---|---|---|
| 3 | Светлана Попова | 2020-05-18 | NULL |
| 3 | Кирилл Зайцев | 2021-08-02 | 441 |
| 3 | Полина Егорова | 2023-03-13 | 588 |
| 4 | Руслан Галиев | 2019-11-11 | NULL |
| 4 | Наиль Сафин | 2020-07-01 | 233 |
| 4 | Эльвира Мухина | 2022-04-18 | 656 |
| 4 | Артём Ковалёв | 2023-06-05 | 413 |

### Накопительный итог

`sum(x) OVER (ORDER BY …)` — сумма от первой строки окна до текущей включительно. С `PARTITION BY` итог в каждой группе начинается заново.

```sql
sum(столбец) OVER (PARTITION BY группа ORDER BY порядок) AS итог_на_момент
```

- Порядок накопления задаёт `ORDER BY` в окне. Ключ сортировки должен быть уникальным, иначе получится ловушка из раздела о рамке окна.
- Так же работают `count(*)`, `avg`, `min` и `max`: каждый считается по строкам от начала окна до текущей.
- Сортировать результат можно и по столбцу, которого нет в списке `SELECT`.

Как рос фонд зарплат маркетинга и поддержки с каждым новым сотрудником:

```sql example
SELECT department_id, full_name, hired_on, salary,
       sum(salary) OVER (PARTITION BY department_id ORDER BY hired_on) AS payroll
FROM employees
WHERE department_id IN (3, 5)
ORDER BY department_id, hired_on;
```

| department_id | full_name | hired_on | salary | payroll |
|---|---|---|---|---|
| 3 | Светлана Попова | 2020-05-18 | 210000.00 | 210000.00 |
| 3 | Кирилл Зайцев | 2021-08-02 | 120000.00 | 330000.00 |
| 3 | Полина Егорова | 2023-03-13 | 120000.00 | 450000.00 |
| 5 | Юлия Титова | 2020-10-01 | 130000.00 | 130000.00 |
| 5 | Максим Носов | 2021-11-15 | 75000.00 | 205000.00 |
| 5 | Ксения Лаптева | 2024-02-26 | 80000.00 | 285000.00 |

Часто сначала нужно сгруппировать строки, а потом накопить итог по группам. Тогда группировку кладут в CTE, а окно пишут во внешнем запросе:

```sql example
WITH dept_payroll AS (
  SELECT department_id, sum(salary) AS payroll
  FROM employees
  GROUP BY department_id
)
SELECT department_id, payroll,
       sum(payroll) OVER (ORDER BY department_id) AS running_payroll
FROM dept_payroll
ORDER BY department_id;
```

| department_id | payroll | running_payroll |
|---|---|---|
| 1 | 350000.00 | 350000.00 |
| 2 | 1020000.00 | 1370000.00 |
| 3 | 450000.00 | 1820000.00 |
| 4 | 375000.00 | 2195000.00 |
| 5 | 285000.00 | 2480000.00 |

### Доля от итога: OVER ()

`sum(x) OVER ()` — итог по всем строкам результата, одинаковый в каждой строке. Разделите значение строки на него и умножьте на 100 — получится доля в процентах.

```sql
round(100 * значение / sum(значение) OVER (), 1) AS доля_pct
```

- `round(x, 1)` округляет до одного знака после запятой.
- С `PARTITION BY` вместо пустых скобок получится доля внутри группы.
- Делите числа типа `numeric` — деньги, результаты `sum` и `avg`. Целое на целое делится нацело: `100 * 3 / 16` даёт 18, а не 18,75.

Доля зарплаты сотрудника в фонде его отдела:

```sql example
SELECT department_id, full_name, salary,
       round(100 * salary / sum(salary) OVER (PARTITION BY department_id), 1) AS pct_of_dept
FROM employees
WHERE department_id IN (4, 5)
ORDER BY department_id, salary DESC, full_name;
```

| department_id | full_name | salary | pct_of_dept |
|---|---|---|---|
| 4 | Руслан Галиев | 150000.00 | 40.0 |
| 4 | Артём Ковалёв | 85000.00 | 22.7 |
| 4 | Наиль Сафин | 70000.00 | 18.7 |
| 4 | Эльвира Мухина | 70000.00 | 18.7 |
| 5 | Юлия Титова | 130000.00 | 45.6 |
| 5 | Ксения Лаптева | 80000.00 | 28.1 |
| 5 | Максим Носов | 75000.00 | 26.3 |

В запросе с `GROUP BY` каждая строка результата — группа, а общий итог — сумма групповых значений. Окно пишут вокруг агрегата: в `sum(count(*)) OVER ()` внутренний `count(*)` считает строки группы, а внешний `sum(…) OVER ()` складывает эти числа по всем группам. Доля каждого отдела в численности компании:

```sql example
SELECT department_id,
       count(*) AS headcount,
       round(100 * count(*) / sum(count(*)) OVER (), 1) AS headcount_pct
FROM employees
GROUP BY department_id
ORDER BY headcount DESC, department_id;
```

| department_id | headcount | headcount_pct |
|---|---|---|
| 2 | 5 | 31.3 |
| 4 | 4 | 25.0 |
| 3 | 3 | 18.8 |
| 5 | 3 | 18.8 |
| 1 | 1 | 6.3 |

Здесь деление не целочисленное: `sum` от целых чисел возвращает `numeric`.

### Рамка окна: ROWS BETWEEN

Рамка уточняет, какие строки окна участвуют в расчёте для текущей строки. Она пишется внутри `OVER` после `ORDER BY`.

```sql
агрегат(столбец) OVER (ORDER BY порядок ROWS BETWEEN начало AND конец)
```

- `начало` и `конец` — одно из: `UNBOUNDED PRECEDING` (первая строка окна), `N PRECEDING` (N строк назад), `CURRENT ROW` (текущая строка), `N FOLLOWING` (N строк вперёд), `UNBOUNDED FOLLOWING` (последняя строка окна).
- `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` — текущая строка и две предыдущие, всего три. В начале окна берутся те строки, что есть.
- Так считают скользящее среднее — среднее за последние N дней. Оно сглаживает скачки дневных цифр.

Создадим учебную таблицу посещений сайта:

```sql example
CREATE TABLE demo_visits (
  day date PRIMARY KEY,
  visitors int NOT NULL
);
INSERT INTO demo_visits (day, visitors) VALUES
  ('2024-05-01', 40),
  ('2024-05-02', 60),
  ('2024-05-03', 20),
  ('2024-05-04', 80),
  ('2024-05-05', 50);
```

Сумма за два дня (вчера и сегодня) и среднее по трём соседним дням (вчера, сегодня, завтра):

```sql example
SELECT day, visitors,
       sum(visitors) OVER (ORDER BY day ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS two_days,
       round(avg(visitors) OVER (ORDER BY day ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING), 1) AS avg_around
FROM demo_visits
ORDER BY day;
```

| day | visitors | two_days | avg_around |
|---|---|---|---|
| 2024-05-01 | 40 | 40 | 50.0 |
| 2024-05-02 | 60 | 100 | 40.0 |
| 2024-05-03 | 20 | 80 | 53.3 |
| 2024-05-04 | 80 | 100 | 50.0 |
| 2024-05-05 | 50 | 130 | 65.0 |

В первой строке `two_days` равен 40: предыдущего дня нет, и в рамке одна строка. В последней `avg_around` — среднее двух дней, потому что следующего нет.

**Рамка по умолчанию.** Если в окне есть `ORDER BY`, а рамка не указана, PostgreSQL берёт `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. `RANGE` считает строки с одинаковым ключом сортировки одной точкой и включает их в итог все сразу. На складе (отдел 4) две одинаковые зарплаты:

```sql example
SELECT full_name, salary,
       sum(salary) OVER (ORDER BY salary) AS range_sum,
       sum(salary) OVER (ORDER BY salary, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS rows_sum
FROM employees
WHERE department_id = 4
ORDER BY salary, id;
```

| full_name | salary | range_sum | rows_sum |
|---|---|---|---|
| Наиль Сафин | 70000.00 | 140000.00 | 70000.00 |
| Эльвира Мухина | 70000.00 | 140000.00 | 140000.00 |
| Артём Ковалёв | 85000.00 | 225000.00 | 225000.00 |
| Руслан Галиев | 150000.00 | 375000.00 | 375000.00 |

Обе строки с зарплатой 70000 получили в `range_sum` 140000 — сумму обеих сразу. Поэтому для накопительных итогов сортируйте окно по уникальному ключу или пишите рамку `ROWS` явно.

### Частые ошибки

- `created_at - lag(created_at) OVER (…)` → `created_at::date - lag(created_at::date) OVER (…)`. Разность двух `timestamp` — интервал с часами и минутами, а не число дней.
- `sum(x) OVER (ORDER BY day)`, когда дни повторяются → `sum(x) OVER (ORDER BY day, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`. Рамка `RANGE` по умолчанию склеивает строки с равным ключом.
- `ROWS BETWEEN 3 PRECEDING AND CURRENT ROW` для среднего за три дня → `2 PRECEDING`. Текущая строка тоже входит в рамку.
- `100 * 3 / 16` → `100.0 * 3 / 16` или `100 * 3::numeric / 16`. Целые числа делятся нацело: 18 вместо 18,75.

### Шпаргалка

```sql
lag(x) OVER (ORDER BY t)                       -- значение из предыдущей строки
lead(x) OVER (PARTITION BY g ORDER BY t)       -- из следующей строки своей группы
ts::date                                       -- дата без времени
дата2 - дата1                                  -- разность в днях
sum(x) OVER (ORDER BY t)                       -- накопительный итог
round(100 * x / sum(x) OVER (), 1)             -- доля от общего итога, %
sum(sum(x)) OVER ()                            -- общий итог в запросе с GROUP BY
avg(x) OVER (ORDER BY t ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)  -- скользящее среднее
```

## task w4-next-hire
```json
{
  "type": "result",
  "title": "Кто пришёл следом",
  "xp": 10,
  "dataset": "hr",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «lag и lead: соседние строки»: значение из следующей строки окна возвращает `lead()`, порядок задаёт `ORDER BY hired_on` внутри `OVER`.",
    "`SELECT full_name, hired_on, lead(…) OVER (ORDER BY …) AS next_hire FROM employees ORDER BY …;`"
  ]
}
```
Отдел кадров восстанавливает историю найма. Таблица `employees (id, full_name, department_id, manager_id, position, salary, hired_on)`. Выведите `full_name`, `hired_on` и `next_hire` — имя сотрудника, которого компания наняла сразу после него (по всей компании, без деления на отделы). У последнего нанятого `next_hire` равен `NULL`. Отсортируйте по `hired_on`.

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
    "См. разделы «lag и lead: соседние строки» и «Даты: приведение и разность»: предыдущий заказ того же клиента даёт `lag()` в окне `PARTITION BY customer_id ORDER BY created_at`, а дни — разность двух значений `date`.",
    "`SELECT customer_id, id, created_at::date - lag(…::date) OVER (PARTITION BY … ORDER BY …) AS days_since_prev FROM orders ORDER BY …, …;`"
  ]
}
```
Отдел лояльности изучает, как часто клиенты возвращаются. Таблица `orders (id, customer_id, status, created_at)`, столбец `created_at` — дата и время заказа (`timestamp`). Для каждого заказа выведите `customer_id`, `id` и `days_since_prev` — сколько дней прошло с предыдущего заказа того же клиента (разность дат `created_at::date`). У первого заказа клиента `days_since_prev` равен `NULL`. Отсортируйте по `customer_id`, затем по `created_at`.

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
    "См. раздел «Накопительный итог»: сначала в CTE посчитайте `total` каждого заказа (`GROUP BY o.id, o.created_at`), затем во внешнем запросе накопите `sum(total) OVER (ORDER BY created_at)`.",
    "`WITH totals AS (SELECT o.id, o.created_at, sum(… * …) AS total FROM orders o JOIN order_items oi ON … WHERE o.status <> '…' GROUP BY o.id, o.created_at) SELECT id, total, sum(…) OVER (ORDER BY …) AS running_total FROM totals ORDER BY …;`"
  ]
}
```
Финансисту нужен график роста выручки. Таблицы: `orders (id, customer_id, status, created_at)`, `order_items (order_id, product_id, quantity, price)`. Для каждого неотменённого заказа (`status <> 'cancelled'`) выведите `id`, `total` (сумма `quantity * price` по позициям заказа) и `running_total` (выручка всех неотменённых заказов с первого по текущий включительно, по времени заказа). Отсортируйте по `created_at`.

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
    "См. раздел «Доля от итога: OVER ()»: в запросе с `GROUP BY` общий итог — окно вокруг агрегата, `sum(sum(oi.quantity * oi.price)) OVER ()`.",
    "`SELECT c.name AS category, sum(…) AS revenue, round(100 * sum(…) / sum(sum(…)) OVER (), 1) AS share_pct FROM order_items oi JOIN orders o ON … JOIN products p ON … JOIN categories c ON … WHERE … GROUP BY c.id, c.name ORDER BY …;`"
  ]
}
```
Совет директоров хочет знать вклад каждой категории в выручку. Таблицы: `order_items (order_id, product_id, quantity, price)`, `orders (id, customer_id, status, created_at)`, `products (id, name, category_id, price, stock)`, `categories (id, name, parent_id)`. Выручка — сумма `quantity * price` по позициям неотменённых заказов (`status <> 'cancelled'`); категория позиции — категория её товара. Выведите `category` (название категории), `revenue` (выручка категории) и `share_pct` (доля категории в общей выручке в процентах, округлённая до одного знака после запятой). Отсортируйте по убыванию `revenue`.

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
  "hints": ["См. раздел «Рамка окна: ROWS BETWEEN», абзац «Рамка по умолчанию»: что `RANGE` делает со строками с равным ключом?"]
}
```
В таблице `payments (paid_on, amount)` три строки: (`2024-03-01`, 100), (`2024-03-01`, 200) и (`2024-03-02`, 50). Что запрос вернёт в столбце `running` для двух строк за 1 марта?

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
    "См. раздел «Рамка окна: ROWS BETWEEN»: рамка пишется внутри `OVER` после `ORDER BY`. Текущая строка тоже входит в рамку.",
    "`round(avg(delivered) OVER (ORDER BY day ROWS BETWEEN … PRECEDING AND CURRENT ROW), 1) AS avg_3d`."
  ]
}
```
Курьерская служба «Полки» планирует смены. Таблица `deliveries (day, delivered)` — число доставок за день. Дневные цифры скачут, поэтому диспетчер смотрит на среднее за три дня: текущий и два предыдущих, а в первые два дня — за те дни, что есть. Выведите `day`, `delivered` и `avg_3d` — это среднее, округлённое до одного знака после запятой. Отсортируйте по `day`.

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
