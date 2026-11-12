import type { GroupDescription } from '@/engine/sim/kafka';
import { groupModel, type GroupModel, type LaneItem } from './kafkaLayout';

const dash = (n: number | null) => (n === null ? '—' : String(n));

function Row({ item }: { item: LaneItem }) {
  return (
    <li data-lane-item={item.tp} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 text-[12.5px]">
      <span className="break-all font-mono text-fg">{item.tp}</span>
      <span className="text-right font-mono text-dim">
        коммит {dash(item.committed)} из {item.logEnd} · <span className={item.lag ? 'font-semibold text-amber' : ''}>отставание {dash(item.lag)}</span>
      </span>
      <span aria-hidden className="col-span-2 block h-1.5 overflow-hidden rounded-sm border border-line-strong bg-well">
        <span className="block h-full bg-ok" style={{ width: `${Math.round(item.done * 100)}%`, opacity: 0.6 }} />
      </span>
    </li>
  );
}

function Group({ g }: { g: GroupModel }) {
  return (
    <section data-group={g.id} data-state={g.state} aria-label={`Группа ${g.id}`} className="rounded border border-line bg-panel p-2">
      <h4 className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
        <span className="break-all font-mono font-semibold text-fg">{g.id}</span>
        <span className={g.rebalancing ? 'font-semibold text-amber' : 'text-dim'}>{g.stateText}</span>
        <span className="text-dim">
          стратегия {g.protocol} · поколение {g.generation} · координатор: брокер {g.coordinator}
        </span>
        <span className="ml-auto text-dim">
          общее отставание: <span className={g.totalLag ? 'font-semibold text-amber' : ''}>{dash(g.totalLag)}</span>
        </span>
      </h4>
      {g.lanes.length === 0 && <p className="text-[12.5px] text-dim">В группе нет участников: разделы никому не розданы.</p>}
      <ul className="list-none space-y-2 p-0">
        {g.lanes.map((l) => (
          <li key={l.memberId} data-lane={l.memberId} className="rounded border border-line-strong bg-raised p-2">
            <p className="mb-1 flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
              <span className="break-all font-mono font-semibold text-fg" title={l.memberId}>
                {l.title}
              </span>
              <span className="text-dim">
                {l.host} · разделов {l.items.length}
              </span>
              <span className="ml-auto text-dim">отставание участника {l.lag}</span>
            </p>
            {l.items.length === 0 ? (
              <p className="text-[12.5px] text-dim">Разделов нет: участников больше, чем разделов, лишние простаивают.</p>
            ) : (
              <ul className="list-none space-y-1.5 p-0">
                {l.items.map((i) => (
                  <Row key={i.tp} item={i} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {g.orphans.length > 0 && (
        <div className="mt-2">
          <p className="mb-1 text-[12.5px] text-dim">Без владельца (читать их сейчас некому):</p>
          <ul className="list-none space-y-1.5 p-0">
            {g.orphans.map((i) => (
              <Row key={i.tp} item={i} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Consumer groups as lanes: one lane per member with its partitions, committed offset, lag and the rebalance state. */
export function GroupLanes({ groups }: { groups: readonly GroupDescription[] }) {
  if (groups.length === 0) {
    return (
      <section aria-label="Группы потребителей">
        <h3 className="mb-1 text-[13px] font-semibold text-fg">Группы потребителей</h3>
        <p className="text-[12.5px] text-dim">Групп пока нет: они появятся, когда потребитель с --group прочитает топик.</p>
      </section>
    );
  }
  return (
    <section aria-label="Группы потребителей" className="space-y-2">
      <h3 className="text-[13px] font-semibold text-fg">Группы потребителей</h3>
      {groups.map((g) => (
        <Group key={g.id} g={groupModel(g)} />
      ))}
    </section>
  );
}
