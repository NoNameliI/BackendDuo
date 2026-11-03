# Индекс B-Tree

У «Полки» 200 тысяч заказов, и менеджеры жалуются: история заказов клиента открывается секундами. Причину показывает план выполнения. Без индекса PostgreSQL делает **Seq Scan**: читает таблицу целиком и проверяет каждую строку.

**Индекс B-Tree** — отсортированное дерево значений столбца со ссылками на строки. По нему база за несколько шагов находит нужные записи. В плане это выглядит как **Index Scan** или **Bitmap Index Scan**.

```sql
CREATE INDEX orders_status_idx ON orders (status);
EXPLAIN SELECT * FROM orders WHERE status = 'new';
```

Как читать `EXPLAIN`:

- план читается изнутри наружу: вложенные узлы выполняются первыми;
- `cost=0.42..8.44` — оценка планировщика в условных единицах: стоимость до первой строки и до последней;
- `rows` — сколько строк планировщик ожидает получить.

Индекс ускоряет чтение, но замедляет запись: каждый `INSERT` и `UPDATE` обновляет и таблицу, и её индексы. Создавайте индексы под реальные запросы, а не на каждый столбец.

## task w5-index-customer-orders
```json
{
  "type": "plan",
  "title": "История заказов клиента",
  "xp": 25,
  "check": { "forbidSeqScan": ["orders"], "maxCostRatio": 0.05 },
  "hints": [
    "Нажмите «План», когда в редакторе запрос из условия: вы увидите `Seq Scan on orders`. Фильтр идёт по `customer_id`.",
    "Синтаксис: `CREATE INDEX имя ON таблица (столбец);`"
  ]
}
```
Карточка клиента выполняет запрос ниже, и менять его нельзя. Создайте индекс, после которого PostgreSQL перестанет читать таблицу `orders` целиком, а стоимость плана упадёт хотя бы в 20 раз.

```sql setup
CREATE TABLE orders (
  id int PRIMARY KEY,
  customer_id int NOT NULL,
  status text NOT NULL,
  total numeric(10, 2) NOT NULL,
  created_at timestamp NOT NULL
);
INSERT INTO orders
SELECT g,
       (g * 7919) % 20000 + 1,
       (ARRAY['new', 'paid', 'shipped', 'cancelled'])[g % 4 + 1],
       ((g * 37) % 50000) / 10.0 + 99,
       TIMESTAMP '2024-01-01' + (g % 525600) * INTERVAL '1 minute'
FROM generate_series(1, 200000) AS g;
```

```sql query
SELECT id, total, created_at
FROM orders
WHERE customer_id = 4242
ORDER BY created_at DESC;
```

```sql solution
CREATE INDEX orders_customer_id_idx ON orders (customer_id);
```

## task w5-review-injection
```json
{
  "type": "review",
  "title": "Поиск клиента по e-mail",
  "xp": 10,
  "options": [
    "Нет индекса по `email`, поэтому запрос будет медленным",
    "Значение `email` вклеивается в текст запроса — это SQL-инъекция",
    "`fetchone()` вернёт только первую подходящую строку",
    "Вместо перечисления столбцов нужно писать `SELECT *`"
  ],
  "answer": [1],
  "lines": [2],
  "explanation": "Если ввести в поле `' OR '1'='1`, условие станет истинным для всех строк, и функция вернёт первого попавшегося клиента: злоумышленник войдёт под чужим аккаунтом. Значения нужно передавать параметрами: `conn.execute(\"SELECT … WHERE email = %s\", (email,))`. Тогда драйвер отправит их отдельно от текста запроса, и они никогда не станут частью SQL.",
  "hints": ["Представьте, что пользователь ввёл в поле e-mail не адрес, а кусок SQL с кавычкой."]
}
```
Разработчик написал поиск клиента для формы входа. Что в этом коде опаснее всего?

```python code
def find_customer(conn, email):
    sql = "SELECT id, full_name FROM customers WHERE email = '" + email + "'"
    return conn.execute(sql).fetchone()
```

## task w5-index-new-orders-queue
```json
{
  "type": "plan",
  "title": "Очередь новых заказов",
  "xp": 25,
  "check": { "forbidSeqScan": ["orders"], "maxCostRatio": 0.025 },
  "hints": [
    "Нажмите «План»: в нём `Seq Scan` и `Sort`. Индекс только по `status` уберёт `Seq Scan`, но сортировка останется, а индекс только по `created_at` заставит перебирать старые отгруженные заказы.",
    "Сначала столбец из условия равенства, затем столбец сортировки: `CREATE INDEX имя ON orders (status, created_at);`"
  ]
}
```
Менеджеры разбирают новые заказы по очереди: экран показывает 20 самых старых заказов со статусом `new`. Новых заказов мало, около половины процента, остальные давно оплачены, отгружены или отменены.

Индекс может быть **составным**: индекс по `(a, b)` упорядочивает строки сначала по `a`, а при равных `a` — по `b`. Создайте один индекс, по которому PostgreSQL сразу найдёт новые заказы, причём уже в нужном порядке: без чтения всей таблицы и без отдельной сортировки. Стоимость плана должна упасть хотя бы в 40 раз.

```sql setup
CREATE TABLE orders (
  id int PRIMARY KEY,
  customer_id int NOT NULL,
  status text NOT NULL,
  total numeric(10, 2) NOT NULL,
  created_at timestamp NOT NULL
);
INSERT INTO orders
SELECT g,
       (g * 7919) % 20000 + 1,
       CASE
         WHEN g % 200 = 0 THEN 'new'
         WHEN g % 10 = 1 THEN 'cancelled'
         WHEN g % 10 < 5 THEN 'paid'
         ELSE 'shipped'
       END,
       ((g * 37) % 50000) / 10.0 + 99,
       TIMESTAMP '2024-01-01' + ((g * 7919) % 200000) * INTERVAL '2 minutes'
FROM generate_series(1, 200000) AS g;
```

```sql query
SELECT id, customer_id, total, created_at
FROM orders
WHERE status = 'new'
ORDER BY created_at
LIMIT 20;
```

```sql solution
CREATE INDEX orders_status_created_at_idx ON orders (status, created_at);
```
