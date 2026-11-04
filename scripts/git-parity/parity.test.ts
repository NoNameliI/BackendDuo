import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitSandboxEngine } from '@/engine/git/GitSandboxEngine';
import { EPOCH } from '@/engine/git/world';
import { corpus } from './corpus';
import { commands, hasGit, runReal, SANDBOX_EPOCH } from './real';

/** Developer-only check: the same scripts in real git (never part of the app). */
const root = mkdtempSync(join(tmpdir(), 'git-parity-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

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

const only = process.env.PARITY_ONLY;

describe.skipIf(!hasGit)('sandbox output matches real git', () => {
  it('uses the sandbox clock', () => expect(SANDBOX_EPOCH).toBe(EPOCH));
  for (const [name, script] of Object.entries(corpus)) {
    if (only && !name.includes(only)) continue;
    it(name, () => {
      expect(simulate(script)).toBe(runReal(root, name, script));
    });
  }
});
