"""The commonly used part of pika (BlockingConnection) for the learning sandbox.

Every call goes to the same RabbitMQ simulator the console uses, through studio_runtime.broker_call. Time is virtual:
waiting for messages advances the simulator's clock, it never sleeps. What is not supported raises
NotImplementedError and names the call.
"""

import enum
import sys
import types
from urllib.parse import unquote, urlparse

from studio_runtime import broker_call

# ---------------------------------------------------------------- exceptions


class AMQPError(Exception):
    pass


class AMQPConnectionError(AMQPError):
    pass


class ConnectionClosed(AMQPConnectionError):
    def __init__(self, reply_code=-1, reply_text=""):
        super().__init__(int(reply_code), str(reply_text))

    @property
    def reply_code(self):
        return self.args[0]

    @property
    def reply_text(self):
        return self.args[1]


class ConnectionClosedByBroker(ConnectionClosed):
    pass


class ConnectionWrongStateError(AMQPConnectionError):
    pass


class ProbableAuthenticationError(AMQPConnectionError):
    pass


class ProbableAccessDeniedError(AMQPConnectionError):
    pass


class AMQPChannelError(AMQPError):
    pass


class ChannelClosed(AMQPChannelError):
    def __init__(self, reply_code=-1, reply_text=""):
        super().__init__(int(reply_code), str(reply_text))

    @property
    def reply_code(self):
        return self.args[0]

    @property
    def reply_text(self):
        return self.args[1]


class ChannelClosedByBroker(ChannelClosed):
    pass


class ChannelWrongStateError(AMQPChannelError):
    pass


class UnroutableError(AMQPChannelError):
    def __init__(self, messages):
        super().__init__(f"{len(messages)} unroutable message(s) returned")
        self.messages = messages


class NackError(AMQPChannelError):
    def __init__(self, messages):
        super().__init__(f"{len(messages)} message(s) NACKed")
        self.messages = messages


class ConsumerCancelled(AMQPChannelError):
    pass


# ---------------------------------------------------------------- values


class DeliveryMode(enum.IntEnum):
    Transient = 1
    Persistent = 2


class PlainCredentials:
    def __init__(self, username, password, erase_on_connect=False):
        self.username = username
        self.password = password
        self.erase_on_connect = erase_on_connect


class ConnectionParameters:
    def __init__(self, host="localhost", port=5672, virtual_host="/", credentials=None, **kwargs):
        self.host = host
        self.port = port
        self.virtual_host = virtual_host
        self.credentials = credentials or PlainCredentials("guest", "guest")
        for name, value in kwargs.items():
            setattr(self, name, value)


class URLParameters(ConnectionParameters):
    def __init__(self, url):
        parsed = urlparse(url)
        vhost = unquote(parsed.path[1:]) if len(parsed.path) > 1 else "/"
        creds = PlainCredentials(unquote(parsed.username or "guest"), unquote(parsed.password or "guest"))
        super().__init__(parsed.hostname or "localhost", parsed.port or 5672, vhost, creds)


class BasicProperties:
    def __init__(self, content_type=None, content_encoding=None, headers=None, delivery_mode=None, priority=None,
                 correlation_id=None, reply_to=None, expiration=None, message_id=None, timestamp=None, type=None,
                 user_id=None, app_id=None, cluster_id=None):
        self.content_type = content_type
        self.content_encoding = content_encoding
        self.headers = headers
        self.delivery_mode = delivery_mode
        self.priority = priority
        self.correlation_id = correlation_id
        self.reply_to = reply_to
        self.expiration = expiration
        self.message_id = message_id
        self.timestamp = timestamp
        self.type = type
        self.user_id = user_id
        self.app_id = app_id
        self.cluster_id = cluster_id

    def __repr__(self):
        shown = ", ".join(f"{k}={v!r}" for k, v in self.__dict__.items() if v is not None)
        return f"<BasicProperties({shown})>"


_PROP_NAMES = {
    "content_type": "contentType",
    "content_encoding": "contentEncoding",
    "delivery_mode": "deliveryMode",
    "priority": "priority",
    "correlation_id": "correlationId",
    "reply_to": "replyTo",
    "expiration": "expiration",
    "message_id": "messageId",
    "timestamp": "timestamp",
    "type": "type",
    "user_id": "userId",
    "app_id": "appId",
}


def _plain(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _props_out(properties):
    if properties is None:
        return {}
    out = {}
    for py, wire in _PROP_NAMES.items():
        value = getattr(properties, py, None)
        if value is not None:
            out[wire] = int(value) if py == "delivery_mode" else _plain(value)
    if properties.headers:
        out["headers"] = _plain(properties.headers)
    return out


def _props_in(delivery):
    props = delivery.get("props") or {}
    values = {py: props.get(wire) for py, wire in _PROP_NAMES.items()}
    return BasicProperties(headers=delivery.get("headers") or None, **values)


class _Method:
    """The method frame of a delivery, a return or a declare reply (attributes as in pika.spec)."""

    def __init__(self, **fields):
        self.__dict__.update(fields)

    def __repr__(self):
        return "<" + ", ".join(f"{k}={v!r}" for k, v in self.__dict__.items()) + ">"


class _Frame:
    def __init__(self, method):
        self.method = method


class ReturnedMessage:
    def __init__(self, method, properties, body):
        self.method = method
        self.properties = properties
        self.body = body


def _body(value):
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).decode("utf-8", "replace")
    if isinstance(value, str):
        return value
    raise TypeError(f"body должно быть bytes или str, а не {type(value).__name__}")


def _unsupported(owner, name):
    raise NotImplementedError(f"{owner}.{name}(): эта возможность pika не поддерживается в учебной песочнице")


# ---------------------------------------------------------------- transport


def _reason(error):
    return f"{error['name']} - {error['text']}"


def _do(op, channel=None, **args):
    reply = broker_call(op, **args)
    if reply["ok"]:
        return reply["value"]
    error = reply["error"]
    if error["name"] in ("SANDBOX_ERROR", "UNSUPPORTED"):
        raise RuntimeError(error["text"])
    if error.get("scope") == "connection":
        if error["code"] == 403:
            raise ProbableAccessDeniedError(_reason(error))
        raise ConnectionClosedByBroker(error["code"], _reason(error))
    if channel is not None:
        channel._closed = True
    raise ChannelClosedByBroker(error["code"], _reason(error))


# ---------------------------------------------------------------- channel


class BlockingChannel:
    def __init__(self, connection, number, wire_id):
        self.connection = connection
        self.channel_number = number
        self._id = wire_id
        self._closed = False
        self._confirm = False
        self._consumers = {}
        self._on_return = None
        self._returns = []
        self._inbox = None

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        _unsupported("channel", name)

    @property
    def is_open(self):
        return not self._closed and self.connection.is_open

    @property
    def is_closed(self):
        return not self.is_open

    def _call(self, op, **args):
        if self._closed:
            raise ChannelWrongStateError("Channel is closed.")
        if not self.connection.is_open:
            raise ChannelWrongStateError("Connection is closed.")
        return _do(op, channel=self, ch=self._id, **args)

    # --- topology

    def exchange_declare(self, exchange, exchange_type="direct", passive=False, durable=False, auto_delete=False,
                         internal=False, arguments=None, **kwargs):
        if internal:
            raise NotImplementedError("channel.exchange_declare(internal=True): внутренние exchange не поддерживаются в песочнице")
        if "type" in kwargs:
            raise TypeError("exchange_declare() получил неизвестный аргумент 'type': в pika 1.x он называется exchange_type")
        self._call("exchange_declare", exchange=exchange, type=exchange_type, passive=passive, durable=durable,
                   auto_delete=auto_delete, arguments=_plain(arguments or {}))
        return _Frame(_Method())

    def exchange_delete(self, exchange=None, if_unused=False):
        self._call("exchange_delete", exchange=exchange or "")
        return _Frame(_Method())

    def exchange_bind(self, destination, source, routing_key="", arguments=None):
        self._call("exchange_bind", destination=destination, source=source, routing_key=routing_key or "", arguments=_plain(arguments or {}))
        return _Frame(_Method())

    def exchange_unbind(self, destination=None, source=None, routing_key="", arguments=None):
        self._call("exchange_unbind", destination=destination or "", source=source or "", routing_key=routing_key or "", arguments=_plain(arguments or {}))
        return _Frame(_Method())

    def queue_declare(self, queue="", passive=False, durable=False, exclusive=False, auto_delete=False, arguments=None):
        value = self._call("queue_declare", queue=queue, passive=passive, durable=durable, exclusive=exclusive,
                           auto_delete=auto_delete, arguments=_plain(arguments or {}))
        return _Frame(_Method(queue=value["queue"], message_count=value["message_count"], consumer_count=value["consumer_count"]))

    def queue_delete(self, queue, if_unused=False, if_empty=False):
        value = self._call("queue_delete", queue=queue, if_unused=if_unused, if_empty=if_empty)
        return _Frame(_Method(message_count=value["message_count"]))

    def queue_purge(self, queue):
        value = self._call("queue_purge", queue=queue)
        return _Frame(_Method(message_count=value["message_count"]))

    def queue_bind(self, queue, exchange, routing_key=None, arguments=None):
        self._call("queue_bind", queue=queue, exchange=exchange, routing_key=routing_key or "", arguments=_plain(arguments or {}))
        return _Frame(_Method())

    def queue_unbind(self, queue, exchange=None, routing_key=None, arguments=None):
        self._call("queue_unbind", queue=queue, exchange=exchange or "", routing_key=routing_key or "", arguments=_plain(arguments or {}))
        return _Frame(_Method())

    # --- publishing

    def confirm_delivery(self):
        self._call("confirm_select")
        self._confirm = True

    def add_on_return_callback(self, callback):
        self._on_return = callback

    def _returned(self, items):
        return [
            ReturnedMessage(
                _Method(reply_code=r["replyCode"], reply_text=r["replyText"], exchange=r["exchange"], routing_key=r["routingKey"]),
                _props_in({"props": r.get("props")}),
                r["body"].encode("utf-8"),
            )
            for r in items
        ]

    def basic_publish(self, exchange, routing_key, body, properties=None, mandatory=False):
        value = self._call("publish", exchange=exchange, routing_key=routing_key, body=_body(body),
                           props=_props_out(properties), mandatory=bool(mandatory))
        returned = self._returned(value["returned"])
        if returned:
            if self._confirm:
                raise UnroutableError(returned)
            self._returns.extend(returned)
        if self._confirm:
            if value["confirmed"] is False:
                raise NackError([ReturnedMessage(_Method(exchange=exchange, routing_key=routing_key), properties, _body(body).encode("utf-8"))])
            if value["confirmed"] is None:
                raise AMQPChannelError("Подтверждение от брокера не пришло")

    def _flush_returns(self):
        pending, self._returns = self._returns, []
        for item in pending:
            if self._on_return is not None:
                self._on_return(self, item.method, item.properties, item.body)

    # --- consuming

    def basic_qos(self, prefetch_size=0, prefetch_count=0, global_qos=False):
        if global_qos:
            raise NotImplementedError("channel.basic_qos(global_qos=True): общий prefetch канала не поддерживается в песочнице")
        self._call("qos", prefetch_count=int(prefetch_count))

    def basic_consume(self, queue, on_message_callback, auto_ack=False, exclusive=False, consumer_tag=None, arguments=None):
        if exclusive or arguments:
            raise NotImplementedError("channel.basic_consume(exclusive=..., arguments=...): эксклюзивные потребители и аргументы не поддерживаются в песочнице")
        value = self._call("consume", queue=queue, auto_ack=bool(auto_ack), consumer_tag=consumer_tag or "")
        tag = value["consumer_tag"]
        self._consumers[tag] = on_message_callback
        return tag

    def basic_cancel(self, consumer_tag):
        if consumer_tag in self._consumers:
            self._call("cancel", consumer_tag=consumer_tag)
            del self._consumers[consumer_tag]

    def basic_get(self, queue, auto_ack=False):
        value = self._call("get", queue=queue, auto_ack=bool(auto_ack))
        d = value["delivery"]
        if d is None:
            return None, None, None
        method = _Method(delivery_tag=d["tag"], redelivered=d["redelivered"], exchange=d["exchange"], routing_key=d["routingKey"], message_count=0)
        return method, _props_in(d), d["body"].encode("utf-8")

    def basic_ack(self, delivery_tag=0, multiple=False):
        self._call("ack", delivery_tag=int(delivery_tag), multiple=bool(multiple))

    def basic_nack(self, delivery_tag=None, multiple=False, requeue=True):
        self._call("nack", delivery_tag=int(delivery_tag or 0), multiple=bool(multiple), requeue=bool(requeue))

    def basic_reject(self, delivery_tag=0, requeue=True):
        self._call("reject", delivery_tag=int(delivery_tag), requeue=bool(requeue))

    def start_consuming(self):
        while self._consumers and not self._closed:
            self.connection._pump(1000)

    def stop_consuming(self, consumer_tag=None):
        for tag in [consumer_tag] if consumer_tag else list(self._consumers):
            if not self._closed:
                self.basic_cancel(tag)

    def consume(self, queue, auto_ack=False, exclusive=False, arguments=None, inactivity_timeout=None):
        """Generator of (method, properties, body); (None, None, None) after inactivity_timeout seconds without messages."""
        inbox = []
        tag = self.basic_consume(queue, lambda ch, method, props, body: inbox.append((method, props, body)), auto_ack=auto_ack,
                                 exclusive=exclusive, arguments=arguments)
        try:
            while True:
                if inbox:
                    yield inbox.pop(0)
                    continue
                self.connection._pump(1000 if inactivity_timeout is None else int(inactivity_timeout * 1000))
                if not inbox and inactivity_timeout is not None:
                    yield None, None, None
        finally:
            if not self._closed:
                self.basic_cancel(tag)

    def _deliver(self, d):
        callback = self._consumers.get(d["consumerTag"])
        if callback is None:
            return
        method = _Method(consumer_tag=d["consumerTag"], delivery_tag=d["tag"], redelivered=d["redelivered"], exchange=d["exchange"], routing_key=d["routingKey"])
        callback(self, method, _props_in(d), d["body"].encode("utf-8"))

    def close(self, reply_code=0, reply_text="Normal shutdown"):
        if self._closed:
            raise ChannelWrongStateError("Channel is already closed.")
        self._flush_returns()
        self._closed = True
        _do("close_channel", ch=self._id)
        self._consumers.clear()


# ---------------------------------------------------------------- connection


class BlockingConnection:
    def __init__(self, parameters=None, **kwargs):
        if isinstance(parameters, (list, tuple)):
            parameters = parameters[0] if parameters else None
        parameters = parameters or ConnectionParameters()
        self._closed = False
        self._channels = {}
        self._next = 1
        self._callbacks = []
        self._now = None
        value = _do("connect", user=parameters.credentials.username, vhost=parameters.virtual_host)
        self._id = value["conn"]

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        _unsupported("connection", name)

    @property
    def is_open(self):
        return not self._closed

    @property
    def is_closed(self):
        return self._closed

    def channel(self, channel_number=None):
        if self._closed:
            raise ConnectionWrongStateError("BlockingConnection is closed.")
        value = _do("channel", conn=self._id)
        number = channel_number or self._next
        self._next = max(self._next, number) + 1
        channel = BlockingChannel(self, number, value["ch"])
        self._channels[value["ch"]] = channel
        return channel

    def _pump(self, wait_ms):
        """Runs what the broker delivered to this connection's channels; waits up to wait_ms (virtual) for something."""
        value = _do("pump", conn=self._id, wait_ms=int(wait_ms))
        elapsed = 0 if self._now is None else value["now"] - self._now
        self._now = value["now"]
        for r in value["returns"]:
            channel = self._channels.get(r["ch"])
            if channel is not None:
                channel._returns.extend(channel._returned([r]))
        for d in value["deliveries"]:
            channel = self._channels.get(d["channel"])
            if channel is not None and not channel._closed:
                channel._deliver(d)
        for channel in list(self._channels.values()):
            channel._flush_returns()
        return elapsed

    def process_data_events(self, time_limit=0):
        callbacks, self._callbacks = self._callbacks, []
        for callback in callbacks:
            callback()
        if time_limit is None:
            while True:
                self._pump(1000)
                if self._closed:
                    return
        self._pump(int(time_limit * 1000))

    def add_callback_threadsafe(self, callback):
        self._callbacks.append(callback)

    def sleep(self, duration):
        """Waits `duration` seconds of virtual time, handling deliveries meanwhile."""
        left = int(duration * 1000)
        self._pump(0)
        while left > 0:
            spent = self._pump(left)
            left -= max(spent, 1)

    def close(self, reply_code=200, reply_text="Normal shutdown"):
        if self._closed:
            raise ConnectionWrongStateError("BlockingConnection is closed.")
        for channel in self._channels.values():
            if not channel._closed:
                channel._flush_returns()
        self._closed = True
        _do("close_connection", conn=self._id)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if not self._closed:
            self.close()


# ---------------------------------------------------------------- module layout


def _submodule(name, **members):
    module = types.ModuleType(f"pika.{name}")
    module.__dict__.update(members)
    sys.modules[f"pika.{name}"] = module
    return module


_here = sys.modules[__name__]
__path__ = []
exceptions = _submodule(
    "exceptions",
    **{n: v for n, v in list(globals().items()) if isinstance(v, type) and issubclass(v, Exception) and v.__module__ == __name__},
)
spec = _submodule("spec", BasicProperties=BasicProperties)
adapters = _submodule("adapters", __path__=[])
_submodule("adapters.blocking_connection", BlockingConnection=BlockingConnection, BlockingChannel=BlockingChannel)
adapters.blocking_connection = sys.modules["pika.adapters.blocking_connection"]
credentials = _submodule("credentials", PlainCredentials=PlainCredentials)
connection = _submodule("connection", ConnectionParameters=ConnectionParameters, URLParameters=URLParameters)

__version__ = "1.3.2"
