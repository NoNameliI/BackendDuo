# Коммиты и семантики доставки

Сервис рассылки читает из Kafka чеки и отправляет их клиентам по почте. Он упал посреди работы. После перезапуска он должен продолжить с нужного места: не пропустить письма и не отправить их заново. Место, с которого читать дальше, хранится как закоммиченный offset. От того, когда сервис его сохраняет, зависит, что он потеряет или повторит при падении. В этом уроке разберём коммиты и три семантики доставки.

### Позиция и закоммиченный offset

- **Позиция** (position) потребителя — offset следующей записи, которую он прочитает. Если последняя прочитанная запись имеет offset 4, позиция равна 5.
- **Закоммиченный offset** (committed offset, коммит) — сохранённая в Kafka позиция группы. Он тоже равен offset **следующей** записи, которую нужно обработать. Хранится во внутреннем топике `__consumer_offsets`.
- После перезапуска потребитель группы начинает с закоммиченного offset. Всё, что он прочитал после последнего коммита, он прочитает снова.
- **Lag** партиции — число записей между концом журнала и закоммиченным offset группы (урок 2.4).
- Настройка `auto.offset.reset` (по умолчанию `latest`) применяется только когда у группы нет закоммиченного offset или он вне диапазона.

Консольный потребитель с флагом `--group имя` коммитит позицию при завершении. Посмотреть закоммиченный offset группы можно командой `kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group имя`: столбцы `CURRENT-OFFSET`, `LOG-END-OFFSET`, `LAG` и предупреждение `has no active members` разобраны в уроке 1.3.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic tickets --partitions 1 --replication-factor 3
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic tickets <<EOF
ticket 1
ticket 2
ticket 3
ticket 4
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic tickets --group helpdesk --from-beginning --max-messages 3
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group helpdesk
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic tickets --group helpdesk --max-messages 1
```

```text
Created topic tickets.
ticket 1
ticket 2
ticket 3
Processed a total of 3 messages
Consumer group 'helpdesk' has no active members.
GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID     HOST            CLIENT-ID
helpdesk        tickets         0          3               4               1               -               -               -
ticket 4
Processed a total of 1 messages
```

Группа `helpdesk` прочитала три записи и закоммитила offset 3: следующей будет `ticket 4`. Поэтому `LAG` равен 1, а повторный запуск с той же группой (без `--from-beginning`) продолжил с четвёртой записи.

### Когда коммитить

У настоящего потребителя два режима.

- **Автоматический** (`enable.auto.commit=true`, по умолчанию): потребитель сам коммитит позицию раз в `auto.commit.interval.ms` (5000 мс). Коммит происходит внутри вызова `poll()` и при `close()`. Нужно успеть обработать всё, что вернул `poll()`, до следующего вызова, иначе коммит окажется впереди обработки.
- **Ручной**: код сам вызывает `commitSync()` (ждёт результата) или `commitAsync()` (не ждёт) в выбранный момент.

Момент коммита определяет семантику доставки.

### Три семантики доставки

- **At-most-once** (не более одного раза): сначала коммит, потом обработка. Если потребитель упал между ними, запись пропущена навсегда: перезапуск пойдёт дальше. Дубликатов нет, потери возможны.
- **At-least-once** (не менее одного раза): сначала обработка, потом коммит. Если упал между ними, после перезапуска запись обработают снова. Потерь нет, дубликаты возможны. Это обычный выбор.
- **Exactly-once** (ровно один раз): результат такой, как будто каждая запись обработана один раз. Достигается идемпотентной обработкой или транзакциями (ниже).

Автоматический коммит ведёт себя как at-least-once, если вся пачка обработана до следующего `poll()`: после падения повторяется всё, что прочитано после последнего коммита.

### Падение потребителя в сценарии

Сценарий моделирует падение потребителя отказом `consumer.crash` (с `afterProcess: true` потребитель успевает обработать запись, но не коммитит). Параметры, которые вы увидите в сценариях:

- `idempotent` — учебный параметр потребителя: `true` значит, что код потребителя запоминает обработанные записи и пропускает повторы. Это поведение вашего кода, а не настройка Kafka.
- `on_error` — учебный параметр: что делает код при ошибке обработки. `skip` (по умолчанию) — записать ошибку и идти дальше, `retry` — повторить ту же запись, `stop` — остановить потребителя.
- `failEveryN` у потребителя — каждая N-я попытка обработки завершается ошибкой.
- Сценарий с падением потребителя идёт не меньше минуты: упавший участник исключается из группы только через `session.timeout.ms` (45 с).

Пример: сервис SMS читает 60 сообщений, `sender` падает на 9000-й миллисекунде сразу после обработки записи.

```scenario example
{
  "sim": "kafka",
  "seed": 1,
  "durationMs": 90000,
  "setup": "kafka-topics.sh --bootstrap-server localhost:9092 --create --topic sms --partitions 1 --replication-factor 3",
  "actors": [
    { "id": "sms-api", "kind": "producer", "topic": "sms", "rate": 5, "count": 60, "message": { "body": "sms {n}" }, "config": { "acks": "all" } },
    { "id": "sender", "kind": "consumer", "group": "sender", "topics": ["sms"], "processMs": 20, "config": { "auto.offset.reset": "earliest", "enable.auto.commit": true, "idempotent": false } }
  ],
  "faults": [ { "at": 9000, "kind": "consumer.crash", "actor": "sender", "afterProcess": true } ],
  "expect": [
    { "kind": "noDuplicateProcessing", "actor": "sender" },
    { "kind": "processedAtLeast", "actor": "sender", "count": 60, "byMs": 85000 },
    { "kind": "noLoss" }
  ]
}
```

Коммиты и падение:

```text
0      fault      controller    Создан топик sms: 1 разд., фактор репликации 3
5000   commit     sender        sender: авто-коммит внутри poll: sms-0=25
9000   fault      sender        sender упал, не закоммитив прочитанное
9000   fault      sender        sender: heartbeat прекратились, сессия истечёт через 45000 мс (session.timeout.ms=45000)
59000  commit     sender        sender: авто-коммит внутри poll: sms-0=60
```

Итог:

- `noDuplicateProcessing`: не выполнено («sender: повторно обработано сообщений: 20»)
- `processedAtLeast`: выполнено («sender: обработано 80»)
- `noLoss`: выполнено («Потерь нет»)

Последний коммит был на 5000-й миллисекунде, а падение случилось на 9000-й. Всё, что `sender` прочитал за эти четыре секунды, после перезапуска отправлено повторно. Потерь нет, но есть дубли: типичный at-least-once. Лечится идемпотентным потребителем (`idempotent=true`). Более частый коммит уменьшил бы окно, но не убрал бы его.

Второй источник проблем — ошибка обработки. Если код при ошибке просто идёт дальше (`on_error=skip`), позиция сдвигается, следующий коммит закрепит пропуск, и запись пропала для сервиса, хотя в Kafka она лежит. Правильнее повторить обработку (`retry`) или отправить запись в отдельный топик для разбора.

### Транзакции и read_committed

Для цепочки «прочитать — преобразовать — записать» в Kafka есть транзакции. Песочница их не запускает, поэтому здесь только теория.

- Продюсер получает `transactional.id` (идентичность включает идемпотентность). Вызовы: `initTransactions`, `beginTransaction`, затем `send` и `sendOffsetsToTransaction` (offset потребителя идут в ту же транзакцию), затем `commitTransaction` или `abortTransaction`.
- Координатор записывает в каждую затронутую партицию служебную маркерную запись COMMIT или ABORT. Маркер занимает offset, поэтому после транзакций в нумерации видны пропуски.
- Новый продюсер с тем же `transactional.id` отключает старого (ошибки `PRODUCER_FENCED`, `INVALID_PRODUCER_EPOCH`). Зависшая транзакция отменяется по `transaction.timeout.ms`.
- Потребитель должен включить `isolation.level=read_committed` (по умолчанию `read_uncommitted`) и `enable.auto.commit=false`. Он видит записи только до **LSO** (last stable offset) и пропускает отменённые. Незавершённая транзакция удерживает LSO.
- Вместе идемпотентность, транзакции и `read_committed` дают exactly-once внутри Kafka. Внешнее действие, например письмо клиенту, транзакция Kafka не откатит: там нужна идемпотентность на стороне получателя.

### Потребитель на Python с ручным коммитом

Потребитель из `confluent_kafka` работает в песочнице поверх той же учебной модели Kafka. `poll()` выдаёт по одной записи за вызов, время виртуальное. Бесконечный цикл `poll()` песочница останавливает на 60-й виртуальной секунде.

```python
from confluent_kafka import Consumer

consumer = Consumer({
    'bootstrap.servers': 'localhost:9092',
    'group.id': 'ГРУППА',
    'enable.auto.commit': False,
    'auto.offset.reset': 'earliest',
})
consumer.subscribe(['ТОПИК'])
while ЕСТЬ_ЧТО_ЧИТАТЬ:
    msg = consumer.poll(1.0)
    if msg is None or msg.error():
        continue
    # обработка msg.value()
    consumer.commit(message=msg, asynchronous=False)
consumer.close()
```

- `group.id` — имя группы. Без него потребитель не запустится. Закоммиченные offset хранятся по группе.
- `enable.auto.commit: False` отключает автоматический коммит. Тогда позицию закрепляет только ваш код.
- `auto.offset.reset: 'earliest'` — с какого места читать, если у группы нет закоммиченного offset. По умолчанию в библиотеке это значение `largest`: только новые записи, а старые потребитель не увидит. `earliest` читает с начала топика.
- `subscribe(['ТОПИК'])` принимает **список** тем, строка вызовет ошибку. Группа сама распределит партиции между участниками.
- `poll(1.0)` ждёт запись до секунды. Возвращает `None`, если ничего нет, и `Message` иначе. Первые вызовы после `subscribe()` часто возвращают `None`, пока группа собирается: это нормально, цикл продолжает опрос.
- `msg.error()` не `None`, если вместо записи пришла ошибка. Такую «запись» пропускают и читают дальше.
- `msg.value()` возвращает `bytes`; `msg.partition()` и `msg.offset()` показывают положение записи.
- `commit(message=msg, asynchronous=False)` закрепляет позицию **после** этой записи, то есть `msg.offset() + 1`. С `asynchronous=False` вызов ждёт подтверждения.
- `close()` выходит из группы. Всегда вызывайте его в конце.

Порядок «обработал, затем `commit`» — это at-least-once из раздела выше. Если программа упадёт между ними, запись будет прочитана снова. Коммит перед обработкой дал бы at-most-once.

Пример. В топике `alerts` три записи, группа `pager` читает с начала:

```python
from confluent_kafka import Consumer

consumer = Consumer({'bootstrap.servers': 'localhost:9092', 'group.id': 'pager',
                     'enable.auto.commit': False, 'auto.offset.reset': 'earliest'})
consumer.subscribe(['alerts'])
done = 0
while done < 2:
    msg = consumer.poll(1.0)
    if msg is None or msg.error():
        continue
    print(msg.value().decode(), msg.offset())
    consumer.commit(message=msg, asynchronous=False)
    done += 1
consumer.close()
```

Программа обработает и закоммитит ровно две записи: `done` считает обработанные, и цикл заканчивается после второй. Закоммиченный offset группы `pager` станет равным 2, а `LAG` — 1. Третья запись останется для следующего запуска. Блок выполняется только в заданиях типа «клиент».

### Частые ошибки

- **Ошибка:** считать, что закоммиченный offset указывает на последнюю обработанную запись. **Верно:** он указывает на следующую, ещё не обработанную.
- **Ошибка:** надеяться, что `enable.auto.commit=true` исключает дубли. **Верно:** после падения повторяется всё прочитанное с последнего коммита; нужна идемпотентная обработка.
- **Ошибка:** глотать ошибку обработки и идти дальше при автокоммите. **Верно:** запись будет потеряна для сервиса; повторите её или отправьте в топик для разбора.
- **Ошибка:** думать, что `exactly-once` касается любых действий. **Верно:** он гарантирован только для данных внутри Kafka; письма и платежи защищают идемпотентным получателем.

### Шпаргалка

- Позиция и закоммиченный offset — offset следующей записи; хранится в `__consumer_offsets`.
- `kafka-consumer-groups.sh --describe --group имя` — `CURRENT-OFFSET`, `LOG-END-OFFSET`, `LAG`.
- Автокоммит: `enable.auto.commit=true`, `auto.commit.interval.ms=5000`, внутри `poll()` и `close()`.
- Коммит до обработки — at-most-once; после — at-least-once (дубли); exactly-once — идемпотентность, транзакции, `read_committed`.
- Транзакции в песочнице не запускаются: только теория.
- Python: `Consumer({'group.id': …, 'enable.auto.commit': False, 'auto.offset.reset': 'earliest'})`, `subscribe([тема])`, цикл `poll(1.0)`, `commit(message=msg, asynchronous=False)` после обработки, `close()`.
- В сценарии: `consumer.crash`, `idempotent`, `on_error`, `failEveryN`, `noDuplicateProcessing`, `processedAtLeast`.

## task kfk-commit-position

```json
{
  "type": "console",
  "title": "Закоммитить две записи",
  "xp": 10,
  "hints": [
    "Раздел «Позиция и закоммиченный offset» и пример с `--group`.",
    "Читайте с группой, с начала топика и ограничьте число записей. Коммит делается при завершении команды.",
    "`kafka-console-consumer.sh … --topic receipts --group audit --from-beginning --max-messages …`"
  ],
  "check": { "compare": ["offsets"] }
}
```

В топике `receipts` пять записей. Прочитайте с начала ровно две из них группой `audit`, чтобы закоммиченный offset группы стал равным 2.

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic receipts --partitions 1 --replication-factor 3
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic receipts <<EOF
receipt 1
receipt 2
receipt 3
receipt 4
receipt 5
EOF
```

```broker starter
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic receipts --group audit --from-beginning --max-messages 4
```

```broker solution
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic receipts --group audit --from-beginning --max-messages 2
```

## task kfk-commit-replayed-emails

```json
{
  "type": "scenario",
  "title": "Чеки уходят клиентам дважды",
  "xp": 25,
  "scenario": "w3-replayed-emails",
  "hints": [
    "Разделы «Три семантики доставки» и «Падение потребителя в сценарии».",
    "Потребитель упал после обработки, но до коммита: после перезапуска часть чеков отправлена повторно. Повторную доставку не запретить, но код может пропускать уже обработанное: за это отвечает `idempotent`.",
    "В окне свойств: `mailer.idempotent=…`."
  ],
  "check": {}
}
```

`shop-api` пишет 100 чеков в топик `receipts`, `mailer` отправляет их клиентам с автоматическим коммитом. На 9000-й миллисекунде `mailer` падает сразу после обработки записи и после перезапуска повторно отправляет часть чеков.

SLA: ни один чек не отправляется дважды, все 100 обработаны к 85000-й миллисекунде. Автоматический коммит менять не нужно.

```properties starter
mailer.idempotent=false
```

```properties solution
mailer.idempotent=true
```

## task kfk-commit-skipped-invoices

```json
{
  "type": "scenario",
  "title": "Счета пропадают при ошибках",
  "xp": 25,
  "scenario": "w3-skipped-invoices",
  "hints": [
    "Раздел «Падение потребителя в сценарии», абзац про `on_error`, и «Когда коммитить».",
    "Бухгалтерия при ошибке идёт дальше, поэтому позиция сдвигается и счёт пропадает. Нужно повторить ту же запись.",
    "В окне свойств: `accounting.on_error=…` (`skip`, `retry` или `stop`)."
  ],
  "check": {}
}
```

`erp-api` пишет 50 счетов в топик `invoices`, `accounting` проводит их. Каждая пятая попытка обработки завершается ошибкой, и сейчас такой счёт пропускается. К 25000-й миллисекунде проведено только 40 счетов из 50.

SLA: проведены все 50 счетов, и ни один не проведён дважды. Править нужно только свойства потребителя.

```properties starter
accounting.on_error=skip
```

```properties solution
accounting.on_error=retry
```

## task kfk-commit-semantics

```json
{
  "type": "choice",
  "title": "Какая схема даёт ровно один раз",
  "xp": 10,
  "hints": [
    "Раздел «Транзакции и read_committed».",
    "Нужно, чтобы запись результата и фиксация прочитанного происходили атомарно, а потребитель не видел незавершённого.",
    "Offset потребителя отправляют в ту же транзакцию, а потребитель читает с `read_committed`."
  ],
  "options": [
    "Автокоммит у потребителя и `acks=1` у продюсера: так быстрее",
    "Сначала `commitSync()`, потом обработка: тогда дублей не будет",
    "Продюсер с `transactional.id`, offset потребителя отправляются в ту же транзакцию, следующий потребитель читает с `isolation.level=read_committed`",
    "Включённый `enable.idempotence=true` на продюсере: этого достаточно для цепочки «прочитал — записал»"
  ],
  "answer": [2],
  "explanation": "Атомарность чтения и записи дают транзакции: результат и offset потребителя фиксируются вместе, а `read_committed` скрывает незавершённые и отменённые записи. Автокоммит с `acks=1` не защищает ни от потерь, ни от дублей. Коммит до обработки даёт at-most-once: дублей нет, но запись теряется при падении между коммитом и обработкой. Одной идемпотентности недостаточно: она убирает дубли повторов продюсера в одной сессии, но не связывает чтение и запись, и после перезапуска `PID` новый."
}
```

Сервис читает топик `orders`, преобразует записи и пишет результат в топик `orders-enriched`. Нужно, чтобы после падения и перезапуска каждая входная запись давала ровно один результат. Какая схема это обеспечивает?

## task kfk-client-manual-commit

```json
{
  "type": "client",
  "title": "Потребитель с ручным коммитом",
  "xp": 20,
  "hints": [
    "Раздел «Потребитель на Python с ручным коммитом»: настройки, цикл `poll()` и вызов `commit()`.",
    "Отключите автокоммит, читайте с `earliest`, и после обработки каждой записи вызывайте `commit(message=msg, asynchronous=False)`. Цикл должен остановиться, когда обработаны все пять записей, затем `close()`.",
    "Шаблон: `consumer.subscribe(['mail-queue'])`, `while processed < 5:`, внутри `msg = consumer.poll(1.0)`, пропуск `None` и ошибок, обработка, `consumer.commit(message=msg, asynchronous=False)`, `processed += 1`."
  ],
  "check": {
    "compare": ["offsets"],
    "require": [
      { "pattern": "\\.commit\\(", "message": "Закоммитьте обработанные записи: consumer.commit(message=msg, asynchronous=False)" }
    ]
  }
}
```

В топике `mail-queue` одна партиция и пять писем. Напишите на Python потребителя группы `mailer`, который читает топик с начала, обрабатывает каждое письмо (достаточно запомнить текст в списке) и коммитит запись вручную сразу после обработки. Автоматический коммит отключите. Когда обработаны все пять писем, закройте потребителя. Закоммиченный offset группы `mailer` должен стать равным концу журнала, то есть 5.

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic mail-queue --partitions 1 --replication-factor 3
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic mail-queue <<EOF2
mail 1
mail 2
mail 3
mail 4
mail 5
EOF2
```

```python starter
from confluent_kafka import Consumer

consumer = Consumer({
    'bootstrap.servers': 'localhost:9092',
    'group.id': 'mailer',
    'enable.auto.commit': False,
    'auto.offset.reset': 'earliest',
})
consumer.subscribe(['mail-queue'])
sent = []
while len(sent) < 5:
    msg = consumer.poll(1.0)
    if msg is None or msg.error():
        continue
    sent.append(msg.value().decode())
consumer.close()
```

```python solution
from confluent_kafka import Consumer

consumer = Consumer({
    'bootstrap.servers': 'localhost:9092',
    'group.id': 'mailer',
    'enable.auto.commit': False,
    'auto.offset.reset': 'earliest',
})
consumer.subscribe(['mail-queue'])
sent = []
while len(sent) < 5:
    msg = consumer.poll(1.0)
    if msg is None or msg.error():
        continue
    sent.append(msg.value().decode())
    consumer.commit(message=msg, asynchronous=False)
consumer.close()
```
