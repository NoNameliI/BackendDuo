import type { RuleRegistry } from '../rules';

const D = 'https://kafka.apache.org/44/';
const UTILS = 'https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/common/utils/Utils.java';
const CONSUMER = 'https://github.com/apache/kafka/tree/trunk/clients/src/main/java/org/apache/kafka/clients/consumer';
const KIP794 = 'https://cwiki.apache.org/confluence/display/KAFKA/KIP-794%3A+Strictly+Uniform+Sticky+Partitioner';

/** Rules the Kafka model applies; ids appear in journal entries and in test titles as `[id]`. */
export const kafkaRules = {
  'offset-monotonic': {
    url: `${D}design/design/`,
    ru: 'смещение записи назначает лидер раздела; оно растёт на единицу, не переиспользуется, позиция потребителя — смещение следующей записи',
    status: 'exact',
  },
  'murmur2-vectors': {
    url: UTILS,
    ru: 'хеш ключа — murmur2 с seed 0x9747b28c по байтам UTF-8; toPositive — маска 0x7fffffff, а не abs',
    status: 'exact',
  },
  'key-partition': { url: UTILS, ru: 'запись с ключом попадает в раздел toPositive(murmur2(ключ)) % число_разделов', status: 'exact' },
  'sticky-null': {
    url: KIP794,
    ru: 'без ключа продюсер держится одного раздела, пока в него не уйдёт batch.size байт, затем берёт случайный; адаптивный выбор не моделируется',
    status: 'simplified',
  },
  'add-partitions': {
    url: `${D}getting-started/quickstart/`,
    ru: 'число разделов только растёт; после роста ключ считается по новому числу и может переехать в другой раздел',
    status: 'exact',
  },
  'range-example': { url: `${CONSUMER}/RangeAssignor.java`, ru: 'range: по каждому топику разделы делятся между подписчиками подряд, первым достаются лишние', status: 'exact' },
  'roundrobin-examples': {
    url: `${CONSUMER}/RoundRobinAssignor.java`,
    ru: 'round-robin: все разделы подписанных топиков раздаются по кругу, не подписанные на топик участники пропускаются',
    status: 'exact',
  },
  'sticky-goals': {
    url: `${CONSUMER}/StickyAssignor.java`,
    ru: 'sticky: сначала баланс (разница не больше 1), затем максимум сохранённых разделов; приближение алгоритма',
    status: 'simplified',
  },
  'coop-two-waves': {
    url: `${D}operations/consumer-rebalance-protocol/`,
    ru: 'cooperative-sticky: перемещаемые разделы сначала отзываются у старого владельца и только в следующем ребалансе уходят новому',
    status: 'simplified',
  },
  'eager-revoke-all': {
    url: `${D}operations/consumer-rebalance-protocol/`,
    ru: 'eager-ребаланс: все участники отдают все разделы, перезаходят (JoinGroup), участник-лидер считает назначение, SyncGroup раздаёт его; обратные вызовы идут внутри poll',
    status: 'exact',
  },
  'default-strategy': {
    url: `${D}configuration/consumer-configs/`,
    ru: 'по умолчанию partition.assignment.strategy = Range, CooperativeSticky: выбирается первая стратегия, которую знают все участники (то есть range)',
    status: 'exact',
  },
  'session-timeout': {
    url: `${D}configuration/consumer-configs/`,
    ru: 'участник без heartbeat session.timeout.ms (45000) или без poll max.poll.interval.ms (300000) исключается; новая группа ждёт group.initial.rebalance.delay.ms (3000); сроки ребаланса упрощены',
    status: 'simplified',
  },
  lag: {
    url: 'https://github.com/apache/kafka/blob/trunk/tools/src/main/java/org/apache/kafka/tools/consumer/group/ConsumerGroupCommand.java',
    ru: 'лаг раздела — LOG-END-OFFSET (high watermark: так отвечает ListOffsets latest) минус закоммиченное смещение; без коммита вместо числа «-»',
    status: 'exact',
  },
  'auto-create': {
    url: 'https://github.com/apache/kafka/blob/trunk/server-common/src/main/java/org/apache/kafka/server/config/ServerLogConfigs.java',
    ru: 'auto.create.topics.enable=true по умолчанию: запись или подписка на несуществующий топик создаёт его (1 раздел, фактор репликации 1), поэтому опечатка в имени рождает новый топик; при false — ошибка 3',
    status: 'exact',
  },
  'metadata-refresh': {
    url: `${D}configuration/consumer-configs/`,
    ru: 'потребители узнают о новых разделах при обновлении метаданных (metadata.max.age.ms, 300000), после чего группа ребалансируется; срок упрощён',
    status: 'simplified',
  },
  'auto-commit-in-poll': {
    url: `${D}configuration/consumer-configs/`,
    ru: 'авто-коммит срабатывает внутри poll() и close() раз в auto.commit.interval.ms (5000); коммитится смещение следующей записи',
    status: 'exact',
  },
  'offset-reset': {
    url: `${D}configuration/consumer-configs/`,
    ru: 'auto.offset.reset (по умолчанию latest) применяется только если нет коммита или смещение вне диапазона',
    status: 'exact',
  },
  'isr-shrink': {
    url: `${D}design/design/`,
    ru: 'реплика, не догнавшая лидера за replica.lag.time.max.ms (30000), или недоступная, выходит из ISR',
    status: 'exact',
  },
  'isr-expand': { url: `${D}design/design/`, ru: 'реплика возвращается в ISR, когда её LEO сравнялся с LEO лидера; условие упрощено', status: 'simplified' },
  'hw-min-isr': {
    url: `${D}design/design/`,
    ru: 'high watermark — минимум LEO среди ISR; пока ISR меньше min.insync.replicas, он не растёт; потребители читают только ниже него',
    status: 'exact',
  },
  'acks-loss': {
    url: `${D}design/design/`,
    ru: 'acks=0 не ждёт ответа (смещение −1), acks=1 отвечает после записи на лидере и теряет запись, если лидер упал раньше реплик, acks=all ждёт high watermark',
    status: 'exact',
  },
  'not-enough-replicas': {
    url: `${D}configuration/topic-configs/`,
    ru: 'min.insync.replicas действует только при acks=all: ISR меньше нормы до записи — ошибка 19 (запись не сделана), после записи — 20 (запись в логе есть)',
    status: 'exact',
  },
  'leader-election': {
    url: `${D}design/design/`,
    ru: 'новый лидер — первая живая реплика из ISR в порядке списка реплик; выборы мгновенные, предпочтительный лидер не возвращается сам',
    status: 'simplified',
  },
  'unclean-election': {
    url: `${D}configuration/topic-configs/`,
    ru: 'при unclean.leader.election.enable=false раздел недоступен, пока не вернётся реплика из ISR; при true лидером становится любая реплика, подтверждённые записи могут пропасть',
    status: 'exact',
  },
  placement: { url: `${D}getting-started/quickstart/`, ru: 'реплики раздела p лежат на брокерах (p+i) mod 3 + 1, первая — предпочтительный лидер; упрощённая схема', status: 'simplified' },
  'idempotent-dedupe': {
    url: `${D}configuration/producer-configs/`,
    ru: 'идемпотентный продюсер шлёт PID и номер seq на раздел; брокер подтверждает повтор, не записывая его второй раз; после перезапуска PID новый',
    status: 'exact',
  },
  'retry-reorder': {
    url: `${D}configuration/producer-configs/`,
    ru: 'без идемпотентности и при нескольких запросах в полёте повтор неудачного пакета записывается после следующего: порядок нарушается',
    status: 'exact',
  },
  'linger-batch': {
    url: `${D}configuration/producer-configs/`,
    ru: 'пакет раздела уходит, когда набрал batch.size байт (ключ, значение, заголовки) или прошло linger.ms (по умолчанию 5)',
    status: 'simplified',
  },
  'closed-segments-only': {
    url: `${D}configuration/topic-configs/`,
    ru: 'retention удаляет только закрытые сегменты, старейшие первыми: по самой поздней метке времени сегмента (retention.ms) или пока превышение retention.bytes покрывает весь сегмент; активный сегмент не трогают',
    status: 'exact',
  },
  'compaction-last-value': {
    url: `${D}design/design/`,
    ru: 'compact: остаётся последняя запись каждого ключа, смещения не меняются, активный сегмент не чистится; время работы очистителя упрощено',
    status: 'exact',
  },
  tombstone: {
    url: `${D}design/design/`,
    ru: 'запись с ключом и пустым значением — tombstone: живёт delete.retention.ms после чистки, затем удаляется',
    status: 'exact',
  },
} as const satisfies RuleRegistry;

export type KafkaRule = keyof typeof kafkaRules;
