import { describe, expect, it } from 'vitest';
import type { GitTask } from '@/content/loadCourse';
import { taskSchema } from '@/content/schema';
import { GitSandboxEngine } from '@/engine/git/GitSandboxEngine';
import { splitCommands } from '@/engine/git/shell';
import { createGitChecker, type CommandRecord } from './git';

let n = 0;
function task(raw: Record<string, unknown>): GitTask {
  const parsed = taskSchema.parse({ id: `t${++n}`, title: 'T', prompt: 'P', hints: ['h'], ...raw });
  return { ...parsed, courseId: 'git', lessonId: 'l', worldId: 'w', setupSql: '' } as GitTask;
}

/** Plays a learner session: setup, then the typed commands. */
function session(t: GitTask, typed: string) {
  const engine = new GitSandboxEngine();
  engine.reset(t.shellSetup);
  // Lets typed service commands stand in for clicks in the hosting pages.
  engine.world.privileged = true;
  const commands: CommandRecord[] = splitCommands(typed).map((line) => ({ line, exit: engine.run(line).exit }));
  return { world: engine.world, commands };
}

const SETUP = 'git init -q site\ncd site\necho a > a.txt\ngit add a.txt\ngit commit -q -m "Start"';

describe('git checker', () => {
  const checker = createGitChecker();

  it('graph: accepts the same history made with extra commands, explains a missing commit', () => {
    const t = task({ type: 'graph', shellSetup: SETUP, shellSolution: 'git switch -c feature\necho b > b.txt\ngit add b.txt\ngit commit -m "Add b"\ngit switch main' });
    const ok = session(t, 'git status\ngit switch -c feature\necho b > b.txt\ngit add .\ngit log\ngit commit -m "Add b"\ngit switch main');
    expect(checker.check(t, ok.world, ok.commands)).toEqual({ passed: true, problems: [] });
    const missing = session(t, 'git switch -c feature');
    expect(checker.check(t, missing.world, missing.commands).problems).toEqual([
      'Ветка feature: ожидается 2 коммита: «Add b» ← «Start»; у вас 1 коммит: «Start»',
      'Сейчас вы на ветке feature, а в конце нужно оказаться на main',
    ]);
    const untouched = session(t, '');
    expect(checker.check(t, untouched.world, []).problems[0]).toBe('Ветка feature нет — её нужно создать');
  });

  it('graph: wants a merge commit when the solution makes one', () => {
    const t = task({
      type: 'graph',
      shellSetup: `${SETUP}\ngit switch -q -c f\necho f > f.txt\ngit add f.txt\ngit commit -q -m F\ngit switch -q main`,
      shellSolution: 'git merge --no-ff -m "Merge f" f',
    });
    const ff = session(t, 'git merge f');
    expect(checker.check(t, ff.world, ff.commands).problems).toEqual([
      'Ветка main: последним ожидается коммит слияния (у него два родителя), а у вас обычный коммит',
    ]);
  });

  it('worktree: compares files, index and untracked files', () => {
    const t = task({ type: 'worktree', shellSetup: `${SETUP}\necho draft > notes.txt\necho b > b.txt`, shellSolution: 'echo fixed > a.txt\ngit add a.txt' });
    const ok = session(t, 'echo fixed > a.txt\ngit add a.txt\ngit status');
    expect(checker.check(t, ok.world, ok.commands).passed).toBe(true);
    const wrong = session(t, 'echo fixed > a.txt\ngit add .');
    expect(checker.check(t, wrong.world, wrong.commands).problems).toEqual([
      'Изменение в b.txt не должно быть в индексе',
      'Изменение в notes.txt не должно быть в индексе',
      'b.txt должен остаться неотслеживаемым (не добавляйте его в Git)',
      'notes.txt должен остаться неотслеживаемым (не добавляйте его в Git)',
    ]);
  });

  it('commands: requires successful commands and forbids others', () => {
    const t = task({
      type: 'commands',
      shellSetup: SETUP,
      shellSolution: 'git log --oneline',
      check: {
        require: [{ pattern: '^git log\\b.*--oneline', message: 'Посмотрите историю командой git log --oneline' }],
        forbid: [{ pattern: '--graph', message: 'Здесь граф не нужен' }],
      },
    });
    const ok = session(t, 'git log --oneline');
    expect(checker.check(t, ok.world, ok.commands).passed).toBe(true);
    const typo = session(t, 'git log --onelin\ngit log --oneline --graph');
    expect(checker.check(t, typo.world, typo.commands).problems).toEqual(['Здесь граф не нужен']);
    expect(checker.check(t, typo.world, [{ line: 'git log --oneline', exit: 128 }]).problems).toEqual(['Посмотрите историю командой git log --oneline']);
  });

  it('hosting: compares pull requests and protections', () => {
    const setup = `${SETUP}\ngh repo create site --public --source=. --push\ngit switch -q -c about\necho about > about.html\ngit add .\ngit commit -q -m "About"\ngit push -q -u origin about`;
    const t = task({ type: 'hosting', shellSetup: setup, shellSolution: 'gh pr create --fill\nhosting protect student/site main' });
    const ok = session(t, 'gh pr create --title "Страница о нас"\nhosting protect student/site main');
    expect(checker.check(t, ok.world, ok.commands).passed).toBe(true);
    const none = session(t, '');
    expect(checker.check(t, none.world, []).problems).toEqual(['Pull request из about в main не найден', 'Ветка main должна быть защищена']);
  });

  it('ci: rejects a run made green by weakening the workflow, accepts chained commands', () => {
    const workflow = "name: CI\non: push\njobs:\n  site:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: test -f index.html";
    const t = task({
      type: 'ci',
      shellSetup: `${SETUP}\ngh repo create site --public --source=. --push\nmkdir -p .github/workflows\ncat > .github/workflows/ci.yml <<'EOF'\n${workflow}\nEOF\ngit add .\ngit commit -q -m CI\ngit push -q`,
      shellSolution: 'echo page > index.html\ngit add index.html\ngit commit -m Page\ngit push',
      check: { files: ['.github/workflows/ci.yml'] },
    });
    const cheat = session(t, 'echo "name: CI" > .github/workflows/ci.yml\ngit commit -am Cheat\ngit push');
    expect(checker.check(t, cheat.world, cheat.commands).problems[0]).toMatch(/^Файл \.github\/workflows\/ci\.yml на main отличается/);
    const ok = session(t, 'echo page > index.html && git add index.html && git commit -m Page && git push');
    expect(checker.check(t, ok.world, ok.commands).passed).toBe(true);
  });

  it('ci: explains which job failed', () => {
    const workflow = "name: CI\non: push\njobs:\n  site:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - name: Есть index.html\n        run: test -f index.html";
    const t = task({
      type: 'ci',
      shellSetup: `${SETUP}\ngh repo create site --public --source=. --push\nmkdir -p .github/workflows\ncat > .github/workflows/ci.yml <<'EOF'\n${workflow}\nEOF`,
      shellSolution: 'echo "<h1>" > index.html\ngit add .\ngit commit -m "CI"\ngit push',
    });
    const ok = session(t, 'echo "<p>" > index.html\ngit add .\ngit commit -m "Add CI and page"\ngit push');
    expect(checker.check(t, ok.world, ok.commands).passed).toBe(true);
    const failing = session(t, 'git add .\ngit commit -m "CI only"\ngit push');
    expect(checker.check(t, failing.world, failing.commands).problems).toEqual([
      'Последний запуск на main упал в задании «site», шаг «Есть index.html»: посмотрите журнал во вкладке «Хостинг»',
    ]);
  });
});
