import { useState } from 'react';
import { prettyBody, statusText, type Exchange } from '@/engine/api/http';
import { EmptyState } from '@/ui/Panel';
import { Tabs } from '@/ui/Tabs';
import { useApiSandbox } from './apiStore';

export const statusTone = (status: number) => (status < 300 ? 'text-ok' : status < 400 ? 'text-nav' : status < 500 ? 'text-amber' : 'text-err');

/** The exchange selected in the log (the newest one by default). */
export function useSelectedExchange(): Exchange | undefined {
  const useStore = useApiSandbox();
  const exchanges = useStore((s) => s.exchanges);
  const selected = useStore((s) => s.selected);
  return exchanges.find((e) => e.id === selected) ?? exchanges.at(-1);
}

type Tab = 'body' | 'headers';
const TABS = [
  { id: 'body', title: 'Тело' },
  { id: 'headers', title: 'Заголовки' },
] as const;

/** Status, time, headers and body of a response. */
export function ResponseView() {
  const exchange = useSelectedExchange();
  const [tab, setTab] = useState<Tab>('body');
  if (!exchange) return <EmptyState>Ответ появится здесь после отправки запроса.</EmptyState>;
  const { response, error } = exchange;
  if (!response) {
    return (
      <div role="status" className="p-3 text-[13px]">
        <p className="font-semibold text-err">Ответа нет</p>
        <p className="mt-1 text-dim">{error}</p>
      </div>
    );
  }
  const size = new TextEncoder().encode(response.body).length;
  return (
    <div className="flex h-full flex-col">
      <p role="status" className="flex shrink-0 flex-wrap items-baseline gap-x-3 border-b border-line px-3 py-2 font-mono text-[12.5px]">
        <span className={`font-semibold ${statusTone(response.status)}`}>
          {response.status} {statusText(response.status)}
        </span>
        <span className="text-faint">{response.timeMs} мс</span>
        <span className="text-faint">{size} Б</span>
        {exchange.kind === 'preflight' && <span className="text-amber">preflight</span>}
      </p>
      <div className="flex h-9 shrink-0 items-stretch border-b border-line px-3">
        <Tabs label="Части ответа" items={TABS} value={tab} onChange={setTab} idPrefix="response" />
      </div>
      <div id="response-panel" role="tabpanel" aria-labelledby={`response-tab-${tab}`} className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'body' ? (
          response.body ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-fg">{prettyBody(response.body)}</pre>
          ) : (
            <p className="text-[13px] text-faint">Тело пустое{response.status === 204 ? ': код 204 так и означает — «успешно, без содержимого»' : ''}.</p>
          )
        ) : (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-[12.5px]">
            {response.headers.map((h, i) => (
              <div key={i} className="contents">
                <dt className="text-dim">{h.name}</dt>
                <dd className="break-all text-fg">{h.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
