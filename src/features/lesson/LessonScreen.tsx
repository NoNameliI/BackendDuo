import { lazy, Suspense } from 'react';
import { useHotkeys } from '@/app/hotkeys';
import { Button } from '@/ui/Button';
import { CheckIcon, PlayIcon, TrashIcon } from '@/ui/icons';
import { EmptyState, Panel } from '@/ui/Panel';
import { Split } from '@/ui/Split';
import { ResultPanel } from './ResultPanel';
import { Terminal } from './Terminal';
import { useWorkspace } from './workspace';

const SqlEditor = lazy(() => import('./SqlEditor'));

export function LessonScreen() {
  const { code, setCode, run, check, clearLog } = useWorkspace();

  useHotkeys({
    'Ctrl+Enter': run,
    'Ctrl+Shift+Enter': check,
  });

  return (
    <Split direction="row" storageKey="columns" initial={[28, 42, 30]} min={18}>
      <Panel title="Задание">
        <EmptyState>Здесь появятся теория, бизнес-кейс и условие задания.</EmptyState>
      </Panel>

      <Split direction="column" storageKey="center" initial={[68, 32]} min={15}>
        <Panel
          title="SQL"
          actions={
            <>
              <Button variant="run" icon={<PlayIcon />} shortcut="Ctrl ↵" onClick={run}>
                Выполнить
              </Button>
              <Button variant="check" icon={<CheckIcon />} shortcut="Ctrl ⇧ ↵" onClick={check}>
                Проверить
              </Button>
            </>
          }
        >
          <Suspense fallback={<div className="h-full bg-well" />}>
            <SqlEditor value={code} onChange={setCode} />
          </Suspense>
        </Panel>
        <Panel
          title="Терминал"
          actions={
            <Button aria-label="Очистить терминал" icon={<TrashIcon />} onClick={clearLog} />
          }
        >
          <Terminal />
        </Panel>
      </Split>

      <ResultPanel />
    </Split>
  );
}
