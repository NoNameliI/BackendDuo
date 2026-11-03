import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useWorkspace } from '@/features/lesson/workspace';
import { Button } from '@/ui/Button';
import { CheckIcon, TrashIcon } from '@/ui/icons';
import { Panel } from '@/ui/Panel';
import {
  ERD_TYPES,
  foreignKeyType,
  fromSchema,
  newColumn,
  newTable,
  toDdl,
  validateModel,
  type ErdColumn,
  type ErdModel,
  type ErdTable,
} from './model';

const CARD_WIDTH = 300;
const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 30;

/** Models survive switching between tasks within a session. */
const models = new Map<string, ErdModel>();

interface LinkStart {
  table: string;
  column: string;
}

export function ErdCanvas() {
  const { task, schema, setCode, check, status } = useWorkspace();
  const taskId = task?.id ?? '';
  const [model, setModel] = useState<ErdModel>(() => models.get(taskId) ?? fromSchema(schema));
  const [linking, setLinking] = useState<LinkStart | null>(null);
  const seeded = useRef(models.has(taskId));

  // The task database is introspected asynchronously; seed the canvas with its tables once they arrive.
  useEffect(() => {
    if (seeded.current || !schema) return;
    seeded.current = true;
    setModel(fromSchema(schema));
  }, [schema]);

  useEffect(() => {
    models.set(taskId, model);
    setCode(toDdl(model));
  }, [model, taskId, setCode]);

  const update = (tableId: string, change: (t: ErdTable) => ErdTable) =>
    setModel((m) => ({ tables: m.tables.map((t) => (t.id === tableId ? change(t) : t)) }));

  const updateColumn = (tableId: string, columnId: string, change: Partial<ErdColumn>) =>
    update(tableId, (t) => ({ ...t, columns: t.columns.map((c) => (c.id === columnId ? { ...c, ...change } : c)) }));

  const removeTable = (tableId: string) =>
    setModel((m) => ({
      tables: m.tables
        .filter((t) => t.id !== tableId)
        .map((t) => ({ ...t, columns: t.columns.map((c) => (c.ref?.table === tableId ? { ...c, ref: undefined } : c)) })),
    }));

  const addTable = () =>
    setModel((m) => {
      const n = m.tables.length;
      return { tables: [...m.tables, newTable(`table_${n + 1}`, 24 + (n % 3) * 330, 24 + Math.floor(n / 3) * 240)] };
    });

  const finishLink = (table: ErdTable, column: ErdColumn) => {
    if (!linking) return;
    updateColumn(linking.table, linking.column, { ref: { table: table.id, column: column.id }, type: foreignKeyType(column.type) });
    setLinking(null);
  };

  const problems = useMemo(() => validateModel(model), [model]);

  const size = useMemo(() => {
    const right = Math.max(...model.tables.map((t) => t.x + CARD_WIDTH), 800);
    const bottom = Math.max(...model.tables.map((t) => t.y + HEADER_HEIGHT + (t.columns.length + 1) * ROW_HEIGHT), 500);
    return { width: right + 200, height: bottom + 200 };
  }, [model]);

  return (
    <Panel
      title="Конструктор схемы"
      actions={
        <>
          <Button variant="outline" onClick={addTable}>
            + Таблица
          </Button>
          <Button variant="check" icon={<CheckIcon />} shortcut="Ctrl ⇧ ↵" onClick={() => void check()} disabled={status === 'busy'}>
            Проверить
          </Button>
        </>
      }
    >
      <div className="relative h-full">
        {linking && (
          <p role="status" className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 border-b border-amber/40 bg-amber/10 px-3 py-1.5 text-[13px] text-amber">
            Выберите колонку с PRIMARY KEY или UNIQUE, на которую будет ссылаться связь.
            <button type="button" className="ml-auto underline" onClick={() => setLinking(null)}>
              Отмена (Esc)
            </button>
          </p>
        )}
        <div
          className="h-full overflow-auto bg-well [background-image:radial-gradient(var(--line)_1px,transparent_1px)] [background-size:20px_20px]"
          onKeyDown={(e) => e.key === 'Escape' && setLinking(null)}
        >
          <div className="relative" style={size}>
            <Edges model={model} />
            {model.tables.map((t) => (
              <TableCard
                key={t.id}
                table={t}
                linking={linking}
                onMove={(x, y) => update(t.id, (tt) => ({ ...tt, x, y }))}
                onRename={(name) => update(t.id, (tt) => ({ ...tt, name }))}
                onRemove={() => removeTable(t.id)}
                onAddColumn={() => update(t.id, (tt) => ({ ...tt, columns: [...tt.columns, newColumn(`column_${tt.columns.length + 1}`, 'text')] }))}
                onRemoveColumn={(columnId) => update(t.id, (tt) => ({ ...tt, columns: tt.columns.filter((c) => c.id !== columnId) }))}
                onChangeColumn={(columnId, change) => updateColumn(t.id, columnId, change)}
                onStartLink={(columnId) => setLinking({ table: t.id, column: columnId })}
                onPickTarget={(column) => finishLink(t, column)}
              />
            ))}
          </div>
        </div>
        {problems.length > 0 && (
          <ul aria-label="Ошибки схемы" className="absolute inset-x-2 bottom-2 z-10 space-y-0.5 rounded border border-err/40 bg-panel/95 px-3 py-2 text-[12px] text-err">
            {problems.slice(0, 4).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function anchor(table: ErdTable, columnId: string, side: 'left' | 'right') {
  const index = table.columns.findIndex((c) => c.id === columnId);
  return {
    x: table.x + (side === 'right' ? CARD_WIDTH : 0),
    y: table.y + HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2,
  };
}

function Edges({ model }: { model: ErdModel }) {
  const byId = new Map(model.tables.map((t) => [t.id, t]));
  const paths = model.tables.flatMap((t) =>
    t.columns.flatMap((c) => {
      const target = c.ref ? byId.get(c.ref.table) : undefined;
      if (!c.ref || !target) return [];
      const towardsRight = target.x > t.x + CARD_WIDTH / 2;
      const from = anchor(t, c.id, towardsRight ? 'right' : 'left');
      const to = anchor(target, c.ref.column, towardsRight ? 'left' : 'right');
      const bend = Math.max(40, Math.abs(to.x - from.x) / 2) * (towardsRight ? 1 : -1);
      return [{ key: c.id, d: `M${from.x},${from.y} C${from.x + bend},${from.y} ${to.x - bend},${to.y} ${to.x},${to.y}`, from, to }];
    }),
  );
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {paths.map((p) => (
        <g key={p.key} className="text-nav">
          <path d={p.d} fill="none" stroke="currentColor" strokeWidth={1.6} />
          <circle cx={p.from.x} cy={p.from.y} r={3.5} fill="currentColor" />
          <rect x={p.to.x - 3.5} y={p.to.y - 3.5} width={7} height={7} fill="var(--well)" stroke="currentColor" strokeWidth={1.6} />
        </g>
      ))}
    </svg>
  );
}

interface TableCardProps {
  table: ErdTable;
  linking: LinkStart | null;
  onMove: (x: number, y: number) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onAddColumn: () => void;
  onRemoveColumn: (columnId: string) => void;
  onChangeColumn: (columnId: string, change: Partial<ErdColumn>) => void;
  onStartLink: (columnId: string) => void;
  onPickTarget: (column: ErdColumn) => void;
}

function TableCard({ table, linking, onMove, onRename, onRemove, onAddColumn, onRemoveColumn, onChangeColumn, onStartLink, onPickTarget }: TableCardProps) {
  const startDrag = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('input,button,select') || e.button !== 0) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const origin = { x: e.clientX - table.x, y: e.clientY - table.y };
    const move = (ev: globalThis.PointerEvent) => onMove(Math.max(0, ev.clientX - origin.x), Math.max(0, ev.clientY - origin.y));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };

  const nudge = (e: KeyboardEvent<HTMLElement>) => {
    const step = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[e.key];
    if (!step || e.target !== e.currentTarget) return;
    e.preventDefault();
    onMove(Math.max(0, table.x + step[0]), Math.max(0, table.y + step[1]));
  };

  const isTarget = (c: ErdColumn) => linking !== null && linking.table !== table.id && (c.pk || c.unique);

  return (
    <section
      aria-label={`Таблица ${table.name}`}
      className={`absolute rounded-md border bg-panel shadow-lg shadow-black/20 ${table.locked ? 'border-line' : 'border-line-strong'}`}
      style={{ left: table.x, top: table.y, width: CARD_WIDTH }}
    >
      <header
        tabIndex={0}
        aria-label={`Переместить таблицу ${table.name} стрелками`}
        onPointerDown={startDrag}
        onKeyDown={nudge}
        className="flex cursor-grab items-center gap-2 border-b border-line px-2.5 active:cursor-grabbing"
        style={{ height: HEADER_HEIGHT }}
      >
        {table.locked ? (
          <span className="font-mono text-[13px] font-semibold">
            {table.name} <span className="text-[11px] font-normal text-faint">· уже в базе</span>
          </span>
        ) : (
          <input
            aria-label="Имя таблицы"
            value={table.name}
            onChange={(e) => onRename(e.target.value.toLowerCase())}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 font-mono text-[13px] font-semibold hover:border-line focus:border-nav focus:outline-none"
          />
        )}
        {!table.locked && (
          <button type="button" aria-label={`Удалить таблицу ${table.name}`} onClick={onRemove} className="ml-auto text-faint hover:text-err">
            <TrashIcon />
          </button>
        )}
      </header>
      <ul>
        {table.columns.map((c) => (
          <li key={c.id} className="flex items-center gap-1 px-1.5 font-mono text-[12px]" style={{ height: ROW_HEIGHT }}>
            {isTarget(c) ? (
              <button
                type="button"
                onClick={() => onPickTarget(c)}
                className="flex h-6 flex-1 items-center gap-2 rounded border border-amber bg-amber/10 px-2 text-left text-amber"
              >
                {c.pk ? 'PK' : 'U'} {c.name} — выбрать
              </button>
            ) : table.locked ? (
              <span className="flex flex-1 items-center gap-2 px-1.5">
                <span className={`w-5 text-[10px] font-semibold ${c.pk ? 'text-amber' : 'text-faint'}`}>{c.pk ? 'PK' : ''}</span>
                <span className="text-dim">{c.name}</span>
                <span className="ml-auto truncate text-faint">{c.type}</span>
              </span>
            ) : (
              <ColumnEditor
                column={c}
                linkingThis={linking?.column === c.id}
                onChange={(change) => onChangeColumn(c.id, change)}
                onRemove={() => onRemoveColumn(c.id)}
                onLink={() => (c.ref ? onChangeColumn(c.id, { ref: undefined }) : onStartLink(c.id))}
              />
            )}
          </li>
        ))}
      </ul>
      {!table.locked && (
        <button type="button" onClick={onAddColumn} className="w-full border-t border-line px-2.5 text-left text-[12px] text-faint hover:bg-raised hover:text-fg" style={{ height: ROW_HEIGHT }}>
          + колонка
        </button>
      )}
    </section>
  );
}

function ColumnEditor({
  column,
  linkingThis,
  onChange,
  onRemove,
  onLink,
}: {
  column: ErdColumn;
  linkingThis: boolean;
  onChange: (change: Partial<ErdColumn>) => void;
  onRemove: () => void;
  onLink: () => void;
}) {
  const toggle = (key: 'pk' | 'notNull' | 'unique', label: string, title: string) => (
    <button
      type="button"
      aria-pressed={column[key]}
      title={title}
      onClick={() => onChange({ [key]: !column[key] })}
      className={`h-5 shrink-0 rounded px-1 text-[10px] font-semibold ${column[key] ? (key === 'pk' ? 'bg-amber text-on-accent' : 'bg-nav/20 text-nav') : 'text-faint hover:text-dim'}`}
    >
      {label}
    </button>
  );
  const types = ERD_TYPES.includes(column.type as (typeof ERD_TYPES)[number]) ? ERD_TYPES : [column.type, ...ERD_TYPES];

  return (
    <>
      {toggle('pk', 'PK', 'Первичный ключ')}
      <input
        aria-label="Имя колонки"
        value={column.name}
        onChange={(e) => onChange({ name: e.target.value.toLowerCase() })}
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 hover:border-line focus:border-nav focus:outline-none"
      />
      <select
        aria-label="Тип колонки"
        value={column.type}
        onChange={(e) => onChange({ type: e.target.value })}
        className="w-[92px] shrink-0 rounded border border-line bg-well px-0.5 text-[11px] text-dim focus:border-nav focus:outline-none"
      >
        {types.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {toggle('notNull', 'NN', 'NOT NULL')}
      {toggle('unique', 'U', 'UNIQUE')}
      <button
        type="button"
        aria-pressed={Boolean(column.ref) || linkingThis}
        title={column.ref ? 'Убрать связь' : 'Создать связь (FOREIGN KEY)'}
        onClick={onLink}
        className={`h-5 shrink-0 rounded px-1 text-[10px] font-semibold ${column.ref ? 'bg-nav text-on-accent' : linkingThis ? 'bg-amber text-on-accent' : 'text-faint hover:text-nav'}`}
      >
        FK
      </button>
      <button type="button" aria-label={`Удалить колонку ${column.name}`} onClick={onRemove} className="shrink-0 px-0.5 text-faint hover:text-err">
        ×
      </button>
    </>
  );
}
