# WebSocket и брокеры сообщений

Команда делает чат поддержки для сервиса бронирования: оператор и клиент должны видеть сообщения друг друга сразу, без обновления страницы. Обычные запросы здесь неудобны: клиент вынужден спрашивать «есть новое?» каждую секунду. **WebSocket** устроен иначе: соединение открывается один раз и остаётся открытым, а данные идут в обе стороны, когда нужно. Когда сообщения должны дойти до нескольких серверов или пережить сбой, в дело вступают брокеры. Урок разбирает и то и другое.

Сразу об ограничении студии: здесь можно отправлять только обычные запросы «запрос — ответ». Открытое соединение WebSocket студия не держит, поэтому код ниже не запускается, а задания урока устроены иначе: это проверка кода по правилам и разбор. Это честное ограничение студии, а не особенность FastAPI.

### Маршрут WebSocket

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect


@app.websocket("/ws/{имя}")
async def обработчик(websocket: WebSocket, имя: str):
    await websocket.accept()
    try:
        while True:
            текст = await websocket.receive_text()
            await websocket.send_text(f"получено: {текст}")
    except WebSocketDisconnect:
        ...
```

- `@app.websocket("/путь")` — маршрут WebSocket вместо `@app.get`. Параметры пути, параметры запроса и зависимости (`Depends`) работают как в обычных маршрутах;
- `websocket: WebSocket` — объект соединения, его подставляет FastAPI;
- `await websocket.accept()` — принять соединение. До этого вызова обмен невозможен: клиент ждёт рукопожатия. Это всегда первое действие;
- `await websocket.receive_text()` — дождаться сообщения от клиента (есть ещё `receive_json()` и `receive_bytes()`);
- `await websocket.send_text(...)` — отправить клиенту сообщение (`send_json(...)`, `send_bytes(...)`);
- `while True` — обработчик живёт, пока соединение открыто: принял сообщение — ответил — ждёт следующее;
- `WebSocketDisconnect` — исключение из `fastapi`: возникает в `receive_*`, когда клиент закрыл соединение (при отправке на закрытое соединение тоже возможна ошибка). Его нужно перехватить: это обычное завершение, а не авария;
- закрыть соединение самому — `await websocket.close(code=1000)`. Код `1000` означает нормальное завершение, `1008` — нарушение правил (например, плохой токен).

Для настоящего сервера нужна библиотека `websockets` (она входит в набор `fastapi[standard]`). В студии её нет и не нужна.

Отказать в доступе нельзя через `HTTPException`: он рассчитан на HTTP-ответ. В WebSocket используют `raise WebSocketException(code=1008)` (из `fastapi`) или `await websocket.close(code=1008)`. Браузер не умеет добавлять к WebSocket собственные заголовки, поэтому токен чаще передают параметром запроса (`/ws?token=...`) или в cookie.

### Менеджер подключений

Чату нужно рассылать сообщение всем. Для этого соединения хранят в одном месте: небольшом классе-менеджере.

```python
class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.active.remove(websocket)

    async def broadcast(self, text: str) -> None:
        for connection in list(self.active):
            await connection.send_text(text)


manager = ConnectionManager()


@app.websocket("/ws/{nickname}")
async def chat(websocket: WebSocket, nickname: str):
    await manager.connect(websocket)
    await manager.broadcast(f"{nickname} joined")
    try:
        while True:
            text = await websocket.receive_text()
            await manager.broadcast(f"{nickname}: {text}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(f"{nickname} left")
```

- `self.active` — список открытых соединений; объект `manager` создаётся один раз на процесс;
- `connect` принимает соединение и запоминает его;
- `disconnect` убирает соединение из списка. Без этого в списке копятся «мёртвые» соединения, а отправка на них вызывает ошибку;
- `broadcast` проходит по копии списка (`list(self.active)`): пока `await` ждёт отправку, список может измениться из-за другого соединения, и обход самого списка стал бы небезопасным;
- обработчик `chat` вызывает `connect`, объявляет о входе, в цикле читает и рассылает сообщения, а при `WebSocketDisconnect` убирает соединение и сообщает об уходе.

Менеджер живёт в памяти одного процесса. Это главное ограничение: если сервис запущен в двух процессах (два воркера, два сервера), соединения клиентов разделены между ними, и `broadcast` в первом процессе не достанет до клиентов второго. Чтобы сообщение дошло до всех, процессы обмениваются им через общий посредник, брокер сообщений: каждый процесс публикует сообщения туда и получает чужие, а затем рассылает своим клиентам. Схема описана в разделе про брокеры ниже.

### Почему проверки здесь без WebSocket

Скрытые запросы заданий студии — обычные запросы с ответом, а WebSocket диалоговый: после рукопожатия обе стороны обмениваются сообщениями неопределённое время. Простой запрос такое не воспроизводит. В настоящем проекте для этого используют `TestClient` из FastAPI: его метод `client.websocket_connect("/ws/ann")` открывает соединение внутри теста, и тест отправляет и читает сообщения. Эти тесты запускаются библиотекой `pytest` (мир 7), а не скрытыми запросами. Поэтому здесь ваш WebSocket-код проверяет разбор самого кода по правилам: принято ли соединение, обработан ли уход клиента, убирается ли соединение из списка. Само поведение вы проверяете глазами и разбором.

### Брокеры: зачем нужны сервису

До сих пор «фоновая работа» жила внутри процесса. Брокер сообщений — отдельный сервис, который принимает сообщения от одних программ и передаёт другим, храня их, пока получатель не заберёт. Для сервиса бронирования полезны две идеи.

**Очередь задач.** Обработчик не делает тяжёлую работу сам, а кладёт описание задачи в очередь брокера: «отправить письмо», «собрать отчёт». Отдельные процессы-исполнители (воркеры) забирают задачи по одной, выполняют, подтверждают выполнение (`ack`), а при сбое задача возвращается и повторяется. Задача не теряется, даже если сервер с API перезапустился. Это решение для случаев, где `BackgroundTasks` недостаточно (урок о фоновых задачах).

**Outbox («исходящий ящик»).** Типичная беда: заказ записан в базу, а сообщение «заказ создан» брокеру отправить не удалось, или наоборот. Два разных хранилища одним действием не изменить. Приём outbox:

1. В одной транзакции база записывает и заказ, и строку-событие в служебную таблицу `outbox`: либо обе записи, либо ни одной.
2. Отдельный процесс читает неотправленные строки таблицы и публикует их в брокер, отмечая отправленными.
3. Если отправка не удалась, строка остаётся и будет отправлена снова. Поэтому одно событие может прийти дважды, и получатель обязан спокойно относиться к повтору (идемпотентность).

Реальных брокеров в студии нет, и эти приёмы здесь не запускаются. Подробно они разобраны в других курсах платформы: курс «RabbitMQ» (очереди, подтверждения, повторы, урок «Outbox и saga») и курс «Apache Kafka» (журнал событий, группы потребителей), а выбор между ними — в курсе «Kafka или RabbitMQ».

### Частые ошибки

- Нет `accept`. Неверно: сразу `receive_text()`. Верно: `await websocket.accept()` первым действием.
- Уход клиента не обработан. Неверно: цикл `while True` без `try` / `except WebSocketDisconnect`: обработчик падает с ошибкой, соединение остаётся в списке. Верно: перехватить исключение и убрать соединение.
- `HTTPException` в WebSocket. Неверно: `raise HTTPException(401)`. Верно: `WebSocketException(code=1008)` или `close(code=1008)`.
- Рассылка по общему списку. Неверно: `for c in self.active:` при `await` внутри цикла. Верно: `for c in list(self.active):`.
- Менеджер в памяти при нескольких процессах. Неверно: ожидать, что `broadcast` достанет до клиентов другого воркера. Верно: общий посредник (брокер).

### Шпаргалка

- `@app.websocket("/ws")`, параметр `websocket: WebSocket`, первым — `await websocket.accept()`.
- `receive_text` / `receive_json`, `send_text` / `send_json`, `close(code=…)`.
- `except WebSocketDisconnect` — клиент ушёл; отказ — `WebSocketException(code=1008)`.
- Менеджер: `connect` (accept + добавить), `disconnect` (убрать), `broadcast` (обход копии списка).
- Менеджер живёт в памяти процесса; для нескольких процессов нужен брокер.
- В студии WebSocket не запускается; настоящая проверка — `TestClient.websocket_connect` в pytest.
- Очередь задач: не терять и повторять работу. Outbox: запись события в той же транзакции, публикация отдельным процессом, получатель терпит повтор.

## task fa-ws-manager

```json
{
  "type": "static",
  "title": "Чат: менеджер подключений",
  "xp": 20,
  "hints": [
    "Разделы «Маршрут WebSocket» и «Менеджер подключений»: `accept`, добавление и удаление в списке, `send_text`, `receive_text` и `except WebSocketDisconnect`.",
    "`connect` принимает соединение и добавляет его в `self.active`; `disconnect` убирает; `broadcast` отправляет текст каждому. В обработчике цикл чтения оберните в `try` / `except WebSocketDisconnect`, а в `except` уберите соединение и сообщите об уходе.",
    "Шаблон: `await websocket.accept()` и `self.active.append(websocket)`; `self.active.remove(websocket)`; `for connection in list(self.active): await connection.send_text(text)`; `text = await websocket.receive_text()` внутри `while True`."
  ],
  "check": {
    "static": [
      { "rule": "pattern", "regex": "await\\s+websocket\\.accept\\(\\)", "message": "Соединение нужно принять: await websocket.accept() в connect." },
      { "rule": "pattern", "regex": "self\\.active\\.append\\(", "message": "connect должен добавлять соединение в self.active." },
      { "rule": "pattern", "regex": "self\\.active\\.remove\\(", "message": "disconnect должен убирать соединение из self.active." },
      { "rule": "pattern", "regex": "send_text\\(", "message": "broadcast должен отправлять текст каждому соединению через send_text." },
      { "rule": "pattern", "regex": "receive_text\\(", "message": "Обработчик должен читать сообщения клиента через receive_text." },
      { "rule": "pattern", "regex": "except\\s+WebSocketDisconnect", "message": "Уход клиента нужно перехватить: except WebSocketDisconnect." },
      { "rule": "no-blocking-in-async", "message": "В async def нельзя вызывать блокирующие функции." }
    ]
  },
  "wrong": {
    "no-accept": "соединение не принимается: клиент так и не получит рукопожатие",
    "no-catch": "уход клиента не перехвачен: обработчик падает, соединение остаётся в списке",
    "no-remove": "`disconnect` ничего не убирает: в списке копятся мёртвые соединения"
  }
}
```

Допишите чат поддержки. `ConnectionManager` хранит открытые соединения в списке `active`. Нужно реализовать:

- `connect(websocket)` — принять соединение и добавить его в список;
- `disconnect(websocket)` — убрать соединение из списка;
- `broadcast(text)` — отправить текст всем открытым соединениям;
- маршрут `/ws/{nickname}`: подключить клиента, разослать `"<nickname> joined"`, затем в цикле читать сообщения и рассылать `"<nickname>: <текст>"`, а при уходе клиента убрать соединение и разослать `"<nickname> left"`.

WebSocket в студии не запускается, поэтому проверка разбирает код, не выполняя его: ищет `accept`, добавление и удаление соединения, `send_text`, `receive_text` и обработку `WebSocketDisconnect`.

```python starter
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="Support chat")


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        ...

    def disconnect(self, websocket: WebSocket) -> None:
        ...

    async def broadcast(self, text: str) -> None:
        ...


manager = ConnectionManager()


@app.websocket("/ws/{nickname}")
async def chat(websocket: WebSocket, nickname: str):
    ...
```

```python solution
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="Support chat")


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.active.remove(websocket)

    async def broadcast(self, text: str) -> None:
        for connection in list(self.active):
            await connection.send_text(text)


manager = ConnectionManager()


@app.websocket("/ws/{nickname}")
async def chat(websocket: WebSocket, nickname: str):
    await manager.connect(websocket)
    await manager.broadcast(f"{nickname} joined")
    try:
        while True:
            text = await websocket.receive_text()
            await manager.broadcast(f"{nickname}: {text}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(f"{nickname} left")
```

```python wrong id=no-accept
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="Support chat")


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.active.remove(websocket)

    async def broadcast(self, text: str) -> None:
        for connection in list(self.active):
            await connection.send_text(text)


manager = ConnectionManager()


@app.websocket("/ws/{nickname}")
async def chat(websocket: WebSocket, nickname: str):
    await manager.connect(websocket)
    await manager.broadcast(f"{nickname} joined")
    try:
        while True:
            text = await websocket.receive_text()
            await manager.broadcast(f"{nickname}: {text}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(f"{nickname} left")
```

```python wrong id=no-catch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="Support chat")


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.active.remove(websocket)

    async def broadcast(self, text: str) -> None:
        for connection in list(self.active):
            await connection.send_text(text)


manager = ConnectionManager()


@app.websocket("/ws/{nickname}")
async def chat(websocket: WebSocket, nickname: str):
    await manager.connect(websocket)
    await manager.broadcast(f"{nickname} joined")
    while True:
        text = await websocket.receive_text()
        await manager.broadcast(f"{nickname}: {text}")
```

```python wrong id=no-remove
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI(title="Support chat")


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        pass

    async def broadcast(self, text: str) -> None:
        for connection in list(self.active):
            await connection.send_text(text)


manager = ConnectionManager()


@app.websocket("/ws/{nickname}")
async def chat(websocket: WebSocket, nickname: str):
    await manager.connect(websocket)
    await manager.broadcast(f"{nickname} joined")
    try:
        while True:
            text = await websocket.receive_text()
            await manager.broadcast(f"{nickname}: {text}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(f"{nickname} left")
```

## task fa-ws-review

```json
{
  "type": "review",
  "title": "Найдите ошибки в обработчике чата",
  "xp": 20,
  "lines": [10, 11, 18],
  "hints": [
    "Разделы «Маршрут WebSocket» и «Частые ошибки»: что идёт первым, как отказывают в доступе и что делают при уходе клиента.",
    "В коде три настоящие проблемы: способ отказа при плохом токене, порядок действий после проверки токена и обработка ухода клиента. Остальные варианты описывают то, что сделано правильно.",
    "Верные варианты: нет `await websocket.accept()`, `HTTPException` не подходит для WebSocket, отключившийся клиент остаётся в `clients`. `while True` и `async def` в WebSocket-обработчике как раз правильные."
  ],
  "options": [
    "После проверки токена нет `await websocket.accept()`: соединение не принято, а клиент добавлен в рассылку",
    "Отказ через `HTTPException` не подходит для WebSocket: нужно закрыть соединение с кодом (`WebSocketException(code=1008)` или `close`)",
    "При уходе клиента он остаётся в списке `clients`: следующая рассылка попадёт на закрытое соединение",
    "Цикл `while True` с `receive_text` блокирует сервер: между чтениями нужен `time.sleep`",
    "WebSocket-обработчик нельзя объявлять через `async def`: нужен обычный `def`"
  ],
  "answer": [0, 1, 2],
  "explanation": "Три проблемы. Первая: без `await websocket.accept()` рукопожатие не завершено, чтение и отправка невозможны. Вторая: `HTTPException` рассчитан на HTTP-ответ, для отказа в WebSocket закрывают соединение с кодом `1008` (`close(code=1008)` или `raise WebSocketException(code=1008)`). Третья: `except WebSocketDisconnect: pass` не убирает клиента из `clients`, и рассылка по мёртвому соединению упадёт. Четвёртый вариант неверен: `await receive_text()` сам отдаёт управление, пока сообщения нет, а `time.sleep` как раз заблокировал бы цикл событий. Пятый тоже неверен: обработчики WebSocket пишут через `async def`, иначе нельзя использовать `await`."
}
```

Ниже обработчик чата для канала с общим токеном. Какие замечания к коду верны? Выберите все верные.

```python code
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect

app = FastAPI()
clients: list[WebSocket] = []


@app.websocket("/ws")
async def chat(websocket: WebSocket, token: str | None = None):
    if token != "room-key-17":
        raise HTTPException(status_code=401, detail="Bad token")
    clients.append(websocket)
    try:
        while True:
            text = await websocket.receive_text()
            for client in clients:
                await client.send_text(text)
    except WebSocketDisconnect:
        pass
```

## task fa-ws-workers

```json
{
  "type": "choice",
  "title": "Чат на двух воркерах",
  "hints": [
    "Раздел «Менеджер подключений»: менеджер живёт в памяти одного процесса.",
    "Клиенты `ann` и `bob` подключены к разным процессам. `broadcast` в одном процессе отправляет только своим соединениям.",
    "Нужен общий посредник между процессами. Больший список, `asyncio.gather` или перезапуск воркера процессы не связывают."
  ],
  "options": [
    "Каждый процесс публикует сообщение в общий брокер и подписан на него: получив чужое сообщение, рассылает его своим клиентам",
    "Увеличить список `active` в менеджере: тогда в нём поместятся клиенты обоих процессов",
    "Заменить цикл `for` в `broadcast` на `asyncio.gather`: рассылка станет «общей» для процессов",
    "Хранить менеджер в глобальной переменной модуля: она общая для всех воркеров"
  ],
  "answer": [0],
  "explanation": "Каждый воркер — отдельный процесс со своей памятью, поэтому менеджер у каждого свой, а соединения не передаются между процессами. Решение — общий посредник: брокер сообщений (например, Redis pub/sub, RabbitMQ или Kafka), через который процессы обмениваются сообщениями. Размер списка ничего не меняет: в нём лежат только свои соединения. `asyncio.gather` ускоряет рассылку внутри процесса, но не связывает процессы. Глобальная переменная модуля общая лишь в пределах одного процесса."
}
```

Сервис чата запущен в двух процессах (воркерах). Клиент `ann` подключён к первому, клиент `bob` — ко второму. Менеджер подключений у каждого процесса свой, и `bob` не видит сообщений `ann`. Какое решение исправит ситуацию?

## task fa-outbox-choice

```json
{
  "type": "choice",
  "title": "Зачем нужен outbox",
  "hints": [
    "Раздел «Брокеры: зачем нужны сервису»: приём outbox.",
    "Проблема в том, что заказ в базе и сообщение в брокере записываются двумя отдельными действиями, и между ними может случиться сбой.",
    "Верное решение записывает заказ и событие в одной транзакции, а отправляет событие отдельный процесс. Из-за повторных отправок получатель должен терпеть дубли."
  ],
  "options": [
    "Событие пишется в таблицу `outbox` в той же транзакции, что и заказ; отдельный процесс публикует неотправленные строки в брокер",
    "Сообщение отправляется в брокер до записи заказа в базу: если заказ не сохранится, получатель просто его проигнорирует",
    "Сообщение отправляется в брокер после `commit`; если отправка не удалась, ошибку игнорируют",
    "Получатель событий должен спокойно относиться к повторной доставке одного и того же события"
  ],
  "answer": [0, 3],
  "explanation": "Outbox делает запись заказа и события одним атомарным действием базы: либо есть и то и другое, либо ничего. Публикует событие отдельный процесс, и после сбоя он отправит строку снова, поэтому у события возможны дубли и получатель должен быть к ним готов (четвёртый вариант). Второй вариант оставляет брокеру события о заказах, которых нет. Третий теряет событие: заказ сохранён, а уведомления о нём нет, и об этом никто не узнает."
}
```

Заказ записан в базу, но сообщение о нём в брокер не ушло из-за сбоя сети. Что верно про приём outbox? Выберите все верные утверждения.
