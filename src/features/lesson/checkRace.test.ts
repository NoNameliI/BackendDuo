import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckResult } from '@/checker';
import type { Task } from '@/content/loadCourse';

type Progress = (text: string) => void;
const calls: { id: string; progress: Progress; done: (r: CheckResult) => void }[] = [];

vi.mock('@/checker/fastapiCourse', () => ({
  checkPythonTask: (task: { id: string }, _project: unknown, _client: unknown, progress: Progress) =>
    new Promise<CheckResult>((done) => calls.push({ id: task.id, progress, done })),
}));
vi.mock('@/content/courses', () => ({ courseById: () => ({ servers: {} }) }));

const { useWorkspace } = await import('./workspace');
const { useProgress } = await import('@/progress/store');

const task = (id: string) => ({ id, type: 'fix-bug', httpSolution: '', courseId: 'c', project: { entry: 'main.py', starter: {} } }) as unknown as Task;
const ok: CheckResult = { passed: false, problems: ['x'] };

describe('check of a task that is no longer shown', () => {
  beforeEach(() => {
    calls.length = 0;
    useProgress.setState({ recordAttempt: vi.fn(() => null) } as never);
    useWorkspace.setState({ task: task('a'), checkingTaskId: null, checkProgress: '', verdict: null });
  });

  it('does not block the new task and ignores the old progress', async () => {
    const first = useWorkspace.getState().check();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(useWorkspace.getState().checkingTaskId).toBe('a');

    useWorkspace.setState({ task: task('b') });
    // the screen shows busy state only for the task being checked
    const busy = () => useWorkspace.getState().checkingTaskId !== null && useWorkspace.getState().checkingTaskId === useWorkspace.getState().task?.id;
    expect(busy()).toBe(false);
    // pressing Check on b while a runs starts b's check (the python client queues them)
    const second = useWorkspace.getState().check();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(useWorkspace.getState().checkingTaskId).toBe('b');

    calls[0].done(ok);
    await first;
    expect(useWorkspace.getState().checkingTaskId).toBe('b');
    expect(useWorkspace.getState().verdict).toBeNull();
    calls[0].progress('поздно');
    expect(useWorkspace.getState().checkProgress).toBe('');
    calls[1].progress('новая проверка');
    expect(useWorkspace.getState().checkProgress).toBe('новая проверка');

    calls[1].done(ok);
    await second;
    expect(useWorkspace.getState().checkingTaskId).toBeNull();
    expect(useWorkspace.getState().verdict?.passed).toBe(false);
  });

  it('a second press on the same task does nothing', async () => {
    const first = useWorkspace.getState().check();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await useWorkspace.getState().check();
    expect(calls).toHaveLength(1);
    calls[0].done(ok);
    await first;
    expect(useWorkspace.getState().checkingTaskId).toBeNull();
  });
});
