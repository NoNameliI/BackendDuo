# Агрегатные функции

Директор «Полки» не листает таблицы: ему нужны итоги. Сколько товаров в каталоге, какая средняя цена, сколько разных клиентов делали заказы. **Агрегатная функция** сворачивает много строк в одно значение.

- `count(*)` — число строк. `count(столбец)` — число строк, где в этом столбце не `NULL`.
- `sum`, `avg`, `min`, `max` — сумма, среднее, минимум и максимум. `NULL` они пропускают: среднее считается только по известным значениям.
- `avg` возвращает число с длинным хвостом знаков, например `584.0750000000`. Округляйте явно: `round(avg(price), 2)`.
- `DISTINCT` убирает повторы: `SELECT DISTINCT city` — города без дублей, `count(DISTINCT customer_id)` — сколько разных клиентов.
- Если подходящих строк нет, `count` вернёт 0, а `sum` и `avg` — `NULL`.

```sql
SELECT count(*)                    AS orders,
       count(DISTINCT customer_id) AS customers,
       min(created_at)             AS first_order
FROM orders
WHERE status = 'paid';
```

`WHERE` срабатывает до агрегации: в итог попадают только отфильтрованные строки. Обычный столбец рядом с агрегатом без `GROUP BY` вывести нельзя — об этом следующий урок.

Осторожно с делением: `count(*)` возвращает целое число, а `7 / 2` в PostgreSQL равно `3`. Приведите одно из чисел к `numeric`: `7::numeric / 2` даёт `3.5`.

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
  "hints": ["Какие из трёх функций смотрят на значение в столбце, а какая — только на число строк?"]
}
```
В таблице `customers` 8 клиентов: двое из Казани, двое из Москвы, двое из Самары, один из Екатеринбурга, а у одного город не указан (`NULL`). Что вернёт запрос?

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
    "Все четыре значения считаются в одном `SELECT` без `WHERE` и `GROUP BY`.",
    "`SELECT count(*) AS products, min(price) AS min_price, max(price) AS max_price, round(avg(price), 2) AS avg_price FROM products;`"
  ]
}
```
Директор просит сводку по ценам всего каталога. Таблица `products (id, name, category_id, price, stock)`. Выведите одной строкой:

- `products` — сколько товаров в каталоге;
- `min_price` и `max_price` — самая низкая и самая высокая цена;
- `avg_price` — средняя цена, округлённая до 2 знаков после запятой.

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
    "Внутри `sum` можно писать выражение: `sum(price * stock)`.",
    "`SELECT sum(stock) AS units, sum(price * stock) AS stock_value FROM products WHERE category_id IN (5, 6);`"
  ]
}
```
Бухгалтерии нужна оценка склада канцелярии — товаров из категорий с `id` 5 и 6. Таблица `products (id, name, category_id, price, stock)`. Выведите одной строкой:

- `units` — сколько всего штук этих товаров лежит на складе;
- `stock_value` — на какую сумму: сложите `price * stock` по всем этим товарам.

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
    "Повторы убирает `SELECT DISTINCT`. Клиент без города даст строку с `NULL` — её нужно отфильтровать.",
    "`SELECT DISTINCT city FROM customers WHERE city IS NOT NULL ORDER BY city;`"
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
    "Разных клиентов считает `count(DISTINCT customer_id)`. Деление двух целых чисел отбрасывает дробную часть.",
    "`round(count(*)::numeric / count(DISTINCT customer_id), 2) AS orders_per_customer`"
  ]
}
```
Сколько заказов в среднем делает один покупатель? Считайте только заказы, которые не отменены (`status` не равен `'cancelled'`). Таблица `orders (id, customer_id, status, created_at)`. Выведите одной строкой:

- `orders` — число таких заказов;
- `customers` — сколько разных клиентов их сделали;
- `orders_per_customer` — сколько заказов приходится на одного клиента, с округлением до 2 знаков.

```sql solution
SELECT count(*)                    AS orders,
       count(DISTINCT customer_id) AS customers,
       round(count(*)::numeric / count(DISTINCT customer_id), 2) AS orders_per_customer
FROM orders
WHERE status <> 'cancelled';
```
