import { describe, expect, it } from 'vitest';
import { GitSandboxEngine } from '../GitSandboxEngine';
import { branchMatches, evalExpression, expandVars } from './ci';
import { hostingOf } from './model';

const out = (engine: GitSandboxEngine, line: string) => engine.run(line).lines.map((l) => l.text);

const WORKFLOW = `name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Есть главная страница
        run: test -f index.html
      - name: Заголовок на месте
        run: grep -q "<h1>" index.html`;

function site(flavor: 'github' | 'gitlab' = 'github'): GitSandboxEngine {
  const engine = new GitSandboxEngine();
  engine.reset(`hosting flavor ${flavor}
mkdir site
cd site
git init -q
echo "<h1>Привет</h1>" > index.html
mkdir -p .github/workflows
cat > .github/workflows/ci.yml <<'EOF'
${WORKFLOW}
EOF
git add .
git commit -q -m "Start"`);
  return engine;
}

describe('hosting', () => {
  it('creates a repository, pushes over https and runs the workflow', () => {
    const engine = site();
    expect(out(engine, 'gh repo create site --source=. --push')).toEqual([
      '✓ Created repository student/site on GitHub',
      '  https://github.com/student/site',
      '✓ Added remote https://github.com/student/site.git',
      '✓ Pushed commits to https://github.com/student/site.git',
    ]);
    const project = hostingOf(engine.world).find('student/site')!;
    expect(project.runs).toHaveLength(1);
    expect(project.runs[0].status).toBe('success');
    expect(out(engine, 'gh run list')[1]).toMatch(/^✓\s+Start\s+CI\s+main\s+push\s+1$/);
  });

  it('rejects pushes to a protected branch and asks for a pull request', () => {
    const engine = site();
    engine.run('gh repo create site --source=. --push');
    engine.run('hosting protect student/site main --approvals 1 --checks');
    engine.run('echo more >> index.html && git commit -q -am "Direct"');
    const result = engine.run('git push');
    expect(result.exit).toBe(1);
    expect(result.lines.map((l) => l.text)).toEqual([
      'remote: error: GH006: Protected branch update failed for refs/heads/main.',
      'remote: ',
      'remote: - Changes must be made through a pull request.',
      'To https://github.com/student/site.git',
      ' ! [remote rejected] main -> main (protected branch hook declined)',
      "error: failed to push some refs to 'https://github.com/student/site.git'",
    ]);
  });

  it('merges a reviewed pull request with passing checks and closes the issue', () => {
    const engine = site();
    engine.run('gh repo create site --source=. --push');
    engine.run('hosting protect student/site main --approvals 1 --checks');
    engine.run('gh issue create --title "Нет подвала" --body "Добавьте footer"');
    engine.run('git switch -q -c footer && echo "<footer>" >> index.html && git commit -q -am "Add footer"');
    const push = out(engine, 'git push -u origin footer');
    expect(push).toContain("remote: Create a pull request for 'footer' on GitHub by visiting:");
    expect(out(engine, 'gh pr create --title "Подвал" --body "Closes #1"').at(-1)).toBe('https://github.com/student/site/pull/2');
    expect(engine.run('gh pr merge 2').lines[0].text).toContain('нужно одобрений: 1, есть: 0');
    expect(out(engine, 'gh pr review 2 --approve')).toEqual(['Can not approve your own pull request']);
    expect(out(engine, 'as mentor gh pr review 2 --approve')).toEqual(['✓ Approved pull request #2']);
    expect(out(engine, 'gh pr merge 2 --delete-branch')).toEqual([
      '✓ Merged pull request student/site#2 (Подвал)',
      '✓ Deleted remote branch footer',
    ]);
    const project = hostingOf(engine.world).find('student/site')!;
    const merge = project.repo.commits.get(project.repo.branches.get('main')!)!;
    expect(merge.message).toBe('Merge pull request #2 from student/footer\n\nПодвал\n');
    expect(merge.committer.name).toBe('GitHub');
    expect(project.issues[0].state).toBe('closed');
    engine.run('git switch -q main');
    expect(out(engine, 'git pull -q && git log --oneline -1')[0]).toMatch(/Merge pull request #2 from student\/footer/);
  });

  it('blocks a pull request whose checks fail', () => {
    const engine = site();
    engine.run('gh repo create site --source=. --push');
    engine.run('hosting protect student/site main --checks');
    engine.run('git switch -q -c broken && echo "<p>no title</p>" > index.html && git commit -q -am "Drop title" && git push -q -u origin broken');
    engine.run('gh pr create --fill');
    expect(engine.run('gh pr checks').exit).toBe(1);
    expect(out(engine, 'gh pr merge 1')[0]).toContain('проверки CI не прошли');
    const log = out(engine, 'gh run view 2 --log-failed').join('\n');
    expect(log).toContain('Error: Process completed with exit code 1.');
  });

  it('forks a project, opens a pull request upstream from the fork', () => {
    const engine = new GitSandboxEngine();
    engine.reset(`git init -q team-site
cd team-site
echo hi > README.md
git add .
git commit -q -m "Init"
cd ..
hosting create team/site --from team-site
rm -r team-site`);
    expect(out(engine, 'gh repo fork team/site --clone')).toEqual(['✓ Created fork student/site', '✓ Cloned fork', '✓ Added remote upstream https://github.com/team/site.git']);
    engine.run('cd site && git switch -q -c typo && echo hello > README.md && git commit -q -am "Fix greeting" && git push -q -u origin typo');
    expect(out(engine, 'gh pr create --fill').at(-1)).toBe('https://github.com/team/site/pull/1');
    const team = hostingOf(engine.world).find('team/site')!;
    expect(team.pulls[0].head).toEqual({ project: 'student/site', branch: 'typo' });
    expect(out(engine, 'as team gh pr merge 1 -R team/site')[0]).toBe('✓ Merged pull request team/site#1 (Fix greeting)');
  });

  it('runs GitLab pipelines by stages and uses merge request wording', () => {
    const engine = new GitSandboxEngine();
    engine.reset(`hosting flavor gitlab
mkdir app
cd app
git init -q
echo '{"name":"app","scripts":{"test":"grep -q ok status.txt"}}' > package.json
echo ok > status.txt
cat > .gitlab-ci.yml <<'EOF'
stages: [test, deploy]
test:
  stage: test
  script:
    - npm test
deploy:
  stage: deploy
  script:
    - echo "Публикую $CI_COMMIT_BRANCH"
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
EOF
git add .
git commit -q -m "Pipeline"
glab repo create app
git remote add origin https://gitlab.com/student/app.git
git push -q -u origin main`);
    const project = hostingOf(engine.world).find('student/app')!;
    const run = project.runs[0];
    expect(run.status).toBe('success');
    expect(run.jobs.map((j) => [j.name, j.status])).toEqual([
      ['test', 'success'],
      ['deploy', 'success'],
    ]);
    expect(run.jobs[1].steps[0].log).toContain('Публикую main');
    expect(out(engine, 'gh pr list')[0]).toContain('режиме GitLab');
    engine.run('git switch -q -c feat && echo fail > status.txt && git commit -q -am "Break" && git push -q -u origin feat');
    expect(project.runs[1].jobs.map((j) => j.name)).toEqual(['test']);
    expect(project.runs[1].status).toBe('failure');
    expect(out(engine, 'glab mr create --fill --yes').slice(-2)).toEqual(['!1 Break (feat)', ' https://gitlab.com/student/app/-/merge_requests/1']);
  });

  it('creates releases and tags on the hosting', () => {
    const engine = site();
    engine.run('gh repo create site --source=. --push');
    expect(out(engine, 'gh release create v1.0 --title "Первый релиз" --notes "Готово"')).toEqual(['https://github.com/student/site/releases/tag/v1.0']);
    expect(out(engine, 'git fetch')).toContain(' * [new tag]         v1.0       -> v1.0');
  });

  it('never asks for credentials', () => {
    const engine = new GitSandboxEngine();
    expect(out(engine, 'gh auth login')[0]).toContain('токены и пароли здесь не вводятся');
  });
});

describe('ci helpers', () => {
  it('matches branch filters and expands variables', () => {
    expect(branchMatches('release/*', 'release/1.0')).toBe(true);
    expect(branchMatches('release/*', 'release/1/x')).toBe(false);
    expect(branchMatches('**', 'a/b')).toBe(true);
    expect(expandVars(`echo $A '$A' \${B}`, { A: '1', B: '2' })).toBe(`echo 1 '$A' 2`);
    const ctx = { github: { ref: 'refs/heads/main', event_name: 'push' }, env: {}, runner: {} };
    expect(evalExpression("github.ref == 'refs/heads/main' && github.event_name == 'push'", ctx, false)).toBe(true);
    expect(evalExpression('${{ failure() }}', ctx, true)).toBe(true);
  });
});
