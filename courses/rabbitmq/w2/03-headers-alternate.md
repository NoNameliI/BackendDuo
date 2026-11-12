# Headers и alternate exchange

Типография принимает документы на печать. Маршрут зависит не от ключа, а от свойств документа: формат, тип, срочность. Эти свойства лежат в заголовках сообщения. Для такого случая есть exchange типа `headers`. А когда ни одна привязка не подошла, сообщение можно не терять, а отправить в запасной exchange. Его называют alternate exchange.

### Заголовки сообщения и аргументы привязки

У сообщения есть заголовки: пары «имя — значение», например `format` = `pdf`. Публикуя через `rabbitmqadmin`, их передают внутри свойств сообщения:

```text
rabbitmqadmin publish message --exchange EXCHANGE --payload "ТЕКСТ" --properties '{"headers":{"ИМЯ":"ЗНАЧЕНИЕ"}}'
```

- `--properties` (или `-p`) — свойства сообщения в виде JSON-строки. Её берут в одинарные кавычки, чтобы двойные внутри не мешали.
- `"headers"` — объект с заголовками. Значения в заданиях этого курса — строки.

Привязка `headers`-exchange описывает условия в аргументах:

```text
rabbitmqadmin bindings declare --source EXCHANGE --destination-type queue --destination ОЧЕРЕДЬ --routing-key "" --arguments '{"x-match":"all","ИМЯ":"ЗНАЧЕНИЕ"}'
```

- `--arguments` — JSON-строка с аргументами привязки.
- `--routing-key ""` — ключ обязателен как флаг, но `headers` его игнорирует. Пишите пустую строку.
- `"x-match"` — режим сравнения, об этом ниже.
- Остальные пары — заголовки, которые должны быть у сообщения, с нужными значениями.

Exchange объявляют с типом `headers`: `exchanges declare --name ИМЯ --type headers --durable true`.

### Режим x-match

- `all` — совпасть должны все заголовки привязки: у сообщения есть каждый из них, и значения равны.
- `any` — достаточно, чтобы совпал любой один.
- `any-with-x` и `all-with-x` — то же самое, но заголовки с именами, начинающимися на `x-`, тоже участвуют в сравнении.

В режимах `all` и `any` заголовки на `x-` игнорируются. Это важно: пара `"x-source":"scanner"` в такой привязке ничего не проверяет. Режим указывайте явно, чтобы не гадать.

Пример. `pdf-print` принимает только счета в PDF (`all`). `urgent-any` берёт срочные или тревожные (`any`). `scans` ловит всё, что пришло со сканера, по служебному заголовку (`any-with-x`).

```broker example
rabbitmqadmin exchanges declare --name documents --type headers --durable true
rabbitmqadmin queues declare --name pdf-print --type classic --durable true
rabbitmqadmin queues declare --name urgent-any --type classic --durable true
rabbitmqadmin queues declare --name scans --type classic --durable true
rabbitmqadmin bindings declare --source documents --destination-type queue --destination pdf-print --routing-key "" --arguments '{"x-match":"all","format":"pdf","kind":"invoice"}'
rabbitmqadmin bindings declare --source documents --destination-type queue --destination urgent-any --routing-key "" --arguments '{"x-match":"any","priority":"high","kind":"alert"}'
rabbitmqadmin bindings declare --source documents --destination-type queue --destination scans --routing-key "" --arguments '{"x-match":"any-with-x","x-source":"scanner"}'
rabbitmqadmin publish message -e documents -m "doc 1" --properties '{"headers":{"format":"pdf","kind":"invoice"}}'
rabbitmqadmin publish message -e documents -m "doc 2" --properties '{"headers":{"format":"pdf","kind":"report","priority":"high"}}'
rabbitmqadmin publish message -e documents -k pdf -m "doc 3" --properties '{"headers":{"format":"png"}}'
rabbitmqadmin publish message -e documents -m "doc 4" --properties '{"headers":{"x-source":"scanner"}}'
rabbitmqadmin publish message -e documents -m "doc 5"
rabbitmqadmin get messages --queue pdf-print --count 9
rabbitmqadmin get messages --queue urgent-any --count 9
rabbitmqadmin get messages --queue scans --count 9
```

Результат:

```text
declared exchange 'documents' in virtual host '/'
declared queue 'pdf-print' in virtual host '/'
declared queue 'urgent-any' in virtual host '/'
declared queue 'scans' in virtual host '/'
declared a binding from 'documents' to queue 'pdf-print' with routing key '' in virtual host '/'
declared a binding from 'documents' to queue 'urgent-any' with routing key '' in virtual host '/'
declared a binding from 'documents' to queue 'scans' with routing key '' in virtual host '/'
published the message
published the message
published the message, but it was not routed to any queue
published the message
published the message, but it was not routed to any queue
┌───────────┬─────────────┬─────────────┬───────────────┬─────────┐
│ exchange  │ routing_key │ redelivered │ payload_bytes │ payload │
├───────────┼─────────────┼─────────────┼───────────────┼─────────┤
│ documents │             │ false       │ 5             │ doc 1   │
└───────────┴─────────────┴─────────────┴───────────────┴─────────┘
┌───────────┬─────────────┬─────────────┬───────────────┬─────────┐
│ exchange  │ routing_key │ redelivered │ payload_bytes │ payload │
├───────────┼─────────────┼─────────────┼───────────────┼─────────┤
│ documents │             │ false       │ 5             │ doc 2   │
└───────────┴─────────────┴─────────────┴───────────────┴─────────┘
┌───────────┬─────────────┬─────────────┬───────────────┬─────────┐
│ exchange  │ routing_key │ redelivered │ payload_bytes │ payload │
├───────────┼─────────────┼─────────────┼───────────────┼─────────┤
│ documents │             │ false       │ 5             │ doc 4   │
└───────────┴─────────────┴─────────────┴───────────────┴─────────┘
```

Три таблицы — это чтение очередей по порядку: в каждой из трёх очередей по одному сообщению. В `pdf-print` — `doc 1`, в `urgent-any` — `doc 2`, в `scans` — `doc 4`.

- `doc 1`: оба заголовка `all` совпали. `doc 2` — только `format`, а `kind` не `invoice`, поэтому в `pdf-print` его нет. Зато `priority=high` подходит `any`.
- `doc 3` имеет ключ `pdf`, но `headers` его не читает. Заголовок `format=png` ни одной привязке не подошёл.
- `doc 4` попало в `scans`: режим `any-with-x` учитывает `x-source`.
- `doc 5` без заголовков не подошло никому.

Команда `bindings list` покажет такие привязки с пустым ключом, а аргументы лаборатория в таблице не выводит. Если нужно вспомнить условия, смотрите команды объявления.

### Сообщение без маршрута

Если сообщению не нашлось очереди, брокер по умолчанию его молча отбрасывает. Так вышло с `doc 3` и `doc 5`. В уроке 2.4 разберём, как издателю узнать об этом. Здесь рассмотрим другой выход: поручить exchange передать такие сообщения дальше.

### Alternate exchange

Alternate exchange (AE) — запасной exchange. Если основной exchange не нашёл для сообщения ни одной очереди (привязок нет или ни одна не подошла), сообщение без изменений отправляется в AE и дальше маршрутизируется по его правилам.

AE задают аргументом при объявлении основного exchange:

```text
rabbitmqadmin exchanges declare --name ОСНОВНОЙ --type direct --durable true --arguments '{"alternate-exchange":"ЗАПАСНОЙ"}'
```

- `--arguments` — JSON с аргументами exchange.
- `"alternate-exchange"` — имя запасного exchange. Обычно им делают `fanout` с одной очередью «разобрать вручную».

Правила.

- AE срабатывает только когда маршрута нет. Если сообщение нашло хотя бы одну очередь, в AE оно не идёт.
- Цепочка: у AE может быть свой AE. Сообщение идёт дальше, пока не найдётся очередь, не кончится цепочка или не встретится exchange, который сообщение уже проходило.
- Сообщение, попавшее в очередь через AE, считается доставленным: флаг `mandatory` (урок 2.4) его не вернёт.
- Если AE, названного в аргументе, не существует, сообщение, у которого нет маршрута, просто теряется. Брокер лишь пишет предупреждение в журнал. Порядок объявления неважен, важно, чтобы AE появился до публикаций.
- У exchange по умолчанию (`""`) AE быть не может.
- Документация RabbitMQ советует задавать AE политикой, а аргумент считает не рекомендуемым: при споре побеждает аргумент. Политики лаборатория не моделирует, поэтому здесь только аргумент.

Пример. Все необработанные ключи `incoming` уходят в `lost-found` через `unrouted`.

```broker example
rabbitmqadmin exchanges declare --name incoming --type direct --durable true --arguments '{"alternate-exchange":"unrouted"}'
rabbitmqadmin exchanges declare --name unrouted --type fanout --durable true
rabbitmqadmin queues declare --name lost-found --type classic --durable true
rabbitmqadmin queues declare --name main-q --type classic --durable true
rabbitmqadmin bindings declare --source unrouted --destination-type queue --destination lost-found --routing-key ""
rabbitmqadmin bindings declare --source incoming --destination-type queue --destination main-q --routing-key ok
rabbitmqadmin publish message -e incoming -k ok -m "m1"
rabbitmqadmin publish message -e incoming -k oops -m "m2"
rabbitmqadmin get messages --queue main-q --count 9
rabbitmqadmin get messages --queue lost-found --count 9
```

Обе публикации выводят `published the message`: `m2` не отброшено, ведь AE нашёл ему очередь. В `main-q` лежит `m1` (ключ `ok`), в `lost-found` — `m2` (ключ `oops`). Сообщение осталось прежним: оно хранит исходный exchange `incoming` и ключ `oops`.

### Частые ошибки

- **Ошибка:** повторно объявить exchange без аргумента `alternate-exchange`, чтобы «добавить» AE. Брокер ответит `406 PRECONDITION_FAILED`: аргументы должны совпадать полностью. **Верно:** удалить exchange (`exchanges delete`) и объявить заново с аргументом.
- **Ошибка:** в `headers`-привязке положиться на заголовок `x-…` при `x-match` равном `all` или `any`. Такие заголовки игнорируются. **Верно:** `all-with-x` или `any-with-x`.
- **Ошибка:** ждать, что ключ сообщения влияет на `headers`-exchange. **Верно:** ключ игнорируется, решают заголовки.
- **Ошибка:** ждать, что AE получает копии всех сообщений основного exchange. **Верно:** AE принимает только то, для чего в основном exchange не нашлось очереди.

### Шпаргалка

- `headers`: ключ игнорируется; привязка с `--arguments '{"x-match":"all","имя":"значение"}'`.
- Публикация с заголовками: `--properties '{"headers":{"имя":"значение"}}'`.
- `all` — совпасть всем заголовкам; `any` — хотя бы одному; `any-with-x` и `all-with-x` учитывают заголовки на `x-`, остальные режимы их игнорируют.
- AE: `exchanges declare … --arguments '{"alternate-exchange":"ИМЯ"}'`; срабатывает, когда маршрута нет; цепочка допустима; сообщение не меняется.
- Нет AE — сообщение без маршрута теряется (предупреждение в журнале брокера).

## task rmq-headers-reports

```json
{
  "type": "routing",
  "title": "Отчёты по заголовкам",
  "xp": 20,
  "hints": [
    "Раздел «Режим x-match»: чем `all` отличается от `any`.",
    "Для `finance` оба заголовка обязательны (`all`), для `ops` достаточно любого из двух (`any`). Ключ маршрутизации в задании пустой и ничего не решает.",
    "Шаблон: `bindings declare --source reports --destination-type queue --destination … --routing-key \"\" --arguments '{\"x-match\":\"…\",\"…\":\"…\"}'`, две команды."
  ],
  "check": {
    "publish": [
      { "exchange": "reports", "routingKey": "", "headers": { "team": "finance", "type": "report" }, "body": "r-1" },
      { "exchange": "reports", "routingKey": "", "headers": { "team": "finance", "type": "memo" }, "body": "r-2" },
      { "exchange": "reports", "routingKey": "", "headers": { "team": "ops", "type": "report" }, "body": "r-3" },
      { "exchange": "reports", "routingKey": "", "headers": { "team": "finance", "type": "report", "level": "critical" }, "body": "r-4" },
      { "exchange": "reports", "routingKey": "", "headers": { "level": "info" }, "body": "r-5" }
    ]
  }
}
```

Exchange `reports` (тип `headers`) и очереди `finance` и `ops` уже есть. Привяжите очереди так, чтобы после публикаций проверки (заголовки → тело: `team=finance, type=report` → `r-1`; `team=finance, type=memo` → `r-2`; `team=ops, type=report` → `r-3`; `team=finance, type=report, level=critical` → `r-4`; `level=info` → `r-5`):

- `finance` получила сообщения с `team=finance` **и** `type=report`: `r-1` и `r-4`;
- `ops` получила сообщения с `team=ops` **или** `level=critical`: `r-3` и `r-4`;
- `r-2` и `r-5` не попали никуда и вернулись издателю (проверка публикует с флагом `mandatory`).

```broker setup
rabbitmqadmin exchanges declare --name reports --type headers --durable true
rabbitmqadmin queues declare --name finance --type classic --durable true
rabbitmqadmin queues declare --name ops --type classic --durable true
```

```broker starter
rabbitmqadmin bindings declare --source reports --destination-type queue --destination finance --routing-key "" --arguments '{"x-match":"…","team":"…"}'
```

```broker solution
rabbitmqadmin bindings declare --source reports --destination-type queue --destination finance --routing-key "" --arguments '{"x-match":"all","team":"finance","type":"report"}'
rabbitmqadmin bindings declare --source reports --destination-type queue --destination ops --routing-key "" --arguments '{"x-match":"any","team":"ops","level":"critical"}'
```

## task rmq-orders-ae

```json
{
  "type": "topology",
  "title": "Запасной exchange для заказов",
  "xp": 15,
  "hints": [
    "Раздел «Alternate exchange»: как задаётся AE.",
    "AE назначают аргументом основного exchange `orders-in`. Запасной exchange `orders-unrouted` — fanout с одной очередью `orders-review`. Привязка fanout использует пустой ключ.",
    "Шаблон: `exchanges declare --name orders-in --type direct --durable true --arguments '{\"alternate-exchange\":\"…\"}'`, затем запасной exchange, две очереди и две привязки."
  ],
  "check": {}
}
```

Заказы поступают в exchange `orders-in`. Те, у которых нет подходящего ключа, нельзя терять. Подготовьте в vhost `/`:

- exchange `orders-in` типа `direct`, durable, с alternate exchange `orders-unrouted`;
- exchange `orders-unrouted` типа `fanout`, durable;
- очереди `orders-new` и `orders-review` типа `classic`, durable;
- привязка `orders-in` → `orders-new` с ключом `new`;
- привязка `orders-unrouted` → `orders-review` с пустым ключом `""`.

```broker starter
rabbitmqadmin exchanges declare --name orders-in --type direct --durable true --arguments '{"alternate-exchange":"…"}'
rabbitmqadmin exchanges declare --name … --type fanout --durable true
rabbitmqadmin queues declare --name … --type classic --durable true
rabbitmqadmin bindings declare --source … --destination-type queue --destination … --routing-key …
```

```broker solution
rabbitmqadmin exchanges declare --name orders-in --type direct --durable true --arguments '{"alternate-exchange":"orders-unrouted"}'
rabbitmqadmin exchanges declare --name orders-unrouted --type fanout --durable true
rabbitmqadmin queues declare --name orders-new --type classic --durable true
rabbitmqadmin queues declare --name orders-review --type classic --durable true
rabbitmqadmin bindings declare --source orders-in --destination-type queue --destination orders-new --routing-key new
rabbitmqadmin bindings declare --source orders-unrouted --destination-type queue --destination orders-review --routing-key ""
```

## task rmq-ae-chain

```json
{
  "type": "routing",
  "title": "Цепочка запасных exchange",
  "xp": 25,
  "hints": [
    "Раздел «Alternate exchange»: цепочка AE и правило «только когда маршрута нет».",
    "Объявите `sales` типа `direct` с AE `fallback-1`: сообщение, не нашедшее ключ в `sales`, пойдёт в `fallback-1`, а если и там нет, то дальше по его AE. Привяжите `sales-q` к `sales` по ключу `sale`.",
    "Шаблон: `exchanges declare --name sales --type direct --durable true --arguments '{\"alternate-exchange\":\"…\"}'` и `bindings declare --source sales --destination-type queue --destination … --routing-key …`."
  ],
  "check": {
    "publish": [
      { "exchange": "sales", "routingKey": "sale", "body": "s-1" },
      { "exchange": "sales", "routingKey": "refund", "body": "s-2" },
      { "exchange": "sales", "routingKey": "gift", "body": "s-3" },
      { "exchange": "sales", "routingKey": "sale", "body": "s-4" }
    ]
  }
}
```

Уже есть цепочка запасных exchange: `fallback-1` (direct, очередь `fb1-q` по ключу `refund`) передаёт необработанное в `fallback-2` (fanout, очередь `catch-all`). Объявите exchange `sales` типа `direct`, durable, с alternate exchange `fallback-1` и привяжите к нему очередь `sales-q` по ключу `sale`. Проверка публикует в `sales` четыре сообщения (ключ → тело: `sale` → `s-1`, `refund` → `s-2`, `gift` → `s-3`, `sale` → `s-4`). Результат: `s-1` и `s-4` в `sales-q`, `s-2` в `fb1-q`, `s-3` в `catch-all`.

```broker setup
rabbitmqadmin exchanges declare --name fallback-2 --type fanout --durable true
rabbitmqadmin exchanges declare --name fallback-1 --type direct --durable true --arguments '{"alternate-exchange":"fallback-2"}'
rabbitmqadmin queues declare --name sales-q --type classic --durable true
rabbitmqadmin queues declare --name fb1-q --type classic --durable true
rabbitmqadmin queues declare --name catch-all --type classic --durable true
rabbitmqadmin bindings declare --source fallback-1 --destination-type queue --destination fb1-q --routing-key refund
rabbitmqadmin bindings declare --source fallback-2 --destination-type queue --destination catch-all --routing-key ""
```

```broker starter
rabbitmqadmin exchanges declare --name sales --type direct --durable true --arguments '{"alternate-exchange":"…"}'
```

```broker solution
rabbitmqadmin exchanges declare --name sales --type direct --durable true --arguments '{"alternate-exchange":"fallback-1"}'
rabbitmqadmin bindings declare --source sales --destination-type queue --destination sales-q --routing-key sale
```

## task rmq-x-header-mode

```json
{
  "type": "choice",
  "title": "Заголовок x-source в привязке",
  "xp": 10,
  "hints": [
    "Раздел «Режим x-match»: какие заголовки игнорируются.",
    "В режиме `any` заголовки на `x-` не участвуют в сравнении. Что останется от привязки?",
    "Останется только `format=png`, а у сообщения `format=pdf`."
  ],
  "options": [
    "Сообщение попадёт в очередь: заголовок `x-source` совпал",
    "Сообщение не попадёт в очередь: в режиме `any` заголовок `x-source` игнорируется, а `format` не совпал",
    "Сообщение попадёт в очередь: в режиме `any` совпадений не требуется",
    "Публикация завершится ошибкой: заголовки `x-` зарезервированы"
  ],
  "answer": [1],
  "explanation": "В режимах `all` и `any` заголовки, имена которых начинаются на `x-`, не участвуют в сравнении. У привязки остаётся одно условие `format=png`, у сообщения `format=pdf`, поэтому совпадения нет, и сообщение уходит дальше без очереди. Если бы режим был `any-with-x`, совпал бы `x-source=scanner` и сообщение попало бы в очередь. Режим `any` требует хотя бы одного совпадения, а не «ни одного». Публикация с заголовком `x-source` допустима: ошибки не будет, просто маршрута нет."
}
```

Привязка `headers`-exchange: `{"x-match":"any","x-source":"scanner","format":"png"}`. Публикуют сообщение с заголовками `x-source=scanner` и `format=pdf`. Что произойдёт?
