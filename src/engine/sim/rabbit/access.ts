export type Permission = 'configure' | 'write' | 'read';

export interface PermissionSet {
  configure: string;
  write: string;
  read: string;
}

/** Operations and the checks they need: [permission, resource kind]. */
export const permissionTable = {
  'exchange.declare': [['configure', 'exchange']],
  'exchange.delete': [['configure', 'exchange']],
  'queue.declare': [['configure', 'queue']],
  'queue.delete': [['configure', 'queue']],
  'queue.bind': [
    ['write', 'queue'],
    ['read', 'exchange'],
  ],
  'basic.publish': [['write', 'exchange']],
  'basic.get': [['read', 'queue']],
  'basic.consume': [['read', 'queue']],
} as const satisfies Record<string, readonly (readonly [Permission, 'queue' | 'exchange'])[]>;

export type Operation = keyof typeof permissionTable;

/** A permission pattern is an unanchored regular expression; the empty pattern means «^$», i.e. nothing is allowed. */
export function allows(pattern: string, resource: string): boolean {
  try {
    return new RegExp(pattern === '' ? '^$' : pattern).test(resource);
  } catch {
    return false;
  }
}

export interface Denied {
  permission: Permission;
  kind: 'queue' | 'exchange';
  resource: string;
}

/** First failed check of `op`; `resources` gives the queue and/or exchange names the operation touches. */
export function checkAccess(
  perms: PermissionSet | undefined,
  op: Operation,
  resources: { queue?: string; exchange?: string },
): Denied | null {
  for (const [permission, kind] of permissionTable[op]) {
    const resource = resources[kind] ?? '';
    if (!perms || !allows(perms[permission], resource)) return { permission, kind, resource };
  }
  return null;
}
