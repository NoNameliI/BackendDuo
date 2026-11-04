import { describe, expect, it } from 'vitest';
import { GitSandboxEngine, SetupError } from './GitSandboxEngine';
import { blobId } from './objects';
import { sha1 } from './sha1';
import { prompt } from './complete';
import { tokenize } from './shell';

const text = (engine: GitSandboxEngine, line: string) => engine.run(line).lines.map((l) => l.text);

describe('objects', () => {
  it('hashes like git', () => {
    expect(sha1(new TextEncoder().encode('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1(new Uint8Array(0))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1(new TextEncoder().encode('a'.repeat(1000)))).toBe('291e9a6c66994949b57ba5e650361e98fc36b1ba');
    expect(blobId('test content\n')).toBe('d670460b4b4aece5915caf5c68d12f560a9fe3e4');
    expect(blobId('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  it('gives a commit the id real git gives it', () => {
    const engine = new GitSandboxEngine({ name: 'Student', email: 'student@example.com' });
    engine.reset('git init -q site\ncd site\necho "# Site" > README.md\ngit add README.md\ngit commit -q -m "Add README"');
    expect(engine.world.repoAt('/home/student/site')!.headId()).toBe('bc0672ea2c9679191181b85af9eb9956df4bff88');
  });
});

describe('shell', () => {
  it('tokenizes quotes, operators and redirects', () => {
    expect(tokenize(`git commit -m "a b" && echo 'x y' >> f.txt`)).toEqual([
      { word: 'git' }, { word: 'commit' }, { word: '-m' }, { word: 'a b' }, { op: '&&' },
      { word: 'echo' }, { word: 'x y' }, { op: '>>' }, { word: 'f.txt' },
    ]);
    expect(tokenize('echo "open')).toEqual({ error: 'незакрытая кавычка' });
  });

  it('runs builtins and reports unknown commands', () => {
    const engine = new GitSandboxEngine();
    expect(text(engine, 'mkdir app && cd app && pwd')).toEqual(['/home/student/app']);
    engine.run('echo hello > a.txt');
    engine.run('echo world >> a.txt');
    expect(text(engine, 'cat a.txt')).toEqual(['hello', 'world']);
    expect(engine.run('vim a.txt')).toMatchObject({ exit: 127, lines: [{ text: 'bash: vim: command not found', stream: 'err' }] });
    expect(engine.run('false || true').exit).toBe(0);
    expect(engine.run('echo a | cat').exit).toBe(2);
    expect(engine.run('clear').clear).toBe(true);
  });

  it('stops a chain after a failing command', () => {
    const engine = new GitSandboxEngine();
    expect(text(engine, 'cd nowhere && echo never')).toEqual(['bash: cd: nowhere: No such file or directory']);
    expect(text(engine, 'cd nowhere ; echo always')).toEqual(['bash: cd: nowhere: No such file or directory', 'always']);
  });

  it('feeds heredocs in scripts', () => {
    const engine = new GitSandboxEngine();
    engine.runScript("cat > notes.md <<'EOF'\n# Notes\n\n- one\nEOF");
    expect(engine.world.files.get('/home/student/notes.md')).toBe('# Notes\n\n- one\n');
  });
});

describe('git commands', () => {
  it('explains what the sandbox does not support', () => {
    const engine = new GitSandboxEngine();
    expect(text(engine, 'git frob')).toEqual(["git: 'frob' is not a git command. See 'git --help'."]);
    expect(text(engine, 'git bisect start')[0]).toContain('учебной песочнице');
    expect(text(engine, 'git status')).toEqual(['fatal: not a git repository (or any of the parent directories): .git']);
  });

  it('asks for -m instead of opening an editor', () => {
    const engine = new GitSandboxEngine();
    engine.reset('git init -q r\ncd r\necho a > a\ngit add a');
    const result = engine.run('git commit');
    expect(result.exit).not.toBe(0);
    expect(result.lines.some((l) => l.text.includes('-m'))).toBe(true);
  });

  it('expands aliases without advancing the clock twice', () => {
    const engine = new GitSandboxEngine();
    engine.reset('git init -q r\ncd r\ngit config alias.ci commit\necho a > a\ngit add a');
    engine.run('git ci -q -m one');
    const commit = engine.world.repoAt(engine.world.cwd)!.headCommit()!;
    expect(commit.author.time).toBe(engine.world.now());
  });

  it('keeps each sandbox separate and in memory', () => {
    const a = new GitSandboxEngine();
    const b = new GitSandboxEngine();
    a.reset('git init -q one');
    expect(b.world.repos.size).toBe(0);
    expect(() => a.reset('git commit -m nothing')).toThrow(SetupError);
  });
});

describe('history operations', () => {
  const base = 'git init -q r\ncd r\necho a > a.txt\ngit add a.txt\ngit commit -q -m one\necho b >> a.txt\ngit commit -q -am two';

  it('recovers a commit lost by reset through the reflog', () => {
    const engine = new GitSandboxEngine();
    engine.reset(base);
    const repo = engine.world.repoAt(engine.world.cwd)!;
    const lost = repo.headId();
    engine.run('git reset --hard HEAD~1');
    expect(repo.headCommit()!.message).toBe('one\n');
    expect(text(engine, 'git reset --hard HEAD@{1}')[0]).toMatch(/^HEAD is now at [0-9a-f]{7} two$/);
    expect(repo.headId()).toBe(lost);
  });

  it('prints "Updating" before refusing to overwrite local changes, as a terminal shows it', () => {
    const engine = new GitSandboxEngine();
    engine.reset(`${base}\ngit switch -q -c f\necho c >> a.txt\ngit commit -q -am three\ngit switch -q main\necho dirty >> a.txt`);
    const result = engine.run('git merge f');
    expect(result.exit).not.toBe(0);
    expect(result.lines[0].text).toMatch(/^Updating /);
    expect(result.lines[1].text).toBe('error: Your local changes to the following files would be overwritten by merge:');
  });

  it('shows rebase progress in the prompt and finishes after --continue', () => {
    const engine = new GitSandboxEngine();
    engine.reset(`${base}\ngit switch -q -c f\necho f > a.txt\ngit commit -q -am f\ngit switch -q main\necho m > a.txt\ngit commit -q -am m\ngit switch -q f`);
    expect(engine.run('git rebase main').exit).toBe(1);
    expect(prompt(engine.world)).toBe('~/r (f|REBASE 1/1) $');
    engine.run('echo both > a.txt');
    engine.run('git add a.txt');
    expect(engine.run('git rebase --continue').exit).toBe(0);
    expect(prompt(engine.world)).toBe('~/r (f) $');
  });

  it('asks for an upstream before the first push of a new branch', () => {
    const engine = new GitSandboxEngine();
    engine.reset('git init -q --bare /srv/o.git\ngit clone -q /srv/o.git w\ncd w\necho x > x\ngit add x\ngit commit -q -m x\ngit switch -q -c topic');
    expect(text(engine, 'git push')[0]).toBe('fatal: The current branch topic has no upstream branch.');
    expect(engine.run('git push -u origin topic').exit).toBe(0);
    expect(engine.world.repos.get('/srv/o.git')!.branches.has('topic')).toBe(true);
  });
});
