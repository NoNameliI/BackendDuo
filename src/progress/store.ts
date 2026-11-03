import { create } from 'zustand';

export interface TaskProgress {
  solved: boolean;
  attempts: number;
  hintsUsed: number;
  solutionShown: boolean;
  draft?: string;
}

const EMPTY: TaskProgress = { solved: false, attempts: 0, hintsUsed: 0, solutionShown: false };

interface ProgressState {
  tasks: Record<string, TaskProgress>;
  saveDraft: (taskId: string, code: string) => void;
  useHint: (taskId: string) => void;
  revealSolution: (taskId: string) => void;
  recordAttempt: (taskId: string, passed: boolean) => void;
}

export const taskProgress = (state: Pick<ProgressState, 'tasks'>, taskId: string): TaskProgress =>
  state.tasks[taskId] ?? EMPTY;

export const useProgress = create<ProgressState>((set) => {
  const patch = (taskId: string, change: (t: TaskProgress) => Partial<TaskProgress>) =>
    set((s) => {
      const current = taskProgress(s, taskId);
      return { tasks: { ...s.tasks, [taskId]: { ...current, ...change(current) } } };
    });

  return {
    tasks: {},
    saveDraft: (taskId, code) => patch(taskId, () => ({ draft: code })),
    useHint: (taskId) => patch(taskId, (t) => ({ hintsUsed: t.hintsUsed + 1 })),
    revealSolution: (taskId) => patch(taskId, () => ({ solutionShown: true })),
    recordAttempt: (taskId, passed) => patch(taskId, (t) => ({ attempts: t.attempts + 1, solved: t.solved || passed })),
  };
});
