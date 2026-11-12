export interface TP {
  topic: string;
  partition: number;
}
export interface Member {
  id: string;
  topics: string[];
  owned?: TP[];
}
/** Every member id is present; lists are sorted by topic, then partition. */
export type Assignment = Record<string, TP[]>;
export type Assignor = (members: Member[], partitions: Record<string, number>) => Assignment;

export const cmpTP = (a: TP, b: TP): number =>
  a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : a.partition - b.partition;

export const tpKey = (tp: TP): string => `${tp.topic}/${tp.partition}`;

export const sortedMembers = (members: Member[]): Member[] =>
  members.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function emptyAssignment(members: Member[]): Assignment {
  const out: Assignment = {};
  for (const m of members) out[m.id] = [];
  return out;
}

export function sortAssignment(a: Assignment): Assignment {
  for (const id of Object.keys(a)) a[id].sort(cmpTP);
  return a;
}
