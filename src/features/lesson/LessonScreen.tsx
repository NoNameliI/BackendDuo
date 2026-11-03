import { lazy, Suspense, useEffect } from 'react';
import { useHotkeys, type HotkeyMap } from '@/app/hotkeys';
import { course } from '@/content/course';
import { allTasks } from '@/content/loadCourse';
import { Button } from '@/ui/Button';
import { CheckIcon, PlanIcon, PlayIcon, ResetIcon, TrashIcon } from '@/ui/icons';
import { Panel } from '@/ui/Panel';
import { Split } from '@/ui/Split';
import { QuizPanel } from './QuizPanel';
import { ResultPanel } from './ResultPanel';
import { TaskPanel } from './TaskPanel';
import { Terminal } from './Terminal';
import { useWorkspace, type EngineStatus } from './workspace';

const SqlEditor = lazy(() => import('./SqlEditor'));

export function LessonScreen() {
  const { task, code, error, status, setCode, run, check, explain, resetDatabase, clearLog, openTask, goRelative, toggleOption } =
    useWorkspace();
  const busy = status === 'busy' || status === 'starting';

  useEffect(() => {
    if (!useWorkspace.getState().task) void openTask(allTasks(course)[0]);
  }, [openTask]);

  const quiz = task?.type === 'choice' || task?.type === 'review' ? task : null;
  const optionKeys: HotkeyMap = quiz
    ? Object.fromEntries(quiz.options.map((_, i) => [`${i + 1}`, () => toggleOption(i)]))
    : {};

  useHotkeys({
    'Ctrl+Enter': () => void run(),
    'Ctrl+Shift+Enter': () => void check(),
    'Alt+ArrowLeft': () => goRelative(-1),
    'Alt+ArrowRight': () => goRelative(1),
    ...optionKeys,
  });

  if (quiz) {
    return (
      <Split direction="row" storageKey="quiz-columns" initial={[36, 64]} min={25}>
        <TaskPanel />
        <QuizPanel task={quiz} />
      </Split>
    );
  }

  return (
    <Split direction="row" storageKey="columns" initial={[28, 42, 30]} min={18}>
      <TaskPanel />

      <Split direction="column" storageKey="center" initial={[68, 32]} min={15}>
        <Panel
          title="SQL"
          actions={
            <>
              <StatusDot status={status} />
              <Button aria-label="Сбросить базу к исходному состоянию" title="Сбросить базу" icon={<ResetIcon />} onClick={() => void resetDatabase()} disabled={busy} />
              <Button icon={<PlanIcon />} onClick={() => void explain()} disabled={busy}>
                План
              </Button>
              <Button variant="run" icon={<PlayIcon />} shortcut="Ctrl ↵" onClick={() => void run()} disabled={busy}>
                Выполнить
              </Button>
              <Button variant="check" icon={<CheckIcon />} shortcut="Ctrl ⇧ ↵" onClick={() => void check()} disabled={busy}>
                Проверить
              </Button>
            </>
          }
        >
          <Suspense fallback={<div className="h-full bg-well" />}>
            <SqlEditor value={code} onChange={setCode} error={error} />
          </Suspense>
        </Panel>
        <Panel title="Терминал" actions={<Button aria-label="Очистить терминал" icon={<TrashIcon />} onClick={clearLog} />}>
          <Terminal />
        </Panel>
      </Split>

      <ResultPanel />
    </Split>
  );
}

const statusView: Record<EngineStatus, { label: string; className: string }> = {
  off: { label: 'Песочница не запущена', className: 'bg-faint' },
  starting: { label: 'Песочница запускается', className: 'bg-amber animate-pulse' },
  ready: { label: 'Песочница готова', className: 'bg-ok' },
  busy: { label: 'Выполняется запрос', className: 'bg-nav animate-pulse' },
  failed: { label: 'Песочница недоступна', className: 'bg-err' },
};

function StatusDot({ status }: { status: EngineStatus }) {
  const view = statusView[status];
  return (
    <span role="status" title={view.label} className="mr-1 flex items-center">
      <span className={`h-2 w-2 rounded-full ${view.className}`} />
      <span className="sr-only">{view.label}</span>
    </span>
  );
}
