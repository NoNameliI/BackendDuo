import { lazy, Suspense, useEffect } from 'react';
import { useHotkeys, type HotkeyMap } from '@/app/hotkeys';
import { activeCourse } from '@/app/useCourse';
import { resumeTask } from '@/progress/gamification';
import { selectCourse, useProgress } from '@/progress/store';
import { Button } from '@/ui/Button';
import { CheckIcon, PlanIcon, PlayIcon, ResetIcon, TrashIcon } from '@/ui/icons';
import { Panel } from '@/ui/Panel';
import { Split } from '@/ui/Split';
import { DdlPanel } from '@/features/erd/DdlPanel';
import { ErdCanvas } from '@/features/erd/ErdCanvas';
import { QuizPanel } from './QuizPanel';
import { ResultPanel } from './ResultPanel';
import { TaskPanel } from './TaskPanel';
import { Terminal } from './Terminal';
import { lessonApi, lessonSandbox, useWorkspace, type EngineStatus } from './workspace';
import { ApiSandboxContext } from '@/features/api/apiStore';
import { ApiWorkbench } from '@/features/api/ApiWorkbench';
import { SandboxContext } from '@/features/git/gitSandbox';
import { GitWorkbench } from '@/features/git/GitWorkbench';

const SqlEditor = lazy(() => import('./SqlEditor'));

export function LessonScreen() {
  const { task, code, error, status, setCode, run, check, explain, resetDatabase, clearLog, openTask, goRelative, toggleOption } =
    useWorkspace();
  const busy = status === 'busy' || status === 'starting';
  const checking = useWorkspace((s) => s.checking);

  useEffect(() => {
    const course = activeCourse();
    if (useWorkspace.getState().task?.courseId !== course.id) {
      void openTask(resumeTask(course, selectCourse(course.id)(useProgress.getState())));
    }
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

  if (task?.type === 'schema' && task.ui === 'erd') {
    return (
      <Split direction="row" storageKey="erd-columns" initial={[26, 50, 24]} min={16}>
        <TaskPanel />
        <ErdCanvas key={task.id} />
        <Split direction="column" storageKey="erd-right" initial={[58, 42]} min={20}>
          <DdlPanel />
          <Panel title="Терминал" actions={<Button aria-label="Очистить терминал" icon={<TrashIcon />} onClick={clearLog} />}>
            <Terminal />
          </Panel>
        </Split>
      </Split>
    );
  }

  if (task && 'httpSolution' in task) {
    return (
      <Split direction="row" storageKey="api-lesson-columns" initial={[30, 70]} min={20}>
        <TaskPanel />
        <ApiSandboxContext.Provider value={lessonApi}>
          <ApiWorkbench
            prefix="api-lesson"
            actions={
              <>
                <Button aria-label="Вернуть запрос к началу задания" title="Сбросить" icon={<ResetIcon />} onClick={() => void resetDatabase()} />
                <Button variant="check" icon={<CheckIcon />} shortcut="Ctrl ⇧ ↵" disabled={checking} onClick={() => void check()}>
                  {checking ? 'Проверяю…' : 'Проверить'}
                </Button>
              </>
            }
          />
        </ApiSandboxContext.Provider>
      </Split>
    );
  }

  if (task && 'shellSolution' in task) {
    return (
      <Split direction="row" storageKey="git-lesson-columns" initial={[30, 70]} min={20}>
        <TaskPanel />
        <SandboxContext.Provider value={lessonSandbox}>
          <GitWorkbench
            prefix="git-lesson"
            actions={
              <>
                <Button aria-label="Вернуть песочницу к началу задания" title="Сбросить песочницу" icon={<ResetIcon />} onClick={() => void resetDatabase()} />
                <Button variant="check" icon={<CheckIcon />} shortcut="Ctrl ⇧ ↵" onClick={() => void check()}>
                  Проверить
                </Button>
              </>
            }
          />
        </SandboxContext.Provider>
      </Split>
    );
  }

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
