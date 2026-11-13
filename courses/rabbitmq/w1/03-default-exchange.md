# Exchange по умолчанию и первая очередь

Небольшому сервису уведомлений не нужна сложная схема: одна очередь `emails`, в которую пишет сервис заказов и из которой читает почтовик. Объявлять для этого отдельный exchange и привязку избыточно. В RabbitMQ такой случай предусмотрен: есть встроенный exchange по умолчанию, через который можно писать прямо в очередь по её имени. Именно так публиковали издатели в уроке 1.1.

### Exchange по умолчанию

- Он безымянный: его имя — пустая строка `""`. Существует всегда, тип `direct`.
- Каждая очередь автоматически привязана к нему с ключом, равным имени очереди. Поэтому сообщение с ключом `tickets`, отправленное в exchange `""`, попадает в очередь `tickets`.
- Эти привязки неявные: в `bindings list` они не видны.
- Привязывать очереди к нему и отвязывать их нельзя: брокер ответит `403 ACCESS_REFUSED`.

Если очереди с таким именем нет, привязки с этим ключом тоже нет, и сообщение отбрасывается без ошибки. Поэтому опечатка в ключе — тихая потеря сообщения.

### Публикация прямо в очередь

```text
rabbitmqadmin publish message --routing-key ИМЯ_ОЧЕРЕДИ --payload "ТЕКСТ"
```

- `--routing-key` (или `-k`) — имя очереди, в которую нужно положить сообщение.
- `--payload` (или `-m`) — тело сообщения.
- Флаг `--exchange` не нужен: по умолчанию он равен пустой строке, то есть exchange по умолчанию. Запись `-e ""` означает то же самое.

Пример. Очередь заявок службы поддержки, пять публикаций, из них в последней опечатка в имени очереди.

```broker example
rabbitmqadmin queues declare --name tickets --type classic --durable true
rabbitmqadmin publish message --routing-key tickets --payload "ticket 1"
rabbitmqadmin publish message -e "" -k tickets -m "ticket 2"
rabbitmqadmin publish message -k tickets -m "ticket 3"
rabbitmqadmin publish message -k tickets -m "ticket 4"
rabbitmqadmin publish message -k ticket -m "ticket 5"
rabbitmqadmin queues list --columns name,messages_ready
rabbitmqadmin bindings list
```

Результат:

```text
declared queue 'tickets' in virtual host '/'
published the message
published the message
published the message
published the message
published the message, but it was not routed to any queue
┌─────────┬────────────────┐
│ name    │ messages_ready │
├─────────┼────────────────┤
│ tickets │ 4              │
└─────────┴────────────────┘
┌────────┬─────────────┬──────────────────┬─────────────┐
│ source │ destination │ destination_type │ routing_key │
├────────┼─────────────┼──────────────────┼─────────────┤
└────────┴─────────────┴──────────────────┴─────────────┘
```

В очереди четыре сообщения. Пятое ушло по ключу `ticket`, очереди с таким именем нет, и сообщение пропало, хотя команда не вернула ошибку. Список привязок пуст: неявные привязки в нём не показываются.

### Сообщение без очереди

Издатель может попросить брокера не отбрасывать такие сообщения молча. Для этого служит флаг `mandatory`: если сообщению не нашлось очереди, брокер возвращает его издателю (`basic.return`, код `312 NO_ROUTE`). Консольная команда `publish message` о возврате не сообщает, поэтому в консоли это видно только по очереди. Проверки заданий этого урока публикуют сообщения с флагом `mandatory` и смотрят, какие из них не нашли очереди.

### Чтение: get messages

```text
rabbitmqadmin get messages --queue ИМЯ --count N --ack-mode РЕЖИМ
```

- `get messages` — разовый запрос: забрать сообщения из очереди и показать их. Для постоянной работы документация RabbitMQ рекомендует подписку, а не такие запросы; для проверок и учебных задач `get` удобен.
- `--queue` (или `-q`) — очередь.
- `--count` (или `-c`) — сколько сообщений прочитать. По умолчанию `1`.
- `--ack-mode` (или `-a`) — что сделать с прочитанными сообщениями. Режимы `ack_requeue_false`, `ack_requeue_true`, `reject_requeue_false`, `reject_requeue_true`. Нужны два:
  - `ack_requeue_false` (по умолчанию) — прочитать и подтвердить: сообщение исчезает из очереди;
  - `ack_requeue_true` — прочитать и вернуть в очередь: сообщение остаётся на своём месте, но получает пометку `redelivered`.

Сообщения идут в порядке поступления. Таблица показывает `exchange` (из какого exchange пришло), `routing_key`, `redelivered` (повторная ли доставка), `payload_bytes` (размер тела) и `payload` (тело).

Заберём два сообщения:

```broker example
rabbitmqadmin get messages --queue tickets --count 2
rabbitmqadmin queues list --columns name,messages_ready
```

```text
┌──────────┬─────────────┬─────────────┬───────────────┬──────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload  │
├──────────┼─────────────┼─────────────┼───────────────┼──────────┤
│          │ tickets     │ false       │ 8             │ ticket 1 │
│          │ tickets     │ false       │ 8             │ ticket 2 │
└──────────┴─────────────┴─────────────┴───────────────┴──────────┘
┌─────────┬────────────────┐
│ name    │ messages_ready │
├─────────┼────────────────┤
│ tickets │ 2              │
└─────────┴────────────────┘
```

Прочитаны первые два, в очереди остались два. Теперь «подсмотрим» следующее сообщение дважды, не забирая его:

```broker example
rabbitmqadmin get messages --queue tickets --ack-mode ack_requeue_true
rabbitmqadmin get messages --queue tickets --ack-mode ack_requeue_true
```

```text
┌──────────┬─────────────┬─────────────┬───────────────┬──────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload  │
├──────────┼─────────────┼─────────────┼───────────────┼──────────┤
│          │ tickets     │ false       │ 8             │ ticket 3 │
└──────────┴─────────────┴─────────────┴───────────────┴──────────┘
┌──────────┬─────────────┬─────────────┬───────────────┬──────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload  │
├──────────┼─────────────┼─────────────┼───────────────┼──────────┤
│          │ tickets     │ true        │ 8             │ ticket 3 │
└──────────┴─────────────┴─────────────┴───────────────┴──────────┘
```

Каждая команда печатает свою таблицу. Сообщение осталось в очереди, но после первого чтения оно помечено как повторно доставленное, поэтому при втором чтении `redelivered` равен `true`. Если ваше задание сравнивает содержимое очереди, такое чтение изменит её: сообщение получит пометку, и проверка это заметит.

### Потребитель: sim consume и sim ack

`get` один раз забирает сообщения. Настоящий потребитель подписывается на очередь, и брокер сам присылает ему сообщения. В лаборатории это показывают учебные команды `sim`:

```text
sim consume ОЧЕРЕДЬ --prefetch N
sim ack ТЕГ
```

- `sim consume` подключает потребителя с ручным подтверждением. Строка `[sim] tag=… queue=… redelivered=… body=…` показывает выданное сообщение и его номер доставки (тег).
- `--prefetch N` — сколько неподтверждённых сообщений брокер выдаёт потребителю сразу. `0` — без ограничения. Флаг `--auto-ack` включает автоматическое подтверждение, как в уроке 1.1.
- `sim ack ТЕГ` подтверждает сообщение с этим тегом. Пока сообщение не подтверждено, оно в счётчике `messages_unacknowledged`, а не в `messages_ready`.

```broker example
rabbitmqadmin queues list --columns name,messages_ready,messages_unacknowledged,consumers
sim consume tickets --prefetch 1
rabbitmqadmin queues list --columns name,messages_ready,messages_unacknowledged,consumers
sim ack 1
sim ack 2
rabbitmqadmin queues list --columns name,messages_ready,messages_unacknowledged,consumers
```

```text
┌─────────┬────────────────┬─────────────────────────┬───────────┐
│ name    │ messages_ready │ messages_unacknowledged │ consumers │
├─────────┼────────────────┼─────────────────────────┼───────────┤
│ tickets │ 2              │ 0                       │ 0         │
└─────────┴────────────────┴─────────────────────────┴───────────┘
[sim] потребитель amq.ctag-1 на очереди tickets (prefetch=1, ручное подтверждение)
[sim] tag=1 queue=tickets redelivered=true body=ticket 3
┌─────────┬────────────────┬─────────────────────────┬───────────┐
│ name    │ messages_ready │ messages_unacknowledged │ consumers │
├─────────┼────────────────┼─────────────────────────┼───────────┤
│ tickets │ 1              │ 1                       │ 1         │
└─────────┴────────────────┴─────────────────────────┴───────────┘
[sim] tag=2 queue=tickets redelivered=false body=ticket 4
[sim] нет неподтверждённых сообщений
┌─────────┬────────────────┬─────────────────────────┬───────────┐
│ name    │ messages_ready │ messages_unacknowledged │ consumers │
├─────────┼────────────────┼─────────────────────────┼───────────┤
│ tickets │ 0              │ 0                       │ 1         │
└─────────┴────────────────┴─────────────────────────┴───────────┘
```

До подключения в очереди два готовых сообщения, потребителей нет. После `sim consume` одно сообщение готово, одно выдано и один потребитель: при `--prefetch 1` брокер держит у потребителя не больше одного неподтверждённого сообщения. Команда `sim ack 1` подтверждает `ticket 3`, и брокер выдаёт следующее: `tag=2`, `ticket 4`. Команда `sim ack 2` подтверждает и его; строка `нет неподтверждённых сообщений` сообщает, что после этого у потребителя ничего не осталось. Очередь пуста, потребитель остаётся подключённым.

### То же из кода на Python

Сервисы обычно работают с RabbitMQ не из консоли, а из кода. Для Python есть библиотека `pika`. Всё, что вы делали командами, она умеет делать вызовами. Публикация прямо в очередь выглядит так.

```text
import pika

connection = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
channel = connection.channel()
channel.queue_declare(queue="ИМЯ", durable=True)
channel.basic_publish(exchange="", routing_key="ИМЯ", body="ТЕКСТ")
connection.close()
```

- `pika.ConnectionParameters("localhost")` — куда подключаться. Первый аргумент — адрес сервера. Остальное (порт `5672`, пользователь `guest`) берётся по умолчанию.
- `pika.BlockingConnection(...)` — открывает соединение. «Blocking» значит, что каждый вызов ждёт ответа брокера и только потом идёт дальше.
- `connection.channel()` — открывает канал. Все команды отправляются через канал, а не через соединение.
- `channel.queue_declare(queue="ИМЯ", durable=True)` — то же, что `queues declare --name ИМЯ --type classic --durable true`. Если очередь уже есть с такими же свойствами, вызов ничего не меняет.
- `channel.basic_publish(exchange="", routing_key="ИМЯ", body="ТЕКСТ")` — то же, что `publish message`. `exchange=""` — exchange по умолчанию, `routing_key` — имя очереди, `body` — тело сообщения.
- `connection.close()` — закрывает соединение. Без него программа оставляет соединение открытым.

Полный пример. Очередь `tickets` и два сообщения:

```python
import pika

connection = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
channel = connection.channel()
channel.queue_declare(queue="tickets", durable=True)
for number in (1, 2):
    channel.basic_publish(exchange="", routing_key="tickets", body=f"ticket {number}")
connection.close()
```

После запуска в очереди `tickets` два сообщения: `ticket 1` и `ticket 2`, в этом порядке. Цикл `for` повторяет публикацию для каждого числа из скобок, а запись `f"ticket {number}"` подставляет число в строку. Можно обойтись без цикла и написать два вызова подряд.

Важно: в этом приложении программа выполняется в песочнице. Она работает с тем же учебным брокером, что и консоль, а не с настоящим сервером. Вызовы `pika` ведут себя как настоящие, но поддерживается только часть библиотеки. Остальное вызывает ошибку `NotImplementedError` с именем вызова. В настоящем проекте код тот же, а в `ConnectionParameters` вы указываете адрес своего сервера.

### Частые ошибки

- **Ошибка:** `rabbitmqadmin bindings declare --source "" …`, чтобы привязать очередь к exchange по умолчанию. Результат: `Error: 403 ACCESS_REFUSED - operation not permitted on the default exchange`. **Верно:** ничего привязывать не нужно, очередь уже привязана по своему имени.
- **Ошибка:** опечатка в ключе при публикации в exchange по умолчанию (`ticket` вместо `tickets`). Сообщение пропадает, а ошибки нет: консоль лишь добавляет `not routed to any queue`. **Верно:** читать вывод целиком и проверять `queues list`.
- **Ошибка:** смотреть очередь командой `get messages` без `--ack-mode ack_requeue_true`. По умолчанию сообщения подтверждаются и исчезают. **Верно:** для просмотра добавить `--ack-mode ack_requeue_true`, а лучше проверять число сообщений по `queues list`.
- **Ошибка:** считать, что просмотр с возвратом ничего не меняет. Сообщение остаётся на месте, но получает `redelivered=true`. **Верно:** помнить об этой пометке, если состояние очереди потом сравнивается.

### Шпаргалка

- Exchange по умолчанию: имя `""`, тип `direct`; каждая очередь привязана к нему по своему имени; привязать вручную нельзя (`403`).
- `publish message -k ОЧЕРЕДЬ -m "текст"` — положить сообщение в очередь.
- Нет очереди с таким именем — сообщение отбрасывается; с флагом `mandatory` его вернут издателю (`312`).
- `get messages -q Q -c N -a РЕЖИМ`: `ack_requeue_false` (по умолчанию) забирает, `ack_requeue_true` оставляет с `redelivered`.
- `sim consume Q --prefetch N` — подключить потребителя; `sim ack ТЕГ` — подтвердить.
- `messages_ready` — готовы к выдаче, `messages_unacknowledged` — выданы, но не подтверждены.
- Python: `pika.BlockingConnection(pika.ConnectionParameters("localhost"))`, `connection.channel()`, `channel.queue_declare(queue=…, durable=True)`, `channel.basic_publish(exchange="", routing_key=…, body=…)`, `connection.close()`.

## task rmq-first-queue

```json
{
  "type": "console",
  "title": "Первая очередь и три сообщения",
  "xp": 10,
  "hints": [
    "Разделы «Публикация прямо в очередь» и «Объявление очереди» из урока 1.2.",
    "Сначала объявите очередь, потом три раза опубликуйте сообщение, в ключе укажите имя очереди. Порядок публикаций — порядок в очереди.",
    "Шаблон: `rabbitmqadmin queues declare --name … --type classic --durable true`, затем три раза `rabbitmqadmin publish message --routing-key … --payload \"parcel …\"`."
  ],
  "check": {
    "compare": ["queues", "messages"],
    "require": [{ "pattern": "publish message", "message": "Опубликуйте сообщения командой publish message" }]
  }
}
```

Объявите классическую durable-очередь `parcels` и положите в неё через exchange по умолчанию три сообщения по порядку: `parcel 101`, `parcel 102`, `parcel 103`. Читать их командой `get` не нужно.

```broker starter
rabbitmqadmin queues declare --name … --type classic --durable true
rabbitmqadmin publish message --routing-key … --payload "parcel 101"
```

```broker solution
rabbitmqadmin queues declare --name parcels --type classic --durable true
rabbitmqadmin publish message --routing-key parcels --payload "parcel 101"
rabbitmqadmin publish message --routing-key parcels --payload "parcel 102"
rabbitmqadmin publish message --routing-key parcels --payload "parcel 103"
```

## task rmq-take-two

```json
{
  "type": "console",
  "title": "Забрать два письма из очереди",
  "xp": 15,
  "hints": [
    "Раздел «Чтение: get messages».",
    "Забрать — значит прочитать и подтвердить: так `get` работает по умолчанию. Сколько сообщений нужно, задаёт `--count`.",
    "Шаблон: `rabbitmqadmin get messages --queue … --count …`."
  ],
  "check": {
    "compare": ["messages"],
    "require": [{ "pattern": "get messages", "message": "Прочитайте сообщения командой get messages" }]
  }
}
```

В очереди `inbox` лежат четыре письма: `letter 1`, `letter 2`, `letter 3`, `letter 4`. Заберите из неё первые два так, чтобы они исчезли из очереди. Два остальных должны остаться на месте и не получить пометку `redelivered`.

```broker setup
rabbitmqadmin queues declare --name inbox --type classic --durable true
rabbitmqadmin publish message --routing-key inbox --payload "letter 1"
rabbitmqadmin publish message --routing-key inbox --payload "letter 2"
rabbitmqadmin publish message --routing-key inbox --payload "letter 3"
rabbitmqadmin publish message --routing-key inbox --payload "letter 4"
```

```broker starter
rabbitmqadmin get messages --queue inbox --count …
```

```broker solution
rabbitmqadmin get messages --queue inbox --count 2
```

## task rmq-route-by-name

```json
{
  "type": "routing",
  "title": "Какие очереди нужны издателю",
  "xp": 20,
  "hints": [
    "Раздел «Exchange по умолчанию»: по какому правилу сообщение находит очередь.",
    "Ключ сообщения должен совпадать с именем очереди. Очереди нужны только для тех ключей, куда сообщения должны попасть. Для `push` очереди быть не должно.",
    "Шаблон: две команды `rabbitmqadmin queues declare --name … --type classic --durable true`, по одной на `emails` и `sms`."
  ],
  "check": {
    "publish": [
      { "exchange": "", "routingKey": "emails", "body": "welcome-1" },
      { "exchange": "", "routingKey": "sms", "body": "code-1" },
      { "exchange": "", "routingKey": "emails", "body": "welcome-2" },
      { "exchange": "", "routingKey": "push", "body": "promo-1" }
    ]
  }
}
```

Сервис уведомлений будет публиковать в exchange по умолчанию четыре сообщения с ключами `emails`, `sms`, `emails`, `push` и телами `welcome-1`, `code-1`, `welcome-2`, `promo-1` соответственно. Пока в брокере нет очередей. Подготовьте их так, чтобы `welcome-1` и `welcome-2` легли в очередь `emails` по порядку, `code-1` — в очередь `sms`, а `promo-1` не попало ни в одну очередь (проверка публикует с флагом `mandatory` и получит такое сообщение обратно).

```broker starter
rabbitmqadmin queues declare --name … --type classic --durable true
```

```broker solution
rabbitmqadmin queues declare --name emails --type classic --durable true
rabbitmqadmin queues declare --name sms --type classic --durable true
```

## task rmq-find-missing-queues

```json
{
  "type": "routing",
  "title": "Сообщения биллинга не должны теряться",
  "xp": 25,
  "hints": [
    "Разделы «Exchange по умолчанию» и «Сообщение без очереди».",
    "Очередь `billing-invoice` уже есть. Посмотрите на ключи в условии: для каждого, у которого очереди нет, она должна появиться. Имя очереди равно ключу.",
    "Шаблон: две команды `rabbitmqadmin queues declare --name … --type classic --durable true` для тех ключей, чьих очередей ещё нет."
  ],
  "check": {
    "publish": [
      { "exchange": "", "routingKey": "billing-invoice", "body": "inv-1" },
      { "exchange": "", "routingKey": "billing-refund", "body": "ref-1" },
      { "exchange": "", "routingKey": "billing-invoice", "body": "inv-2" },
      { "exchange": "", "routingKey": "billing-void", "body": "void-1" }
    ]
  }
}
```

Сервис биллинга публикует в exchange по умолчанию сообщения с ключами `billing-invoice`, `billing-refund`, `billing-invoice`, `billing-void` и телами `inv-1`, `ref-1`, `inv-2`, `void-1`. Очередь `billing-invoice` уже есть. Дополните брокер так, чтобы ни одно сообщение не вернулось издателю как не нашедшее очереди, а каждый тип сообщений лёг в свою очередь.

```broker setup
rabbitmqadmin queues declare --name billing-invoice --type classic --durable true
```

```broker starter
rabbitmqadmin queues declare --name … --type classic --durable true
```

```broker solution
rabbitmqadmin queues declare --name billing-refund --type classic --durable true
rabbitmqadmin queues declare --name billing-void --type classic --durable true
```

## task rmq-client-publish-orders

```json
{
  "type": "client",
  "title": "Три заказа из кода",
  "xp": 20,
  "hints": [
    "Раздел «То же из кода на Python».",
    "Нужны `queue_declare` для очереди и три вызова `basic_publish` через exchange по умолчанию. Тело сообщения — строка.",
    "Шаблон: `channel.queue_declare(queue=\"…\", durable=True)`, затем три раза `channel.basic_publish(exchange=\"\", routing_key=\"…\", body=\"order …\")`."
  ],
  "check": {
    "compare": ["queues", "messages"],
    "require": [{ "pattern": "basic_publish", "message": "Опубликуйте сообщения вызовом basic_publish" }]
  }
}
```

Напишите программу `main.py`, которая объявляет durable-очередь `orders-in` и кладёт в неё через exchange по умолчанию три сообщения по порядку: `order 1`, `order 2`, `order 3`. В конце программа закрывает соединение.

```python starter
import pika

connection = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
channel = connection.channel()
# объявите очередь и опубликуйте три сообщения
connection.close()
```

```python solution
import pika

connection = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
channel = connection.channel()
channel.queue_declare(queue="orders-in", durable=True)
for number in (1, 2, 3):
    channel.basic_publish(exchange="", routing_key="orders-in", body=f"order {number}")
connection.close()
```
