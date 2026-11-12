# Direct и fanout: точное совпадение и копия всем

Интернет-магазин публикует события заказа: «оплачен», «отменён», «отправлен». Склад должен узнавать об оплате и отмене, бухгалтерия — только об оплате, а об отправке пока не нужно знать никому. Все события идут в один exchange, а кто что получит, решают привязки. В этом уроке разберём два простейших типа exchange, `direct` и `fanout`, и то, как привязки могут пересекаться.

### Direct: ключ равен ключу

Exchange типа `direct` сравнивает ключ маршрутизации сообщения с ключом каждой привязки. Сообщение попадает в очереди, у которых ключ привязки в точности равен ключу сообщения.

```text
rabbitmqadmin bindings declare --source EXCHANGE --destination-type queue --destination ОЧЕРЕДЬ --routing-key КЛЮЧ
```

- `--source` — exchange `direct`, который будет сравнивать ключи.
- `--destination` — очередь, куда пойдёт сообщение при совпадении.
- `--routing-key` — ключ привязки. Сравнение точное: `paid` и `paid-ok` — разные ключи.

Привязок у одного exchange может быть сколько угодно, и они пересекаются двумя способами.

- Одна очередь, несколько ключей: две привязки с разными ключами к одной очереди. Очередь получает сообщения с любым из этих ключей.
- Один ключ, несколько очередей: две привязки с одним ключом к разным очередям. Каждая очередь получает свою копию сообщения.

Если ни одна привязка не подошла, сообщение отбрасывается без ошибки (особые случаи разберём в уроках 2.3 и 2.4).

Пример. Склад (`stock`) ждёт оплаты и отмены, бухгалтерия (`invoices`) только оплаты.

```broker example
rabbitmqadmin exchanges declare --name order-events --type direct --durable true
rabbitmqadmin queues declare --name invoices --type classic --durable true
rabbitmqadmin queues declare --name stock --type classic --durable true
rabbitmqadmin bindings declare --source order-events --destination-type queue --destination invoices --routing-key paid
rabbitmqadmin bindings declare --source order-events --destination-type queue --destination stock --routing-key paid
rabbitmqadmin bindings declare --source order-events --destination-type queue --destination stock --routing-key cancelled
rabbitmqadmin publish message --exchange order-events --routing-key paid --payload "order 11 paid"
rabbitmqadmin publish message --exchange order-events --routing-key cancelled --payload "order 12 cancelled"
rabbitmqadmin publish message --exchange order-events --routing-key shipped --payload "order 11 shipped"
rabbitmqadmin get messages --queue invoices --count 5
rabbitmqadmin get messages --queue stock --count 5
```

Результат публикаций и чтения (строки объявлений опущены, у таблиц показаны только столбцы `routing_key` и `payload`):

```text
published the message
published the message
published the message, but it was not routed to any queue
invoices:  paid       order 11 paid
stock:     paid       order 11 paid
           cancelled  order 12 cancelled
```

Событие `paid` пришло в обе очереди: ключ совпал с двумя привязками, и каждая очередь получила копию. Очередь `stock` получила два события по двум своим ключам. Ключ `shipped` не совпал ни с чем, и консоль лаборатории сообщила об этом: `published the message, but it was not routed to any queue`. Вывод у реального `rabbitmqadmin` может отличаться, поэтому результат всё равно проверяйте по очереди.

### Fanout: копия во все привязки

Exchange типа `fanout` не смотрит на ключ маршрутизации. Каждое сообщение уходит во все очереди, привязанные к нему. Ключ привязки не влияет на маршрут: при объявлении указывают пустую строку `""`, но любое значение сработает так же.

Пример. Рассылка акций уходит и в push-очередь, и в почтовую. Ключи сообщения и привязки ни на что не влияют.

```broker example
rabbitmqadmin exchanges declare --name notices --type fanout --durable true
rabbitmqadmin queues declare --name push --type classic --durable true
rabbitmqadmin queues declare --name mail --type classic --durable true
rabbitmqadmin bindings declare --source notices --destination-type queue --destination push --routing-key ""
rabbitmqadmin bindings declare --source notices --destination-type queue --destination mail --routing-key ignored
rabbitmqadmin publish message -e notices -k anything -m "sale starts"
rabbitmqadmin publish message -e notices -m "sale ends"
rabbitmqadmin get messages --queue push --count 5
rabbitmqadmin get messages --queue mail --count 5
```

Результат чтения (показаны `routing_key` и `payload`):

```text
push:  anything  sale starts
                 sale ends
mail:  anything  sale starts
                 sale ends
```

Обе очереди получили оба сообщения. Второе сообщение было опубликовано без ключа, но fanout это не остановило. Если привязать к fanout очередь, она будет получать всё без исключений.

### Привязка exchange к exchange

Получателем привязки может быть не очередь, а другой exchange: для этого `--destination-type exchange`. Сообщение, дойдя до такой привязки, продолжает путь через второй exchange по его правилам.

```text
rabbitmqadmin bindings declare --source ИСТОЧНИК --destination-type exchange --destination EXCHANGE --routing-key КЛЮЧ
```

Ключ привязки читает источник по правилам своего типа: у `fanout` он ни на что не влияет. Дальше сообщение сравнивается по ключам привязок второго exchange.

### Удаление привязки

```text
rabbitmqadmin bindings delete --source EXCHANGE --destination-type queue --destination ОЧЕРЕДЬ --routing-key КЛЮЧ
```

Те же четыре флага, что у `declare`, описывают привязку, которую нужно убрать. Ошибиться в ключе нельзя: должны совпасть все части привязки. Очередь и сообщения в ней остаются, пропадает только правило доставки.

Пример. Все события идут в `all-events` (fanout), оттуда в очередь `ledger` и в exchange `refund-events` (direct) с очередью `refunds`. Затем привязку между exchange удаляют.

```broker example
rabbitmqadmin exchanges declare --name all-events --type fanout --durable true
rabbitmqadmin exchanges declare --name refund-events --type direct --durable true
rabbitmqadmin queues declare --name ledger --type classic --durable true
rabbitmqadmin queues declare --name refunds --type classic --durable true
rabbitmqadmin bindings declare --source all-events --destination-type queue --destination ledger --routing-key ""
rabbitmqadmin bindings declare --source all-events --destination-type exchange --destination refund-events --routing-key ""
rabbitmqadmin bindings declare --source refund-events --destination-type queue --destination refunds --routing-key refund
rabbitmqadmin publish message -e all-events -k refund -m "refund 5"
rabbitmqadmin publish message -e all-events -k charge -m "charge 6"
rabbitmqadmin get messages --queue ledger --count 5
rabbitmqadmin get messages --queue refunds --count 5
rabbitmqadmin bindings delete --source all-events --destination-type exchange --destination refund-events --routing-key ""
rabbitmqadmin publish message -e all-events -k refund -m "refund 7"
rabbitmqadmin get messages --queue ledger --count 5
rabbitmqadmin get messages --queue refunds --count 5
```

Результат:

```text
declared exchange 'all-events' in virtual host '/'
declared exchange 'refund-events' in virtual host '/'
declared queue 'ledger' in virtual host '/'
declared queue 'refunds' in virtual host '/'
declared a binding from 'all-events' to queue 'ledger' with routing key '' in virtual host '/'
declared a binding from 'all-events' to exchange 'refund-events' with routing key '' in virtual host '/'
declared a binding from 'refund-events' to queue 'refunds' with routing key 'refund' in virtual host '/'
published the message
published the message
┌────────────┬─────────────┬─────────────┬───────────────┬──────────┐
│ exchange   │ routing_key │ redelivered │ payload_bytes │ payload  │
├────────────┼─────────────┼─────────────┼───────────────┼──────────┤
│ all-events │ refund      │ false       │ 8             │ refund 5 │
│ all-events │ charge      │ false       │ 8             │ charge 6 │
└────────────┴─────────────┴─────────────┴───────────────┴──────────┘
┌────────────┬─────────────┬─────────────┬───────────────┬──────────┐
│ exchange   │ routing_key │ redelivered │ payload_bytes │ payload  │
├────────────┼─────────────┼─────────────┼───────────────┼──────────┤
│ all-events │ refund      │ false       │ 8             │ refund 5 │
└────────────┴─────────────┴─────────────┴───────────────┴──────────┘
deleted a binding from 'all-events' to exchange 'refund-events' with routing key '' in virtual host '/'
published the message
┌────────────┬─────────────┬─────────────┬───────────────┬──────────┐
│ exchange   │ routing_key │ redelivered │ payload_bytes │ payload  │
├────────────┼─────────────┼─────────────┼───────────────┼──────────┤
│ all-events │ refund      │ false       │ 8             │ refund 7 │
└────────────┴─────────────┴─────────────┴───────────────┴──────────┘
┌──────────┬─────────────┬─────────────┬───────────────┬─────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload │
├──────────┼─────────────┼─────────────┼───────────────┼─────────┤
└──────────┴─────────────┴─────────────┴───────────────┴─────────┘
```

В столбце `exchange` стоит источник, из которого сообщение пришло в очередь, — здесь `all-events`. Последняя таблица без строк: очередь `refunds` пуста. Пока привязка между exchange была, сообщение `refund 5` дошло до `refunds` через `refund-events`, а `charge 6` там не нашёл ключа и остановился. После удаления привязки `refund 7` попал только в `ledger`.

### Как проверять результат

- `get messages --queue Q --count N` забирает и показывает сообщения. Подробности — в уроке 1.3.
- Строка `published the message, but it was not routed to any queue` означает, что ни одна очередь сообщение не получила.
- Задания-маршрутизации проверяют не команды, а то, какие сообщения окажутся в очередях после публикаций проверки.

### Частые ошибки

- **Ошибка:** привязать очередь к `direct` с ключом, не совпадающим с ключом издателя (`order.paid` и `paid`). Сообщения тихо отбрасываются. **Верно:** сверить ключи буква в букву и проверить результат публикацией.
- **Ошибка:** считать, что ключ привязки к `fanout` выбирает сообщения. Он не используется. **Верно:** чтобы получатели видели только часть сообщений, используйте `direct` (следующий урок — `topic`).
- **Ошибка:** удалить очередь, чтобы остановить доставку, хотя нужно было убрать привязку. Так пропадают и сообщения в ней. **Верно:** `bindings delete` с теми же флагами, что при создании.
- **Ошибка:** ждать одну копию, когда один ключ привязан к нескольким очередям. **Верно:** каждая подходящая очередь получает свою копию.

### Шпаргалка

- `direct`: ключ сообщения равен ключу привязки; несколько привязок с одним ключом — копия в каждую очередь.
- Одна очередь может иметь несколько привязок с разными ключами.
- `fanout`: ключ не учитывается, копия во все привязки.
- `--destination-type exchange` — привязка ведёт в другой exchange, путь сообщения продолжается там.
- `bindings delete` с флагами `--source`, `--destination-type`, `--destination`, `--routing-key` убирает привязку, очередь остаётся.
- Нет подходящей привязки — сообщение отбрасывается без ошибки.

## task rmq-support-bindings

```json
{
  "type": "topology",
  "title": "Две очереди поддержки",
  "xp": 10,
  "hints": [
    "Раздел «Direct: ключ равен ключу».",
    "Привязок три: одна очередь может получать два ключа, а один ключ может вести в две очереди. Каждая привязка — отдельная команда.",
    "Шаблон: `rabbitmqadmin bindings declare --source support --destination-type queue --destination … --routing-key …`, три раза."
  ],
  "check": {}
}
```

Служба поддержки получает обращения в exchange `support`. Подготовьте в vhost `/`:

- exchange `support` типа `direct`, durable;
- очереди `bugs` и `audit` типа `classic`, durable;
- привязки: `support` → `bugs` с ключом `bug`; `support` → `audit` с ключом `bug`; `support` → `audit` с ключом `crash`.

```broker starter
rabbitmqadmin exchanges declare --name support --type … --durable true
rabbitmqadmin queues declare --name … --type classic --durable true
rabbitmqadmin bindings declare --source support --destination-type queue --destination … --routing-key …
```

```broker solution
rabbitmqadmin exchanges declare --name support --type direct --durable true
rabbitmqadmin queues declare --name bugs --type classic --durable true
rabbitmqadmin queues declare --name audit --type classic --durable true
rabbitmqadmin bindings declare --source support --destination-type queue --destination bugs --routing-key bug
rabbitmqadmin bindings declare --source support --destination-type queue --destination audit --routing-key bug
rabbitmqadmin bindings declare --source support --destination-type queue --destination audit --routing-key crash
```

## task rmq-ticket-desk

```json
{
  "type": "routing",
  "title": "Сортировка обращений",
  "xp": 20,
  "hints": [
    "Раздел «Direct: ключ равен ключу»: пересечение привязок.",
    "Запишите для каждого ключа, в какие очереди он должен вести. Ключ `bug` ведёт в две очереди, очередь `questions` получает два разных ключа, а ключа `refund` не должно быть нигде.",
    "Шаблон: exchange `ticket-desk` типа `direct`, четыре очереди, затем по одной команде `bindings declare` на каждую пару «очередь — ключ»."
  ],
  "check": {
    "publish": [
      { "exchange": "ticket-desk", "routingKey": "bug", "body": "t-1" },
      { "exchange": "ticket-desk", "routingKey": "question", "body": "t-2" },
      { "exchange": "ticket-desk", "routingKey": "bug", "body": "t-3" },
      { "exchange": "ticket-desk", "routingKey": "invoice", "body": "t-4" },
      { "exchange": "ticket-desk", "routingKey": "faq", "body": "t-5" },
      { "exchange": "ticket-desk", "routingKey": "refund", "body": "t-6" }
    ]
  }
}
```

Сервис обращений публикует в exchange `ticket-desk` шесть сообщений с ключами `bug`, `question`, `bug`, `invoice`, `faq`, `refund` и телами `t-1` … `t-6` соответственно. Exchange и очередей пока нет. Создайте exchange `ticket-desk` типа `direct` и четыре очереди `bugs`, `audit`, `questions`, `billing-desk` (все durable, `classic`) и привязки так, чтобы:

- `bugs` и `audit` получили по копии `t-1` и `t-3`;
- `questions` получила `t-2` и `t-5`;
- `billing-desk` получила `t-4`;
- `t-6` не попало ни в одну очередь (проверка публикует с флагом `mandatory` и получит его обратно).

```broker starter
rabbitmqadmin exchanges declare --name ticket-desk --type … --durable true
rabbitmqadmin queues declare --name … --type classic --durable true
rabbitmqadmin bindings declare --source ticket-desk --destination-type queue --destination … --routing-key …
```

```broker solution
rabbitmqadmin exchanges declare --name ticket-desk --type direct --durable true
rabbitmqadmin queues declare --name bugs --type classic --durable true
rabbitmqadmin queues declare --name audit --type classic --durable true
rabbitmqadmin queues declare --name questions --type classic --durable true
rabbitmqadmin queues declare --name billing-desk --type classic --durable true
rabbitmqadmin bindings declare --source ticket-desk --destination-type queue --destination bugs --routing-key bug
rabbitmqadmin bindings declare --source ticket-desk --destination-type queue --destination audit --routing-key bug
rabbitmqadmin bindings declare --source ticket-desk --destination-type queue --destination questions --routing-key question
rabbitmqadmin bindings declare --source ticket-desk --destination-type queue --destination questions --routing-key faq
rabbitmqadmin bindings declare --source ticket-desk --destination-type queue --destination billing-desk --routing-key invoice
```

## task rmq-drop-legacy-app

```json
{
  "type": "console",
  "title": "Отключить старое приложение от рассылки",
  "xp": 20,
  "hints": [
    "Разделы «Удаление привязки» и «Fanout: копия во все привязки».",
    "Очередь `legacy` удалять нельзя: нужно убрать только её привязку к `news`, затем опубликовать два сообщения. Ключ привязки у fanout пустой.",
    "Шаблон: `rabbitmqadmin bindings delete --source news --destination-type queue --destination … --routing-key \"\"`, затем два раза `rabbitmqadmin publish message --exchange news --payload \"…\"`."
  ],
  "check": {
    "compare": ["bindings", "queues", "messages"],
    "require": [
      { "pattern": "bindings delete", "message": "Уберите привязку командой bindings delete" },
      { "pattern": "publish message", "message": "Опубликуйте новости командой publish message" }
    ]
  }
}
```

Exchange `news` (fanout) рассылает новости в очереди `site`, `mobile` и `legacy`. Приложение, читавшее `legacy`, выведено из эксплуатации. Уберите привязку `news` → `legacy` (очередь `legacy` остаётся) и затем опубликуйте в `news` два сообщения по порядку: `news 1`, `news 2`. Они должны оказаться в `site` и `mobile`, а `legacy` должна остаться пустой.

```broker setup
rabbitmqadmin exchanges declare --name news --type fanout --durable true
rabbitmqadmin queues declare --name site --type classic --durable true
rabbitmqadmin queues declare --name mobile --type classic --durable true
rabbitmqadmin queues declare --name legacy --type classic --durable true
rabbitmqadmin bindings declare --source news --destination-type queue --destination site --routing-key ""
rabbitmqadmin bindings declare --source news --destination-type queue --destination mobile --routing-key ""
rabbitmqadmin bindings declare --source news --destination-type queue --destination legacy --routing-key ""
```

```broker starter
rabbitmqadmin bindings delete --source news --destination-type queue --destination … --routing-key ""
```

```broker solution
rabbitmqadmin bindings delete --source news --destination-type queue --destination legacy --routing-key ""
rabbitmqadmin publish message --exchange news --payload "news 1"
rabbitmqadmin publish message --exchange news --payload "news 2"
```

## task rmq-count-copies

```json
{
  "type": "choice",
  "title": "Сколько копий получит событие",
  "xp": 10,
  "hints": [
    "Раздел «Direct: ключ равен ключу»: что происходит, когда ключ привязан к нескольким очередям.",
    "Пройдите по привязкам и отметьте те, у которых ключ равен `paid` буква в букву.",
    "Две привязки подходят, и они ведут в разные очереди. Сколько получится копий?"
  ],
  "options": [
    "Одна копия в `invoices`: direct выбирает первую подходящую очередь",
    "По одной копии в `invoices` и `stock`",
    "Две копии в `stock`, потому что очередь привязана дважды",
    "Ни одной: у direct на один ключ допустима только одна привязка"
  ],
  "answer": [1],
  "explanation": "Подходят привязки `invoices` по ключу `paid` и `stock` по ключу `paid`, а привязка `stock` по ключу `cancelled` не подходит. Direct отправляет сообщение во все очереди с совпавшим ключом, поэтому будет по одной копии в `invoices` и в `stock`. Первая «выигрывает» только в неверном представлении о direct: exchange не выбирает одну очередь. Две копии в `stock` невозможны: привязок с ключом `paid` у неё одна, а привязка по `cancelled` не совпадает. Ограничения «один ключ — одна привязка» нет."
}
```

Exchange `billing` типа `direct` имеет три привязки: очередь `invoices` с ключом `paid`, очередь `stock` с ключом `paid` и очередь `stock` с ключом `cancelled`. В `billing` публикуют одно сообщение с ключом `paid`. Что произойдёт?
