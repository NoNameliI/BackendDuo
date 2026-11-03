# Изменение и удаление данных

Цены в «Полке» меняются каждую неделю, остатки на складе пересчитываются, а клиенты просят удалить свои аккаунты. Для этого есть `UPDATE` и `DELETE`. Оба меняют только строки, которые выбрал `WHERE`. Без `WHERE` запрос затронет **всю** таблицу.

```sql
UPDATE products
SET price = price * 1.10, stock = stock + 5
WHERE category_id = 4
RETURNING name, price;
```

В `SET` можно ссылаться на текущие значения: `price * 1.10` берёт старую цену каждой строки. `RETURNING` возвращает изменённые строки: вы сразу видите результат, а приложение получает новые значения без второго запроса. `DELETE` устроен так же:

```sql
DELETE FROM orders
WHERE status = 'cancelled'
RETURNING id;
```

Что станет со строками, которые ссылаются на удаляемую, решает внешний ключ (`FOREIGN KEY`):

- по умолчанию удаление запрещено: клиента с заказами удалить нельзя, будет ошибка `23503`;
- `ON DELETE CASCADE` удаляет зависимые строки вместе с основной. В «Полке» так связаны `order_items` и `orders`: удалите заказ — исчезнут и его позиции.

`TRUNCATE orders` очищает таблицу целиком и на больших объёмах намного быстрее `DELETE`: строки не перебираются по одной. Но `WHERE` у него нет. Таблицу, на которую ссылаются другие, он очистит только с `CASCADE` — вместе со всеми ссылающимися таблицами.

Полезная привычка: перед `UPDATE` или `DELETE` выполните `SELECT` с тем же `WHERE` и посмотрите, какие строки попадут под изменение.

## task w1-sale-notebooks
```json
{
  "type": "state",
  "title": "Распродажа тетрадей",
  "xp": 15,
  "dataset": "shop",
  "hints": [
    "Сначала выполните `SELECT name, price, stock FROM products WHERE category_id = 5` и найдите строки, которые должны измениться.",
    "`UPDATE products SET price = price * 0.8 WHERE category_id = 5 AND stock > 30;`"
  ]
}
```
На складе «Полки» скопились тетради и блокноты. Снизьте на 20 % цену товаров категории «Тетради и блокноты» (`category_id = 5`), которых на складе больше 30 штук. Остальные товары не трогайте.

Чтобы сразу увидеть новые цены, добавьте в конец запроса `RETURNING name, price`.

```sql solution
UPDATE products
SET price = price * 0.8
WHERE category_id = 5 AND stock > 30
RETURNING name, price;
```

```sql check
SELECT name, price, stock FROM products;
```

## task w1-fix-negative-stock
```json
{
  "type": "state",
  "title": "Минус на складе",
  "xp": 20,
  "hints": [
    "Ограничение не добавится, пока в таблице есть нарушающие его строки. Сначала исправьте их через `UPDATE products SET … WHERE …`.",
    "Перед запросом из редактора допишите `UPDATE products SET stock = 0 WHERE stock < 0;`"
  ]
}
```
Из-за сбоя синхронизации со складом у двух товаров остаток ушёл в минус. Запрос в редакторе должен запретить такие остатки, но падает с ошибкой `23514`: в таблице уже есть нарушители.

Обнулите отрицательные остатки, остальные строки не трогайте. Затем добавьте ограничение `products_stock_check` запросом из редактора.

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
    "Заказы ссылаются на клиента по `customer_id`. Узнайте его: `SELECT id FROM customers WHERE email = 'egor@polka.ru'`. Позиции заказов удалятся каскадом сами.",
    "Сначала `DELETE FROM orders WHERE customer_id = …;`, затем запрос из редактора."
  ]
}
```
Клиент Егор Новиков (`egor@polka.ru`) попросил удалить аккаунт вместе с историей заказов. Запрос в редакторе падает с ошибкой `23503`: на клиента ссылаются его заказы.

Удалите клиента, все его заказы и позиции этих заказов. Остальные данные не трогайте.

```sql starter
DELETE FROM customers WHERE email = 'egor@polka.ru';
```

```sql solution
DELETE FROM orders
WHERE customer_id = (SELECT id FROM customers WHERE email = 'egor@polka.ru');
DELETE FROM customers WHERE email = 'egor@polka.ru';
```

```sql check
SELECT full_name, email FROM customers;
SELECT status, created_at FROM orders;
SELECT count(*) AS items FROM order_items;
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
  "hints": ["Посчитайте, сколько строк изменит каждый запрос в этой функции."]
}
```
Разработчик написал начисление бонусных баллов за отзыв о товаре. Что в этом коде опаснее всего?

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
  "hints": ["Вспомните, что внешний ключ гарантирует для `order_items.order_id`."]
}
```
Чем `TRUNCATE orders` отличается от `DELETE FROM orders` в базе «Полки»? Выберите все верные утверждения.
