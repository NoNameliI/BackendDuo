# Транзакции

Курьерская служба «Полки» платит курьерам из общей кассы. Выплата — это несколько команд: списать деньги с кассы, начислить курьеру и записать выплату в журнал. Если сервер упадёт после первой команды, деньги исчезнут: с кассы списаны, курьеру не пришли. В этом уроке вы научитесь объединять команды в транзакцию, отменять её целиком или частично и разберётесь, что происходит, когда с одними данными одновременно работают несколько подключений.

Примеры работают с двумя таблицами: `accounts (id, owner, balance)` — счета, у баланса есть ограничение `CHECK (balance >= 0)`, и `payouts (id, account_id, amount)` — журнал выплат, `id` типа `serial`.

```sql example
SELECT id, owner, balance FROM accounts ORDER BY id;
```

| id | owner | balance |
|---|---|---|
| 1 | Касса | 50000.00 |
| 2 | Ильдар | 0.00 |
| 3 | Марина | 1200.00 |
| 4 | Олег | 300.00 |

### Транзакция и ACID

**Транзакция** — группа команд, которую база выполняет как одно целое. Её гарантии называют **ACID**:

- **Atomicity** (атомарность) — выполняется всё или ничего. Если транзакция не завершилась, ни одно её изменение не сохранится;
- **Consistency** (согласованность) — после транзакции соблюдены все ограничения: `CHECK`, `UNIQUE`, внешние ключи;
- **Isolation** (изоляция) — параллельные транзакции не видят незафиксированных изменений друг друга;
- **Durability** (долговечность) — после `COMMIT` изменения переживут даже сбой сервера.

Без явной транзакции каждая команда — отдельная маленькая транзакция: `UPDATE` сохраняется сразу, как только выполнен. Это называют режимом **автофиксации**.

### BEGIN и COMMIT

```sql
BEGIN;
команда1;
команда2;
COMMIT;
```

- `BEGIN` открывает транзакцию. Все следующие команды входят в неё;
- `COMMIT` фиксирует транзакцию: все изменения сохраняются разом и становятся видны другим подключениям;
- внутри транзакции работают любые `SELECT`, `INSERT`, `UPDATE`, `DELETE`, и вы сразу видите свои изменения;
- каждая команда заканчивается `;`.

Выплатим Олегу компенсацию за топливо — 300 ₽ из кассы:

```sql example
BEGIN;
UPDATE accounts SET balance = balance - 300 WHERE id = 1;
UPDATE accounts SET balance = balance + 300 WHERE id = 4;
INSERT INTO payouts (account_id, amount) VALUES (4, 300);
COMMIT;

SELECT id, owner, balance FROM accounts ORDER BY id;
```

| id | owner | balance |
|---|---|---|
| 1 | Касса | 49700.00 |
| 2 | Ильдар | 0.00 |
| 3 | Марина | 1200.00 |
| 4 | Олег | 600.00 |

`balance = balance - 300` — новое значение считается из текущего прямо в базе. Деньги не появились и не исчезли: сумма всех балансов осталась прежней.

### ROLLBACK: отменить всё

`ROLLBACK` вместо `COMMIT` отменяет все изменения с момента `BEGIN`, как будто транзакции не было.

```sql
BEGIN;
команды;
ROLLBACK;
```

Следующие два примера — одна транзакция. Выполните их по очереди: первый открывает транзакцию и обнуляет кассу, второй её отменяет.

```sql example
BEGIN;
UPDATE accounts SET balance = 0 WHERE id = 1;
SELECT id, owner, balance FROM accounts WHERE id = 1;
```

| id | owner | balance |
|---|---|---|
| 1 | Касса | 0.00 |

Внутри транзакции изменение видно. Другие подключения в это время всё ещё видят 49 700 ₽.

```sql example
ROLLBACK;
SELECT id, owner, balance FROM accounts WHERE id = 1;
```

| id | owner | balance |
|---|---|---|
| 1 | Касса | 49700.00 |

### Ошибка внутри транзакции

Если команда внутри транзакции завершилась ошибкой, транзакция ломается целиком. Например, у Олега 600 ₽, а списать пытаются 1000:

```sql
BEGIN;
UPDATE accounts SET balance = balance - 1000 WHERE id = 4;
-- ERROR: new row for relation "accounts" violates check constraint "accounts_balance_check"
SELECT id, balance FROM accounts;
-- ERROR: current transaction is aborted, commands ignored until end of transaction block
ROLLBACK;
```

- после ошибки PostgreSQL отказывается выполнять любые команды, кроме `ROLLBACK`;
- `COMMIT` в такой транзакции тоже сработает как откат: сохранить «половину» нельзя;
- в песочнице этого приложения после ошибки откат выполняется автоматически, чтобы база не оставалась в сломанной транзакции.

Именно это и нужно для выплат: если начислить не удалось, списание тоже отменится.

### SAVEPOINT и ROLLBACK TO: отменить часть

**Точка сохранения** — метка внутри транзакции. К ней можно откатиться, не теряя того, что сделано до неё.

```sql
BEGIN;
команды, которые нужно сохранить;
SAVEPOINT имя_точки;
команды, которые, возможно, придётся отменить;
ROLLBACK TO имя_точки;
команды после отката;
COMMIT;
```

- `SAVEPOINT имя` ставит метку. Имя — любое слово латиницей, без кавычек;
- `ROLLBACK TO имя` отменяет всё, что сделано после метки. Транзакция при этом **продолжается**: можно выполнять новые команды;
- изменения до метки остаются и сохранятся при `COMMIT`;
- просто `ROLLBACK` без `TO` по-прежнему отменяет всю транзакцию, вместе с точками сохранения;
- точки сохранения работают только внутри `BEGIN … COMMIT`.

Марине выплачивают 700 ₽. Потом оператор по ошибке начисляет Олегу 7000 вместо 700 и откатывается к точке сохранения:

```sql example
BEGIN;
INSERT INTO payouts (account_id, amount) VALUES (3, 700);
UPDATE accounts SET balance = balance - 700 WHERE id = 1;
UPDATE accounts SET balance = balance + 700 WHERE id = 3;
SAVEPOINT after_marina;
UPDATE accounts SET balance = balance + 7000 WHERE id = 4;
ROLLBACK TO after_marina;
COMMIT;

SELECT id, owner, balance FROM accounts ORDER BY id;
```

| id | owner | balance |
|---|---|---|
| 1 | Касса | 49000.00 |
| 2 | Ильдар | 0.00 |
| 3 | Марина | 1900.00 |
| 4 | Олег | 600.00 |

Выплата Марине сохранилась, ошибочное начисление Олегу исчезло. В журнале — обе выплаты, сделанные до сих пор:

```sql example
SELECT account_id, amount FROM payouts ORDER BY id;
```

| account_id | amount |
|---|---|
| 4 | 300.00 |
| 3 | 700.00 |

### Параллельные транзакции

В настоящем приложении к базе одновременно подключены десятки процессов: сайт, касса, фоновые обработчики. Их транзакции идут параллельно, и PostgreSQL должен решить, что каждая из них видит и кто кого ждёт. Песочница этого приложения работает с одним подключением, поэтому дальше — схемы «по шагам». Читайте их сверху вниз: каждая строка — момент времени, столбцы — два разных подключения A и B.

Главное правило: **незафиксированные изменения чужой транзакции не видны никогда**. Вопрос только в том, когда транзакция видит то, что другие уже зафиксировали.

### Уровни изоляции

Каждый запрос видит **снимок** данных — состояние базы на определённый момент. Уровень изоляции определяет, когда этот снимок делается.

- `READ COMMITTED` — уровень по умолчанию. Снимок делается перед **каждой командой**: команда видит всё, что зафиксировано до её начала. Два одинаковых `SELECT` в одной транзакции могут вернуть разные данные;
- `REPEATABLE READ` — снимок делается один раз, при первом запросе транзакции, и действует до её конца. Повторный `SELECT` вернёт то же самое, даже если другие успели что-то зафиксировать;
- `SERIALIZABLE` — самый строгий: результат такой, будто транзакции выполнялись строго по очереди. Если это невозможно, одна из них получает ошибку сериализации, и её нужно повторить;
- `READ UNCOMMITTED` в PostgreSQL работает так же, как `READ COMMITTED`: «грязное» чтение чужих незафиксированных данных здесь запрещено.

Чем строже уровень, тем больше гарантий, но тем чаще транзакции мешают друг другу. Поэтому выбирают **самый слабый уровень, который решает задачу**.

Как это выглядит в `READ COMMITTED`:

| Шаг | A (отчёт) | B (касса) |
|---|---|---|
| 1 | `BEGIN;` | |
| 2 | `SELECT sum(balance) FROM accounts;` → 51 500 | |
| 3 | | `UPDATE accounts SET balance = balance + 100 WHERE id = 3;` |
| 4 | | `COMMIT;` |
| 5 | `SELECT sum(balance) FROM accounts;` → 51 600 | |
| 6 | `COMMIT;` | |

На шаге 5 команда A взяла новый снимок и увидела изменение B. В `REPEATABLE READ` на шаге 5 снова было бы 51 500: снимок сделан на шаге 2.

Уровень задают сразу при открытии транзакции:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
команды;
COMMIT;
```

- после `BEGIN` пишут `ISOLATION LEVEL` и название уровня;
- уровень действует только на эту транзакцию;
- текущий уровень показывает команда `SHOW transaction_isolation;`.

```sql example
SHOW transaction_isolation;
```

| transaction_isolation |
|---|
| read committed |

```sql example
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) AS payouts_count, sum(amount) AS payouts_sum FROM payouts;
SHOW transaction_isolation;
COMMIT;
```

| transaction_isolation |
|---|
| repeatable read |

### Блокировки строк

`UPDATE` и `DELETE` **блокируют** изменённые строки до конца своей транзакции. Пока блокировка держится, другая транзакция может читать эти строки (она увидит старую, зафиксированную версию), но изменить их не может — она ждёт.

| Шаг | A | B |
|---|---|---|
| 1 | `BEGIN;` | |
| 2 | `UPDATE accounts SET balance = balance - 100 WHERE id = 1;` | |
| 3 | | `UPDATE accounts SET balance = balance + 50 WHERE id = 1;` — ждёт |
| 4 | `COMMIT;` | |
| 5 | | ожидание закончилось, `UPDATE` выполнен |

- после `COMMIT` транзакции A транзакция B в `READ COMMITTED` перечитывает свежую версию строки и прибавляет 50 к уже уменьшенному балансу. Сохраняются оба изменения;
- если бы A сделала `ROLLBACK`, B применила бы изменение к исходному значению;
- **взаимная блокировка** (deadlock) возникает, только когда транзакции ждут друг друга по кругу: A заблокировала строку 1 и ждёт строку 2, а B заблокировала строку 2 и ждёт строку 1. PostgreSQL замечает такой круг и прерывает одну из транзакций ошибкой `deadlock detected`.

### Потерянное обновление и SELECT … FOR UPDATE

Опасная схема в коде приложения: прочитать значение, посчитать новое у себя и записать результат обратно. В Python транзакцию часто открывают блоком `with conn.transaction():` — в начале блока выполняется `BEGIN`, в конце `COMMIT`. Но транзакция сама по себе эту схему не спасает:

| Шаг | A (начисляет 50) | B (начисляет 30) |
|---|---|---|
| 1 | `SELECT balance … WHERE id = 4;` → 600 | |
| 2 | | `SELECT balance … WHERE id = 4;` → 600 |
| 3 | `UPDATE … SET balance = 650 WHERE id = 4;` | |
| 4 | `COMMIT;` | |
| 5 | | `UPDATE … SET balance = 630 WHERE id = 4;` |
| 6 | | `COMMIT;` |

Итог 630 вместо 680: начисление A пропало. Это **потерянное обновление**. Обычный `SELECT` строку не блокирует, поэтому оба прочитали одно и то же. Два решения:

- **считать в самой базе**: `UPDATE accounts SET balance = balance + 50 WHERE id = 4;`. Второй `UPDATE` дождётся блокировки и прибавит своё к свежему значению;
- **блокировать при чтении**: `SELECT … FOR UPDATE` читает строку и сразу блокирует её, как `UPDATE`. Вторая транзакция на своём `SELECT … FOR UPDATE` будет ждать, пока первая не завершится, и прочитает уже новое значение.

```sql
BEGIN;
SELECT столбцы FROM таблица WHERE условие FOR UPDATE;
UPDATE таблица SET … WHERE условие;
COMMIT;
```

- `FOR UPDATE` пишут в самом конце `SELECT`;
- блокировка держится до `COMMIT` или `ROLLBACK`, поэтому `FOR UPDATE` имеет смысл только внутри транзакции.

```sql example
BEGIN;
SELECT id, owner, balance FROM accounts WHERE id = 3 FOR UPDATE;
UPDATE accounts SET balance = balance - 200 WHERE id = 3;
COMMIT;

SELECT id, owner, balance FROM accounts WHERE id = 3;
```

| id | owner | balance |
|---|---|---|
| 3 | Марина | 1700.00 |

### Частые ошибки

- Забыть `COMMIT` в конце → изменения не сохранятся: незавершённая транзакция откатится при отключении, а другие подключения её изменений не увидят.
- `ROLLBACK;` чтобы отменить только последний шаг → `ROLLBACK TO имя_точки;`. Простой `ROLLBACK` отменяет всю транзакцию.
- `ROLLBACK TO before_bonus;` без предварительного `SAVEPOINT before_bonus;` → сначала поставьте точку. Откатиться к несуществующей точке нельзя: база вернёт ошибку.
- `SELECT bonus …`, расчёт в приложении, `UPDATE … SET bonus = 150` → `UPDATE … SET bonus = bonus + 50` или `SELECT … FOR UPDATE`. Иначе параллельные вызовы теряют изменения друг друга.

### Шпаргалка

- `BEGIN;` … `COMMIT;` — выполнить всё или ничего.
- `ROLLBACK;` — отменить всю транзакцию.
- `SAVEPOINT имя;` … `ROLLBACK TO имя;` — отменить часть, транзакция продолжается.
- После ошибки в транзакции работает только `ROLLBACK`.
- `BEGIN ISOLATION LEVEL REPEATABLE READ;` · `SHOW transaction_isolation;`
- `READ COMMITTED` — снимок на команду (по умолчанию); `REPEATABLE READ` — на транзакцию; `SERIALIZABLE` — как по очереди, возможна ошибка сериализации.
- `UPDATE` блокирует строку до конца транзакции; вторая транзакция ждёт.
- Без потерянных обновлений: `SET x = x + 1` или `SELECT … FOR UPDATE`.

## task w5-payouts-savepoint
```json
{
  "type": "state",
  "title": "Выплаты с точкой сохранения",
  "xp": 25,
  "hints": [
    "См. раздел «SAVEPOINT и ROLLBACK TO: отменить часть». `SAVEPOINT before_bonus;` ставит метку, `ROLLBACK TO before_bonus;` отменяет всё, что сделано после неё, а транзакция продолжается.",
    "Каркас: `BEGIN; … SAVEPOINT before_bonus; … ROLLBACK TO before_bonus; … COMMIT;` Каждая выплата — два `UPDATE accounts SET balance = balance ± сумма WHERE id = …;` и `INSERT INTO payouts (account_id, amount) VALUES (…, …);`. Премию трём курьерам можно начислить одним `UPDATE … WHERE id IN (…)`."
  ]
}
```
Таблицы: `accounts (id, owner, balance)` — счета: 1 — Касса (50 000 ₽), 2 — Ильдар, 3 — Марина, 4 — Олег; `payouts (id, account_id, amount)` — журнал выплат, `id` база выдаёт сама.

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
  "hints": [
    "См. раздел «Уровни изоляции».",
    "На каком уровне снимок данных делается один раз на всю транзакцию, а не перед каждой командой?"
  ]
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
  "hints": [
    "См. раздел «Блокировки строк».",
    "Что делает `UPDATE` со строкой до конца своей транзакции?"
  ]
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
  "hints": [
    "См. раздел «Потерянное обновление и SELECT … FOR UPDATE».",
    "Представьте два вызова, которые выполнили строку 3 одновременно. Какое значение каждый из них запишет?"
  ]
}
```
Бонусы клиентов хранятся в таблице `customers (id, bonus)`. Их начисляют два фоновых обработчика: один за отзывы, другой за покупки. Иногда они срабатывают для одного клиента одновременно, и одно начисление «пропадает». В чём причина?

```python code
def add_bonus(conn, customer_id, amount):
    with conn.transaction():
        cur = conn.execute("SELECT bonus FROM customers WHERE id = %s", (customer_id,))
        bonus = cur.fetchone()[0]
        conn.execute("UPDATE customers SET bonus = %s WHERE id = %s",
                     (bonus + amount, customer_id))
```
