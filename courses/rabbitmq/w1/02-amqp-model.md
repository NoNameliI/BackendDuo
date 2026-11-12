# Модель AMQP: exchange, очередь, привязка

Платёжный сервис магазина публикует событие «оплата прошла». Ему не важно, кто его прочитает: сегодня это почта, завтра ещё и аналитика. Если издатель будет сам выбирать очередь для каждого читателя, он снова станет связан с ними. Поэтому в модели AMQP 0-9-1, которую использует RabbitMQ, издатель отдаёт сообщение не в очередь, а в **exchange**, а раскладывает по очередям уже брокер.

### Участники пути сообщения

- **Соединение** (connection) — подключение клиента к брокеру.
- **Канал** (channel) — «виртуальная линия» внутри соединения: по каналу идут команды и сообщения. Ошибка, например публикация в несуществующий exchange, закрывает канал, а не всё соединение. В консоли лаборатории канал открывается и закрывается за вас на время команды.
- **Vhost** — виртуальный хост, изолированное «пространство имён»: в нём живут свои exchange, очереди и привязки. В этом мире мы работаем только в vhost `/`, который есть сразу.
- **Exchange** — принимает сообщения от издателя и направляет их в очереди. Сам сообщений не хранит.
- **Очередь** (queue) — хранит сообщения в порядке поступления, пока их не заберёт потребитель.
- **Привязка** (binding) — правило «этот exchange отправляет сообщения в эту очередь», с ключом привязки.
- **Ключ маршрутизации** (routing key) — метка, которую издатель ставит на сообщение.

Путь сообщения: издатель → exchange → (привязки сравнивают ключи) → очередь → потребитель.

### Типы exchange

Тип определяет, как exchange выбирает очереди.

- `direct`: сообщение попадает в очереди, у которых ключ привязки в точности равен ключу маршрутизации сообщения.
- `fanout`: ключ игнорируется, копия сообщения уходит во все привязанные очереди.
- `topic` и `headers`: маршрутизация по шаблонам и по заголовкам. Им посвящён следующий мир.

Если ни одна привязка не подошла, сообщение отбрасывается (особые случаи — тоже в следующем мире).

### Объявление exchange

Объявить — значит создать, если нет. Повторное объявление с теми же атрибутами ничего не меняет.

```text
rabbitmqadmin exchanges declare --name ИМЯ --type ТИП --durable true
```

- `rabbitmqadmin` — консольная утилита управления брокером (версии 2).
- `exchanges declare` — группа и действие: объявить exchange.
- `--name ИМЯ` — имя exchange. Имена на `amq.` зарезервированы за брокером.
- `--type ТИП` — `direct`, `fanout`, `topic` или `headers`.
- `--durable true` — exchange переживает перезапуск брокера. Подробнее о надёжности — в мире 3. В заданиях пишите `true`, если условие не требует иного.

Есть и другие флаги, например `--vhost` для выбора vhost; в этом уроке они не нужны.

### Объявление очереди

```text
rabbitmqadmin queues declare --name ИМЯ --type classic --durable true
```

- `queues declare` — объявить очередь.
- `--name ИМЯ` — имя очереди.
- `--type classic` — обычная очередь. Другие виды очередей рассмотрим позже, а `stream` лаборатория не моделирует.
- `--durable true` — очередь переживает перезапуск брокера.

### Привязка

```text
rabbitmqadmin bindings declare --source EXCHANGE --destination-type queue --destination ОЧЕРЕДЬ --routing-key КЛЮЧ
```

- `--source` — имя exchange, который отправляет сообщения.
- `--destination-type queue` — получатель привязки — очередь (может быть и другой exchange, значение `exchange`).
- `--destination` — имя очереди.
- `--routing-key` — ключ привязки. Для `fanout` он не влияет на маршрут, и пишут пустую строку: `--routing-key ""`.

Все четыре флага обязательны. Exchange и очередь должны существовать, иначе будет ошибка `404 NOT_FOUND`.

Пример: службе доставки нужен exchange `delivery`, в который попадают задания курьерам, и очередь `couriers`.

```broker example
rabbitmqadmin exchanges declare --name delivery --type direct --durable true
rabbitmqadmin queues declare --name couriers --type classic --durable true
rabbitmqadmin bindings declare --source delivery --destination-type queue --destination couriers --routing-key assign
```

Результат:

```text
declared exchange 'delivery' in virtual host '/'
declared queue 'couriers' in virtual host '/'
declared a binding from 'delivery' to queue 'couriers' with routing key 'assign' in virtual host '/'
```

### Состояние брокера

Посмотреть, что есть:

```text
rabbitmqadmin exchanges list
rabbitmqadmin queues list
rabbitmqadmin queues list --columns name,messages_ready
rabbitmqadmin bindings list
```

- `list` показывает таблицу. Флаг `--columns` выбирает столбцы через запятую.
- В таблице очередей: `messages_ready` — сколько сообщений готово к выдаче, `messages_unacknowledged` — выдано, но не подтверждено, `consumers` — сколько потребителей подключено.
- Флаг `--non-interactive` убирает рамки таблицы и строку заголовков.

Те же сведения даёт `rabbitmqctl`, утилита самого узла: `rabbitmqctl list_queues`, `rabbitmqctl list_exchanges`, `rabbitmqctl list_bindings`. Столбцы разделены табуляцией.

```broker example
rabbitmqadmin exchanges list
rabbitmqadmin queues list
rabbitmqadmin bindings list
```

```text
┌─────────────┬─────────┬─────────┐
│ name        │ type    │ durable │
├─────────────┼─────────┼─────────┤
│             │ direct  │ true    │
│ amq.direct  │ direct  │ true    │
│ amq.fanout  │ fanout  │ true    │
│ amq.headers │ headers │ true    │
│ amq.topic   │ topic   │ true    │
│ delivery    │ direct  │ true    │
└─────────────┴─────────┴─────────┘
┌──────────┬────────────┬──────────┬────────────────┬─────────────────────────┬───────────┐
│ name     │ queue_type │ messages │ messages_ready │ messages_unacknowledged │ consumers │
├──────────┼────────────┼──────────┼────────────────┼─────────────────────────┼───────────┤
│ couriers │ classic    │ 0        │ 0              │ 0                       │ 0         │
└──────────┴────────────┴──────────┴────────────────┴─────────────────────────┴───────────┘
┌──────────┬─────────────┬──────────────────┬─────────────┐
│ source   │ destination │ destination_type │ routing_key │
├──────────┼─────────────┼──────────────────┼─────────────┤
│ delivery │ couriers    │ queue            │ assign      │
└──────────┴─────────────┴──────────────────┴─────────────┘
```

Безымянная строка в списке exchange — exchange по умолчанию, он есть всегда; о нём — в уроке 1.3. Остальные `amq.…` — встроенные.

### Публикация через exchange

```text
rabbitmqadmin publish message --exchange EXCHANGE --routing-key КЛЮЧ --payload "ТЕКСТ"
```

- `publish message` — опубликовать сообщение.
- `--exchange` (или `-e`) — куда публикуем.
- `--routing-key` (или `-k`) — ключ маршрутизации.
- `--payload` (или `-m`) — тело сообщения. Текст с пробелами берите в кавычки.

Опубликуем два сообщения: одно с ключом, который привязан к очереди, другое с чужим ключом.

```broker example
rabbitmqadmin publish message --exchange delivery --routing-key assign --payload "parcel 41"
rabbitmqadmin publish message -e delivery -k return -m "parcel 42"
rabbitmqadmin queues list --columns name,messages_ready
```

```text
published the message
published the message, but it was not routed to any queue
┌──────────┬────────────────┐
│ name     │ messages_ready │
├──────────┼────────────────┤
│ couriers │ 1              │
└──────────┴────────────────┘
```

Обе публикации прошли без ошибок, но в очереди одно сообщение: второе не нашло привязки с ключом `return` и было отброшено. Консоль предупреждает об этом строкой `not routed to any queue`, а приложение без особых настроек ничего не узнает. Поэтому результат публикации проверяют по очереди.

Теперь `fanout`. Статус посылки нужен и журналу, и экрану диспетчера: у каждого своя очередь.

```broker example
rabbitmqadmin exchanges declare --name parcel-events --type fanout --durable true
rabbitmqadmin queues declare --name events-log --type classic --durable true
rabbitmqadmin queues declare --name events-screen --type classic --durable true
rabbitmqadmin bindings declare --source parcel-events --destination-type queue --destination events-log --routing-key ""
rabbitmqadmin bindings declare --source parcel-events --destination-type queue --destination events-screen --routing-key ""
rabbitmqadmin publish message -e parcel-events -k ignored -m "parcel 43 delivered"
rabbitmqadmin queues list --columns name,messages_ready
```

```text
declared exchange 'parcel-events' in virtual host '/'
declared queue 'events-log' in virtual host '/'
declared queue 'events-screen' in virtual host '/'
declared a binding from 'parcel-events' to queue 'events-log' with routing key '' in virtual host '/'
declared a binding from 'parcel-events' to queue 'events-screen' with routing key '' in virtual host '/'
published the message
┌───────────────┬────────────────┐
│ name          │ messages_ready │
├───────────────┼────────────────┤
│ couriers      │ 1              │
│ events-log    │ 1              │
│ events-screen │ 1              │
└───────────────┴────────────────┘
```

Ключ `ignored` на маршрут не повлиял: копия попала в обе очереди.

### Очистка и удаление

```text
rabbitmqadmin queues purge --name ИМЯ
rabbitmqadmin queues delete --name ИМЯ
rabbitmqadmin exchanges delete --name ИМЯ
```

- `queues purge` удаляет из очереди готовые сообщения, сама очередь остаётся.
- `queues delete` удаляет очередь целиком вместе с сообщениями.
- `exchanges delete` удаляет exchange.

```broker example
rabbitmqadmin queues purge --name events-log
rabbitmqadmin queues delete --name events-screen
rabbitmqadmin queues list --columns name,messages_ready
```

```text
purged queue 'events-log' in virtual host '/' (1 messages removed)
deleted queue 'events-screen' in virtual host '/'
┌────────────┬────────────────┐
│ name       │ messages_ready │
├────────────┼────────────────┤
│ couriers   │ 1              │
│ events-log │ 0              │
└────────────┴────────────────┘
```

### Частые ошибки

- **Ошибка:** повторно объявить очередь или exchange с другими атрибутами (пример ниже). **Верно:** повторять объявление в точности как раньше. Если атрибуты нужно изменить, удалите объект и объявите заново. Так же `406` вызывает попытка объявить уже существующий exchange с другим типом.
- **Ошибка:** привязывать очередь к exchange, которого ещё нет, или публиковать в него. Консоль ответит `Error: 404 NOT_FOUND - no exchange 'delivery' in vhost '/'`. **Верно:** сначала объявить exchange и очередь, потом привязку.
- **Ошибка:** считать, что публикация доставила сообщение, раз команда вернула `published the message`. **Верно:** проверить `queues list`: при несовпадении ключа сообщение отбрасывается без ошибки.
- **Ошибка:** дать объекту имя на `amq.`. Брокер ответит `403 ACCESS_REFUSED`. **Верно:** выбрать другое имя.

Так выглядит ошибка `406` при повторном объявлении очереди `couriers` с `--durable false`:

```text
Error: 406 PRECONDITION_FAILED - inequivalent arg 'durable' for queue 'couriers' in vhost '/': received 'false' but current is 'true'
```

### Шпаргалка

- Путь: издатель → exchange → привязка → очередь → потребитель.
- `direct` — ключ сообщения равен ключу привязки; `fanout` — копия в каждую привязанную очередь.
- `exchanges declare --name ИМЯ --type ТИП --durable true`
- `queues declare --name ИМЯ --type classic --durable true`
- `bindings declare --source E --destination-type queue --destination Q --routing-key K`
- `publish message -e E -k K -m "текст"`
- `exchanges list`, `queues list [--columns a,b]`, `bindings list`, `--non-interactive`.
- `rabbitmqctl list_queues|list_exchanges|list_bindings`.
- `queues purge --name Q` — очистить; `queues delete --name Q`, `exchanges delete --name E` — удалить.
- Повторное объявление с другими атрибутами — `406`.

## task rmq-first-topology

```json
{
  "type": "topology",
  "title": "Платежи: exchange, очередь, привязка",
  "xp": 10,
  "hints": [
    "Разделы «Объявление exchange», «Объявление очереди» и «Привязка».",
    "Нужны три команды в таком порядке: exchange, очередь, привязка. Ключ привязки совпадает с тем, что назван в условии.",
    "Замените `…` в каждой команде. Тип exchange — `direct`, тип очереди — `classic`, в привязке `--destination-type queue`."
  ],
  "check": {}
}
```

Платёжный сервис публикует события в exchange `payments`, а их читает сервис учёта. Подготовьте в vhost `/` такую схему:

- exchange `payments` типа `direct`, durable;
- очередь `payment-events` типа `classic`, durable;
- привязка из `payments` в `payment-events` с ключом `paid`.

```broker starter
rabbitmqadmin exchanges declare --name … --type … --durable true
rabbitmqadmin queues declare --name … --type … --durable true
rabbitmqadmin bindings declare --source … --destination-type queue --destination … --routing-key …
```

```broker solution
rabbitmqadmin exchanges declare --name payments --type direct --durable true
rabbitmqadmin queues declare --name payment-events --type classic --durable true
rabbitmqadmin bindings declare --source payments --destination-type queue --destination payment-events --routing-key paid
```

## task rmq-fanout-alerts

```json
{
  "type": "topology",
  "title": "Оповещения в две очереди",
  "xp": 15,
  "hints": [
    "Разделы «Типы exchange» и «Привязка»: что делает `fanout` с ключом.",
    "Очередей две, значит и привязок две. У `fanout` ключ привязки не нужен, укажите пустую строку.",
    "Шаблон: exchange `…` типа `…`; две очереди; две привязки с `--routing-key \"\"`, по одной на очередь."
  ],
  "check": {}
}
```

Склад хочет, чтобы каждое оповещение о нехватке товара получали и почтовый сервис, и SMS-сервис. Подготовьте:

- exchange `stock-alerts` типа `fanout`, durable;
- очереди `alerts-email` и `alerts-sms` типа `classic`, durable;
- привязки `stock-alerts` → `alerts-email` и `stock-alerts` → `alerts-sms` с пустым ключом `""`.

```broker starter
rabbitmqadmin exchanges declare --name stock-alerts --type … --durable true
rabbitmqadmin queues declare --name … --type classic --durable true
rabbitmqadmin bindings declare --source stock-alerts --destination-type queue --destination … --routing-key ""
```

```broker solution
rabbitmqadmin exchanges declare --name stock-alerts --type fanout --durable true
rabbitmqadmin queues declare --name alerts-email --type classic --durable true
rabbitmqadmin queues declare --name alerts-sms --type classic --durable true
rabbitmqadmin bindings declare --source stock-alerts --destination-type queue --destination alerts-email --routing-key ""
rabbitmqadmin bindings declare --source stock-alerts --destination-type queue --destination alerts-sms --routing-key ""
```

## task rmq-publish-shipping

```json
{
  "type": "console",
  "title": "Три посылки по двум ключам",
  "xp": 15,
  "hints": [
    "Раздел «Публикация через exchange».",
    "Ключ `deliver` ведёт в очередь `courier-jobs`, ключ `pack` — в `warehouse-jobs`. Публиковать нужно в exchange `shipping`, три отдельные команды.",
    "Шаблон: `rabbitmqadmin publish message --exchange … --routing-key … --payload \"…\"`, три раза."
  ],
  "check": {
    "compare": ["messages"],
    "require": [{ "pattern": "publish message", "message": "Опубликуйте сообщения командой publish message" }]
  }
}
```

Exchange `shipping` (тип `direct`) уже настроен: ключ `deliver` ведёт в очередь `courier-jobs`, ключ `pack` — в очередь `warehouse-jobs`. Опубликуйте через `shipping` по порядку три сообщения:

1. `parcel 7` с ключом `deliver`;
2. `parcel 8` с ключом `pack`;
3. `parcel 9` с ключом `deliver`.

Проверяйте результат командой `queues list`.

```broker setup
rabbitmqadmin exchanges declare --name shipping --type direct --durable true
rabbitmqadmin queues declare --name courier-jobs --type classic --durable true
rabbitmqadmin queues declare --name warehouse-jobs --type classic --durable true
rabbitmqadmin bindings declare --source shipping --destination-type queue --destination courier-jobs --routing-key deliver
rabbitmqadmin bindings declare --source shipping --destination-type queue --destination warehouse-jobs --routing-key pack
```

```broker starter
rabbitmqadmin publish message --exchange shipping --routing-key … --payload "parcel 7"
```

```broker solution
rabbitmqadmin publish message --exchange shipping --routing-key deliver --payload "parcel 7"
rabbitmqadmin publish message --exchange shipping --routing-key pack --payload "parcel 8"
rabbitmqadmin publish message --exchange shipping --routing-key deliver --payload "parcel 9"
```

## task rmq-clean-queues

```json
{
  "type": "console",
  "title": "Убрать тестовую очередь и очистить рабочую",
  "xp": 15,
  "hints": [
    "Раздел «Очистка и удаление».",
    "С тестовой очередью и сообщениями нужно проститься целиком, у рабочей очереди остаётся только сама очередь. Это разные команды.",
    "Шаблон: `rabbitmqadmin queues delete --name …` для очереди `orders-test`, `rabbitmqadmin queues purge --name …` для очереди `orders`."
  ],
  "check": {
    "compare": ["queues", "messages"],
    "require": [
      { "pattern": "queues delete", "message": "Удалите очередь командой queues delete" },
      { "pattern": "queues purge", "message": "Очистите очередь командой queues purge" }
    ]
  }
}
```

В брокере остались очередь `orders` с тремя сообщениями и тестовая очередь `orders-test` с двумя. Удалите `orders-test` целиком. Из `orders` уберите все сообщения, но саму очередь оставьте.

```broker setup
rabbitmqadmin queues declare --name orders --type classic --durable true
rabbitmqadmin queues declare --name orders-test --type classic --durable true
rabbitmqadmin publish message --routing-key orders --payload "order 1"
rabbitmqadmin publish message --routing-key orders --payload "order 2"
rabbitmqadmin publish message --routing-key orders --payload "order 3"
rabbitmqadmin publish message --routing-key orders-test --payload "test 1"
rabbitmqadmin publish message --routing-key orders-test --payload "test 2"
```

```broker starter
rabbitmqadmin queues delete --name …
rabbitmqadmin queues purge --name …
```

```broker solution
rabbitmqadmin queues delete --name orders-test
rabbitmqadmin queues purge --name orders
```
