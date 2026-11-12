import { useRef, useState } from 'react';
import type { PartitionSnapshot } from '@/engine/sim/kafka';
import type { JournalEntry } from '@/engine/sim/types';
import { DOT_WINDOW_MS, useBroker, type KafkaView } from './brokerStore';
import { GroupLanes } from './GroupLanes';
import { brokerPills, labelRows, layoutPartition, TAPE_H, topicModels, type ReplicaChip, type TapeLayout } from './kafkaLayout';
import { usePrefersReducedMotion } from './PlayerControls';
import { useElementWidth } from './RabbitTopology';

const MONO = { fontFamily: 'var(--font-mono)' } as const;
const ROW_H = 16;
// Opaque tints (not fill-opacity): the numbers drawn over them keep a measurable backdrop.
const TINT_OK = 'color-mix(in srgb, var(--ok) 16%, var(--well))';
const TINT_PENDING = 'color-mix(in srgb, var(--amber) 18%, var(--well))';
const CHIP_TONE: Record<ReplicaChip['role'], string> = {
  leader: 'border-nav text-nav',
  isr: 'border-ok text-ok',
  out: 'border-err border-dashed text-err',
};
const STATUS_TEXT: Record<TapeLayout['status'], string> = { ok: '', underReplicated: 'не все реплики в ISR', offline: 'раздел недоступен' };

/** The leader's log as a tape of offsets: logStart, HW and LEO marks, the part above HW hatched, segment borders. */
export function LogTape({ t }: { t: TapeLayout }) {
  const rows = labelRows(t);
  const top = rows * ROW_H + 4;
  const bottom = top + TAPE_H;
  const showNumbers = t.perOffset && String(t.hi).length * 6.8 <= t.unit - 2;
  const cells: number[] = t.perOffset ? Array.from({ length: t.hi - t.lo }, (_, i) => t.lo + i) : [];
  return (
    <svg role="img" aria-label={t.summary} viewBox={`0 0 ${t.width} ${bottom + 8}`} width={t.width} height={bottom + 8} className="block max-w-full">
      <title>{t.summary}</title>
      <rect x={8} y={top} width={Math.max(0, t.width - 16)} height={TAPE_H} rx={3} fill="var(--well)" stroke="var(--line-strong)" />
      {!t.empty && <rect data-zone="safe" x={t.safe.x} y={top} width={t.safe.w} height={TAPE_H} rx={3} style={{ fill: TINT_OK }} />}
      {!t.empty && t.pending.w > 0 && <rect data-zone="pending" x={t.pending.x} y={top} width={t.pending.w} height={TAPE_H} style={{ fill: TINT_PENDING }} stroke="var(--amber)" strokeDasharray="3 2" />}
      {cells.map((o) => (
        <g key={o}>
          {o > t.lo && <line x1={8 + (o - t.lo) * t.unit} x2={8 + (o - t.lo) * t.unit} y1={top} y2={bottom} stroke="var(--line-strong)" />}
          {showNumbers && (
            <text x={8 + (o - t.lo + 0.5) * t.unit} y={top + TAPE_H / 2} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="var(--fg)" style={MONO}>
              {o}
            </text>
          )}
        </g>
      ))}
      {t.segments.slice(1).map((s) => (
        <line key={`b${s.base}`} data-segment-border={s.base} x1={s.x0} x2={s.x0} y1={top - 3} y2={bottom + 3} stroke="var(--nav)" strokeWidth={2} />
      ))}
      {t.segments.map((s) => (
        <line key={`u${s.base}`} data-segment={s.base} x1={s.x0 + 1} x2={Math.max(s.x0 + 1, s.x1 - 1)} y1={bottom + 5} y2={bottom + 5} stroke={s.removed > 0 ? 'var(--nav)' : 'var(--dim)'} strokeWidth={3} strokeDasharray={s.removed > 0 ? '4 3' : undefined} />
      ))}
      {t.empty && (
        <text x={t.width / 2} y={top + TAPE_H / 2} textAnchor="middle" dominantBaseline="central" fontSize={12} fill="var(--dim)">
          пусто
        </text>
      )}
      {t.marks.map((m) => (
        <g key={m.offset} data-mark={m.kinds.join('+')}>
          <line x1={m.x} x2={m.x} y1={top - (m.lane + 0) * ROW_H - 2} y2={top + TAPE_H} stroke="var(--fg)" strokeWidth={1.5} />
          <text x={m.labelX} y={top - m.lane * ROW_H - 5} textAnchor={m.anchor} fontSize={12} fill="var(--fg)" style={MONO}>
            {m.text}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Chips({ chips }: { chips: ReplicaChip[] }) {
  return (
    <ul className="flex list-none flex-wrap gap-1.5 p-0 text-[12px]" aria-label="Реплики">
      {chips.map((c) => (
        <li key={c.broker} data-replica={c.broker} title={c.text} className={`rounded border px-1.5 py-0.5 font-mono ${CHIP_TONE[c.role]} ${c.up ? '' : 'line-through'}`}>
          {c.text}
        </li>
      ))}
    </ul>
  );
}

const stamp = (ms: number): string => `${(ms / 1000).toFixed(2).replace('.', ',')} с`;

function Details({ t, entries, onMsg }: { t: TapeLayout; entries: readonly JournalEntry[]; onMsg: (msg: string) => void }) {
  const mine = entries.filter((e) => e.subject === t.id).slice(-6);
  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2 text-[12.5px]">
      <p className="text-dim">
        Лидер: {t.leader === null ? 'нет' : `брокер ${t.leader}`}, эпоха {t.epoch}. HW — смещение, ниже которого записи уже на всех репликах ISR и видны потребителям; LEO — следующее смещение лидера.
      </p>
      {t.deleted > 0 && <p className="text-dim">Удалено по retention: смещения 0–{t.deleted - 1}.</p>}
      <div>
        <h4 className="mb-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Сегменты лидера</h4>
        <ul className="list-none space-y-0.5 p-0 font-mono text-[12px]">
          {t.segments.map((s) => (
            <li key={s.base} className="break-words text-fg">
              с {s.base}: {s.records} зап., {s.bytes} Б, {s.closed ? 'закрыт' : 'активный'}
              {s.removed > 0 && <span className="text-nav"> · сжат: убрано {s.removed}</span>}
            </li>
          ))}
        </ul>
      </div>
      {mine.length > 0 && (
        <div>
          <h4 className="mb-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">Последние события раздела</h4>
          <ol className="list-none space-y-0.5 p-0 font-mono text-[12px]">
            {mine.map((e) => (
              <li key={e.seq} className="flex gap-2">
                <time className="w-16 shrink-0 text-right text-dim">{stamp(e.at)}</time>
                {e.msg ? (
                  <button type="button" onClick={() => onMsg(e.msg as string)} className="min-w-0 flex-1 break-words text-left text-fg underline decoration-dotted underline-offset-2 hover:text-nav">
                    {e.text}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 break-words text-fg">{e.text}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function PartitionCard({ p, up, width, open, onToggle, active, reduced, view }: { p: PartitionSnapshot; up: ReadonlySet<number>; width: number; open: boolean; onToggle: () => void; active: boolean; reduced: boolean; view: KafkaView }) {
  const lab = useBroker();
  const t = layoutPartition(p, width, up);
  const status = STATUS_TEXT[t.status];
  return (
    <li data-partition={t.id} data-status={t.status} data-active={active || undefined} className={`rounded border bg-panel p-2 ${active ? 'border-nav' : 'border-line'} ${reduced ? '' : 'transition-colors'}`}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 text-left">
        <span className="break-all font-mono text-[13px] font-semibold text-fg">{t.id}</span>
        <span className="text-[12px] text-dim">
          записей в логе: {t.hi - t.lo} · HW {t.hw} · LEO {t.hi}
        </span>
        {status && <span className={`text-[12px] font-semibold ${t.status === 'offline' ? 'text-err' : 'text-amber'}`}>{status}</span>}
        <span className="ml-auto text-[12px] text-dim">{open ? 'Скрыть' : 'Подробнее'}</span>
      </button>
      <div className="mt-1 overflow-hidden">
        <LogTape t={t} />
      </div>
      <Chips chips={t.replicas} />
      {open && <Details t={t} entries={view.journal} onMsg={(m) => lab.getState().selectMsg(m)} />}
    </li>
  );
}

/** Scheme of a Kafka lab: brokers, every topic with its partition logs, then the consumer groups. */
export function KafkaSchema() {
  const lab = useBroker();
  lab((s) => s.version);
  const status = lab((s) => s.status);
  const reduced = usePrefersReducedMotion();
  const holder = useRef<HTMLDivElement>(null);
  const width = useElementWidth(holder);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const current = status === 'ready' ? lab.getState().view() : null;
  if (current?.flavor !== 'kafka') return <div ref={holder} className="h-full" />;
  const view = current;
  const snap = view.snapshot;
  const up = new Set(snap.brokers.filter((b) => b.up).map((b) => b.id));
  const recent = new Set(view.recent.filter((e) => e.kind === 'append' && e.at >= view.now - DOT_WINDOW_MS).map((e) => e.subject));
  const topics = topicModels(snap);
  const w = Math.max(280, width - 44);
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div ref={holder} role="region" aria-label="Схема кластера Kafka" tabIndex={0} className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-2">
      <ul className="flex list-none flex-wrap gap-1.5 p-0 text-[12.5px]" aria-label="Брокеры">
        {brokerPills(snap).map((b) => (
          <li key={b.id} data-broker={b.id} data-up={b.up} className={`rounded border px-2 py-0.5 font-mono ${b.up ? 'border-ok text-ok' : 'border-err border-dashed text-err'}`}>
            {b.text}
          </li>
        ))}
      </ul>
      {topics.length === 0 && (
        <p className="text-[13px] text-dim">Топиков пока нет. Создайте топик в консоли: kafka-topics.sh --create --topic orders --partitions 3 --bootstrap-server localhost:9092.</p>
      )}
      {topics.map((tm) => {
        const parts = snap.topics.find((x) => x.name === tm.name)?.partitions ?? [];
        return (
          <section key={tm.name} aria-label={`Топик ${tm.name}`} data-topic={tm.name}>
            <h3 className="mb-1 flex flex-wrap items-baseline gap-x-3 text-[13px]">
              <span className="break-all font-mono font-semibold text-fg">{tm.name}</span>
              <span className="text-dim">
                разделов {tm.partitions} · репликация {tm.replicationFactor}
                {tm.underReplicated > 0 && <span className="text-amber"> · недореплицировано {tm.underReplicated}</span>}
                {tm.offline > 0 && <span className="text-err"> · недоступно {tm.offline}</span>}
              </span>
              {tm.configs && <span className="break-all font-mono text-[12px] text-dim">{tm.configs}</span>}
            </h3>
            <ul className="list-none space-y-2 p-0">
              {parts.map((p) => (
                <PartitionCard key={p.partition} p={p} up={up} width={w} view={view} reduced={reduced} open={open.has(`${p.topic}-${p.partition}`)} onToggle={() => toggle(`${p.topic}-${p.partition}`)} active={recent.has(`${p.topic}-${p.partition}`)} />
              ))}
            </ul>
          </section>
        );
      })}
      <GroupLanes groups={snap.groups} />
    </div>
  );
}
