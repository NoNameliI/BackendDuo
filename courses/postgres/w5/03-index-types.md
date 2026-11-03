# Виды индексов

У «Полки» 200 тысяч клиентов, а характеристики товаров хранятся в формате JSON. Обычный индекс по столбцу помогает не всегда: клиенты вводят e-mail в разном регистре, отчёты фильтруют по дню, а не по точному времени, фильтр каталога ищет по ключам документа. В этом уроке вы научитесь сверять план с фактом и подбирать индекс под конкретный запрос: по выражению, частичный, Hash и GIN.

Примеры работают с таблицей `customers (id, full_name, email, city)` на 200 000 строк. Имена вида `Клиент 4242`, у каждого третьего клиента e-mail с заглавными буквами: `Client4242@Polka.ru`. Уникальный индекс по `email` и индекс первичного ключа уже есть. Числа в ваших планах могут немного отличаться от показанных: статистика строится по случайной выборке строк.

### EXPLAIN ANALYZE: план и факт

`EXPLAIN` из прошлого урока только оценивает. `EXPLAIN ANALYZE` **выполняет** запрос и рядом с оценкой показывает, что произошло на самом деле.

```sql
EXPLAIN ANALYZE запрос;
```

- запрос действительно выполняется. С `UPDATE` и `DELETE` будьте осторожны: данные изменятся;
- на огромной таблице без индекса это может занять заметное время, поэтому для первого знакомства с планом хватает обычного `EXPLAIN`;
- кнопка «План» на панели редактора делает то же самое для кода из редактора: на вкладке «План» у каждого узла появляется «факт», а сверху — время планирования и выполнения.

```sql example
EXPLAIN ANALYZE SELECT id, email FROM customers WHERE full_name = 'Клиент 4242';
```

```text
Seq Scan on customers  (cost=0.00..4740.00 rows=1 width=25) (actual time=1.328..52.969 rows=1.00 loops=1)
  Filter: (full_name = 'Клиент 4242'::text)
  Rows Removed by Filter: 199999
  Buffers: shared hit=2240
Planning:
  Buffers: shared hit=36
Planning Time: 0.952 ms
Execution Time: 53.355 ms
```

Как читать:

- первая скобка — оценка планировщика (`cost`, `rows`), вторая — факт;
- `actual time=1.328..52.969` — время в миллисекундах до первой и до последней строки узла. У вас оно будет другим: время зависит от компьютера;
- `rows=1.00` — сколько строк узел вернул на самом деле, `loops=1` — сколько раз он выполнялся;
- `Rows Removed by Filter: 199999` — столько строк база прочитала и отбросила. Огромное число здесь — главный признак, что не хватает индекса;
- `Buffers` — сколько страниц данных прочитано при выполнении и при планировании;
- `Planning Time` — время на выбор плана, `Execution Time` — на выполнение. Это миллисекунды, а `cost` — условные единицы.

Если оценка `rows` и факт расходятся в десятки раз, планировщик ошибся в статистике. Обновите её командой `ANALYZE таблица;` — она собирает свежую статистику по выборке строк. В заданиях проверка сама выполняет `ANALYZE` перед построением плана.

### Функции lower и upper

`lower(текст)` переводит текст в нижний регистр, `upper(текст)` — в верхний. Работает и для кириллицы.

```sql example
SELECT lower('Client42@Polka.RU') AS low, upper('Клиент 42') AS up;
```

| low | up |
|---|---|
| client42@polka.ru | КЛИЕНТ 42 |

Так сравнивают значения без учёта регистра: `WHERE lower(email) = 'client42@polka.ru'` найдёт и `Client42@Polka.ru`, и `client42@polka.ru`.

### Функция или приведение типа в условии

Индекс хранит значения столбца в том виде, в каком они лежат в таблице. Если в условии столбец обёрнут в функцию или приведение типа `::`, база должна вычислить выражение для каждой строки, и обычный индекс не подходит. Индекс первичного ключа по `id` есть, но вот что происходит, если сравнивать `id` как текст:

```sql example
EXPLAIN SELECT id, full_name FROM customers WHERE id::text = '4242';
```

```text
Seq Scan on customers  (cost=0.00..5740.00 rows=1000 width=23)
  Filter: ((id)::text = '4242'::text)
```

Тот же поиск, но условие сравнивает сам столбец:

```sql example
EXPLAIN SELECT id, full_name FROM customers WHERE id = 4242;
```

```text
Index Scan using customers_pkey on customers  (cost=0.42..8.44 rows=1 width=23)
  Index Cond: (id = 4242)
```

Правило: оставляйте столбец в условии «голым», а все вычисления переносите на сторону значения. Если так нельзя, постройте индекс по выражению.

### Индекс по выражению

Индекс можно построить не по столбцу, а по результату выражения. Тогда в нём хранится уже вычисленное значение, например имя в верхнем регистре.

```sql
CREATE INDEX имя_индекса ON таблица (функция(столбец));
```

- в скобках вместо столбца пишут выражение: `(upper(full_name))`, `(lower(email))`;
- если выражение — не вызов функции, а, например, приведение типа, его берут во вторые скобки: `((id::text))`;
- запрос должен содержать **то же самое** выражение. Индекс по `upper(full_name)` не поможет условию `lower(full_name) = …` или `full_name = …`.

```sql example
CREATE INDEX customers_full_name_upper_idx ON customers (upper(full_name));

EXPLAIN SELECT id, email FROM customers WHERE upper(full_name) = 'КЛИЕНТ 4242';
```

```text
Bitmap Heap Scan on customers  (cost=28.17..1832.22 rows=1000 width=25)
  Recheck Cond: (upper(full_name) = 'КЛИЕНТ 4242'::text)
  ->  Bitmap Index Scan on customers_full_name_upper_idx  (cost=0.00..27.92 rows=1000 width=0)
        Index Cond: (upper(full_name) = 'КЛИЕНТ 4242'::text)
```

Сам запрос возвращает нужного клиента:

```sql example
SELECT id, email FROM customers WHERE upper(full_name) = 'КЛИЕНТ 4242';
```

| id | email |
|---|---|
| 4242 | Client4242@Polka.ru |

### Даты: диапазон вместо приведения типа

Значения дат и времени пишут как текст в одинарных кавычках с названием типа впереди:

- `DATE '2024-03-08'` — дата в формате `ГГГГ-ММ-ДД`;
- `TIMESTAMP '2024-03-08 14:30'` — дата и время;
- `INTERVAL '10 minutes'` — промежуток времени. Его можно прибавлять к `TIMESTAMP` и умножать на число;
- `значение::date` отбрасывает время и оставляет дату.

```sql example
SELECT TIMESTAMP '2024-03-08 14:30' AS ts,
       TIMESTAMP '2024-03-08 14:30'::date AS day,
       TIMESTAMP '2024-03-08 14:30' + INTERVAL '10 minutes' AS later;
```

| ts | day | later |
|---|---|---|
| 2024-03-08 14:30:00 | 2024-03-08 | 2024-03-08 14:40:00 |

Чтобы найти записи за один день, хочется написать `столбец::date = DATE '…'`. Но это приведение типа над столбцом — индекс по нему не сработает. Создадим таблицу визитов на 200 000 строк, по визиту в минуту, и индекс по времени визита:

```sql example
CREATE TABLE demo_visits (
  customer_id int NOT NULL,
  visited_at timestamp NOT NULL
);
INSERT INTO demo_visits (customer_id, visited_at)
SELECT id, TIMESTAMP '2024-01-01' + id * INTERVAL '1 minute'
FROM customers;
CREATE INDEX demo_visits_visited_at_idx ON demo_visits (visited_at);
ANALYZE demo_visits;

EXPLAIN SELECT customer_id FROM demo_visits WHERE visited_at::date = DATE '2024-02-10';
```

```text
Seq Scan on demo_visits  (cost=0.00..4082.00 rows=1000 width=4)
  Filter: ((visited_at)::date = '2024-02-10'::date)
```

Сутки — это **полуоткрытый диапазон**: от полуночи нужного дня включительно до полуночи следующего дня, не включая её.

```sql
WHERE столбец >= DATE 'день' AND столбец < DATE 'следующий день'
```

- `>=` включает начало дня `00:00:00`;
- `<` исключает полночь следующего дня, но включает `23:59:59.999`. Вариант с `BETWEEN … AND '… 23:59:59'` потерял бы доли секунды;
- при сравнении `timestamp` с `DATE` дата превращается в полночь этого дня;
- столбец остаётся «голым», поэтому индекс подходит.

```sql example
EXPLAIN SELECT customer_id FROM demo_visits
WHERE visited_at >= DATE '2024-02-10'
  AND visited_at < DATE '2024-02-11';
```

```text
Index Scan using demo_visits_visited_at_idx on demo_visits  (cost=0.42..62.46 rows=1502 width=4)
  Index Cond: ((visited_at >= '2024-02-10'::date) AND (visited_at < '2024-02-11'::date))
```

Стоимость 62 вместо 4082, а строки те же самые — проверьте сами:

```sql example
SELECT count(*) AS by_range FROM demo_visits
WHERE visited_at >= DATE '2024-02-10' AND visited_at < DATE '2024-02-11';
```

| by_range |
|---|
| 1440 |

Вариант с `visited_at::date = DATE '2024-02-10'` вернёт те же 1440 визитов, только медленнее.

В заданиях, где нужно переписать сам запрос, нажмите «Скопировать в редактор», измените условие и нажмите «План» на панели редактора. Проверка сравнит результат с исходным запросом и оценит план вашего запроса.

### Частичный индекс

Частичный индекс хранит не все строки таблицы, а только те, что подходят под условие. Он маленький, быстро обновляется и идеален, когда запросы всегда ищут редкую группу строк.

```sql
CREATE INDEX имя_индекса ON таблица (столбец) WHERE условие;
```

- `WHERE` в конце — какие строки попадут в индекс;
- запрос использует такой индекс, только если его условие совпадает с условием индекса или сужает его;
- столбец в скобках — тот, по которому ищут или сортируют внутри выбранной группы.

Пусть 200 клиентов из 200 000 заблокированы, а служба поддержки регулярно просматривает их список. Добавим столбец командой `ALTER TABLE таблица ADD COLUMN столбец тип ограничения;` (у существующих строк он получит значение `DEFAULT`) и обновим статистику:

```sql example
ALTER TABLE customers ADD COLUMN blocked boolean NOT NULL DEFAULT false;
UPDATE customers SET blocked = true WHERE id BETWEEN 5000 AND 5199;
ANALYZE customers;

EXPLAIN SELECT id, email FROM customers WHERE blocked ORDER BY id LIMIT 10;
```

```text
Limit  (cost=0.42..470.31 rows=10 width=25)
  ->  Index Scan using customers_pkey on customers  (cost=0.42..7518.68 rows=160 width=25)
        Filter: blocked
```

`WHERE blocked` — короткая запись `WHERE blocked = true`. Без подходящего индекса база идёт по первичному ключу и проверяет флаг у каждой строки подряд, пока не наберёт десять. Частичный индекс хранит только заблокированных:

```sql example
CREATE INDEX customers_blocked_idx ON customers (id) WHERE blocked;

EXPLAIN SELECT id, email FROM customers WHERE blocked ORDER BY id LIMIT 10;
```

```text
Limit  (cost=0.14..1.46 rows=10 width=25)
  ->  Index Scan using customers_blocked_idx on customers  (cost=0.14..21.15 rows=160 width=25)
```

В индексе 200 записей вместо 200 000, и они уже упорядочены по `id`. Стоимость упала с сотен условных единиц до полутора.

### Hash-индекс

Hash-индекс хранит не сами значения, а их хеш — короткий числовой «отпечаток». Поэтому он умеет только одно: искать по равенству `=`. Сравнения `<`, `>`, диапазоны и `ORDER BY` ему недоступны. По скорости равенства он обычно мало выигрывает у B-Tree, поэтому встречается редко.

```sql
CREATE INDEX имя_индекса ON таблица USING hash (столбец);
```

- `USING hash` задаёт тип индекса, без него создаётся B-Tree;
- `USING` пишут после имени таблицы, перед скобками со столбцом.

```sql example
CREATE INDEX customers_full_name_hash_idx ON customers USING hash (full_name);

EXPLAIN SELECT id, email FROM customers WHERE full_name = 'Клиент 4242';
```

```text
Index Scan using customers_full_name_hash_idx on customers  (cost=0.00..8.02 rows=1 width=25)
  Index Cond: (full_name = 'Клиент 4242'::text)
```

Для сравнения `>` тот же индекс бесполезен:

```sql example
EXPLAIN SELECT id, email FROM customers WHERE full_name > 'Клиент 99990';
```

```text
Seq Scan on customers  (cost=0.00..4742.00 rows=20 width=25)
  Filter: (full_name > 'Клиент 99990'::text)
```

### jsonb и оператор @>

Тип `jsonb` хранит документ JSON: набор пар «ключ — значение». Удобно, когда у разных строк разный набор свойств, например характеристики товаров.

- значение `jsonb` в запросе пишут как текст в одинарных кавычках, а ключи и текстовые значения внутри — в двойных: `'{"city": "Пермь", "news": true}'`;
- `jsonb_build_object('ключ1', значение1, 'ключ2', значение2)` собирает документ из пар;
- `документ @> 'образец'` — «содержит»: истинно, если все пары образца есть в документе. Остальные ключи документа не мешают.

Создадим профили 50 000 клиентов: город и подписка на рассылку `news`. Выражение `id <= 2000` даёт `true` у первых двух тысяч клиентов и `false` у остальных.

```sql example
CREATE TABLE demo_profiles (
  customer_id int PRIMARY KEY,
  prefs jsonb NOT NULL
);
INSERT INTO demo_profiles (customer_id, prefs)
SELECT id, jsonb_build_object('city', city, 'news', id <= 2000)
FROM customers
WHERE id <= 50000;

SELECT customer_id, prefs FROM demo_profiles ORDER BY customer_id LIMIT 3;
```

| customer_id | prefs |
|---|---|
| 1 | {"city": "Казань", "news": true} |
| 2 | {"city": "Самара", "news": true} |
| 3 | {"city": "Пермь", "news": true} |

```sql example
SELECT customer_id, prefs
FROM demo_profiles
WHERE prefs @> '{"city": "Пермь", "news": true}'
ORDER BY customer_id
LIMIT 3;
```

| customer_id | prefs |
|---|---|
| 3 | {"city": "Пермь", "news": true} |
| 7 | {"city": "Пермь", "news": true} |
| 11 | {"city": "Пермь", "news": true} |

### GIN-индекс

GIN — «обратный» индекс. Он раскладывает каждый документ на элементы (ключи и значения `jsonb`, элементы массива, слова текста) и для каждого элемента хранит список строк, где он встречается. Как предметный указатель в книге: слово — и номера страниц. Поэтому GIN ускоряет `@>` и другие операторы «содержит». B-Tree по столбцу `jsonb` для `@>` не подходит: он сравнивает документы целиком.

```sql
CREATE INDEX имя_индекса ON таблица USING gin (столбец);
```

- `USING gin` — тип индекса, в скобках — столбец `jsonb` целиком;
- запрос менять не нужно: условие `столбец @> '…'` подхватит индекс само;
- для обычного текстового столбца GIN не создать: у него нет правил разбора `text` на элементы.

Без индекса база проверяет каждый документ:

```sql example
EXPLAIN SELECT customer_id FROM demo_profiles WHERE prefs @> '{"city": "Пермь", "news": true}';
```

```text
Seq Scan on demo_profiles  (cost=0.00..1210.95 rows=594 width=4)
  Filter: (prefs @> '{"city": "Пермь", "news": true}'::jsonb)
```

```sql example
CREATE INDEX demo_profiles_prefs_idx ON demo_profiles USING gin (prefs);

EXPLAIN SELECT customer_id FROM demo_profiles WHERE prefs @> '{"city": "Пермь", "news": true}';
```

```text
Bitmap Heap Scan on demo_profiles  (cost=94.45..588.44 rows=500 width=4)
  Recheck Cond: (prefs @> '{"city": "Пермь", "news": true}'::jsonb)
  ->  Bitmap Index Scan on demo_profiles_prefs_idx  (cost=0.00..94.32 rows=500 width=0)
        Index Cond: (prefs @> '{"city": "Пермь", "news": true}'::jsonb)
```

GIN всегда работает через пару `Bitmap Index Scan` + `Bitmap Heap Scan`: сначала собирает строки по всем элементам образца, потом читает их из таблицы.

### Как выбрать индекс

| Запрос | Индекс |
|---|---|
| `=`, `<`, `>`, `BETWEEN`, `ORDER BY` по столбцу | B-Tree: `(столбец)` |
| равенство по одному столбцу и сортировка или диапазон по другому | составной B-Tree: `(столбец_равенства, столбец_сортировки)` |
| условие с функцией: `lower(email) = …` | по выражению: `(lower(email))` |
| всегда одна и та же редкая группа строк | частичный: `(столбец) WHERE условие` |
| только `=` | Hash подойдёт, но B-Tree почти всегда не хуже |
| `jsonb @> '…'`, элементы массива | GIN: `USING gin (столбец)` |

### Частые ошибки

- `WHERE created_at::date = DATE '2024-03-08'` при индексе по `created_at` → `WHERE created_at >= DATE '2024-03-08' AND created_at < DATE '2024-03-09'`. Приведение типа над столбцом отключает индекс.
- Индекс `(email)` для условия `lower(email) = …` → `CREATE INDEX … ON customers (lower(email));`. Выражение в индексе и в запросе должно совпадать.
- `CREATE INDEX … ON demo_profiles (prefs);` для `@>` → `CREATE INDEX … ON demo_profiles USING gin (prefs);`. B-Tree сравнивает документы целиком и «содержит» не ускоряет.
- `CREATE INDEX … USING hash ON customers (full_name);` → `CREATE INDEX … ON customers USING hash (full_name);`. `USING` стоит после имени таблицы.

### Шпаргалка

- `EXPLAIN ANALYZE запрос;` — выполнить и показать факт: `actual time`, `rows`, `loops`, `Rows Removed by Filter`.
- `ANALYZE таблица;` — обновить статистику.
- `lower(текст)`, `upper(текст)` — регистр.
- `DATE 'ГГГГ-ММ-ДД'`, `TIMESTAMP 'ГГГГ-ММ-ДД чч:мм'`, `INTERVAL '1 minute'`, `значение::date`.
- Сутки: `столбец >= DATE 'день' AND столбец < DATE 'следующий день'`.
- По выражению: `CREATE INDEX имя ON таблица (lower(столбец));`
- Частичный: `CREATE INDEX имя ON таблица (столбец) WHERE условие;`
- Hash: `CREATE INDEX имя ON таблица USING hash (столбец);`
- GIN: `CREATE INDEX имя ON таблица USING gin (столбец_jsonb);` и условие `столбец @> '{"ключ": "значение"}'`.

## task w5-index-lower-email
```json
{
  "type": "plan",
  "title": "Вход без учёта регистра",
  "xp": 20,
  "check": { "forbidSeqScan": ["customers"], "maxCostRatio": 0.05 },
  "hints": [
    "См. раздел «Индекс по выражению». Запрос сравнивает не `email`, а `lower(email)`. Обычный индекс хранит исходные значения столбца, а не результат функции.",
    "Шаблон: `CREATE INDEX customers_…_idx ON customers (…(…));`"
  ]
}
```
Таблица `customers (id, full_name, email, city)` — 200 000 клиентов. Клиенты вводят e-mail при входе в разном регистре: `Client4242@Polka.ru`, `client4242@polka.ru`. Поэтому сайт сравнивает адреса в нижнем регистре (запрос ниже). Уникальный индекс по `email` в таблице уже есть, но запрос его не использует.

Создайте индекс, после которого PostgreSQL перестанет читать таблицу `customers` целиком (`Seq Scan`), а стоимость плана упадёт хотя бы в 20 раз.

```sql setup
CREATE TABLE customers (
  id int PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  city text NOT NULL
);
INSERT INTO customers
SELECT g,
       'Клиент ' || g,
       CASE WHEN g % 3 = 0 THEN 'Client' || g || '@Polka.ru' ELSE 'client' || g || '@polka.ru' END,
       (ARRAY['Москва', 'Казань', 'Самара', 'Пермь'])[g % 4 + 1]
FROM generate_series(1, 200000) AS g;
```

```sql query
SELECT id, full_name, email
FROM customers
WHERE lower(email) = 'client4242@polka.ru';
```

```sql solution
CREATE INDEX customers_email_lower_idx ON customers (lower(email));
```

## task w5-index-gin-attributes
```json
{
  "type": "plan",
  "title": "Фильтр по характеристикам",
  "xp": 20,
  "check": { "forbidSeqScan": ["products"], "requireIndexOn": ["products"] },
  "hints": [
    "См. раздел «GIN-индекс». Оператор `@>` («содержит») проверяет, входят ли пары «ключ — значение» в документ. B-Tree по всему столбцу `jsonb` такой поиск не ускорит.",
    "Шаблон: `CREATE INDEX products_…_idx ON products USING … (…);`"
  ]
}
```
Таблица `products (id, name, price, attributes)` — 200 000 товаров. Фильтр каталога ищет товары по характеристикам. Они хранятся в столбце `attributes` типа `jsonb`, например `{"brand": "brand-17", "color": "синий", "format": "A5"}`. Набор ключей у разных товаров может отличаться, поэтому фильтр пишет условие через `@>` (запрос ниже).

Создайте индекс, после которого PostgreSQL перестанет читать таблицу `products` целиком и найдёт товары через индекс.

```sql setup
CREATE TABLE products (
  id int PRIMARY KEY,
  name text NOT NULL,
  price numeric(10, 2) NOT NULL,
  attributes jsonb NOT NULL
);
INSERT INTO products
SELECT g,
       'Товар ' || g,
       (g % 5000) / 10.0 + 50,
       jsonb_build_object(
         'brand', 'brand-' || g % 400,
         'color', (ARRAY['белый', 'чёрный', 'синий', 'красный', 'зелёный'])[g % 5 + 1],
         'format', (ARRAY['A4', 'A5', 'A6'])[g % 3 + 1]
       )
FROM generate_series(1, 200000) AS g;
```

```sql query
SELECT id, name, price
FROM products
WHERE attributes @> '{"brand": "brand-17", "format": "A5"}';
```

```sql solution
CREATE INDEX products_attributes_idx ON products USING gin (attributes);
```

## task w5-sargable-date
```json
{
  "type": "plan",
  "title": "Заказы за день",
  "xp": 25,
  "check": { "mode": "query", "forbidSeqScan": ["orders"], "maxCostRatio": 0.05 },
  "hints": [
    "См. раздел «Даты: диапазон вместо приведения типа». `created_at::date` вычисляется для каждой строки, поэтому индекс по самой `created_at` не подходит. Условие должно сравнивать столбец напрямую.",
    "Шаблон: `SELECT id, total FROM orders WHERE created_at >= DATE '…' AND created_at < DATE '…';`"
  ]
}
```
Таблица `orders (id, customer_id, total, created_at)` — 200 000 заказов, `created_at` типа `timestamp`. Отчёт показывает заказы за 8 марта 2024 года (запрос ниже). Индекс по `created_at` в таблице есть, но план показывает `Seq Scan`.

Нажмите «Скопировать в редактор» и перепишите запрос так, чтобы он использовал индекс и вернул те же строки с теми же столбцами `id` и `total`. Новые индексы не создавайте. Стоимость плана должна упасть хотя бы в 20 раз.

```sql setup
CREATE TABLE orders (
  id int PRIMARY KEY,
  customer_id int NOT NULL,
  total numeric(10, 2) NOT NULL,
  created_at timestamp NOT NULL
);
INSERT INTO orders
SELECT g,
       (g * 7919) % 20000 + 1,
       ((g * 37) % 50000) / 10.0 + 99,
       TIMESTAMP '2024-01-01' + g * 3 * INTERVAL '1 minute'
FROM generate_series(1, 200000) AS g;
CREATE INDEX orders_created_at_idx ON orders (created_at);
```

```sql query
SELECT id, total
FROM orders
WHERE created_at::date = DATE '2024-03-08';
```

```sql solution
SELECT id, total
FROM orders
WHERE created_at >= DATE '2024-03-08'
  AND created_at < DATE '2024-03-09';
```

## task w5-partial-index-choice
```json
{
  "type": "choice",
  "title": "Индекс для очереди",
  "xp": 10,
  "options": [
    "`CREATE INDEX ON orders USING hash (status);`",
    "`CREATE INDEX ON orders (created_at) WHERE status = 'new';`",
    "`CREATE INDEX ON orders USING gin (status);`",
    "`CREATE INDEX ON orders (created_at, status);`"
  ],
  "answer": [1],
  "explanation": "Частичный индекс хранит только около двух тысяч новых заказов и уже отсортирован по `created_at`: запрос берёт первые 20 записей индекса и останавливается. Hash находит строки по равенству, но не умеет отдавать их по порядку и хранит все 5 млн строк. GIN для обычного текстового столбца не создать: у него нет класса операторов для `text`, он нужен для `jsonb`, массивов и полнотекстового поиска. В индексе `(created_at, status)` статус стоит вторым: база пойдёт по датам и будет отбрасывать миллионы старых заказов, а сам индекс займёт место под все строки.",
  "hints": [
    "См. разделы «Частичный индекс», «Hash-индекс» и «GIN-индекс», а для последнего варианта — «Составной индекс» из прошлого урока.",
    "Запросу нужны две вещи: только новые заказы и порядок по дате. Какой индекс даёт обе и при этом мал?"
  ]
}
```
В таблице `orders (id, status, created_at, …)` 5 млн строк, статус `new` — примерно у двух тысяч. Очередь менеджеров выполняет запрос ниже, других запросов по статусу нет. Какой индекс подойдёт лучше всего? Имя индекса в вариантах опущено — PostgreSQL придумает его сам.

```sql
SELECT id, created_at FROM orders
WHERE status = 'new'
ORDER BY created_at
LIMIT 20;
```

## task w5-explain-analyze-read
```json
{
  "type": "choice",
  "title": "Читаем EXPLAIN ANALYZE",
  "xp": 10,
  "options": [
    "Запрос вернул 1000 строк",
    "Запрос выполнялся 5240 миллисекунд",
    "База прочитала всю таблицу ради одной строки: условию не хватает подходящего индекса",
    "Индекс по `email` использован, но статистика устарела"
  ],
  "answer": [2],
  "explanation": "`Seq Scan` и `Rows Removed by Filter: 199999` говорят, что база проверила все 200 000 строк и оставила одну. Индекс по `email` не подошёл: условие сравнивает `lower(email)`, поэтому нужен индекс по выражению. `rows=1000` в первой скобке — оценка планировщика, а реально получена одна строка (`actual … rows=1`). `cost=0.00..5240.00` — условные единицы, а не миллисекунды: время выполнения — 61 мс.",
  "hints": [
    "См. раздел «EXPLAIN ANALYZE: план и факт».",
    "Первая скобка — оценка планировщика, вторая — то, что произошло на самом деле. Сколько строк прочитано и отброшено?"
  ]
}
```
Таблица `customers (id, full_name, email, city)`, 200 000 строк. Что показывает этот план?

```text
Seq Scan on customers  (cost=0.00..5240.00 rows=1000 width=40) (actual time=0.052..61.310 rows=1 loops=1)
  Filter: (lower(email) = 'client4242@polka.ru'::text)
  Rows Removed by Filter: 199999
Planning Time: 0.120 ms
Execution Time: 61.402 ms
```
