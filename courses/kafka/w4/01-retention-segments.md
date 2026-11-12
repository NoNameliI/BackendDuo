# Retention и сегменты

Платёжный сервис пишет в Kafka журнал аудита: кто и когда менял счёт. Записей много, диск конечный, а хранить всё вечно не нужно: аудиторам хватает месяца. Kafka сама удаляет старые данные, но делает это не по одной записи, а целыми кусками, которые называются сегментами. Чтобы настроить хранение и не удивляться тому, что «устаревшие» записи ещё читаются, нужно понимать, как устроены сегменты и когда они удаляются.

### Лог из сегментов

Партиция топика (урок 1.2) — это лог. На диске он разбит на файлы-сегменты. Имя сегмента — offset его первой записи (`base offset`), поэтому сегменты идут по порядку offset: `00000000000000000000.log`, потом, например, `00000000000000012345.log`.

- Новые записи всегда попадают в последний сегмент. Он называется активным.
- Когда активный сегмент закрывается, начинается новый. Закрытый сегмент больше не меняется.
- Закрывают сегмент два параметра топика: `segment.bytes` (по умолчанию 1 GiB) и `segment.ms` (по умолчанию 7 суток). Срабатывает тот, что наступил раньше.
- У `segment.bytes` есть нижняя граница: 1 MiB. Меньше задать нельзя. Песочница ведёт себя так же, поэтому в примерах сегменты закрываются по времени, через `segment.ms`.

Попытка задать маленький сегмент:

```text
$ kafka-topics.sh --bootstrap-server localhost:9092 --create --topic tiny --config segment.bytes=1000
Error: Invalid value 1000 for configuration segment.bytes: Value must be at least 1048576
```

Команда завершается ошибкой, поэтому это обычный блок с выводом, а не запускаемый пример.

### Правила удаления

Политика очистки топика называется `cleanup.policy`. По умолчанию это `delete`: старые данные удаляются. Другие значения разберём в уроке 4.2.

Удаление регулируют два параметра. Любого достаточно, чтобы сегмент был признан устаревшим.

```text
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic ТОПИК --config retention.ms=МИЛЛИСЕКУНДЫ --config segment.ms=МИЛЛИСЕКУНДЫ
```

- `retention.ms` — сколько времени хранить данные, в миллисекундах. По умолчанию 604800000 (7 суток). Значение `-1` — хранить без ограничения по времени.
- `retention.bytes` — сколько байт хранить в каждой партиции (не во всём топике). По умолчанию `-1`, то есть размер не ограничен.
- `--config` можно повторять: каждый параметр — отдельный флаг `--config имя=значение`.

Как Kafka решает, что удалять:

- Удаляются только закрытые сегменты, начиная с самых старых. Активный сегмент не удаляется никогда.
- По времени: сегмент удаляется, когда самая поздняя метка времени среди его записей старше `retention.ms`. Возраст считается не по первой записи, а по последней.
- По размеру: пока размер партиции превышает `retention.bytes`, удаляется самый старый сегмент, но только если превышение покрывает его целиком. Пример: сегменты по 1 GiB, всего в партиции 5,5 GiB, `retention.bytes` равен 5 GiB. Превышение 0,5 GiB меньше сегмента, поэтому не удаляется ничего.
- После удаления начало лога сдвигается. Offset первой доступной записи называется `log start offset`. Сами offset остальных записей не меняются.
- Проверка идёт периодически. В песочнице — каждые 5 секунд виртуального времени. В настоящем брокере интервал другой, поэтому удаление не происходит мгновенно в момент истечения срока.

Время в песочнице виртуальное. Команда `sim run 20s` перематывает двадцать секунд без ожидания.

Пример. Топик с сегментом в 2 секунды и сроком хранения 10 секунд. Записи приходят тремя порциями с интервалом около трёх секунд, потом проходит 20 секунд.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic audit --partitions 1 --replication-factor 1 --config segment.ms=2000 --config retention.ms=10000
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic audit <<EOF
login ann
login bob
EOF
sim run 3s
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic audit <<EOF
login cat
login dan
EOF
sim run 3s
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic audit <<EOF
login eve
EOF
sim run 20s
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic audit --from-beginning --max-messages 10 --formatter-property print.offset=true
```

```text
Created topic audit.
[sim] прошло 3000 мс виртуального времени
[sim] прошло 3000 мс виртуального времени
[sim] прошло 20000 мс виртуального времени
Offset:4	login eve
(песочница: новых сообщений нет)
Processed a total of 1 messages
```

Почему осталась одна запись. Первый сегмент (offset 0 и 1) закрыт, его последняя запись старше десяти секунд, и он удалён. То же со вторым (offset 2 и 3). Третий сегмент активный, в нём только `login eve`: его не трогают, даже когда запись старше срока. Вывод начинается с offset 4, это и есть `log start offset`.

Пустые строки после `kafka-console-producer.sh` в выводе не показаны: команда ничего не печатает.

### Что видит потребитель

Группа хранит закоммиченный offset (урок 3.4). Если за время простоя группы начало лога ушло дальше этого offset, читать с него уже нечего: брокер отвечает ошибкой `OFFSET_OUT_OF_RANGE` (код 1). Клиент тогда применяет `auto.offset.reset`: `earliest` ставит позицию на `log start offset`, `latest` — в конец лога, `none` — ошибка. Удалённые записи группа не получит ни при каком значении.

Консольный потребитель с `--from-beginning` — это `auto.offset.reset=earliest`. Пример: группа `reports` прочитала две записи и ушла, а за 30 секунд первый сегмент удалился.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic clicks --partitions 1 --replication-factor 1 --config segment.ms=2000 --config retention.ms=10000
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic clicks <<EOF
click a
click b
click c
EOF
sim run 3s
kafka-console-producer.sh --bootstrap-server localhost:9092 --topic clicks <<EOF
click d
click e
EOF
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic clicks --group reports --from-beginning --max-messages 2 --formatter-property print.offset=true
sim run 30s
kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group reports
kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic clicks --group reports --from-beginning --max-messages 10 --formatter-property print.offset=true
```

```text
Created topic clicks.
[sim] прошло 3000 мс виртуального времени
Offset:0	click a
Offset:1	click b
Processed a total of 2 messages
[sim] прошло 30000 мс виртуального времени
Consumer group 'reports' has no active members.
GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG             CONSUMER-ID     HOST            CLIENT-ID
reports         clicks          0          2               5               3               -               -               -
Offset:3	click d
Offset:4	click e
(песочница: новых сообщений нет)
Processed a total of 2 messages
```

Lag группы показывает 3 (конец лога 5 минус закоммиченный offset 2), но читаемых записей только две: `click c` (offset 2) удалена вместе с первым сегментом, и группа её не увидит. Lag считает разницу offset, а не доступные данные. Вывод: срок хранения должен с запасом перекрывать самый длинный простой потребителей.

### Менять и снимать настройки

Настройки готового топика меняет `kafka-configs.sh`. Форму `--entity-type topics --entity-name … --alter --add-config` вы видели в уроке 3.2; здесь добавляются `--delete-config` и `--describe`.

```text
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name ТОПИК --alter --add-config ИМЯ=ЗНАЧЕНИЕ,ИМЯ=ЗНАЧЕНИЕ
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name ТОПИК --alter --delete-config ИМЯ
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name ТОПИК --describe
```

- `--entity-type topics --entity-name ТОПИК` — настройки какого топика меняем.
- `--alter --add-config` — задать значения; несколько параметров пишутся через запятую без пробелов.
- `--alter --delete-config` — убрать переопределение: параметр вернётся к значению по умолчанию.
- `--describe` — показать переопределённые параметры.

Пример: ограничим размер партиции двумя гигабайтами (2147483648 байт) и сутками, затем снимем ограничение по размеру.

```broker example
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic audit2 --partitions 3 --replication-factor 3 --config retention.ms=172800000 --config segment.ms=21600000
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name audit2 --alter --add-config retention.bytes=2147483648,retention.ms=86400000
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name audit2 --alter --delete-config retention.bytes
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name audit2 --describe
```

```text
Created topic audit2.
Completed updating config for topic audit2.
Completed updating config for topic audit2.
Dynamic configs for topic audit2 are:
  retention.ms=86400000 sensitive=false synonyms={DYNAMIC_TOPIC_CONFIG:retention.ms=86400000}
  segment.ms=21600000 sensitive=false synonyms={DYNAMIC_TOPIC_CONFIG:segment.ms=21600000}
```

Перевод единиц: 1 час — 3600000 мс, 1 сутки — 86400000, 7 суток — 604800000. Гибибайт — 1073741824 байт.

### Сколько на самом деле живут данные

Срок хранения — не точный срок. Запись нельзя удалить, пока она в активном сегменте. Активный сегмент закрывается по `segment.ms` или `segment.bytes`, а потом ещё должен «состариться» до `retention.ms`. В худшем случае запись живёт примерно `segment.ms + retention.ms`. С настройками по умолчанию для редкого топика это около 14 суток вместо 7. Если нужна точность, уменьшайте `segment.ms`: сегменты закрываются чаще, и удалять есть что.

### Частые ошибки

- **Ошибка:** поставить `retention.ms=7` и ждать, что данные хранятся неделю. **Верно:** значение в миллисекундах: `604800000`.
- **Ошибка:** ждать, что после `retention.ms` запись пропадёт сразу, и строить на этом логику (например, «через час данных нет»). **Верно:** считать срок верхней границей хранения для удаления, а не сроком жизни каждой записи; активный сегмент и периодическая проверка добавляют время.
- **Ошибка:** `retention.bytes=10737418240` и расчёт на 10 GiB для всего топика из трёх партиций. **Верно:** лимит действует на каждую партицию, всего будет до 30 GiB (плюс активные сегменты).
- **Ошибка:** хранить меньше, чем простаивает самый медленный потребитель или чем длится выходной с отчётами. **Верно:** срок хранения больше самого длинного простоя плюс запас, иначе группа теряет данные и перескакивает на начало лога.

### Шпаргалка

- Партиция = сегменты; активный — последний. Закрытие: `segment.bytes` (1 GiB, не меньше 1 MiB) или `segment.ms` (7 суток).
- `cleanup.policy=delete` — по умолчанию. `retention.ms` (7 суток, `-1` без предела), `retention.bytes` (на партицию, `-1`).
- Удаляются только закрытые сегменты, старейшие первыми: по последней метке времени сегмента или по превышению размера, покрывающему сегмент.
- После удаления растёт `log start offset`; offset остальных записей не меняются.
- Потребитель позади `log start offset`: `OFFSET_OUT_OF_RANGE`, затем `auto.offset.reset`. Удалённое не вернуть.
- `kafka-configs.sh … --alter --add-config имя=значение,…` · `--delete-config имя` · `--describe`.

## task kfk-retention-create

```json
{
  "type": "topology",
  "title": "Топик для журнала аудита",
  "xp": 10,
  "hints": [
    "Раздел «Правила удаления»: у `--create` можно повторять `--config имя=значение`.",
    "Нужны два параметра: `retention.ms` (срок хранения) и `segment.ms` (когда закрывать сегмент), оба в миллисекундах. Двое суток — 172800000, шесть часов — 21600000.",
    "Шаблон: `kafka-topics.sh --bootstrap-server localhost:9092 --create --topic … --partitions … --replication-factor … --config retention.ms=… --config segment.ms=…`."
  ],
  "check": { "compare": ["topics", "configs"] }
}
```

Создайте топик `payment-audit` для журнала платежей: 3 партиции, фактор репликации 3. Записи нужно хранить двое суток (`retention.ms` равен 172800000), сегмент должен закрываться каждые шесть часов (`segment.ms` равен 21600000).

```broker starter
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic … --partitions … --replication-factor … --config retention.ms=… --config segment.ms=…
```

```broker solution
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic payment-audit --partitions 3 --replication-factor 3 --config retention.ms=172800000 --config segment.ms=21600000
```

## task kfk-retention-size

```json
{
  "type": "console",
  "title": "Лимит по размеру и по времени",
  "xp": 15,
  "hints": [
    "Раздел «Менять и снимать настройки»: готовый топик настраивается через `kafka-configs.sh`.",
    "Нужна одна команда `--alter --add-config` с двумя параметрами через запятую: `retention.bytes` и `retention.ms`.",
    "Шаблон: `kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name … --alter --add-config retention.bytes=…,retention.ms=…`."
  ],
  "check": {
    "compare": ["configs"],
    "require": [
      { "pattern": "kafka-configs(\\.sh)? .*--alter", "message": "Измените настройки командой kafka-configs.sh с флагом --alter" }
    ]
  }
}
```

Топик `click-stream` растёт слишком быстро. Ограничьте хранение: не больше 2 GiB на партицию (`retention.bytes` равен 2147483648) и не дольше суток (`retention.ms` равен 86400000). Топик уже создан, пересоздавать его не нужно.

```broker setup
kafka-topics.sh --bootstrap-server localhost:9092 --create --topic click-stream --partitions 4 --replication-factor 1
```

```broker starter
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name click-stream --alter --add-config retention.bytes=…,retention.ms=…
```

```broker solution
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name click-stream --alter --add-config retention.bytes=2147483648,retention.ms=86400000
```

## task kfk-retention-age

```json
{
  "type": "choice",
  "title": "Как долго живёт запись",
  "xp": 10,
  "hints": [
    "Раздел «Сколько на самом деле живут данные».",
    "Сначала сегмент должен закрыться (по `segment.ms`), потом его последняя запись должна стать старше `retention.ms`.",
    "Худший случай: срок закрытия сегмента плюс срок хранения."
  ],
  "options": [
    "Ровно 7 суток: после этого срока запись удаляется",
    "До 7 суток: запись может исчезнуть раньше, но не позже",
    "Примерно до 14 суток: активный сегмент закрывается лишь через 7 суток, и только потом начинает «стариться» 7 суток",
    "Бесконечно долго: при малом трафике сегмент не заполнится по размеру, а активный сегмент не удаляется"
  ],
  "answer": [2],
  "explanation": "Активный сегмент не удаляется. У топика по умолчанию `segment.ms` равен 7 суткам, поэтому сегмент с первой записью закрывается примерно через 7 суток после неё. Удалить его можно, когда самая поздняя запись в нём станет старше `retention.ms`, то есть ещё через 7 суток. Первые записи сегмента при этом проживут до 14 суток. Ответ про ровно 7 суток не учитывает активный сегмент. «До 7 суток» неверно: раньше срока Kafka не удаляет. «Бесконечно» неверно: сегмент закрывается и по времени, не только по размеру, поэтому через 7 суток он станет закрытым и со временем будет удалён."
}
```

Топик редкого события настроен так: `retention.ms=604800000` (7 суток), `segment.ms` не менялся (по умолчанию 7 суток), `segment.bytes` не менялся (1 GiB), трафик крошечный: сегмент по размеру никогда не заполнится. Как долго, самое большее, после записи её можно будет прочитать?

## task kfk-retention-late-reports

```json
{
  "type": "scenario",
  "title": "Ночной отчёт остался без данных",
  "xp": 25,
  "scenario": "w4-late-reports",
  "hints": [
    "Раздел «Что видит потребитель»: что происходит, когда данные удалены раньше, чем их прочитали.",
    "Продажи записываются за 6 секунд, отчёт стартует позже, а топик держит данные 6 секунд. Нужно увеличить срок хранения готового топика `sales`.",
    "Шаблон: `kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name sales --alter --add-config retention.ms=…`."
  ],
  "check": {}
}
```

Кассы пишут в топик `sales` шестьдесят записей `sale 1` … `sale 60` (десять в секунду, первые шесть секунд). Сервис отчётов `reports` включается по расписанию только на тридцатой секунде и должен обработать все шестьдесят продаж. В топике `retention.ms` равен 6000, `segment.ms` равен 2000. К моменту старта отчёта часть данных удалена, и `reports` обработал только 20 записей из 60.

Не меняя потребителя, настройте топик `sales` командой так, чтобы к 60000-й миллисекунде отчёт обработал все 60 записей. Достаточно увеличить срок хранения до суток (`retention.ms` равен 86400000).

```broker starter
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name sales --alter --add-config retention.ms=…
```

```broker solution
kafka-configs.sh --bootstrap-server localhost:9092 --entity-type topics --entity-name sales --alter --add-config retention.ms=86400000
```
