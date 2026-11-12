# acks и min.insync.replicas

Платёжный сервис пишет в Kafka каждую успешную оплату. Если брокер подтвердил запись, а через секунду упал, платёж терять нельзя. Но подтверждение можно получить на разных этапах: когда запись приняла только одна копия или когда её получили все. От выбора зависит, что вы потеряете при аварии и когда сервис перестанет принимать платежи совсем. В этом уроке два параметра — `acks` у продюсера и `min.insync.replicas` у топика — задают этот компромисс.

### Подтверждение и acks

Продюсер (producer) может ждать от брокера ответа разной степени надёжности. Это задаёт настройка продюсера `acks`.

- `acks=0` — продюсер вообще не ждёт ответа. Запись могла не дойти, а продюсер об этом не узнает. Вместо offset он получает `-1`.
- `acks=1` — лидер подтверждает, как только дописал запись в свой журнал. Фолловеры её ещё могли не получить. Если лидер упадёт раньше, чем фолловеры её заберут, запись пропадёт, хотя продюсер считал её принятой.
- `acks=all` (то же, что `-1`) — лидер отвечает, когда запись дошла до HW, то есть её получили все реплики из ISR (урок 3.1). Пока HW не достиг записи, ответа нет.

Значение по умолчанию — `acks=all` (так с Kafka 3.0 вместе с включённой идемпотентностью, о ней урок 3.3).

Вывод: подтверждение `acks=1` значит «запись у лидера», а подтверждение `acks=all` значит «запись у всех реплик из ISR». Но ISR может сжаться до одного лидера. Этот пробел закрывает `min.insync.replicas`.

### Консольный продюсер с настройками

Настройки продюсера консольной команде передают флагом `--producer-property`:

```text
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic имя --producer-property настройка=значение <<EOF
значение записи
EOF
```

- `--producer-property настройка=значение` — одна настройка продюсера; флаг можно повторять.
- Остальное вам знакомо из урока 1.1.

### min.insync.replicas

`min.insync.replicas` — настройка топика (или всех брокеров). Она задаёт, сколько реплик минимум должно быть в ISR, чтобы брокер принимал записи с `acks=all`. Лидер считается: если в ISR он один, то ISR состоит из одной реплики.

- Значение по умолчанию — 1: достаточно одного лидера.
- Настройка действует только для `acks=all`. Продюсер с `acks=1` или `acks=0` пишет и при меньшем ISR.
- Если ISR меньше порога **до** записи, брокер отвечает ошибкой `NOT_ENOUGH_REPLICAS` (код 19) и ничего не пишет.
- Если запись уже добавлена, а ISR сжался до того, как она дошла до HW, ответ — ошибка `NOT_ENOUGH_REPLICAS_AFTER_APPEND` (код 20). Запись при этом в журнале лидера **есть**: повтор записи без защиты от дублей может её задвоить (урок 3.3).
- Пока ISR меньше порога, HW не растёт. Чтение уже закоммитенных записей работает, а новые записи не становятся видны.

Типичная схема: фактор репликации 3, `min.insync.replicas=2`, `acks=all`. Один брокер можно потерять без остановки записи, а подтверждённая запись есть минимум на двух копиях. При потере двух брокеров запись с `acks=all` останавливается, но данные не теряются.

Порог не бывает больше фактора репликации, иначе запись остановит потеря любого брокера. Так настроен инцидент в задании ниже.

Задать порог можно при создании топика или командой `kafka-configs.sh`:

```text
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name имя --alter --add-config min.insync.replicas=2
```

Здесь `--entity-type topics --entity-name имя` указывает топик, остальное устроено, как в уроке 3.1.

### Пример: два брокера недоступны

Топик платежей с тремя копиями и порогом 2. Останавливаем брокеры 2 и 3 и записываем платёж с `acks=1`.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic payments --partitions 1 --replication-factor 3 --config min.insync.replicas=2
sim crash broker 2
sim crash broker 3
kafka-topics.sh --bootstrap-server localhost:9092 --describe --under-min-isr-partitions
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic payments --producer-property acks=1 <<EOF
pay-1
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic payments --from-beginning --max-messages 1
sim restart broker 2
sim restart broker 3
sim run 3s
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic payments --from-beginning --max-messages 1
```

```text
Created topic payments.
[sim] брокер 2 остановлен
[sim] брокер 3 остановлен
	Topic: payments	Partition: 0	Leader: 1	Replicas: 1,2,3	Isr: 1	Elr: N/A	LastKnownElr: N/A
(песочница: новых сообщений нет)
Processed a total of 0 messages
[sim] брокер 2 запущен, данные на диске сохранились
[sim] брокер 3 запущен, данные на диске сохранились
[sim] прошло 3000 мс виртуального времени
pay-1
Processed a total of 1 messages
```

Фильтр `--under-min-isr-partitions` показал партицию, у которой в `Isr` осталось меньше брокеров, чем требует порог. Запись с `acks=1` приняли: лидер порог не проверяет. Но потребитель её не увидел: HW не двигался, пока ISR была меньше порога. Когда брокеры вернулись и ISR восстановился, `pay-1` стала видна.

С `acks=all` та же запись не пройдёт. Продюсер повторяет запрос, пока не истечёт `delivery.timeout.ms` (120000 мс по умолчанию; подробнее об этом сроке — урок 3.3), и затем сообщает об ошибке. Повторим ту же аварию с `acks=all`; команда завершится с ошибкой, и вывод ниже показывает её текст.

```broker example
sim crash broker 2
sim crash broker 3
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic payments --producer-property acks=all <<EOF
pay-2
EOF
sim restart broker 2
sim restart broker 3
sim run 3s
```

```text
[sim] брокер 2 остановлен
[sim] брокер 3 остановлен
Error: record not sent to payments: REQUEST_TIMED_OUT: Expiring 1 record(s) for payments-0: 120000 ms has passed since batch creation
[sim] брокер 2 запущен, данные на диске сохранились
[sim] брокер 3 запущен, данные на диске сохранились
[sim] прошло 3000 мс виртуального времени
```

В журнале сценария причина видна как «в ISR 2 реплик, нужно 3: запись отклонена, ничего не записано» — это код 19.

### Потеря подтверждённой записи при acks=1

Сценарий-пример: приложение кликов пишет с `acks=1`. Фолловеры отстали, а затем лидер упал.

```scenario example
{
  "sim": "kafka",
  "seed": 1,
  "durationMs": 20000,
  "setup": "kafka-topics.sh --bootstrap-server localhost:9092 --create --topic clicks --partitions 1 --replication-factor 3",
  "actors": [
    { "id": "clicks-api", "kind": "producer", "topic": "clicks", "rate": 5, "count": 30, "message": { "body": "click {n}" }, "config": { "acks": 1 } }
  ],
  "faults": [
    { "at": 1000, "kind": "replica.stall", "broker": 2, "ms": 15000 },
    { "at": 1000, "kind": "replica.stall", "broker": 3, "ms": 15000 },
    { "at": 4000, "kind": "broker.crash", "broker": 1 }
  ],
  "expect": [ { "kind": "noLoss" } ]
}
```

Журнал отказов (первые строки):

```text
0      fault      controller    Создан топик clicks: 1 разд., фактор репликации 3
1000   fault      broker-2      Брокер 2: реплики-подписчики не забирают данные 15000 мс
1000   fault      broker-3      Брокер 3: реплики-подписчики не забирают данные 15000 мс
4000   fault      broker-1      Брокер 1 остановлен
4000   isr        controller    clicks-0: брокер 1 недоступен и выходит из ISR (2,3)
4000   drop       broker        clicks-0: запись clicks-api-6 (смещение 5) была подтверждена, но новый лидер её не получил
4000   drop       broker        clicks-0: запись clicks-api-7 (смещение 6) была подтверждена, но новый лидер её не получил
```

Отказ `broker.crash` с полем `broker` в момент `at` останавливает брокер, как команда `sim crash`. Условие `noLoss` означает, что ни одна запись, подтверждённая продюсеру, не потеряна. Итог:

- `noLoss`: не выполнено («Потеряно сообщений: 15»)

Фолловеры забирают данные только с 16-й секунды, а лидер упал на 4-й. Записи между 1-й и 4-й секундами были подтверждены лидером, но на новом лидере (брокер 2) их нет. После возврата старый лидер усечёт свой журнал до журнала нового. С `acks=all` продюсер не получил бы подтверждений на эти записи, повторил бы запросы к новому лидеру, и потерь не было бы.

### Недоступная партиция и unclean-выборы

Что будет, если из ISR остался один брокер и он упал? Партиция останется без лидера: брокеры вне ISR могли отстать, а выбрать их лидером значит потерять записи. Поэтому по умолчанию Kafka ждёт возвращения брокера из ISR. Это поведение задаёт настройка `unclean.leader.election.enable`:

- `false` (по умолчанию) — лидером может стать только реплика из ISR. Партиция недоступна, пока такая реплика не вернётся. Ничего не теряется.
- `true` — лидером может стать любая живая реплика. Партиция доступна, но подтверждённые записи, которых на этой реплике не было, пропадают.

Это выбор между доступностью и сохранностью данных. Для платежей и журналов аудита выбирают сохранность.

Настройка задаётся как любая настройка топика, например через `kafka-configs.sh --add-config unclean.leader.election.enable=true`. Фильтр `kafka-topics.sh --describe --unavailable-partitions` показывает партиции без лидера (`Leader: none`).

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic audit --partitions 1 --replication-factor 3
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic audit <<EOF
audit 1
EOF
sim crash broker 2
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic audit <<EOF
audit 2
EOF
sim crash broker 3
sim crash broker 1
sim restart broker 2
kafka-topics.sh --bootstrap-server localhost:9092 --describe --unavailable-partitions
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name audit --alter --add-config unclean.leader.election.enable=true
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic audit
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic audit --from-beginning --max-messages 5
```

```text
Created topic audit.
[sim] брокер 2 остановлен
[sim] брокер 3 остановлен
[sim] брокер 1 остановлен
[sim] брокер 2 запущен, данные на диске сохранились
	Topic: audit	Partition: 0	Leader: none	Replicas: 1,2,3	Isr: 1	Elr: N/A	LastKnownElr: N/A
	Topic: payments	Partition: 0	Leader: none	Replicas: 1,2,3	Isr: 1	Elr: N/A	LastKnownElr: N/A
Completed updating config for topic audit.
Topic: audit	TopicId: DilRcMlnTJ2a9X2ymXArgQ	PartitionCount: 1	ReplicationFactor: 3	Configs: unclean.leader.election.enable=true
	Topic: audit	Partition: 0	Leader: 2	Replicas: 1,2,3	Isr: 2	Elr: N/A	LastKnownElr: N/A
audit 1
(песочница: новых сообщений нет)
Processed a total of 1 messages
```

Запись `audit 2` была подтверждена, когда брокер 2 не работал, и лежала только на брокерах 1 и 3. Когда все трое остановились, а вернулся лишь брокер 2, партиция осталась без лидера (`Leader: none`, единственным в ISR был брокер 1). Включённый `unclean.leader.election.enable` сделал лидером брокер 2, и запись `audit 2` пропала.

Версии Kafka 4.1 и новее добавляют на новых кластерах механизм ELR, который уменьшает такие потери. Песочница его не моделирует: в выводе `--describe` поля `Elr` всегда `N/A`.

### Частые ошибки

- **Ошибка:** считать, что `acks=all` защищает от потери при любом ISR. **Верно:** `acks=all` ждёт все реплики из ISR, а ISR может сжаться до лидера. Защита появляется вместе с `min.insync.replicas=2`.
- **Ошибка:** ставить `min.insync.replicas` равным фактору репликации. **Верно:** тогда потеря любого брокера останавливает запись. Для фактора 3 берут порог 2.
- **Ошибка:** ожидать ошибку 19 при `acks=1`. **Верно:** порог проверяется только для `acks=all`.
- **Ошибка:** включить `unclean.leader.election.enable=true` ради доступности платёжного топика. **Верно:** вы согласились потерять подтверждённые платежи при тяжёлой аварии.

### Шпаргалка

- `acks=0` — без ответа (offset −1); `acks=1` — ответ после записи на лидере; `acks=all` — после достижения HW (по умолчанию).
- `min.insync.replicas` (по умолчанию 1) работает только с `acks=all`: ISR меньше порога — ошибка 19 (до записи) или 20 (запись в журнале есть).
- Схема «3 копии + порог 2 + `acks=all`»: переживает потерю одного брокера без потерь и без остановки записи.
- `--producer-property acks=all` — настройка продюсера в консоли.
- `kafka-configs.sh --entity-type topics --entity-name имя --alter --add-config min.insync.replicas=2`.
- `unclean.leader.election.enable=false` (по умолчанию): партиция недоступна, пока не вернётся реплика из ISR; `true`: доступна, но возможна потеря.

## task kfk-acks-safe-topic

```json
{
  "type": "topology",
  "title": "Топик платежей с порогом",
  "xp": 10,
  "hints": [
    "Раздел «min.insync.replicas»; настройки при создании топика — урок 1.2.",
    "Порог задаётся настройкой топика `min.insync.replicas`; её передают флагом `--config` при создании.",
    "`kafka-topics.sh --bootstrap-server localhost:9092 --create --topic payments --partitions … --replication-factor … --config min.insync.replicas=…`"
  ],
  "check": { "compare": ["topics", "configs"] }
}
```

Создайте топик `payments`: три партиции, три копии у каждой. Нужно, чтобы подтверждённая запись всегда лежала минимум на двух копиях: задайте порог `min.insync.replicas`, равный двум.

```broker starter
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic payments --partitions 3 --replication-factor 3
```

```broker solution
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic payments --partitions 3 --replication-factor 3 --config min.insync.replicas=2
```

## task kfk-acks-lost-payments

```json
{
  "type": "scenario",
  "title": "Платежи пропали после падения лидера",
  "xp": 25,
  "scenario": "w3-acks-loss",
  "hints": [
    "Раздел «Подтверждение и acks»: что значит подтверждение при `acks=1`.",
    "Платежи пропали, потому что продюсер получал подтверждения от лидера, у которого фолловеры ещё не забрали данные. Нужно, чтобы подтверждение приходило после достижения HW. За это отвечает `acks`.",
    "В окне свойств: `pay-api.acks=…`. Значения продюсера: `0`, `1`, `all`."
  ],
  "check": {}
}
```

Приложение `pay-api` пишет 40 платежей (`payment 1` … `payment 40`) в топик `payments` с тремя копиями и настройкой `acks=1`. `ledger` читает платежи для учёта. На 1000-й миллисекунде фолловеры на брокерах 2 и 3 перестают забирать данные на 20 секунд, на 4000-й падает брокер 1 (лидер). Часть платежей, которые `pay-api` считал принятыми, исчезла.

SLA: ни один подтверждённый платёж не пропадает, и `ledger` обрабатывает все 40 к 30000-й миллисекунде. Править нужно только свойства продюсера.

```properties starter
pay-api.acks=1
```

```properties solution
pay-api.acks=all
```

## task kfk-acks-booking-outage

```json
{
  "type": "scenario",
  "title": "Запись встала после падения одного брокера",
  "xp": 25,
  "scenario": "w3-min-isr-outage",
  "hints": [
    "Раздел «min.insync.replicas»: порог и фактор репликации.",
    "В топике три копии, а порог равен трём: после остановки любого брокера в ISR остаётся две реплики, и запись с `acks=all` отклоняется ошибкой 19. Порог нужно снизить так, чтобы один брокер мог выйти.",
    "`kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name bookings --alter --add-config min.insync.replicas=…`"
  ],
  "check": {}
}
```

Сервис бронирований: `booking-api` пишет 50 заявок в топик `bookings` (одна партиция, три копии, `acks=all`), `notifier` отправляет клиентам уведомления. Для надёжности кто-то поставил `min.insync.replicas=3`. На 3000-й миллисекунде брокер 3 останавливается, и запись прекращается: в журнале ошибка «в ISR 2 реплик, нужно 3».

SLA: `notifier` обработал все 50 заявок к 25000-й миллисекунде, причём подтверждённая заявка должна лежать минимум на двух копиях. Брокер остановить нельзя. Исправьте настройки так, чтобы SLA выполнялся.

```broker starter
# настройки топика не менялись
```

```broker solution
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name bookings --alter --add-config min.insync.replicas=2
```

## task kfk-acks-config-review

```json
{
  "type": "review",
  "title": "Настройки платёжного топика",
  "xp": 20,
  "hints": [
    "Разделы «min.insync.replicas» и «Недоступная партиция и unclean-выборы».",
    "Проверьте каждую строку: что произойдёт при падении лидера, если в ISR останется только он?",
    "Порог 1 разрешает подтверждение при ISR из одного лидера; `unclean.leader.election.enable=true` разрешает выбрать лидера вне ISR."
  ],
  "lines": [2, 3],
  "options": [
    "Строка 2: при `min.insync.replicas=1` подтверждение возможно, когда в ISR остался один лидер, и тогда запись лежит на одной копии",
    "Строка 3: `unclean.leader.election.enable=true` позволяет выбрать лидером реплику вне ISR, и подтверждённые платежи могут пропасть",
    "Строка 4: `acks=all` отменяет влияние строк 2 и 3, потерь быть не может",
    "Строка 1: фактор репликации 3 лишний, потому что брокеров всего три"
  ],
  "answer": [0, 1],
  "explanation": "Строка 2: `acks=all` ждёт реплики из ISR, а при пороге 1 ISR может состоять из одного лидера, так что подтверждение не гарантирует второй копии. Строка 3: при `true` лидером может стать отставшая реплика, и записи, которых у неё не было, исчезнут, хотя были подтверждены. Утверждение про строку 4 неверно: `acks=all` считает ISR, а ISR при таких настройках может сжаться до одного брокера. Утверждение про строку 1 неверно: три копии на трёх брокерах — обычный выбор, по копии на каждом брокере."
}
```

Для топика платежей, где терять подтверждённые записи нельзя, написаны настройки. Какие утверждения верны? Отметьте все верные.

```text code
1  topic payments: replication.factor=3
2  topic payments: min.insync.replicas=1
3  topic payments: unclean.leader.election.enable=true
4  producer pay-api: acks=all
```
