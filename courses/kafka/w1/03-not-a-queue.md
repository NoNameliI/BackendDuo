# Kafka — не очередь

Интернет-магазин пишет события заказов. Рассылка писем читает их сразу и отправляет чеки. Аналитика запускается раз в сутки и хочет увидеть все события за день, включая те, что рассылка давно обработала. Кроме того, после ошибки в коде бухгалтерии нужно обработать вчерашние счета заново. С обычной очередью, где обработанное сообщение исчезает, это невозможно. В Kafka возможно, потому что журнал не зависит от того, кто и сколько его читал.

### Очередь и журнал

- **Очередь** (например, RabbitMQ, курс про который есть в этой же программе): подтверждённое сообщение удаляется. Каждое сообщение достаётся одному потребителю, а перечитать его нельзя.
- **Журнал Kafka:** запись остаётся в партиции, пока не истечёт срок хранения: по умолчанию семь дней (`retention.ms`) или пока не превышен размер (`retention.bytes`). Потребитель запись не удаляет, а только запоминает, до какого offset дочитал. Правила хранения разобраны в мире «Хранение».

Отсюда три свойства:

- несколько независимых потребителей читают одни и те же записи;
- потребителя можно «отмотать» назад и перечитать записи;
- новый потребитель может начать с самого начала журнала.

Но и цена другая. Kafka не следит за тем, обработана ли запись: ничего вроде «подтверждено» у записи нет. Об обработке знает только позиция потребителя. Для задач, где нужно раздать сообщения нескольким работникам и удалить обработанные, очередь подходит лучше. Сравнение двух систем подробно разобрано в курсе «Kafka или RabbitMQ».

### Группа потребителей и сохранённая позиция

**Группа потребителей** (consumer group) — имя (`group.id`), под которым потребители вместе читают топик и хранят общую позицию. Позиция группы по каждой партиции называется **закоммиченным offset** (committed offset): это offset следующей записи, которую группа ещё не прочитала. Kafka хранит эти числа в служебном топике `__consumer_offsets`.

- Каждая группа получает все записи топика. Группы не мешают друг другу: у каждой своя позиция.
- Потребители одной группы делят партиции между собой. Как именно, разберёт мир «Ключи и группы».
- Консольный потребитель без `--group` получает случайное имя группы и позицию не сохраняет.

В консоли группу задаёт флаг `--group имя`. При выходе консольный потребитель сохраняет позицию.

### С какого места начинает читать группа

Новая группа не имеет закоммиченной позиции. Тогда потребитель смотрит на настройку `auto.offset.reset`:

- `latest` (по умолчанию) — начать с конца журнала: потребитель увидит только записи, которые появятся после его подключения;
- `earliest` — начать с самого начала;
- `none` — не гадать, а завершиться ошибкой.

Если у группы позиция уже есть, настройка не используется: чтение продолжается с сохранённого места. Флаг консоли `--from-beginning` — то же, что `auto.offset.reset=earliest`, поэтому он тоже действует только для группы без позиции. Для группы с позицией он ничего не меняет.

Пример. Топик квитанций, четыре записи. Группа `mail` прочитает две, затем группа `stats` прочитает все четыре, потом `mail` вернётся и, несмотря на `--from-beginning`, получит только оставшиеся.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic receipts --partitions 1 --replication-factor 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic receipts <<EOF
receipt 1
receipt 2
receipt 3
receipt 4
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic receipts --group mail --from-beginning --max-messages 2
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic receipts --group stats --from-beginning --max-messages 4
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic receipts --group mail --from-beginning --max-messages 4
```

```text
Created topic receipts.
receipt 1
receipt 2
Processed a total of 2 messages
receipt 1
receipt 2
receipt 3
receipt 4
Processed a total of 4 messages
receipt 3
receipt 4
(песочница: новых сообщений нет)
Processed a total of 2 messages
```

Группа `stats` получила все записи, хотя `mail` уже прочитала первые две: запись не исчезла. Третья команда просила четыре записи, но у `mail` оставалось две; после них команда остановилась строкой `(песочница: новых сообщений нет)`.

### Состояние группы: kafka-consumer-groups.sh

Эта команда показывает группы и их позиции.

```text
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --list
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group имя
```

- `--list` — имена всех групп.
- `--describe --group имя` — таблица по партициям. `CURRENT-OFFSET` — закоммиченная позиция группы, `LOG-END-OFFSET` — до какого offset сейчас можно читать, `LAG` — отставание: `LOG-END-OFFSET` минус `CURRENT-OFFSET`. Если у группы нет потребителей, сверху печатается строка `Consumer group 'имя' has no active members.`, а в колонках про потребителя стоит `-`.

```broker example
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --list
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group mail
```

```text
mail
stats
Consumer group 'mail' has no active members.
GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID     HOST            CLIENT-ID
mail            receipts        0          4               4               0               -               -               -
```

Подробнее про отставание — в уроке 2.4.

### Перечитывание: сброс позиции

Чтобы заставить группу прочитать записи ещё раз, её позицию сбрасывают.

```text
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --reset-offsets --group имя --topic топик ВАРИАНТ [--execute]
```

- `--reset-offsets` — действие: сбросить позиции группы.
- `--group имя` и `--topic топик` — чью позицию и по какому топику менять.
- `ВАРИАНТ` — куда поставить позицию; нужен ровно один: `--to-earliest` (в начало), `--to-latest` (в конец), `--to-offset N` (на offset N), `--shift-by N` (сдвинуть на N записей от текущей позиции; N может быть отрицательным).
- Без `--execute` команда только показывает таблицу `NEW-OFFSET`: это пробный прогон, ничего не меняется. С `--execute` позиция меняется на самом деле.
- Группа должна быть неактивной: без работающих потребителей. Иначе ошибка `Assignments can only be reset if the group 'имя' is inactive, but the current state is …`.

```broker example
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --reset-offsets --group mail --topic receipts --to-earliest
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --reset-offsets --group mail --topic receipts --to-earliest --execute
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic receipts --group mail --max-messages 2
```

```text
GROUP           TOPIC           PARTITION  NEW-OFFSET
mail            receipts        0          0
GROUP           TOPIC           PARTITION  NEW-OFFSET
mail            receipts        0          0
receipt 1
receipt 2
Processed a total of 2 messages
```

Первая команда была пробной, вторая применила сброс, и группа получила записи с начала. Перечитать можно только то, что ещё не удалено по сроку хранения.

### Сценарии лаборатории

Поведение во времени показывают сценарии: описание в формате JSON. Читается оно так:

- `sim` — какой брокер моделируется (`kafka`);
- `seed` — число, фиксирующее случайности: прогон с тем же числом повторяется точь-в-точь;
- `durationMs` — сколько виртуальных миллисекунд идёт сценарий;
- `setup` — команды консоли, выполняемые до начала (здесь создают топик);
- `actors` — участники. У продюсера (`producer`): `topic` — куда пишет, `rate` — записей в секунду, `count` — сколько всего, `message.body` — значение записи (`{n}` заменяется номером 1, 2, 3 и так далее). У потребителя (`consumer`): `topic`, `group` — имя группы, `processMs` — миллисекунд на обработку одной записи, `config` — настройки потребителя с теми же именами, что в Kafka (например, `auto.offset.reset`);
- `faults` — сбои; здесь их нет;
- `expect` — условия успеха. `processedAtLeast` — участник `actor` обработал не меньше `count` записей к моменту `byMs`.

В заданиях со сценарием вы не пишете JSON, а меняете настройки участников в окне свойств. Строка выглядит так: `участник.настройка=значение`. Строка с решёткой — комментарий. У настроек с точками в имени всё остальное идёт после первой точки: `analytics.auto.offset.reset=earliest` меняет `auto.offset.reset` у участника `analytics`.

Новая группа не начинает читать сразу: координатор ждёт три секунды (`group.initial.rebalance.delay.ms=3000`), чтобы собрать всех участников, и только потом раздаёт партиции. Поэтому в сценариях потребитель подключается в момент 3000 мс.

Пример: две группы читают пять заказов, оба потребителя начинают с начала.

```scenario example
{
  "sim": "kafka",
  "seed": 1,
  "durationMs": 10000,
  "setup": "kafka-topics.sh --bootstrap-server localhost:9092 --create --topic orders --partitions 1 --replication-factor 1",
  "actors": [
    { "id": "shop", "kind": "producer", "topic": "orders", "rate": 10, "count": 5, "message": { "body": "order {n}" }, "config": {} },
    { "id": "mailer", "kind": "consumer", "topic": "orders", "group": "mail", "processMs": 50, "config": { "auto.offset.reset": "earliest" } },
    { "id": "analytics", "kind": "consumer", "topic": "orders", "group": "stats", "processMs": 50, "config": { "auto.offset.reset": "earliest" } }
  ],
  "faults": [],
  "expect": [
    { "kind": "processedAtLeast", "actor": "mailer", "count": 5, "byMs": 10000 },
    { "kind": "processedAtLeast", "actor": "analytics", "count": 5, "byMs": 10000 }
  ]
}
```

Журнал покажет главное:

```text
3000  assign   mailer     mailer: нет закоммиченного смещения, auto.offset.reset=earliest, позиция orders-0 = 0
3000  fetch    mailer     mailer: прочитано 5 зап. из orders-0 (смещения 0–4, ниже high watermark 5)
3000  assign   analytics  analytics: нет закоммиченного смещения, auto.offset.reset=earliest, позиция orders-0 = 0
3050  process  mailer     mailer обработал shop-1 (orders-0, смещение 0)
3050  process  analytics  analytics обработал shop-1 (orders-0, смещение 0)
```

В журнале песочницы слова «смещение» и «зап.» означают offset и запись, а `orders-0` — партицию 0 топика `orders`. Так журнал выглядит во всех уроках.

Итог: оба условия выполнены («mailer: обработано 5», «analytics: обработано 5»). Каждая группа получила все пять записей.

Теперь тот же сценарий, но с `"auto.offset.reset": "latest"` у `analytics`, и потребитель подключается позже, чем записи уже написаны (продюсер закончил к 400 мс, группа подключается в 3000 мс). У новой группы нет позиции, `latest` ставит её в конец журнала, и она не увидит ни одной из уже записанных записей. Журнал: «нет закоммиченного смещения, auto.offset.reset=latest, позиция orders-0 = 5». Условие не выполнено: «analytics: обработано 0 из 5». Именно с этой ловушкой вы столкнётесь в задании.

### Частые ошибки

- **Ошибка:** считать, что прочитанную запись больше никто не увидит. **Верно:** запись остаётся в журнале до конца срока хранения; другие группы и сброс позиции дают повторное чтение.
- **Ошибка:** ждать, что `--from-beginning` перечитает всё для группы, у которой уже есть позиция. **Верно:** флаг действует только для группы без позиции. Для перечитывания используйте `--reset-offsets`.
- **Ошибка:** запускать `--reset-offsets` без `--execute` и думать, что позиция изменилась. **Верно:** без `--execute` это пробный прогон.
- **Ошибка:** сбрасывать позицию группе, у которой работают потребители. **Верно:** сначала остановите потребителей, группа должна быть неактивной.
- **Ошибка:** оставить `auto.offset.reset=latest` у нового потребителя, которому нужна история. **Верно:** для истории ставьте `earliest`; `latest` пропустит всё, что записано до подключения.

### Шпаргалка

- Запись не удаляется при чтении; срок хранения по умолчанию 7 дней.
- Группа (`group.id`) хранит свою позицию; разные группы получают все записи.
- Закоммиченный offset = offset следующей непрочитанной записи.
- Новая группа: `auto.offset.reset` — `latest` (по умолчанию), `earliest`, `none`. `--from-beginning` = `earliest`, только для группы без позиции.
- `kafka-consumer-groups.sh --list`; `--describe --group имя` (`LAG` = `LOG-END-OFFSET` − `CURRENT-OFFSET`).
- `--reset-offsets --group имя --topic топик --to-earliest|--to-latest|--to-offset N|--shift-by N [--execute]`; без `--execute` пробный прогон; группа неактивна.
- Окно свойств: `участник.настройка=значение`.

## task kfk-queue-or-log

```json
{
  "type": "choice",
  "title": "Пересчитать отчёт за неделю",
  "xp": 10,
  "hints": [
    "Раздел «Очередь и журнал».",
    "Спросите себя: удаляется ли запись, когда её прочитали?",
    "Нужно свойство, которого у очереди нет: повторное чтение уже прочитанного."
  ],
  "options": [
    "Нельзя: после чтения записи удаляются, так же как из очереди",
    "Можно, пока записи не удалены по сроку хранения: новая группа с `auto.offset.reset=earliest` или сброс позиции прочитают их заново",
    "Можно, но только если снова отправить все события продюсером",
    "Можно, но только пока работает потребитель, который прочитал их в первый раз"
  ],
  "answer": [1],
  "explanation": "Kafka удаляет записи по сроку или размеру хранения, а не после чтения. Пока запись не удалена, любая группа может прочитать её заново: либо новая группа с earliest, либо уже существующая после --reset-offsets. Повторно отправлять события не нужно. От работы первого потребителя повторное чтение не зависит: у каждой группы своя позиция."
}
```

Рассылка уже обработала все события заказов за неделю. Аналитик просит пересчитать отчёт по тем же событиям. Срок хранения топика по умолчанию (семь дней) ещё не истёк. Что верно?

## task kfk-late-analytics

```json
{
  "type": "scenario",
  "title": "Аналитика пропустила клики",
  "xp": 20,
  "scenario": "w1-late-analytics",
  "hints": [
    "Разделы «С какого места начинает читать группа» и «Сценарии лаборатории».",
    "У новой группы нет позиции, и потребитель подключился после записи. Нужна настройка потребителя `auto.offset.reset`.",
    "В окне свойств замените значение: `analytics.auto.offset.reset=…` (`earliest` или `latest`)."
  ],
  "check": {}
}
```

Продюсер `site` пишет в топик `clicks` двадцать записей (`click 1` … `click 20`), по десять в секунду, и заканчивает к 2000-й миллисекунде. Потребитель `analytics` (группа `analytics`) подключается в момент 3000 мс, обрабатывает запись за 20 мс. Группа новая, позиции у неё нет.

Сейчас `analytics` не обработал ни одной записи. Измените настройку потребителя в окне свойств так, чтобы он обработал все двадцать записей к 20000-й миллисекунде. Править нужно только свойства.

```properties starter
# auto.offset.reset: earliest — с начала журнала, latest — с конца
analytics.auto.offset.reset=latest
```

```properties solution
analytics.auto.offset.reset=earliest
```

## task kfk-replay-invoices

```json
{
  "type": "console",
  "title": "Перепровести два счёта",
  "xp": 20,
  "hints": [
    "Раздел «Перечитывание: сброс позиции».",
    "Команда `kafka-consumer-groups.sh --reset-offsets`: куда ставить позицию и что нужно, чтобы она действительно изменилась.",
    "Шаблон: `kafka-consumer-groups.sh --bootstrap-server localhost:9092 --reset-offsets --group billing --topic invoices --to-offset … --execute`."
  ],
  "check": { "compare": ["offsets"] }
}
```

В топике `invoices` четыре счёта (`invoice 1001` … `invoice 1004`, offset от 0 до 3). Группа `billing` прочитала все четыре, её позиция равна 4. Из-за ошибки в коде два последних счёта (1003 и 1004) нужно провести заново. Поставьте позицию группы `billing` на offset 2 по топику `invoices`. Потребителей у группы сейчас нет. Сами записи не читайте и не меняйте.

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic invoices --partitions 1 --replication-factor 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic invoices <<EOF
invoice 1001
invoice 1002
invoice 1003
invoice 1004
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic invoices --group billing --from-beginning --max-messages 4
```

```broker starter
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --reset-offsets --group billing --topic invoices --to-offset 2
```

```broker solution
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --reset-offsets --group billing --topic invoices --to-offset 2 --execute
```

## task kfk-review-groups-session

```json
{
  "type": "review",
  "title": "Сессия в консоли: почему ничего не вывелось",
  "xp": 20,
  "hints": [
    "Раздел «С какого места начинает читать группа».",
    "Проверьте для каждой группы: есть ли у неё сохранённая позиция на момент команды.",
    "Строка 4 вернулась пустой, потому что позиция группы `mail` уже стоит на конце журнала, а строка 5 — другая группа."
  ],
  "lines": [4, 5],
  "options": [
    "Строка 4 ничего не вывела, потому что записи удалились после чтения в строке 3",
    "Строка 4 ничего не вывела, потому что у группы `mail` уже есть позиция 4, а `--from-beginning` действует только для группы без позиции",
    "Строка 5 вывела все записи, потому что у группы `stats` своя независимая позиция",
    "Чтобы `mail` прочитала записи ещё раз, нужно удалить топик и создать его заново"
  ],
  "answer": [1, 2],
  "explanation": "После строки 3 группа mail сохранила позицию 4, поэтому на строке 4 флаг --from-beginning не действует: он нужен только группе без позиции, и читать больше нечего. Записи при этом никуда не пропали: строка 5 показывает их целиком, потому что у группы stats своя позиция, и сохранённой у неё нет. Утверждение про удаление после чтения неверно: Kafka удаляет записи только по сроку хранения. Удалять и пересоздавать топик не нужно: достаточно kafka-consumer-groups.sh --reset-offsets с --execute."
}
```

Инженер выполнил команды ниже и удивился: вторая попытка группы `mail` ничего не вывела. Какие утверждения верны? Отметьте все верные.

```text code
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic receipts --partitions 1 --replication-factor 1
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic receipts   # записано четыре записи: receipt 1 … receipt 4
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic receipts --group mail --from-beginning --max-messages 4
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic receipts --group mail --from-beginning --max-messages 4   # вывод: (песочница: новых сообщений нет), Processed a total of 0 messages
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic receipts --group stats --from-beginning --max-messages 4   # вывод: receipt 1 … receipt 4
```
