"""The commonly used part of confluent_kafka (Producer, Consumer, AdminClient) for the learning sandbox.

Every call goes to the same Kafka simulator the console uses, through studio_runtime.broker_call. Time is virtual:
poll(), flush() and sleeping advance the simulator's clock, they never wait. Messages are handed out one at a time,
as librdkafka does. Unflushed messages stay unsent when the program ends. What is not supported raises
NotImplementedError and names the call.
"""

import sys
import types
from concurrent.futures import Future

from studio_runtime import broker_call

OFFSET_BEGINNING = -2
OFFSET_END = -1
OFFSET_STORED = -1000
OFFSET_INVALID = -1001
TIMESTAMP_NOT_AVAILABLE = 0
TIMESTAMP_CREATE_TIME = 1
TIMESTAMP_LOG_APPEND_TIME = 2

# librdkafka spells a few broker errors differently from the protocol's names.
_NAMES = {3: "UNKNOWN_TOPIC_OR_PART", 6: "NOT_LEADER_FOR_PARTITION", 10: "MSG_SIZE_TOO_LARGE", 17: "TOPIC_EXCEPTION"}
_LOCAL = {
    -150: "_FATAL",
    -185: "_TIMED_OUT",
    -186: "_INVALID_ARG",
    -187: "_ALL_BROKERS_DOWN",
    -190: "_UNKNOWN_PARTITION",
    -191: "_PARTITION_EOF",
    -192: "_MSG_TIMED_OUT",
    -195: "_TRANSPORT",
    -188: "_UNKNOWN_TOPIC",
}


class KafkaError:
    _FATAL = -150
    _TIMED_OUT = -185
    _INVALID_ARG = -186
    _ALL_BROKERS_DOWN = -187
    _UNKNOWN_TOPIC = -188
    _UNKNOWN_PARTITION = -190
    _PARTITION_EOF = -191
    _MSG_TIMED_OUT = -192
    _TRANSPORT = -195
    NO_ERROR = 0
    OFFSET_OUT_OF_RANGE = 1
    UNKNOWN_TOPIC_OR_PART = 3
    UNKNOWN_TOPIC_OR_PARTITION = 3
    LEADER_NOT_AVAILABLE = 5
    NOT_LEADER_FOR_PARTITION = 6
    REQUEST_TIMED_OUT = 7
    MSG_SIZE_TOO_LARGE = 10
    NETWORK_EXCEPTION = 13
    TOPIC_EXCEPTION = 17
    NOT_ENOUGH_REPLICAS = 19
    NOT_ENOUGH_REPLICAS_AFTER_APPEND = 20
    ILLEGAL_GENERATION = 22
    INCONSISTENT_GROUP_PROTOCOL = 23
    UNKNOWN_MEMBER_ID = 25
    REBALANCE_IN_PROGRESS = 27
    TOPIC_ALREADY_EXISTS = 36
    INVALID_PARTITIONS = 37
    INVALID_REPLICATION_FACTOR = 38

    def __init__(self, code, reason=None, fatal=False, retriable=False, name=None):
        self._code = int(code)
        self._name = name or _NAMES.get(self._code) or _LOCAL.get(self._code) or ("NO_ERROR" if self._code == 0 else f"ERR_{self._code}")
        self._reason = reason or self._name
        self._fatal = fatal
        self._retriable = retriable

    def code(self):
        return self._code

    def name(self):
        return self._name

    def str(self):
        return self._reason

    def fatal(self):
        return self._fatal

    def retriable(self):
        return self._retriable

    def txn_requires_abort(self):
        return False

    def __str__(self):
        return f'KafkaError{{code={self._name},val={self._code},str="{self._reason}"}}'

    __repr__ = __str__

    def __eq__(self, other):
        return isinstance(other, KafkaError) and other._code == self._code

    def __hash__(self):
        return hash(self._code)


class KafkaException(Exception):
    pass


def _error(e):
    return KafkaError(e["code"], e["text"], name=_NAMES.get(e["code"]) or (e["name"] if e["code"] > 0 else None))


def _do(op, **args):
    reply = broker_call(op, **args)
    if reply["ok"]:
        return reply["value"]
    error = reply["error"]
    if error["name"] in ("SANDBOX_ERROR", "UNSUPPORTED"):
        raise RuntimeError(error["text"])
    raise KafkaException(_error(error))


def _unsupported(owner, name):
    raise NotImplementedError(f"{owner}.{name}(): эта возможность confluent_kafka не поддерживается в учебной песочнице")


def _text(value, what):
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).decode("utf-8", "replace")
    if isinstance(value, str):
        return value
    raise TypeError(f"{what} должно быть bytes, str или None, а не {type(value).__name__}")


def _bytes(value):
    return None if value is None else value.encode("utf-8")


def _conf(conf, kwargs):
    merged = dict(conf or {})
    merged.update(kwargs)
    # Callbacks stay in Python; only plain settings go to the simulator.
    return {str(k): v for k, v in merged.items() if isinstance(v, (str, int, float, bool))}


class TopicPartition:
    def __init__(self, topic, partition=-1, offset=OFFSET_INVALID):
        self.topic = topic
        self.partition = partition
        self.offset = offset
        self.error = None

    def __eq__(self, other):
        return isinstance(other, TopicPartition) and (self.topic, self.partition) == (other.topic, other.partition)

    def __hash__(self):
        return hash((self.topic, self.partition))

    def __repr__(self):
        return f"TopicPartition{{topic={self.topic},partition={self.partition},offset={self.offset},error=None}}"


class Message:
    def __init__(self, topic=None, partition=None, offset=None, key=None, value=None, headers=None, timestamp=0, error=None):
        self._topic = topic
        self._partition = partition
        self._offset = offset
        self._key = key
        self._value = value
        self._headers = headers
        self._timestamp = timestamp
        self._error = error

    def topic(self):
        return self._topic

    def partition(self):
        return self._partition

    def offset(self):
        return self._offset

    def key(self):
        return self._key

    def value(self):
        return self._value

    def headers(self):
        return self._headers

    def timestamp(self):
        return (TIMESTAMP_CREATE_TIME, self._timestamp) if self._error is None else (TIMESTAMP_NOT_AVAILABLE, -1)

    def error(self):
        return self._error

    def latency(self):
        return None

    def leader_epoch(self):
        return None

    def __len__(self):
        return len(self._value) if self._value is not None else 0

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        _unsupported("Message", name)


def _message(m):
    headers = [(k, _bytes(v)) for k, v in m["headers"]] or None
    return Message(m["topic"], m["partition"], m["offset"], _bytes(m["key"]), _bytes(m["value"]), headers, m["timestamp"])


def _ms(timeout):
    return -1 if timeout is None or timeout < 0 else int(timeout * 1000)


# ---------------------------------------------------------------- producer


class Producer:
    def __init__(self, conf=None, **kwargs):
        self._default_callback = (conf or {}).get("on_delivery") or kwargs.get("on_delivery")
        self._id = _do("producer_create", config=_conf(conf, kwargs))["id"]
        self._sent = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        _unsupported("Producer", name)

    def produce(self, topic, value=None, key=None, partition=-1, on_delivery=None, timestamp=0, headers=None, callback=None, **kwargs):
        if kwargs:
            raise TypeError(f"produce() получил неизвестный аргумент {next(iter(kwargs))!r}")
        if headers is not None and not isinstance(headers, (dict, list, tuple)):
            raise TypeError("headers должны быть dict или списком пар")
        pairs = list(headers.items()) if isinstance(headers, dict) else list(headers or [])
        n = _do(
            "produce",
            id=self._id,
            topic=topic,
            key=_text(key, "key"),
            value=_text(value, "value"),
            partition=int(partition),
            timestamp=int(timestamp),
            headers=[[str(k), _text(v, "значение заголовка") or ""] for k, v in pairs],
        )["n"]
        self._sent[n] = (on_delivery or callback or self._default_callback, key, value, pairs)

    def _serve(self, reply):
        for r in reply["reports"]:
            callback, key, value, pairs = self._sent.pop(r["id"], (None, None, None, None))
            err = _error(r["error"]) if r["error"] else None
            offset = r["offset"] if r["offset"] >= 0 else OFFSET_INVALID
            msg = Message(r["topic"], r["partition"], offset, _bytes(_text(key, "key")), _bytes(_text(value, "value")), pairs or None, r["timestamp"], err)
            if callback is not None:
                callback(err, msg)
        return len(reply["reports"])

    def poll(self, timeout=None):
        return self._serve(_do("producer_poll", id=self._id, wait_ms=0 if timeout is None else max(0, _ms(timeout))))

    def flush(self, timeout=-1):
        reply = _do("producer_flush", id=self._id, timeout_ms=_ms(timeout))
        self._serve(reply)
        return reply["left"]

    def __len__(self):
        return _do("producer_len", id=self._id)["left"]


# ---------------------------------------------------------------- consumer


class Consumer:
    def __init__(self, conf=None, **kwargs):
        config = _conf(conf, kwargs)
        self._id = _do("consumer_create", config=config)["id"]
        self._closed = False
        self._buffer = []
        self._on_assign = None
        self._on_revoke = None
        self._held = []

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        _unsupported("Consumer", name)

    def _open(self):
        if self._closed:
            raise RuntimeError("Consumer closed")

    def subscribe(self, topics, on_assign=None, on_revoke=None, on_lost=None):
        self._open()
        if isinstance(topics, str):
            raise TypeError("subscribe() ждёт список тем, а не строку")
        self._on_assign = on_assign
        self._on_revoke = on_revoke
        _do("subscribe", id=self._id, topics=list(topics))

    def unsubscribe(self):
        self._open()
        _do("unsubscribe", id=self._id)

    def assign(self, partitions):
        self._open()
        _do("assign", id=self._id, partitions=[{"topic": p.topic, "partition": p.partition, "offset": p.offset} for p in partitions])

    def unassign(self):
        self._open()
        _do("assign", id=self._id, partitions=[])

    def assignment(self):
        self._open()
        return [TopicPartition(p["topic"], p["partition"]) for p in _do("assignment", id=self._id)["partitions"]]

    def _rebalance_callbacks(self):
        if self._on_assign is None and self._on_revoke is None:
            return
        now = self.assignment()
        gone = [p for p in self._held if p not in now]
        new = [p for p in now if p not in self._held]
        self._held = now
        if gone and self._on_revoke is not None:
            self._on_revoke(self, gone)
        if new and self._on_assign is not None:
            self._on_assign(self, new)

    def _poll_once(self, wait_ms):
        reply = _do("poll", id=self._id, timeout_ms=wait_ms)
        self._rebalance_callbacks()
        if reply["error"]:
            return Message(error=_error(reply["error"]))
        self._buffer.extend(_message(m) for m in reply["messages"])
        return self._buffer.pop(0) if self._buffer else None

    def poll(self, timeout=None):
        self._open()
        if self._buffer:
            return self._buffer.pop(0)
        ms = _ms(timeout)
        if ms >= 0:
            return self._poll_once(ms)
        while True:  # no timeout: wait for a message (the sandbox stops an endless wait at its horizon)
            msg = self._poll_once(1000)
            if msg is not None:
                return msg

    def consume(self, num_messages=1, timeout=-1):
        self._open()
        out = []
        first = self.poll(timeout)
        while first is not None:
            out.append(first)
            if len(out) >= num_messages:
                break
            first = self.poll(0)
        return out

    def commit(self, message=None, offsets=None, asynchronous=True):
        self._open()
        if message is not None and offsets is not None:
            raise ValueError("Укажите либо message, либо offsets")
        if message is not None:
            given = [TopicPartition(message.topic(), message.partition(), message.offset() + 1)]
        else:
            given = offsets
        payload = None if given is None else [{"topic": p.topic, "partition": p.partition, "offset": p.offset} for p in given]
        if payload is None:
            _do("commit", id=self._id)
        else:
            _do("commit", id=self._id, offsets=payload)
        return None if asynchronous else given

    def committed(self, partitions, timeout=None):
        self._open()
        rows = _do("committed", id=self._id, partitions=[{"topic": p.topic, "partition": p.partition} for p in partitions])["partitions"]
        return [TopicPartition(r["topic"], r["partition"], r["offset"]) for r in rows]

    def position(self, partitions):
        self._open()
        rows = _do("position", id=self._id, partitions=[{"topic": p.topic, "partition": p.partition} for p in partitions])["partitions"]
        return [TopicPartition(r["topic"], r["partition"], r["offset"]) for r in rows]

    def seek(self, partition):
        self._open()
        _do("seek", id=self._id, topic=partition.topic, partition=partition.partition, offset=partition.offset)

    def get_watermark_offsets(self, partition, timeout=None, cached=False):
        mark = _do("watermarks", topic=partition.topic, partition=partition.partition)
        return (mark["low"], mark["high"])

    def close(self):
        if not self._closed:
            self._closed = True
            _do("close", id=self._id)


# ---------------------------------------------------------------- admin


class NewTopic:
    def __init__(self, topic, num_partitions=-1, replication_factor=-1, replica_assignment=None, config=None):
        if replica_assignment:
            raise NotImplementedError("NewTopic(replica_assignment=...): ручное размещение реплик не поддерживается в песочнице")
        self.topic = topic
        self.num_partitions = num_partitions
        self.replication_factor = replication_factor
        self.config = config or {}

    def __repr__(self):
        return f"NewTopic(topic={self.topic})"


class PartitionMetadata:
    def __init__(self, id, leader, replicas, isrs):
        self.id = id
        self.leader = leader
        self.replicas = replicas
        self.isrs = isrs
        self.error = None


class TopicMetadata:
    def __init__(self, topic, partitions):
        self.topic = topic
        self.partitions = partitions
        self.error = None


class ClusterMetadata:
    def __init__(self, topics):
        self.cluster_id = "sandbox"
        self.controller_id = 1
        self.topics = topics
        self.brokers = {}
        self.orig_broker_id = 1
        self.orig_broker_name = "localhost:9092/1"


class AdminClient:
    def __init__(self, conf=None, **kwargs):
        self._conf = _conf(conf, kwargs)

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        _unsupported("AdminClient", name)

    def _futures(self, names, results):
        futures = {name: Future() for name in names}
        for r in results:
            f = futures[r["topic"]]
            if r["error"]:
                f.set_exception(KafkaException(_error(r["error"])))
            else:
                f.set_result(None)
        return futures

    def create_topics(self, new_topics, operation_timeout=0, request_timeout=None, validate_only=False):
        if validate_only:
            raise NotImplementedError("AdminClient.create_topics(validate_only=True): не поддерживается в песочнице")
        topics = [{"topic": t.topic, "num_partitions": t.num_partitions, "replication_factor": t.replication_factor, "config": dict(t.config)} for t in new_topics]
        return self._futures([t["topic"] for t in topics], _do("create_topics", topics=topics)["results"])

    def delete_topics(self, topics, operation_timeout=0, request_timeout=None):
        names = list(topics)
        return self._futures(names, _do("delete_topics", topics=names)["results"])

    def list_topics(self, topic=None, timeout=-1):
        topics = {}
        for t in _do("list_topics")["topics"]:
            if topic is not None and t["topic"] != topic:
                continue
            parts = {p["id"]: PartitionMetadata(p["id"], p["leader"], p["replicas"], p["isrs"]) for p in t["partitions"]}
            topics[t["topic"]] = TopicMetadata(t["topic"], parts)
        return ClusterMetadata(topics)

    def poll(self, timeout=0):
        return 0


# ---------------------------------------------------------------- module layout


def version():
    return ("2.14.0", 0x020E0000)


def libversion():
    return ("2.14.0", 0x020E00FF)


__path__ = []
admin = types.ModuleType("confluent_kafka.admin")
admin.AdminClient = AdminClient
admin.NewTopic = NewTopic
admin.ClusterMetadata = ClusterMetadata
admin.TopicMetadata = TopicMetadata
admin.PartitionMetadata = PartitionMetadata
sys.modules["confluent_kafka.admin"] = admin
