# Группы потребителей и назначение партиций

Магазин публикует заказы в топик `orders`. Их читают сразу несколько сервисов: биллинг выставляет счёт, рассылка отправляет письмо, аналитика копит статистику. Каждому нужны все заказы. А сама рассылка так нагружена, что ей нужно несколько копий, которые делят работу между собой. Обе задачи решает **группа потребителей**.

### Группа потребителей

Потребитель указывает идентификатор группы, `group.id`. Все потребители с одним идентификатором образуют группу.

- Каждая партиция топика в каждый момент читает **один** потребитель группы. Записи партиции не делятся между двумя участниками.
- Один потребитель может читать несколько партиций.
- Разные группы друг от друга независимы. Каждая получает все записи топика и хранит свои позиции.
- Позиция группы в партиции — закоммиченный offset: offset следующей записи, которую группа ещё не прочитала. Консольный потребитель с `--group` записывает его, когда завершается.

Отсюда два следствия. Чтобы несколько сервисов получили одни и те же записи, у каждого должна быть своя группа. Чтобы разделить работу между копиями сервиса, у всех копий должна быть одна группа. Ещё одно: участников больше, чем партиций, быть бессмысленно. Лишние ничего не получат и будут простаивать.

Пример. Два сервиса читают топик `letters` из двух партиций, каждый со своей группой. Затем сервис рассылки читает ещё раз той же группой.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic letters --partitions 2 --replication-factor 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic letters --reader-property parse.key=true --reader-property key.separator=: <<EOF
order-1:letter 1
order-2:letter 2
order-3:letter 3
order-4:letter 4
order-5:letter 5
order-6:letter 6
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic letters --group mailer --from-beginning --max-messages 6
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic letters --group analytics --from-beginning --max-messages 6
```

Результат (консоль читает партицию за партицией, поэтому порядок записей не по номерам):

```text
Created topic letters.
letter 1
letter 4
letter 5
letter 2
letter 3
letter 6
Processed a total of 6 messages
letter 1
letter 4
letter 5
letter 2
letter 3
letter 6
Processed a total of 6 messages
```

Обе группы прочитали все шесть записей: группы независимы. Теперь `mailer` читает ещё раз:

```broker example
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic letters --group mailer --from-beginning --max-messages 1
```

Результат:

```text
(песочница: новых сообщений нет)
Processed a total of 0 messages
```

Группа `mailer` уже прочитала всё и закоммитила позиции. Флаг `--from-beginning` действует только тогда, когда у группы ещё нет закоммиченных offset. Поэтому записей больше нет.

### Кто какие партиции получает

Распределение партиций между участниками группы называется **назначением**. Его считает стратегия назначения. Её задаёт свойство потребителя `partition.assignment.strategy` — список стратегий. Группа использует первую стратегию из списка, которую поддерживают все участники. По умолчанию список такой: `RangeAssignor, CooperativeStickyAssignor`, и если все участники оставили его, действует `range`.

Имена в списке — это имена классов клиента, например `org.apache.kafka.clients.consumer.RoundRobinAssignor`. В песочнице вместо них принимаются короткие имена: `range`, `roundrobin`, `sticky`, `cooperative-sticky`. Так записаны свойства в сценариях курса. Короткие имена — упрощение песочницы: в настоящей конфигурации клиента нужно писать полное имя класса.

Для нескольких стратегий хватит трёх правил. Участники упорядочены по идентификатору, партиции по номеру.

**Range.** Топики обрабатываются по одному. Для топика `P` партиций и `C` участников, подписанных на него: каждый получает `P / C` партиций подряд (целая часть), а первые `P % C` участников получают по одной лишней партиции. Лишние всегда достаются первым участникам.

**Round-robin.** Все партиции всех топиков (топики по алфавиту, партиции по возрастанию) раздаются по одному по кругу: первый участник, второй, третий, снова первый. Участник, не подписанный на топик, пропускается.

**Sticky и cooperative-sticky.** Сначала баланс: числа партиций у участников различаются не больше чем на один. Затем сохранение: партиция остаётся у прежнего владельца, если это не нарушает баланс. Cooperative-sticky отличается способом смены владельцев (урок 2.4).

Пример: три потребителя `c0`, `c1`, `c2` читают два топика, `orders` из четырёх партиций и `payments` из двух.

| Стратегия | `c0` | `c1` | `c2` |
|---|---|---|---|
| range | `orders-0`, `orders-1`, `payments-0` | `orders-2`, `payments-1` | `orders-3` |
| round-robin | `orders-0`, `orders-3` | `orders-1`, `payments-0` | `orders-2`, `payments-1` |

В range у `orders` четыре партиции на троих: каждому по одной, а `c0` ещё одна лишняя. У `payments` две партиции: первым двум по одной. Первому снова достаётся больше. Выходит 3, 2 и 1. Round-robin раздаёт все шесть партиций по кругу, и у каждого получается по два. Особенно заметна разница, когда топиков много, а партиций в каждом мало: range отдаёт первому потребителю по партиции из каждого топика.

Соответствие коротких имён классам:

| В песочнице | В настоящей Kafka |
|---|---|
| `range` | `org.apache.kafka.clients.consumer.RangeAssignor` |
| `roundrobin` | `org.apache.kafka.clients.consumer.RoundRobinAssignor` |
| `sticky` | `org.apache.kafka.clients.consumer.StickyAssignor` |
| `cooperative-sticky` | `org.apache.kafka.clients.consumer.CooperativeStickyAssignor` |

Новый протокол групп (KIP-848, `group.protocol=consumer`) считает назначение на стороне брокера и не использует `partition.assignment.strategy`. Песочница его не моделирует, и дальше в курсе речь о классическом протоколе. В версиях 4.x по умолчанию остаётся классический протокол (`group.protocol=classic`), новый включают явно.

### Назначение в сценарии

Разберём сценарий с тремя потребителями и топиком из четырёх партиций. Стратегию не задаём: действует `range`.

```scenario example
{
  "sim": "kafka",
  "seed": 1,
  "durationMs": 20000,
  "setup": "kafka-topics.sh --bootstrap-server localhost:9092 --create --topic parcels --partitions 4 --replication-factor 3",
  "actors": [
    { "id": "gate", "kind": "producer", "topic": "parcels", "rate": 20, "count": 40, "message": { "body": "parcel {n}", "key": "p-{n}" }, "config": {} },
    { "id": "sorter-a", "kind": "consumer", "group": "sorters", "topics": ["parcels"], "processMs": 20, "config": { "auto.offset.reset": "earliest" } },
    { "id": "sorter-b", "kind": "consumer", "group": "sorters", "topics": ["parcels"], "processMs": 20, "config": { "auto.offset.reset": "earliest" } },
    { "id": "sorter-c", "kind": "consumer", "group": "sorters", "topics": ["parcels"], "processMs": 20, "config": { "auto.offset.reset": "earliest" } }
  ],
  "faults": [],
  "expect": [ { "kind": "noLoss" }, { "kind": "processedAtLeast", "actor": "sorter-a", "count": 1, "byMs": 20000 } ]
}
```

В журнале видно назначение первого поколения группы:

```text
3000  rebalance  coordinator  sorters: поколение 1, стратегия range, лидер группы sorter-a посчитал назначение, SyncGroup раздал его
3000  assign     sorter-a     sorter-a: назначено parcels-0, parcels-1
3000  assign     sorter-b     sorter-b: назначено parcels-2
3000  assign     sorter-c     sorter-c: назначено parcels-3
```

Четыре партиции на троих: `sorter-a` получил лишнюю. Назначение появилось на отметке 3000 мс, а не сразу: новая группа ждёт появления остальных участников `group.initial.rebalance.delay.ms` (по умолчанию 3000 мс), чтобы не пересчитывать назначение при каждом входе. Обратите внимание на `лидер группы sorter-a посчитал назначение`: назначение считает один из потребителей, а не брокер. Брокер-координатор только собирает участников и раздаёт результат.

Если участников больше, чем партиций, лишние получают пустое назначение. Если заменить трёх потребителей пятью, журнал покажет `sorter-e: назначено ничего` — на них нечего читать.

### Частые ошибки

- **Ошибка:** запустить десять копий сервиса на топик из трёх партиций, чтобы «ускорить» его. **Верно:** работают только три копии. Число полезных участников группы не больше числа партиций. Нужна скорость — добавьте партиции (урок 2.1: ключи при этом могут переехать).
- **Ошибка:** дать двум разным сервисам один `group.id`. **Верно:** они поделят записи между собой, и каждый увидит только часть. У каждого сервиса, которому нужны все записи, своя группа.
- **Ошибка:** оставить `range` для группы, которая читает много топиков по одной партиции. **Верно:** все эти партиции получит первый участник. Для равномерности используйте `roundrobin` или `sticky`.
- **Ошибка:** ждать, что `--from-beginning` заставит прочитать топик заново группу, которая уже читала. **Верно:** флаг действует, только если у группы нет закоммиченных offset. Сброс позиций — урок 2.4.

### Шпаргалка

- Группа = общий `group.id`. Каждую партицию читает один участник группы; группы независимы.
- Участников больше, чем партиций: лишние простаивают.
- `partition.assignment.strategy`: по умолчанию `RangeAssignor, CooperativeStickyAssignor`, действует первая общая, то есть `range`. В песочнице короткие имена (`range`, `roundrobin`, `sticky`, `cooperative-sticky`), в настоящей Kafka имена классов.
- Range: по топикам, лишние партиции достаются первым. Round-robin: все партиции по кругу. Sticky: баланс, затем сохранение.
- Назначение считает потребитель-лидер, брокер только раздаёт.
- Новая группа ждёт `group.initial.rebalance.delay.ms` (3000 мс).
- Консоль: `kafka-console-consumer.sh … --group ГРУППА --from-beginning --max-messages N`.
- Фикс «мало партиций» в сценарии: команда `kafka-topics.sh … --alter --topic ТОПИК --partitions N` до запуска.

## task kfk-group-idle

```json
{
  "type": "scenario",
  "title": "Инцидент: принтеры простаивают",
  "xp": 20,
  "scenario": "w2-idle-printers",
  "hints": [
    "Раздел «Группа потребителей»: сколько участников группы могут читать топик одновременно.",
    "Четыре потребителя группы читают топик из двух партиций. Проверьте, сколько из них работает, и подумайте, чем можно увеличить число партиций до запуска.",
    "Шаблон: `kafka-topics.sh --bootstrap-server localhost:9092 --alter --topic labels --partitions …`."
  ]
}
```

На складе четыре принтера этикеток (потребители `printer-1`…`printer-4`, группа `printers`) читают топик `labels`, в котором две партиции. Печать одной этикетки занимает 100 мс. В 200 записей этикеток очередь копится: к 13-й секунде lag группы всё ещё больше 10.

Цель (SLA): к 13 000 мс виртуального времени суммарный lag группы `printers` не выше 10. Скорость записи и число потребителей менять нельзя. Исправьте топик командой консоли.

```broker starter
kafka-topics.sh --bootstrap-server localhost:9092 --alter --topic labels --partitions …
```

```broker solution
kafka-topics.sh --bootstrap-server localhost:9092 --alter --topic labels --partitions 4
```

## task kfk-assign-choice

```json
{
  "type": "choice",
  "title": "Range или round-robin",
  "xp": 10,
  "hints": [
    "Раздел «Кто какие партиции получает»: правила range и round-robin.",
    "Выпишите партиции: `emails-0`, `emails-1`, `sms-0`, `sms-1`. Раздайте их по правилу range (по топикам) и по правилу round-robin (по кругу) трём участникам.",
    "Range даёт каждому топику первых двух участников, третий остаётся без партиций. Round-robin идёт по кругу через все четыре партиции."
  ],
  "options": [
    "При range `c2` не получит ничего, при round-robin партиции получат все трое",
    "При range и при round-robin партиции получат все трое, по одной-две",
    "При range партиции получат все трое, при round-robin `c2` не получит ничего",
    "И при range, и при round-robin `c2` не получит ничего"
  ],
  "answer": [0],
  "explanation": "Range обрабатывает топики по очереди. В `emails` две партиции на троих: `c0` и `c1` получают по одной. В `sms` то же самое, и `c2` снова остаётся ни с чем: `c0` получает `emails-0` и `sms-0`, `c1` получает `emails-1` и `sms-1`, `c2` пуст. Round-robin раздаёт четыре партиции по кругу: `emails-0` в `c0`, `emails-1` в `c1`, `sms-0` в `c2`, `sms-1` в `c0`. Партиции есть у всех трёх."
}
```

Три потребителя `c0`, `c1`, `c2` одной группы подписаны на два топика: `emails` и `sms`, в каждом по две партиции. Как распределятся партиции?

## task kfk-strategy-incident

```json
{
  "type": "scenario",
  "title": "Инцидент: один бухгалтер за двоих",
  "xp": 20,
  "scenario": "w2-range-two-topics",
  "hints": [
    "Раздел «Кто какие партиции получает»: что делает range, когда у топиков по одной партиции.",
    "Оба потребителя читают два топика по одной партиции. Range отдаёт первому все такие партиции. Замените стратегию на ту, что раздаёт партиции по кругу, у обоих потребителей группы. Свойство называется `partition.assignment.strategy`.",
    "Шаблон: две строки `worker-1.partition.assignment.strategy=…` и `worker-2.partition.assignment.strategy=…` со значением из раздела «Кто какие партиции получает»."
  ]
}
```

Потребители `worker-1` и `worker-2` образуют группу `accounting` и читают два топика: `invoices` и `receipts`, в каждом по одной партиции. Каждая запись обрабатывается 100 мс. Потребитель `worker-1` не справляется, `worker-2` простаивает, lag растёт.

Цель (SLA): к 25 000 мс виртуального времени суммарный lag группы `accounting` не выше 10. Топики менять не нужно, исправьте свойства потребителей.

```properties starter
# worker-1.partition.assignment.strategy=…
# worker-2.partition.assignment.strategy=…
```

```properties solution
worker-1.partition.assignment.strategy=roundrobin
worker-2.partition.assignment.strategy=roundrobin
```

## task kfk-two-groups

```json
{
  "type": "console",
  "title": "Две группы читают один топик",
  "xp": 15,
  "hints": [
    "Раздел «Группа потребителей»: когда каждый сервис получает все записи.",
    "Сервисам нужны все записи, значит, у каждого своя группа. Запустите консольный потребитель дважды с разными значениями `--group`.",
    "Шаблон: `kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders --group … --from-beginning --max-messages 6`, и ещё раз с другой группой."
  ],
  "check": {
    "compare": ["offsets"]
  }
}
```

В топике `orders` лежат шесть заказов. Сервису `billing` нужны все шесть, сервису `mailer` тоже все шесть. Прочитайте топик консольным потребителем сначала группой `billing`, затем группой `mailer`, каждый раз с начала и все шесть записей.

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic orders --partitions 2 --replication-factor 3
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic orders --reader-property parse.key=true --reader-property key.separator=: <<EOF
o-1:order 1
o-2:order 2
o-3:order 3
o-4:order 4
o-5:order 5
o-6:order 6
EOF
```

```broker starter
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders --group billing --from-beginning --max-messages 6
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders --group … --from-beginning --max-messages 6
```

```broker solution
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders --group billing --from-beginning --max-messages 6
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic orders --group mailer --from-beginning --max-messages 6
```
