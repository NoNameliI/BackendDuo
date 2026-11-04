import { describe, expect, it } from 'vitest';
import { commonPrefix, completions, prompt } from '@/engine/git/complete';
import { GitSandboxEngine } from '@/engine/git/GitSandboxEngine';
import { layoutGraph } from './graphLayout';

function sandbox(setup: string) {
  const engine = new GitSandboxEngine();
  engine.reset(setup);
  return engine;
}

const BRANCHED = `git init -q site
cd site
echo a > a.txt
git add a.txt
git commit -q -m base
git switch -q -c feature
echo b > b.txt
git add b.txt
git commit -q -m feature
git switch -q main
echo c > c.txt
git add c.txt
git commit -q -m main-work`;

describe('graph layout', () => {
  it('puts diverged branches into separate lanes', () => {
    const engine = sandbox(BRANCHED);
    const layout = layoutGraph(engine.world.repoAt(engine.world.cwd)!);
    expect(layout.nodes.map((n) => [n.subject, n.lane])).toEqual([
      ['main-work', 0],
      ['feature', 1],
      ['base', 0],
    ]);
    expect(layout.nodes[0].refs).toEqual(['HEAD -> main']);
    expect(layout.nodes[0].head).toBe(true);
    expect(layout.edges).toHaveLength(2);
    expect(layout.lanes).toBe(2);
  });
});

describe('terminal helpers', () => {
  it('shows the branch in the prompt', () => {
    const engine = sandbox(BRANCHED);
    expect(prompt(engine.world)).toBe('~/site (main) $');
    engine.run('cd ..');
    expect(prompt(engine.world)).toBe('~ $');
  });

  it('completes commands, branches and changed files', () => {
    const engine = sandbox(`${BRANCHED}\necho new > notes.md`);
    expect(completions(engine.world, 'gi')).toEqual(['git']);
    expect(completions(engine.world, 'git sw')).toEqual(['switch']);
    expect(completions(engine.world, 'git switch fe')).toEqual(['feature']);
    expect(completions(engine.world, 'git add ')).toEqual(['notes.md']);
    expect(commonPrefix(['status', 'stash'])).toBe('sta');
  });
});

describe('graph layout of a merge', () => {
  it('joins the merged branch back into the main lane', () => {
    const engine = sandbox(`${BRANCHED}\ngit merge -q --no-edit feature`);
    const layout = layoutGraph(engine.world.repoAt(engine.world.cwd)!);
    expect(layout.nodes.map((n) => [n.subject, n.lane])).toEqual([
      ["Merge branch 'feature'", 0],
      ['main-work', 0],
      ['feature', 1],
      ['base', 0],
    ]);
    expect(layout.edges.filter((e) => e.from.row === 0)).toHaveLength(2);
  });
});
