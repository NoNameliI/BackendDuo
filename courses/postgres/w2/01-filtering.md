# Фильтрация: сложные условия

Менеджер «Полки» готовит распродажу. Ему нужны подборки: «подарки от 450 до 890 ₽ в наличии», «товары с „ка“ в названии», «клиенты без города». Каждая подборка — это `WHERE` из нескольких условий.

- `AND` выполняется раньше `OR`, как умножение раньше сложения. Если смешиваете их, ставьте скобки: `(a OR b) AND c`.
- `IN (…)` — значение из списка. `BETWEEN x AND y` — диапазон, обе границы включены.
- `LIKE` ищет по шаблону: `%` — любое число символов, `_` — ровно один. `ILIKE` делает то же без учёта регистра.
- `NULL` значит «неизвестно». Любое сравнение с ним, даже `city = NULL`, даёт `NULL`, а не `true`, и строка отбрасывается. Пустоту проверяют через `IS NULL` и `IS NOT NULL`.

```sql
SELECT full_name, email
FROM customers
WHERE (city = 'Казань' OR city IS NULL)
  AND email LIKE '%@polka.ru';
```

`ORDER BY` принимает несколько столбцов: при равенстве первого сравнивается второй. Направление `ASC` или `DESC` задаётся для каждого столбца отдельно. `LIMIT n` оставляет n строк, `OFFSET m` пропускает m первых — так устроен постраничный вывод. Без `ORDER BY` порядок строк не гарантирован, и одна строка может попасть на две страницы.

```sql
-- третья страница заказов по 10 штук: сначала новые
SELECT id, status, created_at
FROM orders
ORDER BY created_at DESC, id
LIMIT 10 OFFSET 20;
```

## task w2-filter-stock-check
```json
{
  "type": "result",
  "title": "Ревизия дешёвых товаров",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Условие из двух частей: остаток — одно из двух, цена — обязательно. Без скобок `AND` выполнится раньше `OR`.",
    "`WHERE (stock < 5 OR stock > 100) AND price < 500`, затем `ORDER BY stock, name`."
  ]
}
```
Склад пересматривает ассортимент дешевле 500 ₽. Нужны товары, которых почти не осталось (меньше 5 штук) или которые залежались (больше 100 штук).

Таблица `products (id, name, category_id, price, stock)`. Выведите `name`, `stock` и `price` товаров дешевле 500 ₽ с остатком меньше 5 или больше 100. Отсортируйте по `stock` по возрастанию, при равном остатке — по `name`.

```sql solution
SELECT name, stock, price
FROM products
WHERE (stock < 5 OR stock > 100)
  AND price < 500
ORDER BY stock, name;
```

## task w2-filter-gift-picks
```json
{
  "type": "result",
  "title": "Подарочная подборка",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Список значений проверяет `IN (…)`, диапазон с границами — `BETWEEN`.",
    "`WHERE category_id IN (3, 4, 5) AND stock > 0 AND price BETWEEN 450 AND 890`"
  ]
}
```
Маркетолог собирает подарочную подборку. В неё попадают товары из категорий с `id` 3, 4 и 5, которые есть на складе (`stock > 0`) и стоят от 450 до 890 ₽ включительно.

Таблица `products (id, name, category_id, price, stock)`. Выведите `name` и `price`, от дорогих товаров к дешёвым.

```sql solution
SELECT name, price
FROM products
WHERE category_id IN (3, 4, 5)
  AND stock > 0
  AND price BETWEEN 450 AND 890
ORDER BY price DESC;
```

## task w2-filter-search
```json
{
  "type": "result",
  "title": "Поиск по каталогу",
  "xp": 10,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "`LIKE` различает регистр: «Ка» и «ка» для него разные строки.",
    "`WHERE name ILIKE '%ка%'` — `%` с обеих сторон означает «что угодно до и после»."
  ]
}
```
Покупатель ввёл в поиск «ка». Поиск должен находить товары, в названии которых это сочетание встречается в любом месте и в любом регистре: и «Карандаш», и «Ручка гелевая».

Таблица `products (id, name, category_id, price, stock)`. Выведите `id` и `name` найденных товаров по возрастанию `id`.

```sql solution
SELECT id, name
FROM products
WHERE name ILIKE '%ка%'
ORDER BY id;
```

## task w2-filter-null-review
```json
{
  "type": "review",
  "title": "Клиенты без города",
  "xp": 10,
  "options": [
    "В условии `city = NULL`: сравнение с `NULL` никогда не даёт `true`",
    "`NULL` нужно взять в кавычки: `city = 'NULL'`",
    "Пустой город надо искать как пустую строку: `city = ''`",
    "Без `ORDER BY` PostgreSQL может не вернуть ни одной строки"
  ],
  "answer": [0],
  "lines": [3],
  "explanation": "`NULL` — «значение неизвестно», и сравнение с ним через `=`, `<>` или `>` тоже даёт `NULL`. `WHERE` пропускает только строки, где условие равно `true`, поэтому не проходит ни одна. Правильно: `WHERE city IS NULL`. `'NULL'` в кавычках — обычная строка из четырёх букв. Пустая строка `''` — известное значение, а не его отсутствие. `ORDER BY` меняет только порядок строк, а не их количество.",
  "hints": ["Чему равно выражение `NULL = NULL`: `true`, `false` или чему-то третьему?"]
}
```
Аналитик ищет клиентов, которые не указали город, чтобы попросить их заполнить профиль. Такие клиенты в базе есть, но запрос вернул пустой результат. В чём ошибка?

```sql code
SELECT full_name, email
FROM customers
WHERE city = NULL;
```

## task w2-filter-delivery
```json
{
  "type": "result",
  "title": "Платная доставка",
  "xp": 15,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Для клиента без города `city <> 'Москва'` даёт не `true`, а `NULL`, и строка отбрасывается.",
    "`WHERE city <> 'Москва' OR city IS NULL`"
  ]
}
```
Со следующего месяца бесплатная доставка остаётся только в Москве. Остальных клиентов нужно предупредить письмом, в том числе тех, кто не указал город.

Таблица `customers (id, full_name, email, city, registered_on)`. Выведите `full_name` и `email` всех клиентов не из Москвы, включая клиентов без города. Отсортируйте по `full_name`.

```sql solution
SELECT full_name, email
FROM customers
WHERE city <> 'Москва' OR city IS NULL
ORDER BY full_name;
```

## task w2-filter-catalog-page
```json
{
  "type": "result",
  "title": "Вторая страница каталога",
  "xp": 20,
  "dataset": "shop",
  "check": { "ordered": true },
  "hints": [
    "Направление сортировки задаётся для каждого столбца отдельно: `ORDER BY category_id, price DESC`.",
    "Вторая страница по 5 строк — пропустить первые 5: `LIMIT 5 OFFSET 5`."
  ]
}
```
На сайте товары показываются по 5 на странице. Каталог отсортирован по `category_id` по возрастанию, а внутри категории — от дорогих товаров к дешёвым.

Таблица `products (id, name, category_id, price, stock)`. Выведите вторую страницу каталога: `name`, `category_id` и `price`.

```sql solution
SELECT name, category_id, price
FROM products
ORDER BY category_id, price DESC
LIMIT 5 OFFSET 5;
```
