# Метрики, flow control и alarm

В пятницу вечером в поддержку приходят жалобы: письма с чеками опаздывают на час. Брокер при этом «жив», ошибок в логах нет. Чтобы понять, что происходит, нужно уметь читать несколько чисел: сколько сообщений ждёт, сколько у потребителей в работе, сколько потребителей подключено. А когда брокеру не хватает памяти или диска, он сам останавливает издателей. Этот урок учит и читать метрики, и понимать такую остановку.

### Что смотреть у очереди

Три числа очереди вы уже видели в таблицах `queues list`. Теперь важно понимать, что говорит каждое.

- `messages_ready` — сколько сообщений готово к выдаче и ждёт потребителя. Если число растёт, сообщения приходят быстрее, чем уходят.
- `messages_unacknowledged` — сколько сообщений выдано потребителям, но ещё не подтверждено. Это работа «в процессе». Верхняя граница: `prefetch` каждого потребителя, умноженный на число потребителей. Напоминание: `prefetch` — сколько неподтверждённых сообщений брокер выдаёт потребителю заранее.
- `consumers` — сколько потребителей подписано. Ноль потребителей при растущей `messages_ready` означает, что очередь никто не читает.

```text
rabbitmqadmin queues list --columns name,messages_ready,messages_unacknowledged,consumers
rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers
rabbitmqctl list_consumers
```

- Первая команда печатает таблицу с рамкой, вторая — те же колонки через табуляцию, как их печатает сам узел.
- `list_consumers` печатает по строке на потребителя: очередь, идентификатор канала, тег потребителя, требуется ли подтверждение (`ack_required`) и его `prefetch_count`.

Пример на очереди `digest` с пятью сообщениями:

```broker example
rabbitmqadmin queues declare --name digest --type classic --durable true
rabbitmqadmin publish message --routing-key digest --payload "digest 1"
rabbitmqadmin publish message --routing-key digest --payload "digest 2"
rabbitmqadmin publish message --routing-key digest --payload "digest 3"
rabbitmqadmin publish message --routing-key digest --payload "digest 4"
rabbitmqadmin publish message --routing-key digest --payload "digest 5"
rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers
sim consume digest --prefetch 2
rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers
rabbitmqctl list_consumers
```

```text
declared queue 'digest' in virtual host '/'
published the message
published the message
published the message
published the message
published the message
name	messages_ready	messages_unacknowledged	consumers
digest	5	0	0
jobs	6	0	0
[sim] потребитель amq.ctag-1 на очереди digest (prefetch=2, ручное подтверждение)
[sim] tag=1 queue=digest redelivered=false body=digest 1
[sim] tag=2 queue=digest redelivered=false body=digest 2
name	messages_ready	messages_unacknowledged	consumers
digest	3	2	1
jobs	6	0	0
queue_name	channel_pid	consumer_tag	ack_required	prefetch_count	arguments
digest	<rabbit@sandbox.0.12>	amq.ctag-1	true	2	{}
```

Очередь `jobs` с шестью сообщениями подготовлена для задания этого урока, в примере она не меняется. До подключения в очереди `digest` пять готовых сообщений и ни одного потребителя. После `sim consume … --prefetch 2` два сообщения выданы (они в `messages_unacknowledged`), три ждут, а `list_consumers` показывает единственного потребителя с окном 2.

### Почему очередь растёт

Растущая `messages_ready` — симптом. Причину подскажет сочетание чисел.

| Что видно | Вероятная причина |
|---|---|
| `consumers` = 0, `messages_ready` растёт | Потребитель не подключён: упал, не получил права на чтение, смотрит не в тот vhost |
| `consumers` > 0, `messages_ready` растёт, `messages_unacknowledged` на пределе окна | Потребители не успевают: обработка медленнее притока |
| `messages_ready` = 0, а `messages_unacknowledged` большое | Сообщения разобраны потребителями и застряли у них: окно слишком широкое или потребитель завис |
| Растёт число повторных доставок | Потребитель отклоняет сообщения с возвратом в очередь, и они ходят по кругу |

Обратите внимание на третью строку. Пустая `messages_ready` не доказывает, что всё хорошо: у потребителя может лежать работа, которую он не успеет сделать. Смотрите на метрики вместе.

Справка о повторных доставках. Сообщение вернулось в очередь после `nack` или `reject` с `requeue`: брокер помечает его как повторно доставленное (`redelivered`). Если причина отказа не исчезает, цикл повторяется.

### Метрики сценария

Задания-сценарии работают на виртуальных часах и записывают ряды метрик, как мониторинг настоящего брокера. Они называются так:

- `q.очередь.ready`, `q.очередь.unacked`, `q.очередь.redelivered` — три числа очереди и счётчик повторных доставок. Для очереди не в vhost `/` имя пишется `q.vhost:очередь.ready`.
- `rate.publish`, `rate.deliver`, `rate.ack` — скорости публикации, выдачи и подтверждений в сообщениях в секунду за последнюю секунду.
- `latency.p95` — задержка от публикации до обработки: 95% сообщений обработаны не позже этого значения.

Условия сценария задают предел этим рядам: `depthBelow` — к сроку `byMs` начиная с момента `byMs` в очереди `queue` не бывает больше `value` готовых сообщений, `latencyP95Below` — задержка не выше предела, `processedAtLeast` — потребитель обработал не меньше нужного к сроку.

### Широкое окно и «спрятанная» очередь

Пример из практики: два потребителя, быстрый и медленный, читают одну очередь, и у обоих `prefetch_count` равен `0`. Ноль означает «без ограничения»: брокер сразу раздаёт сообщения по кругу, и медленному достаётся половина. Очередь при этом пуста (`ready` = 0), а у медленного потребителя копится работа в `unacknowledged`. Быстрый тем временем простаивает.

Решение вы уже знаете из мира про надёжность: `prefetch_count` = 1. Брокер даёт потребителю следующее сообщение только после подтверждения предыдущего, поэтому быстрый берёт больше. В сценарии это свойство потребителя: `имя.prefetch_count=1`. Вы увидите это в задании.

### Flow control и alarm

Брокер защищает себя от перегрузки. Различают два механизма.

Flow control (внутренний backpressure). Если издатель отправляет быстрее, чем очереди успевают принимать, соединение автоматически притормаживается. Это происходит много раз в секунду и незаметно для приложения. Такое соединение отображается в состоянии `flow`.

Alarm. Когда занятая узлом память превышает порог `vm_memory_high_watermark` (по умолчанию 0,6, то есть 60% оперативной памяти), срабатывает memory alarm. Когда свободного места на диске меньше `disk_free_limit` (по умолчанию 50 МБ), срабатывает disk alarm. При любом alarm брокер блокирует все соединения, которые публикуют. Читающие соединения работают, поэтому потребители продолжают разбирать очереди и освобождают память. Когда alarm снимается, публикация возобновляется.

Что это значит для приложения:

- Издатель на время alarm «зависает»: вызов публикации не возвращается. Клиентские библиотеки умеют получать уведомление `connection.blocked`.
- Подтверждения издателя (publisher confirms) помогают отличить задержку от потери: подтверждение придёт, когда сообщение дойдёт до очереди.
- Перезапускать потребителей при alarm бесполезно. Нужно снять причину: освободить память или диск, ускорить потребителей, ограничить рост очередей.

Что упрощено в песочнице. Настоящий flow control, когда издателя притормаживают постоянно, в ней не моделируется. Моделируется только alarm: сценарий включает и выключает его событием `alarm.memory`, издатели блокируются, потребители работают. Включить alarm командой нельзя: это делает сценарий, а не вы. Пример ниже показывает, что видит издатель:

```scenario example
{
  "sim": "rabbit",
  "seed": 1,
  "durationMs": 3000,
  "setup": "rabbitmqadmin queues declare --name page-views --type classic --durable true",
  "actors": [
    { "id": "web", "kind": "producer", "rate": 10, "count": 20, "message": { "body": "view {n}", "exchange": "", "routingKey": "page-views" }, "config": { "confirms": true } },
    { "id": "stats", "kind": "consumer", "queue": "page-views", "processMs": 50, "config": { "auto_ack": false, "prefetch_count": 1 } }
  ],
  "faults": [
    { "at": 500, "kind": "alarm.memory", "on": true },
    { "at": 1500, "kind": "alarm.memory", "on": false }
  ],
  "expect": [
    { "kind": "noLoss" },
    { "kind": "allConfirmed" },
    { "kind": "processedAtLeast", "actor": "stats", "count": 20, "byMs": 3000 },
    { "kind": "latencyP95Below", "ms": 300 }
  ]
}
```

Что показывает журнал. С 500 мс `alarm.memory` включён: публикации с `web-6` по `web-15` задерживаются («соединение заблокировано alarm»). В 1500 мс alarm снят, и все десять попадают в очередь разом. Ничего не потеряно, все публикации подтверждены, `stats` обработал все 20. Но условие `latencyP95Below` с пределом 300 мс не выполняется: задержка p95 достигает 550 мс. Для приложения alarm — это не потеря, а задержка. Условие, которое не выполняется, вы видите в результате прогона.

### Частые ошибки

- **Ошибка:** «очередь пуста, значит всё в порядке». **Верно:** смотрите и на `messages_unacknowledged`, и на `consumers`. Пустая `ready` при большой `unacknowledged` означает работу, застрявшую у потребителей.
- **Ошибка:** «`prefetch_count` = 0 — самое быстрое». **Верно:** при разной скорости потребителей ноль задерживает сообщения у медленного. Окно 1 даёт честную раздачу.
- **Ошибка:** «при alarm перезапустим потребителей». **Верно:** потребители при alarm и так работают. Нужно освободить память или диск.
- **Ошибка:** «растёт очередь — добавим память брокеру». **Верно:** сначала выясните причину: нет потребителя, потребитель не успевает или сообщения ходят по кругу.

### Шпаргалка

- `messages_ready` — ждёт; `messages_unacknowledged` — в работе; `consumers` — подписано.
- `rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers`, `rabbitmqctl list_consumers`.
- Причины роста: нет потребителя, потребители не успевают, застряли в `unacknowledged`, цикл возвратов.
- Окно `prefetch_count` = 1 даёт честную раздачу; свойство сценария `имя.prefetch_count=1`.
- Alarm (память `vm_memory_high_watermark`, диск `disk_free_limit`) блокирует издателей, потребители работают.
- Ряды сценария: `q.очередь.ready|unacked|redelivered`, `rate.publish|deliver|ack`, `latency.p95`.

## task rmq-read-table

```json
{
  "type": "review",
  "title": "Что говорит таблица очередей",
  "xp": 10,
  "hints": [
    "Раздел «Что смотреть у очереди».",
    "Для каждой очереди сопоставьте три числа. Подумайте, что значит `consumers` = 0 и что значит ненулевой `messages_unacknowledged`.",
    "Посмотрите на строку `audit`: сообщения есть, а потребителей нет."
  ],
  "code": "name    messages_ready  messages_unacknowledged  consumers\norders  0               10                       2\nmail    480             3                        3\naudit   12              0                        0",
  "codeLanguage": "text",
  "lines": [4],
  "options": [
    "Очередь `audit` никто не читает: сообщения копятся, пока не подключится потребитель",
    "Очередь `orders` пуста, значит у неё нет работы",
    "В очереди `mail` потеряно три сообщения: столько значится в `messages_unacknowledged`",
    "Очередь `mail` растёт, потому что её нужно перезапустить"
  ],
  "answer": [0],
  "explanation": "У `audit` двенадцать готовых сообщений и ноль потребителей: читать некому. У `orders` пусто в `messages_ready`, но десять сообщений в работе у двух потребителей. «Пусто» не значит «нет работы». У `mail` три сообщения не потеряны, а выданы потребителям и ещё не подтверждены. Очередь `mail` растёт, потому что потребители не успевают, а не потому, что очередь нужно перезапускать: у очереди нет такой операции, она не зависает."
}
```

Дежурный выгрузил таблицу очередей в разгар нагрузки. Выберите верное утверждение.

## task rmq-metrics-console

```json
{
  "type": "console",
  "title": "Окно prefetch в цифрах",
  "xp": 15,
  "hints": [
    "Раздел «Что смотреть у очереди»; команды `sim consume` и `sim ack` — из урока про exchange по умолчанию.",
    "Потребитель с окном 2 получает два сообщения. Каждое подтверждение освобождает место, и брокер выдаёт следующее.",
    "Шаблон: `sim consume jobs --prefetch …`, `sim ack …`, затем `rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers`."
  ],
  "check": {
    "compare": ["messages"],
    "require": [
      { "pattern": "sim consume jobs", "message": "Подключите потребителя командой sim consume" },
      { "pattern": "list_queues", "message": "Выведите метрики командой rabbitmqctl list_queues" }
    ]
  }
}
```

В очереди `jobs` шесть сообщений. Подключите потребителя с окном `prefetch` 2 и подтвердите первое выданное сообщение. После этого в очереди должны остаться три готовых сообщения и два неподтверждённых. Затем выведите метрики очереди командой `rabbitmqctl list_queues` со столбцами `name`, `messages_ready`, `messages_unacknowledged`, `consumers`.

```broker setup
rabbitmqadmin queues declare --name jobs --type classic --durable true
rabbitmqadmin publish message --routing-key jobs --payload "job 1"
rabbitmqadmin publish message --routing-key jobs --payload "job 2"
rabbitmqadmin publish message --routing-key jobs --payload "job 3"
rabbitmqadmin publish message --routing-key jobs --payload "job 4"
rabbitmqadmin publish message --routing-key jobs --payload "job 5"
rabbitmqadmin publish message --routing-key jobs --payload "job 6"
```

```broker starter
sim consume jobs --prefetch …
sim ack …
rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers
```

```broker solution
sim consume jobs --prefetch 2
sim ack 1
rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers
```

## task rmq-fair-dispatch

```json
{
  "type": "scenario",
  "title": "Очередь пуста, а отчёты не готовы",
  "xp": 20,
  "scenario": "w5-hog",
  "hints": [
    "Раздел «Широкое окно и «спрятанная» очередь».",
    "Обоим потребителям нужно одно и то же свойство. Брокер должен выдавать следующее сообщение только после подтверждения предыдущего.",
    "Шаблон, две строки: `fast.prefetch_count=…` и `slow.prefetch_count=…`."
  ],
  "check": {}
}
```

Сервис отчётов собирает `report` из очереди `reports`. Читают её два воркера: `fast` (50 мс на отчёт) и `slow` (400 мс на отчёт). На мониторинге `messages_ready` равна нулю, но отчёты выходят с большой задержкой, и в `unacknowledged` постоянно лежит около десятка сообщений. Задержка p95 не должна превышать 1500 мс, а `fast` к концу сценария должен обработать не меньше 30 сообщений. Исправьте настройки воркеров свойствами.

```properties starter
fast.prefetch_count=…
slow.prefetch_count=…
```

```properties solution
fast.prefetch_count=1
slow.prefetch_count=1
```

## task rmq-alarm-choice

```json
{
  "type": "choice",
  "title": "Сработал memory alarm",
  "xp": 15,
  "hints": [
    "Раздел «Flow control и alarm».",
    "Вспомните, чьи соединения блокирует alarm и чьи нет.",
    "Alarm блокирует издателей. Потребители продолжают читать, и это помогает освободить память."
  ],
  "options": [
    "Издатели блокируются до снятия alarm, потребители продолжают работу; нужно освободить память или ускорить разбор очередей",
    "Блокируются потребители, а издатели продолжают писать; нужно перезапустить потребителей",
    "Брокер удаляет самые старые сообщения, поэтому перезапуск не нужен",
    "Блокируется только очередь с самым большим размером, остальные работают"
  ],
  "answer": [0],
  "explanation": "При alarm брокер приостанавливает чтение из соединений, которые публикуют, и освобождает память по мере того, как потребители разбирают очереди. Потребители не блокируются, поэтому их перезапуск ничего не даёт. Сообщения брокер при alarm не удаляет. Блокировка касается соединений издателей, а не отдельной очереди: на всех узлах кластера."
}
```

На брокере сработал memory alarm. Выберите верное описание происходящего и верное действие.
