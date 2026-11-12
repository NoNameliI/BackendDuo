# Отличия песочницы Git от настоящего Git

Курс «Git, GitHub и GitLab» работает на учебной модели Git, встроенной в приложение. Она не вызывает
установленный Git, не обращается к файлам компьютера и к сети: репозитории, рабочие папки и «удалённые»
серверы живут в памяти приложения. Ниже — что совпадает с настоящим Git и чем модель сознательно отличается.

## Что совпадает

- Объекты (blob, tree, commit, tag) кодируются как в Git, поэтому идентификаторы коммитов совпадают с теми,
  что выдал бы настоящий Git на тех же данных, тех же авторе и времени.
- Тексты вывода `init`, `status` (полный и `-s`/`-sb`), `add`, `rm`, `mv`, `restore`, `commit`, `log`
  (включая `--oneline`, `--graph`, `--all`, `-n`), `show`, `diff` (включая `--staged`, `--stat`, `--name-only`),
  `branch`, `switch`, `checkout`, `config`, `merge`, `rebase`, `reset`, `revert`, `cherry-pick`, `stash`,
  `tag`, `reflog`, `clone`, `remote`, `fetch`, `pull`, `push` сверяются с Git 2.53 на наборе сценариев
  (`npm run test:git-parity`, нужен установленный Git только у разработчика).

## Сознательные упрощения

- **Время.** Часы песочницы детерминированы: старт — 9 января 2026, 10:00 (+03:00), каждая команда `git`
  сдвигает время на минуту. Поэтому результаты заданий воспроизводимы.
- **Пользователь.** По умолчанию `user.name = Студент`, `user.email = student@example.com`; настоящие
  данные вводить не нужно и не следует.
- **Редактор.** Песочница не открывает редактор: `git commit` без `-m` объясняет, как передать сообщение.
- **Оболочка.** Поддерживаются `cd`, `pwd`, `ls`, `cat`, `echo` (с `>` и `>>`), `touch`, `mkdir`, `rm`, `mv`,
  `clear`, цепочки `&&`, `||` и `;`, а также `test`/`[`, `grep`, `npm test`/`npm run`, `wc -l` и запуск `.sh`-файлов.
  Конвейеры (`|`) и переменные в терминале не поддерживаются.
- **Файлы.** Только текст; режимы файлов (исполняемые файлы, симлинки) и подмодули не моделируются.
- **Переименования.** Распознаются только переименования без изменений содержимого (100% совпадение).
- **Цвета и пейджер.** Вывод без цвета и без постраничного просмотра, как при `color.ui=false`, `core.pager=cat`.
- **Неподдерживаемые команды** (`bisect`, `blame`, `submodule`, `worktree` и др.) отвечают сообщением
  «в учебной песочнице это не поддерживается».

## Слияние и переписывание истории

- Слияние работает как стратегия `ort` для изменений содержимого, add/add и modify/delete. Переименования
  при слиянии не отслеживаются (считаются удалением и добавлением файла).
- Сливается одна ветка за раз; octopus-слияния, `--squash` и стратегии (`-s`, `-X`) не поддерживаются.
- `git rebase -i` недоступен: ему нужен редактор. Объединять коммиты можно через `git reset --soft`.
- `git revert` без `--no-edit` ведёт себя как с `--no-edit`: редактора нет, сообщение берётся стандартное.
- Завершение слияния через `git commit` без `-m` берёт подготовленное сообщение, как `--no-edit`.
- Журнал ссылок (`git reflog`) ведётся только для HEAD.
- Во время конфликта `git diff` показывает обычный, а не комбинированный (`diff --cc`) формат.
- В терминале сообщения идут в том порядке, в каком их видно в настоящем терминале.

## Удалённые репозитории

- «Сервер» — это голый репозиторий внутри песочницы (например, `/srv/project.git`); сети нет, адреса
  `https://…` относятся только к учебному хостингу песочницы.
- Передаются ветки и теги; протоколы, аутентификация, `--depth`, подмодули и LFS не моделируются.
- `pull` по умолчанию сливает (как `pull.rebase=false`), чтобы новичок не упирался в выбор стратегии.
- Сообщения о прогрессе передачи («Enumerating objects…») не выводятся.

## Учебный хостинг (GitHub и GitLab)

- Хостинг — модель внутри приложения. Адреса `https://github.com/…`, `https://gitlab.com/…` и
  `git@…:…` ведут к репозиториям песочницы; запросов в сеть нет, учётные записи и токены не нужны.
  Переключатель GitHub/GitLab меняет термины (pull request / merge request, Actions / CI/CD) и сообщения.
- Пользователь всегда `student`. Других участников (например, ревьюера `mentor`) изображает песочница.
- Учебные `gh` и `glab` знают повседневные команды: `repo create|clone|fork|view`, `pr`/`mr`
  `create|list|view|diff|checks|merge|review|approve|comment|close|checkout`, `issue create|list|view|close|comment`,
  `release create|list|view`, `run`/`ci list|view`. Интерактивных вопросов нет: недостающее берётся по умолчанию
  (например, `gh pr merge` без флага делает обычное слияние).
- Защита ветки: запрет прямого push, нужное число одобрений, обязательные проверки CI. Тексты отказа
  (`GH006 …`, `You are not allowed to push code to protected branches …`) повторяют настоящие.
- Слияние на хостинге делает коммит слияния, squash или rebase; «Closes #N» в описании закрывает задачу.

## CI (GitHub Actions и GitLab CI)

- Читаются `.github/workflows/*.yml` и `.gitlab-ci.yml` из отправленного коммита. Поддерживаются триггеры
  `push`/`pull_request` с фильтрами веток, `jobs`, `needs`, `steps` с `run`, `env`, `if` (сравнения, `&&`, `||`,
  `success()`, `failure()`, `always()`), выражения `${{ github.… }}`; в GitLab — `stages`, `script`,
  `before_script`/`after_script`, `variables`, `rules: - if:`, `only`/`except`, `when: manual`, `allow_failure`.
- Шаги выполняются в отдельной учебной песочнице: доступны команды оболочки песочницы, а также `test`/`[`,
  `grep`, `npm test`/`npm run` (скрипты из package.json), запуск `.sh`-файлов. Настоящие программы, Docker-образы,
  сеть и кэши не используются; `actions/checkout` копирует файлы коммита, прочие действия (`uses:`) только
  отмечаются в журнале. Матрицы, артефакты, секреты и расписания не моделируются.
- Без `actions/checkout` в GitHub Actions файлов проекта в рабочей папке нет — как и на настоящем раннере.
- Задания с `when: manual` остаются в состоянии «ручной запуск»: кнопки запуска в учебном хостинге нет.
- Журнал задания GitLab можно открыть во вкладке «Хостинг» → CI/CD или командой `glab ci view <номер> --log`.

Служебные команды для заданий курса: `hosting flavor|create|protect` и `as <пользователь> <команда>`
(подготовить чужой репозиторий или ревью). В реальном Git их нет.

# Учебные серверы курса API

Сети в приложении нет: запросы курса API обрабатывают учебные серверы, описанные данными (`courses/api/servers/*.json`).

## HTTP и REST

- Ответы повторяют FastAPI: `404 {"detail": "Not Found"}`, `405` с заголовком `Allow`, `422` со списком ошибок в формате pydantic, `401` с `WWW-Authenticate`, `201` с `Location`, `204` без тела.
- Тело без `Content-Type` читается как JSON (так делает FastAPI); другой тип данных — `422`.
- Время ответа условное: несколько миллисекунд плюс размер тела. Нет HTTP/2, сжатия, кэширования, keep-alive.
- Вложенные коллекции (`/customers/{id}/orders`) поддерживаются: список фильтруется по родителю, создание проставляет ссылку на него. Код `400` сервер не возвращает (ошибки данных — `422`, как в FastAPI). Условные запросы (`ETag`, `If-None-Match`, `304`) не моделируются: такие ответы задаются фиксированными маршрутами. Лимит частоты (`429`) считает все запросы к экземпляру сервера.
- Сервер принимает и токен (`Authorization: Bearer`), и ключ (`X-API-Key`) на любом защищённом маршруте.

## CORS

- Сервер ведёт себя как `CORSMiddleware` из Starlette: неразрешённый preflight получает `400 Disallowed CORS origin, method, headers`, заголовки из безопасного списка разрешены всегда.
- Браузер — модель Chromium: тексты ошибок как в консоли Chrome, preflight по правилам Fetch. Кэш preflight (`max_age`) не моделируется.

## GraphQL

- Настоящий `graphql-js`: разбор, проверка по схеме и выполнение. Тексты ошибок переводятся на русский.
- Резолверы не пишутся вручную, а выводятся из имён: список берётся из коллекции с тем же именем, связь — по полю `<имя>_id`, мутации `create`/`update`/`delete<Тип>`. Каждое обращение к коллекции считается, чтобы была видна проблема N+1; DataLoader и пакетная загрузка не моделируются.
- Ошибки запроса приходят с кодом `200` и полем `errors` (как при ответе в `application/json`). Подписки (`subscription`) не поддерживаются.

## Protocol Buffers и gRPC

- Настоящий `protobufjs`: разбор `.proto`, проверка и кодирование сообщений в те же байты, что у официальных библиотек.
- gRPC-вызов — модель: метод выбирается по имени (`Get`, `List`, `Watch`/`Stream`, `Create`, `Delete` + сущность) и работает с коллекциями сервера. HTTP/2, метаданные, дедлайны и потоки от клиента не моделируются; в ленте вызов показан как `POST /пакет.Сервис/Метод` с телом в JSON и статусом в `grpc-status`.
- GraphQL и protobuf выполняются в отдельном воркере без доступа к сети; зависший запрос останавливается через 5 секунд.

## FastAPI (Python)

- Настоящий Python 3.14 (Pyodide 314.0.7) с настоящими FastAPI 0.136, pydantic 2.12 и Starlette 1.0. Пакеты лежат в приложении заранее скомпилированными, сеть не нужна.
- Сервера (uvicorn) нет: приложение `app` из `main.py` вызывается напрямую по ASGI. Адрес в ответах — `http://127.0.0.1:8000`; `uvicorn.run(...)` ничего не делает.
- В WebAssembly нет потоков: обработчики `def` выполняются по очереди, как `async def`. Фоновые задачи, WebSocket, `/docs` (Swagger грузит скрипты из интернета), тестовый клиент (`httpx`) и шаблоны (`jinja2`) недоступны; `/openapi.json` работает.
- Между запросами из композера приложение живёт (POST виден следующему GET), после правки кода запускается заново. Проверка каждый раз запускает и эталон, и код ученика с нуля.
- Код выполняется в отдельном воркере. После загрузки Python у воркера отбираются сеть (`fetch`, XHR, WebSocket, EventSource), хранилища (`indexedDB`, `caches`, `navigator`), вложенные воркеры, загрузка шрифтов, собственный `postMessage` и выполнение JavaScript из строк (`eval`, `Function`, строковые таймеры). С приложением воркер говорит только через закрытый `MessagePort`. Импорт модулей `js` и `pyodide` из кода ученика отклоняется с понятной ошибкой.
- Запуск дольше 8 секунд (например, бесконечный цикл) останавливает воркер, Python загружается заново (около 2 секунд); так же воркер заменяется после фатальной ошибки Pyodide.
- Эталон и код ученика выполняются в одном интерпретаторе (каждый раз в новом модуле `main`). Код, который намеренно подменяет установленные пакеты, может повлиять на проверку: учебная среда не защищает от сознательного обмана самого себя.

# Общее для учебных брокеров (RabbitMQ и Kafka)

Оба брокера — модель внутри приложения (`src/engine/sim`). Сети нет: клиенты, брокеры, диски и «сервера» существуют только в памяти приложения, ничего не обращается к компьютеру и интернету.

- **Время.** Часы виртуальные, в миллисекундах: время идёт только по действиям ученика и кнопкам «прокрутить время». Поэтому результаты заданий воспроизводимы.
- **Детерминизм.** Любая случайность (выбор раздела без ключа, имена потребителей, сбои) берётся из генератора с фиксированным seed сценария. Один и тот же сценарий всегда даёт один и тот же журнал.
- **Журнал.** Каждое решение брокера записывается с идентификатором правила (например, `[ae-chain]`, `[hw-min-isr]`). Идентификатор указывает на правило из списков ниже; у каждого правила есть ссылка на документацию.
- **Перемотка.** Шаг назад — это повторный прогон сценария с начала до нужного места (`seek = rerun`), а не откат состояния.
- **Правила.** Правило «точное» — поведение сверено с документацией или исходным кодом. Правило «упрощено» — модель сознательно грубее настоящего брокера; такие правила перечислены в разделах «Сознательные упрощения».
- **Версии.** RabbitMQ 4.4 и Apache Kafka 4.4 (поведение по документации и по исходникам ветки `trunk`, сверено в ноябре 2026). Утверждения, которых в документации нет, в модель не вошли: они исключены, а не угаданы.

# Учебный брокер RabbitMQ

Протокол — AMQP 0-9-1. Модель: брокер с виртуальными хостами, пользователями и правами, exchange, очередями, потребителями, подтверждениями издателя и командами `rabbitmqadmin` (v2), `rabbitmqctl`. Адреса документации: `D` = `https://www.rabbitmq.com/docs/`, `T` = `https://www.rabbitmq.com/tutorials/`, `SPEC` = `https://github.com/rabbitmq/amqp-0.9.1-spec/blob/main/docs/amqp-0-9-1-reference.md`.

## Что совпадает

Маршрутизация (в скобках — идентификатор правила в журнале):

- `[default-exchange]` безымянный exchange — direct, каждая очередь привязана к нему по своему имени, bind и unbind запрещены. https://www.rabbitmq.com/tutorials/amqp-concepts
- `[direct]` совпадение ключа привязки и ключа маршрутизации. https://www.rabbitmq.com/docs/exchanges
- `[fanout]` ключ игнорируется, копия уходит во все привязки. https://www.rabbitmq.com/docs/exchanges
- `[topic-wildcards]` `*` — ровно одно слово, `#` — ноль и более слов, слова разделены точками. https://www.rabbitmq.com/docs/exchanges
- `[topic-one-copy]` очередь получает одну копию, сколько бы привязок ни подошло. https://www.rabbitmq.com/docs/exchanges
- `[headers-match]` `any`/`all` не учитывают заголовки `x-…`, `any-with-x`/`all-with-x` учитывают; ключ маршрутизации игнорируется. https://www.rabbitmq.com/tutorials/amqp-concepts
- `[mandatory-return]` без маршрута сообщение отбрасывается; с `mandatory` издатель получает `basic.return` 312, раньше подтверждения. https://www.rabbitmq.com/docs/publishers
- `[ae-chain]` alternate exchange получает сообщение без маршрута; цепочка идёт до первого маршрута, конца или повтора. https://www.rabbitmq.com/docs/ae
- `[unknown-exchange-404]` публикация в несуществующий exchange — 404, канал закрывается. https://www.rabbitmq.com/docs/publishers

Объявления и жизненный цикл:

- `[redeclare-406]` повторное объявление с другими атрибутами — 406 `PRECONDITION_FAILED`. https://www.rabbitmq.com/docs/queues
- `[reserved-name-403]` имена на `amq.` зарезервированы, объявление — 403 `ACCESS_REFUSED`. https://github.com/rabbitmq/amqp-0.9.1-spec/blob/main/docs/amqp-0-9-1-reference.md
- `[transient-forbidden]` с 4.3 нельзя объявить очередь, не durable и не exclusive одновременно. https://www.rabbitmq.com/docs/queues
- `[exclusive-queue]` exclusive-очередь доступна только объявившему соединению и удаляется с ним. https://www.rabbitmq.com/docs/queues
- `[auto-delete]` очередь удаляется после ухода последнего потребителя; никогда не имевшая потребителей не удаляется. https://www.rabbitmq.com/docs/queues
- `[exchange-auto-delete]` exchange удаляется при снятии последней привязки; никогда не привязанный остаётся. https://www.rabbitmq.com/docs/exchanges
- `[durable-persistent]` после перезапуска живут durable очереди и persistent сообщения в них; не записанные на диск к моменту сбоя могут пропасть. https://www.rabbitmq.com/docs/queues

Потребители и подтверждения:

- `[ack-multiple]` `multiple` подтверждает все теги до указанного включительно, тег 0 — все. https://www.rabbitmq.com/docs/confirms
- `[unknown-tag-406]` неизвестный или уже подтверждённый тег — 406 «unknown delivery tag». https://www.rabbitmq.com/docs/confirms
- `[requeue-position]` при requeue сообщение возвращается на прежнее место, `redelivered=true`. https://www.rabbitmq.com/docs/confirms
- `[close-requeue]` закрытие канала возвращает неподтверждённые сообщения в очередь; отмена потребителя — нет. https://www.rabbitmq.com/docs/consumers
- `[prefetch-per-consumer]` prefetch действует на каждого потребителя отдельно, 0 — без лимита, для авто-ack окно не применяется. https://www.rabbitmq.com/docs/consumer-prefetch
- `[confirm-after-disk]` номера подтверждений с 1; подтверждение — после приёма всеми очередями, для persistent в durable — после записи на диск. https://www.rabbitmq.com/docs/confirms

TTL, dead-letter, длина, приоритеты:

- `[ttl-min]` при двух TTL действует меньший; при requeue срок сохраняется. https://www.rabbitmq.com/docs/ttl
- `[ttl-head-only]` TTL сообщения истекает только на голове очереди. https://www.rabbitmq.com/docs/ttl
- `[dlx-reasons]` в dead-letter идут `rejected`, `expired`, `maxlen`, `delivery_limit`; без DLX сообщение теряется. https://www.rabbitmq.com/docs/dlx
- `[dlx-routing-key]` ключ берётся из `x-dead-letter-routing-key`, иначе прежние ключи сообщения. https://www.rabbitmq.com/docs/dlx
- `[x-death]` запись на пару {очередь, причина} со счётчиком; `x-first-death-*` не меняется, `x-last-death-*` обновляется; `expiration` уходит в `original-expiration`. https://www.rabbitmq.com/docs/dlx
- `[dl-cycle]` сообщение в цикле dead-letter удаляется, если в цикле не было отклонения. https://www.rabbitmq.com/docs/dlx
- `[overflow]` лимит считает только готовые сообщения: `drop-head`, `reject-publish`; `reject-publish-dlx` не для quorum. https://www.rabbitmq.com/docs/maxlength
- `[priority-clamp]` приоритет выше `x-max-priority` становится максимумом, без приоритета — 0. https://www.rabbitmq.com/docs/priority
- `[delivery-limit]` quorum: лимит доставок, рост `x-delivery-count`, dead-letter `delivery_limit`, возврат в голову. https://www.rabbitmq.com/docs/quorum-queues
- `[quorum-priority]` quorum: приоритеты 0–31, без приоритета — 4, `x-max-priority` игнорируется. https://www.rabbitmq.com/docs/quorum-queues

Доступ:

- `[permission-table]` configure — объявление и удаление; bind — write на очередь и read на exchange; publish — write; get и consume — read. https://www.rabbitmq.com/docs/access-control

Вывод консоли: `rabbitmqadmin` v2 (таблица с рамкой и строкой заголовка, под `--non-interactive` без рамки и без заголовка, переводы строк в ячейках заменены запятыми; флаги `--name`, `--type`, `--durable`, `--arguments` и др.) сверен с исходниками `rabbitmqadmin-ng` (https://github.com/rabbitmq/rabbitmqadmin-ng, `src/cli/mod.rs`, `src/output.rs`) и https://www.rabbitmq.com/docs/management-cli. Набор столбцов `rabbitmqctl list_*` соответствует https://www.rabbitmq.com/docs/man/rabbitmqctl.8.

Итого точных правил: 33.

## Сознательные упрощения

Правила с отметкой «упрощено» (идентификатор в журнале совпадает):

- `[round-robin]` сообщения раздаются по кругу среди потребителей со свободным окном prefetch. Приоритеты потребителей и порядок настоящего брокера не воспроизводятся. https://www.rabbitmq.com/docs/consumers
- `[queue-expires]` `x-expires`: очередь без потребителей и обращений удаляется после простоя, сообщения не уходят в dead-letter. Точность срока (в настоящем брокере не гарантируется) не моделируется. https://www.rabbitmq.com/docs/ttl
- `[alarm-blocks-publishers]` alarm памяти и диска блокирует только публикации, потребители работают. Alarm включается только сбоем сценария (`fault`); порогов `vm_memory_high_watermark` и `disk_free_limit` нет, как нет и состояний соединения `blocking`/`flow`. https://www.rabbitmq.com/docs/alarms

Прочие упрощения:

- **Quorum.** Лимит доставок фиксирован: 20; считается каждый возврат в очередь, а не только неудачная доставка. Политики `delivery-limit` нет.
- **Заголовки.** Консоль не печатает заголовки сообщения. `x-death` и `x-delivery-count` показаны только в теории и в журнале модели.
- **Alternate exchange.** Задаётся только аргументом exchange; политик нет.
- **Привязка headers.** Для заголовочной привязки без сравниваемых аргументов поведение не описано в документации; модель такую привязку не принимает.
- **Права.** Запись в безымянный exchange проходит проверку write для шаблона `""`. `queues list` и `purge` выполняются без проверки прав (в документации требования к `purge` не подтверждены).
- **Коды ошибок.** Часть кодов 404/406 и тишина `unbind` несуществующей привязки не подтверждены документацией; модель следует логике спецификации.
- **Exchange `amq.*`.** Существуют в каждом vhost.
- **Издатель.** Упавший издатель не пересылает неподтверждённые сообщения повторно.
- **`bindings list`.** Нет столбца `arguments`.
- **`rabbitmqctl`.** Не печатает баннеры «Listing…» и «Timeout…» (как с `-q`); столбцы разделены табуляцией, первая строка — заголовок. Заголовок `list_consumers` в документации не описан.
- **Теги доставки.** Номера (delivery tag) ведутся на канал и общие для всех `sim consume` одного пользователя и vhost.
- **Команды `sim`.** Учебные команды `sim consume`, `sim ack`, `sim nack`, `sim reject`, `sim run`, `sim restart` и `sim as USER …` заменяют клиентский код и ход времени; в настоящем RabbitMQ их нет.
- **Пустой ключ topic.** Документация не описывает совпадение пустого ключа с `#` и `*`; модель следует правилу «`#` — ноль слов, `*` — ровно одно» (`#` совпадает с пустым ключом, `*` — нет).
- **`rabbitmqadmin`.** Принимается только синтаксис v2 (`queues declare --name …`); v1 (`name=x`) отвечает подсказкой. Формат значений `--durable true`.

Итого упрощённых правил: 3.

## Чего нет

- Streams: `--type stream` отклоняется (и смещения `x-stream-offset`); о них — теория и вопросы с выбором.
- Политики (`policy`), в том числе `dead-letter-exchange`, `message-ttl`, `max-length`, `alternate-exchange` через политику.
- Global QoS, `prefetch-size`, single active consumer, приоритеты потребителей, таймаут подтверждения (`consumer_timeout`).
- Кластер, зеркалирование, Khepri, федерация и shovel.
- Direct reply-to (`amq.rabbitmq.reply-to`), транзакции AMQP (`tx.*`), `basic.recover`.
- Другие протоколы (AMQP 1.0, MQTT, STOMP), TLS, плагин управления и его HTTP API, теги пользователей.
- Задержки сети и реальные сбои диска: сбои задаёт только сценарий.

# Учебный кластер Kafka

Модель кластера из 3 брокеров в режиме KRaft: темы, разделы, реплики, продюсеры, группы потребителей, консольные утилиты. Адрес документации: `D` = `https://kafka.apache.org/44/`.

## Что совпадает

Журнал и разделы:

- `[offset-monotonic]` смещение назначает лидер раздела, растёт на единицу, не переиспользуется; позиция потребителя — смещение следующей записи. https://kafka.apache.org/44/design/design/
- `[murmur2-vectors]` хеш ключа — murmur2 с seed `0x9747b28c` по байтам UTF-8, `toPositive` — маска `0x7fffffff`; проверено на тестовых векторах `UtilsTest`. https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/common/utils/Utils.java
- `[key-partition]` запись с ключом попадает в раздел `toPositive(murmur2(ключ)) % число_разделов`. https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/common/utils/Utils.java
- `[add-partitions]` число разделов только растёт; после роста ключ может переехать в другой раздел. https://kafka.apache.org/44/getting-started/quickstart/

Группы потребителей:

- `[range-example]` range: разделы каждого топика делятся подряд, первым достаются лишние. https://github.com/apache/kafka/tree/trunk/clients/src/main/java/org/apache/kafka/clients/consumer/RangeAssignor.java
- `[roundrobin-examples]` round-robin: разделы раздаются по кругу, не подписанные на топик участники пропускаются. https://github.com/apache/kafka/tree/trunk/clients/src/main/java/org/apache/kafka/clients/consumer/RoundRobinAssignor.java
- `[eager-revoke-all]` eager-ребаланс: все отдают разделы, перезаходят, лидер группы считает назначение, SyncGroup раздаёт; обратные вызовы внутри `poll`. https://kafka.apache.org/44/operations/consumer-rebalance-protocol/
- `[default-strategy]` по умолчанию `Range, CooperativeSticky`: выбирается первая стратегия, которую знают все участники (range). https://kafka.apache.org/44/configuration/consumer-configs/
- `[lag]` лаг — `LOG-END-OFFSET` (high watermark) минус закоммиченное смещение; без коммита — `-`. https://github.com/apache/kafka/blob/trunk/tools/src/main/java/org/apache/kafka/tools/consumer/group/ConsumerGroupCommand.java
- `[auto-create]` `auto.create.topics.enable=true`: запись или подписка создаёт тему (1 раздел, фактор 1); опечатка в имени рождает новую тему. https://github.com/apache/kafka/blob/trunk/server-common/src/main/java/org/apache/kafka/server/config/ServerLogConfigs.java
- `[auto-commit-in-poll]` авто-коммит срабатывает внутри `poll()` и `close()` раз в 5000 мс, коммитится смещение следующей записи. https://kafka.apache.org/44/configuration/consumer-configs/
- `[offset-reset]` `auto.offset.reset` (по умолчанию `latest`) действует, только если нет коммита или смещение вне диапазона. https://kafka.apache.org/44/configuration/consumer-configs/

Репликация и надёжность:

- `[isr-shrink]` реплика, не догнавшая лидера за 30000 мс, или недоступная выходит из ISR. https://kafka.apache.org/44/design/design/
- `[hw-min-isr]` high watermark — минимум LEO по ISR; пока ISR меньше `min.insync.replicas`, он не растёт; читают только ниже него. https://kafka.apache.org/44/design/design/
- `[acks-loss]` `acks=0` (смещение −1), `acks=1` (потеря при падении лидера), `acks=all` (ждёт high watermark). https://kafka.apache.org/44/design/design/
- `[not-enough-replicas]` `min.insync.replicas` действует при `acks=all`: до записи — ошибка 19, после записи — 20. https://kafka.apache.org/44/configuration/topic-configs/
- `[unclean-election]` при `false` раздел недоступен до возвращения реплики из ISR; при `true` лидером может стать любая, подтверждённые записи могут пропасть. https://kafka.apache.org/44/configuration/topic-configs/
- `[idempotent-dedupe]` PID и номер `seq` на раздел; повтор подтверждается без второй записи; после перезапуска PID новый. https://kafka.apache.org/44/configuration/producer-configs/
- `[retry-reorder]` без идемпотентности и при нескольких запросах в полёте повтор записывается после следующего пакета. https://kafka.apache.org/44/configuration/producer-configs/

Хранение:

- `[closed-segments-only]` retention удаляет только закрытые сегменты, старейшие первыми (по `retention.ms` и `retention.bytes`); активный сегмент не трогают. https://kafka.apache.org/44/configuration/topic-configs/
- `[compaction-last-value]` compact оставляет последнюю запись каждого ключа, смещения не меняются, активный сегмент не чистится. https://kafka.apache.org/44/design/design/
- `[tombstone]` запись с ключом и пустым значением живёт `delete.retention.ms` после чистки. https://kafka.apache.org/44/design/design/

Вывод консоли (по исходникам `tools/`, ветка `trunk`): `Created topic X.`, строки `kafka-topics --describe` (с `Elr: N/A` и `LastKnownElr: N/A`), столбцы `kafka-consumer-groups` (`GROUP TOPIC PARTITION CURRENT-OFFSET LOG-END-OFFSET LAG CONSUMER-ID HOST CLIENT-ID`), `Consumer group 'G' has no active members.`, `Processed a total of N messages`, предупреждения об устаревшем `--property`, `Completed updating config for topic X.`, `Dynamic configs for topic X are:`, подтверждение удаления группы. Свойства форматтера консольного потребителя и разбор строк консольного продюсера (`parse.key`, `key.separator`, `parse.headers`) — как в `ConsoleConsumerOptions`, `LineMessageReader`.

Итого точных правил: 22.

## Сознательные упрощения

Учебные команды `sim run 10s`, `sim crash broker N`, `sim restart broker N`, `sim stall broker N 40s` и `sim consumer start|stop ID` двигают виртуальное время и вызывают сбои; в настоящей Kafka их нет.

Правила с отметкой «упрощено»:

- `[sticky-null]` без ключа продюсер держится одного раздела, пока в него не уйдёт `batch.size` байт, затем берёт случайный (из генератора сценария). Адаптивный выбор (`partitioner.adaptive.partitioning.enable`) не моделируется. https://cwiki.apache.org/confluence/display/KAFKA/KIP-794%3A+Strictly+Uniform+Sticky+Partitioner
- `[sticky-goals]` sticky: сначала баланс (разница не больше 1), затем максимум сохранённых разделов; приближение алгоритма `StickyAssignor`. https://github.com/apache/kafka/tree/trunk/clients/src/main/java/org/apache/kafka/clients/consumer/StickyAssignor.java
- `[coop-two-waves]` cooperative-sticky: перемещаемые разделы сначала отзываются, затем в следующем ребалансе уходят новому владельцу. https://kafka.apache.org/44/operations/consumer-rebalance-protocol/
- `[session-timeout]` исключение по `session.timeout.ms` (45000) и `max.poll.interval.ms` (300000), ожидание новой группы `group.initial.rebalance.delay.ms` (3000); сроки ребаланса упрощены. https://kafka.apache.org/44/configuration/consumer-configs/
- `[metadata-refresh]` потребители узнают о новых разделах через `metadata.max.age.ms` (300000), после чего группа ребалансируется; срок упрощён. https://kafka.apache.org/44/configuration/consumer-configs/
- `[isr-expand]` реплика возвращается в ISR, когда её LEO сравнялся с LEO лидера; условие упрощено. https://kafka.apache.org/44/design/design/
- `[leader-election]` новый лидер — первая живая реплика из ISR в порядке списка реплик; выборы мгновенные, предпочтительный лидер сам не возвращается. https://kafka.apache.org/44/design/design/
- `[placement]` реплики раздела `p` лежат на брокерах `(p+i) mod 3 + 1`, первая — предпочтительный лидер. https://kafka.apache.org/44/getting-started/quickstart/
- `[linger-batch]` пакет раздела уходит, набрав `batch.size` байт или спустя `linger.ms` (по умолчанию 5); настоящая очередь отправки, буфер и `max.in.flight` упрощены. https://kafka.apache.org/44/configuration/producer-configs/

Прочие упрощения:

- **Кластер.** Всегда 3 брокера; любой `--bootstrap-server` принимается.
- **ELR.** Eligible Leader Replicas не моделируются: везде `Elr: N/A`, `LastKnownElr: N/A`.
- **Очистка логов.** Проверка retention — раз в 5 с, очиститель compact — раз в 15 с виртуального времени; `segment.bytes` не меньше 1 MiB.
- **Время записей.** Метки времени идут по виртуальным часам от 2026-01-01T00:00:00Z; печатаются и разбираются как UTC.
- **Консольный потребитель.** Читает тему раздел за разделом, а не вперемешку. `--offset` за концом журнала ничего не печатает (настоящий клиент обработал бы `OFFSET_OUT_OF_RANGE` по `auto.offset.reset`). Вместо ожидания в конце выводится пометка «песочница».
- **Ошибки `kafka-topics`.** Часть строк упрощена: префикс настоящей утилиты (`Error while executing topic command : …`) не подтверждён, модель печатает `Error: Topic 'x' already exists.`. Так же упрощены тексты отказа при уменьшении числа разделов, ошибок параметров (`Missing required argument "[name]"`, `<name> is not a recognized option`) и ошибок групп и конфигураций; настоящие утилиты печатают исключения Java.
- **Стратегии.** Принимаются короткие имена (`range`, `roundrobin`, `sticky`, `cooperative-sticky`); в настоящем Kafka нужны имена классов.
- **Идемпотентность.** `retries=0` вместе с `enable.idempotence=true` принимается (настоящий Kafka отвергает такую конфигурацию).
- **Координатор и конфигурации.** Координатор группы показан как `broker-N:9092 (N)`; `kafka-configs --describe` печатает `synonyms={SOURCE:name=value}` для каждой записи.
- **Продюсер.** Модель продюсера работает на уровне записи и пакета; размер запроса, сжатие и очередь отправки по соединениям не считаются.

Итого упрощённых правил: 9.

## Чего нет

- Транзакции (`transactional.id`, управляющие записи) и `isolation.level=read_committed`, `LSO`.
- Сжатие (`compression.type`: gzip, snappy, lz4, zstd).
- Протокол групп KIP-848 (`group.protocol=consumer`, серверные назначатели); работает классический протокол.
- Статическое членство (`group.instance.id`).
- Kafka Connect, Kafka Streams, Share groups, Schema Registry (он не входит в Apache Kafka): о них — теория и вопросы с выбором.
- Внутреннее устройство KRaft-кворума (выборы контроллера, метаданные); команды `kafka-metadata-quorum`, `kafka-storage`.
- Вывод внутренней темы `__consumer_offsets` и её 50 разделов; координатор группы упрощён (см. выше).
- Квоты, ACL, SASL/SSL, `--bootstrap-controller`, перераспределение реплик (`kafka-reassign-partitions`), `kafka-log-dirs`.
- Реальные сетевые задержки и ошибки диска: сбои (остановка брокера, отставание реплики) задаёт только сценарий.
