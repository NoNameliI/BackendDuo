# TTL и dead-letter exchange

Магазин отправляет напоминание «заказ ждёт оплаты». Через час оно уже никому не нужно, и если очередь стоит, устаревшие напоминания нельзя доставлять. Другая беда: сообщение, которое потребитель не смог обработать, не должно пропадать молча, его надо сложить в отдельное место и разобрать позже. Для первого служит срок жизни сообщения (TTL), для второго — dead-letter exchange.

В примерах время сжато: срок в секунду вместо часа. Команда `sim run 3s` проматывает три секунды виртуального времени, ждать на самом деле не нужно.

### Срок жизни сообщения

Срок жизни можно задать двумя способами.

```text
rabbitmqadmin queues declare --name ОЧЕРЕДЬ --type classic --durable true --arguments '{"x-message-ttl": МИЛЛИСЕКУНДЫ}'
rabbitmqadmin publish message --routing-key ОЧЕРЕДЬ --payload "ТЕКСТ" --properties '{"expiration": "МИЛЛИСЕКУНДЫ"}'
```

- `--arguments` — аргументы очереди в виде JSON-строки (как `x-match` у привязки в уроках про маршрутизацию). `x-message-ttl` — срок жизни для всех сообщений очереди, в миллисекундах. Целое число, не меньше нуля.
- `--properties` — свойства одного сообщения, тоже JSON-строка. `expiration` — срок жизни этого сообщения. Значение пишется строкой из цифр: `"1000"`, а не `1000`.
- Если заданы оба срока, действует меньший.
- Просроченное сообщение потребителям не выдаётся и командой `get` не возвращается.
- При возврате в очередь (`requeue`) сообщение сохраняет исходный срок.

Есть тонкость. Сроки одного размера, то есть `x-message-ttl` очереди, истекают по порядку: самое старое сообщение стоит первым. Срок отдельного сообщения (`expiration`) проверяется только на голове очереди. Если впереди стоит сообщение без срока, просроченное сообщение за ним остаётся в очереди, занимает место и считается в счётчиках, пока голова не освободится.

Пример. Очередь `promo` со сроком две секунды и очередь `drafts` без срока, где второе сообщение имеет `expiration` в одну секунду.

```broker example
rabbitmqadmin queues declare --name promo --type classic --durable true --arguments '{"x-message-ttl": 2000}'
rabbitmqadmin publish message --routing-key promo --payload "promo 1"
rabbitmqadmin publish message --routing-key promo --payload "promo 2"
rabbitmqadmin queues list --columns name,messages_ready
sim run 3s
rabbitmqadmin queues list --columns name,messages_ready
rabbitmqadmin queues declare --name drafts --type classic --durable true
rabbitmqadmin publish message --routing-key drafts --payload "draft 1"
rabbitmqadmin publish message --routing-key drafts --payload "draft 2" --properties '{"expiration": "1000"}'
sim run 5s
rabbitmqadmin queues list --columns name,messages_ready
```

Результат:

```text
declared queue 'promo' in virtual host '/'
published the message
published the message
┌───────┬────────────────┐
│ name  │ messages_ready │
├───────┼────────────────┤
│ promo │ 2              │
└───────┴────────────────┘
[sim] прошло 3000 мс виртуального времени
┌───────┬────────────────┐
│ name  │ messages_ready │
├───────┼────────────────┤
│ promo │ 0              │
└───────┴────────────────┘
declared queue 'drafts' in virtual host '/'
published the message
published the message
[sim] прошло 5000 мс виртуального времени
┌────────┬────────────────┐
│ name   │ messages_ready │
├────────┼────────────────┤
│ drafts │ 2              │
│ promo  │ 0              │
└────────┴────────────────┘
```

Через три секунды в `promo` ничего нет: оба сообщения просрочены. В `drafts` через пять секунд всё ещё два сообщения: `draft 2` просрочено, но стоит за `draft 1`, у которого срока нет. Заберём голову:

```broker example
rabbitmqadmin get messages --queue drafts --count 1
rabbitmqadmin queues list --columns name,messages_ready
sim run 1s
rabbitmqadmin queues list --columns name,messages_ready
```

```text
┌──────────┬─────────────┬─────────────┬───────────────┬─────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload │
├──────────┼─────────────┼─────────────┼───────────────┼─────────┤
│          │ drafts      │ false       │ 7             │ draft 1 │
└──────────┴─────────────┴─────────────┴───────────────┴─────────┘
┌────────┬────────────────┐
│ name   │ messages_ready │
├────────┼────────────────┤
│ drafts │ 1              │
│ promo  │ 0              │
└────────┴────────────────┘
[sim] прошло 1000 мс виртуального времени
┌────────┬────────────────┐
│ name   │ messages_ready │
├────────┼────────────────┤
│ drafts │ 0              │
│ promo  │ 0              │
└────────┴────────────────┘
```

После `get` просроченное сообщение стало головой. Брокер удаляет его «в ближайшее время после» истечения срока, поэтому сразу оно ещё в счётчике, а после `sim run 1s` его уже нет.

### Dead-letter exchange

Просроченное или отклонённое сообщение можно не терять, а отправить в другой exchange. Он называется dead-letter exchange (DLX), а очередь, куда сообщение в итоге попадает, чаще называют очередью «мёртвых писем» (DLQ).

```text
rabbitmqadmin queues declare --name ОЧЕРЕДЬ --type classic --durable true --arguments '{"x-dead-letter-exchange": "DLX", "x-dead-letter-routing-key": "КЛЮЧ"}'
```

- `x-dead-letter-exchange` — имя exchange, в который уходят «мёртвые» сообщения. Он должен быть в том же виртуальном хосте.
- `x-dead-letter-routing-key` — необязательно. Если указан, сообщение уйдёт с этим ключом. Если не указан, сохраняются прежние ключи маршрутизации сообщения.
- Дальше всё как обычно: DLX — обычный exchange, у него нужны привязки на очереди, иначе сообщению снова некуда идти.

Сообщение становится «мёртвым» по одной из четырёх причин:

- `rejected` — потребитель отклонил его через `reject` или `nack` с `requeue=false`;
- `expired` — истёк срок жизни;
- `maxlen` — очередь с аргументом `x-max-length` (предел числа готовых сообщений) переполнилась, и самое старое сообщение вытеснено с головы;
- `delivery_limit` — quorum-очередь исчерпала число доставок (см. урок 4.4).

Если DLX не задан или его нет в момент отправки, сообщение просто пропадает. Сообщение, которое уходит из очереди вместе с самой очередью (`x-expires` или удаление), в dead-letter не попадает.

Напоминание из урока про `ack`, `nack` и `reject`: `reject` и `nack` с `requeue=false` отклоняют сообщение без возврата в очередь. В консоли это `sim reject ТЕГ` (без `--requeue`).

Пример. Очередь `tickets` со сроком одна секунда отправляет просроченные заявки в очередь `tickets.dead` через exchange `shop.dlx`:

```broker example
rabbitmqadmin exchanges declare --name shop.dlx --type fanout --durable true
rabbitmqadmin queues declare --name tickets.dead --type classic --durable true
rabbitmqadmin bindings declare --source shop.dlx --destination-type queue --destination tickets.dead --routing-key ""
rabbitmqadmin queues declare --name tickets --type classic --durable true --arguments '{"x-message-ttl": 1000, "x-dead-letter-exchange": "shop.dlx"}'
rabbitmqadmin publish message --routing-key tickets --payload "ticket 1"
rabbitmqadmin publish message --routing-key tickets --payload "ticket 2"
sim run 2s
rabbitmqadmin queues list --columns name,messages_ready
rabbitmqadmin get messages --queue tickets.dead --count 2
```

```text
declared exchange 'shop.dlx' in virtual host '/'
declared queue 'tickets.dead' in virtual host '/'
declared a binding from 'shop.dlx' to queue 'tickets.dead' with routing key '' in virtual host '/'
declared queue 'tickets' in virtual host '/'
published the message
published the message
[sim] прошло 2000 мс виртуального времени
┌──────────────┬────────────────┐
│ name         │ messages_ready │
├──────────────┼────────────────┤
│ drafts       │ 0              │
│ promo        │ 0              │
│ tickets      │ 0              │
│ tickets.dead │ 2              │
└──────────────┴────────────────┘
┌──────────┬─────────────┬─────────────┬───────────────┬──────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload  │
├──────────┼─────────────┼─────────────┼───────────────┼──────────┤
│ shop.dlx │ tickets     │ false       │ 8             │ ticket 1 │
│ shop.dlx │ tickets     │ false       │ 8             │ ticket 2 │
└──────────┴─────────────┴─────────────┴───────────────┴──────────┘
```

Очереди `drafts` и `promo` остались от предыдущих примеров урока и пусты. Обе заявки в `tickets.dead`. В колонке `exchange` стоит `shop.dlx`, а ключ остался прежним: `tickets`, потому что `x-dead-letter-routing-key` не задан.

Теперь отклонение. Задаём ключ `failed`, привязываем к нему очередь и отклоняем первое задание:

```broker example
rabbitmqadmin exchanges declare --name jobs.dlx --type direct --durable true
rabbitmqadmin queues declare --name jobs.failed --type classic --durable true
rabbitmqadmin bindings declare --source jobs.dlx --destination-type queue --destination jobs.failed --routing-key failed
rabbitmqadmin queues declare --name jobs --type classic --durable true --arguments '{"x-dead-letter-exchange": "jobs.dlx", "x-dead-letter-routing-key": "failed"}'
rabbitmqadmin publish message --routing-key jobs --payload "job 1"
rabbitmqadmin publish message --routing-key jobs --payload "job 2"
sim consume jobs --prefetch 1
sim reject 1
sim ack 2
rabbitmqadmin get messages --queue jobs.failed
```

```text
declared exchange 'jobs.dlx' in virtual host '/'
declared queue 'jobs.failed' in virtual host '/'
declared a binding from 'jobs.dlx' to queue 'jobs.failed' with routing key 'failed' in virtual host '/'
declared queue 'jobs' in virtual host '/'
published the message
published the message
[sim] потребитель amq.ctag-1 на очереди jobs (prefetch=1, ручное подтверждение)
[sim] tag=1 queue=jobs redelivered=false body=job 1
[sim] tag=2 queue=jobs redelivered=false body=job 2
[sim] нет неподтверждённых сообщений
┌──────────┬─────────────┬─────────────┬───────────────┬─────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload │
├──────────┼─────────────┼─────────────┼───────────────┼─────────┤
│ jobs.dlx │ failed      │ false       │ 5             │ job 1   │
└──────────┴─────────────┴─────────────┴───────────────┴─────────┘
```

Строка с `tag=1` — выдача `job 1` при подключении. После `sim reject 1` консоль печатает то, что ещё не подтверждено: `tag=2`, то есть `job 2`. После `sim ack 2` неподтверждённых нет. `job 1` отклонено и ушло в `jobs.failed` с ключом `failed`. `job 2` подтверждено и обработано как обычно.

### Заголовок x-death

Когда сообщение умирает, брокер добавляет к нему заголовок `x-death`. Это список записей, новые в начале. На каждую пару «очередь, причина» одна запись со счётчиком `count`. В записи:

- `queue` — очередь, где сообщение умерло;
- `reason` — причина (`rejected`, `expired`, `maxlen`, `delivery_limit`);
- `count` — сколько раз сообщение умирало в этой очереди по этой причине;
- `exchange` — exchange, куда оно было опубликовано изначально;
- `routing-keys` — исходные ключи маршрутизации;
- `time` — время;
- `original-expiration` — прежний `expiration`, если он был.

Рядом лежат `x-first-death-queue`, `x-first-death-reason`, `x-first-death-exchange` (не меняются никогда) и `x-last-death-…` (обновляются при каждой смерти). Свойство `expiration` при этом убирается, чтобы сообщение не истекало снова.

Песочница хранит `x-death`, но консоль не показывает заголовки: `get messages` печатает только таблицу, знакомую по уроку про exchange по умолчанию. Проверки заданий смотрят на причину перехода в DLQ. В сценарии это условие `dlqContains`: в очереди `queue` лежит не меньше `count` сообщений, умерших по причине `reason`. Читать `x-death` вам придётся в коде потребителя, в уроке 4.2 это пригодится для счётчика попыток.

Цикл из dead-letter не бесконечен, если в нём нет отклонения: сообщение, которое только истекало и возвращалось, брокер удалит. Если в цикле было хоть одно отклонение (`rejected`), он продолжается. На этом строится повтор с задержкой из следующего урока.

### Частые ошибки

- **Ошибка:** задать `x-dead-letter-exchange` на очереди, но не объявить сам exchange или не привязать к нему очередь. Сообщение молча пропадёт. **Верно:** объявить DLX, очередь для «мёртвых писем» и привязку, а потом проверять `queues list`.
- **Ошибка:** `"expiration": 1000` без кавычек. **Верно:** `"expiration": "1000"`, строка из цифр.
- **Ошибка:** ждать, что просроченное `expiration` сообщение исчезнет из счётчика, когда впереди есть живое. **Верно:** помнить, что срок отдельного сообщения проверяется только на голове; если сроки должны быть одинаковыми, ставить `x-message-ttl` на очередь.
- **Ошибка:** надеяться, что очередь с `x-expires` отдаст сообщения в DLX при удалении. **Верно:** при удалении очереди сообщения не попадают в dead-letter.

### Шпаргалка

- `x-message-ttl` (аргумент очереди, мс) и `expiration` (свойство сообщения, строка мс); действует меньший срок.
- Срок отдельного сообщения проверяется только на голове очереди.
- `x-dead-letter-exchange`, `x-dead-letter-routing-key` — куда и с каким ключом. Нет ключа — прежние ключи сообщения.
- Причины: `rejected`, `expired`, `maxlen`, `delivery_limit`. Нет DLX — сообщение теряется.
- `x-death`: queue, reason, count, exchange, routing-keys, time, original-expiration; `x-first-death-*`, `x-last-death-*`.
- `sim reject ТЕГ` — отклонить без возврата, `sim run 3s` — перемотать время.

## task rmq-ttl-dlx-build

```json
{
  "type": "topology",
  "title": "Уведомления с сроком жизни и DLQ",
  "xp": 15,
  "hints": [
    "Разделы «Срок жизни сообщения» и «Dead-letter exchange».",
    "Нужны exchange `notify.dlx`, очередь `notify.expired` с привязкой к нему и очередь `notify`, у которой в `--arguments` есть и срок, и имя DLX.",
    "Шаблон: `rabbitmqadmin queues declare --name notify --type classic --durable true --arguments '{\"x-message-ttl\": …, \"x-dead-letter-exchange\": \"…\"}'`."
  ],
  "check": {}
}
```

Сервис уведомлений хранит напоминания в очереди `notify`. Напоминание старше 30 секунд (30000 мс) нужно не терять, а переносить в очередь `notify.expired`. Постройте схему: fanout exchange `notify.dlx` (durable), durable-очередь `notify.expired`, привязанная к нему с пустым ключом `""`, и durable-очередь `notify` классического типа со сроком 30000 мс и dead-letter exchange `notify.dlx`.

```broker starter
rabbitmqadmin exchanges declare --name notify.dlx --type fanout --durable true
rabbitmqadmin queues declare --name notify --type classic --durable true --arguments '{"x-message-ttl": …}'
```

```broker solution
rabbitmqadmin exchanges declare --name notify.dlx --type fanout --durable true
rabbitmqadmin queues declare --name notify.expired --type classic --durable true
rabbitmqadmin bindings declare --source notify.dlx --destination-type queue --destination notify.expired --routing-key ""
rabbitmqadmin queues declare --name notify --type classic --durable true --arguments '{"x-message-ttl": 30000, "x-dead-letter-exchange": "notify.dlx"}'
```

## task rmq-reject-to-dlq

```json
{
  "type": "console",
  "title": "Отправить сломанное задание в DLQ",
  "xp": 20,
  "hints": [
    "Раздел «Dead-letter exchange», пример с `sim reject`.",
    "Задания выдаются по одному (`--prefetch 1`). Подтвердите первое, отклоните второе, подтвердите третье. После каждого действия брокер выдаёт следующее задание и печатает его тег.",
    "Шаблон: `sim consume resize --prefetch 1`, затем `sim ack …`, `sim reject …`, `sim ack …`; теги идут по порядку выдачи, начиная с 1."
  ],
  "check": {
    "compare": ["messages"],
    "require": [{ "pattern": "sim reject", "message": "Отклоните сломанное задание командой sim reject" }]
  }
}
```

В очереди `resize` лежат три задания: `img 1`, `img 2`, `img 3`. Задание `img 2` сломано: его нельзя обработать. Очередь уже настроена так, что отклонённые задания уходят в `resize.failed`. Подключите потребителя с `--prefetch 1`, подтвердите `img 1` и `img 3`, а `img 2` отклоните без возврата в очередь. В конце `resize` должна быть пуста, без неподтверждённых заданий, а в `resize.failed` должно лежать только `img 2`.

```broker setup
rabbitmqadmin exchanges declare --name resize.dlx --type fanout --durable true
rabbitmqadmin queues declare --name resize.failed --type classic --durable true
rabbitmqadmin bindings declare --source resize.dlx --destination-type queue --destination resize.failed --routing-key ""
rabbitmqadmin queues declare --name resize --type classic --durable true --arguments '{"x-dead-letter-exchange": "resize.dlx"}'
rabbitmqadmin publish message --routing-key resize --payload "img 1"
rabbitmqadmin publish message --routing-key resize --payload "img 2"
rabbitmqadmin publish message --routing-key resize --payload "img 3"
```

```broker starter
sim consume resize --prefetch 1
sim ack …
```

```broker solution
sim consume resize --prefetch 1
sim ack 1
sim reject 2
sim ack 3
```

## task rmq-expired-orders

```json
{
  "type": "scenario",
  "title": "Неоплаченные заказы не должны исчезать",
  "xp": 25,
  "scenario": "w4-expired-orders",
  "hints": [
    "Разделы «Срок жизни сообщения» и «Dead-letter exchange».",
    "Очереди `orders.unpaid` в брокере ещё нет, объявить её нужно вам. Срок задаёт `x-message-ttl`, а чтобы просроченные заказы не пропадали, нужен `x-dead-letter-exchange`. Exchange `orders.dlx` и очередь `orders.expired` уже есть.",
    "Шаблон: `rabbitmqadmin queues declare --name orders.unpaid --type classic --durable true --arguments '{\"x-message-ttl\": 1000, \"x-dead-letter-exchange\": \"…\"}'`."
  ],
  "check": {}
}
```

Издатель `shop` кладёт в очередь `orders.unpaid` пять неоплаченных заказов (`order 1` … `order 5`), по десять в секунду. Потребителя нет: заказ ждёт оплаты. Через секунду (так сжато время песочницы, на деле это был бы час) заказ считается просроченным. Сейчас такие заказы пропадают, а бухгалтерия требует, чтобы все пять оказались в очереди `orders.expired` с причиной `expired`.

Exchange `orders.dlx` (fanout) и очередь `orders.expired` уже подготовлены. Объявите очередь `orders.unpaid` со сроком 1000 мс так, чтобы просроченные заказы попадали в `orders.expired`.

```broker starter
rabbitmqadmin queues declare --name orders.unpaid --type classic --durable true --arguments '{"x-message-ttl": 1000}'
```

```broker solution
rabbitmqadmin queues declare --name orders.unpaid --type classic --durable true --arguments '{"x-message-ttl": 1000, "x-dead-letter-exchange": "orders.dlx"}'
```

## task rmq-ttl-min

```json
{
  "type": "choice",
  "title": "Код подтверждения и срок очереди",
  "xp": 10,
  "hints": [
    "Раздел «Срок жизни сообщения»: что будет, если заданы оба срока.",
    "Сравните два числа: срок очереди и срок сообщения. Потом решите, есть ли у очереди DLX.",
    "Действует меньший срок. Если у очереди нет DLX, просроченное сообщение не уходит никуда."
  ],
  "options": [
    "Код останется в очереди ещё 52 секунды: действует срок очереди, 60 секунд",
    "Код пропал: действует меньший срок, 5 секунд, а DLX у очереди нет",
    "Код ушёл в DLQ: просроченное сообщение всегда попадает в dead-letter",
    "Публикация вернула ошибку: нельзя задавать срок и очереди, и сообщению"
  ],
  "answer": [1],
  "explanation": "Если заданы оба срока, действует меньший: 5 секунд. Код опубликован 8 секунд назад, значит он уже просрочен. Единственное сообщение стоит на голове очереди, поэтому оно удаляется. DLX у очереди нет, и сообщение теряется без следа. Вариант про 52 секунды считает наоборот: срок очереди не перекрывает срок сообщения. Вариант про DLQ неверен: без `x-dead-letter-exchange` некуда отправлять. Вариант про ошибку неверен: оба срока разрешены, брокер просто берёт меньший."
}
```

Очередь `otp-codes` объявлена с `x-message-ttl` 60000 и без dead-letter exchange. Издатель опубликовал в неё код с `expiration` `"5000"`. Потребителей нет, с момента публикации прошло 8 секунд. Что с кодом?
