# Ребаланс и lag

Сервис пуш-уведомлений читает топик `notices` группой из трёх копий. Одна копия упала, и уведомления стали приходить с опозданием в минуту, потом в две. Чтобы разобраться, нужно знать две вещи: как группа перераспределяет партиции, когда состав участников меняется (**ребаланс**), и как измерить отставание группы (**lag**).

### Когда случается ребаланс

Ребаланс — это пересчёт назначения партиций между участниками группы. Он начинается, когда:

- в группу входит новый участник или участник вышел сам (остановился штатно);
- участник перестал присылать **heartbeat** (сигнал «я жив») дольше `session.timeout.ms`. По умолчанию heartbeat идёт каждые `heartbeat.interval.ms` = 3000 мс, а терпение координатора — 45000 мс;
- участник не вызывал `poll()` дольше `max.poll.interval.ms` (по умолчанию 300000 мс): считается, что он завис, и его исключают. `poll()` — вызов, которым потребитель забирает очередную пачку записей (не больше `max.poll.records`, по умолчанию 500);
- у топика изменилось число партиций (клиенты узнают об этом при обновлении метаданных, `metadata.max.age.ms`, по умолчанию 300000 мс).

Заметьте разницу: штатный выход заметен сразу, а упавший процесс — только когда истечёт `session.timeout.ms`. Пока он не исключён, его партиции никто не читает, и lag на них растёт.

### Eager и cooperative

В классическом протоколе есть два способа менять владельцев.

**Eager** (так работают `range`, `roundrobin`, `sticky`). Все участники отдают все свои партиции и заново входят в группу (`JoinGroup`). Лидер группы считает назначение, а `SyncGroup` раздаёт его. Всё время ребаланса группа не читает ничего. Участники узнают о смене из вызовов внутри `poll()`: сначала `onPartitionsRevoked`, затем `onPartitionsAssigned`.

**Cooperative** (`cooperative-sticky`). Участники сохраняют те партиции, которые не меняют владельца. Партиция, которая переходит к другому, сначала отзывается у старого владельца и отдаётся новому только в следующем ребалансе. То есть ребалансов получается два, но остановка касается лишь переезжающих партиций.

Проверим на сценарии. Три погрузчика читают топик `crates` из четырёх партиций, на 8-й секунде `loader-b` останавливается.

```scenario example
{
  "sim": "kafka",
  "seed": 1,
  "durationMs": 20000,
  "setup": "kafka-topics.sh --bootstrap-server localhost:9092 --create --topic crates --partitions 4 --replication-factor 3",
  "actors": [
    { "id": "dock", "kind": "producer", "topic": "crates", "rate": 20, "count": 40, "message": { "body": "crate {n}", "key": "c-{n}" }, "config": {} },
    { "id": "loader-a", "kind": "consumer", "group": "loaders", "topics": ["crates"], "processMs": 20, "config": { "auto.offset.reset": "earliest" } },
    { "id": "loader-b", "kind": "consumer", "group": "loaders", "topics": ["crates"], "processMs": 20, "config": { "auto.offset.reset": "earliest" } },
    { "id": "loader-c", "kind": "consumer", "group": "loaders", "topics": ["crates"], "processMs": 20, "config": { "auto.offset.reset": "earliest" } }
  ],
  "faults": [ { "at": 8000, "kind": "consumer.stop", "actor": "loader-b" } ],
  "expect": [ { "kind": "noLoss" }, { "kind": "processedAtLeast", "actor": "loader-a", "count": 1, "byMs": 20000 } ]
}
```

В блоке `faults` каждая запись — отказ в заданный момент: `at` — время в мс, `kind` — тип, `actor` — участник. `consumer.stop` останавливает потребителя штатно: он выходит из группы. Журнал при стратегии по умолчанию (`range`, eager):

```text
8000  rebalance  coordinator  loaders: начат ребаланс — loader-b ушёл (остановлен)
9020  revoke     loader-c     loader-c: eager-ребаланс, отдаёт все разделы (crates-3) и заново входит в группу
9020  revoke     loader-a     loader-a: eager-ребаланс, отдаёт все разделы (crates-0, crates-1) и заново входит в группу
9020  rebalance  coordinator  loaders: поколение 2, стратегия range, лидер группы loader-a посчитал назначение, SyncGroup раздал его
9020  assign     loader-a     loader-a: назначено crates-0, crates-1
9020  assign     loader-c     loader-c: назначено crates-2, crates-3
```

Оба оставшихся участника отдали все партиции, хотя их собственные партиции никуда не переезжали. Если указать `loader-a.partition.assignment.strategy=cooperative-sticky` (так же для остальных; короткое имя — упрощение песочницы, в настоящей Kafka это имя класса, урок 2.3), строк `revoke` не будет: `loader-a` оставит `crates-0` и `crates-3`, а освободившиеся партиции `loader-b` достанутся `loader-c`. Участники читают свои партиции и во время смены владельцев.

Честная оговорка: песочница упрощает сроки ребаланса и алгоритм sticky. Если в группе умирает участник без выхода, cooperative не спасёт: партиции умершего всё равно ждут `session.timeout.ms` в обоих режимах. Статические участники (`group.instance.id`) и новый протокол KIP-848 песочница не моделирует. Это теория: статический участник при перезапуске сохраняет партиции, пока не истечёт `session.timeout.ms`, а новый протокол делает ребаланс инкрементальным без общей остановки.

### Lag

Lag партиции — это сколько записей группа ещё не прочитала:

```text
lag = LOG-END-OFFSET − закоммиченный offset (CURRENT-OFFSET)
```

- `LOG-END-OFFSET` — offset, который получит следующая запись, то есть конец партиции.
- `CURRENT-OFFSET` — закоммиченный offset группы: что она уже подтвердила. Если у группы нет коммитов, в столбце LAG стоит `-`.
- Lag группы — сумма по партициям.

Важная деталь: lag считается по коммитам, а не по тому, что потребитель уже прочитал. Автокоммит срабатывает внутри `poll()` раз в `auto.commit.interval.ms` (5000 мс), поэтому lag на графике уменьшается ступеньками, а у только что запущенной группы он может быть большим, хотя потребитель уже читает.

Посмотреть lag можно командой `kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group ГРУППА` (столбцы и строка `has no active members` разобраны в уроке 1.3).

Группа `pusher` читает топик `notices` из двух партиций и успевает прочитать четыре записи из шести:

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic notices --partitions 2 --replication-factor 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic notices --reader-property parse.key=true --reader-property key.separator=: <<EOF
order-1:notice 1
order-2:notice 2
order-3:notice 3
order-4:notice 4
order-5:notice 5
order-6:notice 6
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic notices --group pusher --from-beginning --max-messages 4
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group pusher
```

Результат:

```text
Created topic notices.
notice 1
notice 4
notice 5
notice 2
Processed a total of 4 messages
Consumer group 'pusher' has no active members.
GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID     HOST            CLIENT-ID
pusher          notices         0          3               3               0               -               -               -
pusher          notices         1          1               3               2               -               -               -
```

Консоль читает топик партиция за партицией (урок 2.1), поэтому записи 1, 4 и 5 идут первыми. В партиции 0 все три записи прочитаны, lag 0. В партиции 1 прочитана одна запись из трёх, закоммиченный offset 1, lag 2. Общий lag группы — 2. Участников нет: консоль завершилась, и группа пуста.

### Сброс позиции группы

Иногда группе нужно перечитать записи или, наоборот, пропустить. Для этого закоммиченные offset группы переставляют. Команда, способы сброса и пробный прогон без `--execute` описаны в уроке 1.3, здесь они повторяются на новых данных:

```text
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group ГРУППА --topic ТОПИК --reset-offsets СПОСОБ [--execute]
```

- Дополнительно к уроку 1.3: вместо `--topic ТОПИК` можно указать `--all-topics` (все топики группы), а способ `--to-current` оставляет текущие позиции без изменений.
- Группа должна быть без участников: у работающей группы сбросить offset нельзя.

```broker example
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group pusher --topic notices --reset-offsets --to-offset 1
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group pusher
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group pusher --topic notices --reset-offsets --to-offset 1 --execute
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group pusher
```

Результат:

```text
GROUP           TOPIC           PARTITION  NEW-OFFSET
pusher          notices         0          1
pusher          notices         1          1
Consumer group 'pusher' has no active members.
GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID     HOST            CLIENT-ID
pusher          notices         0          3               3               0               -               -               -
pusher          notices         1          1               3               2               -               -               -
GROUP           TOPIC           PARTITION  NEW-OFFSET
pusher          notices         0          1
pusher          notices         1          1
Consumer group 'pusher' has no active members.
GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID     HOST            CLIENT-ID
pusher          notices         0          1               3               2               -               -               -
pusher          notices         1          1               3               2               -               -               -
```

Пробный прогон показал новые offset, но `describe` после него видит старые. После `--execute` offset в обеих партициях равны 1, lag по два.

### Где потребитель начнёт читать

Если у группы нет закоммиченного offset (новая группа) или он вне диапазона, срабатывает свойство `auto.offset.reset` (урок 1.3): `latest` по умолчанию, `earliest`, `none`. При наличии коммита свойство не действует.

### Сценарии-инциденты урока

- **Упал участник.** Его партиции не читаются, пока координатор не исключит его по `session.timeout.ms`. Уменьшение этого срока ускоряет восстановление, но делает группу чувствительной к коротким паузам.
- **Потребитель не успевает вызвать `poll()`.** Каждый `poll()` отдаёт до `max.poll.records` записей (по умолчанию 500). Если их обработка длится дольше `max.poll.interval.ms`, участник исключается, партиция переходит к другому, а offset не успел закоммититься. Новый владелец перечитывает уже обработанные записи, получаются дубли. Лечится меньшим `max.poll.records` или большим `max.poll.interval.ms`.

Свойства в заданиях пишутся как в уроке 2.2: `актёр.свойство=значение`. Сценарий с отказами использует `consumer.crash` — потребитель падает, не выходя из группы (молча).

### Частые ошибки

- **Ошибка:** считать, что lag равен количеству непрочитанных записей на текущий момент. **Верно:** lag считается по закоммиченным offset, а автокоммит срабатывает раз в 5 секунд.
- **Ошибка:** сбрасывать offset при работающем потребителе. **Верно:** сначала остановить всех участников группы: команда работает только с пустой группой.
- **Ошибка:** запустить `--reset-offsets` без `--execute` и решить, что offset изменены. **Верно:** без `--execute` печатается только план.
- **Ошибка:** ставить огромный `max.poll.records` при долгой обработке записи. **Верно:** `max.poll.records × время обработки` должно укладываться в `max.poll.interval.ms`.

### Шпаргалка

- Ребаланс: вход, выход, нет heartbeat `session.timeout.ms` (45000), нет `poll()` `max.poll.interval.ms` (300000), смена числа партиций.
- Eager отзывает все партиции у всех. Cooperative-sticky отзывает только переезжающие, в два шага.
- Упавший участник держит партиции до `session.timeout.ms`, потом ребаланс.
- Lag = `LOG-END-OFFSET − CURRENT-OFFSET`, по коммитам; автокоммит каждые 5000 мс.
- `kafka-consumer-groups.sh --describe --group G`.
- Сброс: `--reset-offsets --group G --topic T --to-earliest|--to-latest|--to-offset N|--shift-by N`, пробный прогон без `--execute`, только для пустой группы.
- `auto.offset.reset` (`latest` по умолчанию) работает, только когда нет коммита.

## task kfk-reset-offsets

```json
{
  "type": "console",
  "title": "Перечитать всё с начала",
  "xp": 15,
  "hints": [
    "Раздел «Сброс позиции группы»: способы и ключ, который применяет сброс.",
    "Нужен способ сброса «в начало» и ключ `--execute`, иначе будет только пробный прогон. Группа `sender` пуста, поэтому сброс разрешён.",
    "Шаблон: `kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group sender --topic mails --reset-offsets … --execute`."
  ],
  "check": {
    "compare": ["offsets"]
  }
}
```

Группа `sender` рассылает письма из топика `mails` (две партиции, шесть писем) и уже прочитала четыре. Из-за ошибки в шаблоне все письма ушли пустыми. Сделайте так, чтобы группа `sender` прочитала топик заново с самого начала. Группа сейчас не работает.

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic mails --partitions 2 --replication-factor 3
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic mails --reader-property parse.key=true --reader-property key.separator=: <<EOF
m-1:mail 1
m-2:mail 2
m-3:mail 3
m-4:mail 4
m-5:mail 5
m-6:mail 6
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic mails --group sender --from-beginning --max-messages 4
```

```broker starter
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group sender --topic mails --reset-offsets --to-earliest
```

```broker solution
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --group sender --topic mails --reset-offsets --to-earliest --execute
```

## task kfk-crash-incident

```json
{
  "type": "scenario",
  "title": "Инцидент: упавший штабелёр держит партиции",
  "xp": 20,
  "scenario": "w2-crashed-loader",
  "hints": [
    "Раздел «Когда случается ребаланс»: через сколько брокер исключает молчащего участника.",
    "Упавший `stacker-b` держит партиции, пока не истечёт его `session.timeout.ms` (по умолчанию 45000 мс). Уменьшите этот срок у него.",
    "Шаблон: строка `stacker-b.session.timeout.ms=…` со значением в миллисекундах заметно меньше 45000."
  ]
}
```

Группа `stackers` из двух потребителей читает топик `pallets` (4 партиции). На 10-й секунде `stacker-b` падает вместе с процессом и не выходит из группы. Пока его не исключат, партиции стоят, и очередь копится.

Цель (SLA): к 40 000 мс виртуального времени суммарный lag группы `stackers` не выше 60. Падение остаётся в сценарии. Исправьте свойства потребителя, который падает.

```properties starter
# stacker-b.session.timeout.ms=…
```

```properties solution
stacker-b.session.timeout.ms=10000
```

## task kfk-poll-incident

```json
{
  "type": "scenario",
  "title": "Инцидент: экспортёр вылетает из группы",
  "xp": 20,
  "scenario": "w2-slow-exporter",
  "hints": [
    "Раздел «Сценарии-инциденты урока»: что происходит, если обработка пачки дольше `max.poll.interval.ms`.",
    "Потребитель берёт за один `poll()` столько записей, сколько накопилось (до `max.poll.records`), и обрабатывает их по секунде. Уменьшите размер пачки.",
    "Шаблон: строка `exporter.max.poll.records=…` с числом, при котором пачка обрабатывается быстрее 10 секунд."
  ]
}
```

Потребитель `exporter` группы `exports` обрабатывает каждую запись топика `exports` за 1 секунду. В его конфигурации `max.poll.interval.ms=10000`, а `max.poll.records` не задан, то есть равен 500. Журнал полон строк «участник исключён из группы», и часть записей обрабатывается дважды.

Цель (SLA): за 120 000 мс виртуального времени потребитель обработал все 100 записей, и ни одна не обработана повторно. Исправьте свойства потребителя.

```properties starter
# exporter.max.poll.records=…
```

```properties solution
exporter.max.poll.records=5
```

## task kfk-rebalance-choice

```json
{
  "type": "choice",
  "title": "Что происходит при падении участника",
  "xp": 10,
  "hints": [
    "Разделы «Когда случается ребаланс» и «Eager и cooperative».",
    "Различайте штатный выход и падение: когда координатор узнаёт о каждом из них. Подумайте, что делает cooperative с партициями умершего.",
    "Верный ответ говорит о паузе до `session.timeout.ms` и о том, что остальные участники при eager тоже отдают партиции."
  ],
  "options": [
    "Брокер замечает падение мгновенно, и ребаланс идёт без паузы",
    "Партиции упавшего ждут до `session.timeout.ms`, потом начинается ребаланс, при eager все участники отдают свои партиции",
    "Стратегия `cooperative-sticky` убирает паузу: партиции упавшего сразу переходят к другим",
    "Lag не растёт: записи просто остаются в Kafka и ничего не отстаёт"
  ],
  "answer": [1],
  "explanation": "Упавший процесс не сообщает о выходе, поэтому брокер узнаёт о проблеме, когда пропадают heartbeat, и исключает участника только через `session.timeout.ms` (по умолчанию 45 секунд). До этого его партиции никто не читает. Затем начинается ребаланс, и при eager все участники отдают все свои партиции и входят заново. Cooperative-sticky уменьшает остановку у остальных, но ожидание срока сессии не отменяет. Записи остаются в Kafka, но lag растёт: группа не читает и не коммитит, а конец партиции уходит вперёд."
}
```

Группа из трёх потребителей читает топик. Один из процессов убит, он не успел выйти из группы. Настройки по умолчанию: `range`, `session.timeout.ms=45000`. Что верно?
