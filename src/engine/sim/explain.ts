import type { InvariantResult } from './invariants';
import type { RuleRegistry } from './rules';
import type { Journal, JournalEntry, Ms } from './types';

/** 1500 -> "1,50 с" */
export function fmtTime(at: Ms): string {
  return `${(at / 1000).toFixed(2).replace('.', ',')} с`;
}

function step(e: JournalEntry, rules?: RuleRegistry): string {
  const rule = e.rule && rules?.[e.rule] ? ` [правило: ${rules[e.rule].ru}]` : '';
  return `${e.text} (${fmtTime(e.at)})${rule}`;
}

/**
 * For the first violation takes the first evidence message and prints its journal path with rule texts;
 * the verdict of the invariant closes the explanation.
 */
export function explainFailure(r: InvariantResult, journal: Journal, rules?: RuleRegistry): string[] {
  if (r.ok) return [];
  const out: string[] = [r.text];
  const msg = r.evidence[0];
  if (msg) {
    const path = journal.filter({ msg });
    if (path.length) out.push(`${msg}: ${path.map((e) => step(e, rules)).join(' → ')}`);
  }
  return out;
}
