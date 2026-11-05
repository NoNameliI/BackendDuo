import { splitUrl } from '@/engine/api/http';
import { EmptyState } from '@/ui/Panel';
import { useApiSandbox } from './apiStore';
import { statusTone, useSelectedExchange } from './ResponseView';

/** Network log in the style of the browser's DevTools; a click shows the exchange. */
export function NetworkLog() {
  const useStore = useApiSandbox();
  const exchanges = useStore((s) => s.exchanges);
  const select = useStore((s) => s.select);
  const current = useSelectedExchange();
  if (!exchanges.length) return <EmptyState>Отправленные запросы появятся здесь, как во вкладке Network инструментов разработчика.</EmptyState>;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-left font-mono text-[12px]">
        <caption className="sr-only">Лента запросов</caption>
        <thead className="sticky top-0 bg-panel text-[11px] uppercase tracking-[0.1em] text-faint">
          <tr>
            <th className="px-3 py-1.5 font-normal">Метод</th>
            <th className="px-2 py-1.5 font-normal">Путь</th>
            <th className="px-2 py-1.5 font-normal">Статус</th>
            <th className="px-2 py-1.5 font-normal">Тип</th>
            <th className="px-3 py-1.5 text-right font-normal">Время</th>
          </tr>
        </thead>
        <tbody>
          {[...exchanges].reverse().map((e) => {
            const { path, query } = splitUrl(e.request.url);
            const active = e.id === current?.id;
            return (
              <tr
                key={e.id}
                aria-selected={active}
                tabIndex={0}
                onClick={() => select(e.id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    select(e.id);
                  }
                }}
                className={`cursor-pointer border-t border-line ${active ? 'bg-raised' : 'hover:bg-raised/60'}`}
              >
                <td className="px-3 py-1.5 text-nav">{e.request.method}</td>
                <td className="max-w-[16rem] truncate px-2 py-1.5 text-fg">
                  {path}
                  {query.length ? <span className="text-faint">?{query.map(([k, v]) => `${k}=${v}`).join('&')}</span> : null}
                </td>
                <td className={`px-2 py-1.5 ${e.response ? statusTone(e.response.status) : 'text-err'}`}>{e.response ? e.response.status : 'ошибка'}</td>
                <td className="px-2 py-1.5 text-faint">{e.kind === 'preflight' ? 'preflight' : e.origin ? 'fetch' : 'запрос'}</td>
                <td className="px-3 py-1.5 text-right text-faint">{e.response ? `${e.response.timeMs} мс` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
