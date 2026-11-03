# Изменение и удаление данных

Цены в «Полке» меняются каждую неделю, остатки на складе пересчитываются, а клиенты просят удалить свои аккаунты. Для этого есть `UPDATE` и `DELETE`. Оба меняют только строки, которые выбрал `WHERE`, — тот же `WHERE`, что вы писали в `SELECT`. Без `WHERE` запрос затронет **всю** таблицу. Выполненный `UPDATE` или `DELETE` не отменить, поэтому здесь особенно важна аккуратность. Откатывать изменения позволяют транзакции — это тема последнего мира курса.

Примеры урока работают на учебной базе «Полки»: `products (id, name, category_id, price, stock)`, `customers (id, full_name, email, city, registered_on)`, `orders (id, customer_id, status, created_at)`, `order_items (order_id, product_id, quantity, price)`, `categories (id, name, parent_id)`. Запускайте их по порядку: каждый следующий видит изменения предыдущих.

### UPDATE

`UPDATE` меняет значения в существующих строках.

```sql
UPDATE таблица
SET столбец = новое_значение
WHERE условие;
```

- После `UPDATE` — таблица, после `SET` — какой столбец и чем заполнить.
- `WHERE` выбирает строки для изменения. Условие пишется так же, как в `SELECT`.
- Без `WHERE` новое значение получат **все** строки таблицы.
- Значения записываются как обычно: текст в одинарных кавычках, числа с точкой.
- База отвечает, сколько строк изменено. Если ответ «0 строк», условие ничего не нашло.

```sql example
UPDATE customers
SET city = 'Тольятти'
WHERE email = 'zakhar@polka.ru';
SELECT full_name, city FROM customers WHERE email = 'zakhar@polka.ru';
```

| full_name | city |
|---|---|
| Захар Морозов | Тольятти |

Приложения передают значения в запрос параметрами `$1`, `$2`: `UPDATE customers SET city = $1 WHERE id = $2`. Это безопасный способ: значение отправляется отдельно от текста запроса и не может стать частью SQL, поэтому пользователь не подменит запрос через поле формы (такую атаку называют SQL-инъекцией, подробнее — в пятом мире). Правило то же: если забыть `WHERE`, изменятся все строки.

### Новое значение из старого

В `SET` можно ссылаться на текущие значения строки и менять несколько столбцов сразу.

```sql
UPDATE таблица
SET столбец1 = столбец1 + число, столбец2 = столбец2 * число
WHERE условие;
```

- `stock = stock + 10` берёт старое значение `stock` каждой строки и прибавляет 10.
- Несколько присваиваний разделяются запятыми. Слово `SET` пишется один раз.
- Для процентов умножайте: +5 % — это `* 1.05`, −20 % — это `* 0.8`.
- Результат округляется до типа столбца: в `numeric(10, 2)` останется два знака после точки.

Полезная привычка: перед `UPDATE` или `DELETE` выполните `SELECT` с тем же `WHERE` и посмотрите, какие строки попадут под изменение.

```sql example
SELECT name, price, stock FROM products WHERE stock = 0;
```

| name | price | stock |
|---|---|---|
| Преступление и наказание | 450.00 | 0 |
| Набор маркеров | 420.00 | 0 |

Две строки — то, что нужно. Теперь пополним их остаток на 10 штук и поднимем цену на 5 %:

```sql example
UPDATE products
SET stock = stock + 10, price = price * 1.05
WHERE stock = 0
RETURNING name, price, stock;
```

| name | price | stock |
|---|---|---|
| Преступление и наказание | 472.50 | 10 |
| Набор маркеров | 441.00 | 10 |

### RETURNING

`RETURNING` в конце `UPDATE`, `DELETE` или `INSERT` возвращает затронутые строки, как будто вы сразу выполнили `SELECT`. Вы видите результат, а приложение получает новые значения без второго запроса.

```sql
UPDATE таблица SET … WHERE … RETURNING столбец1, столбец2;
DELETE FROM таблица WHERE … RETURNING *;
INSERT INTO таблица (…) VALUES (…) RETURNING id;
```

- `RETURNING` пишется последним, перед точкой с запятой.
- После него — столбцы через запятую или `*` для всех столбцов.
- Для `UPDATE` возвращаются уже новые значения, для `DELETE` — удалённые строки.
- Для `INSERT` удобно вернуть `id`, который выдала база.

```sql example
INSERT INTO categories (name, parent_id)
VALUES ('Открытки', 2)
RETURNING id, name;
```

| id | name |
|---|---|
| 7 | Открытки |

### DELETE

`DELETE` удаляет строки целиком.

```sql
DELETE FROM таблица
WHERE условие;
```

- После `DELETE FROM` — таблица, затем `WHERE` с условием.
- Без `WHERE` удалятся **все** строки таблицы. Сама таблица и её столбцы останутся.
- Удалить значение одного столбца `DELETE` не умеет: для этого `UPDATE … SET столбец = NULL`.

Уберём из заказа № 6 одну позицию — ежедневник (`product_id = 9`):

```sql example
DELETE FROM order_items
WHERE order_id = 6 AND product_id = 9
RETURNING *;
```

| order_id | product_id | quantity | price |
|---|---|---|---|
| 6 | 9 | 1 | 690.00 |

### Удаление строк, на которые ссылаются

Внешний ключ не даёт удалить строку, на которую ссылаются другие. Например, на клиента ссылаются его заказы (`orders.customer_id`), а на товар — позиции заказов (`order_items.product_id`). Попытка удалить такую строку закончится ошибкой `23503`, и ничего не удалится.

Порядок такой: сначала удалите ссылающиеся (дочерние) строки, потом саму строку.

```sql
SELECT id FROM главная_таблица WHERE условие;              -- узнать id
DELETE FROM дочерняя_таблица WHERE ссылка = найденный_id;
DELETE FROM главная_таблица WHERE id = найденный_id;
```

- Дочерние строки находят по столбцу-ссылке, в который записан `id` главной строки.
- `id` удобно сначала узнать отдельным `SELECT`, а потом подставить число в `DELETE`.
- Несколько запросов можно выполнить одним запуском: каждый заканчивается точкой с запятой.

Узнаем `id` клиента по e-mail:

```sql example
SELECT id, full_name FROM customers WHERE email = 'zakhar@polka.ru';
```

| id | full_name |
|---|---|
| 8 | Захар Морозов |

У Захара нет заказов, поэтому его можно удалить сразу:

```sql example
DELETE FROM customers WHERE id = 8 RETURNING id, full_name;
```

| id | full_name |
|---|---|
| 8 | Захар Морозов |

Товар «Набор маркеров» (`id = 12`) уже был в заказе, поэтому сначала удаляем позицию заказа, затем товар:

```sql example
DELETE FROM order_items WHERE product_id = 12;
DELETE FROM products WHERE id = 12 RETURNING name;
```

| name |
|---|
| Набор маркеров |

### ON DELETE CASCADE

Иногда дочерние строки не имеют смысла без главной: позиция заказа без заказа никому не нужна. Тогда внешнему ключу добавляют `ON DELETE CASCADE`, и база удаляет дочерние строки сама.

```sql
столбец_ссылка integer REFERENCES главная_таблица (id) ON DELETE CASCADE
```

- `ON DELETE CASCADE` пишется после `REFERENCES …` в определении столбца.
- При удалении главной строки удалятся все строки, которые на неё ссылаются.
- В базе «Полки» так связаны `order_items.order_id` и `orders`: удалите заказ — исчезнут и его позиции. А `orders.customer_id` создан без каскада: клиента с заказами удалить нельзя, пока не удалены заказы.

```sql example
DELETE FROM orders WHERE id = 4 RETURNING id, status;
```

| id | status |
|---|---|
| 4 | cancelled |

```sql example
SELECT * FROM order_items WHERE order_id = 4;
```

Результат: 0 строк. Позиция отменённого заказа удалилась вместе с ним.

### Сначала данные, потом ограничение

В прошлом уроке вы добавляли ограничения командой `ALTER TABLE … ADD CONSTRAINT`. Если в таблице уже есть строки, которые нарушают новое правило, ограничение не добавится. Порядок действий: исправить строки через `UPDATE`, затем добавить ограничение.

```sql
UPDATE таблица SET столбец = допустимое_значение WHERE условие_нарушения;
ALTER TABLE таблица ADD CONSTRAINT имя CHECK (правило);
```

- Условие в `WHERE` — это ровно те строки, которые нарушают правило.
- Остальные строки `UPDATE` не трогает.

«Полка» решила не продавать ничего дешевле 50 ₽. Карандаш стоит 35 ₽, поэтому сначала поднимаем его цену:

```sql example
UPDATE products SET price = 50 WHERE price < 50;
ALTER TABLE products ADD CONSTRAINT products_price_min_check CHECK (price >= 50);
SELECT name, price FROM products WHERE price <= 100;
```

| name | price |
|---|---|
| Тетрадь 48 листов | 95.00 |
| Ручка гелевая | 89.00 |
| Карандаш | 50.00 |

### TRUNCATE и DROP TABLE

`TRUNCATE` очищает таблицу целиком. На больших таблицах он намного быстрее `DELETE`: строки не перебираются по одной.

```sql
TRUNCATE таблица;
TRUNCATE таблица CASCADE;
DROP TABLE таблица;
```

- У `TRUNCATE` нет `WHERE`: удаляются все строки. Столбцы и ограничения остаются, таблица просто становится пустой.
- Таблицу, на которую ссылаются другие, `TRUNCATE` не очистит: `TRUNCATE orders` завершится ошибкой, ведь на заказы ссылается `order_items`. С `CASCADE` будут очищены и все ссылающиеся таблицы.
- `DROP TABLE` удаляет таблицу полностью, вместе со столбцами. После него таблицу придётся создавать заново.

```sql example
TRUNCATE order_items;
SELECT * FROM order_items;
```

Результат: 0 строк. Таблица `order_items` пуста, но осталась на месте со всеми столбцами.

### Частые ошибки

- `UPDATE products SET price = price * 0.9;` → `UPDATE products SET price = price * 0.9 WHERE category_id = 3;`. Без `WHERE` изменятся все строки таблицы.
- `UPDATE products SET price = 100 AND stock = 5 WHERE …` → `SET price = 100, stock = 5`. Присваивания разделяет запятая. С `AND` база посчитает `100 AND stock = 5` одним выражением и выдаст ошибку.
- `DELETE products WHERE id = 3` → `DELETE FROM products WHERE id = 3`. Слово `FROM` обязательно.
- `DELETE FROM customers WHERE …` для клиента с заказами → сначала `DELETE FROM orders WHERE customer_id = …`, потом клиента. Иначе внешний ключ вернёт ошибку `23503`.

### Шпаргалка

```sql
UPDATE t SET a = 'текст' WHERE id = 1;
UPDATE t SET a = a * 1.1, b = b - 1 WHERE c > 30 RETURNING id, a, b;
DELETE FROM t WHERE id = 5 RETURNING *;
INSERT INTO t (a) VALUES ('x') RETURNING id;
SELECT id FROM t WHERE email = '…';                 -- узнать id
DELETE FROM child WHERE parent_id = 5;              -- сначала дочерние
DELETE FROM parent WHERE id = 5;                    -- потом главную
ref_id integer REFERENCES parent (id) ON DELETE CASCADE
TRUNCATE t;            TRUNCATE t CASCADE;            DROP TABLE t;
```

## task w1-sale-notebooks
```json
{
  "type": "state",
  "title": "Распродажа тетрадей",
  "xp": 15,
  "dataset": "shop",
  "hints": [
    "См. разделы «Новое значение из старого» и «RETURNING». Сначала выполните `SELECT name, price, stock FROM products WHERE category_id = 5` и найдите строки, которые должны измениться.",
    "`UPDATE products SET price = price * … WHERE category_id = 5 AND … RETURNING name, price;`"
  ]
}
```
На складе «Полки» скопились тетради и блокноты. Таблица `products (id, name, category_id, price, stock)`.

Снизьте на 20 % цену товаров категории «Тетради и блокноты» (`category_id = 5`), которых на складе больше 30 штук (`stock` больше 30). Остальные товары не трогайте.

Чтобы сразу увидеть новые цены, добавьте в конец запроса `RETURNING name, price`.

```sql starter
UPDATE products
SET price = …
WHERE …
RETURNING name, price;
```

```sql solution
UPDATE products
SET price = price * 0.8
WHERE category_id = 5 AND stock > 30
RETURNING name, price;
```

```sql check
SELECT name, price, stock FROM products;
```

## task w1-review-bonus-update
```json
{
  "type": "review",
  "title": "Бонусы за отзыв",
  "xp": 10,
  "options": [
    "`bonus = bonus + $1` прочитает устаревшее значение, и часть баллов потеряется",
    "В `UPDATE` нет `WHERE`: баллы начислятся всем клиентам",
    "Параметры `$1` и `$2` открывают дорогу SQL-инъекции",
    "Запись в `bonus_log` должна идти раньше `UPDATE`"
  ],
  "answer": [1],
  "lines": [4],
  "explanation": "Без `WHERE` запрос `UPDATE` меняет все строки таблицы: один отзыв принесёт баллы каждому клиенту, а в журнале останется одна запись. Нужно `UPDATE customers SET bonus = bonus + $1 WHERE id = $2` с параметрами `[points, customerId]`. Выражение `bonus + $1` безопасно: PostgreSQL читает и записывает значение строки в одной операции. Параметры `$1`, `$2`, наоборот, защищают от инъекций. Порядок двух запросов на итог не влияет. Полезная страховка: драйвер возвращает число изменённых строк (`rowCount`), и если оно не равно 1, что-то пошло не так.",
  "hints": ["См. раздел «UPDATE»: посчитайте, сколько строк изменит каждый запрос в этой функции."]
}
```
Разработчик написал начисление бонусных баллов за отзыв о товаре. Таблица `customers` содержит столбец `bonus`, а `db.query(текст, [параметры])` выполняет запрос, подставляя параметры вместо `$1`, `$2`. Что в этом коде опаснее всего?

```typescript code
async function addBonus(db: Pool, customerId: number, points: number) {
  if (points <= 0) throw new Error('points must be positive');
  await db.query(
    'UPDATE customers SET bonus = bonus + $1',
    [points],
  );
  await db.query(
    'INSERT INTO bonus_log (customer_id, points) VALUES ($1, $2)',
    [customerId, points],
  );
}
```

## task w1-fix-negative-stock
```json
{
  "type": "state",
  "title": "Минус на складе",
  "xp": 20,
  "hints": [
    "См. раздел «Сначала данные, потом ограничение»: ограничение не добавится, пока в таблице есть нарушающие его строки. Сначала исправьте их через `UPDATE`.",
    "Перед запросом из редактора допишите `UPDATE products SET stock = … WHERE stock < …;`"
  ]
}
```
Из-за сбоя синхронизации со складом у двух товаров остаток ушёл в минус. Таблица `products (id, name, price, stock)`. Запрос в редакторе должен запретить отрицательные остатки, но падает с ошибкой `23514`: в таблице уже есть нарушители.

Обнулите отрицательные остатки (`stock` меньше нуля станет `0`), остальные строки не трогайте. Затем добавьте ограничение `products_stock_check` запросом из редактора.

```sql setup
CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price numeric(10, 2) NOT NULL CHECK (price > 0),
  stock integer NOT NULL DEFAULT 0
);
INSERT INTO products (name, price, stock) VALUES
  ('Блокнот A5', 249.90, 40),
  ('Ручка гелевая', 89, -3),
  ('Карандаш', 35, 300),
  ('Набор маркеров', 420, -1),
  ('Ежедневник', 690, 0);
```

```sql starter
ALTER TABLE products ADD CONSTRAINT products_stock_check CHECK (stock >= 0);
```

```sql solution
UPDATE products SET stock = 0 WHERE stock < 0;
ALTER TABLE products ADD CONSTRAINT products_stock_check CHECK (stock >= 0);
```

```sql check
SELECT name, price, stock FROM products;
SELECT conname FROM pg_constraint
WHERE conrelid = 'products'::regclass AND contype = 'c';
```

## task w1-delete-account
```json
{
  "type": "state",
  "title": "Удаление аккаунта",
  "xp": 20,
  "dataset": "shop",
  "hints": [
    "См. разделы «Удаление строк, на которые ссылаются» и «ON DELETE CASCADE». Узнайте `id` клиента: `SELECT id FROM customers WHERE email = 'egor@polka.ru';`. Позиции заказов удалятся каскадом сами.",
    "Сначала `DELETE FROM orders WHERE customer_id = …;`, затем запрос из редактора."
  ]
}
```
Клиент Егор Новиков (`egor@polka.ru`) попросил удалить аккаунт вместе с историей заказов. Запрос в редакторе падает с ошибкой `23503`: на клиента ссылаются его заказы.

Таблицы:

- `customers (id, full_name, email, city, registered_on)`;
- `orders (id, customer_id, status, created_at)` — `customer_id` ссылается на `customers.id` без каскада;
- `order_items (order_id, product_id, quantity, price)` — `order_id` ссылается на `orders.id` с `ON DELETE CASCADE`.

Удалите клиента, все его заказы и позиции этих заказов. Остальные данные не трогайте.

```sql starter
DELETE FROM customers WHERE email = 'egor@polka.ru';
```

```sql solution
DELETE FROM orders WHERE customer_id = 6;
DELETE FROM customers WHERE email = 'egor@polka.ru';
```

```sql check
SELECT full_name, email FROM customers;
SELECT status, created_at FROM orders;
SELECT count(*) AS items FROM order_items;
```

## task w1-truncate-vs-delete
```json
{
  "type": "choice",
  "title": "TRUNCATE или DELETE",
  "xp": 5,
  "options": [
    "У `TRUNCATE` нет `WHERE`: он всегда очищает таблицу целиком",
    "На больших таблицах `TRUNCATE` намного быстрее: он не перебирает строки по одной",
    "`TRUNCATE` удаляет таблицу вместе со структурой, и её придётся создавать заново",
    "`TRUNCATE orders` удалит заказы, а позиции в `order_items` останутся без заказов"
  ],
  "answer": [0, 1],
  "explanation": "`TRUNCATE` очищает таблицу целиком и не обрабатывает строки по одной, поэтому справляется с миллионами записей почти мгновенно. Выбрать часть строк он не может — для этого нужен `DELETE … WHERE`. Столбцы, индексы и ограничения остаются на месте: таблицу целиком удаляет `DROP TABLE`. На `orders` ссылается `order_items`, поэтому `TRUNCATE orders` завершится ошибкой, а `TRUNCATE orders CASCADE` очистит обе таблицы. Оставить позиции без заказов внешний ключ не позволит ни при каком способе удаления.",
  "hints": ["См. раздел «TRUNCATE и DROP TABLE» и вспомните, что внешний ключ гарантирует для `order_items.order_id`."]
}
```
Чем `TRUNCATE orders` отличается от `DELETE FROM orders` в базе «Полки»? Выберите все верные утверждения.
