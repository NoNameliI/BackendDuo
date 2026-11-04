import type { Lesson } from '@/content/loadCourse';
import { prompt } from '@/engine/git/complete';
import { GitSandboxEngine } from '@/engine/git/GitSandboxEngine';
import { splitCommands, type OutputLine } from '@/engine/git/shell';

export interface ShellRun {
  prompt: string;
  command: string;
  lines: OutputLine[];
  exit: number;
}

// Theory examples of a lesson share one Git sandbox and run in order, like commands typed by hand.
let engine: GitSandboxEngine | null = null;
let loadedLesson: string | null = null;

function load(lesson: Lesson): GitSandboxEngine {
  engine = new GitSandboxEngine();
  engine.reset(lesson.exampleSetup);
  loadedLesson = lesson.id;
  return engine;
}

export function runShellExample(lesson: Lesson, script: string): ShellRun[] {
  const sandbox = loadedLesson === lesson.id && engine ? engine : load(lesson);
  return splitCommands(script).map((command) => {
    const before = prompt(sandbox.world);
    const result = command.includes('\n') ? sandbox.runScript(command) : sandbox.run(command);
    const exit = 'exit' in result ? result.exit : result.failed ? result.failed.exit : 0;
    return { prompt: before, command: command.split('\n')[0], lines: result.lines, exit };
  });
}

export function resetShellExamples(lesson: Lesson): void {
  load(lesson);
}
