# Вступительный тест

Двенадцать вопросов в четырёх блоках, от простого к сложному. Есть теория и короткие запросы в песочнице. Блок засчитывается при двух верных ответах из трёх. На первом незачтённом блоке тест заканчивается: с этой темы вы и начнёте. Не знаете ответа — смело жмите «Не знаю».

## task p-crud-where
```json
{
  "type": "choice",
  "title": "Фильтр и сортировка",
  "options": [
    "`SELECT * FROM products WHERE price > 500 ORDER BY price DESC;`",
    "`SELECT * FROM products ORDER BY price DESC WHERE price > 500;`",
    "`SELECT * FROM products WHERE price > 500 ORDER BY price;`",
    "`SELECT * FROM products HAVING price > 500 ORDER BY price DESC;`"
  ],
  "answer": [0],
  "explanation": "WHERE идёт до ORDER BY, а DESC сортирует по убыванию. HAVING фильтрует группы после GROUP BY, а не отдельные строки.",
  "hints": ["Порядок частей запроса: SELECT … FROM … WHERE … ORDER BY."]
}
```
Какой запрос вернёт товары дороже 500 ₽, начиная с самых дорогих?

## task p-crud-update
```json
{
  "type": "choice",
  "title": "UPDATE без условия",
  "options": [
    "Обнулит остаток только у первого товара",
    "Обнулит остаток у всех товаров",
    "Завершится ошибкой: не хватает WHERE",
    "Ничего не изменит, пока не выполнен COMMIT"
  ],
  "answer": [1],
  "explanation": "UPDATE без WHERE меняет все строки таблицы. Каждая команда вне явной транзакции фиксируется сразу.",
  "hints": ["Какие строки выбирает отсутствующее условие?"]
}
```
Что сделает запрос `UPDATE products SET stock = 0;`?

## task p-crud-sql
```json
{
  "type": "result",
  "title": "Клиенты из двух городов",
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": ["`WHERE city IN ('Казань', 'Самара')`, затем ORDER BY и LIMIT."]
}
```
Таблица `customers (id, full_name, email, city, registered_on)`. Выведите `full_name` и `email` клиентов из Казани и Самары в алфавитном порядке имён, не больше трёх строк.

```sql solution
SELECT full_name, email
FROM customers
WHERE city IN ('Казань', 'Самара')
ORDER BY full_name
LIMIT 3;
```

## task p-agg-having
```json
{
  "type": "choice",
  "title": "WHERE и HAVING",
  "options": [
    "WHERE фильтрует строки до группировки, HAVING — группы после GROUP BY",
    "Ничем: это синонимы",
    "HAVING работает только вместе с JOIN",
    "В WHERE можно использовать агрегатные функции, а в HAVING — нет"
  ],
  "answer": [0],
  "explanation": "WHERE отбирает строки до того, как они попадут в группы. HAVING проверяет готовые группы, поэтому в нём можно писать условия вроде `count(*) > 2`.",
  "hints": ["Подумайте, в какой момент выполнения запроса существуют группы."]
}
```
Чем HAVING отличается от WHERE?

## task p-agg-count
```json
{
  "type": "choice",
  "title": "count и NULL",
  "options": ["8", "7", "NULL", "Ошибку"],
  "answer": [1],
  "explanation": "`count(колонка)` считает только непустые значения, а `count(*)` — все строки.",
  "hints": ["Чем отличаются count(*) и count(колонка)?"]
}
```
В таблице `customers` восемь клиентов, у одного из них `city` равен NULL. Что вернёт `SELECT count(city) FROM customers;`?

## task p-agg-sql
```json
{
  "type": "result",
  "title": "Популярные статусы",
  "dataset": "shop",
  "hints": ["`GROUP BY status` и `HAVING count(*) > 2`; не забудьте псевдоним `AS orders_count`."]
}
```
Таблица `orders (id, customer_id, status, created_at)`. Для каждого статуса посчитайте число заказов: колонки `status` и `orders_count`. Оставьте только статусы, у которых заказов больше двух.

```sql solution
SELECT status, count(*) AS orders_count
FROM orders
GROUP BY status
HAVING count(*) > 2;
```

## task p-join-left
```json
{
  "type": "choice",
  "title": "Клиенты без заказов",
  "options": [
    "`customers INNER JOIN orders`",
    "`customers LEFT JOIN orders`",
    "`orders LEFT JOIN customers`",
    "`customers CROSS JOIN orders`"
  ],
  "answer": [1],
  "explanation": "LEFT JOIN сохраняет все строки левой таблицы. У клиентов без заказов колонки orders будут NULL.",
  "hints": ["Какая таблица должна сохраниться целиком?"]
}
```
Нужно вывести всех клиентов с их заказами, включая клиентов, которые ещё ничего не купили. Какое соединение подойдёт?

## task p-join-dup
```json
{
  "type": "choice",
  "title": "Повторы после JOIN",
  "options": [
    "У Анны три заказа, и JOIN даёт по строке на каждую пару «клиент — заказ»",
    "В таблице customers три записи с Анной",
    "В условии ON ошибка",
    "JOIN всегда дублирует строки"
  ],
  "answer": [0],
  "explanation": "Соединение строит строку для каждой подходящей пары. Чтобы получить клиента один раз, используйте DISTINCT, группировку или EXISTS.",
  "hints": ["Сколько строк orders подходит под условие ON для Анны?"]
}
```
Запрос `SELECT c.full_name FROM customers c JOIN orders o ON o.customer_id = c.id;` вернул «Анна Смирнова» три раза. Почему?

## task p-join-sql
```json
{
  "type": "result",
  "title": "Без единой покупки",
  "dataset": "shop",
  "hints": ["LEFT JOIN orders и условие `WHERE o.id IS NULL`, или NOT EXISTS."]
}
```
Таблицы `customers (id, full_name, …)` и `orders (id, customer_id, …)`. Выведите `full_name` клиентов, у которых нет ни одного заказа.

```sql solution
SELECT c.full_name
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL;
```

## task p-adv-window
```json
{
  "type": "choice",
  "title": "ROW_NUMBER",
  "options": [
    "Порядковый номер заказа у каждого клиента, по дате",
    "Общее число заказов клиента",
    "Номер строки во всей таблице",
    "Число клиентов"
  ],
  "answer": [0],
  "explanation": "PARTITION BY начинает нумерацию заново для каждого клиента, ORDER BY задаёт порядок внутри окна.",
  "hints": ["Что делает PARTITION BY с нумерацией?"]
}
```
Что вычислит `row_number() OVER (PARTITION BY customer_id ORDER BY created_at)` в запросе к таблице заказов?

## task p-adv-index
```json
{
  "type": "choice",
  "title": "Медленный поиск",
  "options": [
    "`CREATE INDEX ON orders (customer_id);`",
    "`VACUUM FULL orders;`",
    "Добавить в запрос ORDER BY",
    "Заменить `=` на `LIKE`"
  ],
  "answer": [0],
  "explanation": "Индекс по колонке фильтра позволяет найти нужные строки без чтения всей таблицы: в плане Seq Scan сменится на Index Scan.",
  "hints": ["Что заменяет Seq Scan в плане?"]
}
```
В таблице `orders` миллион строк. Запрос `… WHERE customer_id = 42` медленный, в плане Seq Scan. Что поможет сильнее всего?

## task p-adv-sql
```json
{
  "type": "result",
  "title": "Дороже среднего",
  "dataset": "shop",
  "hints": ["Коррелированный подзапрос: `WHERE p.price > (SELECT avg(price) FROM products WHERE category_id = p.category_id)`."]
}
```
Таблица `products (id, name, category_id, price, stock)`. Выведите `name` и `price` товаров, которые дороже средней цены товаров своей категории.

```sql solution
SELECT p.name, p.price
FROM products p
WHERE p.price > (
  SELECT avg(price) FROM products WHERE category_id = p.category_id
);
```
