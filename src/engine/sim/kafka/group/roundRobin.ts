import { emptyAssignment, sortAssignment, sortedMembers, type Assignor } from './types';

/** RoundRobinAssignor: partitions (topics alphabetical, ascending) dealt over a circular member list, skipping non-subscribers. */
export const roundRobin: Assignor = (members, partitions) => {
  const out = emptyAssignment(members);
  const sorted = sortedMembers(members);
  if (sorted.length === 0) return out;
  const wanted = new Set(sorted.flatMap((m) => m.topics));
  let next = 0;
  for (const topic of Object.keys(partitions).sort()) {
    if (!wanted.has(topic)) continue;
    for (let p = 0; p < partitions[topic]; p++) {
      while (!sorted[next % sorted.length].topics.includes(topic)) next++;
      out[sorted[next % sorted.length].id].push({ topic, partition: p });
      next++;
    }
  }
  return sortAssignment(out);
};
