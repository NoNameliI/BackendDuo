# Агрегатные функции

Директор «Полки» не листает таблицы: ему нужны итоги. Сколько товаров в каталоге, какая средняя цена, на какую сумму лежит товар на складе, сколько разных клиентов делали заказы. Такие итоги считают **агрегатные функции**: они сворачивают много строк в одно значение.

Примеры работают на базе «Полки»: `products (id, name, category_id, price, stock)`, `categories (id, name, parent_id)`, `customers (id, full_name, email, city, registered_on)`, `orders (id, customer_id, status, created_at)`, `order_items (order_id, product_id, quantity, price)`.

### Агрегатные функции

Обычный `SELECT` возвращает строку на каждую строку таблицы. Если в `SELECT` стоят только агрегатные функции, результат — ровно одна строка с итогами.

```sql
SELECT функция1(столбец) AS имя1,
       функция2(столбец) AS имя2
FROM таблица
WHERE условие;
```

- После имени функции идут круглые скобки, внутри — столбец или выражение.
- Несколько функций пишут через запятую, как обычные столбцы.
- `AS имя` задаёт имя столбца результата. Без него столбец назовётся по функции: `count`, `sum`, `max`.
- `WHERE` необязателен. Если он есть, функции считают только отобранные строки.

| Функция | Что возвращает |
|---|---|
| `count(*)` | число строк |
| `count(столбец)` | число строк, где в столбце не `NULL` |
| `sum(столбец)` | сумму значений |
| `avg(столбец)` | среднее значение |
| `min(столбец)`, `max(столбец)` | наименьшее и наибольшее значение |

Сколько всего строк в заказах и сколько штук товара в них покупали — минимум и максимум:

```sql example
SELECT count(*)      AS items,
       min(quantity) AS min_qty,
       max(quantity) AS max_qty
FROM order_items;
```

| items | min_qty | max_qty |
|---|---|---|
| 20 | 1 | 10 |

### count(*) и count(столбец)

`count(*)` считает строки целиком, ему неважно, что в них лежит. `count(столбец)` считает только строки, где в этом столбце есть значение, то есть не `NULL`.

```sql
SELECT count(*) AS всего_строк, count(столбец) AS заполнено
FROM таблица;
```

- `*` внутри `count` означает «строку целиком».
- Разница между `count(*)` и `count(столбец)` — это число строк с `NULL` в столбце.

В таблице `categories` у разделов верхнего уровня нет родителя: `parent_id` равен `NULL`.

```sql example
SELECT count(*)         AS categories,
       count(parent_id) AS subcategories
FROM categories;
```

| categories | subcategories |
|---|---|
| 6 | 4 |

### sum, avg, min, max

`sum` складывает значения, `avg` считает среднее, `min` и `max` находят наименьшее и наибольшее. Все четыре пропускают `NULL`: например, среднее считается только по заполненным значениям.

```sql
SELECT sum(столбец) AS итого,
       avg(столбец) AS среднее,
       sum(столбец1 * столбец2) AS итого_по_выражению
FROM таблица;
```

- Внутри функции можно писать выражение: `sum(quantity * price)` сначала умножает в каждой строке, потом складывает результаты.
- `sum` и `avg` работают с числами. `min` и `max` — ещё и с датами, временем и текстом: самая ранняя дата, самое позднее время, первое по алфавиту слово.
- `avg` возвращает число с длинным хвостом знаков после точки. Как его округлить — в следующем разделе.

Сколько штук продано всего, на какую сумму и сколько штук в среднем в одной строке заказа:

```sql example
SELECT sum(quantity)         AS units,
       sum(quantity * price) AS revenue,
       avg(quantity)         AS avg_qty
FROM order_items;
```

| units | revenue | avg_qty |
|---|---|---|
| 50 | 15701.70 | 2.5000000000000000 |

Первая и последняя дата регистрации клиентов:

```sql example
SELECT min(registered_on) AS first_signup,
       max(registered_on) AS last_signup
FROM customers;
```

| first_signup | last_signup |
|---|---|
| 2023-02-14 | 2024-03-18 |

### round — округление

`round(число, знаков)` округляет число до нужного количества знаков после точки. Половина округляется от нуля: `2.5` → `3`.

```sql
SELECT round(выражение, 2) AS имя
FROM таблица;
```

- Первый аргумент — что округлять: столбец, выражение или агрегат, например `avg(столбец)`.
- Второй аргумент — сколько знаков оставить после точки. Аргументы разделяют запятой.
- Без второго аргумента `round(x)` округляет до целого.
- Функции вкладываются друг в друга: в `round(avg(quantity), 2)` сначала считается среднее, потом оно округляется.

```sql example
SELECT avg(quantity)           AS raw_avg,
       round(avg(quantity), 2) AS avg_qty,
       round(avg(quantity))    AS avg_whole
FROM order_items;
```

| raw_avg | avg_qty | avg_whole |
|---|---|---|
| 2.5000000000000000 | 2.50 | 3 |

### WHERE перед подсчётом

`WHERE` срабатывает до агрегатных функций: сначала отбираются строки, потом по ним считаются итоги.

```sql
SELECT count(*) AS сколько, max(столбец) AS последний
FROM таблица
WHERE условие;
```

- В `WHERE` можно всё из прошлого урока: `AND`, `OR`, `IN`, `BETWEEN`, `LIKE`, `IS NULL`.
- Если ни одна строка не подошла, `count` вернёт `0`, а `sum`, `avg`, `min` и `max` — `NULL`: складывать нечего.

Сколько заказов отправлено, когда был первый и последний из них:

```sql example
SELECT count(*)        AS shipped,
       min(created_at) AS first_shipped,
       max(created_at) AS last_shipped
FROM orders
WHERE status = 'shipped';
```

| shipped | first_shipped | last_shipped |
|---|---|---|
| 5 | 2024-01-15 10:20:00 | 2024-03-22 12:00:00 |

Заказа № 100 нет, поэтому подходящих строк ноль:

```sql example
SELECT count(*)      AS lines,
       sum(quantity) AS units
FROM order_items
WHERE order_id = 100;
```

| lines | units |
|---|---|
| 0 | NULL |

### DISTINCT — без повторов

`SELECT DISTINCT` убирает из результата одинаковые строки: каждое значение остаётся один раз.

```sql
SELECT DISTINCT столбец
FROM таблица
WHERE условие
ORDER BY столбец;
```

- `DISTINCT` пишут сразу после `SELECT`.
- Если столбцов несколько, `SELECT DISTINCT a, b` оставляет уникальные сочетания `a` и `b`.
- `NULL` тоже попадает в результат — одной отдельной строкой. Если пустые значения не нужны, уберите их в `WHERE … IS NOT NULL`.
- `WHERE` и `ORDER BY` работают как обычно.

Какие статусы заказов встречаются в базе:

```sql example
SELECT DISTINCT status
FROM orders
ORDER BY status;
```

| status |
|---|
| cancelled |
| new |
| paid |
| shipped |

У каких категорий есть подкатегории. Строка `NULL` — это разделы без родителя; при сортировке по возрастанию она идёт последней.

```sql example
SELECT DISTINCT parent_id
FROM categories
ORDER BY parent_id;
```

| parent_id |
|---|
| 1 |
| 2 |
| NULL |

### count(DISTINCT столбец)

`count(DISTINCT столбец)` считает, сколько в столбце разных значений. `NULL` при этом не считается.

```sql
SELECT count(DISTINCT столбец) AS разных
FROM таблица;
```

- `DISTINCT` пишут внутри скобок, перед столбцом.
- `count(столбец)` считает заполненные строки с повторами, `count(DISTINCT столбец)` — без повторов.

В 20 строках заказов встречаются 12 разных товаров:

```sql example
SELECT count(*)                   AS lines,
       count(DISTINCT product_id) AS products
FROM order_items;
```

| lines | products |
|---|---|
| 20 | 12 |

### Деление целых чисел и `::numeric`

`count` возвращает целое число, `sum` от целого столбца — тоже. А при делении целого на целое PostgreSQL отбрасывает дробную часть: `7 / 2` равно `3`. Чтобы получить точный результат, одно из чисел приводят к типу `numeric` — точному дробному числу.

```sql
SELECT round(выражение::numeric / делитель, 2) AS имя
FROM таблица;
```

- `значение::тип` — приведение типа: `7::numeric` — это число 7 типа `numeric`. Перед именем типа два двоеточия, без пробелов.
- Приводить нужно до деления. `count(*)::numeric / 3` даёт дробь, а `(count(*) / 3)::numeric` — уже обрезанное целое.
- `numeric / целое` даёт длинный хвост знаков, поэтому результат обычно оборачивают в `round(…, 2)`.
- `SELECT` можно писать без `FROM`, как калькулятор: `SELECT 7 / 2;`.

```sql example
SELECT 7 / 2                    AS int_div,
       7::numeric / 2           AS num_div,
       round(7::numeric / 3, 2) AS rounded;
```

| int_div | num_div | rounded |
|---|---|---|
| 3 | 3.5000000000000000 | 2.33 |

Сколько штук товара в среднем в одном заказе. Без приведения получается 4 вместо 4.17:

```sql example
SELECT sum(quantity)                                              AS units,
       count(DISTINCT order_id)                                   AS orders,
       sum(quantity) / count(DISTINCT order_id)                   AS wrong,
       round(sum(quantity)::numeric / count(DISTINCT order_id), 2) AS units_per_order
FROM order_items;
```

| units | orders | wrong | units_per_order |
|---|---|---|---|
| 50 | 12 | 4 | 4.17 |

### Частые ошибки

- `SELECT name, max(price) FROM products` → `SELECT max(price) FROM products`. Агрегат даёт одну строку, а `name` — по строке на товар; PostgreSQL не знает, какое имя взять, и выдаёт ошибку. Обычный столбец рядом с агрегатом выводят через `GROUP BY` — это следующий урок.
- `(sum(quantity) / count(*))::numeric` → `sum(quantity)::numeric / count(*)`. Приведение после деления опоздало: дробная часть уже отброшена.
- `round(avg(price))`, когда нужны копейки → `round(avg(price), 2)`. Без второго аргумента число округляется до целого.
- `SELECT DISTINCT parent_id FROM categories`, когда пустые не нужны → добавьте `WHERE parent_id IS NOT NULL`. `DISTINCT` оставляет `NULL` отдельной строкой.

### Шпаргалка

```sql
count(*)                     -- число строк
count(столбец)               -- число строк, где столбец не NULL
count(DISTINCT столбец)      -- число разных значений
sum(a * b), avg(x)           -- сумма выражения, среднее
min(x), max(x)               -- работают и с датами, и с текстом
round(avg(x), 2)             -- округлить до 2 знаков
count(*)::numeric / n        -- деление без потери дробной части
SELECT DISTINCT столбец FROM таблица ORDER BY столбец;
```

## task w2-agg-count-choice
```json
{
  "type": "choice",
  "title": "Три счётчика",
  "xp": 5,
  "options": [
    "8, 7, 4",
    "8, 8, 4",
    "8, 7, 5",
    "8, 8, 5"
  ],
  "answer": [0],
  "explanation": "`count(*)` считает строки — их 8. `count(city)` пропускает `NULL`, поэтому клиент без города не учитывается — 7. `count(DISTINCT city)` считает разные известные значения: Казань, Москва, Самара, Екатеринбург — 4. `NULL` не считается ни отдельным городом, ни повтором.",
  "hints": [
    "См. разделы «count(*) и count(столбец)» и «count(DISTINCT столбец)»: какие из трёх функций смотрят на значение в столбце, а какая — только на число строк?"
  ]
}
```
Таблица `customers (id, full_name, email, city, registered_on)`. В ней 8 клиентов: двое из Казани, двое из Москвы, двое из Самары, один из Екатеринбурга, а у одного город не указан (`NULL`). Что вернёт запрос?

```sql
SELECT count(*), count(city), count(DISTINCT city)
FROM customers;
```

## task w2-agg-price-stats
```json
{
  "type": "result",
  "title": "Сводка по ценам",
  "xp": 15,
  "dataset": "shop",
  "hints": [
    "См. разделы «Агрегатные функции» и «round — округление»: все четыре значения считаются в одном `SELECT` без `WHERE`.",
    "`count(*) AS products, min(…) AS min_price, max(…) AS max_price, round(avg(…), …) AS avg_price`"
  ]
}
```
Директор просит сводку по ценам всего каталога. Таблица `products (id, name, category_id, price, stock)`. Выведите одной строкой:

- `products` — сколько товаров в каталоге;
- `min_price` и `max_price` — самая низкая и самая высокая цена;
- `avg_price` — средняя цена, округлённая до 2 знаков после точки.

```sql starter
SELECT count(*) AS products,
       … AS min_price,
       … AS max_price,
       … AS avg_price
FROM products;
```

```sql solution
SELECT count(*)              AS products,
       min(price)            AS min_price,
       max(price)            AS max_price,
       round(avg(price), 2)  AS avg_price
FROM products;
```

## task w2-agg-stock-value
```json
{
  "type": "result",
  "title": "Склад канцелярии",
  "xp": 10,
  "dataset": "shop",
  "hints": [
    "См. разделы «sum, avg, min, max» и «WHERE перед подсчётом»: внутри `sum` можно писать выражение, а `WHERE` отбирает строки до подсчёта.",
    "`SELECT sum(…) AS units, sum(… * …) AS stock_value FROM products WHERE category_id IN (…);`"
  ]
}
```
Бухгалтерии нужна оценка склада канцелярии — товаров из категорий с `id` 5 и 6. Таблица `products (id, name, category_id, price, stock)`. Выведите одной строкой:

- `units` — сколько всего штук этих товаров лежит на складе (сумма `stock`);
- `stock_value` — на какую сумму: сложите `price * stock` по всем этим товарам.

```sql starter
SELECT sum(…) AS units,
       sum(…) AS stock_value
FROM products
WHERE …;
```

```sql solution
SELECT sum(stock)          AS units,
       sum(price * stock)  AS stock_value
FROM products
WHERE category_id IN (5, 6);
```

## task w2-agg-cities
```json
{
  "type": "result",
  "title": "Города клиентов",
  "xp": 10,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «DISTINCT — без повторов»: клиент без города даст отдельную строку с `NULL` — её нужно отфильтровать.",
    "`SELECT DISTINCT … FROM customers WHERE … IS NOT NULL ORDER BY …;`"
  ]
}
```
Отдел логистики выбирает, где открыть пункты выдачи. Таблица `customers (id, full_name, email, city, registered_on)`. Выведите столбец `city` — список городов, где живут клиенты, без повторов и без пустых значений, по алфавиту.

```sql solution
SELECT DISTINCT city
FROM customers
WHERE city IS NOT NULL
ORDER BY city;
```

## task w2-agg-repeat-rate
```json
{
  "type": "result",
  "title": "Возвращаемость покупателей",
  "xp": 20,
  "dataset": "shop",
  "hints": [
    "См. разделы «count(DISTINCT столбец)» и «Деление целых чисел и `::numeric`»: `count` возвращает целое число, а деление двух целых отбрасывает дробную часть.",
    "`round(count(*)::numeric / count(DISTINCT …), 2) AS orders_per_customer`, а отменённые заказы убирает `WHERE status <> '…'`."
  ]
}
```
Сколько заказов в среднем делает один покупатель? Считайте только заказы, которые не отменены (`status` не равен `'cancelled'`). Таблица `orders (id, customer_id, status, created_at)`. Выведите одной строкой:

- `orders` — число таких заказов;
- `customers` — сколько разных клиентов их сделали;
- `orders_per_customer` — сколько заказов приходится на одного клиента (`orders`, делённое на `customers`), с округлением до 2 знаков.

```sql solution
SELECT count(*)                    AS orders,
       count(DISTINCT customer_id) AS customers,
       round(count(*)::numeric / count(DISTINCT customer_id), 2) AS orders_per_customer
FROM orders
WHERE status <> 'cancelled';
```
