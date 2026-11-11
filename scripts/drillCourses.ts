// Locates drill courses on disk (the fixture and any private/*/course with engine "drill") and reads their files.
// Shared by the content validation and the visual audit; node only.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const FIXTURE_ROOT = 'src/engine/drill/fixture';

/** Every file below `dir`, keyed `/<path relative to the working directory>`. */
export function readTree(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[`/${relative(process.cwd(), path).replaceAll('\\', '/')}`] = readFileSync(path, 'utf8');
  }
  return files;
}

/** Course roots `<dir>/<name>/course` whose manifest has engine "drill" (a broken manifest is listed too). */
export function privateDrillRoots(dir = 'private'): string[] {
  const roots: string[] = [];
  if (!existsSync(dir)) return roots;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const manifest = join(dir, entry.name, 'course', 'manifest.json');
    if (!entry.isDirectory() || !existsSync(manifest)) continue;
    try {
      if (JSON.parse(readFileSync(manifest, 'utf8')).engine === 'drill') roots.push(`${dir}/${entry.name}/course`);
    } catch {
      roots.push(`${dir}/${entry.name}/course`); // let loadCourse report the broken manifest
    }
  }
  return roots;
}

export function drillRoots(): string[] {
  return [FIXTURE_ROOT, ...privateDrillRoots()];
}

/** The course the audit looks at: AUDIT_COURSE=fixture, else the first private drill course (AUDIT_PRIVATE_DIR). */
export function auditCourseRoot(env: Record<string, string | undefined> = process.env): string | null {
  if (env.AUDIT_COURSE === 'fixture') return FIXTURE_ROOT;
  return privateDrillRoots(env.AUDIT_PRIVATE_DIR ?? 'private')[0] ?? null;
}
