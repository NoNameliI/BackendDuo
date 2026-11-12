# Ack, nack, reject и requeue

Сервис возвратов читает из очереди заявки на возврат денег. Если банк не ответил по таймауту, заявку нельзя ни потерять, ни считать выполненной: её нужно отдать на повторную обработку. Если в заявке мусор, повторять бессмысленно. В RabbitMQ решение принимает потребитель, и у него для этого три команды: `ack`, `nack` и `reject`.

### Подтверждение и тег доставки

В уроке 1.1 вы видели два режима: автоматическое подтверждение (сообщение считается обработанным в момент доставки) и ручное (потребитель подтверждает сам, закончив работу). Дальше речь только о ручном режиме.

- Каждое выданное сообщение получает **тег доставки** (`tag`) — целый номер, который растёт с единицы. Тег принадлежит каналу: в другом канале то же сообщение получит другой номер.
- Пока сообщение не подтверждено, оно выдано (`messages_unacknowledged`), но остаётся у брокера.
- Подтверждать и отклонять можно только в том канале, который получил сообщение.

### Три ответа потребителя

- `ack` — «обработано»: сообщение удаляется из очереди.
- `nack` — «не смог обработать». Принимает флаг `requeue` и умеет работать с несколькими сообщениями сразу (`multiple`). Это расширение RabbitMQ.
- `reject` — то же, но только для одного сообщения.

Флаг `requeue` решает судьбу сообщения:

- `requeue=true` — сообщение возвращается в очередь на прежнее место по порядку, а не в хвост, с пометкой `redelivered=true`;
- `requeue=false` — если для очереди настроен dead-letter exchange, сообщение уйдёт в него (урок 4.1), иначе брокер его отбрасывает.

### Команды sim ack, sim nack и sim reject

```text
sim ack ТЕГ [--multiple]
sim nack ТЕГ [--multiple] [--requeue]
sim reject ТЕГ [--requeue]
```

- `ТЕГ` — номер из строки `[sim] tag=…`, которую печатает `sim consume`.
- `--multiple` — применить ответ ко всем неподтверждённым сообщениям до этого тега включительно. `sim ack 0 --multiple` подтверждает все.
- `--requeue` — вернуть сообщение в очередь. Без флага `nack` и `reject` отбрасывают сообщение.
- После команды песочница печатает сообщения, которые остались у потребителя, и новые, выданные освободившимся окном.
- Возвращённое сообщение выдаётся потребителю снова под **новым** тегом и с `redelivered=true`.

Пример. Три заказа, потребитель с окном 2. Первый вернём в очередь, второй отбросим, третий подтвердим.

```broker example
rabbitmqadmin queues declare --name orders --type classic --durable true
rabbitmqadmin publish message -k orders -m "order 1"
rabbitmqadmin publish message -k orders -m "order 2"
rabbitmqadmin publish message -k orders -m "order 3"
sim consume orders --prefetch 2
rabbitmqadmin queues list --columns name,messages_ready,messages_unacknowledged
sim nack 1 --requeue
sim reject 2
sim ack 3
sim ack 4
rabbitmqadmin queues list --columns name,messages_ready,messages_unacknowledged
```

Результат:

```text
declared queue 'orders' in virtual host '/'
published the message
published the message
published the message
[sim] потребитель amq.ctag-1 на очереди orders (prefetch=2, ручное подтверждение)
[sim] tag=1 queue=orders redelivered=false body=order 1
[sim] tag=2 queue=orders redelivered=false body=order 2
┌─────────┬────────────────┬─────────────────────────┐
│ name    │ messages_ready │ messages_unacknowledged │
├─────────┼────────────────┼─────────────────────────┤
│ orders  │ 1              │ 2                       │
│ refunds │ 3              │ 0                       │
└─────────┴────────────────┴─────────────────────────┘
[sim] tag=2 queue=orders redelivered=false body=order 2
[sim] tag=3 queue=orders redelivered=true body=order 1
[sim] tag=3 queue=orders redelivered=true body=order 1
[sim] tag=4 queue=orders redelivered=false body=order 3
[sim] tag=4 queue=orders redelivered=false body=order 3
[sim] нет неподтверждённых сообщений
┌─────────┬────────────────┬─────────────────────────┐
│ name    │ messages_ready │ messages_unacknowledged │
├─────────┼────────────────┼─────────────────────────┤
│ orders  │ 0              │ 0                       │
│ refunds │ 3              │ 0                       │
└─────────┴────────────────┴─────────────────────────┘
```

В таблицах есть и очередь `refunds`: она подготовлена для задания этого урока, в примере её сообщения не трогают. После каждой из команд `sim nack`, `sim reject` и `sim ack` консоль печатает те сообщения, которые у потребителя всё ещё не подтверждены. Поэтому строки между таблицами идут группами: после `nack 1` — теги 2 и 3, после `reject 2` — теги 3 и 4, после `ack 3` — тег 4, после `ack 4` — строка `нет неподтверждённых сообщений`.

Разберём. `order 1` вернулся на первое место и пришёл как тег 3 с `redelivered=true`. `order 2` отброшен: в очереди нет dead-letter exchange, поэтому он пропал. `order 3` пришёл тегом 4, когда освободилось место в окне. После `sim ack 3` и `sim ack 4` очередь пуста. Подтверждено две обработки из трёх, одна заявка потеряна намеренно.

Несколько сообщений одной командой:

```broker example
rabbitmqadmin queues declare --name shipments --type classic --durable true
rabbitmqadmin publish message -k shipments -m "shipment 1"
rabbitmqadmin publish message -k shipments -m "shipment 2"
rabbitmqadmin publish message -k shipments -m "shipment 3"
sim consume shipments --prefetch 3
sim ack 2 --multiple
rabbitmqadmin queues list --columns name,messages_ready,messages_unacknowledged
```

После `sim ack 2 --multiple` подтверждены теги 1 и 2, у потребителя остаётся тег 3, в списке `messages_unacknowledged` равно `1`.

### Ошибка с тегом закрывает канал

Подтверждение неизвестного или уже подтверждённого тега — ошибка канала:

```text
Error: 406 PRECONDITION_FAILED - unknown delivery tag 3
```

Канал после этого закрывается. А при закрытии канала все неподтверждённые сообщения возвращаются в очередь с `redelivered=true`. То же происходит, если потребитель упал. Отмена подписки сама по себе выданные сообщения не возвращает: их возвращает только закрытие канала.

### Ошибка обработчика в сценарии

В сценариях потребитель может ошибаться. Поле участника `failEveryN: N` означает, что каждая N-я попытка обработки заканчивается ошибкой. Что делает потребитель при ошибке, задаёт свойство `on_error`:

- `requeue` (по умолчанию) — `nack` с возвратом в очередь;
- `nack-drop` и `reject-drop` — отклонить без возврата;
- `ack` — подтвердить, как будто ничего не случилось.

Пример сценария. Потребитель `pusher` рассылает уведомления, каждая вторая попытка заканчивается ошибкой, ошибку он решает возвратом в очередь.

```scenario example
{
  "sim": "rabbit",
  "seed": 1,
  "durationMs": 3000,
  "setup": "rabbitmqadmin queues declare --name notices --type classic --durable true",
  "actors": [
    { "id": "app", "kind": "producer", "rate": 10, "count": 4, "message": { "body": "notice {n}", "exchange": "", "routingKey": "notices" }, "config": {} },
    { "id": "pusher", "kind": "consumer", "queue": "notices", "processMs": 100, "failEveryN": 2, "config": { "auto_ack": false, "on_error": "requeue" } }
  ],
  "faults": [],
  "expect": [
    { "kind": "noLoss" },
    { "kind": "processedAtLeast", "actor": "pusher", "count": 4, "byMs": 3000 }
  ]
}
```

Журнал для `app-2`:

```text
200   error    pusher  pusher: ошибка при обработке app-2
200   nack     pusher  pusher вернул app-2 в очередь (nack, requeue=true)
200   requeue  pusher  app-2 вернулось в очередь notices (redelivered=true)
300   process  pusher  pusher обработал app-2
300   ack      pusher  pusher подтвердил app-2 (тег 3)
```

Итог: `noLoss` выполнено, `processedAtLeast` выполнено («pusher: обработано 4»). Если задать `pusher.on_error=nack-drop`, брокер потеряет `app-2` и `app-4`: «Потеряно сообщений: 2». Если задать `pusher.on_error=ack`, потерь в журнале нет, но обработано только 2 из 4: ошибочные сообщения подтверждены без обработки. Это самый коварный вариант, потому что тихо.

### Возврат без конца

Если сообщение «ядовитое» (любая попытка заканчивается ошибкой), а потребитель всегда возвращает его в очередь, оно крутится по кругу и занимает потребителя. Документация RabbitMQ предупреждает об этом. Песочница не показывает такой цикл: `failEveryN` ошибается по счёту попыток, а не из-за конкретного сообщения. Лекарство — ограничить число повторов и убирать такие сообщения в dead-letter очередь, это тема урока 4.1.

### Частые ошибки

- **Ошибка:** `sim ack 3` второй раз для того же тега. **Результат:** `406 PRECONDITION_FAILED - unknown delivery tag`, канал закрыт, остальные неподтверждённые вернулись в очередь. **Верно:** подтверждать каждый тег один раз.
- **Ошибка:** `sim nack 2` и ожидание, что сообщение вернётся. **Верно:** без `--requeue` сообщение отбрасывается. Возврат включается флагом.
- **Ошибка:** подтверждать сообщение, которое не удалось обработать, чтобы «очистить очередь». **Верно:** `ack` только после успешной работы; при временной ошибке — возврат, при безнадёжном сообщении — отбрасывание или dead-letter.
- **Ошибка:** искать возвращённое сообщение по старому тегу. **Верно:** после возврата выдаётся новый тег.

### Шпаргалка

- `ack` — обработано; `nack`/`reject` — не обработано; `--requeue` возвращает в очередь с `redelivered=true`.
- Без `--requeue` сообщение отбрасывается (или уходит в dead-letter exchange, если он задан).
- `--multiple` действует на все теги до указанного; тег `0` с ним — все.
- Тег принадлежит каналу; повторный `ack` — `406`, канал закрывается, неподтверждённые возвращаются.
- Сценарий: `failEveryN` — ошибка каждой N-й попытки, `on_error` — `requeue`, `nack-drop`, `reject-drop`, `ack`.

## task rmq-settle-three

```json
{
  "type": "console",
  "title": "Три заявки на возврат",
  "xp": 15,
  "hints": [
    "Раздел «Команды sim ack, sim nack и sim reject». Сначала подключите потребителя, потом отвечайте по тегам.",
    "Теги идут с единицы в порядке выдачи. Первую заявку подтвердите, вторую верните в очередь (`--requeue`), третью отбросьте без возврата.",
    "Шаблон: `sim consume refunds --prefetch 3`, затем `sim ack …`, `sim nack … --requeue`, `sim reject …`."
  ],
  "check": {
    "compare": ["messages"],
    "require": [
      { "pattern": "sim (nack|reject) 2 .*--requeue", "message": "Заявку 2 нужно вернуть в очередь: добавьте --requeue" },
      { "pattern": "sim (nack|reject) 3\\s*$", "message": "Заявку 3 нужно отбросить без возврата командой nack или reject без --requeue" }
    ]
  }
}
```

В очереди `refunds` три заявки: `refund 1`, `refund 2`, `refund 3`. Подключите потребителя с окном 3 и разберитесь с ними. `refund 1` обработана успешно. С `refund 2` банк не ответил по таймауту, её нужно вернуть в очередь. `refund 3` повреждена, повторять её не нужно, но и считать обработанной нельзя: отбросьте её.

```broker setup
rabbitmqadmin queues declare --name refunds --type classic --durable true
rabbitmqadmin publish message -k refunds -m "refund 1"
rabbitmqadmin publish message -k refunds -m "refund 2"
rabbitmqadmin publish message -k refunds -m "refund 3"
```

```broker starter
sim consume refunds --prefetch 3
sim ack …
```

```broker solution
sim consume refunds --prefetch 3
sim ack 1
sim nack 2 --requeue
sim reject 3
```

## task rmq-which-answer

```json
{
  "type": "choice",
  "title": "Как ответить на сбой",
  "xp": 10,
  "hints": [
    "Раздел «Три ответа потребителя».",
    "Спросите себя: повторная попытка может помочь или нет? Если нет, возвращать сообщение бессмысленно.",
    "Временная ошибка лечится повтором, поэтому сообщение нужно вернуть в очередь и не подтверждать."
  ],
  "options": [
    "`ack`: сообщение уйдёт из очереди, а сервис записи в базу потом разберётся",
    "`nack` с возвратом в очередь: база скоро вернётся, и повторная попытка может пройти",
    "`reject` без возврата: пусть сообщение пропадёт, платёж отправят ещё раз",
    "Ничего не отвечать и держать сообщение выданным сколько угодно"
  ],
  "answer": [1],
  "explanation": "База временно недоступна, поэтому обработка не удалась, но сообщение само по себе корректно. Его нужно вернуть (`nack` или `reject` с возвратом), чтобы позже обработать. `ack` сообщил бы брокеру, что платёж записан, и он был бы потерян. `reject` без возврата отбрасывает платёж безвозвратно, без dead-letter exchange никто о нём не узнает. Молчание держит сообщение в `messages_unacknowledged` и не даёт никому другому его обработать; при закрытии канала оно вернётся само, но это не способ управления."
}
```

Сервис платежей читает сообщение «списать 500 рублей» и пытается записать результат в базу. База не отвечает: админы перезапускают её, обычно это занимает полминуты. Что сделать с этим сообщением?

## task rmq-ack-batch

```json
{
  "type": "console",
  "title": "Пять этикеток одной командой",
  "xp": 15,
  "hints": [
    "Раздел «Команды sim ack, sim nack и sim reject»: флаг `--multiple`.",
    "Подтвердить все теги с первого по пятый можно одной командой, указав последний тег и `--multiple`. Шестую верните в очередь.",
    "Шаблон: `sim consume labels --prefetch 6`, `sim ack … --multiple`, `sim nack … --requeue`."
  ],
  "check": {
    "compare": ["messages"],
    "require": [
      { "pattern": "sim ack \\d+ --multiple", "message": "Подтвердите пять сообщений одной командой с --multiple" }
    ]
  }
}
```

В очереди `labels` шесть заданий печати: `label 1` … `label 6`. Подключите потребителя с окном 6. Первые пять напечатаны, подтвердите их одной командой. Шестая не напечаталась из-за замятия бумаги: верните её в очередь.

```broker setup
rabbitmqadmin queues declare --name labels --type classic --durable true
rabbitmqadmin publish message -k labels -m "label 1"
rabbitmqadmin publish message -k labels -m "label 2"
rabbitmqadmin publish message -k labels -m "label 3"
rabbitmqadmin publish message -k labels -m "label 4"
rabbitmqadmin publish message -k labels -m "label 5"
rabbitmqadmin publish message -k labels -m "label 6"
```

```broker starter
sim consume labels --prefetch 6
sim ack … --multiple
```

```broker solution
sim consume labels --prefetch 6
sim ack 5 --multiple
sim nack 6 --requeue
```

## task rmq-refund-swallow

```json
{
  "type": "scenario",
  "title": "Возвраты тихо пропадают",
  "xp": 25,
  "scenario": "w3-ack-swallow",
  "hints": [
    "Раздел «Ошибка обработчика в сценарии»: что делает потребитель при ошибке.",
    "Потерь в журнале нет, но обработаны не все заявки: ошибочные подтверждены без обработки. Нужно, чтобы при ошибке сообщение возвращалось в очередь. За это отвечает `on_error`.",
    "В окне свойств замените значение: `refunder.on_error=…` (`requeue`, `nack-drop`, `reject-drop` или `ack`)."
  ],
  "check": {}
}
```

Издатель `bank-api` отправляет в очередь `refunds` шесть заявок (`refund 1` … `refund 6`), по десять в секунду. Потребитель `refunder` обрабатывает каждую 100 мс, и каждая третья попытка обработки заканчивается ошибкой. Сейчас он при ошибке подтверждает сообщение, поэтому две заявки считаются выполненными, хотя не обработаны: к 4000-й миллисекунде обработано только 4 из 6.

Измените настройку потребителя в окне свойств так, чтобы ни одна заявка не пропала и все шесть были обработаны к 4000-й миллисекунде. Править нужно только свойства.

```properties starter
# что делать при ошибке обработки: requeue, nack-drop, reject-drop или ack
refunder.on_error=ack
```

```properties solution
refunder.on_error=requeue
```
