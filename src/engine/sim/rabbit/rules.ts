import type { RuleRegistry } from '../rules';

const D = 'https://www.rabbitmq.com/docs/';
const T = 'https://www.rabbitmq.com/tutorials/';
const SPEC = 'https://github.com/rabbitmq/amqp-0.9.1-spec/blob/main/docs/amqp-0-9-1-reference.md';

/** Rules the RabbitMQ model applies; ids appear in journal entries and in test titles as `[id]`. */
export const rabbitRules = {
  'default-exchange': {
    url: `${T}amqp-concepts`,
    ru: 'безымянный exchange — direct; каждая очередь привязана к нему по своему имени, bind и unbind запрещены',
    status: 'exact',
  },
  direct: { url: `${D}exchanges`, ru: 'direct: сообщение уходит в очереди, чей ключ привязки равен ключу маршрутизации', status: 'exact' },
  fanout: { url: `${D}exchanges`, ru: 'fanout: ключ игнорируется, копия уходит во все привязки', status: 'exact' },
  'topic-wildcards': {
    url: `${D}exchanges`,
    ru: 'topic: «*» — ровно одно слово, «#» — ноль и более слов, слова разделены точками',
    status: 'exact',
  },
  'topic-one-copy': { url: `${D}exchanges`, ru: 'topic: очередь получает одну копию, сколько бы её привязок ни подошло', status: 'exact' },
  'headers-match': {
    url: `${T}amqp-concepts`,
    ru: 'headers: any/all не учитывают заголовки x-…, any-with-x/all-with-x учитывают; ключ маршрутизации игнорируется',
    status: 'exact',
  },
  'mandatory-return': {
    url: `${D}publishers`,
    ru: 'без маршрута сообщение отбрасывается; с флагом mandatory издатель получает basic.return 312, и он приходит раньше подтверждения',
    status: 'exact',
  },
  'ae-chain': {
    url: `${D}ae`,
    ru: 'alternate exchange получает сообщение, когда маршрута нет; цепочка идёт до первого маршрута, конца или повтора',
    status: 'exact',
  },
  'redeclare-406': {
    url: `${D}queues`,
    ru: 'повторное объявление с другим типом или атрибутами — ошибка 406 PRECONDITION_FAILED',
    status: 'exact',
  },
  'reserved-name-403': { url: `${SPEC}`, ru: 'имена на «amq.» зарезервированы: объявление — 403 ACCESS_REFUSED', status: 'exact' },
  'unknown-exchange-404': {
    url: `${D}publishers`,
    ru: 'публикация в несуществующий exchange — ошибка 404, канал закрывается',
    status: 'exact',
  },
  'transient-forbidden': {
    url: `${D}queues`,
    ru: 'с версии 4.3 нельзя объявить очередь, которая одновременно не durable и не exclusive',
    status: 'exact',
  },
  'exclusive-queue': {
    url: `${D}queues`,
    ru: 'exclusive-очередь доступна только объявившему её соединению и удаляется вместе с ним',
    status: 'exact',
  },
  'auto-delete': {
    url: `${D}queues`,
    ru: 'auto-delete очередь удаляется после ухода последнего потребителя; очередь без потребителей не удаляется',
    status: 'exact',
  },
  'exchange-auto-delete': {
    url: `${D}exchanges`,
    ru: 'auto-delete exchange удаляется, когда убрана его последняя привязка; никогда не привязанный не удаляется',
    status: 'exact',
  },
  'ack-multiple': {
    url: `${D}confirms`,
    ru: 'ack с multiple подтверждает все выданные теги до указанного включительно; тег 0 с multiple — все',
    status: 'exact',
  },
  'unknown-tag-406': {
    url: `${D}confirms`,
    ru: 'ack, nack или reject неизвестного или уже подтверждённого тега — 406 PRECONDITION_FAILED «unknown delivery tag»',
    status: 'exact',
  },
  'requeue-position': {
    url: `${D}confirms`,
    ru: 'при requeue сообщение возвращается на прежнее место по порядку постановки с redelivered=true',
    status: 'exact',
  },
  'close-requeue': {
    url: `${D}consumers`,
    ru: 'при закрытии канала неподтверждённые сообщения возвращаются в очередь; отмена потребителя их не возвращает',
    status: 'exact',
  },
  'prefetch-per-consumer': {
    url: `${D}consumer-prefetch`,
    ru: 'prefetch действует на каждого потребителя отдельно, 0 — без лимита; для авто-ack окно не применяется',
    status: 'exact',
  },
  'round-robin': {
    url: `${D}consumers`,
    ru: 'сообщения раздаются по кругу среди потребителей, у которых есть свободное окно prefetch',
    status: 'simplified',
  },
  'ttl-min': {
    url: `${D}ttl`,
    ru: 'если заданы TTL очереди и сообщения, действует меньший; при requeue срок сохраняется',
    status: 'exact',
  },
  'ttl-head-only': {
    url: `${D}ttl`,
    ru: 'TTL сообщения истекает только на голове очереди: просроченное сообщение за живым остаётся в очереди',
    status: 'exact',
  },
  'queue-expires': {
    url: `${D}ttl`,
    ru: 'x-expires: очередь без потребителей и обращений удаляется после простоя, сообщения не уходят в dead-letter',
    status: 'simplified',
  },
  'dlx-reasons': {
    url: `${D}dlx`,
    ru: 'в dead-letter идут сообщения по причинам rejected, expired, maxlen, delivery_limit; без DLX сообщение теряется',
    status: 'exact',
  },
  'dlx-routing-key': {
    url: `${D}dlx`,
    ru: 'ключ dead-letter берётся из x-dead-letter-routing-key, а если его нет — прежние ключи сообщения',
    status: 'exact',
  },
  'x-death': {
    url: `${D}dlx`,
    ru: 'заголовок x-death: запись на пару {очередь, причина} со счётчиком; x-first-death-* не меняется, x-last-death-* обновляется; expiration уходит в original-expiration',
    status: 'exact',
  },
  'dl-cycle': {
    url: `${D}dlx`,
    ru: 'сообщение в цикле dead-letter удаляется, если во всём цикле не было отклонения (reject)',
    status: 'exact',
  },
  overflow: {
    url: `${D}maxlength`,
    ru: 'лимит длины считает только готовые сообщения: drop-head отправляет голову в dead-letter, reject-publish отклоняет новое (nack), reject-publish-dlx не для quorum',
    status: 'exact',
  },
  'priority-clamp': {
    url: `${D}priority`,
    ru: 'x-max-priority: приоритет выше максимума становится максимумом, без приоритета — 0; уже выданные сообщения не обгоняются',
    status: 'exact',
  },
  'delivery-limit': {
    url: `${D}quorum-queues`,
    ru: 'quorum: лимит доставок по умолчанию 20; после каждого возврата растёт x-delivery-count, при превышении — dead-letter (delivery_limit); возврат идёт в голову очереди',
    status: 'exact',
  },
  'quorum-priority': {
    url: `${D}quorum-queues`,
    ru: 'quorum: приоритеты 0–31 (строго), без приоритета — 4, x-max-priority игнорируется',
    status: 'exact',
  },
  'confirm-after-disk': {
    url: `${D}confirms`,
    ru: 'номера подтверждений с 1; подтверждение приходит после приёма всеми очередями, а persistent в durable очереди — после записи на диск',
    status: 'exact',
  },
  'durable-persistent': {
    url: `${D}queues`,
    ru: 'после перезапуска живут durable очереди и persistent сообщения в них; не записанные на диск к моменту сбоя могут пропасть',
    status: 'exact',
  },
  'permission-table': {
    url: `${D}access-control`,
    ru: 'configure — объявление и удаление; bind — write на очередь и read на exchange; publish — write; get и consume — read',
    status: 'exact',
  },
  'alarm-blocks-publishers': {
    url: `${D}alarms`,
    ru: 'при alarm публикации блокируются до его снятия, потребители работают',
    status: 'simplified',
  },
} as const satisfies RuleRegistry;

export type RabbitRule = keyof typeof rabbitRules;
