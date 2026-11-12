# Prefetch и честная раздача

Сервис обработки видео получает ролики в одну очередь, а читают её два потребителя: быстрый на видеокарте и медленный на обычном процессоре. Если брокер раздаст ролики поровну и сразу, медленный потребитель получит половину и будет перебирать её минутами, пока быстрый скучает. Ограничить число неподтверждённых сообщений у каждого потребителя помогает `prefetch`.

### Окно prefetch

Брокер присылает сообщения потребителю сам, не дожидаясь запроса. **Окно prefetch** (`prefetch_count`) — сколько сообщений может быть выдано потребителю и не подтверждено одновременно.

- Пока в окне есть место, брокер выдаёт сообщения. Как только потребитель подтвердил одно, освободилось место, и брокер выдаёт следующее.
- Окно считается **для каждого потребителя отдельно**: два потребителя с окном 2 вместе держат до четырёх неподтверждённых сообщений.
- `0` — без ограничения: брокер выдаёт всё, что есть.
- Окно работает только при ручном подтверждении. Потребитель с автоподтверждением получает сообщения, не оглядываясь на окно: подтверждение приходит сразу при выдаче.
- Сообщения между потребителями раздаются по кругу среди тех, у кого в окне есть место. В песочнице это упрощённая модель; в настоящем брокере порядок раздачи может отличаться.

Песочница не моделирует общее окно на канал (`global` QoS, в RabbitMQ 4.3 оно по умолчанию выключено) и ограничение по размеру в байтах: RabbitMQ его не поддерживает. Задаётся только число сообщений.

### sim consume и окно

```text
sim consume ОЧЕРЕДЬ --prefetch N
```

- `--prefetch N` — размер окна нового потребителя. Без флага окно равно `0`, то есть без ограничения.
- Каждый вызов `sim consume` подключает ещё одного потребителя. У каждого свои `ctag` и своё окно.
- Теги доставки общие для канала, поэтому в строках `[sim] tag=…` нумерация сквозная.

Состояние потребителей показывает `rabbitmqctl list_consumers`: очередь, канал, метка потребителя, нужно ли подтверждение (`ack_required`), размер окна (`prefetch_count`) и аргументы.

Пример. Семь миниатюр, два потребителя с окном 2 и третий с автоподтверждением.

```broker example
rabbitmqadmin queues declare --name thumbs --type classic --durable true
rabbitmqadmin publish message -k thumbs -m "thumb 1"
rabbitmqadmin publish message -k thumbs -m "thumb 2"
rabbitmqadmin publish message -k thumbs -m "thumb 3"
rabbitmqadmin publish message -k thumbs -m "thumb 4"
rabbitmqadmin publish message -k thumbs -m "thumb 5"
rabbitmqadmin publish message -k thumbs -m "thumb 6"
rabbitmqadmin publish message -k thumbs -m "thumb 7"
sim consume thumbs --prefetch 2
sim consume thumbs --prefetch 2
rabbitmqctl list_consumers
rabbitmqadmin queues list --columns name,messages_ready,messages_unacknowledged,consumers
sim consume thumbs --prefetch 0 --auto-ack
rabbitmqadmin queues list --columns name,messages_ready,messages_unacknowledged,consumers
```

Результат:

```text
declared queue 'thumbs' in virtual host '/'
published the message
published the message
published the message
published the message
published the message
published the message
published the message
[sim] потребитель amq.ctag-1 на очереди thumbs (prefetch=2, ручное подтверждение)
[sim] tag=1 queue=thumbs redelivered=false body=thumb 1
[sim] tag=2 queue=thumbs redelivered=false body=thumb 2
[sim] потребитель amq.ctag-2 на очереди thumbs (prefetch=2, ручное подтверждение)
[sim] tag=1 queue=thumbs redelivered=false body=thumb 1
[sim] tag=2 queue=thumbs redelivered=false body=thumb 2
[sim] tag=3 queue=thumbs redelivered=false body=thumb 3
[sim] tag=4 queue=thumbs redelivered=false body=thumb 4
queue_name	channel_pid	consumer_tag	ack_required	prefetch_count	arguments
thumbs	<rabbit@sandbox.0.16>	amq.ctag-1	true	2	{}
thumbs	<rabbit@sandbox.0.16>	amq.ctag-2	true	2	{}
┌────────┬────────────────┬─────────────────────────┬───────────┐
│ name   │ messages_ready │ messages_unacknowledged │ consumers │
├────────┼────────────────┼─────────────────────────┼───────────┤
│ photos │ 8              │ 0                       │ 0         │
│ thumbs │ 3              │ 4                       │ 2         │
└────────┴────────────────┴─────────────────────────┴───────────┘
[sim] потребитель amq.ctag-3 на очереди thumbs (prefetch=0, автоподтверждение)
[sim] tag=1 queue=thumbs redelivered=false body=thumb 1
[sim] tag=2 queue=thumbs redelivered=false body=thumb 2
[sim] tag=3 queue=thumbs redelivered=false body=thumb 3
[sim] tag=4 queue=thumbs redelivered=false body=thumb 4
┌────────┬────────────────┬─────────────────────────┬───────────┐
│ name   │ messages_ready │ messages_unacknowledged │ consumers │
├────────┼────────────────┼─────────────────────────┼───────────┤
│ photos │ 8              │ 0                       │ 0         │
│ thumbs │ 0              │ 4                       │ 3         │
└────────┴────────────────┴─────────────────────────┴───────────┘
```

Очередь `photos` с восемью сообщениями подготовлена для задания этого урока и в разборе не участвует. После каждого `sim consume` консоль печатает все сообщения, которые у канала ещё не подтверждены: поэтому второй потребитель показывает теги 1–4, хотя сам получил только 3 и 4. Столбец `channel_pid` содержит условный идентификатор канала.

Два потребителя с окном 2 вместе держат 4 неподтверждённых сообщения, ещё 3 ждут в очереди. Третий потребитель, с автоподтверждением и окном `0`, забрал все три оставшихся сразу. Они подтверждены при выдаче, поэтому `messages_unacknowledged` по-прежнему равно `4`.

Окно освобождается после подтверждения. Пример: окно 2 и пять сообщений.

```broker example
rabbitmqadmin queues declare --name covers --type classic --durable true
rabbitmqadmin publish message -k covers -m "cover 1"
rabbitmqadmin publish message -k covers -m "cover 2"
rabbitmqadmin publish message -k covers -m "cover 3"
rabbitmqadmin publish message -k covers -m "cover 4"
rabbitmqadmin publish message -k covers -m "cover 5"
sim consume covers --prefetch 2
sim ack 1
rabbitmqadmin queues list --columns name,messages_ready,messages_unacknowledged
```

После `sim consume` у потребителя теги 1 и 2. Команда `sim ack 1` освобождает место, и брокер выдаёт `cover 3` с тегом 3: у потребителя снова два неподтверждённых (2 и 3), а в очереди остаётся два готовых. Список показывает `2` готовых и `2` неподтверждённых.

### Как выбрать размер окна

- Долгая и неравномерная работа (видео, отчёты): окно `1` или небольшое. Работа распределяется честно, быстрый потребитель берёт больше.
- Короткие одинаковые сообщения, много тысяч в секунду: окно побольше, десятки. Иначе потребитель каждый раз ждёт ответа брокера. Конкретное число подбирают измерением.
- Окно `0` без причины опасно: потребитель набирает в память всю очередь, а при его падении все выданные сообщения возвращаются в очередь и раздаются заново.

### Окно в сценарии

В сценарии размер окна задаёт свойство потребителя `prefetch_count`. Пример: два потребителя на одной очереди, у каждого окно `0`. `gpu` обрабатывает ролик 100 мс, `cpu` — 700 мс. Десять роликов приходят по двадцать в секунду.

```scenario example
{
  "sim": "rabbit",
  "seed": 1,
  "durationMs": 5000,
  "setup": "rabbitmqadmin queues declare --name videos --type classic --durable true",
  "actors": [
    { "id": "uploader", "kind": "producer", "rate": 20, "count": 10, "message": { "body": "video {n}", "exchange": "", "routingKey": "videos" }, "config": {} },
    { "id": "gpu", "kind": "consumer", "queue": "videos", "processMs": 100, "config": { "auto_ack": false, "prefetch_count": 0 } },
    { "id": "cpu", "kind": "consumer", "queue": "videos", "processMs": 700, "config": { "auto_ack": false, "prefetch_count": 0 } }
  ],
  "faults": [],
  "expect": [
    { "kind": "latencyP95Below", "ms": 2000 },
    { "kind": "processedAtLeast", "actor": "gpu", "count": 8, "byMs": 5000 }
  ]
}
```

Новые условия `expect`:

- `latencyP95Below` — задержка от публикации до конца обработки, которую не превышают 95% сообщений, должна быть не больше `ms` миллисекунд;
- `processedAtLeast` вы уже видели.

Журнал по `process`:

```text
100   process  gpu  gpu обработал uploader-1
...
600   process  gpu  gpu обработал uploader-10
800   process  cpu  cpu обработал uploader-3
1500  process  cpu  cpu обработал uploader-5
2200  process  cpu  cpu обработал uploader-7
2900  process  cpu  cpu обработал uploader-9
```

Брокер раздал ролики по очереди: `cpu` получил четыре и разбирает их до 2900 мс, а `gpu` закончил на 600 мс и простаивает. Итог: `latencyP95Below` не выполнено («Задержка p95 до 2500 мс, предел 2000 мс»), `processedAtLeast` не выполнено («gpu: обработано 6 из 8 к 5000 мс»). Со свойствами `gpu.prefetch_count=1` и `cpu.prefetch_count=1` `cpu` держит не больше одного ролика, и остальное берёт `gpu`: он обрабатывает восемь, `cpu` — два. Оба условия выполнены, p95 не выше 2000 мс.

### Частые ошибки

- **Ошибка:** оставить окно `0` для тяжёлой обработки. **Верно:** задать окно `1` или небольшое число, чтобы медленный потребитель не копил очередь у себя.
- **Ошибка:** ставить окно `1` для миллионов мелких сообщений. **Верно:** увеличить окно: потребитель простаивает, пока ждёт следующее сообщение.
- **Ошибка:** ждать, что окно ограничит потребителя с автоподтверждением. **Верно:** при `--auto-ack` и `auto_ack: true` окно не работает, сообщения подтверждены с выдачей.
- **Ошибка:** считать окно общим на всех потребителей. **Верно:** окно действует на каждого потребителя отдельно.

### Шпаргалка

- `prefetch_count` — сколько неподтверждённых сообщений у одного потребителя; `0` — без ограничения.
- Подтверждение освобождает место, и брокер выдаёт следующее сообщение.
- `sim consume Q --prefetch N` — потребитель с окном `N`; `--auto-ack` — окно не применяется.
- `rabbitmqctl list_consumers` — потребители, `ack_required` и `prefetch_count`.
- В сценарии: свойство `актор.prefetch_count=N`; `latencyP95Below` — задержка p95.

## task rmq-window-three

```json
{
  "type": "console",
  "title": "Окно из трёх сообщений",
  "xp": 15,
  "hints": [
    "Раздел «sim consume и окно».",
    "Подключите потребителя с окном 3, затем подтвердите первое сообщение: окно освободится, и брокер выдаст следующее.",
    "Шаблон: `sim consume photos --prefetch …`, затем `sim ack …`."
  ],
  "check": {
    "compare": ["messages"],
    "require": [{ "pattern": "--prefetch 3", "message": "Подключите потребителя с окном 3: --prefetch 3" }]
  }
}
```

В очереди `photos` восемь фото: `photo 1` … `photo 8`. Подключите потребителя с окном 3 и подтвердите первое выданное сообщение. После этого у потребителя должно быть три неподтверждённых сообщения, а в очереди четыре готовых.

```broker setup
rabbitmqadmin queues declare --name photos --type classic --durable true
rabbitmqadmin publish message -k photos -m "photo 1"
rabbitmqadmin publish message -k photos -m "photo 2"
rabbitmqadmin publish message -k photos -m "photo 3"
rabbitmqadmin publish message -k photos -m "photo 4"
rabbitmqadmin publish message -k photos -m "photo 5"
rabbitmqadmin publish message -k photos -m "photo 6"
rabbitmqadmin publish message -k photos -m "photo 7"
rabbitmqadmin publish message -k photos -m "photo 8"
```

```broker starter
sim consume photos --prefetch …
sim ack …
```

```broker solution
sim consume photos --prefetch 3
sim ack 1
```

## task rmq-prefetch-choice

```json
{
  "type": "choice",
  "title": "Какое окно выбрать",
  "xp": 10,
  "hints": [
    "Раздел «Как выбрать размер окна».",
    "Сравните два случая: работа долгая и неравномерная или короткая и однородная.",
    "Для долгой неравномерной работы нужно окно `1` или небольшое, для коротких однородных сообщений — побольше."
  ],
  "options": [
    "Окно `0` для обоих сервисов: брокер сам разберётся",
    "Рендер роликов — окно `1`; рассылка коротких писем — окно в десятки",
    "Рендер роликов — окно в сотни; рассылка писем — окно `1`",
    "Окно одинаково `1` везде, потому что так безопаснее для данных"
  ],
  "answer": [1],
  "explanation": "Рендер ролика занимает минуты и сильно различается по времени, поэтому окно `1` не даёт одному потребителю накопить работу, пока другой простаивает. Письма короткие и однородные: при окне `1` потребитель после каждого письма ждёт брокера, поэтому окно в десятки выгоднее. Окно `0` у обоих означает, что потребитель набирает всю очередь в память. Окно в сотни для рендера повторяет эту беду, а `1` для писем замедляет рассылку. Окно `1` везде безопасно для данных, но неоправданно медленно для коротких сообщений."
}
```

В одной системе два сервиса читают свои очереди. Сервис рендера роликов обрабатывает сообщение от одной до десяти минут. Сервис рассылки отправляет короткие письма, каждое меньше 5 мс. У обоих ручное подтверждение. Какие окна prefetch разумны?

## task rmq-slow-worker

```json
{
  "type": "scenario",
  "title": "Медленный потребитель копит отчёты",
  "xp": 25,
  "scenario": "w3-prefetch-slow",
  "hints": [
    "Раздел «Окно в сценарии»: что случается при окне `0`.",
    "Сейчас брокер выдаёт `worker-slow` столько же сообщений, сколько `worker-fast`, и сразу. Нужно ограничить число неподтверждённых сообщений. За это отвечает `prefetch_count`.",
    "В окне свойств задайте `worker-slow.prefetch_count=…` небольшим числом, начиная с `1`."
  ],
  "check": {}
}
```

Планировщик `scheduler` создаёт двенадцать отчётов в очередь `reports`, по двадцать в секунду. Читают её два потребителя: `worker-fast` обрабатывает отчёт 100 мс, `worker-slow` — 800 мс. Сейчас у обоих окно `0`, и брокер раздаёт отчёты по кругу, не глядя на скорость. `worker-slow` разбирает свои отчёты до 4100 мс, p95 задержки — 3600 мс.

Задайте окно в окне свойств так, чтобы задержка p95 не превышала 2500 мс, а `worker-fast` обработал не меньше восьми отчётов к 6000 мс. Правьте только свойства.

```properties starter
worker-fast.prefetch_count=0
worker-slow.prefetch_count=0
```

```properties solution
worker-fast.prefetch_count=1
worker-slow.prefetch_count=1
```

## task rmq-read-consumers

```json
{
  "type": "review",
  "title": "Опасные потребители рендера",
  "xp": 15,
  "hints": [
    "Разделы «Окно prefetch» и «Как выбрать размер окна».",
    "Колонка `ack_required` показывает ручное подтверждение, `prefetch_count` — окно. Для долгой обработки опасно окно `0` и автоподтверждение.",
    "Подходят строки с `true` и малым окном. Опасны `prefetch_count` равное `0` и `ack_required` равное `false`."
  ],
  "lines": [2, 3],
  "options": [
    "Строка 1: `ack_required` равно `true`, окно `1`",
    "Строка 2: окно `0`, потребитель наберёт в память всю очередь",
    "Строка 3: `ack_required` равно `false`, при падении выданные ролики пропадут",
    "Строка 4: окно `2`, ручное подтверждение"
  ],
  "answer": [1, 2],
  "explanation": "Строка 2 (`prefetch_count` равно `0`) не ограничивает число выданных сообщений: потребитель получит всю очередь и будет держать её у себя. Строка 3 (`ack_required` равно `false`) — автоподтверждение: сообщения подтверждены при выдаче, и если рендер упадёт, они потеряны, а окно к ним не применяется. Строка 1 — образцовая настройка для долгой работы. Строка 4 допустима: ручное подтверждение, окно небольшое."
}
```

Администратор вывел список потребителей очереди `render`. Рендер роликов идёт минутами, терять ролики нельзя. В каких строках настройка опасна? Отметьте все такие строки.

```text code
render	<rabbit@node.0.1>	amq.ctag-a	true	1	{}
render	<rabbit@node.0.2>	amq.ctag-b	true	0	{}
render	<rabbit@node.0.3>	amq.ctag-c	false	0	{}
render	<rabbit@node.0.4>	amq.ctag-d	true	2	{}
```
