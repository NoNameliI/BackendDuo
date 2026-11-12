# Топики и партиции

Служба доставки получает тысячи событий о посылках в минуту. Один журнал на одном сервере не выдержит такого потока записи и чтения. Kafka делит топик на несколько частей, партиций (partitions), и раскладывает их по брокерам. Каждая партиция — самостоятельный журнал, поэтому записью и чтением можно заниматься параллельно.

### Партиция

**Партиция** (partition) — один журнал топика. Топик из трёх партиций — это три журнала с номерами 0, 1 и 2.

- В каждой партиции своя нумерация offset, с нуля. Запись с offset 0 есть в каждой партиции.
- Запись целиком попадает в одну партицию. Какую именно, решает ключ записи; об этом — следующий абзац.
- Порядок записей гарантирован только внутри партиции. Между партициями общего порядка нет: Kafka не обещает, что запись из партиции 0 была сделана раньше записи из партиции 1, только потому что вы отправили её раньше.
- Чем больше партиций, тем больше потребителей могут работать параллельно: одну партицию читает один потребитель из группы (группы — мир «Ключи и группы»).

### Ключ и выбор партиции

- Если у записи есть ключ, партиция определяется ключом: одинаковые ключи всегда попадают в одну и ту же партицию (пока число партиций не меняется). Поэтому все события одного заказа с ключом `order-7` лежат вместе и читаются по порядку. Как именно считается номер, разбирает урок 2.1.
- Если ключа нет, продюсер некоторое время пишет в одну партицию, затем переключается на другую. Распределение будет примерно равномерным, но предсказать его нельзя. Поэтому там, где порядок важен, ключ нужен.

### Копии: лидер и реплики

Каждая партиция хранится в нескольких копиях, **репликах** (replicas), на разных брокерах. Число копий — **фактор репликации** (replication factor). Одна копия назначается **лидером** (leader): через неё идут запись и чтение. Остальные (фолловеры) догоняют лидера. Группа копий, которые успевают за лидером, называется **ISR** (in-sync replicas). Подробно репликация разобрана в мире «Надёжность», сейчас достаточно знать названия, чтобы читать вывод `--describe`.

Фактор репликации не может быть больше числа живых брокеров. В песочнице их три, так что допустимы значения 1, 2 и 3. Раскладка копий по брокерам в песочнице упрощена: копии партиции с номером p лежат на брокерах по кругу, первая — предпочтительный лидер.

### Создание топика с несколькими партициями

Шаблон создания вам знаком из урока 1.1. Добавляются значения побольше и, при необходимости, настройки топика:

```text
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic имя --partitions N --replication-factor R --config настройка=значение
```

- `--partitions N` — число партиций, целое от 1.
- `--replication-factor R` — число копий, от 1 до числа брокеров.
- `--config настройка=значение` — необязательная настройка конкретного топика; можно повторять флаг. Например, `retention.ms=86400000` — хранить записи не дольше суток (86 400 000 мс). Значение по умолчанию — семь дней (`604800000`). Как работает хранение, объясняет мир «Хранение».
- `--if-not-exists` — не считать ошибкой, если топик уже есть.

Без `--partitions` и `--replication-factor` берутся значения кластера: одна партиция и одна копия.

### Описание топика

```text
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic имя
```

Вывод — строка про топик и по строке на каждую партицию. Поля разделены табуляцией:

- `TopicId` — идентификатор топика;
- `PartitionCount` — число партиций, `ReplicationFactor` — число копий;
- `Configs` — только настройки, отличающиеся от умолчаний (в примере ниже `retention.ms=86400000`);
- `Partition` — номер партиции, `Leader` — брокер-лидер;
- `Replicas` — брокеры с копиями, первый — предпочтительный лидер;
- `Isr` — копии, которые успевают за лидером;
- `Elr` и `LastKnownElr` — в песочнице всегда `N/A`: эта возможность Kafka не моделируется.

Другие действия той же команды: `--list` печатает имена топиков, `--delete --topic имя` удаляет топик.

Создадим топик посылок на три партиции с тремя копиями и суточным хранением:

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic parcels --partitions 3 --replication-factor 3 --config retention.ms=86400000
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic parcels
```

```text
Created topic parcels.
Topic: parcels	TopicId: ewQK1hwOST-cEbqAp2Y0uw	PartitionCount: 3	ReplicationFactor: 3	Configs: retention.ms=86400000
	Topic: parcels	Partition: 0	Leader: 1	Replicas: 1,2,3	Isr: 1,2,3	Elr: N/A	LastKnownElr: N/A
	Topic: parcels	Partition: 1	Leader: 2	Replicas: 2,3,1	Isr: 2,3,1	Elr: N/A	LastKnownElr: N/A
	Topic: parcels	Partition: 2	Leader: 3	Replicas: 3,1,2	Isr: 3,1,2	Elr: N/A	LastKnownElr: N/A
```

Лидеры трёх партиций распределены по трём брокерам: нагрузка делится.

### Ключи на практике

Запишем в `parcels` пять записей с ключами `a`, `abc` и `key1`, затем прочитаем каждую партицию с начала. Для чтения одной партиции нужны уже знакомые `--partition N --offset 0`. Без `--partition` консоль читает топик партиция за партицией: сначала вся партиция 0, затем 1 и так далее. В настоящей Kafka записи разных партиций приходят вперемешку, поэтому по порядку вывода консоли о порядке между партициями судить нельзя.

```broker example
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic parcels --reader-property parse.key=true --reader-property key.separator=: <<EOF
a:packed
abc:packed
key1:packed
a:shipped
abc:shipped
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic parcels --partition 0 --offset 0 --max-messages 2 --formatter-property print.key=true --formatter-property print.offset=true
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic parcels --partition 1 --offset 0 --max-messages 2 --formatter-property print.key=true --formatter-property print.offset=true
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic parcels --partition 2 --offset 0 --max-messages 1 --formatter-property print.key=true --formatter-property print.offset=true
```

```text
Offset:0	abc	packed
Offset:1	abc	shipped
Processed a total of 2 messages
Offset:0	a	packed
Offset:1	a	shipped
Processed a total of 2 messages
Offset:0	key1	packed
Processed a total of 1 messages
```

Все записи с ключом `abc` лежат в партиции 0, с ключом `a` — в партиции 1, с ключом `key1` — в партиции 2. Внутри каждой партиции события одного ключа идут в порядке отправки. Заметьте и другое: offset 0 есть в каждой партиции. Номер записи в топике — это пара «партиция, offset».

### Увеличение числа партиций

```text
kafka-topics.sh --bootstrap-server localhost:9092 --alter --topic имя --partitions N
```

- `--alter` — изменить существующий топик.
- `--partitions N` — новое число партиций; оно только растёт. Команда ничего не печатает при успехе.

Уменьшить число партиций нельзя. Рост опасен для ключей: номер партиции считается как остаток от деления на число партиций, поэтому после роста ключ может уйти в другую партицию, и порядок его событий нарушится на границе. Старые записи остаются где были.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --alter --topic parcels --partitions 4
kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic parcels
```

```text
Topic: parcels	TopicId: ewQK1hwOST-cEbqAp2Y0uw	PartitionCount: 4	ReplicationFactor: 3	Configs: retention.ms=86400000
	Topic: parcels	Partition: 0	Leader: 1	Replicas: 1,2,3	Isr: 1,2,3	Elr: N/A	LastKnownElr: N/A
	Topic: parcels	Partition: 1	Leader: 2	Replicas: 2,3,1	Isr: 2,3,1	Elr: N/A	LastKnownElr: N/A
	Topic: parcels	Partition: 2	Leader: 3	Replicas: 3,1,2	Isr: 3,1,2	Elr: N/A	LastKnownElr: N/A
	Topic: parcels	Partition: 3	Leader: 1	Replicas: 1,2,3	Isr: 1,2,3	Elr: N/A	LastKnownElr: N/A
```

Попытка вернуть две партиции закончилась бы ошибкой (так отвечает песочница, текст в настоящей Kafka немного отличается):

```text
Error: The topic parcels currently has 4 partition(s); 2 would not be an increase.
```

### Частые ошибки

- **Ошибка:** ждать общего порядка записей по всему топику. **Верно:** порядок есть только внутри партиции. Событиям, которые нужно читать по порядку, давайте один ключ.
- **Ошибка:** пытаться уменьшить число партиций командой `--alter`. **Верно:** создайте новый топик с нужным числом партиций и перенесите данные.
- **Ошибка:** указать фактор репликации больше числа брокеров (`--replication-factor 5` при трёх брокерах). **Верно:** от 1 до 3. Иначе будет ошибка `Replication factor: 5 larger than available brokers: 3.`
- **Ошибка:** увеличить число партиций у топика, где порядок по ключу важен, и не заметить переезда ключей. **Верно:** планировать число партиций заранее (мир «Экосистема»).
- **Ошибка:** путать две вещи: партиции делят данные, реплики копируют их. **Верно:** три партиции с тремя копиями — это девять копий журналов на трёх брокерах.

### Шпаргалка

- Топик = N партиций; у каждой свои offset с 0; порядок только внутри партиции.
- Одинаковый ключ → одна и та же партиция, пока число партиций не менялось.
- `--create --topic имя --partitions N --replication-factor R [--config k=v]`; копий не больше брокеров (в песочнице 3).
- `--describe --topic имя`: `Leader` (кто принимает запись), `Replicas`, `Isr`.
- `--alter --topic имя --partitions N`: только увеличение.
- `--list`, `--delete --topic имя`, `--if-not-exists`.
- Читать одну партицию: `--partition N --offset M`.

## task kfk-shipments-topic

```json
{
  "type": "topology",
  "title": "Топик отгрузок",
  "xp": 15,
  "hints": [
    "Раздел «Создание топика с несколькими партициями».",
    "Одна команда `kafka-topics.sh --create`, настройку хранения задаёт `--config`.",
    "Шаблон: `kafka-topics.sh --bootstrap-server localhost:9092 --create --topic … --partitions … --replication-factor … --config retention.ms=…`."
  ],
  "check": { "compare": ["topics", "configs"] }
}
```

Создайте топик `shipments` с четырьмя партициями и двумя копиями. Записи должны храниться один час: настройка `retention.ms` равна `3600000`.

```broker starter
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic shipments --partitions … --replication-factor … --config retention.ms=…
```

```broker solution
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic shipments --partitions 4 --replication-factor 2 --config retention.ms=3600000
```

## task kfk-grow-clicks

```json
{
  "type": "topology",
  "title": "Больше партиций для кликов",
  "xp": 15,
  "hints": [
    "Раздел «Увеличение числа партиций».",
    "Топик уже существует, поэтому нужно действие `--alter`, а не `--create`.",
    "Шаблон: `kafka-topics.sh --bootstrap-server localhost:9092 --alter --topic … --partitions …`."
  ],
  "check": { "compare": ["topics"] }
}
```

Топик `clicks` создан с двумя партициями. Нагрузка выросла, и потребителей станет шесть. Увеличьте число партиций у `clicks` до шести, не создавая новый топик.

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic clicks --partitions 2 --replication-factor 1
```

```broker starter
kafka-topics.sh --bootstrap-server localhost:9092 --alter --topic clicks --partitions …
```

```broker solution
kafka-topics.sh --bootstrap-server localhost:9092 --alter --topic clicks --partitions 6
```

## task kfk-keyed-deliveries

```json
{
  "type": "console",
  "title": "Статусы доставки с ключами",
  "xp": 20,
  "hints": [
    "Разделы «Ключ и выбор партиции» и «Ключи на практике».",
    "Продюсеру нужно сказать, что строка состоит из ключа и значения: `--reader-property parse.key=true` и разделитель `key.separator`.",
    "Шаблон: `kafka-console-producer.sh --bootstrap-server localhost:9092 --topic deliveries --reader-property parse.key=true --reader-property key.separator=: <<EOF`, три строки `ключ:значение`, `EOF`."
  ],
  "check": { "compare": ["messages"] }
}
```

В топике `deliveries` три партиции. Запишите в него три записи в таком порядке, ключ и значение через двоеточие: ключ `user-1`, значение `created`; ключ `user-2`, значение `created`; ключ `user-1`, значение `paid`. Записи должны попасть в партиции по своим ключам.

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic deliveries --partitions 3 --replication-factor 3
```

```broker starter
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic deliveries <<EOF
user-1:created
user-2:created
user-1:paid
EOF
```

```broker solution
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic deliveries --reader-property parse.key=true --reader-property key.separator=: <<EOF
user-1:created
user-2:created
user-1:paid
EOF
```

## task kfk-order-across-partitions

```json
{
  "type": "choice",
  "title": "Оплачено раньше, чем создано",
  "xp": 10,
  "hints": [
    "Раздел «Партиция»: где действует порядок.",
    "Вспомните, у каких записей одна партиция, а у каких может быть разная.",
    "Нужен способ, чтобы все события заказа оказались в одной партиции."
  ],
  "options": [
    "Kafka иногда путает порядок записей; нужно включить сортировку по времени",
    "События заказа 17 попали в разные партиции, а между партициями порядок не гарантирован; задайте всем событиям заказа один ключ",
    "Нужно увеличить число партиций: так записи лучше упорядочатся",
    "Потребитель читает слишком быстро; нужно добавить паузу между чтениями"
  ],
  "answer": [1],
  "explanation": "Порядок гарантирован только внутри партиции. События без ключа могут оказаться в разных партициях, и потребитель получит их в произвольном порядке относительно друг друга. Общий ключ (например, номер заказа) отправляет все события в одну партицию, а внутри неё они идут в порядке записи. Сортировки по времени в Kafka нет. Больше партиций означает ещё больше мест для разброса. Скорость чтения порядок не меняет."
}
```

Сервис пишет события заказа 17 в топик `order-events` из трёх партиций без ключа. Потребитель иногда видит событие `paid` раньше события `created`. Что объясняет это и как исправить?
