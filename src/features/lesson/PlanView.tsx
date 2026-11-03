import type { PlanNode, QueryPlan } from '@/engine';
import { formatMs } from '@/ui/format';
import { EmptyState } from '@/ui/Panel';

function scanTone(type: string): string {
  if (type === 'Seq Scan') return 'text-amber';
  if (type.includes('Index') || type.includes('Bitmap')) return 'text-ok';
  return 'text-fg';
}

export function PlanView({ plan }: { plan: QueryPlan | null }) {
  if (!plan) return <EmptyState>Нажмите «План», чтобы увидеть, как PostgreSQL выполнит запрос.</EmptyState>;
  return (
    <div className="h-full overflow-auto p-3 font-mono text-[12px]">
      <p className="mb-2 flex flex-wrap gap-x-4 text-faint">
        <span>стоимость: <span className="text-fg">{plan.root.totalCost.toFixed(2)}</span></span>
        {plan.planningTimeMs !== undefined && <span>планирование: {formatMs(plan.planningTimeMs)}</span>}
        {plan.executionTimeMs !== undefined && <span>выполнение: {formatMs(plan.executionTimeMs)}</span>}
      </p>
      <ul role="tree" aria-label="План выполнения">
        <Node node={plan.root} />
      </ul>
    </div>
  );
}

function Node({ node }: { node: PlanNode }) {
  return (
    <li role="treeitem" aria-expanded={node.children.length > 0 ? true : undefined} className="relative">
      <div className="rounded border border-transparent px-2 py-1 hover:border-line hover:bg-raised/50">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`font-semibold ${scanTone(node.type)}`}>{node.type}</span>
          {node.relation && (
            <span className="text-dim">
              on {node.relation}
              {node.alias && node.alias !== node.relation && ` ${node.alias}`}
            </span>
          )}
          {node.index && <span className="text-dim">using {node.index}</span>}
          <span className="ml-auto text-faint">
            cost {node.startupCost.toFixed(2)}..{node.totalCost.toFixed(2)} · rows {node.planRows}
            {node.actualRows !== undefined && <> · факт {node.actualRows}</>}
          </span>
        </div>
        {Object.entries(node.details).map(([key, value]) => (
          <p key={key} className="text-faint">
            {key}: <span className="text-dim">{value}</span>
          </p>
        ))}
      </div>
      {node.children.length > 0 && (
        <ul role="group" className="ml-3 border-l border-line pl-3">
          {node.children.map((child, i) => (
            <Node key={i} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}
