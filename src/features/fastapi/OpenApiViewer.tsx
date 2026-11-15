import { useState } from 'react';
import type { ApiRequest } from '@/engine/api/http';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/Panel';
import { tryRequest, type Operation, type SchemaView, type Spec } from './openapi';

interface Props {
  spec: Spec | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onTry: (req: ApiRequest) => void;
}

const methodTone: Record<string, string> = {
  GET: 'text-ok border-ok/40',
  POST: 'text-nav border-nav/40',
  PUT: 'text-amber border-amber/40',
  PATCH: 'text-amber border-amber/40',
  DELETE: 'text-err border-err/40',
};

const codeTone = (code: string) => (code.startsWith('2') ? 'text-ok' : code.startsWith('3') ? 'text-nav' : code.startsWith('4') ? 'text-amber' : code.startsWith('5') ? 'text-err' : 'text-dim');

const LOCATION: Record<string, string> = { path: 'путь', query: 'query', header: 'заголовок', cookie: 'cookie' };

function Constraints({ view }: { view: SchemaView }) {
  const parts = [...view.constraints, ...(view.enum ? [`одно из: ${view.enum.map((v) => JSON.stringify(v)).join(', ')}`] : [])];
  if (view.default !== undefined) parts.push(`по умолчанию ${JSON.stringify(view.default)}`);
  if (!parts.length) return null;
  return <span className="text-[12px] text-faint"> · {parts.join(' · ')}</span>;
}

/** A schema as a tree: type, constraints, then the fields of objects and the items of arrays. */
function SchemaTree({ view, depth = 0 }: { view: SchemaView; depth?: number }) {
  const props = view.properties ?? view.items?.properties;
  return (
    <div className="font-mono text-[12.5px]">
      {depth === 0 && (
        <p>
          <span className="text-nav">{view.label}</span>
          <Constraints view={view} />
        </p>
      )}
      {view.description && depth === 0 && <p className="font-sans text-[12.5px] text-dim">{view.description}</p>}
      {props && depth < 6 && (
        <ul className="mt-1 space-y-1 border-l border-line pl-3">
          {props.map((p) => (
            <li key={p.name}>
              <span className="text-fg">{p.name}</span>
              <span className="text-faint">{p.required ? ' (обязательное)' : ' (необязательное)'}</span>
              <span className="text-faint">: </span>
              <span className="text-nav">{p.view.label}</span>
              <Constraints view={p.view} />
              {p.view.description && <p className="font-sans text-[12px] text-dim">{p.view.description}</p>}
              <SchemaTree view={p.view} depth={depth + 1} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OperationRow({ op, onTry }: { op: Operation; onTry: (req: ApiRequest) => void }) {
  const [open, setOpen] = useState(false);
  const id = `op-${op.method}-${op.path}`.replace(/[^\w-]/g, '_');
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-[13px] transition hover:bg-raised"
      >
        <span aria-hidden className="w-3 shrink-0 font-mono text-[11px] text-faint">
          {open ? '▾' : '▸'}
        </span>
        <span className={`w-16 shrink-0 rounded-sm border px-1 text-center font-mono text-[11px] font-semibold ${methodTone[op.method] ?? 'text-dim border-line'}`}>{op.method}</span>
        <span className={`min-w-0 break-all font-mono text-[12.5px] ${op.deprecated ? 'text-faint line-through' : 'text-fg'}`}>{op.path}</span>
        {op.deprecated && <span className="shrink-0 text-[11px] text-amber">устарел</span>}
        {op.summary && (
          <span className="min-w-0 truncate text-dim" title={op.summary}>
            {op.summary}
          </span>
        )}
      </button>
      {open && (
        <div id={id} className="space-y-3 px-3 pb-3 pl-8 text-[13px]">
          {op.description && <p className="whitespace-pre-line text-dim">{op.description}</p>}
          <div>
            <Button variant="run" onClick={() => onTry(tryRequest(op))}>
              Попробовать
            </Button>
          </div>
          {op.params.length > 0 && (
            <section aria-label="Параметры">
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Параметры</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="text-[11px] text-faint">
                    <tr>
                      <th className="pr-3 font-normal">Имя</th>
                      <th className="pr-3 font-normal">Где</th>
                      <th className="pr-3 font-normal">Тип</th>
                      <th className="font-normal">Описание</th>
                    </tr>
                  </thead>
                  <tbody>
                    {op.params.map((p) => (
                      <tr key={`${p.in}:${p.name}`} className="align-top">
                        <td className="pr-3 font-mono text-fg">
                          {p.name}
                          <span className="text-faint">{p.required ? ' (обязательный)' : ''}</span>
                        </td>
                        <td className="pr-3 text-dim">{LOCATION[p.in]}</td>
                        <td className="pr-3 font-mono text-nav">
                          {p.view.label}
                          <Constraints view={p.view} />
                        </td>
                        <td className="text-dim">{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {op.body && (
            <section aria-label="Тело запроса">
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">
                Тело запроса <span className="font-mono normal-case tracking-normal text-faint">{op.body.mediaType}</span>
                {op.body.required && <span className="normal-case tracking-normal text-faint"> · обязательное</span>}
              </h4>
              <SchemaTree view={op.body.view} />
            </section>
          )}
          {op.responses.length > 0 && (
            <section aria-label="Ответы">
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Ответы</h4>
              <ul className="space-y-2">
                {op.responses.map((r) => (
                  <li key={r.code}>
                    <p>
                      <span className={`font-mono font-semibold ${codeTone(r.code)}`}>{r.code}</span> <span className="text-dim">{r.description}</span>
                      {!r.view && <span className="text-faint"> · без тела</span>}
                    </p>
                    {r.view && <SchemaTree view={r.view} />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </li>
  );
}

/** Offline documentation of the running app: its /openapi.json read as a list of operations and schemas. */
export function OpenApiViewer({ spec, loading, error, onReload, onTry }: Props) {
  const header = (
    <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
      <h3 className="min-w-0 break-words text-[13px] font-semibold text-fg">{spec ? spec.title : 'Документация'}</h3>
      {spec?.version && <span className="shrink-0 whitespace-nowrap font-mono text-[12px] text-faint">v{spec.version}</span>}
      <div className="ml-auto shrink-0">
        <Button variant="outline" onClick={onReload} disabled={loading}>
          Обновить
        </Button>
      </div>
    </header>
  );
  return (
    <div className="flex h-full flex-col">
      {header}
      <div role="region" aria-label="Операции и схемы" tabIndex={0} className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
        <div role="status" className="sr-only">
          {loading ? 'Загрузка документации' : ''}
        </div>
        {error ? (
          <div role="alert" className="p-3 text-[13px]">
            <p className="font-semibold text-err">Не удалось получить документацию</p>
            <p className="mt-1 break-words font-mono text-[12px] text-dim">{error}</p>
          </div>
        ) : loading && !spec ? (
          <EmptyState>Загружаю документацию…</EmptyState>
        ) : !spec ? (
          <EmptyState>Документации пока нет. Запустите приложение и нажмите «Обновить».</EmptyState>
        ) : spec.groups.length === 0 ? (
          <EmptyState>В приложении ещё нет маршрутов.</EmptyState>
        ) : (
          <>
            {spec.groups.map((g) => (
              <section key={g.tag} aria-label={g.tag}>
                <h3 className="sticky top-0 border-b border-line bg-panel px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">{g.tag}</h3>
                <ul>
                  {g.operations.map((op) => (
                    <OperationRow key={`${op.method} ${op.path}`} op={op} onTry={onTry} />
                  ))}
                </ul>
              </section>
            ))}
            {spec.schemas.length > 0 && (
              <section aria-label="Схемы">
                <h3 className="sticky top-0 border-b border-line bg-panel px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">Схемы</h3>
                <ul>
                  {spec.schemas.map((s) => (
                    <SchemaRow key={s.name} name={s.name} view={s.view} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SchemaRow({ name, view }: { name: string; view: SchemaView }) {
  const [open, setOpen] = useState(false);
  const id = `schema-${name}`.replace(/[^\w-]/g, '_');
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-[13px] transition hover:bg-raised">
        <span aria-hidden className="w-3 shrink-0 font-mono text-[11px] text-faint">
          {open ? '▾' : '▸'}
        </span>
        <span className="font-mono text-[12.5px] text-fg">{name}</span>
        <span className="font-mono text-[12px] text-faint">{view.type ?? ''}</span>
      </button>
      {open && (
        <div id={id} className="px-3 pb-3 pl-8">
          <SchemaTree view={view} />
        </div>
      )}
    </li>
  );
}
