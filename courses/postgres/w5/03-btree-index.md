# Индекс B-Tree

У «Полки» 200 тысяч заказов, и менеджеры жалуются: история заказов клиента открывается секундами. Причина в плане запроса. Без индекса PostgreSQL делает **Seq Scan**: читает таблицу целиком и проверяет каждую строку.

**Индекс B-Tree** — отсортированное дерево значений колонки со ссылками на строки. По нему база за несколько шагов находит нужные записи. В плане это выглядит как **Index Scan** или **Bitmap Index Scan**.

```sql
CREATE INDEX orders_status_idx ON orders (status);
EXPLAIN SELECT * FROM orders WHERE status = 'new';
```

Как читать `EXPLAIN`:

- план читается изнутри наружу: вложенные узлы выполняются первыми;
- `cost=0.42..8.44` — оценка планировщика в условных единицах: стоимость до первой строки и до последней;
- `rows` — сколько строк планировщик ожидает получить.

Индекс ускоряет чтение, но замедляет запись: каждый `INSERT` и `UPDATE` обновляет и таблицу, и её индексы. Создавайте индексы под реальные запросы, а не на каждую колонку.

## task w5-index-customer-orders
```json
{
  "type": "plan",
  "title": "История заказов клиента",
  "xp": 25,
  "check": { "forbidSeqScan": ["orders"], "maxCostRatio": 0.05 },
  "hints": [
    "Нажмите «План» с запросом из условия в редакторе: вы увидите Seq Scan on orders. Фильтр идёт по customer_id.",
    "Синтаксис: `CREATE INDEX имя ON таблица (колонка);`"
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
    "Нет индекса по email, поэтому запрос будет медленным",
    "Значение email вклеивается в текст запроса — это SQL-инъекция",
    "fetchone() вернёт только первую подходящую строку",
    "Вместо перечисления колонок нужно писать SELECT *"
  ],
  "answer": [1],
  "lines": [2],
  "explanation": "Если ввести в поле `' OR '1'='1`, условие станет истинным для всех строк, и форма впустит без пароля. Значения передаются параметрами: `conn.execute(\"SELECT … WHERE email = %s\", (email,))`. Тогда драйвер отправит их отдельно от текста запроса, и они никогда не станут частью SQL.",
  "hints": ["Представьте, что пользователь ввёл в поле e-mail не адрес, а кусок SQL с кавычкой."]
}
```
Разработчик написал поиск клиента для формы входа. Что в этом коде опаснее всего?

```python code
def find_customer(conn, email):
    sql = "SELECT id, full_name FROM customers WHERE email = '" + email + "'"
    return conn.execute(sql).fetchone()
```
