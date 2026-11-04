import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitSandboxEngine } from '@/engine/git/GitSandboxEngine';
import { EPOCH } from '@/engine/git/world';
import { corpus } from './corpus';

/** Developer-only check: the same scripts in real git (never part of the app). */
const hasGit = spawnSync('git', ['--version']).status === 0;
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const root = mkdtempSync(join(tmpdir(), 'git-parity-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Splits a script into commands, keeping heredoc bodies with their command. */
function commands(script: string): string[] {
  const lines = script.trim().split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const heredoc = /<<'(\w+)'/.exec(lines[i]);
    if (!heredoc) {
      out.push(lines[i]);
      continue;
    }
    const block = [lines[i]];
    while (++i < lines.length && lines[i] !== heredoc[1]) block.push(lines[i]);
    block.push(heredoc[1]);
    out.push(block.join('\n'));
  }
  return out;
}

function simulate(script: string): string {
  const engine = new GitSandboxEngine({ name: 'Student', email: 'student@example.com' });
  const out: string[] = [];
  for (const command of commands(script)) {
    out.push(`$ ${command.split('\n')[0]}`);
    const result = command.includes('\n') ? engine.runScript(command) : engine.run(command);
    out.push(...result.lines.map((l) => l.text));
  }
  return out.join('\n');
}

function real(name: string, script: string): string {
  const dir = join(root, name.replace(/\W+/g, '-'));
  const home = join(dir, 'home', 'student');
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n\tname = Student\n\temail = student@example.com\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n\tpager = cat\n[color]\n\tui = false\n[log]\n\tdecorate = short\n',
  );
  const body = commands(script)
    .map((c) => `echo ${JSON.stringify(`$ ${c.split('\n')[0]}`).replace(/\$/g, '\\$')}\n${c}`)
    .join('\n');
  const wrapper = `n=0\ngit() { n=$((n+1)); t=$((${EPOCH}+60*n)); GIT_AUTHOR_DATE="$t +0300" GIT_COMMITTER_DATE="$t +0300" command git "$@"; }\ncd ~\n${body}\n`;
  writeFileSync(join(dir, 'script.sh'), wrapper);
  const output = execFileSync(bash, ['-c', `bash ./script.sh 2>&1; true`], {
    cwd: dir,
    env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', LANG: 'C', TERM: 'dumb' },
    encoding: 'utf8',
  });
  const fwd = home.replace(/\\/g, '/');
  return output
    .replaceAll(fwd, '/home/student')
    .replaceAll(fwd.replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`), '/home/student')
    .replace(/\n$/, '');
}

describe.skipIf(!hasGit)('sandbox output matches real git', () => {
  for (const [name, script] of Object.entries(corpus)) {
    it(name, () => {
      expect(simulate(script)).toBe(real(name, script));
    });
  }
});
