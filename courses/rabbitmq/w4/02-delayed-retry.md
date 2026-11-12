# Повтор с задержкой

Платёжный шлюз на минуту недоступен, и потребитель не смог списать деньги. Бросить сообщение нельзя, повторить прямо сейчас бессмысленно: шлюз всё ещё лежит. Нужен повтор через паузу. В RabbitMQ отдельной команды «повторить через N секунд» для этого нет, но её можно собрать из двух уже известных вещей: срока жизни сообщения и dead-letter exchange из прошлого урока.

### Почему не просто requeue

Напоминание из урока про `ack`, `nack` и `reject`: `requeue=true` возвращает сообщение в очередь сразу. Если ошибка не проходит, потребитель получит то же сообщение снова через миллисекунды, и так бесконечно. Это бесполезная нагрузка на потребителя и на брокер, и никакого счёта попыткам. С `requeue=false` без DLX сообщение пропадёт. Нужен третий путь: отклонить, подождать, вернуть.

### Схема повтора

Нужны два exchange и две очереди.

```text
              сообщение ──► X ──► ОЧЕРЕДЬ ──► потребитель
                                    │ reject (requeue=false)
                                    ▼
                                 X.retry ──► ОЧЕРЕДЬ.retry   (TTL = пауза)
                                                │ срок истёк
                                                ▼
                                                X ──► ОЧЕРЕДЬ
```

- `X` — основной exchange (direct). `ОЧЕРЕДЬ` привязана к нему с ключом `КЛЮЧ`. У неё `x-dead-letter-exchange` = `X.retry`.
- `X.retry` — второй exchange (direct). Очередь `ОЧЕРЕДЬ.retry` привязана к нему с тем же ключом `КЛЮЧ`. У неё `x-message-ttl` = пауза в миллисекундах и `x-dead-letter-exchange` = `X`.
- Потребитель при ошибке отклоняет сообщение с `requeue=false`. Оно уходит в `X.retry`, ждёт в `ОЧЕРЕДЬ.retry` до конца срока, срок истекает, и сообщение через `X` возвращается в `ОЧЕРЕДЬ`.
- `x-dead-letter-routing-key` здесь не нужен: ключ у сообщения сохраняется прежним, и оба раза привязки находят его по нему.
- У очереди повтора нет потребителей. Это «камера хранения», из которой сообщения выходят только по таймеру.

Цикл содержит отклонение, поэтому правило из урока 4.1 его не обрывает: сообщение будет ходить, пока потребитель не обработает его или пока вы не остановите цикл сами.

Пример. Платежи `charges`, пауза две секунды. Отклонение сообщения без потребителя: `get messages` с режимом `reject_requeue_false` (из урока про exchange по умолчанию: читает и отклоняет без возврата).

```broker example
rabbitmqadmin exchanges declare --name pay --type direct --durable true
rabbitmqadmin exchanges declare --name pay.retry --type direct --durable true
rabbitmqadmin queues declare --name charges --type classic --durable true --arguments '{"x-dead-letter-exchange": "pay.retry"}'
rabbitmqadmin queues declare --name charges.retry --type classic --durable true --arguments '{"x-message-ttl": 2000, "x-dead-letter-exchange": "pay"}'
rabbitmqadmin bindings declare --source pay --destination-type queue --destination charges --routing-key charge
rabbitmqadmin bindings declare --source pay.retry --destination-type queue --destination charges.retry --routing-key charge
rabbitmqadmin publish message --exchange pay --routing-key charge --payload "charge 1"
rabbitmqadmin get messages --queue charges --ack-mode reject_requeue_false
rabbitmqadmin queues list --columns name,messages_ready
sim run 1s
rabbitmqadmin queues list --columns name,messages_ready
sim run 1s
rabbitmqadmin queues list --columns name,messages_ready
```

Результат:

```text
declared exchange 'pay' in virtual host '/'
declared exchange 'pay.retry' in virtual host '/'
declared queue 'charges' in virtual host '/'
declared queue 'charges.retry' in virtual host '/'
declared a binding from 'pay' to queue 'charges' with routing key 'charge' in virtual host '/'
declared a binding from 'pay.retry' to queue 'charges.retry' with routing key 'charge' in virtual host '/'
published the message
┌──────────┬─────────────┬─────────────┬───────────────┬──────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload  │
├──────────┼─────────────┼─────────────┼───────────────┼──────────┤
│ pay      │ charge      │ false       │ 8             │ charge 1 │
└──────────┴─────────────┴─────────────┴───────────────┴──────────┘
┌───────────────┬────────────────┐
│ name          │ messages_ready │
├───────────────┼────────────────┤
│ charges       │ 0              │
│ charges.retry │ 1              │
└───────────────┴────────────────┘
[sim] прошло 1000 мс виртуального времени
┌───────────────┬────────────────┐
│ name          │ messages_ready │
├───────────────┼────────────────┤
│ charges       │ 0              │
│ charges.retry │ 1              │
└───────────────┴────────────────┘
[sim] прошло 1000 мс виртуального времени
┌───────────────┬────────────────┐
│ name          │ messages_ready │
├───────────────┼────────────────┤
│ charges       │ 1              │
│ charges.retry │ 0              │
└───────────────┴────────────────┘
```

Сразу после отклонения сообщение лежит в `charges.retry`. Через секунду оно всё ещё там. Через две секунды срок истёк, и сообщение вернулось в `charges`, готовое к новой попытке. Остаётся забрать его и подтвердить:

```broker example
rabbitmqadmin get messages --queue charges --ack-mode ack_requeue_false
rabbitmqadmin queues list --columns name,messages_ready
```

```text
┌──────────┬─────────────┬─────────────┬───────────────┬──────────┐
│ exchange │ routing_key │ redelivered │ payload_bytes │ payload  │
├──────────┼─────────────┼─────────────┼───────────────┼──────────┤
│ pay      │ charge      │ false       │ 8             │ charge 1 │
└──────────┴─────────────┴─────────────┴───────────────┴──────────┘
┌───────────────┬────────────────┐
│ name          │ messages_ready │
├───────────────┼────────────────┤
│ charges       │ 0              │
│ charges.retry │ 0              │
└───────────────┴────────────────┘
```

### Разные паузы: своя очередь на каждую

Хочется повторять сначала через секунду, потом через десять, потом через минуту. Положить разные `expiration` в одну очередь повтора не получится: срок отдельного сообщения проверяется только на голове очереди (урок 4.1). Сообщение с минутной паузой, стоящее первым, задержит все остальные. Поэтому на каждую паузу заводят свою очередь повтора с общим `x-message-ttl`: `charges.retry.1s`, `charges.retry.10s`, `charges.retry.60s`, и потребитель выбирает, в какой из них оказаться.

### Ограничение числа попыток

Цикл бесконечен. Сообщение, которое никогда не обработается («ядовитое»), будет ходить по кругу, пока кто-нибудь не вмешается. Попытки считает заголовок `x-death`: у сообщения, которое умирало в `charges` по причине `rejected`, в записи растёт `count`. Потребитель читает его и сам решает, когда остановиться: после трёх попыток кладёт сообщение в очередь «на разбор» и подтверждает.

```python
def on_message(ch, method, props, body):
    deaths = (props.headers or {}).get("x-death", [])
    attempts = sum(d["count"] for d in deaths
                   if d["queue"] == "charges" and d["reason"] == "rejected")
    try:
        charge(body)
        ch.basic_ack(method.delivery_tag)
    except Exception:
        if attempts >= 3:
            ch.basic_publish("", "charges.parking", body)   # на ручной разбор
            ch.basic_ack(method.delivery_tag)
        else:
            ch.basic_reject(method.delivery_tag, requeue=False)  # на паузу
```

Это пример кода потребителя, песочница его не запускает: её участники-потребители не читают `x-death`. Сценарные задания этого урока поэтому проверяют только схему: все сообщения дошли и все обработаны. Очередь с ядовитыми сообщениями вам встретится в уроке 4.4, где их останавливает quorum-очередь.

### Частые ошибки

- **Ошибка:** повторять через `nack` с `requeue=true`. Ошибка не проходит, сообщение крутится без пауз. **Верно:** `requeue=false` и очередь повтора с TTL.
- **Ошибка:** очередь повтора без `x-dead-letter-exchange` или с DLX, у которого нет привязки с нужным ключом. По истечении срока сообщение пропадает. **Верно:** DLX основного exchange и привязка с тем же ключом, проверить `queues list` после паузы.
- **Ошибка:** положить в очередь повтора сообщения с разными `expiration`. Срок отдельного сообщения проверяется только на голове. **Верно:** `x-message-ttl` на очереди повтора, по очереди на каждую паузу.
- **Ошибка:** не ограничивать число попыток. Ядовитое сообщение ходит вечно. **Верно:** считать `count` в `x-death` и после предела отправлять сообщение на разбор.

### Шпаргалка

- Повтор = очередь повтора с `x-message-ttl` и `x-dead-letter-exchange` = основной exchange.
- Основная очередь: `x-dead-letter-exchange` = exchange повтора. Обе очереди привязаны с одним ключом.
- Потребитель отклоняет с `requeue=false`: `reject` или `nack`.
- Без потребителей у очереди повтора; каждая пауза — своя очередь.
- Цикл с отклонением не обрывается сам: число попыток — по `x-death` `count`.

## task rmq-retry-build

```json
{
  "type": "topology",
  "title": "Схема повтора для SMS",
  "xp": 20,
  "hints": [
    "Раздел «Схема повтора»: два exchange, две очереди, две привязки.",
    "Основная очередь отправляет отклонённые сообщения в exchange повтора. Очередь повтора со сроком возвращает их в основной exchange. Ключ у обеих привязок один.",
    "Шаблон: `rabbitmqadmin queues declare --name … --type classic --durable true --arguments '{\"x-dead-letter-exchange\": \"…\"}'` для основной очереди; для очереди повтора добавьте `\"x-message-ttl\": …`."
  ],
  "check": {}
}
```

Сервис SMS читает очередь `sms.out`. Если отправка не удалась, сообщение должно подождать 5 секунд и вернуться. Постройте схему: durable direct exchange `sms` и `sms.retry`; durable классическая очередь `sms.out`, привязанная к `sms` с ключом `send`, её `x-dead-letter-exchange` равен `sms.retry`; durable классическая очередь `sms.out.retry`, привязанная к `sms.retry` с ключом `send`, со сроком 5000 мс и `x-dead-letter-exchange` `sms`.

```broker starter
rabbitmqadmin exchanges declare --name sms --type direct --durable true
rabbitmqadmin queues declare --name sms.out --type classic --durable true --arguments '{"x-dead-letter-exchange": "…"}'
```

```broker solution
rabbitmqadmin exchanges declare --name sms --type direct --durable true
rabbitmqadmin exchanges declare --name sms.retry --type direct --durable true
rabbitmqadmin queues declare --name sms.out --type classic --durable true --arguments '{"x-dead-letter-exchange": "sms.retry"}'
rabbitmqadmin queues declare --name sms.out.retry --type classic --durable true --arguments '{"x-message-ttl": 5000, "x-dead-letter-exchange": "sms"}'
rabbitmqadmin bindings declare --source sms --destination-type queue --destination sms.out --routing-key send
rabbitmqadmin bindings declare --source sms.retry --destination-type queue --destination sms.out.retry --routing-key send
```

## task rmq-retry-fix

```json
{
  "type": "scenario",
  "title": "Письма пропадают при ошибке отправки",
  "xp": 25,
  "scenario": "w4-retry-mail",
  "hints": [
    "Раздел «Схема повтора»: что должна делать очередь повтора, когда срок истёк.",
    "Основной exchange `mail`, exchange повтора `mail.retry` и очередь `emails` уже есть. Нужна очередь повтора со сроком и `x-dead-letter-exchange`, ведущим назад в `mail`, и её привязка к `mail.retry` с тем же ключом.",
    "Шаблон: `rabbitmqadmin queues declare --name emails.retry --type classic --durable true --arguments '{\"x-message-ttl\": 1000, \"x-dead-letter-exchange\": \"…\"}'`, затем `rabbitmqadmin bindings declare --source … --destination-type queue --destination emails.retry --routing-key …`."
  ],
  "check": {}
}
```

Издатель `shop` публикует в exchange `mail` с ключом `send` шесть писем (`letter 1` … `letter 6`), по десять в секунду. Они попадают в очередь `emails`. Потребитель `mailer` обрабатывает письмо 100 мс и подтверждает вручную, но каждая третья его попытка заканчивается ошибкой, и он отклоняет письмо без возврата. Неудачные письма уходят в exchange `mail.retry`, а очереди за ним нет: письма 3 и 6 теряются.

Добавьте очередь повтора `emails.retry` с паузой 1000 мс и привяжите её так, чтобы письма возвращались в `emails` и `mailer` обработал все шесть к 6000-й миллисекунде.

```broker starter
rabbitmqadmin queues declare --name emails.retry --type classic --durable true --arguments '{"x-message-ttl": 1000}'
rabbitmqadmin bindings declare --source mail.retry --destination-type queue --destination emails.retry --routing-key send
```

```broker solution
rabbitmqadmin queues declare --name emails.retry --type classic --durable true --arguments '{"x-message-ttl": 1000, "x-dead-letter-exchange": "mail"}'
rabbitmqadmin bindings declare --source mail.retry --destination-type queue --destination emails.retry --routing-key send
```

## task rmq-retry-cycle

```json
{
  "type": "choice",
  "title": "Цикл из двух очередей с TTL",
  "xp": 15,
  "hints": [
    "Раздел «Заголовок x-death», последний абзац: когда цикл dead-letter обрывается.",
    "Посмотрите, есть ли в этом цикле отклонение потребителем. Потребителей у очередей нет.",
    "Цикл, в котором ни разу не было `rejected`, брокер распознаёт и сообщение удаляет."
  ],
  "options": [
    "Сообщение будет вечно ходить между `a` и `b`, каждый раз с новой паузой",
    "Сообщение останется в `b`: из неё оно уже никуда не пойдёт",
    "Брокер распознает цикл без отклонений и удалит сообщение",
    "Объявление второй очереди завершится ошибкой: циклы запрещены"
  ],
  "answer": [2],
  "explanation": "Правило из документации: сообщение в цикле dead-letter удаляется, если во всём цикле не было отклонения. Здесь причины только `expired`, потребителей нет, значит и отклонений нет: брокер обрывает цикл, и сообщение теряется. Вариант про вечный круг был бы верен, будь в цикле `rejected`: именно на этом держится схема повтора. Вариант про остановку в `b` неверен: у `b` есть DLX, и при истечении срока сообщение уходит дальше. Циклы объявлять не запрещено, поэтому и последний вариант неверен."
}
```

Очередь `a` объявлена со сроком 1000 мс и `x-dead-letter-exchange` на exchange, ведущий в `b`. Очередь `b` объявлена со сроком 1000 мс и `x-dead-letter-exchange` на exchange, ведущий обратно в `a`. Потребителей у обеих нет. В `a` попадает одно сообщение. Что произойдёт?

## task rmq-retry-review

```json
{
  "type": "review",
  "title": "Повтор без пауз",
  "xp": 20,
  "hints": [
    "Разделы «Почему не просто requeue» и «Схема повтора».",
    "Посмотрите на обработчик ошибки: куда он возвращает сообщение и через какое время оно придёт снова.",
    "Смотрите на строку с `requeue=True`."
  ],
  "code": "def on_message(ch, method, props, body):\n    try:\n        charge(body)\n        ch.basic_ack(method.delivery_tag)\n    except GatewayDown:\n        ch.basic_nack(method.delivery_tag, requeue=True)",
  "codeLanguage": "python",
  "lines": [6],
  "options": [
    "Платёж вернётся в очередь сразу и будет приходить снова и снова без пауз, пока шлюз лежит",
    "Платёж будет потерян, потому что `nack` всегда удаляет сообщение",
    "Платёж уйдёт в dead-letter exchange, хотя он не настроен",
    "Ошибка в строке 4: `basic_ack` нужно вызывать до `charge`"
  ],
  "answer": [0],
  "explanation": "`requeue=True` возвращает сообщение в очередь немедленно, и потребитель получает его снова через мгновения. Пока шлюз недоступен, это бесконечный цикл с нагрузкой на потребителя и на брокер, без пауз и без счёта попыток. Правильно отклонять с `requeue=False` и настроить очередь повтора с TTL. Вариант про потерю ошибочен: при `requeue=True` сообщение не теряется. Вариант про dead-letter неверен: возврат в очередь не меняет exchange. Подтверждать до обработки нельзя: при падении сообщение будет потеряно, а порядок в коде как раз верный."
}
```

Обработчик платежей работает с шлюзом, который иногда лежит по несколько минут. Что произойдёт при его недоступности и что в коде нужно изменить?
