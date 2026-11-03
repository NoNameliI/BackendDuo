import type { PlanNode, QueryPlan } from '@/engine';

export interface PlanConditions {
  forbidSeqScan: string[];
  requireIndexOn: string[];
  maxCostRatio?: number;
}

const INDEX_NODES = new Set(['Index Scan', 'Index Only Scan', 'Bitmap Heap Scan']);

function nodes(root: PlanNode): PlanNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

/** Deterministic plan checks: node types and planner cost, never wall-clock time. */
export function evaluatePlan(plan: QueryPlan, baselineCost: number, conditions: PlanConditions): string[] {
  const all = nodes(plan.root);
  const problems: string[] = [];

  for (const table of conditions.forbidSeqScan) {
    if (all.some((n) => n.type === 'Seq Scan' && n.relation === table)) {
      problems.push(`По таблице ${table} всё ещё идёт Seq Scan — PostgreSQL читает её целиком`);
    }
  }
  for (const table of conditions.requireIndexOn) {
    if (!all.some((n) => INDEX_NODES.has(n.type) && n.relation === table)) {
      problems.push(`Для таблицы ${table} не используется индекс`);
    }
  }
  if (conditions.maxCostRatio !== undefined) {
    const limit = baselineCost * conditions.maxCostRatio;
    if (plan.root.totalCost > limit) {
      problems.push(
        `Стоимость плана ${plan.root.totalCost.toFixed(0)}, а нужно не больше ${limit.toFixed(0)} (исходная — ${baselineCost.toFixed(0)})`,
      );
    }
  }
  return problems;
}
