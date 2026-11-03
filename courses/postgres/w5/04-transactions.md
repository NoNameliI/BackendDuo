# Транзакции

Курьерская служба «Полки» платит курьерам из общей кассы. Выплата — это два `UPDATE`: списать с кассы и начислить курьеру. Если сервер упадёт между ними, деньги исчезнут. **Транзакция** объединяет команды в одно целое.

**ACID**:

- **Atomicity** — выполняется всё или ничего;
- **Consistency** — после транзакции соблюдены все ограничения;
- **Isolation** — параллельные транзакции не видят незафиксированных изменений друг друга;
- **Durability** — после `COMMIT` данные переживут сбой.

```sql
BEGIN;
UPDATE accounts SET balance = balance - 4200 WHERE id = 1;
UPDATE accounts SET balance = balance + 4200 WHERE id = 2;
SAVEPOINT before_bonus;
UPDATE accounts SET balance = balance + 500 WHERE id = 2;
ROLLBACK TO before_bonus;  -- отменяет только премию
COMMIT;
```

`ROLLBACK` отменяет всю транзакцию, `ROLLBACK TO имя` — только изменения после точки сохранения.

**Уровни изоляции** в PostgreSQL:

- `READ COMMITTED` (по умолчанию) — каждая команда видит данные, зафиксированные к её началу. Два одинаковых `SELECT` в одной транзакции могут вернуть разные данные;
- `REPEATABLE READ` — вся транзакция видит один снимок данных, сделанный при первом запросе;
- `SERIALIZABLE` — результат такой, как при выполнении транзакций по очереди. При конфликте одна из них получит ошибку, и её нужно повторить.

**Блокировки.** `UPDATE` блокирует строку до конца транзакции: второй `UPDATE` той же строки ждёт. **Потерянное обновление** возникает, когда приложение читает значение, считает новое у себя и записывает его обратно: две транзакции прочитают одно и то же, и одно изменение пропадёт. Решения — атомарный `UPDATE … SET balance = balance + 100` или `SELECT … FOR UPDATE`, который блокирует строку уже при чтении.

## task w5-payouts-savepoint
```json
{
  "type": "state",
  "title": "Выплаты с точкой сохранения",
  "xp": 25,
  "hints": [
    "`SAVEPOINT before_bonus;` ставит метку, `ROLLBACK TO before_bonus;` отменяет всё, что сделано после неё, а транзакция продолжается.",
    "Каркас: `BEGIN; … SAVEPOINT before_bonus; … ROLLBACK TO before_bonus; … COMMIT;` Каждая выплата — два `UPDATE accounts` и `INSERT INTO payouts (account_id, amount) VALUES (…)`."
  ]
}
```
В конце недели оператор проводит выплаты одной транзакцией. Напишите скрипт целиком:

1. Начните транзакцию.
2. Выплатите Ильдару (счёт 2) 4 200 ₽ из кассы (счёт 1) и запишите выплату в `payouts`.
3. Поставьте точку сохранения `before_bonus`.
4. Начислите всем трём курьерам (счета 2, 3 и 4) премию по 1 000 ₽, списав из кассы 3 000 ₽.
5. Руководитель отменяет премию: откатитесь к точке сохранения. Выплата Ильдару должна остаться.
6. Выплатите Марине (счёт 3) 2 500 ₽ из кассы и запишите выплату в `payouts`.
7. Зафиксируйте транзакцию.

```sql setup
CREATE TABLE accounts (
  id int PRIMARY KEY,
  owner text NOT NULL,
  balance numeric(10, 2) NOT NULL CHECK (balance >= 0)
);
INSERT INTO accounts VALUES
  (1, 'Касса', 50000),
  (2, 'Ильдар', 0),
  (3, 'Марина', 1200),
  (4, 'Олег', 300);
CREATE TABLE payouts (
  id serial PRIMARY KEY,
  account_id int NOT NULL REFERENCES accounts (id),
  amount numeric(10, 2) NOT NULL CHECK (amount > 0)
);
```

```sql solution
BEGIN;
UPDATE accounts SET balance = balance - 4200 WHERE id = 1;
UPDATE accounts SET balance = balance + 4200 WHERE id = 2;
INSERT INTO payouts (account_id, amount) VALUES (2, 4200);

SAVEPOINT before_bonus;
UPDATE accounts SET balance = balance + 1000 WHERE id IN (2, 3, 4);
UPDATE accounts SET balance = balance - 3000 WHERE id = 1;
ROLLBACK TO before_bonus;

UPDATE accounts SET balance = balance - 2500 WHERE id = 1;
UPDATE accounts SET balance = balance + 2500 WHERE id = 3;
INSERT INTO payouts (account_id, amount) VALUES (3, 2500);
COMMIT;
```

```sql check
SELECT id, owner, balance FROM accounts;
SELECT account_id, amount FROM payouts;
SELECT pg_current_xact_id_if_assigned() IS NULL AS transaction_committed;
```

## task w5-isolation-report
```json
{
  "type": "choice",
  "title": "Отчёт без расхождений",
  "xp": 10,
  "options": [
    "`READ UNCOMMITTED`",
    "`READ COMMITTED`",
    "`REPEATABLE READ`",
    "`SERIALIZABLE`"
  ],
  "answer": [2],
  "explanation": "`REPEATABLE READ` берёт один снимок данных на всю транзакцию, поэтому оба запроса посчитают одно и то же, а новую выплату отчёт просто не увидит. В PostgreSQL `READ UNCOMMITTED` работает как `READ COMMITTED`: каждая команда берёт свежий снимок, и второй запрос увидит зафиксированную выплату. `SERIALIZABLE` тоже даст одинаковые суммы, но он строже и может обрывать транзакции ошибкой сериализации, а нужен самый слабый подходящий уровень.",
  "hints": ["На каком уровне снимок данных делается один раз на всю транзакцию, а не перед каждой командой?"]
}
```
Финансовый отчёт в одной транзакции дважды выполняет `SELECT count(*), sum(amount) FROM payouts`: для итоговой строки и для сверки. Между этими запросами другая транзакция успевает зафиксировать новую выплату, и в режиме по умолчанию цифры расходятся. Какой самый слабый уровень изоляции гарантирует, что оба запроса увидят одинаковые данные?

## task w5-row-lock-wait
```json
{
  "type": "choice",
  "title": "Две транзакции, одна строка",
  "xp": 10,
  "options": [
    "B сразу изменит строку, а A при фиксации перезапишет её своим значением",
    "B будет ждать, пока A не выполнит `COMMIT` или `ROLLBACK`, а затем применит +50 к актуальному балансу",
    "B сразу получит ошибку `deadlock detected`",
    "B прочитает незафиксированный баланс из A и применит +50 к нему без ожидания"
  ],
  "answer": [1],
  "explanation": "`UPDATE` в транзакции A заблокировал строку до конца транзакции, поэтому B ждёт. Когда A зафиксируется, B в режиме `READ COMMITTED` перечитает свежую версию строки и прибавит 50 к уже уменьшенному балансу: сохранятся оба изменения. Если A откатится, B применит изменение к исходному значению. Взаимная блокировка (deadlock) возникает, только когда транзакции ждут друг друга по кругу. Незафиксированные данные чужой транзакции PostgreSQL никогда не показывает.",
  "hints": ["Что делает `UPDATE` со строкой до конца своей транзакции?"]
}
```
Транзакция A выполнила `UPDATE accounts SET balance = balance - 100 WHERE id = 1;` и ещё не завершилась. Транзакция B в другом подключении выполняет `UPDATE accounts SET balance = balance + 50 WHERE id = 1;`. Что произойдёт с B в режиме `READ COMMITTED`?

## task w5-review-lost-update
```json
{
  "type": "review",
  "title": "Пропадающие бонусы",
  "xp": 15,
  "options": [
    "Транзакция лишняя: без неё оба вызова сработали бы правильно",
    "Оба вызова читают одно и то же значение `bonus`, и второй `UPDATE` затирает результат первого",
    "Параметры `%s` не защищают от SQL-инъекции",
    "Нужен уровень `READ UNCOMMITTED`, чтобы каждый вызов видел изменения соседа"
  ],
  "answer": [1],
  "lines": [3, 5],
  "explanation": "Это потерянное обновление. Оба вызова читают `bonus = 100`, один считает 150, другой 130, и последний `UPDATE` записывает 130: начисление за отзыв пропало. Обычный `SELECT` строку не блокирует, поэтому транзакция в `READ COMMITTED` не спасает, а без неё стало бы не лучше. Надёжнее считать в самой базе: `UPDATE customers SET bonus = bonus + %s WHERE id = %s`. Второй вызов дождётся снятия блокировки строки и прибавит к свежему значению. Другой вариант — `SELECT bonus … FOR UPDATE`. Параметры `%s` как раз защищают от инъекций, а `READ UNCOMMITTED` в PostgreSQL работает как `READ COMMITTED`.",
  "hints": ["Представьте два вызова, которые выполнили строку 3 одновременно. Какое значение каждый из них запишет?"]
}
```
Бонусы начисляют два фоновых обработчика: один за отзывы, другой за покупки. Иногда они срабатывают для одного клиента одновременно, и одно начисление «пропадает». В чём причина?

```python code
def add_bonus(conn, customer_id, amount):
    with conn.transaction():
        cur = conn.execute("SELECT bonus FROM customers WHERE id = %s", (customer_id,))
        bonus = cur.fetchone()[0]
        conn.execute("UPDATE customers SET bonus = %s WHERE id = %s",
                     (bonus + amount, customer_id))
```
