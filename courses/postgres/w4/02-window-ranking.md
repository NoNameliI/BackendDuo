# Оконные функции: ранжирование

Отдел кадров «Полки» хочет видеть рядом с каждым сотрудником среднюю зарплату его отдела. `GROUP BY` здесь не поможет: он схлопывает отдел в одну строку. **Оконная функция** считает по группе строк, но оставляет каждую строку на месте.

```sql
SELECT full_name, salary,
       avg(salary) OVER (PARTITION BY department_id) AS dept_avg
FROM employees;
```

- `OVER (…)` превращает функцию в оконную. Пустые скобки `OVER ()` — окно из всех строк результата.
- `PARTITION BY` делит строки на независимые группы — окна.
- `ORDER BY` внутри `OVER` задаёт порядок строк в окне. Для функций ранжирования он обязателен.

Три функции нумеруют строки по-разному. Для зарплат 300, 250, 250, 200 по убыванию:

| функция | номера | правило |
|---|---|---|
| `row_number()` | 1, 2, 3, 4 | номера всегда разные |
| `rank()` | 1, 2, 2, 4 | равные делят место, следующее пропускается |
| `dense_rank()` | 1, 2, 2, 3 | равные делят место, без пропусков |

При равенстве `row_number()` раздаёт номера в непредсказуемом порядке. Добавьте в `ORDER BY` второй ключ, чтобы результат был стабильным.

**Топ-N в каждой группе** — частая задача: например, три самых дорогих товара в каждой категории. Оконные функции вычисляются после `WHERE`, поэтому номер считают в CTE, а фильтруют снаружи:

```sql
WITH ranked AS (
  SELECT name, category_id, price,
         row_number() OVER (PARTITION BY category_id ORDER BY price DESC, id) AS n
  FROM products
)
SELECT name, category_id, price FROM ranked WHERE n <= 3;
```

## task w4-salary-gap
```json
{
  "type": "result",
  "title": "Разрыв с максимумом",
  "xp": 10,
  "dataset": "hr",
  "hints": [
    "Максимум по отделу без `GROUP BY`: `max(salary) OVER (PARTITION BY department_id)`.",
    "`max(salary) OVER (PARTITION BY department_id) - salary AS gap_to_max`."
  ]
}
```
Отдел кадров сравнивает зарплаты внутри отделов. Выведите `full_name`, `salary` и `gap_to_max` — на сколько зарплата сотрудника меньше максимальной зарплаты в его отделе. У самого высокооплачиваемого в отделе `gap_to_max` равен 0. Порядок строк не важен.

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
    "Окно — отдел (`PARTITION BY department_id`), порядок — по убыванию зарплаты. Какая из трёх функций не делает пропусков?",
    "`dense_rank() OVER (PARTITION BY department_id ORDER BY salary DESC) AS grade`."
  ]
}
```
Отдел кадров выстраивает в каждом отделе «ступени» зарплат: самая высокая зарплата — ступень 1, следующая по величине — 2 и так далее. Одинаковые зарплаты стоят на одной ступени, номера ступеней идут без пропусков. Выведите `department_id`, `full_name`, `salary` и `grade`. Отсортируйте по `department_id`, затем по `grade`, затем по `full_name`.

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
    "Оконную функцию можно применить к агрегату: сгруппируйте позиции по товару, а место посчитайте через `rank() OVER (ORDER BY sum(oi.quantity) DESC)`.",
    "`FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id WHERE o.status <> 'cancelled' GROUP BY p.id, p.name`."
  ]
}
```
Составьте рейтинг товаров по числу проданных штук — сумме `quantity` по позициям всех заказов, кроме отменённых (`status = 'cancelled'`). Выведите `name`, `units` и `place` — место в рейтинге. Как в спорте: при равном числе штук товары делят место, а следующее место пропускается. Отсортируйте по `place`, затем по `name`.

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
  "hints": ["Вспомните, в каком порядке PostgreSQL выполняет части запроса."]
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
    "Пронумеруйте сотрудников внутри отдела через `row_number()` в CTE, а во внешнем запросе оставьте номера 1 и 2. Равные зарплаты разведёт второй ключ сортировки в окне.",
    "`row_number() OVER (PARTITION BY department_id ORDER BY salary DESC, hired_on) AS n`, снаружи — `WHERE n <= 2`."
  ]
}
```
Для презентации совету директоров нужны два самых высокооплачиваемых сотрудника каждого отдела. При равной зарплате выше стоит тот, кто раньше пришёл в компанию (`hired_on`). Если в отделе один человек, выводится он один. Выведите `department_id`, `full_name` и `salary`. Отсортируйте по `department_id`, затем по убыванию `salary`.

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
