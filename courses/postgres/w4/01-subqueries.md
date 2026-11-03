# Подзапросы

Аналитик «Полки» хочет найти товары дороже среднего. Средняя цена заранее неизвестна и меняется вместе с каталогом, поэтому вписать её числом в `WHERE` нельзя. Её посчитает **подзапрос** — отдельный `SELECT` в круглых скобках внутри другого запроса. В этом уроке — четыре способа использовать подзапрос и CTE, способ дать подзапросу имя.

Примеры работают на данных магазина: `products (id, name, category_id, price, stock)`, `categories (id, name, parent_id)`, `customers (id, full_name, email, city, registered_on)`, `orders (id, customer_id, status, created_at)`, `order_items (order_id, product_id, quantity, price)`.

### Скалярный подзапрос

Скалярный подзапрос возвращает ровно одно значение: одну строку с одним столбцом. Его можно поставить везде, где подходит обычное число, — например, справа от `>` в `WHERE`.

```sql
SELECT столбец1, столбец2
FROM таблица
WHERE столбец > (SELECT агрегат(столбец) FROM таблица);
```

- Подзапрос всегда пишется в круглых скобках. Точки с запятой внутри скобок нет: она одна, в конце всего запроса.
- Внутри обычно стоит агрегат — `avg`, `max`, `min`, `sum` или `count`. Он сворачивает таблицу в одно значение.
- PostgreSQL вычисляет подзапрос, подставляет результат в условие и проверяет им каждую строку внешнего запроса.
- Если подзапрос вернёт несколько строк, запрос упадёт с ошибкой. Если ни одной — получится `NULL`.

Сначала посмотрим на сам подзапрос — среднее число единиц товара на складе:

```sql example
SELECT avg(stock) FROM products;
```

| avg |
|---|
| 59.1666666666666667 |

Теперь поставим его в `WHERE`: товары, которых на складе больше среднего.

```sql example
SELECT name, stock
FROM products
WHERE stock > (SELECT avg(stock) FROM products)
ORDER BY stock DESC;
```

| name | stock |
|---|---|
| Карандаш | 300 |
| Ручка гелевая | 200 |
| Тетрадь 48 листов | 120 |

Скалярный подзапрос можно поставить и в список `SELECT`. Тогда его значение появится в каждой строке:

```sql example
SELECT name, price, (SELECT max(price) FROM products) AS max_price
FROM products
WHERE category_id = 4
ORDER BY price;
```

| name | price | max_price |
|---|---|---|
| Думай медленно, решай быстро | 760.00 | 1450.00 |
| Sapiens | 890.00 | 1450.00 |
| Чистый код | 1450.00 | 1450.00 |

### IN с подзапросом

`значение IN (подзапрос)` истинно, если значение есть среди строк, которые вернул подзапрос. Это тот же `IN (1, 2, 3)`, только список строит сам PostgreSQL.

```sql
SELECT столбцы
FROM таблица
WHERE столбец IN (SELECT один_столбец FROM другая_таблица WHERE условие);
```

- Подзапрос в `IN` должен возвращать ровно один столбец. Строк может быть сколько угодно, повторы допустимы.
- `NOT IN (подзапрос)` — значения нет в списке. С ним есть ловушка, о ней ниже.

Товары, которые хотя бы раз заказали партией от 5 штук:

```sql example
SELECT name
FROM products
WHERE id IN (SELECT product_id FROM order_items WHERE quantity >= 5)
ORDER BY name;
```

| name |
|---|
| Карандаш |
| Ручка гелевая |
| Тетрадь 48 листов |

### EXISTS и NOT EXISTS

`EXISTS (подзапрос)` истинно, если подзапрос вернул хотя бы одну строку. Что именно в этих строках, неважно. `NOT EXISTS (подзапрос)` — наоборот: подзапрос не вернул ни одной строки.

```sql
SELECT в.столбец
FROM таблица в
WHERE EXISTS (
  SELECT 1
  FROM другая_таблица д
  WHERE д.ссылка = в.id AND другое_условие
);
```

- `в` и `д` — псевдонимы таблиц, записанные без `AS`: `FROM customers c` — то же, что `FROM customers AS c`. Внутри подзапроса `в.id` — это `id` текущей строки внешнего запроса. Такой подзапрос называют **коррелированным**: PostgreSQL выполняет его заново для каждой внешней строки.
- `SELECT 1` — договорённость. `EXISTS` смотрит только на то, есть ли строки, поэтому вернуть можно любую константу.
- Внутри подзапроса можно писать любой `SELECT`: с `JOIN`, с несколькими условиями через `AND`.

Клиенты, которые хоть раз заказывали «Чистый код» (`product_id = 6`). Клиент связан с позициями через заказ, поэтому внутри подзапроса соединяем `orders` и `order_items`:

```sql example
SELECT c.full_name
FROM customers c
WHERE EXISTS (
  SELECT 1
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.customer_id = c.id AND oi.product_id = 6
)
ORDER BY c.full_name;
```

| full_name |
|---|
| Анна Смирнова |
| Борис Петров |

Клиенты, у которых нет ни одного заказа:

```sql example
SELECT c.full_name
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM orders o WHERE o.customer_id = c.id
);
```

| full_name |
|---|
| Захар Морозов |

### Ловушка NOT IN и NULL

Сравнение с `NULL` никогда не бывает истинным: `5 <> NULL` даёт не «истину», а `NULL` — «неизвестно». Запись `x NOT IN (1, 2, NULL)` означает `x <> 1 AND x <> 2 AND x <> NULL`. Последнее сравнение неизвестно, и всё условие не может стать истинным. Поэтому если подзапрос в `NOT IN` вернул хотя бы один `NULL`, запрос не вернёт ни одной строки.

У корневых категорий «Книги» и «Канцелярия» `parent_id` равен `NULL`. Ищем категории без подкатегорий — те, чей `id` не встречается среди `parent_id`:

```sql example
SELECT name FROM categories
WHERE id NOT IN (SELECT parent_id FROM categories);
```

Результат пустой — ни одной строки, хотя таких категорий четыре. `NOT EXISTS` на `NULL` не спотыкается:

```sql example
SELECT name FROM categories c
WHERE NOT EXISTS (
  SELECT 1 FROM categories child WHERE child.parent_id = c.id
)
ORDER BY name;
```

| name |
|---|
| Нон-фикшн |
| Ручки и карандаши |
| Тетради и блокноты |
| Художественная литература |

Второй способ — убрать `NULL` из списка: `NOT IN (SELECT parent_id FROM categories WHERE parent_id IS NOT NULL)`.

### Коррелированный подзапрос

Скалярный подзапрос тоже может ссылаться на внешнюю строку. Тогда он вычисляется заново для каждой строки и для каждой даёт своё значение. Так строку сравнивают с её собственной группой: товар — со средним по его категории, сотрудника — со средним по его отделу.

```sql
SELECT в.столбец1, в.столбец2
FROM таблица в
WHERE в.число > (
  SELECT avg(число)
  FROM таблица
  WHERE группа = в.группа
);
```

- Внешней таблице обязательно дайте псевдоним (`в`). Без него имя `группа` внутри подзапроса означало бы столбец внутренней таблицы, и условие сравнивало бы столбец сам с собой.
- В `WHERE группа = в.группа` слева — столбец внутренней таблицы, справа — значение из текущей внешней строки.
- Одна и та же таблица может стоять и снаружи, и внутри: это две независимые «копии».

Товары, которых на складе больше, чем в среднем по их категории:

```sql example
SELECT p.name, p.category_id, p.stock
FROM products p
WHERE p.stock > (
  SELECT avg(stock)
  FROM products
  WHERE category_id = p.category_id
)
ORDER BY p.category_id, p.name;
```

| name | category_id | stock |
|---|---|---|
| Мастер и Маргарита | 3 | 12 |
| Sapiens | 4 | 7 |
| Чистый код | 4 | 9 |
| Тетрадь 48 листов | 5 | 120 |
| Карандаш | 6 | 300 |
| Ручка гелевая | 6 | 200 |

Для «Мастера и Маргариты» подзапрос считает среднее по категории 3: (12 + 0 + 4) / 3 ≈ 5,3. Для «Карандаша» — по категории 6: ≈ 166,7.

### CTE: WITH

CTE (общее табличное выражение) даёт подзапросу имя. Запрос читается сверху вниз как цепочка шагов, а к промежуточному результату можно обращаться как к обычной таблице, в том числе несколько раз.

```sql
WITH имя AS (
  SELECT …
)
SELECT столбцы
FROM имя
JOIN таблица ON …
WHERE …;
```

- `WITH имя AS (…)` стоит в самом начале, перед основным `SELECT`. Внутри скобок — любой `SELECT`, без точки с запятой.
- Столбцы CTE называются так же, как в его `SELECT`. Агрегатам дайте имя через `AS`.
- Несколько CTE перечисляют через запятую: `WITH a AS (…), b AS (…) SELECT …`.
- CTE существует только внутри одного запроса. После точки с запятой его уже нет.

Шаг 1 — число заказов каждого клиента, шаг 2 — имена и фильтр:

```sql example
WITH order_counts AS (
  SELECT customer_id, count(*) AS orders_count
  FROM orders
  GROUP BY customer_id
)
SELECT c.full_name, oc.orders_count
FROM order_counts oc
JOIN customers c ON c.id = oc.customer_id
WHERE oc.orders_count > 1
ORDER BY oc.orders_count DESC, c.full_name;
```

| full_name | orders_count |
|---|---|
| Анна Смирнова | 3 |
| Борис Петров | 2 |
| Вера Ким | 2 |
| Дарья Лебедева | 2 |

К CTE можно обратиться дважды: во `FROM` и в подзапросе. Найдём категорию с самым дорогим складом — сумма `price * stock` её товаров максимальна:

```sql example
WITH stock_value AS (
  SELECT category_id, sum(price * stock) AS stock_value
  FROM products
  GROUP BY category_id
)
SELECT cat.name, sv.stock_value
FROM stock_value sv
JOIN categories cat ON cat.id = sv.category_id
WHERE sv.stock_value = (SELECT max(stock_value) FROM stock_value);
```

| name | stock_value |
|---|---|
| Тетради и блокноты | 31746.00 |

### Частые ошибки

- `WHERE price > avg(price)` → `WHERE price > (SELECT avg(price) FROM products)`. Агрегат нельзя писать прямо в `WHERE`: `WHERE` проверяет строки по одной, а среднее считается по всей таблице.
- `WHERE price = (SELECT price FROM products WHERE category_id = 4)` → ошибка `more than one row returned by a subquery used as an expression`. Скалярный подзапрос обязан вернуть одну строку: используйте `IN (…)` или агрегат.
- `WHERE id NOT IN (SELECT parent_id FROM categories)` → `NOT EXISTS (…)` или `WHERE parent_id IS NOT NULL` внутри подзапроса. Один `NULL` в списке обнуляет результат.
- `FROM products WHERE stock > (SELECT avg(stock) FROM products WHERE category_id = category_id)` → `FROM products p … WHERE category_id = p.category_id`. Без псевдонима оба имени указывают на внутреннюю таблицу, и подзапрос считает среднее по всем товарам.

### Шпаргалка

```sql
WHERE x > (SELECT avg(x) FROM t)                          -- скалярный подзапрос
WHERE id IN (SELECT t_id FROM t2 WHERE …)                 -- значение есть в списке
WHERE EXISTS (SELECT 1 FROM t2 WHERE t2.t_id = t.id)      -- есть связанная строка
WHERE NOT EXISTS (SELECT 1 FROM t2 WHERE t2.t_id = t.id)  -- нет связанной строки
WHERE a.x > (SELECT avg(x) FROM t WHERE g = a.g)          -- сравнение со своей группой
WITH имя AS (SELECT …) SELECT … FROM имя;                 -- CTE
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
    "См. раздел «Скалярный подзапрос»: среднюю цену посчитает запрос в скобках, и с ним можно сравнивать `price`.",
    "`SELECT name, price FROM products WHERE price > (SELECT …(…) FROM products) ORDER BY … DESC;`"
  ]
}
```
Маркетолог собирает подборку «премиум». Таблица `products (id, name, category_id, price, stock)`. Выведите `name` и `price` товаров, цена которых выше средней цены по всему каталогу. Отсортируйте по убыванию `price`.

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
    "См. раздел «EXISTS и NOT EXISTS»: нужны товары, для которых не существует позиции в заказе со статусом `shipped`. Свяжите подзапрос с внешней строкой через `p.id`.",
    "`SELECT p.name FROM products p WHERE NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON … WHERE oi.product_id = … AND o.status = '…');`"
  ]
}
```
Склад ищет товары, которые ещё ни разу не уехали к покупателю. Таблицы: `products (id, name, category_id, price, stock)`, `order_items (order_id, product_id, quantity, price)`, `orders (id, customer_id, status, created_at)`. Выведите `name` товаров, которые не входили ни в один заказ со статусом `shipped`. Порядок строк не важен.

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
  "hints": ["См. раздел «Ловушка NOT IN и NULL»: какой `manager_id` у генерального директора и что даёт сравнение с `NULL`?"]
}
```
Таблица `employees (id, full_name, department_id, manager_id, position, salary, hired_on)`, в ней 16 сотрудников. У генерального директора нет руководителя, его `manager_id` равен `NULL`. Руководителей пятеро, сотрудников без подчинённых — 11. Что вернёт запрос?

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
    "См. раздел «Коррелированный подзапрос»: дайте внешней таблице псевдоним `e`, а внутри подзапроса считайте среднее только по отделу `e.department_id`.",
    "`SELECT e.full_name, e.salary FROM employees e WHERE e.salary > (SELECT avg(…) FROM employees WHERE department_id = …) ORDER BY … DESC;`"
  ]
}
```
Отдел кадров пересматривает зарплатную сетку. Таблица `employees (id, full_name, department_id, manager_id, position, salary, hired_on)`. Выведите `full_name` и `salary` сотрудников, чья зарплата выше средней зарплаты в их собственном отделе. Отсортируйте по убыванию `salary`.

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
    "См. раздел «CTE: WITH»: сначала в CTE `revenue` посчитайте выручку каждого клиента по неотменённым заказам, затем сравните её со средним по этому же CTE.",
    "`WITH revenue AS (SELECT o.customer_id, sum(… * …) AS revenue FROM orders o JOIN order_items oi ON … WHERE o.status <> '…' GROUP BY …) SELECT c.full_name, r.revenue FROM revenue r JOIN customers c ON … WHERE r.revenue > (SELECT avg(…) FROM revenue) ORDER BY … DESC;`"
  ]
}
```
Отдел лояльности выбирает клиентов для закрытой распродажи. Таблицы: `customers (id, full_name, email, city, registered_on)`, `orders (id, customer_id, status, created_at)`, `order_items (order_id, product_id, quantity, price)`. Выручка клиента — сумма `quantity * price` по позициям всех его заказов, кроме отменённых (`status = 'cancelled'`). Выведите `full_name` и `revenue` клиентов, чья выручка выше средней выручки среди клиентов, у которых есть неотменённые заказы. Отсортируйте по убыванию `revenue`.

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
