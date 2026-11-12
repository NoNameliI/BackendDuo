# Приоритеты и work queues

Служба поддержки получает обращения двух сортов: плановые отчёты и срочные аварийные уведомления. Если все они стоят в одной очереди по порядку поступления, срочное уведомление ждёт, пока разберут все отчёты перед ним. Хочется, чтобы срочное шло первым. Это решают приоритеты сообщений. А чтобы очередь разбирало несколько работников сразу, используют схему work queue.

### Work queue: несколько потребителей одной очереди

Work queue (очередь задач) — это обычная очередь, к которой подключено несколько потребителей. Каждое сообщение получает только один из них, поэтому работа делится.

- Брокер раздаёт сообщения по кругу среди потребителей, у которых есть свободное окно prefetch (напоминание из урока про prefetch: сколько неподтверждённых сообщений потребитель может держать).
- Если потребитель медленный, а `prefetch` не ограничен (`0`), брокер раздаст ему столько же, сколько быстрому, и сообщения застрянут у медленного. Поэтому для задач разной длины ставят малый `prefetch`, часто `1`.
- Если работник упал, неподтверждённые сообщения вернутся в очередь (урок про `ack`) и достанутся другим.

Две возможности настоящего RabbitMQ песочница не выполняет, их можно только разобрать:

- приоритет самого потребителя: пока активен потребитель с более высоким приоритетом, сообщения получает он, при равных — по кругу;
- single active consumer: из всех подписчиков работает один, остальные ждут на случай его отказа; включается только при объявлении очереди.

### Приоритет сообщения

```text
rabbitmqadmin queues declare --name ОЧЕРЕДЬ --type classic --durable true --arguments '{"x-max-priority": N}'
rabbitmqadmin publish message --routing-key ОЧЕРЕДЬ --payload "ТЕКСТ" --properties '{"priority": P}'
```

- `x-max-priority` — наибольший приоритет, который очередь различает. Целое от 1 до 255. Задаётся только при объявлении и потом не меняется. Документация советует несколько уровней, 2–4: каждый уровень стоит ресурсов.
- `priority` — свойство сообщения, целое число. Больше число — раньше доставка.
- Приоритет выше `x-max-priority` приравнивается к максимуму. Сообщение без приоритета считается имеющим приоритет `0`.
- Если у очереди нет `x-max-priority`, приоритеты она игнорирует: порядок остаётся по времени поступления.
- Среди сообщений одного приоритета порядок сохраняется: кто раньше пришёл, тот раньше выдан.

Приоритет виден только тогда, когда в очереди есть накопленные сообщения: пустую очередь упорядочивать нечем. И он не обгоняет уже выданное: сообщения, которые брокер отдал потребителю, из его окна не забрать.

```broker example
rabbitmqadmin queues declare --name builds --type classic --durable true --arguments '{"x-max-priority": 3}'
rabbitmqadmin publish message --routing-key builds --payload "nightly" --properties '{"priority": 1}'
rabbitmqadmin publish message --routing-key builds --payload "hotfix" --properties '{"priority": 3}'
rabbitmqadmin publish message --routing-key builds --payload "docs"
rabbitmqadmin publish message --routing-key builds --payload "release" --properties '{"priority": 9}'
rabbitmqadmin publish message --routing-key builds --payload "lint" --properties '{"priority": 1}'
rabbitmqadmin get messages --queue builds --count 5
```

Результат:

```text
declared queue 'builds' in virtual host '/'
published the message
published the message
published the message
published the message
published the message
┌──────────┬─────────────┬─────────────┬───────────────┬─────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload │
├──────────┼─────────────┼─────────────┼───────────────┼─────────┤
│          │ builds      │ false       │ 6             │ hotfix  │
│          │ builds      │ false       │ 7             │ release │
│          │ builds      │ false       │ 7             │ nightly │
│          │ builds      │ false       │ 4             │ lint    │
│          │ builds      │ false       │ 4             │ docs    │
└──────────┴─────────────┴─────────────┴───────────────┴─────────┘
```

`hotfix` (3) и `release` (9, поднят до максимума 3) идут первыми, причём в порядке поступления. Затем `nightly` и `lint` с приоритетом 1, затем `docs` без приоритета. Та же пара сообщений в очереди без `x-max-priority`:

```broker example
rabbitmqadmin queues declare --name plain --type classic --durable true
rabbitmqadmin publish message --routing-key plain --payload "low" --properties '{"priority": 1}'
rabbitmqadmin publish message --routing-key plain --payload "high" --properties '{"priority": 9}'
rabbitmqadmin get messages --queue plain --count 2
```

```text
declared queue 'plain' in virtual host '/'
published the message
published the message
┌──────────┬─────────────┬─────────────┬───────────────┬─────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload │
├──────────┼─────────────┼─────────────┼───────────────┼─────────┤
│          │ plain       │ false       │ 3             │ low     │
│          │ plain       │ false       │ 4             │ high    │
└──────────┴─────────────┴─────────────┴───────────────┴─────────┘
```

Очередь приоритеты проигнорировала.

### Приоритет и prefetch

Брокер выбирает самое приоритетное сообщение в тот момент, когда выдаёт его потребителю. Если `prefetch` не ограничен, потребитель с первой секунды получает всё, что накопилось, и новое срочное сообщение окажется позади уже выданных. Чтобы приоритет работал, окно потребителя держат маленьким (`prefetch` 1) и подтверждают вручную.

### Приоритеты в quorum-очередях

У quorum-очередей (в версиях с 4.3) приоритеты другие и действуют сами, без `x-max-priority`: допустимы значения от 0 до 31, а сообщение без приоритета получает 4. Параметр `x-max-priority` у quorum-очередей игнорируется. Подробнее о quorum-очередях — в уроке 4.4.

```broker example
rabbitmqadmin queues declare --name audit --type quorum --durable true
rabbitmqadmin publish message --routing-key audit --payload "a-none"
rabbitmqadmin publish message --routing-key audit --payload "a-high" --properties '{"priority": 20}'
rabbitmqadmin publish message --routing-key audit --payload "a-low" --properties '{"priority": 1}'
rabbitmqadmin get messages --queue audit --count 3
```

```text
declared queue 'audit' in virtual host '/'
published the message
published the message
published the message
┌──────────┬─────────────┬─────────────┬───────────────┬─────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload │
├──────────┼─────────────┼─────────────┼───────────────┼─────────┤
│          │ audit       │ false       │ 6             │ a-high  │
│          │ audit       │ false       │ 6             │ a-none  │
│          │ audit       │ false       │ 5             │ a-low   │
└──────────┴─────────────┴─────────────┴───────────────┴─────────┘
```

Сообщение без приоритета (4) обогнало `a-low` (1), но уступило `a-high` (20).

### Частые ошибки

- **Ошибка:** публиковать с `priority`, не объявив `x-max-priority`. Очередь игнорирует приоритеты. **Верно:** объявить очередь с `x-max-priority` (2–4 уровней обычно хватает), изменить его потом нельзя.
- **Ошибка:** поставить `x-max-priority` 1 и ждать двух уровней. Приоритеты выше 1 станут единицей и сравняются. **Верно:** максимум не меньше числа уровней, которые вам нужны.
- **Ошибка:** потребитель с `prefetch` 0 или большим. Срочное сообщение ждёт позади уже выданных. **Верно:** малый `prefetch` и ручное подтверждение.
- **Ошибка:** путать приоритет сообщения с приоритетом потребителя. **Верно:** первый упорядочивает очередь, второй выбирает, кому из потребителей отдавать (в песочнице второе не выполняется).

### Шпаргалка

- Work queue: много потребителей одной очереди, сообщение достаётся одному; раздача по кругу среди тех, у кого есть окно.
- `x-max-priority` (1–255, при объявлении) и свойство `priority`. Выше максимума — максимум, нет приоритета — 0, нет аргумента — приоритеты игнорируются.
- Одинаковый приоритет — порядок поступления. Уже выданное не обгоняется: нужен малый `prefetch`.
- Quorum: приоритеты 0–31, по умолчанию 4, `x-max-priority` игнорируется.

## task rmq-priority-pick

```json
{
  "type": "console",
  "title": "Забрать самые срочные задачи",
  "xp": 15,
  "hints": [
    "Раздел «Приоритет сообщения».",
    "Очередь нужно объявить с `x-max-priority` не меньше 3. Приоритет задаёт свойство `priority` в `--properties`. После публикации заберите две самые срочные командой `get messages --count 2`.",
    "Шаблон: `rabbitmqadmin queues declare --name deploys --type classic --durable true --arguments '{\"x-max-priority\": …}'`, четыре `publish message … --properties '{\"priority\": …}'`, затем `get messages --queue … --count …`."
  ],
  "check": {
    "compare": ["queues", "messages"],
    "require": [{ "pattern": "get messages", "message": "Заберите задачи командой get messages" }]
  }
}
```

Объявите классическую durable-очередь `deploys` с тремя уровнями приоритета (`x-max-priority` 3) и положите в неё по порядку четыре задачи: `backup` с приоритетом 1, `security-patch` с приоритетом 3, `cleanup` без приоритета и `rollback` с приоритетом 2. Затем заберите две самые срочные задачи командой `get`, чтобы они исчезли из очереди. В очереди должны остаться `backup` и `cleanup`.

```broker starter
rabbitmqadmin queues declare --name deploys --type classic --durable true --arguments '{"x-max-priority": …}'
rabbitmqadmin publish message --routing-key deploys --payload "backup" --properties '{"priority": 1}'
```

```broker solution
rabbitmqadmin queues declare --name deploys --type classic --durable true --arguments '{"x-max-priority": 3}'
rabbitmqadmin publish message --routing-key deploys --payload "backup" --properties '{"priority": 1}'
rabbitmqadmin publish message --routing-key deploys --payload "security-patch" --properties '{"priority": 3}'
rabbitmqadmin publish message --routing-key deploys --payload "cleanup"
rabbitmqadmin publish message --routing-key deploys --payload "rollback" --properties '{"priority": 2}'
rabbitmqadmin get messages --queue deploys --count 2
```

## task rmq-alarm-priority

```json
{
  "type": "scenario",
  "title": "Аварийные уведомления застревают за отчётами",
  "xp": 25,
  "scenario": "w4-priority-alarms",
  "hints": [
    "Разделы «Приоритет сообщения» и «Приоритет и prefetch».",
    "Очередь `support` ещё не объявлена. Уведомления публикуются с приоритетом 9, отчёты с приоритетом 1. Очередь должна различать оба уровня: проверьте, чему равен `x-max-priority`.",
    "Шаблон: `rabbitmqadmin queues declare --name support --type classic --durable true --arguments '{\"x-max-priority\": …}'`. Число должно быть не меньше 2."
  ],
  "check": {}
}
```

Издатель `reports` кладёт в очередь `support` десять отчётов (`report 1` … `report 10`) с приоритетом 1, по сто в секунду. Издатель `alarms` публикует два аварийных уведомления (`alarm 1` и `alarm 2`) с приоритетом 9. Уведомление живёт 300 мс (свойство `expiration`), потом оно никому не нужно. Агент `agent` обрабатывает сообщение 100 мс, подтверждает вручную, `prefetch` у него 1.

Очередь объявлена без приоритетов, и второе уведомление ждёт позади отчётов: срок выходит, уведомление пропадает. Объявите `support` так, чтобы ни одно сообщение не потерялось и `agent` обработал все двенадцать к 3000-й миллисекунде.

```broker starter
rabbitmqadmin queues declare --name support --type classic --durable true --arguments '{"x-max-priority": 1}'
```

```broker solution
rabbitmqadmin queues declare --name support --type classic --durable true --arguments '{"x-max-priority": 5}'
```

## task rmq-priority-clamp

```json
{
  "type": "choice",
  "title": "Порядок выдачи при x-max-priority 5",
  "xp": 10,
  "hints": [
    "Раздел «Приоритет сообщения»: что происходит с приоритетом выше максимума и с отсутствующим приоритетом.",
    "Сначала приведите приоритеты к допустимым: 12 при максимуме 5 станет 5, отсутствие приоритета — 0. Потом упорядочите.",
    "Приоритеты после приведения: A — 5, B — 4, C — 0, D — 5. Среди равных идёт тот, кто пришёл раньше."
  ],
  "options": [
    "A, D, B, C",
    "D, A, B, C",
    "B, A, D, C",
    "A, B, C, D"
  ],
  "answer": [0],
  "explanation": "Приоритеты приводятся к допустимым: A (12) становится 5, D (5) остаётся 5, B — 4, C без приоритета получает 0. Старшие A и D равны, поэтому идут в порядке поступления: A, затем D. Потом B (4) и C (0). Вариант «D, A, B, C» забывает про порядок среди равных. Вариант «B, A, D, C» ставит A ниже B, будто приоритет выше максимума не засчитывается. Вариант «A, B, C, D» — это порядок поступления, как будто очередь игнорирует приоритеты."
}
```

Очередь `jobs` объявлена с `x-max-priority` 5. В неё по порядку опубликованы четыре сообщения: A с приоритетом 12, B с приоритетом 4, C без приоритета, D с приоритетом 5. Потребителей пока нет, потом все сообщения забирают по одному. В каком порядке они выдаются?

## task rmq-priority-prefetch

```json
{
  "type": "choice",
  "title": "Почему приоритет не помогает",
  "xp": 15,
  "hints": [
    "Раздел «Приоритет и prefetch».",
    "Вспомните, когда брокер выбирает сообщение: в момент выдачи потребителю. Сколько сообщений уже выдано при `prefetch` 500?",
    "При большом окне накопленные сообщения уходят потребителю сразу, и новому срочному сообщению в очереди уже нечего обгонять."
  ],
  "options": [
    "Брокер игнорирует `priority` у quorum-очередей",
    "Потребитель с `prefetch` 500 получил почти все накопленные сообщения заранее, новое срочное встало позади них у него в окне",
    "`x-max-priority` 3 слишком мало для двух уровней",
    "Приоритеты работают только при `auto_ack`"
  ],
  "answer": [1],
  "explanation": "Приоритет упорядочивает сообщения, пока они лежат в очереди. Выданные потребителю сообщения остаются у него и не обгоняются. При `prefetch` 500 за короткое время почти вся очередь оказывается в окне потребителя, а срочное сообщение обрабатывается после неё. Лечится малым `prefetch` и ручным подтверждением. Вариант про quorum не подходит: очередь классическая, а в quorum-очередях приоритеты есть (0–31). Вариант про `x-max-priority` 3 неверен: двух уровней он хватает. Вариант про `auto_ack` неверен: приоритеты не зависят от режима подтверждения."
}
```

Очередь `orders` объявлена с `x-max-priority` 3, срочные заказы публикуются с приоритетом 3, обычные — с 1. Единственный потребитель подключён с `prefetch` 500, и срочные заказы всё равно ждут своей очереди вместе с обычными. В чём причина?
