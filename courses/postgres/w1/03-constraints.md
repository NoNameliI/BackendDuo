# Ограничения целостности

В «Полке» нашлись два клиента с одним e-mail, позиция заказа на −3 книги и доставка без статуса. Приложение всё это проверяло, но скрипт импорта проверки обошёл. **Ограничения** (constraints) защищают данные на уровне самой базы: их не обойдёт ни приложение, ни ручной запрос. В прошлом уроке вы уже писали ограничения в `CREATE TABLE`. Здесь разберём каждое подробно, научимся добавлять их к готовой таблице и спокойно пропускать дубликаты при импорте.

### Как база реагирует на нарушение

Если запрос нарушает хотя бы одно ограничение, PostgreSQL отменяет его целиком. Из ста строк одного `INSERT` не сохранится ни одна, даже если ошибочна только последняя. Причину называет пятизначный код ошибки:

| Код | Что нарушено | Пример |
|---|---|---|
| `23502` | `NOT NULL` | в обязательный столбец попал `NULL` |
| `23505` | `UNIQUE` или `PRIMARY KEY` | второй клиент с тем же e-mail |
| `23514` | `CHECK` | цена `0` при `CHECK (price > 0)` |
| `23503` | `FOREIGN KEY` | ссылка на несуществующую строку |

В тексте ошибки есть имя нарушенного ограничения, например `demo_members_email_key`. По нему легко понять, какое правило сработало.

### PRIMARY KEY и NOT NULL

- `NOT NULL` — значение обязательно. Пустое значение (`NULL`) столбец не примет.
- `PRIMARY KEY` — идентификатор строки. Он одновременно уникален и обязателен (`NOT NULL` писать не нужно). Первичный ключ в таблице один.

```sql
CREATE TABLE таблица (
  id serial PRIMARY KEY,
  столбец тип NOT NULL
);
```

- Ограничение пишется после типа столбца.
- `serial PRIMARY KEY` — привычная пара: база сама выдаёт номера, и они никогда не повторяются.

### UNIQUE

`UNIQUE` запрещает повторы значений в столбце. Повтором считаются только одинаковые заполненные значения: `NULL` означает «неизвестно», и два неизвестных значения не считаются равными. Поэтому сколько угодно строк могут оставить такой столбец пустым.

```sql
столбец тип UNIQUE              -- необязательный, но без повторов
столбец тип NOT NULL UNIQUE     -- обязательный и без повторов
```

- Ограничения столбца пишутся через пробел в любом порядке: `NOT NULL UNIQUE` и `UNIQUE NOT NULL` равнозначны.
- Если значение должно быть и обязательным, и уникальным, нужны оба слова: `UNIQUE` сам по себе `NULL` не запрещает.

```sql example
CREATE TABLE demo_members (
  id       serial PRIMARY KEY,
  email    text NOT NULL UNIQUE,
  nickname text UNIQUE,
  age      integer CHECK (age >= 14),
  points   integer NOT NULL DEFAULT 0
);
INSERT INTO demo_members (email, nickname, age) VALUES
  ('anna@demo.ru', 'anna', 31),
  ('boris@demo.ru', NULL, NULL),
  ('vera@demo.ru', NULL, 19);
SELECT * FROM demo_members;
```

| id | email | nickname | age | points |
|---|---|---|---|---|
| 1 | anna@demo.ru | anna | 31 | 0 |
| 2 | boris@demo.ru | NULL | NULL | 0 |
| 3 | vera@demo.ru | NULL | 19 | 0 |

У Бориса и Веры пустой `nickname`, и `UNIQUE` это разрешил. А вторая строка с `email = 'anna@demo.ru'` вызвала бы ошибку `23505`.

### CHECK и оператор IN

`CHECK (условие)` проверяет каждую вставляемую и изменяемую строку. Если условие ложно, строка отклоняется с ошибкой `23514`.

```sql
столбец тип CHECK (условие)
```

- Условие записывается так же, как в `WHERE`: `CHECK (age >= 14)`, `CHECK (price > 0 AND price < 100000)`.
- Если в условии участвует `NULL`, результат «неизвестно», и такая строка проверку **проходит**. Так в примере выше Борис сохранился без возраста. Чтобы значение было и обязательным, и проверенным, добавьте `NOT NULL`.
- Когда допустимы только несколько конкретных значений, используйте `IN`: `столбец IN ('a', 'b', 'c')` верно, если значение совпадает с одним из перечисленных. Список — в круглых скобках, значения через запятую, текст в одинарных кавычках.

```sql
status text CHECK (status IN ('значение1', 'значение2', 'значение3'))
```

В учебной базе «Полки» так устроен статус заказа: `CHECK (status IN ('new', 'paid', 'shipped', 'cancelled'))`. Любое другое слово, например `'done'`, база отклонит.

### DEFAULT и явный NULL

`DEFAULT значение` подставляется, когда значение для столбца не передали.

```sql
столбец тип DEFAULT значение
INSERT INTO таблица (столбец) VALUES (DEFAULT);
```

- `DEFAULT` срабатывает, если столбца нет в списке `INSERT` или вместо значения написано слово `DEFAULT`.
- Явно переданный `NULL` — это тоже значение. `DEFAULT` его **не** заменяет. Если у столбца есть `NOT NULL`, такой `INSERT` завершится ошибкой `23502`.
- `DEFAULT` и `NOT NULL` часто ставят вместе: `points integer NOT NULL DEFAULT 0`. Значение обязательно, но писать его каждый раз не нужно.

```sql example
INSERT INTO demo_members (email, points) VALUES
  ('gleb@demo.ru', 50),
  ('dina@demo.ru', DEFAULT);
SELECT email, points FROM demo_members;
```

| email | points |
|---|---|
| anna@demo.ru | 0 |
| boris@demo.ru | 0 |
| vera@demo.ru | 0 |
| gleb@demo.ru | 50 |
| dina@demo.ru | 0 |

А запрос `INSERT INTO demo_members (email, points) VALUES ('x@demo.ru', NULL);` упадёт: `null value in column "points" … violates not-null constraint`.

### Ограничения на уровне таблицы и их имена

Ограничение можно записать не в строке столбца, а отдельной строкой после всех столбцов. Так пишут правила, которые касаются нескольких столбцов сразу.

```sql
CREATE TABLE таблица (
  столбец1 тип,
  столбец2 тип,
  PRIMARY KEY (столбец1, столбец2),
  CONSTRAINT имя_ограничения CHECK (условие)
);
```

- Ограничения таблицы идут после столбцов и отделяются запятыми, как столбцы.
- `PRIMARY KEY (a, b)` — составной ключ: уникальна пара значений, а не каждое по отдельности.
- `UNIQUE (a, b)` — так же запрещает повтор пары.
- `CONSTRAINT имя` перед правилом задаёт ему имя. Без него PostgreSQL придумает имя сам: `таблица_столбец_key` для `UNIQUE`, `таблица_столбец_check` для `CHECK`, `таблица_pkey` для первичного ключа. Своё имя лучше давать по той же схеме.

```sql example
CREATE TABLE demo_shifts (
  worker text NOT NULL,
  day    date NOT NULL,
  hours  numeric(4, 1) NOT NULL,
  PRIMARY KEY (worker, day),
  CONSTRAINT demo_shifts_hours_check CHECK (hours > 0 AND hours <= 12)
);
INSERT INTO demo_shifts (worker, day, hours) VALUES
  ('Илья', '2024-05-06', 8),
  ('Илья', '2024-05-07', 6.5),
  ('Марат', '2024-05-06', 12);
SELECT * FROM demo_shifts;
```

| worker | day | hours |
|---|---|---|
| Илья | 2024-05-06 | 8.0 |
| Илья | 2024-05-07 | 6.5 |
| Марат | 2024-05-06 | 12.0 |

Илья может работать в разные дни, а в один день у двух разных сотрудников тоже нет конфликта. Повторить пару «Илья, 2024-05-06» нельзя.

### ALTER TABLE: изменить столбец

Таблица уже создана и в ней есть данные, а правила нужно ужесточить. Пересоздавать таблицу не нужно: `ALTER TABLE` меняет её на месте.

```sql
ALTER TABLE таблица ALTER COLUMN столбец SET NOT NULL;
ALTER TABLE таблица ALTER COLUMN столбец DROP NOT NULL;
ALTER TABLE таблица ALTER COLUMN столбец SET DEFAULT значение;
ALTER TABLE таблица ALTER COLUMN столбец DROP DEFAULT;
```

- `ALTER TABLE таблица` — какую таблицу менять, `ALTER COLUMN столбец` — какой столбец.
- `SET NOT NULL` делает столбец обязательным, `DROP NOT NULL` снимает это правило.
- `SET DEFAULT значение` задаёт значение по умолчанию, `DROP DEFAULT` убирает его. Текст по-прежнему в одинарных кавычках.
- Одна команда — одно изменение. Каждая заканчивается точкой с запятой.

Таблица заявок, созданная без ограничений:

```sql example
CREATE TABLE demo_tickets (
  id       serial PRIMARY KEY,
  code     text,
  priority text,
  price    numeric(8, 2)
);
INSERT INTO demo_tickets (code, priority, price) VALUES
  ('T-1', 'high', 300),
  ('T-2', 'low', NULL),
  ('T-3', 'normal', 150);
```

Сделаем код заявки обязательным, а приоритет по умолчанию — `'normal'`:

```sql example
ALTER TABLE demo_tickets ALTER COLUMN code SET NOT NULL;
ALTER TABLE demo_tickets ALTER COLUMN priority SET DEFAULT 'normal';
INSERT INTO demo_tickets (code) VALUES ('T-4');
SELECT * FROM demo_tickets;
```

| id | code | priority | price |
|---|---|---|---|
| 1 | T-1 | high | 300.00 |
| 2 | T-2 | low | NULL |
| 3 | T-3 | normal | 150.00 |
| 4 | T-4 | normal | NULL |

### ALTER TABLE: добавить ограничение

`UNIQUE` и `CHECK` добавляются к готовой таблице командой `ADD CONSTRAINT`.

```sql
ALTER TABLE таблица ADD CONSTRAINT имя UNIQUE (столбец);
ALTER TABLE таблица ADD CONSTRAINT имя CHECK (условие);
ALTER TABLE таблица DROP CONSTRAINT имя;
```

- После `ADD CONSTRAINT` идёт имя ограничения, затем само правило.
- Столбец для `UNIQUE` указывается в скобках.
- `DROP CONSTRAINT имя` удаляет ограничение. Здесь и пригождаются понятные имена.
- Перед добавлением база проверяет **все** строки таблицы. Если хоть одна нарушает правило, ограничение не появится, а вы получите ошибку. Сначала исправьте данные (как менять строки, вы узнаете в следующем уроке), затем повторите команду.

```sql example
ALTER TABLE demo_tickets ADD CONSTRAINT demo_tickets_code_key UNIQUE (code);
ALTER TABLE demo_tickets ADD CONSTRAINT demo_tickets_priority_check
  CHECK (priority IN ('low', 'normal', 'high'));
```

Результат: оба ограничения добавлены, потому что существующие строки им не противоречат. А вот `CHECK (price > 200)` не добавится: заявка `T-3` стоит 150. Не выйдет и `SET NOT NULL` для `price`: у двух заявок цена пустая.

### ON CONFLICT DO NOTHING

При импорте часть строк может уже быть в таблице. Обычный `INSERT` упадёт с ошибкой `23505` и не добавит ни одной строки. Конструкция `ON CONFLICT … DO NOTHING` пропускает конфликтующие строки и добавляет остальные.

```sql
INSERT INTO таблица (столбец1, столбец2) VALUES
  (значение1, значение2),
  (значение1, значение2)
ON CONFLICT (уникальный_столбец) DO NOTHING;
```

- Пишется в самом конце `INSERT`, после всех строк `VALUES`, перед точкой с запятой.
- В скобках после `ON CONFLICT` — столбец с `UNIQUE` или `PRIMARY KEY`, по которому ищутся совпадения.
- `DO NOTHING` — строку-дубликат пропустить. Существующая строка в таблице остаётся как была: ни одно её поле не меняется.
- Столбец в скобках можно не указывать: `ON CONFLICT DO NOTHING` пропускает строку, которая нарушает любое ограничение `UNIQUE` или `PRIMARY KEY` таблицы.
- Ошибки других ограничений (`NOT NULL`, `CHECK`) `ON CONFLICT` не скрывает.

```sql example
INSERT INTO demo_members (email, nickname) VALUES
  ('anna@demo.ru', 'anna_new'),
  ('dasha@demo.ru', 'dasha')
ON CONFLICT (email) DO NOTHING;
SELECT email, nickname FROM demo_members;
```

| email | nickname |
|---|---|
| anna@demo.ru | anna |
| boris@demo.ru | NULL |
| vera@demo.ru | NULL |
| gleb@demo.ru | NULL |
| dina@demo.ru | NULL |
| dasha@demo.ru | dasha |

Добавилась только Даша. Строка Анны пропущена, и её `nickname` остался `anna`.

### Частые ошибки

- `phone text NOT NULL UNIQUE` для необязательного телефона → `phone text UNIQUE`. `NOT NULL` запретит клиентам оставлять поле пустым, а `UNIQUE` и так допускает много пустых значений.
- `VALUES ('x@demo.ru', NULL)` в надежде на `DEFAULT` → не указывайте столбец или напишите `DEFAULT`. Явный `NULL` не заменяется значением по умолчанию.
- `ALTER TABLE t ADD CONSTRAINT t_status_check CHECK status IN ('a', 'b')` → `CHECK (status IN ('a', 'b'))`. Условие `CHECK` всегда в круглых скобках.
- `ALTER TABLE t ADD CONSTRAINT t_code_key NOT NULL (code)` → `ALTER TABLE t ALTER COLUMN code SET NOT NULL`. `NOT NULL` и `DEFAULT` меняются через `ALTER COLUMN`, а `UNIQUE` и `CHECK` — через `ADD CONSTRAINT`.

### Шпаргалка

```sql
id serial PRIMARY KEY
email text NOT NULL UNIQUE
phone text UNIQUE                                   -- NULL можно, повторы нельзя
bonus integer NOT NULL DEFAULT 0 CHECK (bonus >= 0)
status text CHECK (status IN ('new', 'done'))
PRIMARY KEY (a, b)                                  -- строкой после столбцов
CONSTRAINT имя CHECK (условие)
ALTER TABLE t ALTER COLUMN c SET NOT NULL;
ALTER TABLE t ALTER COLUMN c SET DEFAULT 'new';
ALTER TABLE t ADD CONSTRAINT t_c_key UNIQUE (c);
ALTER TABLE t ADD CONSTRAINT t_c_check CHECK (c > 0);
INSERT INTO t (a, b) VALUES (1, 2) ON CONFLICT (a) DO NOTHING;
```

## task w1-customers-constraints
```json
{
  "type": "schema",
  "title": "Клиенты без дублей",
  "xp": 15,
  "hints": [
    "См. разделы «UNIQUE», «CHECK и оператор IN» и «DEFAULT и явный NULL». Телефон необязателен, поэтому у `phone` есть `UNIQUE`, но нет `NOT NULL`.",
    "`email text NOT NULL …`, `phone text …`, `bonus integer NOT NULL DEFAULT … CHECK (… >= 0)`"
  ]
}
```
Создайте таблицу `customers` для клиентов «Полки» с пятью столбцами:

- `id` — первичный ключ, который база генерирует сама;
- `email` — текст, обязательный и уникальный;
- `full_name` — текст, обязательный;
- `phone` — текст, необязательный, но двух клиентов с одним номером быть не может;
- `bonus` — бонусные баллы, `integer`, обязательные, по умолчанию `0`, не меньше нуля.

```sql starter
CREATE TABLE customers (
  id …,
  email …,
  full_name …,
  phone …,
  bonus …
);
```

```sql solution
CREATE TABLE customers (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text UNIQUE,
  bonus integer NOT NULL DEFAULT 0 CHECK (bonus >= 0)
);
```

## task w1-default-vs-null
```json
{
  "type": "choice",
  "title": "DEFAULT и явный NULL",
  "xp": 5,
  "options": [
    "Вставит строку со `stock = 0`: сработает `DEFAULT`",
    "Вставит строку со `stock = NULL`",
    "Завершится ошибкой: нарушено ограничение `NOT NULL`",
    "Молча пропустит строку и ничего не вставит"
  ],
  "answer": [2],
  "explanation": "`DEFAULT` подставляется, только когда столбец не перечислили в `INSERT` или вместо значения написали слово `DEFAULT`. Явный `NULL` — это переданное значение, и `NOT NULL` отклонит его с ошибкой `23502`. Поэтому `NULL` в столбце не окажется, а `0` не подставится. Молча пропускать строки PostgreSQL не умеет: так работает только `ON CONFLICT … DO NOTHING`, и только при конфликте уникальности.",
  "hints": ["См. раздел «DEFAULT и явный NULL»: чем «столбец не указали» отличается от «указали значение `NULL`»?"]
}
```
В таблице товаров есть столбец `stock integer NOT NULL DEFAULT 0`. Что сделает запрос?

```sql
INSERT INTO products (name, price, stock)
VALUES ('Линейка', 50, NULL);
```

## task w1-import-customers
```json
{
  "type": "state",
  "title": "Импорт без дублей",
  "xp": 15,
  "dataset": "shop",
  "hints": [
    "См. раздел «ON CONFLICT DO NOTHING»: конфликт возникает на повторяющемся `email`, и такие строки можно пропустить, не отменяя весь запрос.",
    "Допишите в конец запроса, перед точкой с запятой: `ON CONFLICT (…) DO NOTHING`."
  ]
}
```
Маркетинг прислал список подписчиков рассылки, чтобы завести их как клиентов. Таблица `customers (id, full_name, email, city, registered_on)`, у столбца `email` есть ограничение `UNIQUE`. Двое подписчиков уже есть в базе, поэтому запрос в редакторе падает с ошибкой `23505` и никого не добавляет.

Исправьте запрос: новые клиенты должны добавиться, а данные существующих — остаться прежними, включая город и дату регистрации.

```sql starter
INSERT INTO customers (full_name, email, city, registered_on) VALUES
  ('Ирина Соколова', 'irina@polka.ru', 'Москва', '2024-04-01'),
  ('Анна Смирнова', 'anna@polka.ru', 'Казань', '2024-04-01'),
  ('Кирилл Белов', 'kirill@polka.ru', 'Казань', '2024-04-02'),
  ('Вера Ким', 'vera@polka.ru', 'Сочи', '2024-04-03');
```

```sql solution
INSERT INTO customers (full_name, email, city, registered_on) VALUES
  ('Ирина Соколова', 'irina@polka.ru', 'Москва', '2024-04-01'),
  ('Анна Смирнова', 'anna@polka.ru', 'Казань', '2024-04-01'),
  ('Кирилл Белов', 'kirill@polka.ru', 'Казань', '2024-04-02'),
  ('Вера Ким', 'vera@polka.ru', 'Сочи', '2024-04-03')
ON CONFLICT (email) DO NOTHING;
```

```sql check
SELECT full_name, email, city, registered_on FROM customers;
```

## task w1-deliveries-alter
```json
{
  "type": "schema",
  "title": "Порядок в доставках",
  "xp": 20,
  "hints": [
    "См. разделы «ALTER TABLE: изменить столбец» и «ALTER TABLE: добавить ограничение»: `NOT NULL` и `DEFAULT` задаются через `ALTER COLUMN`, `UNIQUE` и `CHECK` — через `ADD CONSTRAINT`. Для списка статусов пригодится `IN`.",
    "`ALTER TABLE deliveries ALTER COLUMN … SET NOT NULL;`, `ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check CHECK (status IN (…));`"
  ]
}
```
Курьерская служба «Полки» завела таблицу `deliveries (id, order_id, courier, status, weight_kg)` в спешке, без ограничений. Данные в ней корректны. Добавьте правила с помощью `ALTER TABLE`, не пересоздавая таблицу:

- `order_id` — обязателен и уникален: на один заказ одна доставка;
- `status` — обязателен, по умолчанию `'new'`, допустимы только `new`, `on_the_way` и `delivered`;
- `weight_kg` — вес может быть неизвестен, но если указан, то строго больше нуля.

Столбцы `id` и `courier` не меняйте. Имена ограничений выберите сами.

```sql setup
CREATE TABLE deliveries (
  id serial PRIMARY KEY,
  order_id integer,
  courier text NOT NULL,
  status text,
  weight_kg numeric(6, 2)
);
INSERT INTO deliveries (order_id, courier, status, weight_kg) VALUES
  (101, 'Илья', 'delivered', 1.20),
  (102, 'Илья', 'on_the_way', 0.45),
  (103, 'Марат', 'new', 3.00),
  (104, 'Марат', 'new', NULL);
```

```sql solution
ALTER TABLE deliveries ALTER COLUMN order_id SET NOT NULL;
ALTER TABLE deliveries ADD CONSTRAINT deliveries_order_id_key UNIQUE (order_id);
ALTER TABLE deliveries ALTER COLUMN status SET NOT NULL;
ALTER TABLE deliveries ALTER COLUMN status SET DEFAULT 'new';
ALTER TABLE deliveries ADD CONSTRAINT deliveries_status_check
  CHECK (status IN ('new', 'on_the_way', 'delivered'));
ALTER TABLE deliveries ADD CONSTRAINT deliveries_weight_kg_check CHECK (weight_kg > 0);
```
