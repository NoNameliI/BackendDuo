-- Интернет-магазин «Полка»: книги и канцелярия. Общий набор данных для заданий.
CREATE TABLE categories (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  parent_id int REFERENCES categories (id)
);
INSERT INTO categories (name, parent_id) VALUES
  ('Книги', NULL),
  ('Канцелярия', NULL),
  ('Художественная литература', 1),
  ('Нон-фикшн', 1),
  ('Тетради и блокноты', 2),
  ('Ручки и карандаши', 2);

CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  category_id int NOT NULL REFERENCES categories (id),
  price numeric(10, 2) NOT NULL CHECK (price > 0),
  stock int NOT NULL DEFAULT 0 CHECK (stock >= 0)
);
INSERT INTO products (name, category_id, price, stock) VALUES
  ('Мастер и Маргарита', 3, 590.00, 12),
  ('Преступление и наказание', 3, 450.00, 0),
  ('Атлант расправил плечи', 3, 1290.00, 4),
  ('Sapiens', 4, 890.00, 7),
  ('Думай медленно, решай быстро', 4, 760.00, 3),
  ('Чистый код', 4, 1450.00, 9),
  ('Блокнот A5', 5, 249.90, 40),
  ('Тетрадь 48 листов', 5, 95.00, 120),
  ('Ежедневник', 5, 690.00, 15),
  ('Ручка гелевая', 6, 89.00, 200),
  ('Карандаш', 6, 35.00, 300),
  ('Набор маркеров', 6, 420.00, 0);

CREATE TABLE customers (
  id serial PRIMARY KEY,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  city text,
  registered_on date NOT NULL
);
INSERT INTO customers (full_name, email, city, registered_on) VALUES
  ('Анна Смирнова', 'anna@polka.ru', 'Казань', '2023-02-14'),
  ('Борис Петров', 'boris@polka.ru', 'Москва', '2023-03-01'),
  ('Вера Ким', 'vera@polka.ru', 'Казань', '2023-05-20'),
  ('Глеб Орлов', 'gleb@polka.ru', 'Самара', '2023-07-07'),
  ('Дарья Лебедева', 'darya@polka.ru', 'Москва', '2023-09-11'),
  ('Егор Новиков', 'egor@polka.ru', NULL, '2024-01-09'),
  ('Жанна Волкова', 'zhanna@polka.ru', 'Екатеринбург', '2024-02-02'),
  ('Захар Морозов', 'zakhar@polka.ru', 'Самара', '2024-03-18');

CREATE TABLE orders (
  id serial PRIMARY KEY,
  customer_id int NOT NULL REFERENCES customers (id),
  status text NOT NULL CHECK (status IN ('new', 'paid', 'shipped', 'cancelled')),
  created_at timestamp NOT NULL
);
INSERT INTO orders (customer_id, status, created_at) VALUES
  (1, 'shipped', '2024-01-15 10:20'),
  (2, 'shipped', '2024-01-20 18:05'),
  (1, 'paid', '2024-02-03 09:40'),
  (3, 'cancelled', '2024-02-10 14:15'),
  (4, 'shipped', '2024-02-21 11:00'),
  (2, 'paid', '2024-03-02 20:30'),
  (5, 'new', '2024-03-05 08:50'),
  (3, 'shipped', '2024-03-12 16:45'),
  (6, 'paid', '2024-03-15 13:10'),
  (1, 'new', '2024-03-20 19:25'),
  (7, 'shipped', '2024-03-22 12:00'),
  (5, 'paid', '2024-03-28 17:35');

CREATE TABLE order_items (
  order_id int NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id int NOT NULL REFERENCES products (id),
  quantity int NOT NULL CHECK (quantity > 0),
  price numeric(10, 2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);
INSERT INTO order_items (order_id, product_id, quantity, price) VALUES
  (1, 1, 1, 590.00), (1, 7, 2, 249.90),
  (2, 6, 1, 1450.00),
  (3, 4, 1, 890.00), (3, 10, 5, 89.00),
  (4, 3, 1, 1290.00),
  (5, 8, 10, 95.00), (5, 11, 10, 35.00),
  (6, 5, 1, 760.00), (6, 9, 1, 690.00),
  (7, 2, 1, 450.00),
  (8, 1, 1, 590.00), (8, 4, 1, 890.00), (8, 7, 1, 249.90),
  (9, 12, 2, 420.00),
  (10, 6, 1, 1450.00), (10, 10, 3, 89.00),
  (11, 9, 2, 690.00),
  (12, 3, 1, 1290.00), (12, 8, 4, 95.00);
