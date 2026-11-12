# Репликация, ISR и HW

Служба доставки пишет в Kafka каждую отметку курьера: «забрал посылку», «в пути», «вручил». Брокер, на котором лежит журнал, может выйти из строя, а отметки терять нельзя. Поэтому каждая партиция хранится в нескольких копиях на разных брокерах. В этом уроке вы узнаете, как копии поддерживают друг друга в актуальном состоянии, что такое ISR и high watermark и почему потребитель иногда не видит записи, которые уже лежат на диске лидера.

### Лидер и фолловеры

В уроке 1.2 вы видели в выводе `--describe` слова `Leader`, `Replicas` и `Isr`. Теперь разберём их до конца.

- У каждой партиции есть **реплики** (replicas) — копии её журнала на разных брокерах. Их число равно фактору репликации (`--replication-factor`).
- Одна реплика — **лидер** (leader). Все записи и чтение идут через неё.
- Остальные реплики — **фолловеры** (followers). Фолловер сам запрашивает у лидера новые записи, как потребитель, и дописывает их в свой журнал в том же порядке и с теми же offset.
- Если лидер недоступен, контроллер кластера (узел, управляющий метаданными; урок 5.2) назначает лидером другую реплику. Этот выбор называется **выборами лидера**.

Два числа описывают состояние журнала на каждой реплике:

- **LEO** (log end offset) — offset, который получит следующая запись. Если в журнале записи с offset от 0 до 4, то LEO равен 5.
- **HW** (high watermark) — offset, ниже которого запись есть на всех репликах из ISR. Такие записи считаются **закоммиченными** (committed). Потребитель читает только записи ниже HW.

### ISR

**ISR** (in-sync replicas) — множество реплик, которые успевают за лидером. Лидер всегда входит в ISR.

- Фолловер остаётся в ISR, пока он забирает данные. Если он не дотянулся до LEO лидера за `replica.lag.time.max.ms` (по умолчанию 30000 мс, то есть 30 секунд), лидер исключает его из ISR.
- Фолловер, который полностью догнал лидера, из ISR не исключается, даже если лидер давно молчит: отставания нет.
- Недоступный брокер тоже выходит из ISR. В песочнице это происходит сразу при остановке брокера.
- Когда фолловер снова догнал лидера, он возвращается в ISR.

HW вычисляется по ISR: это минимум LEO среди реплик из ISR. Пока медленный фолловер состоит в ISR, он удерживает HW на месте, и потребители ждут. Когда он исключён из ISR, HW сразу сдвигается.

### Описание партиции и фильтры

Поля `Leader`, `Replicas` и `Isr` команды `--describe` показывают текущее состояние:

```text
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic имя
kafka-topics.sh --bootstrap-server localhost:9092 --describe --under-replicated-partitions
```

- `Leader` — брокер-лидер. Если лидера нет, печатается `none`.
- `Replicas` — все брокеры с копиями, первый — предпочтительный лидер.
- `Isr` — брокеры, которые сейчас успевают за лидером.
- `--under-replicated-partitions` — печатает только те партиции (всех топиков или одного, если добавлен `--topic имя`), у которых в `Isr` меньше брокеров, чем в `Replicas`. Это первая проверка при подозрении на проблемы с репликацией.

Есть и другие фильтры: `--under-min-isr-partitions` (ISR меньше порога, см. урок 3.2) и `--unavailable-partitions` (лидера нет).

### Управление брокерами в песочнице

В настоящем кластере брокеры падают сами. Песочница позволяет делать это командами `sim`. Они работают только в лаборатории.

```text
sim crash broker N
sim restart broker N
sim stall broker N 40s
sim run 10s
```

- `sim crash broker N` останавливает брокер `N` (1, 2 или 3). Его данные на диске сохраняются.
- `sim restart broker N` запускает брокер снова. Он догоняет лидеров по своим партициям.
- `sim stall broker N 40s` — фолловеры на брокере `N` перестают забирать данные на 40 секунд. Сам брокер работает, как будто у него перегружена сеть.
- `sim run 10s` — продвигает виртуальное время на 10 секунд. Без него время стоит: исключение из ISR и возврат происходят, только когда часы идут.

Время задают числом и единицей: `500ms`, `10s`.

### Что происходит при падении лидера

Правило песочницы упрощено: новым лидером становится первая живая реплика из ISR в порядке списка `Replicas`. Выборы проходят мгновенно, а прежний лидер, вернувшись, становится фолловером и не отбирает лидерство сам.

Пример. Топик отметок курьеров с тремя копиями, две записи, затем остановка брокера-лидера.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic deliveries --partitions 1 --replication-factor 3
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic deliveries <<EOF
parcel 1 picked up
parcel 2 picked up
EOF
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic deliveries
sim crash broker 1
kafka-topics.sh --bootstrap-server localhost:9092 --describe --under-replicated-partitions --topic deliveries
sim restart broker 1
sim run 5s
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic deliveries
```

```text
Created topic deliveries.
Topic: deliveries	TopicId: ewQK1hwOST-cEbqAp2Y0uw	PartitionCount: 1	ReplicationFactor: 3	Configs:
	Topic: deliveries	Partition: 0	Leader: 1	Replicas: 1,2,3	Isr: 1,2,3	Elr: N/A	LastKnownElr: N/A
[sim] брокер 1 остановлен
	Topic: deliveries	Partition: 0	Leader: 2	Replicas: 1,2,3	Isr: 2,3	Elr: N/A	LastKnownElr: N/A
[sim] брокер 1 запущен, данные на диске сохранились
[sim] прошло 5000 мс виртуального времени
Topic: deliveries	TopicId: ewQK1hwOST-cEbqAp2Y0uw	PartitionCount: 1	ReplicationFactor: 3	Configs:
	Topic: deliveries	Partition: 0	Leader: 2	Replicas: 1,2,3	Isr: 2,3,1	Elr: N/A	LastKnownElr: N/A
```

Сначала лидер брокер 1 и `Isr: 1,2,3`. После остановки брокера 1 лидером стал брокер 2, первый живой из `Replicas`, а `Isr` сократился до `2,3`. Партиция недореплицирована (under-replicated), поэтому фильтр её показал. После возврата брокер 1 догнал лидера, вошёл в ISR (в конец списка) и стал фолловером: лидер остался брокером 2.

### Медленная реплика и HW

Теперь важный случай. Брокеры живы, но фолловеры отстают, например из-за перегрузки сети. Пока они в ISR, HW стоит на месте, потому что запись ещё не на всех репликах ISR. Потребитель ничего нового не видит. Через `replica.lag.time.max.ms` лидер исключит отстающих, HW сдвинется, и потребитель прочитает накопленное.

Этот параметр можно менять на уровне всех брокеров:

```text
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type brokers --entity-default --alter --add-config replica.lag.time.max.ms=5000
```

- `--entity-type brokers` — менять настройки брокеров, а не топиков.
- `--entity-default` — для всех брокеров кластера сразу.
- `--alter --add-config имя=значение` — задать значение. Команда печатает `Completed updating default config for brokers in the cluster.`

Короткий срок быстрее исключает медленные реплики и уменьшает паузу для потребителей. Но на нагруженном кластере краткий скачок задержки выбьет из ISR и здоровые реплики, а возвращаться им придётся. Значение выбирают, взвесив эти два риска.

Сценарий-пример: приложение курьеров шлёт две отметки в секунду, карта читает их. На 2000-й миллисекунде брокер 3 перестаёт забирать данные на 60 секунд.

```scenario example
{
  "sim": "kafka",
  "seed": 1,
  "durationMs": 40000,
  "setup": "kafka-topics.sh --bootstrap-server localhost:9092 --create --topic tracking --partitions 1 --replication-factor 3",
  "actors": [
    { "id": "courier-app", "kind": "producer", "topic": "tracking", "rate": 2, "count": 20, "message": { "body": "position {n}" }, "config": { "acks": "all" } },
    { "id": "live-map", "kind": "consumer", "group": "live-map", "topics": ["tracking"], "processMs": 20, "config": { "auto.offset.reset": "earliest" } }
  ],
  "faults": [ { "at": 2000, "kind": "replica.stall", "broker": 3, "ms": 60000 } ],
  "expect": [
    { "kind": "processedAtLeast", "actor": "live-map", "count": 20, "byMs": 15000 }
  ]
}
```

В блоке `faults` отказ `replica.stall` с полями `broker` и `ms` (формат `faults` — урок 2.4) останавливает фолловеров на брокере `broker` на `ms` миллисекунд. Это тот же отказ, что команда `sim stall`. Настройка `acks` у продюсера — тема урока 3.2; здесь важно только, что продюсер получает подтверждения.

Журнал событий ISR и отказов:

```text
0      fault      controller    Создан топик tracking: 1 разд., фактор репликации 3
2000   fault      broker-3      Брокер 3: реплики-подписчики не забирают данные 60000 мс
32500  isr        broker-1      tracking-0: реплика на брокере 3 не догоняла лидера более 30000 мс и выходит из ISR (теперь 1,2)
```

Сценарий проверяет условия `expect`. `processedAtLeast` означает, что потребитель обработал не меньше заданного числа записей к указанному сроку (в миллисекундах виртуального времени). Итог:

- `processedAtLeast`: не выполнено («live-map: обработано 4 из 20 к 15000 мс»)

Брокер 3 отстал на 2000-й миллисекунде и пробыл в ISR до исключения. Всё это время HW не двигался, и `live-map` ничего не получал, хотя `courier-app` получал подтверждения. Это прямое следствие правила «читать можно только ниже HW».

### Частые ошибки

- **Ошибка:** считать, что запись, лежащая на диске лидера, сразу видна потребителю. **Верно:** потребитель видит записи ниже HW, то есть те, что есть на всех репликах ISR.
- **Ошибка:** думать, что `acks=1` ускорит чтение медленной партиции. **Верно:** `acks` влияет на то, когда ответ получит продюсер; HW и видимость для потребителя от него не зависят (урок 3.2).
- **Ошибка:** после падения брокера ждать, что прежний лидер сам вернёт лидерство. **Верно:** в песочнице он возвращается фолловером; лидер остаётся прежним, пока не упадёт.
- **Ошибка:** смотреть только на `Replicas` и считать партицию здоровой. **Верно:** здоровье показывает `Isr`: если в нём меньше брокеров, чем в `Replicas`, партиция недореплицирована (under-replicated).

### Шпаргалка

- Реплики: лидер плюс фолловеры; фолловеры забирают записи у лидера.
- LEO — offset следующей записи; HW — минимум LEO среди ISR; читать можно ниже HW.
- Из ISR реплику исключают: отставание дольше `replica.lag.time.max.ms` (30000 мс) или недоступность брокера.
- Новый лидер — первая живая реплика из ISR по порядку `Replicas` (упрощено).
- `kafka-topics.sh --describe [--under-replicated-partitions]` — состояние партиций.
- `sim crash|restart broker N`, `sim stall broker N 40s`, `sim run 10s` — только в лаборатории.
- `kafka-configs.sh --entity-type brokers --entity-default --alter --add-config replica.lag.time.max.ms=5000`.

## task kfk-rep-ledger-topic

```json
{
  "type": "topology",
  "title": "Топик с тремя копиями",
  "xp": 10,
  "hints": [
    "Раздел «Лидер и фолловеры» и урок 1.2, «Создание топика с несколькими партициями».",
    "Нужна команда `kafka-topics.sh --create`; число копий задаёт `--replication-factor`.",
    "`kafka-topics.sh --bootstrap-server localhost:9092 --create --topic … --partitions … --replication-factor …`"
  ],
  "check": { "compare": ["topics"] }
}
```

Бухгалтерской системе нужен топик `ledger`: две партиции, у каждой три копии, по одной на каждом брокере кластера. Создайте его.

```broker starter
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic ledger --partitions 2 --replication-factor 1
```

```broker solution
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic ledger --partitions 2 --replication-factor 3
```

## task kfk-rep-leader-fails

```json
{
  "type": "console",
  "title": "Запись при упавшем лидере",
  "xp": 15,
  "hints": [
    "Раздел «Что происходит при падении лидера».",
    "Узнайте лидера командой `--describe`, остановите его через `sim crash broker`, затем запишите запись и верните брокер через `sim restart broker`.",
    "`sim crash broker …`, затем `kafka-console-producer.sh … --topic orders <<EOF` с записью `order-4`, затем `sim restart broker …`."
  ],
  "check": {
    "compare": ["messages"],
    "require": [
      { "pattern": "sim crash broker 1", "message": "Остановите брокера, который лидер партиции orders-0 (поле Leader в --describe)" },
      { "pattern": "sim restart broker 1", "message": "Верните остановленный брокер командой sim restart broker" }
    ]
  }
}
```

В топике `orders` три записи: `order-1`, `order-2`, `order-3`. У партиции три копии. Остановите брокера, который сейчас её лидер, запишите в `orders` запись `order-4` и верните брокера в строй.

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic orders --partitions 1 --replication-factor 3 --config min.insync.replicas=2
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic orders <<EOF
order-1
order-2
order-3
EOF
```

```broker starter
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic orders
```

```broker solution
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic orders
sim crash broker 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic orders <<EOF
order-4
EOF
sim restart broker 1
```

## task kfk-rep-stalled-follower

```json
{
  "type": "scenario",
  "title": "Склад не видит заказы 30 секунд",
  "xp": 25,
  "scenario": "w3-stalled-follower",
  "hints": [
    "Разделы «ISR» и «Медленная реплика и HW».",
    "Потребитель ждёт, пока HW не сдвинется, а он ждёт исключения отстающих реплик из ISR. Срок исключения задаёт `replica.lag.time.max.ms`. Менять `acks` бесполезно: HW от него не зависит.",
    "Команда на уровне всех брокеров: `kafka-configs.sh --bootstrap-server localhost:9092 --entity-type brokers --entity-default --alter --add-config replica.lag.time.max.ms=…`."
  ],
  "check": {}
}
```

Интернет-магазин: `shop-api` пишет заказы в топик `orders` (одна партиция, три копии, `acks=all`), `shipping` читает их для склада. На 2000-й миллисекунде фолловеры на брокерах 2 и 3 перестают забирать данные на 90 секунд. Склад видит заказы с большой задержкой, хотя `shop-api` получает подтверждения.

SLA: все 60 заказов должны быть обработаны к 15000-й миллисекунде, и ничто не должно потеряться. Сбой самих брокеров остановить нельзя. Исправьте настройки кластера так, чтобы SLA выполнялся.

```broker starter
# настройки кластера не менялись
```

```broker solution
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type brokers --entity-default --alter --add-config replica.lag.time.max.ms=5000
```

## task kfk-rep-read-isr

```json
{
  "type": "choice",
  "title": "Что показывает describe",
  "xp": 10,
  "hints": [
    "Разделы «ISR» и «Описание партиции и фильтры».",
    "Сравните `Replicas` и `Isr`: чего не хватает в `Isr`?",
    "Если брокера нет в `Isr`, он не успевает за лидером или недоступен."
  ],
  "options": [
    "Партиция недоступна: лидера нет",
    "Брокер 1 вышел из ISR: он отстаёт или недоступен, а лидер брокер 2 работает с копией брокера 3",
    "Брокер 1 стал лидером, а брокеры 2 и 3 — его фолловеры",
    "Данные на брокере 1 потеряны безвозвратно"
  ],
  "answer": [1],
  "explanation": "Строка `Leader: 2  Replicas: 1,2,3  Isr: 2,3` говорит, что лидер есть (брокер 2), а брокера 1 в ISR нет: он остановлен или не успевает за лидером. Это недореплицированная партиция. Лидером брокер 1 не стал: лидер указан в поле `Leader`. Данные на брокере 1 не потеряны: в песочнице при остановке они сохраняются на диске, и после возврата брокер догонит лидера и вернётся в ISR."
}
```

`kafka-topics.sh --describe --topic payments` вывел строку партиции:

```text
Topic: payments	Partition: 0	Leader: 2	Replicas: 1,2,3	Isr: 2,3
```

Что из этого следует?
