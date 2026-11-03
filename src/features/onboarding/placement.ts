import type { Placement, Task } from '@/content/loadCourse';

export type PlacementStep =
  | { kind: 'question'; blockIndex: number; question: Task; number: number; total: number }
  | { kind: 'done'; passedBlocks: string[]; failedBlock: string | null; unlocks: string[] };

/**
 * Adaptive placement: blocks go from easy to hard. A block passes as soon as `passThreshold` answers are
 * correct and fails as soon as that becomes impossible; the test stops at the first failed block.
 */
export function placementStep(placement: Placement, answers: Record<string, boolean>): PlacementStep {
  const passed: string[] = [];
  const total = placement.blocks.reduce((n, b) => n + b.questions.length, 0);
  const asked = Object.keys(answers).length;

  for (const [blockIndex, block] of placement.blocks.entries()) {
    const given = block.questions.filter((q) => q.id in answers);
    const correct = given.filter((q) => answers[q.id]).length;
    const wrong = given.length - correct;

    if (correct >= placement.passThreshold) {
      passed.push(block.id);
      continue;
    }
    if (wrong > block.questions.length - placement.passThreshold) {
      return done(placement, passed, block.id);
    }
    const question = block.questions.find((q) => !(q.id in answers))!;
    return { kind: 'question', blockIndex, question, number: asked + 1, total };
  }
  return done(placement, passed, null);
}

function done(placement: Placement, passedBlocks: string[], failedBlock: string | null): PlacementStep {
  const unlocks = placement.blocks.filter((b) => passedBlocks.includes(b.id)).flatMap((b) => b.unlocks);
  return { kind: 'done', passedBlocks, failedBlock, unlocks };
}
