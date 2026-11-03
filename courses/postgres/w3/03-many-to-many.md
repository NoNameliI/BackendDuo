# Многие ко многим

Связь между таблицами задаёт внешний ключ, а её вид — ограничения на нём.

- **Один-ко-многим** — обычный внешний ключ. `orders.customer_id` повторяется: у клиента много заказов.
- **Один-к-одному** — внешний ключ с `UNIQUE` (или внешний ключ, который сам служит первичным ключом). Так в отдельную таблицу выносят редкие или чувствительные данные. Например, служба доставки хранит паспорта курьеров отдельно от графика смен, и у курьера не больше одного паспорта.
- **Многие-ко-многим** — в заказе много товаров, и товар входит во многие заказы. Одним внешним ключом это не выразить. Нужна **таблица-связка**: каждая её строка — одна пара «заказ — товар».

В «Полке» связка уже есть — `order_items`. Её первичный ключ **составной**: каждый столбец по отдельности повторяется, а пара — нет. Поэтому один товар не попадёт в заказ двумя строками. Кроме ссылок связка хранит атрибуты самой пары: количество и цену покупки.

```sql
CREATE TABLE order_items (
  order_id   int NOT NULL REFERENCES orders (id),
  product_id int NOT NULL REFERENCES products (id),
  quantity   int NOT NULL CHECK (quantity > 0),
  price      numeric(10, 2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
```

Собственный `id` связке обычно не нужен: строку однозначно определяет пара ссылок.

Запрос «через связку» — два соединения: от одной стороны к связке и от связки к другой стороне. Чтобы найти, какие товары купил клиент, идут `orders` → `order_items` → `products`. Чтобы посчитать что-то и для «пустых» строк, к связке подключаются через `LEFT JOIN`.

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
  "hints": ["Какое ограничение запрещает повтор значения в столбце?"]
}
```
Служба доставки заводит таблицу `courier_passports` с паспортными данными курьеров. У курьера в системе может быть не больше одного паспорта. Какое объявление столбца-ссылки на `couriers` это гарантирует?

## task w3-erd-product-tags
```json
{
  "type": "schema",
  "ui": "erd",
  "title": "Теги товаров",
  "xp": 25,
  "check": { "tables": ["tags", "product_tags"] },
  "hints": [
    "В `product_tags` удалите столбец `id`, который конструктор добавляет сам, и отметьте PK у обоих столбцов-ссылок — так получится составной ключ.",
    "Для ссылки нажмите FK у `product_tags.product_id` и выберите `products.id`, затем так же свяжите `tag_id` с `tags.id`. Отметьте NN у обоих столбцов."
  ]
}
```
Маркетологи хотят помечать товары тегами: «подарок», «бестселлер», «для офиса». У товара может быть много тегов, а один тег стоит у многих товаров. Таблица `products` уже есть. Соберите в конструкторе:

- `tags`: `id` — первичный ключ; `name` — текст, обязательный и уникальный;
- `product_tags`: `product_id` — обязательная ссылка на `products.id`; `tag_id` — обязательная ссылка на `tags.id`. Первичный ключ составной — пара (`product_id`, `tag_id`). Своего столбца `id` у связки нет.

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

## task w3-gift-products
```json
{
  "type": "result",
  "title": "Подарочная витрина",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Идите от товара к тегу через связку: `products` → `product_tags` → `tags`, а название тега проверьте в `WHERE`.",
    "`FROM products AS p JOIN product_tags AS pt ON pt.product_id = p.id JOIN tags AS t ON t.id = pt.tag_id WHERE t.name = 'подарок'`"
  ]
}
```
К данным «Полки» добавлены теги: `tags (id, name)` и связка `product_tags (product_id, tag_id)`. Соберите подарочную витрину: выведите `name` и `price` товаров с тегом «подарок» (`tags.name = 'подарок'`), от дорогих к дешёвым.

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
    "Таблицу `products` можно не подключать: число товаров видно по строкам связки. Нужен `LEFT JOIN` от `tags` к `product_tags`.",
    "`SELECT t.name AS tag, COUNT(pt.product_id) AS products_count FROM tags AS t LEFT JOIN product_tags AS pt ON pt.tag_id = t.id GROUP BY …`"
  ]
}
```
Маркетологи решают, какие теги убрать. Для каждого тега выведите `tag` (название тега) и `products_count` (сколько товаров им помечено). Теги без товаров тоже выведите, с нулём. Отсортируйте по убыванию `products_count`.

Таблицы те же: `tags (id, name)` и `product_tags (product_id, tag_id)`.

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
    "Условие `t.name = 'подарок' AND t.name = 'для офиса'` не сработает: в строке связки только один тег. Отберите строки с любым из двух тегов и сгруппируйте по товару.",
    "`WHERE t.name IN ('подарок', 'для офиса') GROUP BY p.id, p.name HAVING COUNT(*) = 2`"
  ]
}
```
Для корпоративных клиентов нужны товары, у которых есть сразу оба тега: «подарок» и «для офиса». Выведите `name` таких товаров по алфавиту.

Таблицы те же: `tags (id, name)` и `product_tags (product_id, tag_id)`.

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
