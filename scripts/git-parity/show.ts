// Prints what real git outputs for corpus scripts whose name contains the argument:
// node scripts/git-parity/show.ts merge
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { corpus } from './corpus.ts';
import { runReal } from './real.ts';

const root = mkdtempSync(join(tmpdir(), 'git-show-'));
try {
  for (const [name, script] of Object.entries(corpus)) {
    if (!name.includes(process.argv[2] ?? '')) continue;
    console.log(`### ${name}\n${runReal(root, name, script)}\n`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
