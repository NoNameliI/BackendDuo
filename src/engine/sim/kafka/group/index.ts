import { range } from './range';
import { roundRobin } from './roundRobin';
import { cooperativeSticky, sticky } from './sticky';

export type { Assignment, Assignor, Member, TP } from './types';
export { range, roundRobin, sticky, cooperativeSticky };

export const ASSIGNORS: Record<'range' | 'roundrobin' | 'sticky' | 'cooperative-sticky', string> = {
  range: 'org.apache.kafka.clients.consumer.RangeAssignor',
  roundrobin: 'org.apache.kafka.clients.consumer.RoundRobinAssignor',
  sticky: 'org.apache.kafka.clients.consumer.StickyAssignor',
  'cooperative-sticky': 'org.apache.kafka.clients.consumer.CooperativeStickyAssignor',
};

/** first strategy in the leader's list supported by all members (classic protocol) */
export function chooseStrategy(memberLists: string[][]): string | null {
  if (memberLists.length === 0) return null;
  return memberLists[0].find((s) => memberLists.every((l) => l.includes(s))) ?? null;
}
