# INNER JOIN

В «Полке» данные разложены по разным таблицам. Клиент записан один раз в `customers`, а каждый его заказ — отдельной строкой в `orders`. Курьеру в накладной нужны номер заказа, имя и город клиента, то есть столбцы из двух таблиц. Чтобы получить их в одном результате, таблицы **соединяют** — пишут `JOIN`.

### Связь один-ко-многим

Напоминание: в `orders` есть столбец `customer_id`. Это внешний ключ (`FOREIGN KEY`): он хранит `id` клиента из `customers`. У клиента может быть много заказов, а у заказа ровно один клиент. Такая связь называется **один-ко-многим**.

Возьмём по несколько строк из каждой таблицы.

Левая таблица — `customers`:

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

Заказы 1 и 3 принадлежат Анне (`customer_id = 1`), заказ 2 — Борису. У Захара заказов нет.

### INNER JOIN … ON

`JOIN` берёт строку левой таблицы, находит в правой все строки, для которых истинно условие после `ON`, и склеивает каждую такую пару в одну строку результата. Строки, которым пары не нашлось, в результат не попадают. `JOIN` и `INNER JOIN` — одно и то же; обычно пишут короче.

```sql
SELECT столбцы
FROM левая_таблица AS л
JOIN правая_таблица AS п ON п.внешний_ключ = л.id
WHERE условие
ORDER BY столбец;
```

- `FROM левая_таблица` — с какой таблицы начинаем, как и раньше.
- `JOIN правая_таблица` — какую таблицу подключаем. Пишется сразу после `FROM`.
- `ON условие` — по какому правилу строки становятся парой. Почти всегда это равенство внешнего ключа и первичного ключа. Порядок сторон в равенстве не важен: `п.customer_id = л.id` и `л.id = п.customer_id` работают одинаково.
- `AS л`, `AS п` — короткие имена таблиц, псевдонимы (о них — в следующем разделе).
- `WHERE` и `ORDER BY` идут после `JOIN` и работают уже со склеенными строками, поэтому в них доступны столбцы обеих таблиц.
- Точка с запятой ставится один раз — в конце всего запроса.

Соединим строки выше условием `ON o.customer_id = c.id`. Результат:

| c.id | c.full_name | o.id | o.status |
|---|---|---|---|
| 1 | Анна Смирнова | 1 | shipped |
| 1 | Анна Смирнова | 3 | paid |
| 2 | Борис Петров | 2 | shipped |

Анна встречается дважды: у неё две пары. Захар исчез: в `orders` нет строки с `customer_id = 8`.

Пример. Товар хранит только номер своей категории `category_id`, а название категории лежит в `categories`. Выведем товары категории «Нон-фикшн» вместе с названием категории:

```sql example
SELECT p.name, p.price, c.name AS category
FROM products AS p
JOIN categories AS c ON c.id = p.category_id
WHERE c.name = 'Нон-фикшн'
ORDER BY p.name;
```

| name | price | category |
|---|---|---|
| Sapiens | 890.00 | Нон-фикшн |
| Думай медленно, решай быстро | 760.00 | Нон-фикшн |
| Чистый код | 1450.00 | Нон-фикшн |

Текст в условии пишется в одинарных кавычках: `'Нон-фикшн'`.

### Псевдонимы таблиц

`FROM products AS p` даёт таблице короткое имя `p`. Дальше к её столбцам обращаются через точку.

```sql
FROM таблица AS псевдоним
JOIN другая_таблица AS другой_псевдоним ON …
SELECT псевдоним.столбец, другой_псевдоним.столбец AS новое_имя
```

- Псевдоним действует только внутри одного запроса. Обычно берут первые буквы: `orders AS o`, `customers AS c`, `order_items AS oi`.
- `псевдоним.столбец` — столбец конкретной таблицы: `p.name` — название товара, `c.name` — название категории.
- Префикс обязателен, если столбец с таким именем есть в обеих таблицах. В `products` и `categories` есть и `id`, и `name`. Просто `name` PostgreSQL не поймёт и ответит ошибкой `column reference "name" is ambiguous`.
- Если у таблицы есть псевдоним, её полное имя в этом запросе писать нельзя: вместо `products.name` нужно `p.name`.
- Префикс полезно писать всегда — так сразу видно, откуда столбец.
- Если в результате два столбца называются одинаково (`p.name` и `c.name`), одному дают новое имя: `c.name AS category`. Это псевдоним столбца из первого мира. Он тоже пишется через `AS`, но меняет заголовок в результате, а не имя таблицы.
- Слово `AS` перед псевдонимом таблицы можно не писать: `FROM products p` — то же самое, что `FROM products AS p`. В следующих уроках встретятся обе записи.

Тот же приём без `AS` — товары дороже 1000 ₽ с названием категории:

```sql example
SELECT p.name, c.name AS category
FROM products p
JOIN categories c ON c.id = p.category_id
WHERE p.price > 1000
ORDER BY p.name;
```

| name | category |
|---|---|
| Атлант расправил плечи | Художественная литература |
| Чистый код | Нон-фикшн |

### Сколько строк вернёт JOIN

В результате `JOIN` по одной строке на каждую пару, для которой выполнено условие `ON`:

- если левой строке подходят три строки справа — получится три строки;
- если не подходит ни одна — левая строка пропадает;
- то же со строками правой таблицы: строка без пары пропадает.

В «Полке» 6 категорий и 12 товаров. У каждого товара ровно одна категория, поэтому соединение даёт 12 строк — по одной на товар:

```sql example
SELECT COUNT(*) AS rows_count
FROM products AS p
JOIN categories AS c ON c.id = p.category_id;
```

| rows_count |
|---|
| 12 |

Какие категории попали в результат? `DISTINCT` уберёт повторы:

```sql example
SELECT DISTINCT c.name
FROM categories AS c
JOIN products AS p ON p.category_id = c.id
ORDER BY c.name;
```

| name |
|---|
| Нон-фикшн |
| Ручки и карандаши |
| Тетради и блокноты |
| Художественная литература |

Корневых категорий «Книги» и «Канцелярия» нет: товары ссылаются только на подкатегории, и корневым пары не нашлось. Как сохранить строки без пары, разберём в следующем уроке.

Соединение вообще без условия называется `CROSS JOIN`: каждая строка левой таблицы склеивается с каждой строкой правой. Для категорий и товаров это 6 × 12 = 72 строки, и почти всегда такой результат — ошибка. Обычный `JOIN` без `ON` PostgreSQL не примет.

### Соединение трёх таблиц

`order_items` хранит позиции заказов: `order_id`, `product_id`, `quantity` (количество) и `price` (цена на момент покупки). Название товара лежит в `products`, а название категории — в `categories`. Чтобы дойти от позиции до категории, `JOIN` пишут несколько раз подряд:

```sql
SELECT столбцы
FROM таблица1 AS а
JOIN таблица2 AS б ON б.id = а.ссылка_на_таблицу2
JOIN таблица3 AS в ON в.id = б.ссылка_на_таблицу3
WHERE условие
ORDER BY столбцы;
```

- Каждый `JOIN` присоединяет одну таблицу к тому, что уже собрано.
- В `ON` можно использовать любую таблицу, подключённую раньше.
- Между `JOIN` нет запятых. `WHERE` и `ORDER BY` пишутся после последнего `JOIN`.
- Путь ищут по внешним ключам: `order_items.product_id` → `products.id`, `products.category_id` → `categories.id`.

Пример: в каких заказах покупали ручки и карандаши и сколько штук.

```sql example
SELECT oi.order_id, p.name AS product, oi.quantity
FROM order_items AS oi
JOIN products AS p ON p.id = oi.product_id
JOIN categories AS c ON c.id = p.category_id
WHERE c.name = 'Ручки и карандаши'
ORDER BY oi.order_id, p.name;
```

| order_id | product | quantity |
|---|---|---|
| 3 | Ручка гелевая | 5 |
| 5 | Карандаш | 10 |
| 9 | Набор маркеров | 2 |
| 10 | Ручка гелевая | 3 |

`ORDER BY oi.order_id, p.name` сортирует по номеру заказа, а внутри одного заказа — по названию товара.

### JOIN и группировка

После соединений работают привычные агрегаты (`SUM`, `COUNT`), `GROUP BY` и сортировка по агрегату. Имена функций, как и ключевые слова, можно писать любыми буквами: `SUM` и `sum` — одна и та же функция. Части запроса идут строго в таком порядке:

```sql
SELECT столбец, агрегат(выражение) AS имя
FROM таблица1 AS а
JOIN таблица2 AS б ON условие
JOIN таблица3 AS в ON условие
WHERE условие_на_строки
GROUP BY а.id, столбец
ORDER BY имя DESC;
```

- `WHERE` отбрасывает строки до группировки. Например, `WHERE o.status <> 'paid'` оставит позиции всех заказов, кроме оплаченных.
- Внутри агрегата можно считать выражение: `SUM(oi.quantity * oi.price)` перемножает количество и цену в каждой строке группы и складывает результаты.
- Группируйте по `id` и по имени: `GROUP BY c.id, c.name`. Имя нужно, потому что оно стоит в `SELECT`. `id` нужен, потому что имена бывают одинаковыми: два клиента «Анна Смирнова» — разные люди, а `id` у них разный.
- В `ORDER BY` можно указать имя, заданное через `AS`: `ORDER BY revenue DESC`.

Пример: выручка по категориям — сумма `quantity * price` по всем проданным позициям.

```sql example
SELECT c.name AS category, SUM(oi.quantity * oi.price) AS revenue
FROM categories AS c
JOIN products AS p ON p.category_id = c.id
JOIN order_items AS oi ON oi.product_id = p.id
GROUP BY c.id, c.name
ORDER BY revenue DESC;
```

| category | revenue |
|---|---|
| Нон-фикшн | 5440.00 |
| Художественная литература | 4210.00 |
| Тетради и блокноты | 4149.70 |
| Ручки и карандаши | 1902.00 |

### Частые ошибки

- `SELECT id, full_name FROM orders AS o JOIN customers AS c ON …` → ошибка `column reference "id" is ambiguous`. Столбец `id` есть в обеих таблицах. Правильно: `SELECT o.id, c.full_name`.
- `FROM orders AS o … WHERE orders.status = 'paid'` → ошибка: после `AS o` таблица в этом запросе называется только `o`. Правильно: `WHERE o.status = 'paid'`.
- `ON c.id = o.id` → запрос выполнится, но склеит заказ № 3 с клиентом № 3, а не с его владельцем. Сравнивайте внешний ключ с первичным: `ON c.id = o.customer_id`.
- `FROM orders AS o WHERE o.status = 'paid' JOIN customers AS c ON …` → синтаксическая ошибка. Все `JOIN` идут сразу после `FROM`, а `WHERE` — после них.

### Шпаргалка

```sql
SELECT а.столбец, б.столбец AS новое_имя
FROM таблица1 AS а
JOIN таблица2 AS б ON б.ссылка = а.id      -- INNER JOIN: только пары
JOIN таблица3 AS в ON в.id = б.ссылка      -- третья таблица по цепочке
WHERE условие                              -- после всех JOIN
GROUP BY а.id, а.столбец                   -- id + столбцы из SELECT
ORDER BY агрегат_или_имя DESC;
```

## task w3-shipped-orders
```json
{
  "type": "result",
  "title": "Накладные для курьеров",
  "xp": 10,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «INNER JOIN … ON»: подключите `customers` к `orders` условием `c.id = o.customer_id`, а статус проверьте в `WHERE`.",
    "`SELECT o.id AS order_id, c.…, c.… FROM orders AS o JOIN customers AS c ON … WHERE o.status = '…' ORDER BY …;`"
  ]
}
```
Служба доставки сверяет отгруженные заказы. Таблицы:

- `orders (id, customer_id, status, created_at)` — заказы, `customer_id` ссылается на `customers.id`;
- `customers (id, full_name, email, city, registered_on)` — клиенты.

Для заказов в статусе `shipped` выведите три столбца: `order_id` — номер заказа (`orders.id`), `full_name` и `city` клиента. Отсортируйте по `order_id` по возрастанию.

```sql solution
SELECT o.id AS order_id, c.full_name, c.city
FROM orders AS o
JOIN customers AS c ON c.id = o.customer_id
WHERE o.status = 'shipped'
ORDER BY o.id;
```

## task w3-join-row-count
```json
{
  "type": "choice",
  "title": "Сколько строк",
  "xp": 5,
  "options": [
    "8 — по строке на клиента",
    "12 — по строке на заказ",
    "13 — все заказы плюс клиент без заказов",
    "96 — каждый клиент с каждым заказом"
  ],
  "answer": [1],
  "explanation": "`JOIN` склеивает каждый заказ с его единственным клиентом, поэтому строк столько же, сколько заказов, — 12. Клиент без заказов пары не находит и в результат не попадает: 13 строк дал бы `LEFT JOIN`. 8 строк получилось бы, только если бы у каждого клиента был ровно один заказ. 96 = 8 × 12 — это `CROSS JOIN`, соединение без условия.",
  "hints": ["См. раздел «Сколько строк вернёт JOIN»: посчитайте пары «клиент — заказ», для которых выполняется условие в `ON`."]
}
```
В `customers` 8 клиентов, в `orders` 12 заказов. У каждого заказа есть клиент, а у одного клиента нет ни одного заказа. Сколько строк вернёт запрос?

```sql
SELECT c.full_name, o.id
FROM customers AS c
JOIN orders AS o ON o.customer_id = c.id;
```

## task w3-paid-order-items
```json
{
  "type": "result",
  "title": "Сборка оплаченных заказов",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «Соединение трёх таблиц»: путь `orders` → `order_items` (по `order_id`) → `products` (по `product_id`). Статус проверьте в `WHERE`.",
    "`SELECT o.id AS order_id, p.name AS …, oi.… FROM orders AS o JOIN order_items AS oi ON oi.order_id = … JOIN products AS p ON … WHERE … ORDER BY o.id, …;`"
  ]
}
```
Склад собирает оплаченные заказы. Таблицы:

- `orders (id, customer_id, status, created_at)` — заказы;
- `order_items (order_id, product_id, quantity, price)` — позиции заказов, `order_id` ссылается на `orders.id`, `product_id` — на `products.id`;
- `products (id, name, category_id, price, stock)` — товары.

Для заказов в статусе `paid` выведите три столбца: `order_id` — номер заказа, `product` — название товара, `quantity` — количество. Отсортируйте по `order_id`, а внутри заказа — по названию товара.

```sql solution
SELECT o.id AS order_id, p.name AS product, oi.quantity
FROM orders AS o
JOIN order_items AS oi ON oi.order_id = o.id
JOIN products AS p ON p.id = oi.product_id
WHERE o.status = 'paid'
ORDER BY o.id, p.name;
```

## task w3-customer-totals
```json
{
  "type": "result",
  "title": "Сумма покупок клиента",
  "xp": 20,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «JOIN и группировка»: соедините `customers` → `orders` → `order_items`, отбросьте отменённые заказы в `WHERE` и сгруппируйте по клиенту.",
    "`SELECT c.full_name, SUM(… * …) AS total FROM customers AS c JOIN orders AS o ON … JOIN order_items AS oi ON … WHERE o.status <> '…' GROUP BY c.id, … ORDER BY total DESC;`"
  ]
}
```
Маркетинг отбирает клиентов для программы лояльности. Таблицы:

- `customers (id, full_name, email, city, registered_on)` — клиенты;
- `orders (id, customer_id, status, created_at)` — заказы;
- `order_items (order_id, product_id, quantity, price)` — позиции заказов; `price` — цена на момент покупки.

Для каждого клиента посчитайте `total` — сумму `quantity * price` по всем позициям его заказов. Цену берите из `order_items`. Отменённые заказы (статус `cancelled`) не учитывайте. Клиенты без заказов в отчёт не попадают.

Выведите два столбца: `full_name` и `total`. Отсортируйте по убыванию `total`.

```sql solution
SELECT c.full_name, SUM(oi.quantity * oi.price) AS total
FROM customers AS c
JOIN orders AS o ON o.customer_id = c.id
JOIN order_items AS oi ON oi.order_id = o.id
WHERE o.status <> 'cancelled'
GROUP BY c.id, c.full_name
ORDER BY total DESC;
```
