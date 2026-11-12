# RPC, quorum-очереди и streams

Интерфейс магазина просит у сервиса курсов валют пересчёт суммы и ждёт ответ. Это вопрос с ответом, а не событие, но делать его через очередь тоже можно. Другая забота: платёж, который потребитель не может обработать, не должен крутиться вечно. Третья: аналитике нужно много раз перечитывать вчерашние события, а обычная очередь после чтения их удаляет. В уроке три темы: RPC поверх очередей, quorum-очереди и streams.

### RPC через очереди

Схема запрос–ответ из урока про три способа общения строится на двух свойствах сообщения.

- `reply_to` — имя очереди, куда сервер должен прислать ответ.
- `correlation_id` — идентификатор запроса. Сервер копирует его в ответ, и клиент по нему понимает, на какой запрос пришёл ответ.

Клиент объявляет свою очередь ответов, публикует запрос с `reply_to` и `correlation_id`, затем ждёт ответ в очереди ответов. Сервер читает запрос и публикует ответ через exchange по умолчанию: ключом служит значение `reply_to`, то есть имя очереди ответов.

```broker example
rabbitmqadmin queues declare --name rpc.convert --type classic --durable true
rabbitmqadmin queues declare --name rpc.reply.web-1 --type classic --durable true
rabbitmqadmin publish message --routing-key rpc.convert --payload "usd:100" --properties '{"reply_to": "rpc.reply.web-1", "correlation_id": "req-1"}'
rabbitmqadmin get messages --queue rpc.convert
rabbitmqadmin publish message --routing-key rpc.reply.web-1 --payload "eur:92" --properties '{"correlation_id": "req-1"}'
rabbitmqadmin get messages --queue rpc.reply.web-1
```

Результат:

```text
declared queue 'rpc.convert' in virtual host '/'
declared queue 'rpc.reply.web-1' in virtual host '/'
published the message
┌──────────┬─────────────┬─────────────┬───────────────┬─────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload │
├──────────┼─────────────┼─────────────┼───────────────┼─────────┤
│          │ rpc.convert │ false       │ 7             │ usd:100 │
└──────────┴─────────────┴─────────────┴───────────────┴─────────┘
published the message
┌──────────┬─────────────────┬─────────────┬───────────────┬─────────┐
│ exchange │ routing_key     │ redelivered │ payload_bytes │ payload │
├──────────┼─────────────────┼─────────────┼───────────────┼─────────┤
│          │ rpc.reply.web-1 │ false       │ 6             │ eur:92  │
└──────────┴─────────────────┴─────────────┴───────────────┴─────────┘
```

Сервер взял запрос из `rpc.convert` и отправил ответ с ключом `rpc.reply.web-1`. Клиент забирает его из своей очереди. В настоящем коде клиент сверяет `correlation_id` ответа со своим запросом: в очередь ответов могут прийти запоздавшие ответы на прошлые запросы, и их нельзя принимать за текущие.

Есть и вариант без объявления очереди ответов: direct reply-to. Клиент подписывается на псевдоочередь `amq.rabbitmq.reply-to` в режиме автоподтверждения, публикует запрос с `reply_to` равным этому имени (брокер сам подставит сквозное имя), а сервер отвечает через exchange по умолчанию на то имя, которое получил. Запрос и подписку нужно вести на одном канале. Если клиента уже нет, ответ отбрасывается без ошибки, даже с флагом `mandatory`. Песочница этого режима не выполняет: он остаётся теорией.

Ответ поверх очереди может не прийти: сервер упал или завис. Клиенту нужен собственный тайм-аут и решение, что делать при его истечении.

### Quorum-очереди

Quorum-очередь — тип очереди, рассчитанный на надёжность: данные реплицируются на несколько узлов, подтверждение издателю идёт после того, как их принял кворум. Тип выбирается при объявлении и потом не меняется.

```text
rabbitmqadmin queues declare --name ИМЯ --type quorum --durable true
```

- `--type quorum` вместо `classic`.
- Quorum-очередь всегда durable и не бывает exclusive. Попытка объявить иначе — ошибка 406.
- Повторное объявление с другим типом тоже даёт 406: тип нельзя изменить.

```broker example
rabbitmqadmin queues declare --name ledger --type quorum --durable true
rabbitmqadmin queues list --columns name,queue_type,messages_ready
```

```text
declared queue 'ledger' in virtual host '/'
┌─────────────────┬────────────┬────────────────┐
│ name            │ queue_type │ messages_ready │
├─────────────────┼────────────┼────────────────┤
│ ledger          │ quorum     │ 0              │
│ rpc.convert     │ classic    │ 0              │
│ rpc.reply.web-1 │ classic    │ 0              │
└─────────────────┴────────────┴────────────────┘
```

В списке есть и очереди предыдущего примера. Очередь `ledger` имеет тип `quorum`, остальные — `classic`.

Ошибки при неверном объявлении (в примере их нельзя запускать, потому что команда завершилась бы с ошибкой):

```text
rabbitmqadmin queues declare --name q4 --type quorum --durable false
Error: 406 PRECONDITION_FAILED - quorum queue 'q4' must be durable and not exclusive

rabbitmqadmin queues declare --name ledger --type classic --durable true
Error: 406 PRECONDITION_FAILED - inequivalent arg 'x-queue-type' for queue 'ledger' in vhost '/': received 'classic' but current is 'quorum'
```

Песочница воспроизводит из особенностей quorum-очередей три.

**Лимит доставок.** У quorum-очереди есть защита от «ядовитых» сообщений: счётчик неудачных доставок. По умолчанию (с версии 4.0) лимит равен 20. Каждое сообщение, которое возвращали в очередь (`nack` или `reject` с `requeue=true`, падение потребителя), получает заголовок `x-delivery-count` с числом неудачных попыток. Когда сообщение превышает лимит, оно уходит в dead-letter с причиной `delivery_limit`, а если DLX не задан, удаляется. Возвращённое сообщение встаёт в голову очереди. В песочнице лимит всегда 20, изменить его нельзя.

**Приоритеты** — 0–31, по умолчанию 4 (урок 4.3).

**Ограничения.** Переполнение (`x-overflow`) поддерживает только `drop-head` и `reject-publish`, режима `reject-publish-dlx` нет. Глобального prefetch (`global=true`) нет.

Не воспроизводятся в песочнице: репликация по узлам, выборы лидера, поведение при потере кворума. Разберите их по документации RabbitMQ.

Сравните с классической очередью. Потребитель, который всегда отклоняет сообщение с `requeue=true`, в классической очереди будет получать его вечно. В quorum-очереди через 20 неудач сообщение уйдёт в DLX. Именно это даёт сценарий в задании урока.

### Streams

Stream — третий тип очереди, устроенный иначе: это журнал, в который сообщения только добавляются. Песочница streams не выполняет: объявление `--type stream` она отвергает с понятным сообщением.

```text
rabbitmqadmin queues declare --name events --type stream --durable true
Error: streams are not simulated in this sandbox (only classic and quorum queues)
```

Что стоит знать из документации:

- Чтение не удаляет сообщения. Каждому сообщению при публикации присваивается номер, offset. Несколько потребителей читают независимо, каждый со своего места, и один и тот же набор можно перечитывать.
- Потребитель выбирает, с какого места читать, аргументом подписки `x-stream-offset`: `first` (с начала), `last`, `next` (по умолчанию, только новые), число (offset), метка времени, интервал.
- Удаляются сообщения не при чтении, а по политике хранения: по возрасту (`max-age`) или по размеру (`max-length-bytes`).
- Stream всегда durable и не бывает exclusive. TTL очереди (`x-expires`) он не поддерживает.
- Через AMQP 0-9-1 подписка на stream требует заранее заданного `prefetch` и ручных подтверждений: подтверждения управляют потоком. Глобальный prefetch не поддерживается.

Выбор между типами по задаче. Задачи, которые берут по одной и забывают (письма, платежи), — очередь, лучше quorum. Данные, которые надо хранить и перечитывать разными потребителями (аналитика, аудит, восстановление состояния), — stream.

### Частые ошибки

- **Ошибка:** отвечать на RPC в очередь без `correlation_id`. Клиент не отличит ответы на разные запросы. **Верно:** сервер копирует `correlation_id` запроса в ответ, а клиент его сверяет.
- **Ошибка:** объявить quorum-очередь как `--durable false` или повторно объявить существующую очередь другого типа. **Верно:** quorum всегда durable, а тип выбирается один раз; для смены создают новую очередь.
- **Ошибка:** полагаться на лимит доставок, не настроив DLX. Через 20 неудач сообщение удаляется. **Верно:** задать `x-dead-letter-exchange`, чтобы оно попало в очередь на разбор.
- **Ошибка:** брать обычную очередь там, где данные нужно перечитывать. **Верно:** stream (в песочнице — только по документации).

### Шпаргалка

- RPC: `reply_to` (куда ответить) и `correlation_id` (на какой запрос); ответ публикуется в exchange по умолчанию с ключом `reply_to`.
- Direct reply-to: псевдоочередь `amq.rabbitmq.reply-to`, автоподтверждение, один канал; теория.
- Quorum: `--type quorum --durable true`; тип не меняется; лимит доставок 20, `x-delivery-count`, затем dead-letter `delivery_limit`; приоритеты 0–31, по умолчанию 4.
- Stream: журнал с offset, чтение не удаляет, `x-stream-offset`, хранение по `max-age` и `max-length-bytes`; в песочнице не выполняется.

## task rmq-rpc-review

```json
{
  "type": "review",
  "title": "Клиент RPC принимает чужие ответы",
  "xp": 20,
  "hints": [
    "Раздел «RPC через очереди»: зачем нужен `correlation_id`.",
    "В очередь ответов клиента приходят ответы на все его запросы, включая запоздавшие. Посмотрите, как обработчик решает, чей это ответ.",
    "Смотрите на строку, где ответ сохраняется как результат без проверки."
  ],
  "code": "corr_id = str(uuid.uuid4())\nchannel.basic_publish(\"\", \"rpc.convert\", b\"usd:100\",\n    properties=pika.BasicProperties(reply_to=\"rpc.reply.web-1\", correlation_id=corr_id))\n\ndef on_reply(ch, method, props, body):\n    result.append(body)\n    ch.basic_ack(method.delivery_tag)",
  "codeLanguage": "python",
  "lines": [6],
  "options": [
    "Обработчик принимает любой ответ из очереди ответов, не сверяя `correlation_id`: запоздалый ответ на прошлый запрос будет принят за ответ на текущий",
    "Ответ нельзя подтверждать через `basic_ack`, он должен быть автоматическим",
    "`reply_to` нужно указывать только при объявлении очереди, а не при публикации",
    "Идентификатор запроса должен быть числом, а не строкой UUID"
  ],
  "answer": [0],
  "explanation": "`correlation_id` отправлен, но на ответе не проверяется. Если сервер был медленным, на запрос двухминутной давности придёт запоздалый ответ, и клиент примет его за ответ на новый запрос. Обработчик должен сравнить `props.correlation_id` с `corr_id` и пропустить чужие ответы. Подтверждать вручную можно: это обычный режим. `reply_to` указывается именно в свойствах публикуемого запроса, как в коде. Тип идентификатора не важен: подойдёт любая уникальная строка."
}
```

Клиент интернет-магазина запрашивает пересчёт суммы через RPC. Иногда в корзине показывается сумма от другого заказа. Найдите причину в коде клиента.

## task rmq-poison-payment

```json
{
  "type": "scenario",
  "title": "Один плохой платёж крутится по кругу",
  "xp": 25,
  "scenario": "w4-poison-payment",
  "hints": [
    "Раздел «Quorum-очереди»: лимит доставок.",
    "Потребитель всегда отклоняет сообщение с возвратом. Нужен тип очереди, который сам остановит возвраты через заданное число попыток, и DLX, чтобы сообщение не пропало. Exchange `pay.dlx` и очередь `payments.poison` уже готовы.",
    "Шаблон: `rabbitmqadmin queues declare --name payments --type … --durable true --arguments '{\"x-dead-letter-exchange\": \"…\"}'`."
  ],
  "check": {}
}
```

Издатель `checkout` публикует в очередь `payments` один платёж `payment 1`. Потребитель `billing` не может его обработать: каждая попытка заканчивается ошибкой, и он возвращает платёж в очередь. Сейчас очередь `payments` классическая, и платёж ходит по кругу бесконечно.

Exchange `pay.dlx` и очередь `payments.poison` уже подготовлены. Объявите `payments` так, чтобы после исчерпания лимита доставок платёж попал в `payments.poison` с причиной `delivery_limit`.

```broker starter
rabbitmqadmin queues declare --name payments --type classic --durable true --arguments '{"x-dead-letter-exchange": "pay.dlx"}'
```

```broker solution
rabbitmqadmin queues declare --name payments --type quorum --durable true --arguments '{"x-dead-letter-exchange": "pay.dlx"}'
```

## task rmq-rpc-reply

```json
{
  "type": "console",
  "title": "Ответить на запрос цены",
  "xp": 20,
  "hints": [
    "Раздел «RPC через очереди»: как сервер возвращает ответ.",
    "Сначала заберите запрос из `rpc.price` командой `get messages`. Ответ публикуется через exchange по умолчанию: ключом служит имя из `reply_to`, а в свойства нужно положить `correlation_id` запроса.",
    "Шаблон: `rabbitmqadmin get messages --queue …`, затем `rabbitmqadmin publish message --routing-key … --payload \"price:1200\" --properties '{\"correlation_id\": \"…\"}'`."
  ],
  "check": {
    "compare": ["messages"],
    "require": [
      { "pattern": "get messages", "message": "Прочитайте запрос командой get messages" },
      { "pattern": "correlation_id", "message": "Положите в свойства ответа correlation_id запроса" }
    ]
  }
}
```

Клиент опубликовал в очередь `rpc.price` запрос `sku-42` со свойствами `reply_to` = `rpc.reply.shop-7` и `correlation_id` = `req-42`. Заберите запрос из очереди, чтобы он исчез, и отправьте ответ `price:1200` в очередь ответов клиента с тем же `correlation_id`.

```broker setup
rabbitmqadmin queues declare --name rpc.price --type classic --durable true
rabbitmqadmin queues declare --name rpc.reply.shop-7 --type classic --durable true
rabbitmqadmin publish message --routing-key rpc.price --payload "sku-42" --properties '{"reply_to": "rpc.reply.shop-7", "correlation_id": "req-42"}'
```

```broker starter
rabbitmqadmin get messages --queue rpc.price
```

```broker solution
rabbitmqadmin get messages --queue rpc.price
rabbitmqadmin publish message --routing-key rpc.reply.shop-7 --payload "price:1200" --properties '{"correlation_id": "req-42"}'
```

## task rmq-stream-choice

```json
{
  "type": "choice",
  "title": "Журнал событий для аналитики",
  "xp": 15,
  "hints": [
    "Раздел «Streams»: как устроено чтение.",
    "Требование: прочитанное не должно исчезать, а у каждого потребителя своё место чтения.",
    "Этим свойством обладает только один тип: журнал с offset."
  ],
  "options": [
    "Классическая очередь с очень большим `x-message-ttl`",
    "Quorum-очередь: она надёжнее, значит, сообщения не удаляются при чтении",
    "Stream: чтение не удаляет сообщения, у каждого потребителя своя позиция",
    "Fanout exchange с отдельной очередью на каждого читателя"
  ],
  "answer": [2],
  "explanation": "Stream — журнал: сообщения получают offset, чтение их не удаляет, потребитель сам выбирает начало (`x-stream-offset`), поэтому события можно перечитывать, а несколько читателей не мешают друг другу. Классическая очередь удаляет сообщение после подтверждения, TTL здесь ничего не меняет. Quorum-очередь надёжнее, но тоже удаляет подтверждённые сообщения. Fanout с очередью на читателя даёт каждому копию, но подтверждённое всё равно исчезает, и перечитать его нельзя. Песочница stream не выполняет, это вопрос по документации."
}
```

Аналитическая служба хочет хранить события заказов за последние семь дней и несколько раз перечитывать их с начала, независимо от других потребителей. Подтверждённые сообщения при этом не должны пропадать. Что выбрать?
