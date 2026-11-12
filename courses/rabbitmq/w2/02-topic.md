# Topic: маршрутизация по шаблону

Служба доставки публикует статусы посылок с ключами вида `delivery.moscow.delivered`: слово «доставка», город, статус. SMS-сервису нужны все доставленные посылки любого города, диспетчеру Москвы — всё по Москве, архиву — вообще всё. Для `direct` пришлось бы заводить привязку на каждый город и статус. Exchange типа `topic` решает это шаблонами в ключе привязки.

### Ключ из слов

Ключ маршрутизации в `topic` — набор слов, разделённых точками: `delivery.moscow.delivered`. Длина ключа — не больше 255 байт. Слова нужны только для привязок: сам брокер смысла в них не видит.

В этом уроке ключи всегда состоят из одного и более непустых слов. Пустой ключ в `topic` лаборатория не моделирует, и мы его не используем.

### Шаблоны в привязке

Ключ привязки — шаблон. В нём два специальных слова.

- `*` (звёздочка) заменяет ровно одно слово.
- `#` (решётка) заменяет ноль и более слов.

Остальные слова должны совпасть буква в букву. Шаблон без `*` и `#` работает как `direct`: нужно точное совпадение.

| Шаблон | Ключ | Подходит |
|---|---|---|
| `delivery.*.delivered` | `delivery.kazan.delivered` | да: на месте `*` ровно одно слово |
| `delivery.*.delivered` | `delivery.kazan.delivered.late` | нет: слов больше, чем в шаблоне |
| `delivery.moscow.#` | `delivery.moscow.lost` | да |
| `delivery.moscow.#` | `delivery.moscow` | да: `#` может заменить ноль слов |
| `#` | любой ключ | да |

### Объявление и привязка

```text
rabbitmqadmin exchanges declare --name ИМЯ --type topic --durable true
rabbitmqadmin bindings declare --source ИМЯ --destination-type queue --destination ОЧЕРЕДЬ --routing-key "ШАБЛОН"
```

- `--type topic` — тип exchange, который читает шаблоны.
- `--routing-key "ШАБЛОН"` — шаблон привязки. Берите его в кавычки: в оболочке `#` начинает комментарий, а `*` может быть раскрыта как маска файлов.

Правила доставки те же, что и раньше: сообщение попадает во все очереди, у которых подошёл хотя бы один шаблон. Если у одной очереди подошли сразу несколько привязок, она получает **одну** копию сообщения. Если не подошёл ни один шаблон, сообщение отбрасывается без ошибки.

Пример. Очередь `sms` ловит доставленные посылки любого города, `moscow` — всё по Москве плюс доставленные в любом городе, `everything` — всё.

```broker example
rabbitmqadmin exchanges declare --name tracking --type topic --durable true
rabbitmqadmin queues declare --name sms --type classic --durable true
rabbitmqadmin queues declare --name moscow --type classic --durable true
rabbitmqadmin queues declare --name everything --type classic --durable true
rabbitmqadmin bindings declare --source tracking --destination-type queue --destination sms --routing-key "delivery.*.delivered"
rabbitmqadmin bindings declare --source tracking --destination-type queue --destination moscow --routing-key "delivery.moscow.#"
rabbitmqadmin bindings declare --source tracking --destination-type queue --destination moscow --routing-key "delivery.*.delivered"
rabbitmqadmin bindings declare --source tracking --destination-type queue --destination everything --routing-key "#"
rabbitmqadmin publish message -e tracking -k delivery.moscow.delivered -m "parcel 1"
rabbitmqadmin publish message -e tracking -k delivery.kazan.delivered -m "parcel 2"
rabbitmqadmin publish message -e tracking -k delivery.moscow.lost -m "parcel 3"
rabbitmqadmin publish message -e tracking -k delivery.moscow -m "parcel 4"
rabbitmqadmin publish message -e tracking -k delivery.kazan.delivered.late -m "parcel 5"
rabbitmqadmin get messages --queue sms --count 9
rabbitmqadmin get messages --queue moscow --count 9
rabbitmqadmin get messages --queue everything --count 9
```

Результат чтения (показаны `routing_key` и `payload`):

```text
sms:
  delivery.moscow.delivered   parcel 1
  delivery.kazan.delivered    parcel 2
moscow:
  delivery.moscow.delivered   parcel 1
  delivery.kazan.delivered    parcel 2
  delivery.moscow.lost        parcel 3
  delivery.moscow             parcel 4
everything:
  delivery.moscow.delivered   parcel 1
  delivery.kazan.delivered    parcel 2
  delivery.moscow.lost        parcel 3
  delivery.moscow             parcel 4
  delivery.kazan.delivered.late  parcel 5
```

Разберём по сообщениям.

- `parcel 1` подошло под три шаблона разных очередей. В `moscow` совпали оба шаблона этой очереди, а копия в ней одна.
- `parcel 2`: Казань, `delivery.*.delivered` подходит, `delivery.moscow.#` — нет.
- `parcel 4` с ключом `delivery.moscow` попало в `moscow`: `#` в конце заменило ноль слов.
- `parcel 5` в `sms` не попало: в ключе четыре слова, а в шаблоне `*` заменяет ровно одно. Не попало оно и в `moscow`. Подошёл только `#`.

### Как выбрать шаблон

Идите слева направо по словам ключа и для каждого решайте, что должно совпасть.

- Слово важно и фиксировано — пишите его.
- Слово любое, но оно обязательно есть — `*`.
- Слов может быть сколько угодно, в том числе ни одного, — `#`.

`#` в начале шаблона (`#.failed`) ловит ключи, оканчивающиеся на `failed`, с любым числом слов перед ним и без них. `*.failed` ловит только ключи из двух слов.

### Частые ошибки

- **Ошибка:** ждать, что `delivery.*` поймает `delivery.moscow.lost`. `*` заменяет только одно слово, ключ из трёх слов не подойдёт. **Верно:** `delivery.#`.
- **Ошибка:** написать шаблон без кавычек, `--routing-key #`. Оболочка сочтёт `#` комментарием, и ключа не будет. **Верно:** `--routing-key "#"`.
- **Ошибка:** ждать две копии, если у очереди две подходящие привязки. **Верно:** очередь получает одну копию. Если нужны две копии, нужны две очереди.
- **Ошибка:** использовать пробелы или другие разделители вместо точек (`delivery moscow`). Разделитель слов — точка. **Верно:** `delivery.moscow`.

### Шпаргалка

- `topic`: ключ состоит из слов, разделённых точками; до 255 байт.
- `*` — ровно одно слово; `#` — ноль и более слов; остальные слова совпадают в точности.
- Шаблон без `*` и `#` — точное совпадение, как у `direct`.
- Шаблон берут в кавычки: `--routing-key "delivery.*.delivered"`.
- Очереди с несколькими подошедшими привязками достаётся одна копия.
- Нет подходящего шаблона — сообщение отбрасывается без ошибки.
- Привязка `#` ловит любой ключ.

## task rmq-topic-logs

```json
{
  "type": "routing",
  "title": "Журналы по шаблонам",
  "xp": 15,
  "hints": [
    "Раздел «Шаблоны в привязке»: что заменяют `*` и `#`.",
    "Для каждой очереди выпишите нужные ключи и найдите общее. `errors`: три слова, посередине `error`. `payments-log`: всё, что начинается с `payments`. `archive` нужны два шаблона, и дубли ей не страшны: копия будет одна.",
    "Шаблон: `bindings declare --source logs --destination-type queue --destination … --routing-key \"…\"`. Для `archive` две привязки: одна ловит всё, что начинается с названия сервиса, другая — ключи из трёх слов с `error` посередине."
  ],
  "check": {
    "publish": [
      { "exchange": "logs", "routingKey": "shop.error.db", "body": "l-1" },
      { "exchange": "logs", "routingKey": "shop.info.web", "body": "l-2" },
      { "exchange": "logs", "routingKey": "payments.error.card", "body": "l-3" },
      { "exchange": "logs", "routingKey": "payments.info.card", "body": "l-4" },
      { "exchange": "logs", "routingKey": "shop.error", "body": "l-5" },
      { "exchange": "logs", "routingKey": "shop.error.db.timeout", "body": "l-6" },
      { "exchange": "logs", "routingKey": "audit.login", "body": "l-7" }
    ]
  }
}
```

В topic-exchange `logs` сервисы публикуют записи журнала. Exchange и очереди `errors`, `payments-log`, `archive` уже есть, привязок нет. Сообщения проверки (ключ → тело): `shop.error.db` → `l-1`, `shop.info.web` → `l-2`, `payments.error.card` → `l-3`, `payments.info.card` → `l-4`, `shop.error` → `l-5`, `shop.error.db.timeout` → `l-6`, `audit.login` → `l-7`. Добавьте привязки так, чтобы:

- `errors` получила `l-1` и `l-3`;
- `payments-log` получила `l-3` и `l-4`;
- `archive` получила `l-1`, `l-2`, `l-3`, `l-5` и `l-6`, каждое по одному разу;
- `l-7` не попало ни в одну очередь (проверка публикует с флагом `mandatory` и получит его обратно).

```broker setup
rabbitmqadmin exchanges declare --name logs --type topic --durable true
rabbitmqadmin queues declare --name errors --type classic --durable true
rabbitmqadmin queues declare --name payments-log --type classic --durable true
rabbitmqadmin queues declare --name archive --type classic --durable true
```

```broker starter
rabbitmqadmin bindings declare --source logs --destination-type queue --destination errors --routing-key "…"
```

```broker solution
rabbitmqadmin bindings declare --source logs --destination-type queue --destination errors --routing-key "*.error.*"
rabbitmqadmin bindings declare --source logs --destination-type queue --destination payments-log --routing-key "payments.#"
rabbitmqadmin bindings declare --source logs --destination-type queue --destination archive --routing-key "shop.#"
rabbitmqadmin bindings declare --source logs --destination-type queue --destination archive --routing-key "*.error.*"
```

## task rmq-which-keys

```json
{
  "type": "choice",
  "title": "Какие ключи подойдут шаблону",
  "xp": 10,
  "hints": [
    "Раздел «Шаблоны в привязке»: таблица примеров.",
    "Посчитайте слова в каждом ключе. Шаблон `orders.*.paid` состоит из трёх слов, и среднее — любое одно слово.",
    "Подойдут ключи ровно из трёх слов, у которых первое слово `orders`, а последнее `paid`."
  ],
  "options": [
    "`orders.eu.paid`",
    "`orders.paid`",
    "`orders.eu.west.paid`",
    "`orders.us.paid`"
  ],
  "answer": [0, 3],
  "explanation": "Шаблон `orders.*.paid` требует ровно три слова: `orders`, любое одно слово и `paid`. Под него подходят `orders.eu.paid` и `orders.us.paid`. В `orders.paid` два слова, и на месте `*` нет ни одного. В `orders.eu.west.paid` четыре слова, а `*` заменяет только одно. Для таких ключей нужен шаблон с `#`, например `orders.#.paid`."
}
```

Привязка topic-exchange использует шаблон `orders.*.paid`. Какие из ключей маршрутизации ей соответствуют? Выберите все подходящие.

## task rmq-failed-events

```json
{
  "type": "routing",
  "title": "Сбои с любым числом слов в ключе",
  "xp": 20,
  "hints": [
    "Раздел «Как выбрать шаблон»: `#` в начале шаблона.",
    "Очереди `oncall` нужны ключи, оканчивающиеся на `failed`, с любым числом слов перед ним и вовсе без них. Для `retry-bot` ключи из трёх слов `payment.retry.…`. Существующую привязку трогать не обязательно.",
    "Шаблон: две команды `bindings declare --source incidents --destination-type queue --destination … --routing-key \"…\"`: для `oncall` шаблон со словом `failed` на конце, для `retry-bot` шаблон со словом `retry` посередине."
  ],
  "check": {
    "publish": [
      { "exchange": "incidents", "routingKey": "payment.failed", "body": "i-1" },
      { "exchange": "incidents", "routingKey": "payment.retry.failed", "body": "i-2" },
      { "exchange": "incidents", "routingKey": "failed", "body": "i-3" },
      { "exchange": "incidents", "routingKey": "payment.retry.ok", "body": "i-4" },
      { "exchange": "incidents", "routingKey": "stock.low", "body": "i-5" },
      { "exchange": "incidents", "routingKey": "delivery.late.failed", "body": "i-6" }
    ]
  }
}
```

В topic-exchange `incidents` публикуются инциденты. Очередь `oncall` привязана по шаблону `*.failed`, поэтому дежурный видит не все сбои. Привяжите очереди так, чтобы после публикаций проверки (ключ → тело: `payment.failed` → `i-1`, `payment.retry.failed` → `i-2`, `failed` → `i-3`, `payment.retry.ok` → `i-4`, `stock.low` → `i-5`, `delivery.late.failed` → `i-6`):

- `oncall` получила `i-1`, `i-2`, `i-3` и `i-6`;
- `retry-bot` получила `i-2` и `i-4`;
- `i-5` не попало никуда и вернулось издателю.

```broker setup
rabbitmqadmin exchanges declare --name incidents --type topic --durable true
rabbitmqadmin queues declare --name oncall --type classic --durable true
rabbitmqadmin queues declare --name retry-bot --type classic --durable true
rabbitmqadmin bindings declare --source incidents --destination-type queue --destination oncall --routing-key "*.failed"
```

```broker starter
rabbitmqadmin bindings declare --source incidents --destination-type queue --destination oncall --routing-key "…"
```

```broker solution
rabbitmqadmin bindings declare --source incidents --destination-type queue --destination oncall --routing-key "#.failed"
rabbitmqadmin bindings declare --source incidents --destination-type queue --destination retry-bot --routing-key "payment.retry.*"
```

## task rmq-one-copy

```json
{
  "type": "choice",
  "title": "Две привязки одной очереди",
  "xp": 10,
  "hints": [
    "Раздел «Объявление и привязка»: что происходит, когда подходят несколько привязок одной очереди.",
    "Проверьте каждый шаблон на ключе `parcel.moscow.lost`, затем посмотрите, сколько разных очередей получилось.",
    "Подходят оба шаблона, но обе привязки ведут в одну очередь."
  ],
  "options": [
    "Две копии в `alerts`: каждая привязка доставляет своё",
    "Одна копия в `alerts`",
    "Одна копия в `alerts` и одна в служебной очереди совпадений",
    "Ни одной: две подходящие привязки одной очереди конфликтуют"
  ],
  "answer": [1],
  "explanation": "Шаблоны `parcel.#` и `*.moscow.lost` оба подходят к ключу `parcel.moscow.lost`, но привязаны к одной очереди, и в `topic` она получает одну копию сообщения. Две копии пришли бы, только если бы привязки вели в разные очереди. Служебных очередей совпадений в RabbitMQ нет. Конфликта между привязками нет: они просто добавляют правила доставки."
}
```

Очередь `alerts` привязана к topic-exchange двумя шаблонами: `parcel.#` и `*.moscow.lost`. В exchange публикуют одно сообщение с ключом `parcel.moscow.lost`. Сколько копий получит очередь `alerts`?
