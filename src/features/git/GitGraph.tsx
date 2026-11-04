import { useMemo } from 'react';
import { EmptyState } from '@/ui/Panel';
import { layoutGraph, type GraphEdge } from './graphLayout';
import { useGitSandbox } from './gitSandbox';

const ROW = 30;
const LANE = 18;
const PAD = 14;
const COLORS = ['var(--ok)', 'var(--nav)', 'var(--amber)', 'var(--err)', 'var(--dim)'];
const color = (lane: number) => COLORS[lane % COLORS.length];

const x = (lane: number) => PAD + lane * LANE;
const y = (row: number) => ROW / 2 + row * ROW;

function edgePath({ from, to }: GraphEdge): string {
  const [x1, y1, x2, y2] = [x(from.lane), y(from.row), x(to.lane), y(to.row)];
  if (x1 === x2) return `M${x1},${y1} L${x2},${y2}`;
  // Branching out to the right bends next to the child; joining back to the left bends next to the parent.
  if (x2 > x1) return `M${x1},${y1} C${x1},${y1 + ROW * 0.6} ${x2},${y1 + ROW * 0.4} ${x2},${y1 + ROW} L${x2},${y2}`;
  return `M${x1},${y1} L${x1},${y2 - ROW} C${x1},${y2 - ROW * 0.4} ${x2},${y2 - ROW * 0.6} ${x2},${y2}`;
}

function RefChip({ name }: { name: string }) {
  const head = name.startsWith('HEAD');
  const tag = name.startsWith('tag: ');
  const remote = !head && !tag && name.includes('/');
  const tone = head ? 'border-ok/50 text-ok' : tag ? 'border-amber/50 text-amber' : remote ? 'border-nav/40 text-nav' : 'border-line-strong text-fg';
  return <span className={`rounded-sm border px-1.5 py-px text-[11px] leading-4 ${tone}`}>{name.replace('HEAD -> ', 'HEAD → ')}</span>;
}

/** Commit graph of the repository in the current directory. */
export function GitGraph() {
  const engine = useGitSandbox((s) => s.engine);
  const version = useGitSandbox((s) => s.version);
  const repo = engine.world.repoAt(engine.world.cwd);
  const layout = useMemo(() => (repo ? layoutGraph(repo) : null), [repo, version]);

  if (!repo) return <EmptyState>Здесь нет репозитория. Перейдите в папку проекта или выполните git init.</EmptyState>;
  if (!layout?.nodes.length) {
    return <EmptyState>Коммитов пока нет. Подготовьте файлы (git add) и сделайте первый коммит (git commit -m "…").</EmptyState>;
  }
  const width = PAD * 2 + (layout.lanes - 1) * LANE;
  return (
    <div className="h-full overflow-auto p-2">
      <div className="relative" style={{ height: layout.nodes.length * ROW }}>
        <svg width={width} height={layout.nodes.length * ROW} className="absolute left-0 top-0" aria-hidden>
          {layout.edges.map((edge, i) => (
            <path key={i} d={edgePath(edge)} fill="none" stroke={color(edge.lane)} strokeWidth={2} />
          ))}
          {layout.nodes.map((node) => (
            <circle
              key={node.id}
              cx={x(node.lane)}
              cy={y(node.row)}
              r={node.head ? 6 : 5}
              fill={node.head ? color(node.lane) : 'var(--panel)'}
              stroke={color(node.lane)}
              strokeWidth={2}
            />
          ))}
        </svg>
        <ol aria-label="История коммитов" className="relative" style={{ paddingLeft: width + 4 }}>
          {layout.nodes.map((node) => (
            <li key={node.id} className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-[13px]" style={{ height: ROW }}>
              <span className="font-mono text-[12px] text-faint">{node.short}</span>
              {node.refs.map((ref) => (
                <RefChip key={ref} name={ref} />
              ))}
              <span className={`truncate ${node.head ? 'text-fg' : 'text-dim'}`}>{node.subject}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
