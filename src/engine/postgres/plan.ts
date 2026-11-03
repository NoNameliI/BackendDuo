import type { PlanNode, QueryPlan } from '../types';

type RawPlan = Record<string, unknown> & { Plans?: RawPlan[] };

const DETAIL_KEYS = [
  'Join Type',
  'Strategy',
  'Index Cond',
  'Recheck Cond',
  'Hash Cond',
  'Merge Cond',
  'Join Filter',
  'Filter',
  'Rows Removed by Filter',
  'Sort Key',
  'Group Key',
  'Scan Direction',
];

function toNode(raw: RawPlan): PlanNode {
  const details: Record<string, string> = {};
  for (const key of DETAIL_KEYS) {
    const value = raw[key];
    if (value !== undefined && value !== null) details[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return {
    type: String(raw['Node Type']),
    relation: raw['Relation Name'] as string | undefined,
    alias: raw['Alias'] as string | undefined,
    index: raw['Index Name'] as string | undefined,
    startupCost: Number(raw['Startup Cost']),
    totalCost: Number(raw['Total Cost']),
    planRows: Number(raw['Plan Rows']),
    actualRows: raw['Actual Rows'] as number | undefined,
    actualTimeMs: raw['Actual Total Time'] as number | undefined,
    loops: raw['Actual Loops'] as number | undefined,
    details,
    children: (raw.Plans ?? []).map(toNode),
  };
}

/** Parses the single element of `EXPLAIN (FORMAT JSON)` output. */
export function toQueryPlan(json: unknown, analyzed: boolean): QueryPlan {
  const [top] = json as [{ Plan: RawPlan; 'Planning Time'?: number; 'Execution Time'?: number }];
  return {
    root: toNode(top.Plan),
    analyzed,
    planningTimeMs: top['Planning Time'],
    executionTimeMs: top['Execution Time'],
  };
}

export function walkPlan(node: PlanNode, visit: (node: PlanNode) => void): void {
  visit(node);
  node.children.forEach((child) => walkPlan(child, visit));
}
