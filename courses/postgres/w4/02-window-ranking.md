# Оконные функции: ранжирование

Отдел кадров «Полки» хочет видеть рядом с каждым сотрудником среднюю зарплату его отдела и его место в отделе по зарплате. `GROUP BY` здесь не поможет: он схлопывает отдел в одну строку, и сотрудники пропадают. **Оконная функция** считает по группе строк, но оставляет каждую строку на месте.

Примеры работают на таблице `employees (id, full_name, department_id, manager_id, position, salary, hired_on)`. Отделы: 1 — дирекция, 2 — разработка, 3 — маркетинг, 4 — склад, 5 — поддержка.

### OVER и PARTITION BY

Любой агрегат — `avg`, `sum`, `min`, `max`, `count` — становится оконным, если после него написать `OVER (…)`. Строка не исчезает, а получает рядом значение агрегата по своему окну.

```sql
SELECT столбцы,
       агрегат(столбец) OVER (PARTITION BY столбец_группы) AS имя
FROM таблица;
```

- `OVER (…)` превращает функцию в оконную. Пустые скобки `OVER ()` — окно из всех строк результата.
- `PARTITION BY столбец` делит строки на независимые группы — окна. Для каждой строки функция считается только по строкам её окна. Это похоже на `GROUP BY`, но строки не схлопываются.
- `AS имя` — псевдоним нового столбца, как обычно. Оконных столбцов в одном `SELECT` может быть несколько, через запятую.
- Окно видит только строки, которые прошли `WHERE`.

Средняя зарплата отдела и средняя по всем строкам результата:

```sql example
SELECT department_id, full_name, salary,
       round(avg(salary) OVER (PARTITION BY department_id), 2) AS dept_avg,
       round(avg(salary) OVER (), 2) AS all_avg
FROM employees
WHERE department_id IN (3, 5)
ORDER BY department_id, salary DESC, full_name;
```

| department_id | full_name | salary | dept_avg | all_avg |
|---|---|---|---|---|
| 3 | Светлана Попова | 210000.00 | 150000.00 | 122500.00 |
| 3 | Кирилл Зайцев | 120000.00 | 150000.00 | 122500.00 |
| 3 | Полина Егорова | 120000.00 | 150000.00 | 122500.00 |
| 5 | Юлия Титова | 130000.00 | 95000.00 | 122500.00 |
| 5 | Ксения Лаптева | 80000.00 | 95000.00 | 122500.00 |
| 5 | Максим Носов | 75000.00 | 95000.00 | 122500.00 |

Три строки отдела 3 получили среднее отдела 3, три строки отдела 5 — своего. `all_avg` везде одинаков: это среднее по шести строкам, прошедшим `WHERE`.

Результат оконной функции — обычное число: его можно округлить через `round`, вычесть из него, сравнить. На сколько зарплата выше минимальной в отделе:

```sql example
SELECT department_id, full_name, salary,
       salary - min(salary) OVER (PARTITION BY department_id) AS above_min
FROM employees
WHERE department_id IN (4, 5)
ORDER BY department_id, salary DESC, full_name;
```

| department_id | full_name | salary | above_min |
|---|---|---|---|
| 4 | Руслан Галиев | 150000.00 | 80000.00 |
| 4 | Артём Ковалёв | 85000.00 | 15000.00 |
| 4 | Наиль Сафин | 70000.00 | 0.00 |
| 4 | Эльвира Мухина | 70000.00 | 0.00 |
| 5 | Юлия Титова | 130000.00 | 55000.00 |
| 5 | Ксения Лаптева | 80000.00 | 5000.00 |
| 5 | Максим Носов | 75000.00 | 0.00 |

### ORDER BY в окне и функции ранжирования

Три функции нумеруют строки окна по порядку. Порядок задаёт `ORDER BY` внутри `OVER`; для этих функций он обязателен.

```sql
функция() OVER (PARTITION BY столбец_группы ORDER BY столбец_порядка DESC) AS номер
```

- Скобки после имени функции пустые: `row_number()`, `rank()`, `dense_rank()`.
- `PARTITION BY` необязателен. Без него нумерация идёт по всем строкам сразу, с ним — заново с 1 в каждой группе.
- `ORDER BY` внутри `OVER` задаёт только порядок нумерации. Порядок строк в выдаче задаёт обычный `ORDER BY` в конце запроса.
- В `ORDER BY` окна можно указать несколько столбцов через запятую. Второй решает, кто выше при равенстве первого.

Функции отличаются тем, как поступают с равными значениями. Для зарплат 300, 250, 250, 200 по убыванию:

| функция | номера | правило |
|---|---|---|
| `row_number()` | 1, 2, 3, 4 | номера всегда разные |
| `rank()` | 1, 2, 2, 4 | равные делят место, следующее место пропускается |
| `dense_rank()` | 1, 2, 2, 3 | равные делят место, без пропусков |

Все три функции на сотрудниках маркетинга и склада:

```sql example
SELECT full_name, salary,
       row_number() OVER (ORDER BY salary DESC, full_name) AS row_num,
       rank()       OVER (ORDER BY salary DESC) AS rnk,
       dense_rank() OVER (ORDER BY salary DESC) AS dense
FROM employees
WHERE department_id IN (3, 4)
ORDER BY salary DESC, full_name;
```

| full_name | salary | row_num | rnk | dense |
|---|---|---|---|---|
| Светлана Попова | 210000.00 | 1 | 1 | 1 |
| Руслан Галиев | 150000.00 | 2 | 2 | 2 |
| Кирилл Зайцев | 120000.00 | 3 | 3 | 3 |
| Полина Егорова | 120000.00 | 4 | 3 | 3 |
| Артём Ковалёв | 85000.00 | 5 | 5 | 4 |
| Наиль Сафин | 70000.00 | 6 | 6 | 5 |
| Эльвира Мухина | 70000.00 | 7 | 6 | 5 |

У Кирилла и Полины одинаковые зарплаты. `rank()` и `dense_rank()` ставят обоих на место 3. Дальше `rank()` пропускает место 4 и даёт Артёму 5, а `dense_rank()` даёт 4. `row_number()` раздаёт разные номера; чтобы порядок равных был предсказуемым, в его окно добавлен второй ключ `full_name`.

С `PARTITION BY` нумерация начинается заново в каждом отделе. Кто пришёл в отдел первым, вторым и так далее:

```sql example
SELECT department_id, full_name, hired_on,
       row_number() OVER (PARTITION BY department_id ORDER BY hired_on) AS seniority
FROM employees
WHERE department_id IN (4, 5)
ORDER BY department_id, seniority;
```

| department_id | full_name | hired_on | seniority |
|---|---|---|---|
| 4 | Руслан Галиев | 2019-11-11 | 1 |
| 4 | Наиль Сафин | 2020-07-01 | 2 |
| 4 | Эльвира Мухина | 2022-04-18 | 3 |
| 4 | Артём Ковалёв | 2023-06-05 | 4 |
| 5 | Юлия Титова | 2020-10-01 | 1 |
| 5 | Максим Носов | 2021-11-15 | 2 |
| 5 | Ксения Лаптева | 2024-02-26 | 3 |

### Окно поверх GROUP BY

Оконную функцию можно применить к результату группировки: сначала `GROUP BY` сворачивает строки в группы, затем окно нумерует готовые группы.

```sql
SELECT столбец_группы,
       агрегат(столбец) AS итог,
       rank() OVER (ORDER BY агрегат(столбец) DESC) AS место
FROM таблица
GROUP BY столбец_группы;
```

- В `OVER` повторяют агрегат целиком: `ORDER BY count(*) DESC`. Псевдоним `итог` внутри `OVER` не работает.
- Можно соединять таблицы через `JOIN` и фильтровать `WHERE`, как в любом запросе с `GROUP BY`.

Рейтинг отделов по численности:

```sql example
SELECT department_id,
       count(*) AS headcount,
       rank() OVER (ORDER BY count(*) DESC) AS place
FROM employees
GROUP BY department_id
ORDER BY place, department_id;
```

| department_id | headcount | place |
|---|---|---|
| 2 | 5 | 1 |
| 4 | 4 | 2 |
| 3 | 3 | 3 |
| 5 | 3 | 3 |
| 1 | 1 | 5 |

Отделы 3 и 5 делят место 3, место 4 пропущено.

### Порядок выполнения запроса

PostgreSQL выполняет части запроса не в том порядке, в каком они написаны:

1. `FROM` и `JOIN` — собрать строки;
2. `WHERE` — отфильтровать строки;
3. `GROUP BY` и `HAVING` — сгруппировать строки и отфильтровать группы;
4. оконные функции;
5. список `SELECT` и псевдонимы `AS`;
6. `ORDER BY`, затем `LIMIT`.

Отсюда два следствия:

- В `WHERE` и `HAVING` оконную функцию писать нельзя: номеров ещё нет. PostgreSQL ответит ошибкой `window functions are not allowed in WHERE`.
- В `ORDER BY` в конце запроса можно сортировать по псевдониму оконного столбца, например `ORDER BY place`: к этому моменту он уже посчитан.

### Топ-N в каждой группе

Чтобы оставить по одной или по две лучшие строки в каждой группе, номер считают в CTE, а фильтруют во внешнем запросе. Там номер — уже обычный столбец.

```sql
WITH ranked AS (
  SELECT столбцы,
         row_number() OVER (PARTITION BY группа ORDER BY порядок DESC, второй_ключ) AS n
  FROM таблица
)
SELECT столбцы
FROM ranked
WHERE n <= N
ORDER BY …;
```

- `row_number()` даёт не больше N строк на группу. Второй ключ решает, кто проходит при равенстве первого.
- Если в группе меньше N строк, выводятся все.
- Если нужно вывести всех, кто делит место, используйте `rank()` или `dense_rank()`.

Последний нанятый сотрудник каждого отдела:

```sql example
WITH ranked AS (
  SELECT department_id, full_name, hired_on,
         row_number() OVER (PARTITION BY department_id ORDER BY hired_on DESC) AS n
  FROM employees
)
SELECT department_id, full_name, hired_on
FROM ranked
WHERE n = 1
ORDER BY department_id;
```

| department_id | full_name | hired_on |
|---|---|---|
| 1 | Ирина Белова | 2019-03-01 |
| 2 | Тимур Хасанов | 2022-09-12 |
| 3 | Полина Егорова | 2023-03-13 |
| 4 | Артём Ковалёв | 2023-06-05 |
| 5 | Ксения Лаптева | 2024-02-26 |

### Частые ошибки

- `WHERE row_number() OVER (…) <= 3` → посчитайте номер в CTE и пишите `WHERE n <= 3` во внешнем запросе. Окна вычисляются после `WHERE`.
- `SELECT department_id, full_name, avg(salary) FROM employees GROUP BY department_id` → `avg(salary) OVER (PARTITION BY department_id)`. С `GROUP BY` в `SELECT` остаются только столбцы группировки и агрегаты, а окно сохраняет каждую строку.
- `row_number() OVER (ORDER BY salary DESC)` при равных зарплатах → `row_number() OVER (ORDER BY salary DESC, full_name)`. Без второго ключа равные получат номера в случайном порядке.
- `rank() OVER (ORDER BY headcount DESC)`, где `headcount` — псевдоним из того же `SELECT` → `rank() OVER (ORDER BY count(*) DESC)`. Псевдонимы появляются позже окон, поэтому PostgreSQL ответит `column "headcount" does not exist`.

### Шпаргалка

```sql
avg(x) OVER ()                                   -- по всем строкам результата
max(x) OVER (PARTITION BY g)                     -- по своей группе, строки остаются
row_number() OVER (PARTITION BY g ORDER BY x DESC, y)  -- 1, 2, 3, 4
rank()       OVER (ORDER BY x DESC)              -- 1, 2, 2, 4
dense_rank() OVER (ORDER BY x DESC)              -- 1, 2, 2, 3
rank() OVER (ORDER BY count(*) DESC)             -- место группы после GROUP BY
WITH r AS (SELECT …, row_number() OVER (…) AS n FROM t) SELECT … FROM r WHERE n <= 2;
```

## task w4-salary-gap
```json
{
  "type": "result",
  "title": "Разрыв с максимумом",
  "xp": 10,
  "dataset": "hr",
  "hints": [
    "См. раздел «OVER и PARTITION BY»: максимум по отделу без `GROUP BY` считает `max(salary) OVER (PARTITION BY …)`, и из результата можно вычитать.",
    "`SELECT full_name, salary, max(…) OVER (PARTITION BY …) - … AS gap_to_max FROM employees;`"
  ]
}
```
Отдел кадров сравнивает зарплаты внутри отделов. Таблица `employees (id, full_name, department_id, manager_id, position, salary, hired_on)`. Выведите `full_name`, `salary` и `gap_to_max` — на сколько зарплата сотрудника меньше максимальной зарплаты в его отделе. У самого высокооплачиваемого в отделе `gap_to_max` равен 0. Порядок строк не важен.

```sql solution
SELECT full_name, salary,
       max(salary) OVER (PARTITION BY department_id) - salary AS gap_to_max
FROM employees;
```

## task w4-salary-grade
```json
{
  "type": "result",
  "title": "Ступени зарплат",
  "xp": 15,
  "dataset": "hr",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «ORDER BY в окне и функции ранжирования»: окно — отдел, порядок — по убыванию зарплаты. Какая из трёх функций не делает пропусков?",
    "`SELECT department_id, full_name, salary, …() OVER (PARTITION BY … ORDER BY … DESC) AS grade FROM employees ORDER BY …, grade, …;`"
  ]
}
```
Отдел кадров выстраивает в каждом отделе «ступени» зарплат: самая высокая зарплата — ступень 1, следующая по величине — 2 и так далее. Одинаковые зарплаты стоят на одной ступени, номера ступеней идут без пропусков. Таблица `employees (id, full_name, department_id, manager_id, position, salary, hired_on)`. Выведите `department_id`, `full_name`, `salary` и `grade`. Отсортируйте по `department_id`, затем по `grade`, затем по `full_name`.

```sql solution
SELECT department_id, full_name, salary,
       dense_rank() OVER (PARTITION BY department_id ORDER BY salary DESC) AS grade
FROM employees
ORDER BY department_id, grade, full_name;
```

## task w4-sales-rating
```json
{
  "type": "result",
  "title": "Рейтинг продаж",
  "xp": 20,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «Окно поверх GROUP BY»: сгруппируйте позиции по товару, а место посчитайте через `rank()`, повторив в `OVER` агрегат `sum(oi.quantity)`.",
    "`SELECT p.name, sum(…) AS units, rank() OVER (ORDER BY sum(…) DESC) AS place FROM order_items oi JOIN orders o ON … JOIN products p ON … WHERE o.status <> '…' GROUP BY p.id, p.name ORDER BY place, …;`"
  ]
}
```
Составьте рейтинг товаров по числу проданных штук. Таблицы: `order_items (order_id, product_id, quantity, price)`, `orders (id, customer_id, status, created_at)`, `products (id, name, category_id, price, stock)`. Проданные штуки — сумма `quantity` по позициям всех заказов, кроме отменённых (`status = 'cancelled'`); товары без продаж в рейтинг не входят. Выведите `name`, `units` и `place` — место в рейтинге. Как в спорте: при равном числе штук товары делят место, а следующее место пропускается. Отсортируйте по `place`, затем по `name`.

```sql solution
SELECT p.name,
       sum(oi.quantity) AS units,
       rank() OVER (ORDER BY sum(oi.quantity) DESC) AS place
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
WHERE o.status <> 'cancelled'
GROUP BY p.id, p.name
ORDER BY place, p.name;
```

## task w4-window-in-where
```json
{
  "type": "choice",
  "title": "Окно в WHERE",
  "xp": 5,
  "options": [
    "`row_number()` нельзя сравнивать с числом",
    "Оконные функции вычисляются после `WHERE`: номер нужно посчитать в подзапросе или CTE и отфильтровать снаружи",
    "Не хватает `PARTITION BY`: без него окно не определено",
    "Нужно заменить `WHERE` на `HAVING`"
  ],
  "answer": [1],
  "explanation": "PostgreSQL сначала отбирает строки (`WHERE`), затем группирует их (`GROUP BY`, `HAVING`) и только после этого считает оконные функции. В момент фильтрации номеров ещё нет. `HAVING` тоже работает до окон, так что замена не поможет. `PARTITION BY` необязателен: без него окно — весь результат. Номер — обычное число, сравнивать его можно, но во внешнем запросе.",
  "hints": ["См. раздел «Порядок выполнения запроса»: что PostgreSQL делает раньше — `WHERE` или оконные функции?"]
}
```
Запрос падает с ошибкой `window functions are not allowed in WHERE`. Почему?

```sql
SELECT full_name, salary
FROM employees
WHERE row_number() OVER (ORDER BY salary DESC) <= 3;
```

## task w4-top2-per-dept
```json
{
  "type": "result",
  "title": "Двое лучших в отделе",
  "xp": 25,
  "dataset": "hr",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «Топ-N в каждой группе»: пронумеруйте сотрудников внутри отдела в CTE через `row_number()`, а во внешнем запросе оставьте номера 1 и 2. Равные зарплаты разведёт второй ключ в окне.",
    "`WITH ranked AS (SELECT department_id, full_name, salary, row_number() OVER (PARTITION BY … ORDER BY salary DESC, …) AS n FROM employees) SELECT … FROM ranked WHERE n <= … ORDER BY …, salary DESC;`"
  ]
}
```
Для презентации совету директоров нужны два самых высокооплачиваемых сотрудника каждого отдела. Таблица `employees (id, full_name, department_id, manager_id, position, salary, hired_on)`. При равной зарплате выше стоит тот, кто раньше пришёл в компанию (`hired_on`). Если в отделе один человек, выводится он один. Выведите `department_id`, `full_name` и `salary`. Отсортируйте по `department_id`, затем по убыванию `salary`.

```sql solution
WITH ranked AS (
  SELECT department_id, full_name, salary,
         row_number() OVER (PARTITION BY department_id ORDER BY salary DESC, hired_on) AS n
  FROM employees
)
SELECT department_id, full_name, salary
FROM ranked
WHERE n <= 2
ORDER BY department_id, salary DESC;
```
