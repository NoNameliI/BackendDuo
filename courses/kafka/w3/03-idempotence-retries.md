# Идемпотентность и повторы

Сервис списаний отправляет в Kafka команду «списать 500 рублей». Сеть мигнула: запись дошла до брокера, а ответ продюсеру потерялся. Продюсер не знает, что произошло, и отправляет запись снова. Если ничего не предпринять, в журнале окажутся две команды, и клиента спишут дважды. В этом уроке вы узнаете, зачем продюсер повторяет запросы, чем это грозит и как идемпотентный продюсер делает повторы безопасными.

### Повторы продюсера

Продюсер повторяет запрос, если ответ не пришёл или пришла ошибка, которую стоит повторить (например, сменился лидер). Четыре настройки задают пределы:

- `request.timeout.ms` (30000 мс по умолчанию) — сколько ждать ответа на один запрос.
- `retries` (по умолчанию 2147483647, то есть почти без ограничения) — сколько раз повторять.
- `delivery.timeout.ms` (120000 мс по умолчанию) — сколько всего даётся записи от отправки до успеха или отказа. Документация советует управлять повторами именно этим сроком, а не `retries`.
- `retry.backoff.ms` (100 мс) — пауза перед повтором.

Повтор решает проблему потери, но создаёт две другие.

**Дубль.** Запись дошла, ответ потерялся, продюсер повторил запрос, и в журнале две одинаковые записи.

**Нарушение порядка.** Продюсер может держать в пути несколько запросов сразу (`max.in.flight.requests.per.connection`, по умолчанию 5). Если первый запрос вернулся с ошибкой, а второй и третий успели записаться, то повтор первого окажется в журнале после них. Для записей с одним ключом это ломает порядок (урок 2.2).

### Идемпотентный продюсер

Настройка `enable.idempotence` (по умолчанию `true` с Kafka 3.0) включает защиту от обеих проблем.

- Брокер выдаёт продюсеру идентификатор `PID` (producer id).
- Каждый пакет записей для партиции получает порядковый номер (`seq`) в рамках пары «PID — партиция».
- Брокер принимает только следующий ожидаемый номер. Если пришёл уже принятый, брокер отвечает «успешно» и ничего не записывает (код `DUPLICATE_SEQUENCE_NUMBER`, 46). Если пришёл номер с пропуском, пакет отклоняется (`OUT_OF_ORDER_SEQUENCE_NUMBER`, 45), и продюсер повторит его в правильном порядке.

Итог: повтор не создаёт дубля, а порядок сохраняется, пока в пути не больше 5 запросов.

Условия работы идемпотентности:

- `acks=all` (иначе продюсер не запустится);
- `retries` больше нуля (песочница принимает и `retries=0` вместе с идемпотентностью, но настоящая Kafka отвергает такую конфигурацию с ошибкой, поэтому на практике `retries` не обнуляют);
- `max.in.flight.requests.per.connection` не больше 5.

Границы защиты:

- Она действует в пределах одной сессии продюсера. После перезапуска приложения продюсер получает новый `PID`, и брокер не узнает старые записи.
- Она не отличает намеренную повторную отправку приложением той же записи: для брокера это две разные записи.

Чтобы проверить условие, попробуйте включить идемпотентность при `acks=1`:

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic charges --partitions 1 --replication-factor 3
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic charges --producer-property acks=1 --producer-property enable.idempotence=true <<EOF
charge 1
EOF
```

```text
Created topic charges.
Error: Must set acks to all in order to use the idempotent producer. Otherwise we cannot guarantee idempotence.
```

Продюсер отказывается стартовать, и ни одна запись не отправлена.

Теперь корректная пара настроек. `--producer-property` вам знаком из урока 3.2:

```broker example
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic charges --producer-property enable.idempotence=true --producer-property acks=all <<EOF
charge 1
charge 2
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic charges --from-beginning --max-messages 2
```

```text
charge 1
charge 2
Processed a total of 2 messages
```

### Потерянный ответ в сценарии

В сценарии потерю ответа брокера моделирует отказ `ack.lost`: следующий ответ для продюсера теряется, и продюсер узнаёт об этом по `request.timeout.ms`. Ниже продюсер возвратов отправляет пять записей, ответ на четвёртую запись теряется. Идемпотентность выключена.

```scenario example
{
  "sim": "kafka",
  "seed": 1,
  "durationMs": 15000,
  "setup": "kafka-topics.sh --bootstrap-server localhost:9092 --create --topic refunds --partitions 1 --replication-factor 3",
  "actors": [
    { "id": "refund-api", "kind": "producer", "topic": "refunds", "rate": 5, "count": 5, "message": { "body": "refund {n}" }, "config": { "acks": "all", "enable.idempotence": false, "request.timeout.ms": 1000 } },
    { "id": "bank", "kind": "consumer", "group": "bank", "topics": ["refunds"], "processMs": 20, "config": { "auto.offset.reset": "earliest" } }
  ],
  "faults": [ { "at": 600, "kind": "ack.lost", "actor": "refund-api" } ],
  "expect": [
    { "kind": "noDuplicateProcessing", "actor": "bank" },
    { "kind": "processedAtLeast", "actor": "bank", "count": 5, "byMs": 10000 }
  ]
}
```

Журнал отказа:

```text
0      fault      controller    Создан топик refunds: 1 разд., фактор репликации 3
600    fault      refund-api    Следующий ответ брокера для refund-api потеряется по дороге
617    fault      refund-api    refund-api: подтверждение записи в refunds-0 потеряно по дороге; издатель узнает об этом по request.timeout.ms=1000
```

Условие `noDuplicateProcessing` требует, чтобы потребитель не обрабатывал одно и то же сообщение дважды. Итог:

- `noDuplicateProcessing`: не выполнено («bank: повторно обработано сообщений: 1»)
- `processedAtLeast`: выполнено («bank: обработано 6»)

Запись дошла, ответ потерялся, продюсер повторил, и `bank` обработал её дважды. Теперь тот же сценарий с `enable.idempotence=true`.

```scenario example
{
  "sim": "kafka",
  "seed": 1,
  "durationMs": 15000,
  "setup": "kafka-topics.sh --bootstrap-server localhost:9092 --create --topic refunds --partitions 1 --replication-factor 3",
  "actors": [
    { "id": "refund-api", "kind": "producer", "topic": "refunds", "rate": 5, "count": 5, "message": { "body": "refund {n}" }, "config": { "acks": "all", "enable.idempotence": true, "request.timeout.ms": 1000 } },
    { "id": "bank", "kind": "consumer", "group": "bank", "topics": ["refunds"], "processMs": 20, "config": { "auto.offset.reset": "earliest" } }
  ],
  "faults": [ { "at": 600, "kind": "ack.lost", "actor": "refund-api" } ],
  "expect": [
    { "kind": "noDuplicateProcessing", "actor": "bank" },
    { "kind": "processedAtLeast", "actor": "bank", "count": 5, "byMs": 10000 }
  ]
}
```

```text
0      fault      controller    Создан топик refunds: 1 разд., фактор репликации 3
5      produce    refund-api    refund-api: пакет refunds-0 из 1 зап. (8 Б) закрыт: прошло linger.ms=5
205    produce    refund-api    refund-api: пакет refunds-0 из 1 зап. (8 Б) закрыт: прошло linger.ms=5
405    produce    refund-api    refund-api: пакет refunds-0 из 1 зап. (8 Б) закрыт: прошло linger.ms=5
600    fault      refund-api    Следующий ответ брокера для refund-api потеряется по дороге
605    produce    refund-api    refund-api: пакет refunds-0 из 1 зап. (8 Б) закрыт: прошло linger.ms=5
617    fault      refund-api    refund-api: подтверждение записи в refunds-0 потеряно по дороге; издатель узнает об этом по request.timeout.ms=1000
805    produce    refund-api    refund-api: пакет refunds-0 из 1 зап. (8 Б) закрыт: прошло linger.ms=5
1605   produce    refund-api    refund-api: refunds-0 — REQUEST_TIMED_OUT, повтор через 100 мс (попытка 2)
1707   produce    broker-1      refunds-0: дубликат пакета (producer 1000, seq 3) подтверждён без повторной записи
```

Итог:

- `noDuplicateProcessing`: выполнено («bank: дублей нет»)
- `processedAtLeast`: выполнено («bank: обработано 5»)

Строки `produce` — это закрытие пакетов записей по `linger.ms`; пакеты разобраны в уроке 4.3, для этого урока они не важны. Среди записей журнала с брокера есть строка про дубликат пакета: брокер подтвердил повтор, не записав его.

### Нарушение порядка при повторах

Если идемпотентность выключена и в пути несколько запросов, повтор может обогнать порядок. В сценарии один запрос с ошибкой моделирует отказ `produce.error` (поля `actor`, `code` — код ошибки, `count` — сколько запросов подряд): продюсер получает ошибку, которую стоит повторить, например смену лидера. Два способа исправить:

- включить `enable.idempotence=true` (порядок сохраняется при `max.in.flight.requests.per.connection` до 5);
- или поставить `max.in.flight.requests.per.connection=1`: в пути один запрос, и обгонять нечему. Это снижает пропускную способность.

Выбор первого способа почти всегда лучше.

### Частые ошибки

- **Ошибка:** отключить идемпотентность, потому что «повторов и так не бывает». **Верно:** повторы случаются при каждой смене лидера и потере пакета; без идемпотентности они дают дубли и перестановки.
- **Ошибка:** включить `enable.idempotence=true` и оставить `acks=1`. **Верно:** продюсер не запустится: нужен `acks=all`.
- **Ошибка:** считать, что идемпотентность убирает дубли после перезапуска приложения. **Верно:** после перезапуска `PID` новый; дубли от повторной отправки приложением гасят уникальным идентификатором и идемпотентным потребителем.
- **Ошибка:** увеличивать `retries`, чтобы ограничить повторы. **Верно:** срок повторов задаёт `delivery.timeout.ms`.

### Шпаргалка

- Повторы нужны, потому что ответ может потеряться; без защиты они дают дубли и нарушение порядка.
- `enable.idempotence=true` (по умолчанию): `PID` и `seq` на партицию; повтор подтверждается без второй записи.
- Требует `acks=all`, `retries` больше 0, `max.in.flight.requests.per.connection` не больше 5.
- Защита действует в пределах одной сессии продюсера и не заменяет идемпотентного потребителя.
- `request.timeout.ms` 30000, `delivery.timeout.ms` 120000, `retry.backoff.ms` 100.
- В сценарии: `ack.lost`, `produce.error` — потеря ответа и ошибка запроса.

## task kfk-idem-console

```json
{
  "type": "console",
  "title": "Идемпотентная запись списаний",
  "xp": 10,
  "hints": [
    "Раздел «Идемпотентный продюсер» и пример с `--producer-property`.",
    "Включите идемпотентность настройкой продюсера и не забудьте `acks=all`.",
    "`kafka-console-producer.sh … --producer-property enable.idempotence=… --producer-property acks=… <<EOF`"
  ],
  "check": {
    "compare": ["messages"],
    "require": [
      { "pattern": "enable\\.idempotence=true", "message": "Передайте продюсеру --producer-property enable.idempotence=true" }
    ]
  }
}
```

В топике `debits` пока пусто. Запишите в него три записи `debit 1`, `debit 2` и `debit 3` продюсером с включённой идемпотентностью (и подходящим `acks`).

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic debits --partitions 1 --replication-factor 3
```

```broker starter
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic debits <<EOF
debit 1
debit 2
debit 3
EOF
```

```broker solution
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic debits --producer-property enable.idempotence=true --producer-property acks=all <<EOF
debit 1
debit 2
debit 3
EOF
```

## task kfk-idem-double-charge

```json
{
  "type": "scenario",
  "title": "Клиента списали дважды",
  "xp": 25,
  "scenario": "w3-double-charge",
  "hints": [
    "Раздел «Идемпотентный продюсер».",
    "Ответ на одну запись потерялся, продюсер повторил запрос, и брокер записал дубль. Повторы отключать нельзя, но можно сделать их безопасными настройкой продюсера.",
    "В окне свойств: `billing-api.enable.idempotence=…`."
  ],
  "check": {}
}
```

`billing-api` отправляет 20 команд списания (`charge 1` … `charge 20`) в топик `charges`, `cashier` выполняет их. На 1000-й миллисекунде теряется ответ брокера продюсеру, тот повторяет запрос, и одна команда выполняется дважды. Идемпотентность у продюсера выключена.

SLA: ни одна команда не выполняется дважды, и все 20 выполнены к 15000-й миллисекунде. Повторы запрещать нельзя.

```properties starter
billing-api.enable.idempotence=false
```

```properties solution
billing-api.enable.idempotence=true
```

## task kfk-idem-reordered-balance

```json
{
  "type": "scenario",
  "title": "Баланс кошелька пришёл в другом порядке",
  "xp": 25,
  "scenario": "w3-reordered-balance",
  "hints": [
    "Раздел «Нарушение порядка при повторах».",
    "Один запрос завершился ошибкой, и его повтор записался после следующих. Нужно защитить порядок: либо идемпотентность, либо один запрос в пути.",
    "В окне свойств: `wallet-api.enable.idempotence=…` (или `wallet-api.max.in.flight.requests.per.connection=…`)."
  ],
  "check": {}
}
```

`wallet-api` отправляет 100 изменений баланса кошелька `wallet-7` (`change 1` … `change 100`) в топик `balance` с одной партицией; `statement` строит выписку. На 200-й миллисекунде один запрос завершается ошибкой смены лидера, и продюсер повторяет его. Идемпотентность выключена, в выписке порядок изменений нарушен.

SLA: изменения кошелька обрабатываются в порядке отправки, и все 100 обработаны к 15000-й миллисекунде. Править нужно только свойства продюсера.

```properties starter
wallet-api.enable.idempotence=false
```

```properties solution
wallet-api.enable.idempotence=true
```

## task kfk-idem-scope

```json
{
  "type": "choice",
  "title": "Что не защитит идемпотентный продюсер",
  "xp": 10,
  "hints": [
    "Раздел «Идемпотентный продюсер», абзац «Границы защиты».",
    "Подумайте, что знает брокер о приложении после его перезапуска.",
    "После перезапуска продюсер получает новый `PID`."
  ],
  "options": [
    "Повтор запроса после потерянного ответа брокера",
    "Нарушение порядка записей одной партиции из-за повтора при пяти запросах в пути",
    "Повторную отправку приложением той же команды после перезапуска: брокер видит нового продюсера и принимает обе записи",
    "Запись с повторяющимся `seq` от того же продюсера в ту же партицию"
  ],
  "answer": [2],
  "explanation": "Брокер сравнивает номера `seq` в пределах пары «PID — партиция». После перезапуска `PID` другой, поэтому повторная отправка команды выглядит как новая запись: дубль придётся гасить идемпотентным потребителем или уникальным идентификатором команды. Остальные случаи идемпотентный продюсер решает: повтор после потерянного ответа подтверждается без второй записи, порядок при не более чем пяти запросах в пути сохраняется, а пакет с уже принятым `seq` брокер подтверждает, не записывая."
}
```

Сервис списаний работает с настройками по умолчанию (`enable.idempotence=true`, `acks=all`). Какую из ситуаций идемпотентность не закрывает?
