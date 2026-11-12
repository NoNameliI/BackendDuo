import { emptyAssignment, sortAssignment, sortedMembers, type Assignor } from './types';

/** RangeAssignor: per topic, subscribers sorted by id get contiguous ranges; early members take the extras. */
export const range: Assignor = (members, partitions) => {
  const out = emptyAssignment(members);
  const sorted = sortedMembers(members);
  for (const topic of Object.keys(partitions).sort()) {
    const subs = sorted.filter((m) => m.topics.includes(topic));
    if (subs.length === 0) continue;
    const total = partitions[topic];
    const n = Math.floor(total / subs.length);
    const extra = total % subs.length;
    subs.forEach((m, i) => {
      const start = n * i + Math.min(i, extra);
      const len = n + (i < extra ? 1 : 0);
      for (let p = start; p < start + len; p++) out[m.id].push({ topic, partition: p });
    });
  }
  return sortAssignment(out);
};
