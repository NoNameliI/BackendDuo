import { lazy, Suspense, useEffect, useState } from 'react';
import { Button } from '@/ui/Button';
import { Panel } from '@/ui/Panel';
import { Split } from '@/ui/Split';
import { Tabs } from '@/ui/Tabs';
import { GitFiles } from './GitFiles';
import { GitGraph } from './GitGraph';
import { PLAYGROUND_SETUP, useGitSandbox } from './gitSandbox';
import { GitStatusView } from './GitStatusView';
import { GitTerminal } from './GitTerminal';

const GitFileEditor = lazy(() => import('./GitFileEditor'));

type Side = 'graph' | 'status';
const SIDE_TABS = [
  { id: 'graph', title: 'Граф' },
  { id: 'status', title: 'Статус' },
] as const;

const SANDBOX_NOTE = 'Учебная песочница: Git смоделирован внутри приложения, команды не трогают ваши файлы и сеть';

/** Free Git sandbox: files, editor, commit graph, status and a terminal. */
export default function GitSandboxScreen() {
  const reset = useGitSandbox((s) => s.reset);
  const started = useGitSandbox((s) => s.version > 0);
  const [side, setSide] = useState<Side>('graph');

  useEffect(() => {
    if (!started) reset(PLAYGROUND_SETUP, '/home/student/site');
  }, [started, reset]);

  return (
    <Split direction="row" initial={[22, 78]} storageKey="git-sandbox-cols" min={12}>
      <Panel title="Файлы">
        <GitFiles />
      </Panel>
      <Split direction="column" initial={[58, 42]} storageKey="git-sandbox-rows">
        <Split direction="row" initial={[50, 50]} storageKey="git-sandbox-top">
          <Panel title="Редактор">
            <Suspense fallback={<div className="h-full bg-well" />}>
              <GitFileEditor />
            </Suspense>
          </Panel>
          <Panel tabs={<Tabs label="Состояние репозитория" items={SIDE_TABS} value={side} onChange={setSide} idPrefix="git-side" />}>
            <div id="git-side-panel" role="tabpanel" aria-labelledby={`git-side-tab-${side}`} className="h-full">
              {side === 'graph' ? <GitGraph /> : <GitStatusView />}
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
              <Button variant="outline" onClick={() => reset(PLAYGROUND_SETUP, '/home/student/site')}>
                Начать заново
              </Button>
            </>
          }
        >
          <GitTerminal />
        </Panel>
      </Split>
    </Split>
  );
}
