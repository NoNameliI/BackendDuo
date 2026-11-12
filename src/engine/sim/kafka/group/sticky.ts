/**
 * StickyAssignor, simplified relative to the Java implementation: (1) keep every valid owned partition
 * (still existing, owner subscribed, no duplicates); (2) deal the free ones to the eligible member with
 * the fewest partitions (ties by member id); (3) while a member holds 2+ more than another eligible
 * member, move one partition (largest gap first, partitions that were not originally owned first).
 * Result: counts differ by at most 1 when everyone subscribes to the same topics, and as many owned
 * partitions as that balance allows stay in place.
 */
import { cmpTP, emptyAssignment, sortAssignment, sortedMembers, tpKey, type Assignment, type Assignor, type Member, type TP } from './types';

export const sticky: Assignor = (members, partitions) => {
  const out = emptyAssignment(members);
  const sorted = sortedMembers(members);
  const all: TP[] = [];
  for (const topic of Object.keys(partitions).sort()) {
    if (!sorted.some((m) => m.topics.includes(topic))) continue;
    for (let p = 0; p < partitions[topic]; p++) all.push({ topic, partition: p });
  }
  const eligible = (m: Member, tp: TP): boolean => m.topics.includes(tp.topic);
  const holder = new Map<string, Member>();
  const originallyOwned = new Set<string>();
  for (const m of sorted) {
    for (const tp of m.owned ?? []) {
      const k = tpKey(tp);
      if (partitions[tp.topic] === undefined || tp.partition >= partitions[tp.topic] || tp.partition < 0) continue;
      if (!eligible(m, tp) || holder.has(k)) continue;
      holder.set(k, m);
      originallyOwned.add(k);
      out[m.id].push(tp);
    }
  }
  const count = (m: Member): number => out[m.id].length;
  for (const tp of all) {
    if (holder.has(tpKey(tp))) continue;
    let best: Member | null = null;
    for (const m of sorted) if (eligible(m, tp) && (best === null || count(m) < count(best))) best = m;
    if (!best) continue;
    holder.set(tpKey(tp), best);
    out[best.id].push(tp);
  }
  for (;;) {
    let move: { tp: TP; from: Member; to: Member; gap: number; fresh: boolean } | null = null;
    for (const tp of all) {
      const from = holder.get(tpKey(tp));
      if (!from) continue;
      for (const to of sorted) {
        if (to === from || !eligible(to, tp)) continue;
        const gap = count(from) - count(to);
        if (gap < 2) continue;
        const fresh = !originallyOwned.has(tpKey(tp));
        if (!move || gap > move.gap || (gap === move.gap && fresh && !move.fresh)) move = { tp, from, to, gap, fresh };
      }
    }
    if (!move) break;
    const moved = move.tp;
    out[move.from.id] = out[move.from.id].filter((x) => tpKey(x) !== tpKey(moved));
    out[move.to.id].push(moved);
    holder.set(tpKey(moved), move.to);
    originallyOwned.delete(tpKey(moved));
  }
  return sortAssignment(out);
};

/** cooperative-sticky: target = sticky(); `revoke` = owned partitions that must leave their owner first (wave 1). */
export function cooperativeSticky(members: Member[], partitions: Record<string, number>): { revoke: Record<string, TP[]>; target: Assignment } {
  const target = sticky(members, partitions);
  const revoke: Record<string, TP[]> = {};
  for (const m of members) {
    const keep = new Set(target[m.id].map(tpKey));
    revoke[m.id] = (m.owned ?? []).filter((tp) => !keep.has(tpKey(tp))).sort(cmpTP);
  }
  return { revoke, target };
}
