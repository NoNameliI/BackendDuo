import { CourseError, loadCourse, type Course } from './loadCourse';
import { platformSchema, type Level } from './schema';

export interface Platform {
  levels: Level[];
}

export interface Catalog {
  courses: Course[];
  platform: Platform;
}

/**
 * Loads every course listed in `platform.json`, in that order. Each course lives in `root/<id>/` and is
 * validated on its own; all problems of all courses are reported together.
 */
export function loadCatalog(files: Record<string, string>, root = '/courses'): Catalog {
  const problems: string[] = [];
  const path = `${root}/platform.json`;
  let json: unknown;
  try {
    json = JSON.parse(files[path] ?? 'null');
  } catch (e) {
    throw new CourseError([`${path}: ${(e as Error).message}`]);
  }
  const parsed = platformSchema.safeParse(json);
  if (!parsed.success) {
    throw new CourseError(
      files[path] === undefined
        ? [`${path}: файл не найден`]
        : parsed.error.issues.map((i) => `${path}${i.path.length ? ` › ${i.path.join('.')}` : ''}: ${i.message}`),
    );
  }

  const courses: Course[] = [];
  for (const id of parsed.data.courses) {
    try {
      const course = loadCourse(files, `${root}/${id}`);
      if (course.id !== id) problems.push(`${root}/${id}/manifest.json: id «${course.id}» не совпадает с папкой «${id}»`);
      courses.push(course);
    } catch (e) {
      if (!(e instanceof CourseError)) throw e;
      problems.push(...e.problems);
    }
  }
  if (problems.length > 0) throw new CourseError(problems);
  return { courses, platform: { levels: parsed.data.levels } };
}
