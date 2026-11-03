# Внешние соединения

`INNER JOIN` молча теряет строки без пары. В «Полке» есть клиент, который ни разу ничего не заказал, и в отчёте «заказы по клиентам» его не видно. А отделу удержания он интереснее всех.

`LEFT JOIN` сохраняет все строки левой таблицы. Если пары справа нет, столбцы правой таблицы заполняются `NULL`. `RIGHT JOIN` — то же зеркально; его обычно переписывают в `LEFT JOIN`, поменяв таблицы местами. `FULL JOIN` сохраняет строки обеих сторон.

**Антисоединение** находит «сирот» — строки без пары. Два равноценных способа:

```sql
SELECT c.full_name
FROM customers AS c
LEFT JOIN orders AS o ON o.customer_id = c.id
WHERE o.id IS NULL;

SELECT c.full_name
FROM customers AS c
WHERE NOT EXISTS (SELECT 1 FROM orders AS o WHERE o.customer_id = c.id);
```

**`ON` или `WHERE`.** Условие в `ON` решает, какие строки справа считать парой, а строки слева остаются в любом случае. `WHERE` фильтрует уже готовый результат. Условие на правую таблицу в `WHERE` отбрасывает строки с `NULL` и незаметно превращает `LEFT JOIN` во внутреннее соединение. Поэтому фильтр по правой таблице пишут в `ON`.

Считая пары, используйте `COUNT(o.id)`, а не `COUNT(*)`: `COUNT(*)` посчитает и строку-заглушку из `NULL`.

**Self-join** — соединение таблицы с самой собой. Категория хранит ссылку на родителя в `parent_id`. Чтобы вывести имя родителя, `categories` подключают второй раз под другим псевдонимом: одна копия играет роль категории, другая — её родителя.

## task w3-orders-per-customer
```json
{
  "type": "result",
  "title": "Заказы каждого клиента",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Нужен `LEFT JOIN` от `customers` к `orders` и `GROUP BY` по клиенту.",
    "Считайте `COUNT(o.id)`: у клиента без заказов `o.id` равен `NULL` и не учитывается, а `COUNT(*)` дал бы 1."
  ]
}
```
Отдел удержания хочет видеть всех клиентов, включая тех, кто ничего не заказывал. Выведите `full_name` и `orders_count` — число заказов клиента в любом статусе. У клиентов без заказов должен быть 0.

Сортировка: по убыванию `orders_count`, при равенстве — по `full_name`.

```sql solution
SELECT c.full_name, COUNT(o.id) AS orders_count
FROM customers AS c
LEFT JOIN orders AS o ON o.customer_id = c.id
GROUP BY c.id, c.full_name
ORDER BY orders_count DESC, c.full_name;
```

## task w3-march-inactive
```json
{
  "type": "result",
  "title": "Промокод для пропавших",
  "xp": 20,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Это поиск «сирот»: `LEFT JOIN` к мартовским заказам и `WHERE o.id IS NULL` — или `NOT EXISTS` с подзапросом.",
    "Даты пишите в `ON`: `ON o.customer_id = c.id AND o.created_at >= '2024-03-01' AND o.created_at < '2024-04-01'`. В `WHERE` это условие отбросит как раз нужных клиентов."
  ]
}
```
«Полка» отправляет промокод тем, кто не делал заказов в марте 2024 года. Выведите `full_name` и `email` клиентов, у которых нет ни одного заказа, оформленного (`created_at`) с 1 по 31 марта 2024 года включительно. Клиенты, у которых заказов нет вообще, тоже подходят. Отсортируйте по `full_name`.

```sql solution
SELECT c.full_name, c.email
FROM customers AS c
LEFT JOIN orders AS o
  ON o.customer_id = c.id
 AND o.created_at >= '2024-03-01'
 AND o.created_at < '2024-04-01'
WHERE o.id IS NULL
ORDER BY c.full_name;
```

## task w3-category-parents
```json
{
  "type": "result",
  "title": "Дерево категорий",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Подключите `categories` второй раз под другим псевдонимом и соедините по `parent_id`.",
    "`FROM categories AS c LEFT JOIN categories AS p ON p.id = c.parent_id` — `LEFT JOIN` нужен, чтобы не потерять корневые категории."
  ]
}
```
Для меню сайта нужен список категорий с родителями. Выведите `category` (название категории) и `parent` (название родительской категории). У корневых категорий в `parent` должен быть `NULL`. Отсортируйте по `category`.

```sql solution
SELECT c.name AS category, p.name AS parent
FROM categories AS c
LEFT JOIN categories AS p ON p.id = c.parent_id
ORDER BY c.name;
```

## task w3-review-left-where
```json
{
  "type": "review",
  "title": "Пропавшие клиенты",
  "xp": 10,
  "options": [
    "`COUNT(o.id)` нужно заменить на `COUNT(*)`",
    "Условие на `o.status` в `WHERE` отбрасывает строки с `NULL`, и `LEFT JOIN` работает как `INNER JOIN` — условие нужно перенести в `ON`",
    "`LEFT JOIN` нужно заменить на `RIGHT JOIN`, чтобы сохранить клиентов",
    "В `GROUP BY` нельзя указывать `c.id`, раз его нет в `SELECT`"
  ],
  "answer": [1],
  "lines": [5],
  "explanation": "У клиента без отгруженных заказов `LEFT JOIN` даёт либо строку, где `o.status` равен `NULL`, либо строки с другими статусами. Сравнение с `'shipped'` для них не истинно, и `WHERE` отбрасывает их вместе с клиентом. Правильно: `LEFT JOIN orders AS o ON o.customer_id = c.id AND o.status = 'shipped'` — тогда клиенты останутся, а `COUNT(o.id)` даст им 0. `COUNT(*)` насчитал бы клиенту без пары 1. `RIGHT JOIN` сохранил бы заказы, а не клиентов. Группировать по столбцу, которого нет в `SELECT`, можно.",
  "hints": ["Что `WHERE` делает со строками, где все столбцы правой таблицы равны `NULL`?"]
}
```
Аналитик строит отчёт «сколько отгруженных заказов у каждого клиента». В отчёте должны быть все 8 клиентов, но запрос возвращает только 5. В чём ошибка?

```sql code
SELECT c.full_name,
       COUNT(o.id) AS shipped_orders
FROM customers AS c
LEFT JOIN orders AS o ON o.customer_id = c.id
WHERE o.status = 'shipped'
GROUP BY c.id, c.full_name
ORDER BY c.full_name;
```
