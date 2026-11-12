# Compaction и tombstone

Сервис клиентов хранит профиль каждого клиента: имя, тариф, адрес. Каждое изменение уходит в Kafka событием «у клиента `c-17` теперь тариф pro». Новому сервису-кэшу нужно не всё прошлое, а только текущее состояние каждого клиента. Хранить для этого все версии незачем, а срок хранения, как в уроке 4.1, подошёл бы плохо: клиент, не менявший профиль год, не должен пропасть. Для этого у Kafka есть вторая политика очистки: compaction.

### Политика compact

Политика очистки задаётся параметром топика `cleanup.policy`. Значения:

- `delete` — по умолчанию, удаление по времени и размеру (урок 4.1);
- `compact` — оставлять для каждого ключа как минимум последнюю запись;
- `delete,compact` — обе политики сразу: и уплотнение, и удаление по сроку;
- пустое значение — не очищать совсем (с версии 4.2).

```text
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic ТОПИК --config cleanup.policy=compact
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name ТОПИК --alter --add-config cleanup.policy=delete
```

Что гарантирует compaction:

- Для каждого ключа в логе остаётся как минимум последняя запись. Предыдущие значения ключа очиститель со временем убирает. Слово «как минимум» важно: пока очиститель не прошёл, старые значения ещё читаются.
- Offset не меняются. Если убрали записи с offset 0 и 1, то оставшаяся запись по-прежнему имеет offset 2, а в нумерации появляются «дыры». Порядок оставшихся записей сохраняется.
- Ключ обязателен. Запись без ключа (`key = null`) в compacted-топик не принимается: песочница отвечает `INVALID_RECORD`.
- Уплотнение работает внутри партиции. Записи одного клиента должны попадать в одну партицию, то есть нужен стабильный ключ (урок 2.1).

Пример ошибки: запись без ключа в топик с `cleanup.policy=compact`.

```text
$ kafka-console-producer.sh --bootstrap-server localhost:9092 --topic profiles <<EOF
nokey
EOF
Error: record not sent to profiles: INVALID_RECORD: Compacted topic cannot accept message without key.
```

Когда очиститель берётся за работу:

- Чистятся только закрытые сегменты (урок 4.1). Активный сегмент не уплотняется, даже если все его записи старые.
- `min.cleanable.dirty.ratio` (по умолчанию 0.5) — доля ещё не очищенной («грязной») части лога. Пока она меньше порога, очиститель ждёт.
- `max.compaction.lag.ms` (по умолчанию без предела): запись старше этого срока чистится независимо от доли.
- `min.compaction.lag.ms` (по умолчанию 0): запись моложе этого срока очиститель не трогает.
- Настоящий очиститель — отдельный поток брокера. В песочнице он просыпается раз в 15 секунд виртуального времени; тайминг упрощён.

### Tombstone: как удалить ключ

Как удалить клиента из compacted-топика? Записать его ключ с пустым значением (`null`). Такая запись называется tombstone («надгробие»). Очиститель убирает все прежние записи ключа, а само надгробие хранит ещё `delete.retention.ms` (по умолчанию 86400000, сутки) и потом удаляет. Потребитель, который читает топик с начала, должен успеть дойти до надгробия за это время: иначе он увидит старое значение и не узнает, что ключ удалён.

Консольный продюсер превращает строку в `null`, если задать маркер:

```text
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic ТОПИК --reader-property parse.key=true --reader-property key.separator=: --reader-property null.marker=МАРКЕР
КЛЮЧ:МАРКЕР
```

- `parse.key=true` и `key.separator=:` разбирают строку на ключ и значение (урок 1.1).
- `null.marker=МАРКЕР` — если значение равно маркеру (например, `NULL`), запись получает пустое значение. Строка `u2:NULL` записывает tombstone для ключа `u2`.
- Потребитель печатает пустое значение словом `null`, а ключ показывает при `--formatter-property print.key=true`.

Пример. Топик `profiles` с быстрой уборкой: сегмент закрывается за секунду (`segment.ms=1000`), порог `min.cleanable.dirty.ratio=0.01`, надгробие живёт 20 секунд (`delete.retention.ms=20000`). Значения подобраны, чтобы на малых данных всё сработало быстро.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic profiles --partitions 1 --replication-factor 1 --config cleanup.policy=compact --config segment.ms=1000 --config min.cleanable.dirty.ratio=0.01 --config delete.retention.ms=20000
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic profiles --reader-property parse.key=true --reader-property key.separator=: --reader-property null.marker=NULL <<EOF
u1:Anna
u2:Boris
u1:Anna K.
EOF
sim run 2s
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic profiles --reader-property parse.key=true --reader-property key.separator=: --reader-property null.marker=NULL <<EOF
u2:NULL
u3:Vera
EOF
sim run 2s
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic profiles --reader-property parse.key=true --reader-property key.separator=: --reader-property null.marker=NULL <<EOF
u3:Vera S.
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic profiles --from-beginning --max-messages 10 --formatter-property print.offset=true --formatter-property print.key=true
sim run 20s
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic profiles --from-beginning --max-messages 10 --formatter-property print.offset=true --formatter-property print.key=true
sim run 30s
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic profiles --from-beginning --max-messages 10 --formatter-property print.offset=true --formatter-property print.key=true
```

```text
Created topic profiles.
[sim] прошло 2000 мс виртуального времени
[sim] прошло 2000 мс виртуального времени
Offset:0	u1	Anna
Offset:1	u2	Boris
Offset:2	u1	Anna K.
Offset:3	u2	null
Offset:4	u3	Vera
Offset:5	u3	Vera S.
(песочница: новых сообщений нет)
Processed a total of 6 messages
[sim] прошло 20000 мс виртуального времени
Offset:2	u1	Anna K.
Offset:3	u2	null
Offset:4	u3	Vera
Offset:5	u3	Vera S.
(песочница: новых сообщений нет)
Processed a total of 4 messages
[sim] прошло 30000 мс виртуального времени
Offset:2	u1	Anna K.
Offset:4	u3	Vera
Offset:5	u3	Vera S.
(песочница: новых сообщений нет)
Processed a total of 3 messages
```

Разберём три чтения.

- Сразу после записи очиститель ещё не работал: видны все шесть записей, включая надгробие `u2 null` (offset 3).
- Через 20 секунд очиститель прошёл по закрытым сегментам. Старые `Anna` (offset 0) и `Boris` (offset 1) убраны: у ключей `u1` и `u2` есть более новые записи. Offset остальных записей прежние, в нумерации «дыра». Надгробие `u2` осталось: оно хранится `delete.retention.ms`.
- Через ещё 30 секунд срок надгробия истёк, и оно удалено вместе со всем следом ключа `u2`.
- `Vera` (offset 4) осталась рядом с `Vera S.` (offset 5): `Vera S.` лежит в активном сегменте, а он не уплотняется, поэтому старое значение не заменено. Позже, когда сегмент закроется и очиститель пройдёт снова, `Vera` уйдёт.

### Когда нужен compact, а когда нет

- Подходит для состояния: профили, настройки, остатки на складе, таблицы-справочники, журнал изменений базы (changelog). Важно последнее значение ключа, а не вся история.
- Не подходит для событий, где важна каждая запись: платёж, клик, строка аудита. Они не имеют «последнего значения», и ключа у них часто нет. Для таких топиков нужна политика `delete` (урок 4.1).
- Соединить обе возможности можно значением `delete,compact`: уплотнять и при этом удалять данные старше срока.

### Частые ошибки

- **Ошибка:** включить `cleanup.policy=compact` для потока платежей без ключа. **Верно:** для событий оставить `delete`; compact использовать там, где у записей есть ключ и важно последнее значение. Иначе продюсер получит `INVALID_RECORD`, а записи будут потеряны.
- **Ошибка:** считать, что после compaction в топике один экземпляр каждого ключа и offset идут подряд. **Верно:** остаётся как минимум последнее значение, в активном сегменте возможны повторы, а в нумерации offset есть пропуски.
- **Ошибка:** для удаления клиента записать пустую строку или значение `"deleted"`. **Верно:** tombstone — запись с ключом и значением `null` (`null.marker` в консоли); другое значение обычная запись и остаётся в логе.
- **Ошибка:** читать compacted-топик редким отчётом раз в неделю и рассчитывать, что надгробие ещё там. **Верно:** читать чаще, чем `delete.retention.ms`, или учитывать, что удаление ключа можно пропустить.

### Шпаргалка

- `cleanup.policy`: `delete` (по умолчанию), `compact`, `delete,compact`, пустое — не чистить.
- compact: как минимум последняя запись каждого ключа; offset и порядок остаются; ключ обязателен (`INVALID_RECORD` без него).
- Чистятся только закрытые сегменты; порог — `min.cleanable.dirty.ratio` (0.5); защита свежего — `min.compaction.lag.ms`, принудительный срок — `max.compaction.lag.ms`.
- Tombstone = ключ + `null`; хранится `delete.retention.ms` (сутки), потом удаляется.
- Консоль: `--reader-property parse.key=true --reader-property key.separator=: --reader-property null.marker=NULL`, строка `ключ:NULL`; чтение `--formatter-property print.key=true`.

## task kfk-compaction-tombstone

```json
{
  "type": "console",
  "title": "Закрытый счёт: tombstone",
  "xp": 15,
  "hints": [
    "Раздел «Tombstone: как удалить ключ»: надгробие — это запись с ключом и пустым значением.",
    "Используйте консольный продюсер с `parse.key=true`, `key.separator=:` и `null.marker=NULL`, а в строке напишите `ключ:NULL`.",
    "Шаблон: `kafka-console-producer.sh --bootstrap-server localhost:9092 --topic accounts --reader-property parse.key=true --reader-property key.separator=: --reader-property null.marker=NULL <<EOF`, строка `…:NULL`, потом `EOF`."
  ],
  "check": {
    "compare": ["messages"],
    "require": [
      { "pattern": "null\\.marker", "message": "Укажите --reader-property null.marker=…, чтобы значение стало пустым" }
    ]
  }
}
```

В compacted-топике `accounts` лежат записи о счетах: `a1:open`, `a2:open`, `a1:frozen`. Клиент закрыл счёт `a2`. Запишите в топик tombstone для ключа `a2`, чтобы позже очиститель убрал этот счёт. Другие записи не нужны.

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic accounts --partitions 1 --replication-factor 1 --config cleanup.policy=compact
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic accounts --reader-property parse.key=true --reader-property key.separator=: <<EOF
a1:open
a2:open
a1:frozen
EOF
```

```broker starter
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic accounts --reader-property parse.key=true --reader-property key.separator=: --reader-property null.marker=… <<EOF
…:…
EOF
```

```broker solution
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic accounts --reader-property parse.key=true --reader-property key.separator=: --reader-property null.marker=NULL <<EOF
a2:NULL
EOF
```

## task kfk-compaction-routing

```json
{
  "type": "routing",
  "title": "Профили клиентов и запись без ключа",
  "xp": 15,
  "hints": [
    "Раздел «Политика compact»: что делает топик с записью без ключа.",
    "Топик создаётся с одной партицией и `--config cleanup.policy=compact`. Запись без ключа compacted-топик отклонит, и в партицию попадут только записи с ключом.",
    "Шаблон: `kafka-topics.sh --bootstrap-server localhost:9092 --create --topic customer-profiles --partitions … --replication-factor … --config cleanup.policy=…`."
  ],
  "check": {
    "publish": [
      { "topic": "customer-profiles", "key": "c-17", "value": "plan=basic" },
      { "topic": "customer-profiles", "key": "c-17", "value": "plan=pro" },
      { "topic": "customer-profiles", "value": "plan=unknown" },
      { "topic": "customer-profiles", "key": "c-18", "value": "plan=basic" }
    ]
  }
}
```

Создайте топик `customer-profiles` для хранения текущего профиля клиента: 1 партиция, фактор репликации 3, политика очистки `compact`. Затем в него будут записаны четыре сообщения: два обновления клиента `c-17`, запись без ключа (источник сбойнул и забыл ключ) и профиль клиента `c-18`. В правильном топике запись без ключа не должна попасть в журнал.

```broker starter
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic customer-profiles --partitions … --replication-factor … --config cleanup.policy=…
```

```broker solution
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic customer-profiles --partitions 1 --replication-factor 3 --config cleanup.policy=compact
```

## task kfk-compaction-left

```json
{
  "type": "choice",
  "title": "Что останется после чистки",
  "xp": 10,
  "hints": [
    "Разбор примера в разделе «Tombstone: как удалить ключ»: активный сегмент не уплотняется.",
    "Сначала решите для закрытых сегментов: для каждого ключа остаётся последняя запись, надгробие после `delete.retention.ms` уходит. Потом добавьте активный сегмент целиком.",
    "Закрытые сегменты дают offset 2 (последний `a`), 4 (последний `c`); `b` удалён вместе с надгробием."
  ],
  "options": [
    "5 и 6: по последней записи каждого ключа во всём логе",
    "2, 4, 5 и 6: закрытая часть оставила последние `a` и `c`, активный сегмент остался нетронутым, `b` исчез",
    "2, 3, 4, 5 и 6: надгробие `b` остаётся навсегда, пока на него есть ссылка",
    "0, 1, 2, 3, 4, 5 и 6: уплотнение ничего не удаляет, пока нет сроков retention"
  ],
  "answer": [1],
  "explanation": "Закрытые сегменты содержат offset 0–4: `a:1`, `b:1`, `a:2`, `b:null`, `c:1`. Очиститель оставляет в них последнюю запись ключа: `a:2` (offset 2) и `c:1` (offset 4). Для ключа `b` последняя запись — надгробие (offset 3); спустя `delete.retention.ms` оно удалено вместе с `b:1`. Активный сегмент (offset 5 и 6: `a:3`, `c:2`) не уплотняется, его записи остаются. Ответ «5 и 6» забывает про активный сегмент и про то, что очиститель смотрит только на закрытую часть. Ответ «2, 3, 4, 5, 6» верен только до истечения `delete.retention.ms`, а в условии этот срок уже прошёл. Ответ «ничего не удаляется» неверен: уплотнение не зависит от retention."
}
```

В compacted-топике (одна партиция) по порядку лежат записи `ключ:значение`: offset 0 — `a:1`, 1 — `b:1`, 2 — `a:2`, 3 — `b:null` (надгробие), 4 — `c:1`. Сегмент с этими пятью записями закрыт. Offset 5 и 6 (`a:3`, `c:2`) лежат в активном сегменте. Очиститель прошёл по закрытой части несколько раз, а с первой встречи надгробия прошло больше `delete.retention.ms`. Какие offset остались в логе?

## task kfk-compaction-events

```json
{
  "type": "scenario",
  "title": "Платежи пропадают при записи",
  "xp": 25,
  "scenario": "w4-compact-events",
  "hints": [
    "Раздел «Когда нужен compact, а когда нет» и ошибка `INVALID_RECORD`.",
    "Платежи — события без ключа, а топик создан с `cleanup.policy=compact`. Политику готового топика нужно заменить на ту, которая не требует ключа.",
    "Шаблон: `kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name payments --alter --add-config cleanup.policy=…`."
  ],
  "check": {}
}
```

Сервис `checkout` отправляет в топик `payments` двадцать платежей (`payment 1` … `payment 20`) без ключа, пять в секунду. Потребитель `ledger` записывает их в книгу. Все двадцать платежей теряются: в журнале у каждого ошибка `INVALID_RECORD`, `ledger` не получает ничего. Топик создан с `cleanup.policy=compact`.

Исправьте настройку топика командой так, чтобы ни один платёж не пропал и `ledger` обработал все двадцать к 10000-й миллисекунде. Продюсера и потребителя не меняйте.

```broker starter
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name payments --alter --add-config cleanup.policy=…
```

```broker solution
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name payments --alter --add-config cleanup.policy=delete
```
