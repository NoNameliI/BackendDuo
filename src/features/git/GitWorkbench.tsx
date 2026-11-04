import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Panel } from '@/ui/Panel';
import { Split } from '@/ui/Split';
import { Tabs } from '@/ui/Tabs';
import { GitFiles } from './GitFiles';
import { GitGraph } from './GitGraph';
import { GitHosting } from './GitHosting';
import { GitStatusView } from './GitStatusView';
import { GitTerminal } from './GitTerminal';

const GitFileEditor = lazy(() => import('./GitFileEditor'));

type Side = 'graph' | 'status' | 'hosting';
const SIDE_TABS = [
  { id: 'graph', title: 'Граф' },
  { id: 'status', title: 'Статус' },
  { id: 'hosting', title: 'Хостинг' },
] as const;

const SANDBOX_NOTE = 'Учебная песочница: Git смоделирован внутри приложения, команды не трогают ваши файлы и сеть';

/**
 * Files, editor, graph/status/hosting and the terminal of the Git sandbox given by SandboxContext.
 * `prefix` keeps panel sizes of the playground and of lessons apart.
 */
export function GitWorkbench({ actions, prefix, files = true }: { actions: ReactNode; prefix: string; files?: boolean }) {
  const [side, setSide] = useState<Side>('graph');
  const main = (
    <Split direction="column" initial={[58, 42]} storageKey={`${prefix}-rows`}>
      <Split direction="row" initial={[50, 50]} storageKey={`${prefix}-top`}>
        <Panel title="Редактор">
          <Suspense fallback={<div className="h-full bg-well" />}>
            <GitFileEditor />
          </Suspense>
        </Panel>
        <Panel tabs={<Tabs label="Состояние репозитория" items={SIDE_TABS} value={side} onChange={setSide} idPrefix={`${prefix}-side`} />}>
          <div id={`${prefix}-side-panel`} role="tabpanel" aria-labelledby={`${prefix}-side-tab-${side}`} className="h-full">
            {side === 'graph' ? <GitGraph /> : side === 'status' ? <GitStatusView /> : <GitHosting />}
          </div>
        </Panel>
      </Split>
      <Panel
        title="Терминал"
        actions={
          <>
            <span className="hidden font-mono text-[11px] text-faint @3xl:inline" title={SANDBOX_NOTE}>
              учебная песочница
            </span>
            {actions}
          </>
        }
      >
        <GitTerminal />
      </Panel>
    </Split>
  );
  if (!files) return main;
  return (
    <Split direction="row" initial={[22, 78]} storageKey={`${prefix}-cols`} min={12}>
      <Panel title="Файлы">
        <GitFiles />
      </Panel>
      {main}
    </Split>
  );
}
