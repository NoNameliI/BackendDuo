# Лог и offset

Интернет-магазин фиксирует каждое событие заказа: «создан», «оплачен», «передан курьеру». Эти события нужны сразу нескольким системам: складу, рассылке писем, аналитике. Если каждое событие просто отправить в одну систему, остальные его не увидят. Apache Kafka решает это иначе: события дописываются в журнал, и любой потребитель читает его со своего места.

Лаборатория этого курса — учебная песочница, а не настоящий кластер. Она работает по виртуальным часам: время в ней идёт только когда вы запускаете сценарий или команду `sim run` (она появится в уроке 3.1). Песочница следует правилам Apache Kafka 4.x из официальной документации, но проще настоящего кластера: в ней три брокера с номерами 1, 2 и 3, адрес `localhost:9092`, а многие тонкости (сжатие, транзакции, Kafka Connect, внутреннее устройство управляющего кворума) не воспроизводятся. Когда песочница что-то упрощает или не поддерживает, урок говорит об этом прямо. Команды `kafka-topics.sh`, `kafka-console-producer.sh`, `kafka-console-consumer.sh`, `kafka-consumer-groups.sh` и `kafka-configs.sh` устроены как настоящие, хотя их вывод может отличаться деталями. Команды `sim …` бывают только в лаборатории.

### Журнал, запись и offset

Основа Kafka — журнал (лог): структура, в которую записи только дописывают в конец. Записи не меняют и не вставляют в середину.

- **Запись** (record) — одно событие. У неё есть значение (value), необязательный ключ (key), заголовки (headers) и отметка времени (timestamp). Значение — то, что вы хотите сохранить: например, текст `order 1 paid`. Ключ — короткая метка, например номер заказа; о ней речь в мире «Ключи и группы». Заголовки — пары «имя — значение» со служебными данными. Отметка времени по умолчанию — время создания записи в приложении-продюсере (`CreateTime`).
- **Offset** (смещение) — номер записи в журнале. В курсе мы пишем «offset». Первая запись получает 0, следующая 1, и так далее. Номер назначает брокер при записи. Он только растёт, не переиспользуется и не меняется.
- **Позиция** потребителя — offset следующей записи, которую он прочитает. Если потребитель прочитал записи 0, 1 и 2, его позиция равна 3.
- **Log end offset** (LEO) — offset, который получит следующая новая запись. В журнале из трёх записей (0, 1, 2) он равен 3.

Важное следствие: чтение ничего не удаляет. Потребитель просто помнит, до какого места дочитал, а записи остаются в журнале. Подробнее — в уроке 1.3.

В песочнице отметки времени идут от виртуальных часов, которые стартуют с 2026-01-01T00:00:00Z. Это упрощение: в настоящем кластере записи получают реальное время.

### Топик и брокер

**Топик** (topic) — именованный журнал событий одного вида: `orders`, `payments`, `clicks`. **Продюсер** (producer) — приложение, которое пишет записи в топик. **Потребитель** (consumer) — приложение, которое читает записи из топика. Урок 1.2 объяснит, как топик делится на части (партиции). Пока считайте, что у топика одна часть, а значит, один журнал со сквозной нумерацией offset.

**Брокер** (broker) — сервер Kafka, который хранит журналы и отвечает на запросы. Несколько брокеров образуют **кластер**. В Kafka 4.x управляющая информация кластера хранится в самой Kafka (режим KRaft), отдельный ZooKeeper больше не нужен. Для первых уроков эта подробность не важна: все команды обращаются к адресу `localhost:9092`.

### Создание топика

Команда `kafka-topics.sh` управляет топиками. Шаблон создания:

```text
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic имя --partitions N --replication-factor R
```

- `--bootstrap-server localhost:9092` — адрес, по которому инструмент находит кластер. В песочнице он нужен в каждой команде `kafka-*`, иначе вы получите ошибку `Missing required argument "[bootstrap-server]"`.
- `--create` — действие: создать топик. Одновременно указывается ровно одно действие.
- `--topic имя` — имя топика. Допустимы латинские буквы, цифры, точка, подчёркивание и дефис.
- `--partitions N` — число частей. В этом уроке всегда `1`.
- `--replication-factor R` — сколько копий хранить на брокерах. В этом уроке `1`. Копиям посвящён мир «Надёжность».

Окончание `.sh` в имени команды можно не писать. Команда печатает `Created topic имя.`

### Запись из консоли

`kafka-console-producer.sh` читает строки и отправляет каждую как отдельную запись. В песочнице строки подают блоком `<<EOF`: после команды идут строки записей, а завершает блок строка `EOF`.

```text
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic имя <<EOF
значение 1
значение 2
EOF
```

- `--topic имя` — в какой топик писать.
- Строки между `<<EOF` и `EOF` — значения записей, по одной на строку. Ключа у таких записей нет.

Команда ничего не печатает, если всё хорошо.

### Чтение из консоли

`kafka-console-consumer.sh` читает записи и печатает их.

```text
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic имя --from-beginning --max-messages N
```

- `--from-beginning` — начать с самой первой записи. Без этого флага потребитель без сохранённой позиции стартует с конца журнала и увидит только новые записи (подробности — в уроке 1.3).
- `--max-messages N` — остановиться после N записей. Без этого флага команда читает всё, что есть, и останавливается строкой `(песочница: новых сообщений нет)`. Это упрощение песочницы: настоящий потребитель ждёт новых записей бесконечно.
- Последняя строка вывода `Processed a total of N messages` — итог.

Чтобы увидеть offset, добавьте `--formatter-property print.offset=true`. Флаг `--formatter-property имя=значение` меняет формат вывода. Полезные имена: `print.offset`, `print.timestamp`, `print.key`, `print.partition`, `print.headers`. Поля печатаются в таком порядке: отметка времени, партиция, offset, заголовки, ключ, значение; между ними табуляция.

Пример: создадим топик платежей, запишем три записи и прочитаем их с offset.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic payments --partitions 1 --replication-factor 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic payments <<EOF
card 100
card 250
refund 100
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic payments --from-beginning --max-messages 3 --formatter-property print.offset=true
```

```text
Created topic payments.
Offset:0	card 100
Offset:1	card 250
Offset:2	refund 100
Processed a total of 3 messages
```

Записи получили offset 0, 1 и 2 в порядке отправки.

### Чтение с заданного места

Чтобы начать не с начала, а с конкретного offset, укажите партицию и offset: `--partition 0 --offset N`. У топика с одной частью единственная партиция имеет номер `0`.

```text
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic имя --partition 0 --offset N --max-messages M
```

- `--partition 0` — номер партиции (нумерация с нуля). Флаг `--offset` без него не работает: песочница ответит `The partition is required when offset is specified.`
- `--offset N` — с какой записи начать. Запись с этим offset прочитается первой.

Прочитаем две записи, начиная со второй, и покажем отметки времени:

```broker example
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic payments --partition 0 --offset 1 --max-messages 2 --formatter-property print.offset=true --formatter-property print.timestamp=true
```

```text
CreateTime:1767225600000	Offset:1	card 250
CreateTime:1767225600000	Offset:2	refund 100
Processed a total of 2 messages
```

Число `1767225600000` — виртуальное время в миллисекундах от 1970 года (это 2026-01-01T00:00:00Z). Оно одинаково, потому что виртуальные часы стоят, пока вы не запустите `sim run`.

### Ключ записи

Чтобы записать ключ, скажите продюсеру, что строка состоит из ключа и значения: `--reader-property parse.key=true`. Разделитель задаёт `--reader-property key.separator=:`. Тогда строка `order-7:card 300` превращается в ключ `order-7` и значение `card 300`: делится по первому разделителю. Если разделителя в строке нет, команда сообщит об ошибке `No key separator found on line number N`.

Чтобы увидеть ключ при чтении, добавьте `--formatter-property print.key=true`.

```broker example
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic payments --reader-property parse.key=true --reader-property key.separator=: <<EOF
order-7:card 300
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic payments --partition 0 --offset 3 --max-messages 1 --formatter-property print.offset=true --formatter-property print.key=true
```

```text
Offset:3	order-7	card 300
Processed a total of 1 messages
```

Четвёртая запись получила offset 3: нумерация продолжилась, как и должна.

Заголовки у записи тоже есть. В консоли их можно задавать через `parse.headers=true`, а при чтении без заголовков в формате с `print.headers=true` печатается `NO_HEADERS`. В курсе заголовки нужны редко, и заданий на них нет.

### Топик не создан заранее

В песочнице, как и в настоящей Kafka по умолчанию (`auto.create.topics.enable=true`), запись в несуществующий топик создаёт его: одна партиция, одна копия. Это удобно, но опасно: опечатка в имени тихо создаст лишний топик, а нужный останется без данных. Список топиков показывает `kafka-topics.sh --bootstrap-server localhost:9092 --list`.

### Частые ошибки

- **Ошибка:** считать, что offset — «номер записи во всём топике» при любом числе партиций. **Верно:** offset нумерует записи внутри одной партиции. У топика с тремя партициями в каждом будет свой offset 0 (урок 1.2).
- **Ошибка:** думать, что после чтения запись исчезает. **Верно:** запись остаётся в журнале, потребитель лишь продвигает свою позицию.
- **Ошибка:** путать позицию (следующий offset) с offset последней прочитанной записи. **Верно:** после чтения записи 2 позиция равна 3.
- **Ошибка:** писать в топик с опечаткой в имени. **Верно:** сверять имя с `--list`: ошибки не будет, но появится новый топик.
- **Ошибка:** забыть `--bootstrap-server localhost:9092`. **Верно:** указывать его в каждой команде `kafka-*`.

### Шпаргалка

- Журнал дописывается только в конец; запись = значение, ключ (необязательный), заголовки, время.
- Offset: 0, 1, 2, … внутри партиции; назначает брокер; не меняется и не переиспользуется.
- Позиция потребителя = offset следующей записи; LEO = offset новой записи.
- Создать топик: `kafka-topics.sh --bootstrap-server localhost:9092 --create --topic имя --partitions 1 --replication-factor 1`.
- Записать: `kafka-console-producer.sh … --topic имя <<EOF` строки `EOF`. Ключ: `--reader-property parse.key=true --reader-property key.separator=:`.
- Прочитать: `kafka-console-consumer.sh … --topic имя --from-beginning --max-messages N`.
- С места: `--partition 0 --offset N`. Вид вывода: `--formatter-property print.offset=true` (или `print.key`, `print.timestamp`).

## task kfk-first-topic

```json
{
  "type": "console",
  "title": "Первый топик заказов",
  "xp": 10,
  "hints": [
    "Разделы «Создание топика» и «Запись из консоли».",
    "Нужны две команды: `kafka-topics.sh --create` и `kafka-console-producer.sh` со строками между `<<EOF` и `EOF`.",
    "Шаблон: `kafka-topics.sh --bootstrap-server localhost:9092 --create --topic …`, затем `kafka-console-producer.sh --bootstrap-server localhost:9092 --topic … <<EOF`, три строки, `EOF`."
  ],
  "check": { "compare": ["topics", "messages"] }
}
```

Склад хочет получать события отслеживания посылок. Создайте топик `tracking` с одной партицией и одной копией (`--replication-factor 1`). Запишите в него три записи без ключа, в таком порядке: `scan 1`, `scan 2`, `scan 3`.

```broker starter
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic … --partitions … --replication-factor …
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic … <<EOF
…
EOF
```

```broker solution
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic tracking --partitions 1 --replication-factor 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic tracking <<EOF
scan 1
scan 2
scan 3
EOF
```

## task kfk-read-from-offset

```json
{
  "type": "console",
  "title": "Перечитать хвост журнала",
  "xp": 15,
  "hints": [
    "Раздел «Чтение с заданного места».",
    "Команда `kafka-console-consumer.sh` с флагами `--partition 0` и `--offset`. Чтобы видеть offset, добавьте `--formatter-property print.offset=true`.",
    "Шаблон: `kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic tracking --partition 0 --offset … --max-messages … --formatter-property print.offset=true`."
  ],
  "check": {
    "require": [
      { "pattern": "kafka-console-consumer(\\.sh)? .*--topic tracking", "message": "Прочитайте топик tracking командой kafka-console-consumer.sh." },
      { "pattern": "--partition 0 .*--offset 3\\b|--offset 3 .*--partition 0", "message": "Начните чтение с партиции 0 и offset 3: --partition 0 --offset 3." },
      { "pattern": "print\\.offset=true", "message": "Покажите offset: --formatter-property print.offset=true." }
    ]
  }
}
```

В топике `tracking` уже лежат пять записей: `scan 1` … `scan 5` (offset от 0 до 4). Сотрудник склада проверил первые три и хочет увидеть остальные. Прочитайте записи, начиная с offset 3, и выведите их offset. Читать нужно только партицию 0.

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic tracking --partitions 1 --replication-factor 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic tracking <<EOF
scan 1
scan 2
scan 3
scan 4
scan 5
EOF
```

```broker starter
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic tracking --from-beginning --max-messages 5
```

```broker solution
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic tracking --partition 0 --offset 3 --max-messages 2 --formatter-property print.offset=true
```

## task kfk-next-offset

```json
{
  "type": "choice",
  "title": "Какой offset получит новая запись",
  "xp": 10,
  "hints": [
    "Раздел «Журнал, запись и offset»: что такое LEO и позиция.",
    "Offset новой записи — это LEO, то есть следующий свободный номер. Чтение на него не влияет.",
    "В журнале записи 0–4: следующий свободный номер на единицу больше последнего."
  ],
  "options": [
    "Offset 3: он равен позиции потребителя",
    "Offset 5: он следует за последней записью журнала",
    "Offset 4: он занимает место последней записи",
    "Offset 0: после чтения нумерация начинается заново"
  ],
  "answer": [1],
  "explanation": "В журнале пять записей с offset от 0 до 4, значит LEO равен 5, и новая запись получит именно 5. Позиция потребителя (3) описывает только то, откуда читает он, и на запись не влияет. Offset 4 уже занят: offset не переиспользуется. Нумерация не сбрасывается после чтения: чтение журнал не меняет."
}
```

В партиции пять записей с offset от 0 до 4. Потребитель прочитал первые три, его позиция равна 3. Продюсер дописывает ещё одну запись. Какой offset она получит?

## task kfk-typo-topic

```json
{
  "type": "choice",
  "title": "Опечатка в имени топика",
  "xp": 10,
  "hints": [
    "Раздел «Топик не создан заранее».",
    "Вспомните параметр `auto.create.topics.enable`: что происходит при записи в несуществующий топик.",
    "Какой из вариантов не требует, чтобы кто-то заранее выполнил `--create` для `ordrs`?"
  ],
  "options": [
    "Команда завершится ошибкой, потому что топика `ordrs` нет",
    "Запись попадёт в `orders`, потому что Kafka исправит имя",
    "Будет создан новый топик `ordrs` с одной партицией, и запись попадёт в него; в `orders` ничего не появится",
    "Запись дождётся, пока кто-нибудь создаст топик `ordrs`"
  ],
  "answer": [2],
  "explanation": "При auto.create.topics.enable=true (значение по умолчанию) запись в несуществующий топик создаёт его: одна партиция, одна копия. Поэтому ошибки не будет, но данные уйдут не туда, и в `orders` ничего не появится. Kafka не исправляет имена и не угадывает намерения. Ожидание создания топика тоже не происходит: топик создаётся сразу."
}
```

Сервис оформления заказов должен писать в топик `orders`, но в конфигурации написано `ordrs`. Топик `ordrs` никто не создавал, а настройки кластера стандартные. Что произойдёт при отправке записи?
