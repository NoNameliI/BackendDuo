# Vhost и права доступа

В магазине на одном брокере живут сервисы заказов, оплаты и отчётов, а ещё тестовое окружение. Если все они видят все очереди, одна ошибка в тесте опустошит рабочую очередь, а сервис отчётов сможет публиковать заказы. Брокер решает это двумя средствами: виртуальные хосты разделяют окружения, а права пользователей ограничивают то, что видит и делает каждый сервис.

### Vhost: отдельное пространство имён

Vhost (virtual host) — изолированная область брокера. В нём свои exchange, очереди, привязки и права. Очередь `orders` в одном vhost и очередь `orders` в другом — разные очереди, и сообщение не может пройти из одного vhost в другой.

```text
rabbitmqctl add_vhost имя
rabbitmqctl list_vhosts
rabbitmqadmin --vhost имя группа команда …
rabbitmqctl команда -p имя …
```

- `add_vhost имя` создаёт vhost. Новый vhost пуст: в нём есть только встроенные exchange.
- `list_vhosts` печатает имена всех vhost.
- У `rabbitmqadmin` флаг `--vhost имя` стоит перед группой команд: `rabbitmqadmin --vhost staging queues list`. Без него работа идёт в vhost `/`.
- У `rabbitmqctl` vhost выбирает флаг `-p имя` после названия команды. Без него — тоже `/`.
- `delete_vhost имя` удаляет vhost со всем содержимым без возможности вернуть. Vhost `/` удалить нельзя.

Свежий брокер уже содержит vhost `/` и пользователя `guest` с полными правами на него. В новый vhost `guest` сам не попадает: права нужно выдать.

### Пользователь и права

Пользователь — имя и пароль, под которыми сервис подключается к брокеру. Только что созданный пользователь ничего не может: у него нет прав ни в одном vhost, и подключиться он не сможет.

```text
rabbitmqctl add_user имя пароль
rabbitmqctl set_permissions -p vhost пользователь configure write read
rabbitmqctl list_users
```

- `add_user имя пароль` создаёт пользователя. В примерах курса пароли заведомо вымышленные: `demo-pass`.
- `set_permissions` задаёт права пользователя в одном vhost. Три шаблона идут строго в порядке `configure`, `write`, `read`.
- Каждый шаблон — регулярное выражение, которое сравнивается с именем exchange или очереди. В песочнице оно ищется в любом месте имени, поэтому `orders` подойдёт и к `old-orders-2`. Надёжнее писать с якорями: `^orders$` — ровно это имя, `^mail-` — всё, что начинается с `mail-`.
- Пустая строка `""` означает «ничего»: она равна `^$` и подходит только к пустому имени. Строка `".*"` разрешает всё.
- `list_users` печатает пользователей и их теги. Теги (`administrator` и другие) нужны только веб-интерфейсу управления. Права на очереди и exchange они не заменяют.

### Что разрешает каждый из трёх шаблонов

| Действие | Какое право проверяется |
|---|---|
| Объявить или удалить exchange | `configure` на exchange |
| Объявить или удалить очередь | `configure` на очередь |
| Привязать очередь к exchange | `write` на очередь и `read` на exchange |
| Опубликовать сообщение | `write` на exchange |
| Прочитать (`get`) или подписаться (`consume`) | `read` на очередь |

Обратите внимание на привязку: нужны два права сразу. И на публикацию право `write` проверяется у exchange, а не у очереди.

Сервису-издателю обычно хватает `write` на нужный exchange. Сервису-потребителю — `read` на его очередь. Права `configure` нужны тому, кто создаёт топологию, а это чаще всего скрипт развёртывания, а не рабочий сервис.

### Проверка от имени пользователя

Чтобы проверить права, не подключаясь к брокеру отдельно, в лаборатории есть учебная команда:

```text
sim as пользователь rabbitmqadmin …
```

Она выполняет одну команду `rabbitmqadmin` от имени указанного пользователя. Следующая команда снова идёт от `guest`. Для настоящего брокера эта команда не нужна: там вы подключаетесь с логином и паролем нужного сервиса.

```broker example
rabbitmqctl add_vhost lab
rabbitmqctl list_vhosts
```

```text
Adding vhost "lab" ...
name
/
lab
```

Пока `guest` не получил прав в новом vhost, даже администратор не может создать там очередь:

```text
rabbitmqadmin --vhost lab queues declare --name orders --type classic --durable true
Error: 403 ACCESS_REFUSED - access to queue 'orders' in vhost 'lab' refused for user 'guest'
```

Выдайте права и повторите. Очередь `orders` в vhost `lab` не связана с очередью `orders` в vhost `/`:

```broker example
rabbitmqctl set_permissions -p lab guest ".*" ".*" ".*"
rabbitmqadmin --vhost lab queues declare --name orders --type classic --durable true
rabbitmqadmin queues declare --name orders --type classic --durable true
rabbitmqadmin --vhost lab publish message --routing-key orders --payload "order 1"
rabbitmqctl list_queues -p lab
rabbitmqctl list_queues
```

```text
Setting permissions for user "guest" in vhost "lab" ...
declared queue 'orders' in virtual host 'lab'
declared queue 'orders' in virtual host '/'
published the message
name	messages
orders	1
name	messages
orders	0
```

Первый список — vhost `lab`, второй — `/`. Сообщение лежит только в первой очереди.

Теперь два сервиса с разными правами: издатель только пишет в exchange `events`, читатель только читает очередь `orders`.

```broker example
rabbitmqadmin --vhost lab exchanges declare --name events --type direct --durable true
rabbitmqadmin --vhost lab exchanges declare --name audit --type direct --durable true
rabbitmqadmin --vhost lab bindings declare --source events --destination-type queue --destination orders --routing-key new
rabbitmqctl add_user lab-writer demo-pass
rabbitmqctl add_user lab-reader demo-pass
rabbitmqctl set_permissions -p lab lab-writer "" "^events$" ""
rabbitmqctl set_permissions -p lab lab-reader "" "" "^orders$"
sim as lab-writer rabbitmqadmin --vhost lab publish message --exchange events --routing-key new --payload "order 2"
sim as lab-reader rabbitmqadmin --vhost lab get messages --queue orders --ack-mode ack_requeue_true
```

Читатель увидит в таблице сообщения `order 1` и `order 2`. А вот чужие операции брокер отклоняет:

```text
sim as lab-writer rabbitmqadmin --vhost lab publish message --exchange audit --routing-key new --payload x
Error: 403 ACCESS_REFUSED - access to exchange 'audit' in vhost 'lab' refused for user 'lab-writer'

sim as lab-reader rabbitmqadmin --vhost lab exchanges declare --name tmp --type direct
Error: 403 ACCESS_REFUSED - access to exchange 'tmp' in vhost 'lab' refused for user 'lab-reader'

sim as lab-reader rabbitmqadmin --vhost lab bindings declare --source events --destination-type queue --destination orders --routing-key x
Error: 403 ACCESS_REFUSED - access to queue 'orders' in vhost 'lab' refused for user 'lab-reader'
```

Привязка отклонена, потому что у читателя нет права `write` на очередь `orders`. Чтобы привязать, нужно `write` на очередь и `read` на exchange.

### Принцип минимальных прав

Каждому сервису выдавайте ровно то, что ему нужно, и шаблоны — по именам, с якорями. Тогда ошибка или утечка пароля одного сервиса не даёт доступа ко всему брокеру. Если сервис не может подписаться на очередь, первым делом проверьте его `read`, а не саму очередь: потребитель с неверными правами не подписывается, и очередь просто растёт.

В песочнице упрощено: нет паролей и проверки подключения по ним, нет тегов и политик, а команды просмотра списков права не проверяют. Правила проверки доступа для публикации, чтения, объявления и привязки работают как описано выше.

### Частые ошибки

- **Ошибка:** `rabbitmqctl set_permissions -p shop mailer "^mail-" "^mail-"`. **Верно:** `rabbitmqctl set_permissions -p shop mailer "^mail-" "^mail-" "^mail-"`. Нужны все три шаблона: команда с тремя аргументами вместо четырёх (vhost задан флагом, затем пользователь и три шаблона) отклоняется.
- **Ошибка:** порядок «read, write, configure». **Верно:** «configure, write, read». Иначе права окажутся перепутаны: сервис, который должен читать, не прочитает, а тот, кто должен писать, будет только объявлять.
- **Ошибка:** выдать издателю `read` и забыть `write`. **Верно:** публикация проверяет `write` на exchange, поэтому издателю нужен именно он.
- **Ошибка:** шаблон без якорей: `orders` разрешает и `orders-archive`. **Верно:** `^orders$`.
- **Ошибка:** создать vhost и сразу объявлять в нём очереди от `guest`: `403 ACCESS_REFUSED`. **Верно:** сначала `set_permissions`.

### Шпаргалка

- `rabbitmqctl add_vhost имя`, `delete_vhost имя`, `list_vhosts`.
- `rabbitmqadmin --vhost имя группа команда …`; `rabbitmqctl команда -p имя …`.
- `rabbitmqctl add_user имя пароль`, `list_users`.
- `rabbitmqctl set_permissions -p vhost пользователь configure write read`; `""` — ничего, `".*"` — всё.
- declare и delete — `configure`; привязка — `write` на очередь и `read` на exchange; публикация — `write` на exchange; `get` и `consume` — `read` на очередь.
- `sim as пользователь rabbitmqadmin …` — выполнить команду от имени пользователя (только лаборатория).

## task rmq-vhost-create

```json
{
  "type": "console",
  "title": "Окружение для уведомлений",
  "xp": 10,
  "hints": [
    "Разделы «Vhost: отдельное пространство имён» и «Пользователь и права».",
    "Нужны три команды: создать vhost, создать пользователя, задать ему права в этом vhost. Все три шаблона прав одинаковые.",
    "Шаблон: `rabbitmqctl add_vhost …`, `rabbitmqctl add_user … demo-pass`, `rabbitmqctl set_permissions -p … … \"…\" \"…\" \"…\"`."
  ],
  "check": {
    "compare": ["vhosts", "users", "permissions"],
    "require": [
      { "pattern": "add_vhost", "message": "Создайте vhost командой rabbitmqctl add_vhost" },
      { "pattern": "set_permissions", "message": "Задайте права командой rabbitmqctl set_permissions" }
    ]
  }
}
```

Сервису уведомлений нужно своё окружение. Создайте vhost `notify` и пользователя `notifier` с паролем `demo-pass`. В vhost `notify` разрешите `notifier` работать только с ресурсами, имена которых начинаются с `notify-`: все три права (`configure`, `write`, `read`) задайте шаблоном `^notify-`.

```broker starter
rabbitmqctl add_vhost …
rabbitmqctl add_user … demo-pass
rabbitmqctl set_permissions -p … … "…" "…" "…"
```

```broker solution
rabbitmqctl add_vhost notify
rabbitmqctl add_user notifier demo-pass
rabbitmqctl set_permissions -p notify notifier "^notify-" "^notify-" "^notify-"
```

## task rmq-vhost-envs

```json
{
  "type": "topology",
  "title": "Два окружения с одинаковым именем",
  "xp": 15,
  "hints": [
    "Раздел «Vhost: отдельное пространство имён»: флаг `--vhost` стоит перед группой команд.",
    "В каждом vhost нужны свои объекты; одинаковое имя exchange в двух vhost допустимо, это разные exchange. У каждой команды свой `--vhost`.",
    "Шаблон: `rabbitmqadmin --vhost … exchanges declare --name … --type direct --durable true`, затем очередь и привязка, и всё то же для второго vhost."
  ],
  "check": {}
}
```

Тестировщики и рабочий сервис используют одинаковые имена. Права `guest` в vhost `staging` и `prod` уже выданы. Подготовьте в каждом из них схему:

- в vhost `staging`: exchange `orders` (`direct`, durable), очередь `orders-test` (`classic`, durable), привязка из `orders` в `orders-test` с ключом `new`;
- в vhost `prod`: exchange `orders` (`direct`, durable), очередь `orders-live` (`classic`, durable), привязка из `orders` в `orders-live` с ключом `new`.

```broker setup
rabbitmqctl add_vhost staging
rabbitmqctl add_vhost prod
rabbitmqctl set_permissions -p staging guest ".*" ".*" ".*"
rabbitmqctl set_permissions -p prod guest ".*" ".*" ".*"
```

```broker starter
rabbitmqadmin --vhost staging exchanges declare --name … --type … --durable true
rabbitmqadmin --vhost staging queues declare --name … --type classic --durable true
rabbitmqadmin --vhost staging bindings declare --source … --destination-type queue --destination … --routing-key …
```

```broker solution
rabbitmqadmin --vhost staging exchanges declare --name orders --type direct --durable true
rabbitmqadmin --vhost staging queues declare --name orders-test --type classic --durable true
rabbitmqadmin --vhost staging bindings declare --source orders --destination-type queue --destination orders-test --routing-key new
rabbitmqadmin --vhost prod exchanges declare --name orders --type direct --durable true
rabbitmqadmin --vhost prod queues declare --name orders-live --type classic --durable true
rabbitmqadmin --vhost prod bindings declare --source orders --destination-type queue --destination orders-live --routing-key new
```

## task rmq-reader-only

```json
{
  "type": "console",
  "title": "Аналитик только читает",
  "xp": 15,
  "hints": [
    "Разделы «Что разрешает каждый из трёх шаблонов» и «Проверка от имени пользователя».",
    "Чтение очереди — это право `read` на неё. Два других шаблона должны быть пустыми. Затем проверьте результат командой `sim as …`.",
    "Шаблон: `rabbitmqctl set_permissions -p shop analyst \"…\" \"…\" \"…\"`, затем `sim as analyst rabbitmqadmin --vhost shop get messages --queue orders --ack-mode ack_requeue_true`."
  ],
  "check": {
    "compare": ["permissions"],
    "require": [
      { "pattern": "set_permissions", "message": "Задайте права командой rabbitmqctl set_permissions" },
      { "pattern": "sim as analyst rabbitmqadmin .*get messages", "message": "Проверьте права: прочитайте очередь от имени analyst командой sim as" }
    ]
  }
}
```

В vhost `shop` есть очередь `orders` с сообщениями, пользователь `analyst` уже создан, но прав у него нет. Выдайте ему доступ только на чтение очереди `orders`: `configure` и `write` пустые, `read` — ровно `orders`. Затем убедитесь, что аналитик может прочитать очередь: выполните `get messages` от его имени с режимом `ack_requeue_true`, чтобы сообщения остались в очереди.

```broker setup
rabbitmqctl add_vhost shop
rabbitmqctl set_permissions -p shop guest ".*" ".*" ".*"
rabbitmqctl add_user analyst demo-pass
rabbitmqadmin --vhost shop queues declare --name orders --type classic --durable true
rabbitmqadmin --vhost shop publish message --routing-key orders --payload "order 1"
rabbitmqadmin --vhost shop publish message --routing-key orders --payload "order 2"
```

```broker starter
rabbitmqctl set_permissions -p shop analyst "…" "…" "…"
sim as analyst rabbitmqadmin --vhost shop get messages --queue orders --ack-mode ack_requeue_true
```

```broker solution
rabbitmqctl set_permissions -p shop analyst "" "" "^orders$"
sim as analyst rabbitmqadmin --vhost shop get messages --queue orders --ack-mode ack_requeue_true
```

## task rmq-perms-review

```json
{
  "type": "review",
  "title": "Почтовый сервис не публикует",
  "xp": 15,
  "hints": [
    "Раздел «Что разрешает каждый из трёх шаблонов».",
    "Сравните, что сервису нужно делать, с тем, что разрешено каждым из трёх шаблонов. Порядок шаблонов: `configure`, `write`, `read`.",
    "Публикация проверяет `write` на exchange. Посмотрите на второй шаблон во второй команде."
  ],
  "code": "rabbitmqctl add_user mailer demo-pass\nrabbitmqctl set_permissions -p shop mailer \"\" \"\" \"^mail-\"",
  "codeLanguage": "sh",
  "lines": [2],
  "options": [
    "Шаблон `write` пуст, поэтому публикация в `mail-out` будет отклонена",
    "Шаблон `read` слишком широкий: он разрешает чтение всех очередей",
    "Пользователя нельзя создать без тегов, поэтому права не применятся",
    "Права нельзя выдать в vhost `shop`, только в vhost `/`"
  ],
  "answer": [0],
  "explanation": "Сервис должен публиковать в exchange `mail-out` и читать очередь `mail-in`. Для чтения `^mail-` подходит, а для публикации нужно право `write` на exchange `mail-out`, и второй шаблон пуст: брокер ответит `403 ACCESS_REFUSED`. Шаблон `read` ограничен именами с `mail-` и не даёт доступа ко всем очередям. Теги нужны только веб-интерфейсу управления, а права выдаются в любом vhost."
}
```

Сервис `mailer` в vhost `shop` должен публиковать письма в exchange `mail-out` и читать очередь `mail-in`. Администратор выдал права двумя командами, но публикация не работает. Найдите причину.
