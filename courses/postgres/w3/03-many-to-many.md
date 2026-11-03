# Многие ко многим

Маркетологи «Полки» хотят помечать товары тегами: «подарок», «бестселлер», «для офиса». У товара может быть много тегов, а один тег стоит у многих товаров. Одним внешним ключом такую связь не описать. Нужна отдельная таблица пар — таблица-связка. В этом уроке разберём, как её устроить, как писать запросы через неё и как собрать её в конструкторе схемы.

### Три вида связей

Связь между таблицами задаёт внешний ключ (`REFERENCES`), а её вид — ограничения на нём.

- **Один-ко-многим** — обычный внешний ключ. `orders.customer_id` может повторяться: у клиента много заказов, у заказа один клиент.
- **Один-к-одному** — внешний ключ, который не может повторяться: к нему добавляют `UNIQUE` (или делают его первичным ключом таблицы). Так в отдельную таблицу выносят редкие или чувствительные данные: карту лояльности клиента, паспорт сотрудника.
- **Многие-ко-многим** — нужна таблица-связка, где каждая строка — одна пара. О ней следующий раздел.

Шаблон столбца для связи один-к-одному:

```sql
столбец_ссылка int NOT NULL UNIQUE REFERENCES другая_таблица (id)
```

- `REFERENCES другая_таблица (id)` — значение должно существовать в другой таблице.
- `UNIQUE` — одно и то же значение не может встретиться в столбце дважды. Это и делает связь «к одному». Обычный индекс (о них — в пятом мире) только ускоряет поиск и повторов не запрещает: запрет даёт именно `UNIQUE`.
- `NOT NULL` — ссылка обязательна.
- Ограничения пишутся через пробел после типа, порядок между ними не важен.

Пример: у клиента может быть не больше одной карты лояльности.

```sql example
CREATE TABLE demo_loyalty_cards (
  id serial PRIMARY KEY,
  customer_id int NOT NULL UNIQUE REFERENCES customers (id),
  card_number text NOT NULL
);
INSERT INTO demo_loyalty_cards (customer_id, card_number) VALUES
  (1, 'P-0001'), (2, 'P-0002');
```

Попробуем выдать первому клиенту вторую карту. `ON CONFLICT DO NOTHING` из первого мира велит пропустить строку, если она нарушает уникальность, а `RETURNING` покажет, что добавилось:

```sql example
INSERT INTO demo_loyalty_cards (customer_id, card_number)
VALUES (1, 'P-0003')
ON CONFLICT DO NOTHING
RETURNING id, customer_id, card_number;
```

Результат пустой: строка не добавлена. Без `ON CONFLICT DO NOTHING` PostgreSQL ответил бы ошибкой `duplicate key value violates unique constraint`. Если убрать `UNIQUE`, вторая карта добавится, и связь станет один-ко-многим.

### Таблица-связка

**Таблица-связка** хранит пары «строка одной таблицы — строка другой». У неё два внешних ключа, по одному на каждую сторону. В «Полке» такая таблица уже есть — `order_items`: каждая её строка — пара «заказ — товар». В заказе много товаров, и товар входит во многие заказы.

```sql
CREATE TABLE связка (
  первая_id int NOT NULL REFERENCES первая_таблица (id),
  вторая_id int NOT NULL REFERENCES вторая_таблица (id),
  атрибут_пары тип,
  PRIMARY KEY (первая_id, вторая_id)
);
```

- `первая_id`, `вторая_id` — ссылки на обе стороны связи. Тип — `int`, как у `serial`-ключа, на который они ссылаются.
- `атрибут_пары` — необязательные данные о самой паре. В `order_items` это количество и цена покупки: они относятся не к заказу и не к товару, а к их паре.
- `PRIMARY KEY (первая_id, вторая_id)` — составной первичный ключ (подробнее в следующем разделе). Пишется отдельной строкой после столбцов, через запятую.
- Собственный столбец `id` связке не нужен: строку однозначно определяет пара ссылок.

Пример: товары закупаются у поставщиков. Один поставщик возит много товаров, а один товар можно купить у нескольких поставщиков. Создадим учебные таблицы:

```sql example
CREATE TABLE demo_suppliers (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);
CREATE TABLE demo_supplies (
  supplier_id int NOT NULL REFERENCES demo_suppliers (id),
  product_id int NOT NULL REFERENCES products (id),
  purchase_price numeric(10, 2) NOT NULL,
  PRIMARY KEY (supplier_id, product_id)
);
INSERT INTO demo_suppliers (name) VALUES
  ('Книжный двор'), ('Бумажный мир'), ('Офис-Опт'), ('Канцторг');
INSERT INTO demo_supplies (supplier_id, product_id, purchase_price) VALUES
  (1, 1, 400.00), (1, 4, 600.00), (1, 6, 1000.00),
  (2, 7, 150.00), (2, 8, 50.00),
  (3, 7, 140.00), (3, 10, 50.00), (3, 11, 20.00);
```

Как это выглядит на нескольких строках. Таблица `products`:

| id | name |
|---|---|
| 1 | Мастер и Маргарита |
| 7 | Блокнот A5 |
| 10 | Ручка гелевая |

Таблица `demo_suppliers`:

| id | name |
|---|---|
| 1 | Книжный двор |
| 2 | Бумажный мир |
| 3 | Офис-Опт |

Связка `demo_supplies` (часть строк):

| supplier_id | product_id | purchase_price |
|---|---|---|
| 1 | 1 | 400.00 |
| 2 | 7 | 150.00 |
| 3 | 7 | 140.00 |
| 3 | 10 | 50.00 |

Соединение трёх таблиц через связку:

| product | supplier | purchase_price |
|---|---|---|
| Мастер и Маргарита | Книжный двор | 400.00 |
| Блокнот A5 | Бумажный мир | 150.00 |
| Блокнот A5 | Офис-Опт | 140.00 |
| Ручка гелевая | Офис-Опт | 50.00 |

У блокнота два поставщика, у «Офис-Опт» два товара — это и есть многие-ко-многим.

### Составной первичный ключ

Первичный ключ может состоять из нескольких столбцов. Тогда уникальным должно быть их сочетание, а каждый столбец по отдельности может повторяться.

```sql
PRIMARY KEY (столбец1, столбец2)
```

- Записывается отдельной строкой внутри `CREATE TABLE`, после всех столбцов. Столбцы перечисляются в скобках через запятую.
- Столбцы ключа автоматически получают `NOT NULL`.
- Рядом с отдельным столбцом `PRIMARY KEY` можно написать только тогда, когда ключ из одного столбца. Если написать `PRIMARY KEY` у двух столбцов по отдельности, PostgreSQL ответит ошибкой: у таблицы может быть только один первичный ключ.
- В связке составной ключ запрещает повтор пары: один товар не попадёт к одному поставщику двумя строками. В `order_items` ключ `(order_id, product_id)` не даёт добавить товар в заказ второй строкой — меняют количество.

Попробуем добавить уже существующую пару «Бумажный мир — Блокнот A5»:

```sql example
INSERT INTO demo_supplies (supplier_id, product_id, purchase_price)
VALUES (2, 7, 145.00)
ON CONFLICT DO NOTHING
RETURNING supplier_id, product_id;
```

Результат пустой: такая пара уже есть, и строка не добавлена. При этом поставщик 2 и товар 7 по отдельности встречаются в связке и в других парах.

### Запрос через связку

Чтобы пройти от одной стороны к другой, пишут два `JOIN`: от первой таблицы к связке и от связки ко второй таблице.

```sql
SELECT а.столбец, б.столбец
FROM первая_таблица AS а
JOIN связка AS св ON св.первая_id = а.id
JOIN вторая_таблица AS б ON б.id = св.вторая_id
WHERE условие
ORDER BY столбец;
```

- Первый `JOIN` находит все пары, в которых участвует строка первой таблицы.
- Второй `JOIN` по каждой паре достаёт строку второй таблицы.
- Условие можно ставить на любую из трёх таблиц: на название с одной стороны, на атрибут пары, на название с другой стороны.

Пример: у кого закупают блокнот A5, сначала дешевле.

```sql example
SELECT s.name AS supplier, ds.purchase_price
FROM products AS p
JOIN demo_supplies AS ds ON ds.product_id = p.id
JOIN demo_suppliers AS s ON s.id = ds.supplier_id
WHERE p.name = 'Блокнот A5'
ORDER BY ds.purchase_price;
```

| supplier | purchase_price |
|---|---|
| Офис-Опт | 140.00 |
| Бумажный мир | 150.00 |

### Подсчёт через связку

Сколько пар у каждой строки одной стороны — это число строк связки с её `id`. Вторую сторону для этого подключать не нужно.

```sql
SELECT а.столбец, COUNT(св.вторая_id) AS имя
FROM первая_таблица AS а
LEFT JOIN связка AS св ON св.первая_id = а.id
GROUP BY а.id, а.столбец
ORDER BY имя DESC;
```

- `LEFT JOIN` сохраняет строки без пар. Им `COUNT` по столбцу связки даст 0 (как в уроке про внешние соединения).
- Считайте столбец связки, а не `*`: `COUNT(*)` даст строке без пар 1.

Пример: сколько товаров возит каждый поставщик, включая тех, у кого поставок пока нет.

```sql example
SELECT s.name AS supplier, COUNT(ds.product_id) AS products_count
FROM demo_suppliers AS s
LEFT JOIN demo_supplies AS ds ON ds.supplier_id = s.id
GROUP BY s.id, s.name
ORDER BY products_count DESC, s.name;
```

| supplier | products_count |
|---|---|
| Книжный двор | 3 |
| Офис-Опт | 3 |
| Бумажный мир | 2 |
| Канцторг | 0 |

### Два условия сразу: HAVING COUNT

Как найти заказы, где есть и «Мастер и Маргарита», и «Блокнот A5»? Условие `p.name = 'Мастер и Маргарита' AND p.name = 'Блокнот A5'` не сработает: в одной строке связки один товар, и его название не может быть равно двум значениям сразу. Работает другой приём:

```sql
SELECT св.первая_id
FROM связка AS св
JOIN вторая_таблица AS б ON б.id = св.вторая_id
WHERE б.столбец IN ('значение1', 'значение2')
GROUP BY св.первая_id
HAVING COUNT(*) = 2;
```

- `WHERE … IN (…)` оставляет строки связки с любым из нужных значений.
- `GROUP BY` собирает их по первой стороне — например, по заказу.
- `HAVING COUNT(*) = 2` оставляет группы, где нашлись оба значения. Число в условии равно числу значений в списке `IN`.
- Приём надёжен благодаря составному ключу: пара не повторяется, поэтому одно значение не может дать группе две строки.

Строки до группировки — позиции с любым из двух товаров:

| order_id | name |
|---|---|
| 1 | Блокнот A5 |
| 1 | Мастер и Маргарита |
| 8 | Блокнот A5 |
| 8 | Мастер и Маргарита |

В заказах 1 и 8 нашлось по две строки — в них есть оба товара:

```sql example
SELECT oi.order_id
FROM order_items AS oi
JOIN products AS p ON p.id = oi.product_id
WHERE p.name IN ('Мастер и Маргарита', 'Блокнот A5')
GROUP BY oi.order_id
HAVING COUNT(*) = 2
ORDER BY oi.order_id;
```

| order_id |
|---|
| 1 |
| 8 |

Если нужны названия, а не номера, подключите таблицу с названиями и сгруппируйте по её `id` и названию: `GROUP BY p.id, p.name`.

### Связка в конструкторе схемы

В заданиях с конструктором таблицы собирают мышью, а `CREATE TABLE` пишется сам — его видно в панели «Сгенерированный SQL». Таблицы, которые уже есть в базе, помечены «уже в базе»: менять их нельзя, а ссылаться на них можно.

- **«+ Таблица»** добавляет карточку `table_N` со столбцом `id` типа `serial`, уже отмеченным как первичный ключ. Имя таблицы меняется прямо в заголовке карточки. Имена — латиница в нижнем регистре, цифры и `_`.
- **«+ колонка»** внизу карточки добавляет столбец `column_N` типа `text`. Имя правится в строке, тип выбирается в списке рядом.
- Переключатели в строке столбца: **PK** — первичный ключ, **NN** — `NOT NULL`, **U** — `UNIQUE`. Включённый переключатель подсвечен. **×** удаляет столбец.
- **Внешний ключ:** нажмите **FK** у столбца-ссылки, затем щёлкните в другой таблице подсвеченный столбец с пометкой «— выбрать» (это столбцы с PK или U). Тип ссылки сам станет `integer`. `Esc` отменяет выбор, повторное нажатие FK убирает связь.
- **Составной первичный ключ:** включите PK у двух столбцов. Конструктор допишет строку `PRIMARY KEY (столбец1, столбец2)`. Столбец `id`, который появился вместе с таблицей, связке не нужен — удалите его кнопкой ×.
- **«Проверить»** (`Ctrl+Shift+Enter`) сравнивает схему с заданием. Ошибки схемы (нет первичного ключа, повтор имени) показываются внизу холста.

Порядок для связки: создайте таблицу, переименуйте её, удалите `id`, добавьте два столбца-ссылки, свяжите каждый через FK со своей таблицей и включите у обоих PK.

### Частые ошибки

- `supplier_id int PRIMARY KEY, product_id int PRIMARY KEY` → ошибка: у таблицы только один первичный ключ. Правильно: отдельная строка `PRIMARY KEY (supplier_id, product_id)`.
- Связка с собственным `id serial PRIMARY KEY` и без ограничения на пару → одну и ту же пару можно добавить дважды, и подсчёты удвоятся. Ключом связки должна быть пара ссылок.
- `WHERE t.name = 'a' AND t.name = 'b'` → пустой результат: в одной строке одно значение. Правильно: `WHERE t.name IN ('a', 'b') … GROUP BY … HAVING COUNT(*) = 2`.
- Ссылка без `UNIQUE` там, где нужно «не больше одного» → получится один-ко-многим. Для один-к-одному: `NOT NULL UNIQUE REFERENCES …`.

### Шпаргалка

```sql
ссылка int NOT NULL UNIQUE REFERENCES т (id)          -- один-к-одному
CREATE TABLE связка (
  а_id int NOT NULL REFERENCES а (id),
  б_id int NOT NULL REFERENCES б (id),
  PRIMARY KEY (а_id, б_id)                             -- составной ключ
);
FROM а JOIN связка AS св ON св.а_id = а.id
       JOIN б ON б.id = св.б_id                        -- через связку
SELECT а.name, COUNT(св.б_id) FROM а
  LEFT JOIN связка AS св ON св.а_id = а.id
  GROUP BY а.id, а.name                                -- число пар, 0 без пар
WHERE б.name IN ('x', 'y') GROUP BY … HAVING COUNT(*) = 2   -- оба значения
```

## task w3-one-to-one
```json
{
  "type": "choice",
  "title": "Один паспорт на курьера",
  "xp": 5,
  "options": [
    "`courier_id int REFERENCES couriers (id)`",
    "`courier_id int NOT NULL UNIQUE REFERENCES couriers (id)`",
    "`courier_id int NOT NULL` без внешнего ключа, но с обычным индексом",
    "Таблица-связка `courier_passport_links (courier_id, passport_id)` с составным первичным ключом"
  ],
  "answer": [1],
  "explanation": "`UNIQUE` запрещает второй паспорт того же курьера, а `REFERENCES` — паспорт несуществующего курьера: это и есть один-к-одному. Без `UNIQUE` получится один-ко-многим. Без внешнего ключа база не проверит, что курьер существует, а обычный индекс повторов не запрещает. Связка с составным ключом допускает много паспортов у курьера — это многие-ко-многим.",
  "hints": ["См. раздел «Три вида связей»: какое ограничение запрещает повтор значения в столбце?"]
}
```
Служба доставки заводит таблицу `courier_passports` с паспортными данными курьеров. Курьеры хранятся в таблице `couriers (id, …)`. У курьера в системе может быть не больше одного паспорта. Какое объявление столбца-ссылки на `couriers` это гарантирует?

## task w3-gift-products
```json
{
  "type": "result",
  "title": "Подарочная витрина",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «Запрос через связку»: идите от товара к тегу через связку `products` → `product_tags` → `tags`, а название тега проверьте в `WHERE`.",
    "`SELECT p.name, p.price FROM products AS p JOIN product_tags AS pt ON pt.product_id = … JOIN tags AS t ON t.id = … WHERE t.name = '…' ORDER BY … DESC;`"
  ]
}
```
К данным «Полки» добавлены теги. Таблицы:

- `products (id, name, category_id, price, stock)` — товары;
- `tags (id, name)` — теги;
- `product_tags (product_id, tag_id)` — связка: `product_id` ссылается на `products.id`, `tag_id` — на `tags.id`.

Соберите подарочную витрину: выведите два столбца, `name` и `price`, товаров с тегом «подарок» (`tags.name = 'подарок'`). Отсортируйте по убыванию цены.

```sql setup
CREATE TABLE tags (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);
CREATE TABLE product_tags (
  product_id int NOT NULL REFERENCES products (id),
  tag_id int NOT NULL REFERENCES tags (id),
  PRIMARY KEY (product_id, tag_id)
);
INSERT INTO tags (name) VALUES ('бестселлер'), ('подарок'), ('для офиса'), ('новинка');
INSERT INTO product_tags (product_id, tag_id) VALUES
  (1, 1), (1, 2), (3, 1), (4, 1), (4, 2), (6, 1),
  (7, 2), (7, 3), (9, 2), (9, 3), (10, 3), (12, 2);
```

```sql solution
SELECT p.name, p.price
FROM products AS p
JOIN product_tags AS pt ON pt.product_id = p.id
JOIN tags AS t ON t.id = pt.tag_id
WHERE t.name = 'подарок'
ORDER BY p.price DESC;
```

## task w3-tag-stats
```json
{
  "type": "result",
  "title": "Популярность тегов",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «Подсчёт через связку»: таблицу `products` подключать не нужно, число товаров видно по строкам связки. Нужен `LEFT JOIN` от `tags` к `product_tags`.",
    "`SELECT t.name AS tag, COUNT(pt.…) AS products_count FROM tags AS t LEFT JOIN product_tags AS pt ON … GROUP BY t.id, … ORDER BY … DESC;`"
  ]
}
```
Маркетологи решают, какие теги убрать. Таблицы:

- `tags (id, name)` — теги;
- `product_tags (product_id, tag_id)` — связка товаров и тегов, `tag_id` ссылается на `tags.id`.

Для каждого тега выведите два столбца: `tag` — название тега и `products_count` — сколько товаров им помечено. Теги без товаров тоже выведите, с нулём. Отсортируйте по убыванию `products_count`.

```sql setup
CREATE TABLE tags (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);
CREATE TABLE product_tags (
  product_id int NOT NULL REFERENCES products (id),
  tag_id int NOT NULL REFERENCES tags (id),
  PRIMARY KEY (product_id, tag_id)
);
INSERT INTO tags (name) VALUES ('бестселлер'), ('подарок'), ('для офиса'), ('новинка');
INSERT INTO product_tags (product_id, tag_id) VALUES
  (1, 1), (1, 2), (3, 1), (4, 1), (4, 2), (6, 1),
  (7, 2), (7, 3), (9, 2), (9, 3), (10, 3), (12, 2);
```

```sql solution
SELECT t.name AS tag, COUNT(pt.product_id) AS products_count
FROM tags AS t
LEFT JOIN product_tags AS pt ON pt.tag_id = t.id
GROUP BY t.id, t.name
ORDER BY products_count DESC;
```

## task w3-office-gifts
```json
{
  "type": "result",
  "title": "Подарок в офис",
  "xp": 20,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "См. раздел «Два условия сразу: HAVING COUNT»: отберите строки с любым из двух тегов, сгруппируйте по товару и оставьте товары, где нашлись оба.",
    "`SELECT p.name FROM products AS p JOIN product_tags AS pt ON … JOIN tags AS t ON … WHERE t.name IN ('…', '…') GROUP BY p.id, p.name HAVING COUNT(*) = … ORDER BY …;`"
  ]
}
```
Для корпоративных клиентов нужны товары, у которых есть сразу оба тега: «подарок» и «для офиса». Таблицы:

- `products (id, name, category_id, price, stock)` — товары;
- `tags (id, name)` — теги;
- `product_tags (product_id, tag_id)` — связка товаров и тегов.

Выведите один столбец `name` — названия таких товаров по алфавиту.

```sql setup
CREATE TABLE tags (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);
CREATE TABLE product_tags (
  product_id int NOT NULL REFERENCES products (id),
  tag_id int NOT NULL REFERENCES tags (id),
  PRIMARY KEY (product_id, tag_id)
);
INSERT INTO tags (name) VALUES ('бестселлер'), ('подарок'), ('для офиса'), ('новинка');
INSERT INTO product_tags (product_id, tag_id) VALUES
  (1, 1), (1, 2), (3, 1), (4, 1), (4, 2), (6, 1),
  (7, 2), (7, 3), (9, 2), (9, 3), (10, 3), (12, 2);
```

```sql solution
SELECT p.name
FROM products AS p
JOIN product_tags AS pt ON pt.product_id = p.id
JOIN tags AS t ON t.id = pt.tag_id
WHERE t.name IN ('подарок', 'для офиса')
GROUP BY p.id, p.name
HAVING COUNT(*) = 2
ORDER BY p.name;
```

## task w3-erd-product-tags
```json
{
  "type": "schema",
  "ui": "erd",
  "title": "Теги товаров",
  "xp": 25,
  "check": { "tables": ["tags", "product_tags"] },
  "hints": [
    "См. раздел «Связка в конструкторе схемы»: в `product_tags` удалите столбец `id`, который появляется вместе с таблицей, и включите PK у обоих столбцов-ссылок — так получится составной ключ.",
    "Для ссылки нажмите FK у `product_tags.product_id` и выберите `products.id`, затем так же свяжите `tag_id` с `tags.id`. У `tags.name` включите NN и U, у обоих столбцов связки — NN."
  ]
}
```
Теперь соберите таблицы тегов сами. Таблица `products (id, name, price)` уже есть в базе. Соберите в конструкторе две таблицы:

- `tags`: `id` — `serial`, первичный ключ; `name` — `text`, обязательный (`NOT NULL`) и уникальный (`UNIQUE`);
- `product_tags`: `product_id` — `integer`, обязательная ссылка на `products.id`; `tag_id` — `integer`, обязательная ссылка на `tags.id`. Первичный ключ составной — пара (`product_id`, `tag_id`). Своего столбца `id` у связки нет.

```sql setup
CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price numeric(10, 2) NOT NULL
);
```

```sql solution
CREATE TABLE tags (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);
CREATE TABLE product_tags (
  product_id integer NOT NULL REFERENCES products (id),
  tag_id integer NOT NULL REFERENCES tags (id),
  PRIMARY KEY (product_id, tag_id)
);
```
