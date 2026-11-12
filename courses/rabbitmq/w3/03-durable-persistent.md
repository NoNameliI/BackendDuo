# Durable, persistent и перезапуск

Интернет-магазин принимает заказы в очередь. Ночью администратор перезапускает сервер брокера для обновления. Утром выясняется, что часть заказов исчезла. Брокер хранит всё в памяти, а на диск пишет только то, о чём его попросили. Два признака отвечают за то, что переживёт перезапуск: `durable` у очереди и exchange и `persistent` у сообщения.

### Durable и persistent

- **durable** — свойство очереди или exchange. Описание durable-объекта брокер восстановит после перезапуска. Не durable-объект после перезапуска исчезает вместе с содержимым. Задаётся при объявлении: `--durable true`.
- **persistent** — свойство сообщения: `delivery_mode=2`. Брокер записывает такое сообщение на диск. Значение `1` — transient, на диск не пишется.
- Сообщение переживает перезапуск, только если оно persistent **и** лежит в durable очереди. Если хоть одно условие не выполнено, сообщение пропадёт.
- Чтобы после перезапуска сообщения продолжали попадать в очередь, durable должны быть и exchange, и привязки между ними.
- Не успевшие записаться на диск к моменту сбоя persistent сообщения тоже могут пропасть. Запись занимает короткое время, а подтверждение о ней издателю даёт механизм из урока 3.4.

Начиная с RabbitMQ 4.3, объявить очередь, которая одновременно не durable и не exclusive, нельзя: брокер ответит `406 PRECONDITION_FAILED`. Поэтому в ваших командах очереди всегда durable. Для exchange такого запрета в песочнице нет, и именно exchange чаще всего забывают.

### Как сделать сообщение persistent

```text
rabbitmqadmin publish message --exchange ОБМЕННИК --routing-key КЛЮЧ --payload "ТЕКСТ" --properties '{"delivery_mode":2}'
```

- `--properties` (или `-p`) — свойства сообщения в виде JSON (как для заголовков в уроке 2.3).
- `delivery_mode` равное `2` — persistent. Без него сообщение transient.
- JSON в одинарных кавычках: внутри него двойные.

В сценарии то же задаётся полем `"props": { "delivery_mode": 2 }` у сообщения издателя.

### Перезапуск узла: sim run и sim restart

```text
sim run ВРЕМЯ
sim restart
```

- `sim run 1s` — продвинуть виртуальное время. Принимает `500ms`, `5s` и так далее. Время в песочнице идёт только по таким командам и в сценариях.
- `sim restart` — аварийно остановить узел и запустить его снова. Очереди и exchange, не являющиеся durable, исчезают. В durable очередях остаются persistent сообщения. Привязки между пережившими объектами остаются. Потребители отключаются.
- Запись persistent сообщения на диск в песочнице занимает 10 мс виртуального времени. Если перезапустить узел раньше, сообщение ещё не записано и пропадёт. Поэтому перед `sim restart` нужно подвигать время.

Пример. Три счёта в durable очередь через durable exchange. Два счёта persistent, один обычный. Лишний exchange `drafts` не durable.

```broker example
rabbitmqadmin queues declare --name invoices --type classic --durable true
rabbitmqadmin exchanges declare --name billing --type direct --durable true
rabbitmqadmin exchanges declare --name drafts --type fanout --durable false
rabbitmqadmin bindings declare --source billing --destination-type queue --destination invoices --routing-key paid
rabbitmqadmin publish message --exchange billing --routing-key paid --payload "invoice 1" --properties '{"delivery_mode":2}'
rabbitmqadmin publish message --exchange billing --routing-key paid --payload "invoice 2"
rabbitmqadmin publish message -e billing -k paid -m "invoice 3" -p '{"delivery_mode":2}'
rabbitmqadmin queues list --columns name,durable,messages_ready
sim run 1s
sim restart
rabbitmqadmin queues list --columns name,durable,messages_ready
rabbitmqadmin exchanges list
rabbitmqadmin get messages --queue invoices --count 3 --ack-mode ack_requeue_true
```

Результат: до перезапуска в `invoices` три сообщения. После перезапуска:

```text
│ invoices │ true    │ 2              │
│ billing     │ direct  │ true    │
│ billing  │ paid        │ false       │ 9             │ invoice 1 │
│ billing  │ paid        │ false       │ 9             │ invoice 3 │
```

`invoice 2` пропал: он не был persistent. Exchange `drafts` исчез (его нет в списке), `billing` остался вместе с привязкой. Тем же способом можно проверить, что осталось: `queues list`, `exchanges list`, `bindings list`.

Теперь перезапуск без паузы:

```broker example
rabbitmqadmin queues declare --name quick --type classic --durable true
rabbitmqadmin publish message -k quick -m "fast 1" -p '{"delivery_mode":2}'
sim restart
rabbitmqadmin queues list --columns name,messages_ready
```

Результат:

```text
declared queue 'quick' in virtual host '/'
published the message
[sim] узел перезапущен: durable очереди и persistent сообщения восстановлены, остальное потеряно
┌──────────┬────────────────┐
│ name     │ messages_ready │
├──────────┼────────────────┤
│ invoices │ 2              │
│ quick    │ 0              │
│ stickers │ 0              │
└──────────┴────────────────┘
```

Очередь `stickers` подготовлена для задания этого урока, в примере она не участвует. Сообщение было persistent, очередь durable, но узел упал раньше, чем запись закончилась: `fast 1` потеряно. Это не ошибка модели: так выглядит окно между публикацией и записью на диск. Издателю знать, что запись завершена, помогают подтверждения (урок 3.4).

### Что переживает перезапуск

| Объект | Переживает перезапуск, если |
|---|---|
| очередь | durable |
| exchange | durable |
| привязка | и источник, и получатель пережили |
| сообщение | persistent, лежит в durable очереди и успело записаться |

Для сообщений, которые читал потребитель, но не подтвердил, действует другое правило: при перезапуске их возвращают в очередь, и они тоже подчиняются таблице.

### Сценарий с перезапуском

В сценарии падение и запуск узла задают отказы `broker.crash` и `broker.restart` с полем `at` (миллисекунды). Пример: заказы идут в durable очередь через durable exchange, узел падает и возвращается.

```scenario example
{
  "sim": "rabbit",
  "seed": 1,
  "durationMs": 4000,
  "setup": "rabbitmqadmin queues declare --name requests --type classic --durable true\nrabbitmqadmin exchanges declare --name front --type direct --durable true\nrabbitmqadmin bindings declare --source front --destination-type queue --destination requests --routing-key new",
  "actors": [
    { "id": "web", "kind": "producer", "rate": 10, "count": 8, "message": { "body": "request {n}", "exchange": "front", "routingKey": "new", "props": { "delivery_mode": 2 } }, "config": {} },
    { "id": "worker", "kind": "consumer", "queue": "requests", "processMs": 50, "config": { "auto_ack": false } }
  ],
  "faults": [
    { "at": 450, "kind": "broker.crash" },
    { "at": 500, "kind": "broker.restart" }
  ],
  "expect": [
    { "kind": "noLoss" },
    { "kind": "processedAtLeast", "actor": "worker", "count": 8, "byMs": 4000 }
  ]
}
```

В журнале появятся строки `Узел остановлен аварийно` и `Узел запущен`. Потребитель переподключается через секунду, получает недообработанное сообщение с `redelivered=true`, издатель продолжает публиковать, оба условия выполнены. Если бы `front` был не durable, после перезапуска издатель получил бы ошибку `404 NOT_FOUND — no exchange 'front'` и перестал публиковать.

### Частые ошибки

- **Ошибка:** durable очередь, но сообщения без `delivery_mode`. **Верно:** добавить `--properties '{"delivery_mode":2}'`, иначе после перезапуска очередь пуста.
- **Ошибка:** persistent сообщения, но exchange объявлен с `--durable false`. **Верно:** durable должны быть и exchange, иначе после перезапуска публикация падает с `404`.
- **Ошибка:** `sim restart` сразу после публикации и удивление, что persistent сообщение пропало. **Верно:** запись на диск занимает время; в песочнице сначала `sim run 1s`, в продакшене — подтверждения издателя.
- **Ошибка:** `queues declare --durable false` для «временной» очереди. **Результат:** `406 PRECONDITION_FAILED`. **Верно:** durable очередь с TTL (тема урока 4.1) или exclusive.

### Шпаргалка

- Выживает сообщение, которое persistent (`delivery_mode=2`) и лежит в durable очереди; exchange и привязки тоже должны быть durable.
- `publish message ... --properties '{"delivery_mode":2}'`.
- `queues declare --durable true`, `exchanges declare --durable true`.
- `sim run 1s` — продвинуть время; `sim restart` — перезапуск узла.
- В сценарии: `broker.crash`, `broker.restart`, `props.delivery_mode`.

## task rmq-survive-restart

```json
{
  "type": "console",
  "title": "Наклейки переживают перезапуск",
  "xp": 15,
  "hints": [
    "Разделы «Как сделать сообщение persistent» и «Перезапуск узла».",
    "Очередь уже durable. Нужны только свойства сообщений: persistent у нужных двух. Перед `sim restart` подвигайте время.",
    "Шаблон: `rabbitmqadmin publish message -k stickers -m \"sticker 1\" --properties '{\"delivery_mode\":…}'`, обычная публикация для черновика, `sim run 1s`, `sim restart`."
  ],
  "check": {
    "compare": ["messages"],
    "require": [
      { "pattern": "delivery_mode", "message": "Нужным сообщениям задайте delivery_mode равное 2" },
      { "pattern": "sim restart", "message": "Перезапустите узел командой sim restart" }
    ]
  }
}
```

Очередь `stickers` durable. Опубликуйте в неё через exchange по умолчанию три сообщения: `sticker 1`, `sticker 2`, `sticker 3`. Первое и третье нужны, второе — черновик. Затем перезапустите узел так, чтобы после перезапуска в очереди остались `sticker 1` и `sticker 3`. Перед перезапуском не забудьте дать брокеру время на запись.

```broker setup
rabbitmqadmin queues declare --name stickers --type classic --durable true
```

```broker starter
rabbitmqadmin publish message -k stickers -m "sticker 1" --properties '{"delivery_mode":…}'
```

```broker solution
rabbitmqadmin publish message -k stickers -m "sticker 1" --properties '{"delivery_mode":2}'
rabbitmqadmin publish message -k stickers -m "sticker 2"
rabbitmqadmin publish message -k stickers -m "sticker 3" --properties '{"delivery_mode":2}'
sim run 1s
sim restart
```

## task rmq-what-survives

```json
{
  "type": "choice",
  "title": "Что останется после перезапуска",
  "xp": 10,
  "hints": [
    "Раздел «Что переживает перезапуск».",
    "Проверьте оба условия для каждого сообщения: persistent ли оно и durable ли очередь.",
    "Выживает только сообщение, у которого выполнены оба условия."
  ],
  "options": [
    "Все четыре: брокер сам пишет всё на диск",
    "`A` (persistent, durable очередь) и `C` (persistent, durable очередь)",
    "`A` и `B`: достаточно, чтобы очередь была durable",
    "`A` и `D`: достаточно, чтобы сообщение было persistent"
  ],
  "answer": [1],
  "explanation": "Сообщение переживает перезапуск, если оно persistent и лежит в durable очереди. Это `A` и `C`. `B` лежит в durable очереди, но transient, поэтому пропадёт. `D` — persistent, но очередь не durable, и она исчезнет вместе с сообщением. Вариант «все четыре» неверен: на диск пишется только по запросу. Варианты с одним условием проверяют только половину правила."
}
```

В брокере две очереди: `durable-q` (durable) и `plain-q` (не durable; такую очередь объявили до обновления). Опубликованы четыре сообщения, каждое успело записаться на диск, если это положено. `A` — persistent в `durable-q`, `B` — transient в `durable-q`, `C` — persistent в `durable-q`, `D` — persistent в `plain-q`. Узел перезапустили. Какие сообщения останутся?

## task rmq-fix-exchange

```json
{
  "type": "scenario",
  "title": "После обновления заказы перестали идти",
  "xp": 25,
  "scenario": "w3-restart-exchange",
  "hints": [
    "Раздел «Сценарий с перезапуском»: что случается с не durable exchange.",
    "Сообщения persistent, очередь durable, а exchange `shop` после перезапуска пропадает, и издатель получает `404`. Exchange надо объявить заново как durable. Объявление с другими атрибутами даёт `406`, поэтому старый сначала удалите.",
    "Шаблон: `rabbitmqadmin exchanges delete --name shop`, `rabbitmqadmin exchanges declare --name shop --type direct --durable …`, затем привязка `rabbitmqadmin bindings declare --source … --destination-type queue --destination … --routing-key …`."
  ],
  "check": {}
}
```

Издатель `site` отправляет десять заказов (`order 1` … `order 10`) в exchange `shop` с ключом `new`, по десять в секунду, все заказы persistent. Очередь `orders` durable, её читает `warehouse`. На 450-й миллисекунде узел падает, на 500-й возвращается. После этого издатель получает `404 NOT_FOUND — no exchange 'shop'` и перестаёт публиковать: `warehouse` обрабатывает только пять заказов из десяти.

Исправьте настройки так, чтобы все десять заказов были обработаны к 4000-й миллисекунде. Правьте только брокер: exchange `shop` (тип `direct`) и его привязку к очереди `orders` с ключом `new`; очередь не трогайте. Сценарий запускается после ваших команд.

```broker starter
rabbitmqadmin exchanges delete --name shop
rabbitmqadmin exchanges declare --name shop --type direct --durable …
```

```broker solution
rabbitmqadmin exchanges delete --name shop
rabbitmqadmin exchanges declare --name shop --type direct --durable true
rabbitmqadmin bindings declare --source shop --destination-type queue --destination orders --routing-key new
```
