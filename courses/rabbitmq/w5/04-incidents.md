# Инциденты: очередь растёт

Дежурному приходит оповещение: очередь растёт, и срок обработки заказов под угрозой. Ему нужно за несколько минут найти причину и вернуть систему в норму. В этом уроке вы разберёте три таких инцидента. В каждом дан сценарий, который нарушает условие, и описано, что наблюдается и какой срок обещан бизнесом. Вы меняете настройки так, чтобы условие выполнилось.

### Порядок разбора

1. Посмотрите на числа очереди: `messages_ready`, `messages_unacknowledged`, `consumers`. Таблица причин — в уроке про метрики.
2. Откройте журнал прогона. Ошибки подписки, отказы `403`, возвраты сообщений и dead-letter видны в нём построчно.
3. Сформулируйте одну гипотезу и сделайте одно изменение. Затем проверьте: выполнилось ли условие.

Условия, которые проверяет сценарий, перечислены в формулировке задания: срок обработки, предел длины очереди, число сообщений в dead-letter queue (DLQ).

### Свойства участников в сценариях

В заданиях этого урока вы увидите настройки участников сценария. Что означает каждая:

- `on_error` у потребителя — что он делает при ошибке обработки: `requeue` (по умолчанию), `nack-drop`, `reject-drop` или `ack`. Подробно — в уроке 3.1. Напомним главное: `nack-drop` и `reject-drop` отклоняют сообщение без возврата, и оно уходит в dead-letter exchange очереди, если он задан, иначе пропадает; `ack` молча теряет неудачное сообщение.
- `failEveryN` у потребителя в сценарии — сбой каждой N-й попытки обработки (урок 3.1). Это часть сценария, вы её не меняете.
- Свойства задаются строками `участник.ключ=значение`, как `printer.on_error=nack-drop`. Строки с `#` — комментарии.

### Пересоздание очереди с новыми аргументами

Напоминание из мира про надёжность и мира про TTL и dead-letter: аргументы очереди (`x-dead-letter-exchange`, `x-max-length`) задаются при объявлении, а повторное объявление с другими аргументами отклоняется ошибкой `406 PRECONDITION_FAILED`. Чтобы изменить аргументы, пустую очередь удаляют и объявляют заново:

```text
rabbitmqadmin queues delete --name очередь
rabbitmqadmin queues declare --name очередь --type classic --durable true --arguments '{"ключ":значение}'
```

- Аргументы передаются одной строкой JSON в одинарных кавычках: `--arguments '{"x-max-length":3}'`.
- Удаляйте очередь, пока в ней нечего терять: в сценарии это делает команда до начала прогона, и очередь ещё пуста.
- Порядок важен: сначала exchange для dead-letter и очередь DLQ с привязкой, потом основная очередь с аргументом.

Пример: очередь на три сообщения с dead-letter exchange. Лишние сообщения вытесняются с головы очереди (`drop-head`, поведение по умолчанию) и уходят в `lab-dead`:

```broker example
rabbitmqadmin exchanges declare --name lab-dlx --type fanout --durable true
rabbitmqadmin queues declare --name lab-dead --type classic --durable true
rabbitmqadmin bindings declare --source lab-dlx --destination-type queue --destination lab-dead --routing-key ""
rabbitmqadmin queues declare --name lab-events --type classic --durable true --arguments '{"x-max-length":3,"x-dead-letter-exchange":"lab-dlx"}'
rabbitmqadmin publish message --routing-key lab-events --payload "event 1"
rabbitmqadmin publish message --routing-key lab-events --payload "event 2"
rabbitmqadmin publish message --routing-key lab-events --payload "event 3"
rabbitmqadmin publish message --routing-key lab-events --payload "event 4"
rabbitmqadmin publish message --routing-key lab-events --payload "event 5"
rabbitmqctl list_queues name messages_ready
```

```text
declared exchange 'lab-dlx' in virtual host '/'
declared queue 'lab-dead' in virtual host '/'
declared a binding from 'lab-dlx' to queue 'lab-dead' with routing key '' in virtual host '/'
declared queue 'lab-events' in virtual host '/'
published the message
published the message
published the message
published the message
published the message
name	messages_ready
lab-dead	2
lab-events	3
```

В `lab-events` остались три последних сообщения, `event 1` и `event 2` лежат в `lab-dead`. Лимит `x-max-length` считает только готовые сообщения. Без `x-dead-letter-exchange` вытесненные сообщения пропали бы.

В песочнице вытеснение по лимиту записывается в журнале как `drop`, даже если сообщение ушло в dead-letter. Поэтому условие `noLoss` для таких очередей не применяется: вместо него проверяется, что DLQ получила сообщения (`dlqContains`).

### Возврат по кругу и DLQ

Если потребитель при ошибке возвращает сообщение в очередь, а ошибка не пройдёт сама, сообщение выдаётся снова и снова. Потребитель тратит время на заведомо неудачные попытки, остальные ждут. Сообщение, которое нельзя обработать, лучше отклонить без возврата в очередь с dead-letter exchange. Тогда оно попадёт в DLQ и его можно разобрать отдельно.

Пример: счётчик шлёт показания по 20 в секунду, табло обрабатывает 10 в секунду. Очередь `readings` ограничена пятью сообщениями и имеет dead-letter exchange, поэтому вытесненные показания попадают в `readings-old`.

```scenario example
{
  "sim": "rabbit",
  "seed": 1,
  "durationMs": 3000,
  "setup": "rabbitmqadmin exchanges declare --name readings-dlx --type fanout --durable true\nrabbitmqadmin queues declare --name readings-old --type classic --durable true\nrabbitmqadmin bindings declare --source readings-dlx --destination-type queue --destination readings-old --routing-key \"\"\nrabbitmqadmin queues declare --name readings --type classic --durable true --arguments '{\"x-max-length\":5,\"x-dead-letter-exchange\":\"readings-dlx\"}'",
  "actors": [
    { "id": "meter", "kind": "producer", "rate": 20, "count": 20, "message": { "body": "reading {n}", "exchange": "", "routingKey": "readings" }, "config": {} },
    { "id": "panel", "kind": "consumer", "queue": "readings", "processMs": 100, "config": { "auto_ack": false, "prefetch_count": 1 } }
  ],
  "faults": [],
  "expect": [
    { "kind": "depthBelow", "queue": "readings", "value": 5, "byMs": 0 },
    { "kind": "dlqContains", "queue": "readings-old", "reason": "maxlen", "count": 1 },
    { "kind": "processedAtLeast", "actor": "panel", "count": 5, "byMs": 3000 }
  ]
}
```

Результат: в `readings` никогда не больше пяти готовых сообщений, в `readings-old` оказались пять вытесненных показаний с причиной `maxlen`, `panel` обработал 15 показаний.

Отдельный случай — сбой обработки. Потребитель, который при ошибке возвращает сообщение в очередь, получает его снова. Если ошибка не проходит сама, потребитель тратит время на заведомо неудачные попытки. Такое сообщение отклоняют без возврата (`on_error` = `nack-drop`), и оно уходит в DLQ. Этот приём вы примените во втором инциденте.

### Права и «тихий» потребитель

Если потребитель получил `403 ACCESS_REFUSED` при подписке, он не подписывается, и очередь только растёт. В журнале это строка «не удалось подписаться». Проверьте право `read` на очередь у пользователя потребителя. Как задать права, написано в уроке про vhost.

### Частые ошибки

- **Ошибка:** менять `on_error` на `nack-drop` без dead-letter exchange. **Верно:** сначала пересоздайте очередь с `x-dead-letter-exchange`. Иначе сообщения пропадут, а не уйдут в DLQ.
- **Ошибка:** задать `x-max-length` без `x-dead-letter-exchange`. **Верно:** задавайте оба аргумента, иначе очередь короткая, но вытесненные сообщения потеряны.
- **Ошибка:** объявлять очередь с новыми аргументами, не удалив прежнюю. **Верно:** сначала `queues delete`, иначе `406 PRECONDITION_FAILED`.
- **Ошибка:** выдать потребителю `write` вместо `read`. **Верно:** для подписки нужен `read`, иначе подписка отклонена.

### Шпаргалка

- Числа очереди → гипотеза → одна правка → проверка условий.
- `rabbitmqctl set_permissions -p vhost пользователь configure write read` — потребителю нужен `read` на очередь.
- `on_error`: без значения — возврат в очередь; `nack-drop` и `reject-drop` — без возврата (в DLQ, если есть DLX); `ack` — потеря.
- Изменить аргументы: `queues delete`, затем `queues declare … --arguments '{…}'`; сначала DLX и DLQ.
- `x-max-length` + `x-dead-letter-exchange` — предел длины без молчаливой потери.

## task rmq-inc-diagnose

```json
{
  "type": "choice",
  "title": "Что проверить первым",
  "xp": 10,
  "hints": [
    "Раздел «Порядок разбора».",
    "Нужно отличить «никто не читает» от «читают, но медленно». Какое число очереди это показывает?",
    "Число потребителей: `consumers`."
  ],
  "options": [
    "Столбец `consumers`: если он равен нулю, очередь никто не читает, и причину ищут в подписке и правах",
    "Перезапустить брокер: очередь после перезапуска очистится сама",
    "Увеличить `x-max-length`, чтобы очередь поместилась",
    "Выдать издателю права `read`, чтобы он видел очередь"
  ],
  "answer": [0],
  "explanation": "Первое различие в разборе: очередь не читают вовсе или читают, но не успевают. Оно видно по `consumers`. Нулевое значение направляет к подписке: потребитель упал или не получил права `read`. Перезапуск не чинит причину, а сообщения durable очереди переживут его. Увеличение лимита лишь отодвигает проблему. Издателю права на чтение не нужны: ему нужен `write` на exchange."
}
```

Очередь заказов растёт, а на мониторинге `messages_ready` увеличивается каждую минуту. Какую проверку сделать первой?

## task rmq-inc-access

```json
{
  "type": "scenario",
  "title": "Инцидент 1: упаковщик молчит",
  "xp": 20,
  "scenario": "w5-inc-access",
  "hints": [
    "Раздел «Права и «тихий» потребитель» и урок про vhost и права.",
    "В журнале прогона найдите строку «не удалось подписаться». Какое право проверяется при подписке и какое у `packer` сейчас?",
    "Шаблон: `rabbitmqctl set_permissions -p shop packer \"…\" \"…\" \"…\"`: `read` должен подойти к имени очереди `packing`."
  ],
  "check": {}
}
```

В vhost `shop` сервис `web` публикует заказы в exchange `orders`, ключ `pack` ведёт в очередь `packing`, а очередь читает сервис `packer`. Наблюдается: очередь `packing` растёт, `packer` не обработал ни одного заказа. Обещано: к 3000 мс в очереди не больше двух готовых сообщений, к 4000 мс `packer` обработал все 20 заказов. Исправьте права так, чтобы `packer` мог читать очередь. Права `guest` в vhost `shop` выданы.

```broker starter
rabbitmqctl set_permissions -p shop packer "…" "…" "…"
```

```broker solution
rabbitmqctl set_permissions -p shop packer "" "" "^packing$"
```

## task rmq-inc-requeue

```json
{
  "type": "scenario",
  "title": "Инцидент 2: счета ходят по кругу",
  "xp": 25,
  "scenario": "w5-inc-requeue",
  "hints": [
    "Разделы «Пересоздание очереди с новыми аргументами» и «Возврат по кругу и DLQ».",
    "Нужны две правки: очередь должна уметь отправлять отклонённые сообщения в DLQ, а потребитель должен отклонять их без возврата.",
    "Шаблон: удалить `invoices`; exchange `invoices-dlx` (fanout) и очередь `invoices-dead` с привязкой; `invoices` заново с `--arguments '{\"x-dead-letter-exchange\":\"…\"}'`; свойство `printer.on_error=…`."
  ],
  "check": {}
}
```

Сервис `billing` публикует счета в очередь `invoices`, потребитель `printer` печатает их. Каждая третья попытка печати завершается ошибкой, и потребитель по умолчанию возвращает сообщение в очередь. Наблюдается: очередь растёт до 17 сообщений, `printer` крутится на повторных попытках. Обещано: к 3000 мс очередь `invoices` пуста, `printer` обработал не меньше 20 счетов, а все 10 неудачных счетов лежат в очереди `invoices-dead` для разбора, и ничего не потеряно. Очередь `invoices` сейчас объявлена без dead-letter exchange.

```broker starter
# удалите invoices и объявите её заново с dead-letter exchange
```

```properties starter
printer.on_error=…
```

```broker solution
rabbitmqadmin queues delete --name invoices
rabbitmqadmin exchanges declare --name invoices-dlx --type fanout --durable true
rabbitmqadmin queues declare --name invoices-dead --type classic --durable true
rabbitmqadmin bindings declare --source invoices-dlx --destination-type queue --destination invoices-dead --routing-key ""
rabbitmqadmin queues declare --name invoices --type classic --durable true --arguments '{"x-dead-letter-exchange":"invoices-dlx"}'
```

```properties solution
printer.on_error=nack-drop
```

## task rmq-inc-backlog

```json
{
  "type": "scenario",
  "title": "Инцидент 3: телеметрия растёт без предела",
  "xp": 25,
  "scenario": "w5-inc-backlog",
  "hints": [
    "Раздел «Пересоздание очереди с новыми аргументами»: там пример с `x-max-length` и dead-letter exchange.",
    "Два аргумента очереди: предел длины и dead-letter exchange, чтобы вытесненные сообщения не пропали. Очередь надо пересоздать.",
    "Шаблон: удалить `telemetry`; exchange `telemetry-dlx` (fanout), очередь `telemetry-overflow` и привязка с ключом `\"\"`; `telemetry` заново с `--arguments '{\"x-max-length\":…,\"x-dead-letter-exchange\":\"…\"}'`."
  ],
  "check": {}
}
```

Датчики (`sensors`) шлют показания в очередь `telemetry` по 40 в секунду, а `dashboard` обрабатывает 10 в секунду. Наблюдается: очередь растёт без предела, к концу сценария в ней около 60 сообщений, и брокер приближается к alarm. Обещано: после первых 300 мс в очереди `telemetry` не больше 20 готовых сообщений; все вытесненные по лимиту сообщения лежат в очереди `telemetry-overflow` (не меньше 30); `dashboard` обработал не меньше 20 показаний. Устаревшие показания разбирать необязательно, но терять их молча нельзя.

```broker starter
# удалите telemetry и объявите её заново с лимитом длины и dead-letter exchange
```

```broker solution
rabbitmqadmin queues delete --name telemetry
rabbitmqadmin exchanges declare --name telemetry-dlx --type fanout --durable true
rabbitmqadmin queues declare --name telemetry-overflow --type classic --durable true
rabbitmqadmin bindings declare --source telemetry-dlx --destination-type queue --destination telemetry-overflow --routing-key ""
rabbitmqadmin queues declare --name telemetry --type classic --durable true --arguments '{"x-max-length":20,"x-dead-letter-exchange":"telemetry-dlx"}'
```
