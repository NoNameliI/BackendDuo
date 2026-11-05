import { lazy, Suspense, useState } from 'react';
import { Button } from '@/ui/Button';
import { PlayIcon } from '@/ui/icons';
import { Tabs } from '@/ui/Tabs';
import { useApiSandbox } from './apiStore';

const CodeEditor = lazy(() => import('./CodeEditor'));

type Side = 'variables' | 'schema';
const SIDE = [
  { id: 'variables', title: 'Переменные' },
  { id: 'schema', title: 'Схема' },
] as const;

/** GraphQL tasks: the query editor, its variables and the server's schema. */
export function GraphqlPanel() {
  const useStore = useApiSandbox();
  const graphql = useStore((s) => s.graphql);
  const sending = useStore((s) => s.sending);
  const baseUrl = useStore((s) => s.baseUrl);
  const setGraphql = useStore((s) => s.setGraphql);
  const runGraphql = useStore((s) => s.runGraphql);
  const [side, setSide] = useState<Side>('schema');
  if (!graphql) return null;
  const run = () => void runGraphql();

  return (
    <div className="grid h-full min-h-0 grid-rows-[3fr_2fr] @3xl:grid-cols-[3fr_2fr] @3xl:grid-rows-1">
      <section aria-label="Запрос GraphQL" className="flex min-h-0 flex-col border-b border-line @3xl:border-r @3xl:border-b-0">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 font-mono text-[12px] text-dim">
          <span className="truncate">POST {baseUrl}/graphql</span>
          <Button className="ml-auto" variant="run" icon={<PlayIcon />} disabled={sending} shortcut="Ctrl ↵" onClick={run}>
            Выполнить
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <CodeEditor language="graphql" ariaLabel="Редактор запроса GraphQL" value={graphql.query} onChange={(query) => setGraphql({ query })} onRun={run} />
          </Suspense>
        </div>
      </section>
      <section aria-label="Переменные и схема" className="flex min-h-0 flex-col">
        <div className="flex h-9 shrink-0 items-stretch border-b border-line px-3">
          <Tabs label="Справа от запроса" items={SIDE} value={side} onChange={setSide} idPrefix="graphql-side" />
        </div>
        <div id="graphql-side-panel" role="tabpanel" aria-labelledby={`graphql-side-tab-${side}`} className="min-h-0 flex-1">
          <Suspense fallback={null}>
            {side === 'schema' ? (
              <CodeEditor key="schema" language="graphql" ariaLabel="Схема сервера (только чтение)" value={graphql.sdl.trim()} readOnly />
            ) : (
              <CodeEditor key="variables" language="json" ariaLabel="Переменные запроса в JSON" value={graphql.variables} onChange={(variables) => setGraphql({ variables })} onRun={run} />
            )}
          </Suspense>
        </div>
      </section>
    </div>
  );
}
