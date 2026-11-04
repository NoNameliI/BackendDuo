import { decorations } from '@/engine/git/commands/history';
import type { Repo } from '@/engine/git/world';

export interface GraphNode {
  id: string;
  short: string;
  subject: string;
  row: number;
  lane: number;
  refs: string[];
  head: boolean;
}

export interface GraphEdge {
  from: { row: number; lane: number };
  to: { row: number; lane: number };
  /** Lane whose color the edge takes. */
  lane: number;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  lanes: number;
}

/** Commits reachable from any ref, newest first with children above parents, each in a lane. */
export function layoutGraph(repo: Repo): GraphLayout {
  const starts = [repo.headId(), ...repo.branches.values(), ...repo.remoteBranches.values(), ...[...repo.tags.values()].map((t) => t.target)]
    .filter((id): id is string => Boolean(id && repo.commits.has(id)));
  const reachable = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    stack.push(...repo.commits.get(id)!.parents);
  }

  // Topological order (children first), ties broken by newer committer time.
  const children = new Map<string, number>();
  for (const id of reachable) for (const p of repo.commits.get(id)!.parents) children.set(p, (children.get(p) ?? 0) + 1);
  const time = (id: string) => repo.commits.get(id)!.committer.time;
  const ready = [...reachable].filter((id) => !children.get(id));
  const order: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => time(a) - time(b) || (a < b ? -1 : 1));
    const id = ready.pop()!;
    order.push(id);
    for (const p of repo.commits.get(id)!.parents) {
      children.set(p, children.get(p)! - 1);
      if (children.get(p) === 0) ready.push(p);
    }
  }

  const lanes: (string | null)[] = [];
  const position = new Map<string, { row: number; lane: number }>();
  const nodes: GraphNode[] = [];
  const head = repo.headId();
  order.forEach((id, row) => {
    let lane = lanes.indexOf(id);
    if (lane === -1) {
      lane = lanes.indexOf(null);
      if (lane === -1) lane = lanes.push(null) - 1;
    }
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === id) lanes[i] = null;
    const commit = repo.commits.get(id)!;
    commit.parents.forEach((p, n) => {
      if (n === 0 && !lanes.includes(p)) lanes[lane] = p;
      else if (!lanes.includes(p)) {
        const free = lanes.indexOf(null);
        if (free === -1) lanes.push(p);
        else lanes[free] = p;
      }
    });
    while (lanes.length && lanes.at(-1) === null) lanes.pop();
    position.set(id, { row, lane });
    nodes.push({
      id,
      short: repo.short(id),
      subject: commit.message.split('\n')[0],
      row,
      lane,
      refs: decorations(repo, id),
      head: id === head,
    });
  });

  const edges: GraphEdge[] = [];
  for (const node of nodes) {
    repo.commits.get(node.id)!.parents.forEach((p, n) => {
      const to = position.get(p)!;
      const from = { row: node.row, lane: node.lane };
      edges.push({ from, to, lane: n === 0 && to.lane !== from.lane && to.lane < from.lane ? from.lane : Math.max(from.lane, to.lane) });
    });
  }
  return { nodes, edges, lanes: Math.max(1, ...nodes.map((n) => n.lane + 1)) };
}
