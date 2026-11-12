import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { JournalEntry } from '@/engine/sim/types';
import { DOT_WINDOW_MS, useBroker, type RabbitView } from './brokerStore';
import { NODE_DRAW_R } from './labels';
import { usePrefersReducedMotion } from './PlayerControls';
import { layoutTopology, topologyInputOf, topologyOf, vname, type LNode, type NodeRole } from './rabbitLayout';

/** Width of an element, tracked with a ResizeObserver; `fallback` until the first measure (and where there is no observer). */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback = 720): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setWidth(Math.max(1, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

const ROLE_TITLE: Record<NodeRole, string> = { producer: 'Издатель', exchange: 'Exchange', queue: 'Очередь', consumer: 'Потребитель' };
const GLYPH: Record<string, string> = { direct: 'D', fanout: 'F', topic: 'T', headers: 'H' };
const FULL_QUEUE = 100;
const MONO = { fontFamily: 'var(--font-mono)' } as const;

type Tone = 'ok' | 'amber' | 'err' | 'nav' | 'fg' | 'faint';
const COLOR: Record<Tone, string> = { ok: 'var(--ok)', amber: 'var(--amber)', err: 'var(--err)', nav: 'var(--nav)', fg: 'var(--fg)', faint: 'var(--faint)' };

const count = (n: number) => (n > 999 ? '999+' : String(n));

interface Look {
  tone: Tone;
  dashed: boolean;
  /** Short text inside the node. */
  mark: string;
  /** Full state for the tooltip and the screen reader. */
  state: string;
}

function lookOf(node: LNode, view: RabbitView): Look {
  const snap = view.snapshot;
  if (node.role === 'queue') {
    const q = snap.vhosts.flatMap((v) => v.queues.map((x) => ({ ...x, label: vname(v.name, x.name) }))).find((x) => x.label === node.label);
    const ready = q?.ready ?? 0;
    const unacked = q?.unacked ?? 0;
    const tone: Tone = !view.up ? 'faint' : ready >= FULL_QUEUE ? 'err' : ready > 0 || unacked > 0 ? 'amber' : 'ok';
    return { tone, dashed: !view.up, mark: count(ready), state: `готово к выдаче ${ready}, без подтверждения ${unacked}, потребителей ${q?.consumers ?? 0}` };
  }
  if (node.role === 'exchange') {
    return { tone: 'amber', dashed: false, mark: GLYPH[node.type ?? ''] ?? '?', state: `тип ${node.type ?? '?'}` };
  }
  const counts = view.counts.get(node.label);
  if (node.role === 'producer') {
    const n = counts?.published ?? 0;
    return { tone: 'nav', dashed: false, mark: count(n), state: `опубликовано ${n}` };
  }
  const alive = view.consumers.some((c) => (c.actor ?? c.tag) === node.label);
  const n = counts?.processed ?? 0;
  return { tone: alive ? 'ok' : 'err', dashed: !alive, mark: alive ? count(n) : '×', state: alive ? `подключён, обработано ${n}` : `не подключён, обработано ${n}` };
}

interface Dot {
  x: number;
  y: number;
  fade: number;
  tone: Tone;
}

/** Edges that carried a message within the last window and the dots that travel along them. */
function activity(recent: readonly JournalEntry[], now: number, edgeAt: (from: string, to: string) => number, firstInto: (to: string) => number) {
  const active = new Set<number>();
  const moves: { edge: number; p: number; tone: Tone }[] = [];
  const via = new Map<string, string>();
  for (const e of recent) if (e.kind === 'publish' && e.msg && e.subject) via.set(e.msg, e.subject === '(default)' ? '' : e.subject);
  const push = (edge: number, at: number, tone: Tone) => {
    if (edge < 0) return;
    active.add(edge);
    moves.push({ edge, p: Math.min(1, Math.max(0, (now - at) / DOT_WINDOW_MS)), tone });
  };
  for (const e of recent) {
    if (e.kind === 'publish' && e.subject) push(edgeAt(`p:${e.actor}`, `x:${e.subject === '(default)' ? '' : e.subject}`), e.at, 'nav');
    else if (e.kind === 'route' && e.msg && e.subject) {
      const from = via.get(e.msg);
      push(from === undefined ? firstInto(`q:${e.subject}`) : edgeAt(`x:${from}`, `q:${e.subject}`), e.at, 'amber');
    } else if (e.kind === 'deliver' && e.subject) push(edgeAt(`q:${e.subject}`, `c:${e.actor}`), e.at, 'ok');
  }
  return { active, moves: moves.slice(-60) };
}

export function RabbitTopology() {
  const lab = useBroker();
  const version = lab((s) => s.version);
  const status = lab((s) => s.status);
  const selectMsg = lab((s) => s.selectMsg);
  const reduced = usePrefersReducedMotion();
  const holder = useRef<HTMLDivElement>(null);
  const width = useElementWidth(holder);
  const [open, setOpen] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const current = status === 'ready' ? lab.getState().view() : null;
  const view = current?.flavor === 'rabbit' ? current : null;
  const topo = useMemo(() => (view ? topologyOf(topologyInputOf(view.snapshot, view.scenario, view.consumers)) : null), [view]);
  const key = topo ? JSON.stringify(topo) : '';
  const layout = useMemo(() => (topo ? layoutTopology(topo, width) : null), [key, width]); // eslint-disable-line react-hooks/exhaustive-deps
  void version;

  if (!view || !layout) return <div ref={holder} className="h-full" />;

  const index = new Map(layout.nodes.map((n, i) => [n.id, i]));
  const edgeIndex = new Map(layout.edges.map((e, i) => [`${layout.nodes[e.a].id}>${layout.nodes[e.b].id}`, i]));
  const edgeAt = (from: string, to: string) => edgeIndex.get(`${from}>${to}`) ?? -1;
  const firstInto = (to: string) => layout.edges.findIndex((e) => layout.nodes[e.b].id === to);
  const { active, moves } = activity(view.recent, view.now, edgeAt, firstInto);
  const dots: Dot[] = reduced
    ? []
    : moves.map((m) => {
        const s = layout.edges[m.edge].seg;
        return { x: s.a.x + (s.b.x - s.a.x) * m.p, y: s.a.y + (s.b.y - s.a.y) * m.p, fade: 1 - 0.6 * m.p, tone: m.tone };
      });
  const looks = layout.nodes.map((n) => lookOf(n, view));
  const chosen = open === null ? -1 : (index.get(open) ?? -1);

  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      toggle(id);
    }
  };

  return (
    <div role="region" aria-label="Схема брокера" tabIndex={0} className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2">
      {!view.up && (
        <p role="alert" className="rounded border border-err/40 bg-err/10 px-3 py-1.5 text-[13px] text-err">
          Узел остановлен: очереди недоступны, пока он не перезапущен.
        </p>
      )}
      <div ref={holder} className="min-w-0">
        {layout.nodes.length === 0 ? (
          <p className="rounded border border-dashed border-line-strong p-3 text-[13px] text-dim">
            Пока ни одного exchange и ни одной очереди. Объявите их в консоли — схема появится здесь.
          </p>
        ) : (
          <svg
            data-audit-graph={layout.edges.length > 0 ? 'chain' : undefined}
            role="group"
            aria-label="Схема маршрутов: издатели, exchange, очереди, потребители"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width={layout.width}
            height={layout.height}
            style={{ maxWidth: '100%', height: 'auto' }}
          >
            {layout.edges.map((e, i) => (
              <line
                key={i}
                data-edge={i}
                x1={e.seg.a.x}
                y1={e.seg.a.y}
                x2={e.seg.b.x}
                y2={e.seg.b.y}
                stroke={active.has(i) ? 'var(--nav)' : 'var(--dim)'}
                strokeWidth={active.has(i) ? 2.5 : 1.5}
              />
            ))}
            {dots.map((d, i) => (
              <circle key={`m${i}`} cx={d.x} cy={d.y} r={4.5} fill={COLOR[d.tone]} opacity={d.fade} />
            ))}
            {layout.edges.map(
              (e, i) =>
                e.plate && (
                  <g key={`k${i}`} data-edge={i}>
                    <title>{e.text}</title>
                    <rect x={e.plate.x} y={e.plate.y} width={e.plate.w} height={e.plate.h} rx={4} fill="var(--raised)" stroke="var(--amber)" strokeOpacity={0.55} />
                    <text x={e.plate.x + e.plate.w / 2} y={e.plate.y + e.plate.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={13} fill="var(--amber)" style={MONO}>
                      {e.shown}
                    </text>
                  </g>
                ),
            )}
            {layout.nodes.map((n, i) => {
              const look = looks[i];
              const on = open === n.id;
              return (
                <g
                  key={n.id}
                  tabIndex={0}
                  role="button"
                  aria-pressed={on}
                  aria-label={`${ROLE_TITLE[n.role]} ${n.label}: ${look.state}`}
                  className="cursor-pointer outline-none"
                  onClick={() => toggle(n.id)}
                  onKeyDown={(e) => onKey(e, n.id)}
                  onFocus={() => setFocused(n.id)}
                  onBlur={() => setFocused((cur) => (cur === n.id ? null : cur))}
                >
                  <title>{`${ROLE_TITLE[n.role]} ${n.label}: ${look.state}`}</title>
                  {(on || focused === n.id) && <circle cx={n.x} cy={n.y} r={NODE_DRAW_R + 5} fill="none" stroke="var(--nav)" strokeWidth={2} />}
                  <circle
                    data-node={i}
                    cx={n.x}
                    cy={n.y}
                    r={NODE_DRAW_R}
                    fill="var(--raised)"
                    stroke={COLOR[look.tone]}
                    strokeWidth={2}
                    strokeDasharray={look.dashed ? '4 3' : undefined}
                  />
                  <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600} fill="var(--fg)" style={MONO}>
                    {layout.legend ? i + 1 : look.mark}
                  </text>
                </g>
              );
            })}
            {layout.nodes.map(
              (n, i) =>
                n.name && (
                  <g key={`t${n.id}`} data-node-label={i}>
                    <title>{n.label}</title>
                    <rect x={n.name.x} y={n.name.y} width={n.name.w} height={n.name.h} rx={4} fill="var(--panel)" stroke="var(--line-strong)" />
                    <text x={n.name.x + n.name.w / 2} y={n.name.y + n.name.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={13} fill="var(--fg)" style={MONO}>
                      {n.short}
                    </text>
                  </g>
                ),
            )}
          </svg>
        )}
      </div>

      {layout.nodes.length > 0 && (
        <p className="text-[12px] leading-relaxed text-dim">
          Круг очереди: число готовых сообщений; зелёный — пусто, жёлтый — есть, красный — от {FULL_QUEUE}. Круг потребителя: обработано; красный пунктир — не подключён. Нажмите на узел, чтобы открыть карточку.
        </p>
      )}

      {(layout.legend || !layout.platesOk) && (
        <section aria-label="Подписи схемы" className="rounded border border-line bg-well p-2 text-[12.5px]">
          <p className="mb-1 text-dim">Схема плотная, поэтому часть подписей вынесена в список.</p>
          {layout.legend && (
            <ol className="mb-1 grid list-none gap-x-4 gap-y-0.5 p-0 font-mono sm:grid-cols-2">
              {layout.nodes.map((n, i) => (
                <li key={n.id} className="break-all">
                  <span className="text-dim">{i + 1}. {ROLE_TITLE[n.role]}</span> <span className="text-fg">{n.label}</span> <span className="text-dim">— {looks[i].state}</span>
                </li>
              ))}
            </ol>
          )}
          {!layout.platesOk && (
            <ul className="list-none space-y-0.5 p-0 font-mono">
              {layout.edges.map((e, i) => (
                <li key={i} className="break-all">
                  <span className="text-fg">{layout.nodes[e.a].label}</span> <span className="text-dim">→</span> <span className="text-fg">{layout.nodes[e.b].label}</span> <span className="text-amber">{e.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {chosen >= 0 && (
        <NodeCard node={layout.nodes[chosen]} look={looks[chosen]} view={view} onClose={() => setOpen(null)} onMsg={(m) => selectMsg(m)} />
      )}
    </div>
  );
}

function NodeCard({ node, look, view, onClose, onMsg }: { node: LNode; look: Look; view: RabbitView; onClose: () => void; onMsg: (msg: string) => void }) {
  const snap = view.snapshot;
  const queue = node.role === 'queue' ? snap.vhosts.flatMap((v) => v.queues.map((q) => ({ ...q, label: vname(v.name, q.name) }))).find((q) => q.label === node.label) : undefined;
  const bindings = node.role === 'exchange' ? snap.vhosts.flatMap((v) => v.bindings.filter((b) => vname(v.name, b.source) === node.label || (node.label === '(default)' && b.source === ''))) : [];
  const exchange = node.role === 'exchange' ? snap.vhosts.flatMap((v) => v.exchanges).find((e) => e.name === node.label) : undefined;
  const actor = view.scenario?.actors.find((a) => a.id === node.label);
  const args = (o: Record<string, unknown>) => (Object.keys(o).length ? JSON.stringify(o) : 'нет');
  return (
    <section aria-label={`Карточка: ${node.label}`} className="rounded border border-line bg-well p-3 text-[13px]">
      <header className="mb-1.5 flex items-start gap-2">
        <h3 className="min-w-0 flex-1 break-all font-mono text-[13px] font-semibold text-fg">
          {ROLE_TITLE[node.role]} {node.label}
        </h3>
        <button type="button" onClick={onClose} className="h-6 shrink-0 rounded border border-line-strong px-2 text-[12px] text-dim hover:border-faint hover:text-fg">
          Закрыть
        </button>
      </header>
      <p className="text-dim">{look.state}</p>
      {queue && (
        <>
          <p className="mt-1 text-dim">
            Тип {queue.type}, {queue.durable ? 'durable' : 'не durable'}, повторных доставок {queue.redelivered}. Аргументы: <span className="font-mono text-fg">{args(queue.arguments)}</span>
          </p>
          {queue.head.length > 0 && (
            <ol aria-label="Начало очереди" className="mt-1.5 list-none space-y-0.5 p-0 font-mono text-[12px]">
              {queue.head.slice(0, 6).map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <button type="button" onClick={() => onMsg(m.id)} className="h-5 shrink-0 rounded border border-line-strong px-1.5 text-[11px] leading-none text-dim hover:border-faint hover:text-fg" aria-label={`Показать путь сообщения ${m.id}`}>
                    {m.id}
                  </button>
                  <span className="min-w-0 break-all text-fg">{m.body}</span>
                  {m.redelivered && <span className="shrink-0 text-amber">повторно</span>}
                </li>
              ))}
              {queue.ready > 6 && <li className="text-dim">… и ещё {queue.ready - 6}</li>}
            </ol>
          )}
        </>
      )}
      {exchange && (
        <>
          <p className="mt-1 text-dim">
            {exchange.durable ? 'durable' : 'не durable'}, аргументы: <span className="font-mono text-fg">{args(exchange.arguments)}</span>
          </p>
          <ul aria-label="Привязки" className="mt-1.5 list-none space-y-0.5 p-0 font-mono text-[12px]">
            {bindings.length === 0 && <li className="text-dim">Привязок нет</li>}
            {bindings.map((b, i) => (
              <li key={i} className="break-all">
                <span className="text-amber">{b.routingKey === '' ? '""' : b.routingKey}</span> <span className="text-dim">→</span> <span className="text-fg">{b.destination}</span>
                {Object.keys(b.arguments).length > 0 && <span className="text-dim"> {args(b.arguments)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {actor && (
        <p className="mt-1 break-words font-mono text-[12px] text-dim">
          {[
            actor.rate !== undefined ? `rate=${actor.rate}` : '',
            actor.count !== undefined ? `count=${actor.count}` : '',
            actor.processMs !== undefined ? `processMs=${actor.processMs}` : '',
            ...Object.entries(actor.config).map(([k, v]) => `${k}=${String(v)}`),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </section>
  );
}
