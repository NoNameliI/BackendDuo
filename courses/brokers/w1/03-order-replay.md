# Порядок и перечитывание

Служба доставки получает статусы посылок: «принята», «загружена», «вручена». Статус «вручена» не должен обгонять «загружена». Кроме того, бухгалтерия нашла ошибку в коде расчётов, и вчерашние платежи нужно провести заново, а новой службе аудита нужны платежи с самого начала. Оба требования, порядок и перечитывание, по-разному решаются в RabbitMQ и Kafka.

Примеры урока работают на песочнице Kafka. Что делает RabbitMQ, сказано словами со ссылками на курс RabbitMQ.

### Порядок в Kafka: раздел и ключ

Напомним по курсу Kafka (уроки 2.1 и 2.2). Порядок записей гарантирован только внутри одного раздела. Раздел записи выбирает продюсер: если у записи есть ключ, раздел вычисляется по ключу и для одного ключа всегда один и тот же, пока число разделов не меняется. Поэтому ключом делают идентификатор сущности (посылки, заказа), и все её события оказываются в одном разделе в порядке записи.

Чтобы записать запись с ключом из консоли, нужны два свойства продюсера.

```text
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic ТОПИК --reader-property parse.key=true --reader-property key.separator=РАЗДЕЛИТЕЛЬ
```

- `--topic ТОПИК` — куда писать.
- `--reader-property parse.key=true` — каждая строка делится на ключ и значение.
- `--reader-property key.separator=РАЗДЕЛИТЕЛЬ` — символ, по первому вхождению которого строка делится: `parcel-1:loaded` при разделителе `:` даёт ключ `parcel-1` и значение `loaded`.
- Строки записей идут после команды между `<<EOF` и `EOF`, одна строка — одна запись.

Читают один раздел консольным потребителем:

```text
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic ТОПИК --partition N --offset earliest --max-messages M --formatter-property print.key=true --formatter-property print.offset=true
```

- `--partition N` — какой раздел читать.
- `--offset earliest` — с самого начала раздела.
- `--max-messages M` — остановиться после `M` записей.
- `--formatter-property print.key=true` и `print.offset=true` — печатать ключ и номер записи в разделе.

Пример. Статусы двух посылок пишутся вперемешку, а читаются по разделам. Раздел определяет ключ.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic parcel-status --partitions 3 --replication-factor 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic parcel-status --reader-property parse.key=true --reader-property key.separator=: <<EOF
parcel-1:accepted
parcel-2:accepted
parcel-1:loaded
parcel-2:loaded
parcel-1:delivered
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic parcel-status --partition 0 --offset earliest --max-messages 3 --formatter-property print.key=true --formatter-property print.offset=true
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic parcel-status --partition 2 --offset earliest --max-messages 2 --formatter-property print.key=true --formatter-property print.offset=true
```

```text
Created topic parcel-status.
Offset:0	parcel-1	accepted
Offset:1	parcel-1	loaded
Offset:2	parcel-1	delivered
Processed a total of 3 messages
Offset:0	parcel-2	accepted
Offset:1	parcel-2	loaded
Processed a total of 2 messages
```

Какой раздел достался каждому ключу, определяет хеш ключа: здесь `parcel-1` лёг в раздел 0, а `parcel-2` в раздел 2. Для вас важно другое: каждая посылка лежит в своём разделе, и её статусы идут по порядку.

### Что ломает порядок в Kafka

- **Ключ не по сущности.** Тогда статусы одной посылки расходятся по разным разделам.
- **Игнорирование ключей.** Свойство продюсера `partitioner.ignore.keys` по умолчанию `false`. Если поставить `true`, продюсер раскладывает записи так, как будто ключей нет, даже если ключи в записях остались. Порядок по ключу пропадает.
- **Рост числа разделов.** Раздел считается как остаток от деления хеша ключа на число разделов. После `--alter --partitions` ключ может переехать в другой раздел, и новые записи окажутся не там, где старые.

Пример: ключ `hello` лежит в разделе 0 при трёх разделах. После увеличения до шести его новые записи идут в раздел 3.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic status-log --partitions 3 --replication-factor 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic status-log --reader-property parse.key=true --reader-property key.separator=: <<EOF
hello:first
EOF
kafka-topics.sh --bootstrap-server localhost:9092 --alter --topic status-log --partitions 6
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic status-log --reader-property parse.key=true --reader-property key.separator=: <<EOF
hello:second
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic status-log --partition 0 --offset earliest --max-messages 1 --formatter-property print.key=true --formatter-property print.offset=true
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic status-log --partition 3 --offset earliest --max-messages 1 --formatter-property print.key=true --formatter-property print.offset=true
```

```text
Created topic status-log.
Offset:0	hello	first
Processed a total of 1 messages
Offset:0	hello	second
Processed a total of 1 messages
```

Две записи одного ключа лежат в двух разделах. У разных разделов нет общего порядка, поэтому читатель может увидеть `second` раньше `first`. Поэтому число разделов для топиков, где важен порядок, выбирают сразу с запасом.

### Порядок в RabbitMQ

Напомним по курсу RabbitMQ (уроки 3.1 и 4.3). Одна очередь отдаёт сообщения по порядку поступления, но порядок обработки при этом сохраняется не всегда:

- **Несколько потребителей.** Сообщения одной очереди разбираются разными потребителями, и обработка может закончиться в другом порядке.
- **Возврат в очередь.** Сообщение, которое вернули (`nack` или `reject` с `requeue=true`) или не подтвердили до закрытия канала, возвращается на прежнее место, а если это невозможно, ближе к голове очереди. Оно может прийти после более поздних сообщений.
- **Приоритеты.** Сообщение с большим приоритетом выдаётся раньше, если очередь настроена на приоритеты.

Строгий порядок обработки в RabbitMQ получают с одним потребителем на очередь. В Kafka тот же эффект даёт ключ: разных сущностей много, и параллельно работают разные разделы.

### Перечитывание в Kafka

Напомним по курсу Kafka (урок 1.3). Запись не удаляется, когда её прочитали: она живёт до конца срока хранения. У каждой группы своя позиция (закоммиченный offset). Из этого два способа перечитать:

- **Новая группа** без позиции с `auto.offset.reset=earliest` (в консоли `--from-beginning`) читает с начала.
- **Сброс позиции** существующей группы: `kafka-consumer-groups.sh --reset-offsets --group ГРУППА --topic ТОПИК --to-offset N --execute`. Группа не должна иметь работающих читателей. Без `--execute` команда лишь показывает таблицу и ничего не меняет.

Пример. Группа `billing` прочитала четыре платежа. Группа `audit` независимо читает те же платежи с начала. Потом позицию `billing` возвращают на offset 2, чтобы повторно провести два последних платежа.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic payments --partitions 1 --replication-factor 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic payments <<EOF
payment 1
payment 2
payment 3
payment 4
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic payments --group billing --from-beginning --max-messages 4
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic payments --group audit --from-beginning --max-messages 4
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --reset-offsets --group billing --topic payments --to-offset 2 --execute
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic payments --group billing --max-messages 2
```

```text
Created topic payments.
payment 1
payment 2
payment 3
payment 4
Processed a total of 4 messages
payment 1
payment 2
payment 3
payment 4
Processed a total of 4 messages
GROUP           TOPIC           PARTITION  NEW-OFFSET
billing         payments        0          2
payment 3
payment 4
Processed a total of 2 messages
```

### Перечитывание в RabbitMQ

Из очереди RabbitMQ подтверждённое сообщение повторно не доставляется (курс RabbitMQ, урок 3.1). Новая очередь получает только то, что опубликовано после её привязки. Поэтому «прочитать вчерашнее» классическая очередь не умеет.

Для таких случаев у RabbitMQ есть отдельный тип очереди, `stream`: журнал, в который сообщения только добавляются, а чтение их не удаляет. Потребитель выбирает место начала чтения аргументом `x-stream-offset` (курс RabbitMQ, урок 4.4). Песочница streams не выполняет, это теория по документации.

### Сценарии этого урока

В сценарии порядок проверяет условие `orderedByKey`: потребитель обработал записи каждого ключа в порядке отправки. Условие `noLoss` требует, чтобы ни одна запись не потерялась. Свойства участника правят строкой `участник.настройка=значение`: например, `courier-app.partitioner.ignore.keys=false` меняет `partitioner.ignore.keys` у участника `courier-app`. Всё после первой точки в имени участника остаётся настройкой.

Условие `processedAtLeast` из прошлого урока здесь работает так же: участник обработал не меньше `count` записей к моменту `byMs`. Новая группа подключается к кластеру в момент 3000 мс (координатор ждёт новых участников три секунды), поэтому запись, сделанная раньше, при `auto.offset.reset=latest` будет для неё пропущена.

### Частые ошибки

- **Ошибка:** ждать порядка между разными разделами. **Верно:** порядок только внутри раздела; нужный порядок получают ключом сущности.
- **Ошибка:** включить `partitioner.ignore.keys=true` ради равномерной нагрузки и ждать порядка по ключу. **Верно:** с этим свойством порядок по ключу не гарантирован.
- **Ошибка:** добавить разделы в рабочий топик и ждать, что порядок ключа сохранится. **Верно:** ключ может переехать в другой раздел, порядок через границу не гарантирован.
- **Ошибка:** ждать от очереди RabbitMQ, что подтверждённое сообщение можно прочитать снова. **Верно:** для перечитывания нужен журнал: топик Kafka или stream RabbitMQ.
- **Ошибка:** для новой службы оставить `auto.offset.reset=latest` и ждать историю. **Верно:** для истории нужен `earliest`.

### Шпаргалка

- Kafka: порядок только внутри раздела; ключ сущности даёт один раздел; `partitioner.ignore.keys=true` и рост числа разделов порядок ломают.
- Продюсер с ключом: `--reader-property parse.key=true --reader-property key.separator=:`. Чтение раздела: `--partition N --offset earliest --max-messages M --formatter-property print.key=true`.
- Перечитать: новая группа с `earliest` или `--reset-offsets --group Г --topic Т --to-offset N --execute` (читателей нет).
- RabbitMQ: порядок в одной очереди нарушают несколько потребителей, возврат и приоритеты; подтверждённое не перечитать; для журнала есть `stream`, в песочнице его нет.

## task brk-courier-order

```json
{
  "type": "scenario",
  "title": "Kafka: статусы курьера перепутались",
  "xp": 20,
  "sim": "kafka",
  "scenario": "brk-courier-order",
  "hints": [
    "Раздел «Что ломает порядок в Kafka».",
    "Продюсер `courier-app` игнорирует ключи записей. Нужно свойство продюсера `partitioner.ignore.keys`.",
    "В окне свойств замените значение: `courier-app.partitioner.ignore.keys=…` (`true` или `false`)."
  ],
  "check": {}
}
```

Приложение курьеров (`courier-app`) пишет шестьдесят записей `event 1` … `event 60` в топик `courier-events` из трёх разделов. Ключи записей `courier-0`, `courier-1`, `courier-2`: события одного курьера идут в порядке отправки. Диспетчер (`dispatcher`) обрабатывает записи, и сейчас порядок по ключам у него нарушается.

Измените свойство продюсера так, чтобы порядок по ключам сохранялся и все шестьдесят записей были обработаны. Править нужно только свойства.

```properties starter
# partitioner.ignore.keys: true — ключи не учитываются, false — раздел выбирается по ключу
courier-app.partitioner.ignore.keys=true
```

```properties solution
courier-app.partitioner.ignore.keys=false
```

## task brk-audit-replay

```json
{
  "type": "scenario",
  "title": "Kafka: аудит пропустил платежи",
  "xp": 20,
  "sim": "kafka",
  "scenario": "brk-audit-replay",
  "hints": [
    "Раздел «Перечитывание в Kafka».",
    "У новой группы `audit` нет позиции. С какого места она начнёт, определяет `auto.offset.reset`.",
    "В окне свойств замените значение: `audit.auto.offset.reset=…` (`earliest` или `latest`)."
  ],
  "check": {}
}
```

Шлюз (`gateway`) пишет пятнадцать записей `payment 1` … `payment 15` в топик `payments` и заканчивает к 1500-й миллисекунде. Группа `billing` их обрабатывает. Служба аудита (`audit`, группа `audit`) подключается позже, группа новая, позиции у неё нет, и сейчас она не обрабатывает ни одного платежа.

Измените свойство читателя `audit` так, чтобы он обработал все пятнадцать платежей к 20000-й миллисекунде. Править нужно только свойства.

```properties starter
# auto.offset.reset: earliest — с начала журнала, latest — с конца
audit.auto.offset.reset=latest
```

```properties solution
audit.auto.offset.reset=earliest
```

## task brk-rabbit-order

```json
{
  "type": "choice",
  "title": "Порядок и повтор в RabbitMQ",
  "xp": 10,
  "hints": [
    "Разделы «Порядок в RabbitMQ» и «Перечитывание в RabbitMQ».",
    "Спросите себя: что происходит с подтверждённым сообщением и что бывает при нескольких потребителях?",
    "Верны два утверждения: про нескольких потребителей и про подтверждённое сообщение."
  ],
  "options": [
    "Если очередь читают несколько потребителей, порядок обработки сообщений может отличаться от порядка поступления",
    "Подтверждённое сообщение можно прочитать снова, если вернуть позицию, как в Kafka",
    "Подтверждённое сообщение очередь повторно не доставляет; для перечитывания нужен `stream`",
    "Сообщение, которое вернули в очередь, всегда встаёт в её конец"
  ],
  "answer": [0, 2],
  "explanation": "С несколькими потребителями одной очереди обработка идёт параллельно и может закончиться в другом порядке. Подтверждённое сообщение повторно не доставляется: у классической очереди нет позиции, которую можно вернуть. Для перечитывания у RabbitMQ есть `stream`, в песочнице его нет. Возвращённое сообщение встаёт на прежнее место в очереди, а если это невозможно, ближе к голове, не в конец."
}
```

Отметьте все верные утверждения про RabbitMQ.
