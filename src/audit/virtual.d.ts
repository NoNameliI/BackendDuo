// Served only by vite.audit.config.ts (the audit dev server); the production build has no such module.
declare module 'virtual:audit-course' {
  const course: { root: string; files: Record<string, string> } | null;
  export default course;
}
