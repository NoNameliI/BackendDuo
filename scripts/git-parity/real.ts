import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Must equal the sandbox clock start (checked by the parity test). */
export const SANDBOX_EPOCH = 1767942000;

export const hasGit = spawnSync('git', ['--version']).status === 0;
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

/** Splits a script into commands, keeping heredoc bodies with their command. */
export function commands(script: string): string[] {
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

const GITCONFIG = `[user]
\tname = Student
\temail = student@example.com
[init]
\tdefaultBranch = main
[core]
\tautocrlf = false
\tpager = cat
[color]
\tui = false
[log]
\tdecorate = short
[pull]
\trebase = false
`;

/**
 * Runs a corpus script in real git (developer machines only): a fresh HOME under `root`, the sandbox's
 * clock (each git call is one minute later), every command echoed as "$ command".
 */
export function runReal(root: string, name: string, script: string): string {
  const dir = join(root, name.replace(/\W+/g, '-'));
  const home = join(dir, 'home', 'student');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(dir, 'srv'), { recursive: true });
  writeFileSync(join(home, '.gitconfig'), GITCONFIG);
  const body = commands(script)
    .map((c) => `echo ${JSON.stringify(`$ ${c.split('\n')[0]}`).replace(/\$/g, '\\$')}\n${c}`)
    .join('\n');
  const srv = join(dir, 'srv').replace(/\\/g, '/');
  const wrapper = `n=0\ngit() { n=$((n+1)); t=$((${SANDBOX_EPOCH}+60*n)); GIT_AUTHOR_DATE="$t +0300" GIT_COMMITTER_DATE="$t +0300" command git "$@"; }\ncd ~\n${body.replaceAll('/srv/', `${srv}/`)}\n`;
  writeFileSync(join(dir, 'script.sh'), wrapper);
  const output = execFileSync(bash, ['-c', 'bash ./script.sh 2>&1; true'], {
    cwd: dir,
    env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', LANG: 'C', TERM: 'dumb' },
    encoding: 'utf8',
  });
  // Paths of the temporary root are shown as the sandbox's: /home/student and /srv.
  // Progress lines rewritten with "\r" ("Rebasing (1/2)") end up as what a terminal would show.
  let text = output.replace(/[^\n]*\r(?!\n)/g, '');
  for (const [real, shown] of [
    [home, '/home/student'],
    [join(dir, 'srv'), '/srv'],
  ]) {
    const fwd = real.replace(/\\/g, '/');
    text = text.replaceAll(fwd, shown).replaceAll(fwd.replace(/^([A-Za-z]):/, (_, d: string) => `/${d.toLowerCase()}`), shown);
  }
  return text.replace(/\n$/, '');
}
