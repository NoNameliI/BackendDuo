# Внешние соединения

`INNER JOIN` молча теряет строки без пары. В «Полке» есть клиент, который ни разу ничего не заказал, и в отчёте «заказы по клиентам» его не видно. А отделу удержания такие клиенты интереснее всех. Внешние соединения (`LEFT`, `RIGHT`, `FULL JOIN`) сохраняют строки без пары.

### LEFT JOIN

`LEFT JOIN` возвращает все пары, как `INNER JOIN`, и вдобавок каждую строку левой таблицы, которой пары не нашлось. В такой строке все столбцы правой таблицы равны `NULL`.

```sql
SELECT столбцы
FROM левая_таблица AS л
LEFT JOIN правая_таблица AS п ON п.внешний_ключ = л.id;
```

- Левая таблица — та, что написана в `FROM`. Её строки сохраняются все.
- Правая таблица — та, что после `LEFT JOIN`. Из неё берутся только строки-пары.
- `ON` работает как раньше: задаёт, какие строки считать парой.
- Можно писать и `LEFT OUTER JOIN` — это то же самое.

Те же строки, что в прошлом уроке. Левая таблица — `customers`:

| id | full_name |
|---|---|
| 1 | Анна Смирнова |
| 2 | Борис Петров |
| 8 | Захар Морозов |

Правая таблица — `orders`:

| id | customer_id | status |
|---|---|---|
| 1 | 1 | shipped |
| 2 | 2 | shipped |
| 3 | 1 | paid |

Результат `customers AS c LEFT JOIN orders AS o ON o.customer_id = c.id`:

| c.id | c.full_name | o.id | o.status |
|---|---|---|---|
| 1 | Анна Смирнова | 1 | shipped |
| 1 | Анна Смирнова | 3 | paid |
| 2 | Борис Петров | 2 | shipped |
| 8 | Захар Морозов | NULL | NULL |

Захар остался, а на месте столбцов заказа у него `NULL`.

Пример: все категории и их товары. У корневых категорий «Книги» и «Канцелярия» товаров нет, но они не пропали:

```sql example
SELECT c.name AS category, p.name AS product
FROM categories AS c
LEFT JOIN products AS p ON p.category_id = c.id
ORDER BY c.name, p.name;
```

| category | product |
|---|---|
| Канцелярия | NULL |
| Книги | NULL |
| Нон-фикшн | Sapiens |
| Нон-фикшн | Думай медленно, решай быстро |
| Нон-фикшн | Чистый код |

… всего 14 строк: 12 товаров и 2 категории без товаров.

### Подсчёт после LEFT JOIN

Чтобы посчитать пары для каждой строки левой таблицы, к `LEFT JOIN` добавляют `GROUP BY` и `COUNT`. Важно, что именно считать.

```sql
SELECT л.столбец, COUNT(п.id) AS имя
FROM левая_таблица AS л
LEFT JOIN правая_таблица AS п ON п.внешний_ключ = л.id
GROUP BY л.id, л.столбец;
```

- `COUNT(п.id)` считает только строки, где `п.id` не `NULL`, то есть настоящие пары. У строки без пары получится 0.
- `COUNT(*)` считает все строки результата, включая строку-заглушку из `NULL`. У строки без пары получится 1 — это ошибка.
- Внутрь `COUNT` ставьте столбец правой таблицы, который никогда не бывает пустым у настоящей строки, — обычно её `id`.

Пример: число товаров в каждой категории. Для сравнения выведены оба варианта подсчёта:

```sql example
SELECT c.name AS category, COUNT(p.id) AS products_count, COUNT(*) AS rows_count
FROM categories AS c
LEFT JOIN products AS p ON p.category_id = c.id
GROUP BY c.id, c.name
ORDER BY c.name;
```

| category | products_count | rows_count |
|---|---|---|
| Канцелярия | 0 | 1 |
| Книги | 0 | 1 |
| Нон-фикшн | 3 | 3 |
| Ручки и карандаши | 3 | 3 |
| Тетради и блокноты | 3 | 3 |
| Художественная литература | 3 | 3 |

Правильный ответ — в `products_count`.

### RIGHT JOIN и FULL JOIN

`RIGHT JOIN` — зеркало `LEFT JOIN`: сохраняются все строки правой таблицы. Его почти всегда переписывают в `LEFT JOIN`, поменяв таблицы местами: так запрос читается слева направо.

```sql
FROM левая AS л RIGHT JOIN правая AS п ON условие   -- все строки правой
FROM левая AS л FULL JOIN правая AS п ON условие    -- все строки обеих таблиц
```

- `a RIGHT JOIN b` даёт то же, что `b LEFT JOIN a`.
- `FULL JOIN` возвращает пары, строки левой таблицы без пары (справа `NULL`) и строки правой таблицы без пары (слева `NULL`).

Тот же список категорий, но через `RIGHT JOIN` — снова 14 строк:

```sql example
SELECT COUNT(*) AS rows_count
FROM products AS p
RIGHT JOIN categories AS c ON c.id = p.category_id;
```

| rows_count |
|---|
| 14 |

`FULL JOIN` удобен для сверки двух списков. Создадим учебную таблицу с планом продаж по городам:

```sql example
CREATE TABLE demo_city_plans (
  city text PRIMARY KEY,
  target int NOT NULL
);
INSERT INTO demo_city_plans (city, target) VALUES
  ('Москва', 3), ('Казань', 2), ('Сочи', 1);
```

Сверим план с городами клиентов:

```sql example
SELECT pl.city AS plan_city, pl.target, c.full_name, c.city
FROM demo_city_plans AS pl
FULL JOIN customers AS c ON c.city = pl.city
ORDER BY pl.city, c.full_name;
```

| plan_city | target | full_name | city |
|---|---|---|---|
| Казань | 2 | Анна Смирнова | Казань |
| Казань | 2 | Вера Ким | Казань |
| Москва | 3 | Борис Петров | Москва |
| Москва | 3 | Дарья Лебедева | Москва |
| Сочи | 1 | NULL | NULL |
| NULL | NULL | Глеб Орлов | Самара |
| NULL | NULL | Егор Новиков | NULL |
| NULL | NULL | Жанна Волкова | Екатеринбург |
| NULL | NULL | Захар Морозов | Самара |

В Сочи план есть, а клиентов нет. У клиентов из Самары и Екатеринбурга нет плана. У Егора город не указан: `NULL` ни с чем не равен, поэтому пары у него нет.

### Антисоединение: строки без пары

Часто нужны именно «сироты» — строки, у которых пары нет: клиенты без заказов, категории без товаров. Такой запрос называют **антисоединением**. Первый способ — `LEFT JOIN` и проверка, что пары не нашлось:

```sql
SELECT л.столбцы
FROM левая_таблица AS л
LEFT JOIN правая_таблица AS п ON п.внешний_ключ = л.id
WHERE п.id IS NULL;
```

- После `LEFT JOIN` у строки без пары все столбцы правой таблицы равны `NULL`.
- `WHERE п.id IS NULL` оставляет только такие строки. Проверяйте столбец, который у настоящей строки всегда заполнен, — первичный ключ.
- Сравнение `= NULL` не работает, нужно `IS NULL`.

```sql example
SELECT c.name
FROM categories AS c
LEFT JOIN products AS p ON p.category_id = c.id
WHERE p.id IS NULL
ORDER BY c.name;
```

| name |
|---|
| Канцелярия |
| Книги |

Второй способ — `NOT EXISTS` с подзапросом:

```sql
SELECT столбцы
FROM таблица AS т
WHERE NOT EXISTS (
  SELECT 1 FROM другая_таблица AS д WHERE д.внешний_ключ = т.id
);
```

- Подзапрос — запрос в скобках внутри другого запроса. Он проверяется для каждой строки внешней таблицы и может использовать её псевдоним `т`.
- `EXISTS (…)` истинно, если подзапрос вернул хотя бы одну строку. `NOT EXISTS (…)` — если ни одной.
- `SELECT 1`: что именно выбирать, неважно, проверяется только наличие строк.
- Подробно подзапросы разберём в четвёртом мире. Оба способа дают одинаковый результат.

```sql example
SELECT c.name
FROM categories AS c
WHERE NOT EXISTS (
  SELECT 1 FROM products AS p WHERE p.category_id = c.id
)
ORDER BY c.name;
```

| name |
|---|
| Канцелярия |
| Книги |

### Условие в ON или в WHERE

Для `INNER JOIN` всё равно, куда написать дополнительное условие. Для `LEFT JOIN` — нет.

- Условие в `ON` решает, какие строки справа считать парой. Строки левой таблицы сохраняются в любом случае; если подходящей пары нет, справа будет `NULL`.
- Условие в `WHERE` фильтрует уже готовый результат. У строки без пары столбцы правой таблицы равны `NULL`, сравнение с `NULL` не даёт «истину», и `WHERE` выбрасывает строку. `LEFT JOIN` незаметно превращается во внутреннее соединение.
- Правило: условие на правую таблицу пишут в `ON` через `AND`. В `WHERE` остаются условия на левую таблицу и проверка `IS NULL` для антисоединения.

```sql
LEFT JOIN правая AS п ON п.внешний_ключ = л.id AND п.столбец = значение
```

Посмотрим на тех же клиентах, нужны только оплаченные заказы (`status = 'paid'`).

Условие в `ON`: `LEFT JOIN orders AS o ON o.customer_id = c.id AND o.status = 'paid'`

| c.full_name | o.id | o.status |
|---|---|---|
| Анна Смирнова | 3 | paid |
| Борис Петров | NULL | NULL |
| Захар Морозов | NULL | NULL |

Условие в `WHERE`: `LEFT JOIN orders AS o ON o.customer_id = c.id WHERE o.status = 'paid'`

| c.full_name | o.id | o.status |
|---|---|---|
| Анна Смирнова | 3 | paid |

Борис и Захар пропали: в этом фрагменте у Бориса только отгруженный заказ, а у Захара заказов нет вовсе.

Пример на данных «Полки»: сколько дешёвых товаров (дешевле 100) в каждой категории. Условие на цену стоит в `ON`, и все 6 категорий на месте:

```sql example
SELECT c.name AS category, COUNT(p.id) AS cheap_count
FROM categories AS c
LEFT JOIN products AS p ON p.category_id = c.id AND p.price < 100
GROUP BY c.id, c.name
ORDER BY c.name;
```

| category | cheap_count |
|---|---|
| Канцелярия | 0 |
| Книги | 0 |
| Нон-фикшн | 0 |
| Ручки и карандаши | 2 |
| Тетради и блокноты | 1 |
| Художественная литература | 0 |

То же условие в `WHERE` оставляет только 2 категории:

```sql example
SELECT c.name AS category, COUNT(p.id) AS cheap_count
FROM categories AS c
LEFT JOIN products AS p ON p.category_id = c.id
WHERE p.price < 100
GROUP BY c.id, c.name
ORDER BY c.name;
```

| category | cheap_count |
|---|---|
| Ручки и карандаши | 2 |
| Тетради и блокноты | 1 |

Антисоединение тоже может искать «нет пары с условием». Категории, в которых нет товаров дороже 1000: условие на цену — в `ON`, проверка `IS NULL` — в `WHERE`.

```sql example
SELECT c.name
FROM categories AS c
LEFT JOIN products AS p
  ON p.category_id = c.id
 AND p.price > 1000
WHERE p.id IS NULL
ORDER BY c.name;
```

| name |
|---|
| Канцелярия |
| Книги |
| Ручки и карандаши |
| Тетради и блокноты |

Если перенести `p.price > 1000` в `WHERE`, запрос не вернёт ни одной строки: у строки, где `p.id IS NULL`, цена тоже `NULL`.

### Диапазон дат и времени

Столбец `orders.created_at` имеет тип `timestamp` — дата и время, например `2024-02-03 09:40:00`. Его сравнивают со строкой даты в формате `'ГГГГ-ММ-ДД'`; такая строка означает полночь этого дня.

```sql
WHERE столбец >= 'первый_день' AND столбец < 'первый_день_следующего_периода'
```

- `>= '2024-02-01'` — с полуночи 1 февраля включительно.
- `< '2024-03-01'` — строго до полуночи 1 марта, то есть весь последний день февраля вместе с вечером.
- `<= '2024-02-29'` было бы ошибкой: это полночь 29 февраля, и заказ, оформленный 29 февраля в 15:00, не попал бы в выборку. По той же причине для `timestamp` не подходит `BETWEEN`: правая граница включается, но это тоже полночь.
- Дата пишется в одинарных кавычках, части — через дефис.

```sql example
SELECT id, customer_id, created_at
FROM orders
WHERE created_at >= '2024-02-01' AND created_at < '2024-03-01'
ORDER BY id;
```

| id | customer_id | created_at |
|---|---|---|
| 3 | 1 | 2024-02-03 09:40:00 |
| 4 | 3 | 2024-02-10 14:15:00 |
| 5 | 4 | 2024-02-21 11:00:00 |

Такой диапазон можно поставить и в `ON` после `LEFT JOIN`, если нужны пары только за период.

### Self-join: таблица с самой собой

Иногда пару для строки нужно искать в той же таблице. Тогда таблицу пишут в запросе дважды под разными псевдонимами. Каждая копия играет свою роль.

```sql
SELECT а.столбец, б.столбец AS другое_имя
FROM таблица AS а
JOIN таблица AS б ON условие_между_а_и_б;
```

- Псевдонимы обязательны и должны различаться: по ним PostgreSQL понимает, о какой копии речь.
- Одинаковые имена столбцов в результате разводят через `AS`.
- Если таблица ссылается сама на себя (столбец-ссылка на `id` этой же таблицы), условие выглядит как `б.id = а.ссылка`.
- Если у части строк ссылка пустая (`NULL`) и такие строки нужны в результате, вместо `JOIN` пишут `LEFT JOIN`.

Пример: клиенты из одного города, по парам. Копия `a` — первый клиент, копия `b` — второй. Условие `b.id > a.id` убирает пару клиента с самим собой и повтор пары в обратном порядке.

Строки до соединения (обе копии одинаковые):

| id | full_name | city |
|---|---|---|
| 1 | Анна Смирнова | Казань |
| 2 | Борис Петров | Москва |
| 3 | Вера Ким | Казань |

Условию `b.city = a.city AND b.id > a.id` отвечает одна пара: `a` — Анна (1), `b` — Вера (3). Пары «Анна — Анна», «Вера — Вера» и «Вера — Анна» отброшены условием на `id`, а Борису в этом фрагменте пары нет.

```sql example
SELECT a.full_name, b.full_name AS neighbour, a.city
FROM customers AS a
JOIN customers AS b ON b.city = a.city AND b.id > a.id
ORDER BY a.city, a.full_name;
```

| full_name | neighbour | city |
|---|---|---|
| Анна Смирнова | Вера Ким | Казань |
| Борис Петров | Дарья Лебедева | Москва |
| Глеб Орлов | Захар Морозов | Самара |

### Частые ошибки

- `LEFT JOIN orders AS o ON o.customer_id = c.id WHERE o.status = 'shipped'` → клиенты без отгруженных заказов пропадают. Условие на правую таблицу пишите в `ON`: `ON o.customer_id = c.id AND o.status = 'shipped'`.
- `COUNT(*)` после `LEFT JOIN` → у строки без пары получается 1. Правильно: `COUNT(п.id)`.
- `WHERE p.id = NULL` → не вернёт ни одной строки, сравнение с `NULL` никогда не истинно. Правильно: `WHERE p.id IS NULL`.
- `created_at <= '2024-03-31'` → теряются заказы 31 марта после полуночи. Правильно: `created_at < '2024-04-01'`.

### Шпаргалка

```sql
FROM л LEFT JOIN п ON п.ссылка = л.id                 -- все строки слева, справа NULL
FROM л RIGHT JOIN п ON …  /  FROM л FULL JOIN п ON …  -- все справа / все с обеих сторон
COUNT(п.id)                                           -- 0 для строк без пары
LEFT JOIN п ON п.ссылка = л.id WHERE п.id IS NULL     -- строки без пары
WHERE NOT EXISTS (SELECT 1 FROM п WHERE п.ссылка = л.id)
LEFT JOIN п ON п.ссылка = л.id AND п.столбец = значение   -- фильтр правой таблицы
WHERE ts >= '2024-02-01' AND ts < '2024-03-01'        -- весь февраль
FROM т AS а JOIN т AS б ON б.id = а.ссылка            -- self-join
```

## task w3-orders-per-customer
```json
{
  "type": "result",
  "title": "Заказы каждого клиента",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «Подсчёт после LEFT JOIN»: нужен `LEFT JOIN` от `customers` к `orders`, `GROUP BY` по клиенту и `COUNT` по столбцу правой таблицы.",
    "`SELECT c.full_name, COUNT(o.…) AS orders_count FROM customers AS c LEFT JOIN orders AS o ON … GROUP BY c.id, … ORDER BY orders_count DESC, …;`"
  ]
}
```
Отдел удержания хочет видеть всех клиентов, включая тех, кто ничего не заказывал. Таблицы:

- `customers (id, full_name, email, city, registered_on)` — клиенты;
- `orders (id, customer_id, status, created_at)` — заказы, `customer_id` ссылается на `customers.id`.

Выведите два столбца: `full_name` и `orders_count` — число заказов клиента в любом статусе. У клиентов без заказов должен быть 0.

Сортировка: по убыванию `orders_count`, при равенстве — по `full_name` по возрастанию.

```sql solution
SELECT c.full_name, COUNT(o.id) AS orders_count
FROM customers AS c
LEFT JOIN orders AS o ON o.customer_id = c.id
GROUP BY c.id, c.full_name
ORDER BY orders_count DESC, c.full_name;
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
    "См. раздел «Self-join: таблица с самой собой»: подключите `categories` второй раз под другим псевдонимом и соедините по `parent_id`. Корневые категории не должны пропасть.",
    "`SELECT c.name AS category, p.name AS … FROM categories AS c LEFT JOIN categories AS p ON p.id = … ORDER BY …;`"
  ]
}
```
Для меню сайта нужен список категорий с родителями. Таблица `categories (id, name, parent_id)`: `parent_id` хранит `id` родительской категории из этой же таблицы, у корневых категорий он `NULL`.

Выведите два столбца: `category` — название категории и `parent` — название её родительской категории. У корневых категорий в `parent` должен быть `NULL`. Отсортируйте по `category`.

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
  "hints": ["См. раздел «Условие в ON или в WHERE»: что `WHERE` делает со строками, где все столбцы правой таблицы равны `NULL`?"]
}
```
Аналитик строит отчёт «сколько отгруженных заказов у каждого клиента». Таблицы `customers (id, full_name, …)` и `orders (id, customer_id, status, created_at)`. В отчёте должны быть все 8 клиентов, но запрос возвращает только 5. В чём ошибка?

```sql code
SELECT c.full_name,
       COUNT(o.id) AS shipped_orders
FROM customers AS c
LEFT JOIN orders AS o ON o.customer_id = c.id
WHERE o.status = 'shipped'
GROUP BY c.id, c.full_name
ORDER BY c.full_name;
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
    "См. разделы «Антисоединение: строки без пары», «Условие в ON или в WHERE» и «Диапазон дат и времени»: `LEFT JOIN` только к мартовским заказам и `WHERE o.id IS NULL`.",
    "`FROM customers AS c LEFT JOIN orders AS o ON o.customer_id = c.id AND o.created_at >= '…' AND o.created_at < '…' WHERE o.… IS NULL ORDER BY …;` — даты должны стоять в `ON`, а не в `WHERE`."
  ]
}
```
«Полка» отправляет промокод тем, кто не делал заказов в марте 2024 года. Таблицы:

- `customers (id, full_name, email, city, registered_on)` — клиенты;
- `orders (id, customer_id, status, created_at)` — заказы; `created_at` — дата и время оформления (`timestamp`).

Выведите два столбца, `full_name` и `email`, тех клиентов, у которых нет ни одного заказа, оформленного с 1 по 31 марта 2024 года включительно (статус не важен). Клиенты, у которых заказов нет вообще, тоже подходят. Отсортируйте по `full_name`.

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
