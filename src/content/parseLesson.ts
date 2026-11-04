/**
 * Lesson file format (Markdown):
 *
 *   # Lesson title
 *   Theory and business case (any Markdown).
 *
 *   ## task <task-id>
 *   ```json
 *   { "type": "result", "title": "…", "hints": ["…"] }
 *   ```
 *   Task prompt (any Markdown, may contain plain ```sql examples).
 *   ```sql setup | starter | solution | check | query
 *   …
 *   ```
 *   ```sh setup | solution      (Git course: shell scripts for the Git sandbox)
 *   ```
 *   ```<language> code      (review tasks: the snippet to inspect)
 *   ```
 */

export interface RawLesson {
  title: string;
  theory: string;
  tasks: Record<string, unknown>[];
}

export class LessonParseError extends Error {}

const TASK_HEADING = /^## task[ \t]+(\S+)[ \t]*$/;
const FENCE = /^```([\w-]+)(?:[ \t]+(\w+))?[ \t]*\n([\s\S]*?)^```[ \t]*$\n?/gm;

const SHELL_ROLES: Record<string, string> = { setup: 'shellSetup', solution: 'shellSolution' };

const SQL_ROLES: Record<string, string> = {
  setup: 'setup',
  starter: 'starter',
  solution: 'solution',
  check: 'checkSql',
  query: 'query',
};

export function parseLesson(source: string): RawLesson {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const starts = lines.flatMap((line, i) => (TASK_HEADING.test(line) ? [i] : []));
  const head = lines.slice(0, starts[0] ?? lines.length);

  const titleIndex = head.findIndex((line) => /^# \S/.test(line));
  if (titleIndex === -1) throw new LessonParseError('нет заголовка урока «# …»');
  const title = head[titleIndex].slice(2).trim();
  const theory = head.slice(titleIndex + 1).join('\n').trim();

  const tasks = starts.map((start, n) => {
    const id = TASK_HEADING.exec(lines[start])![1];
    const body = lines.slice(start + 1, starts[n + 1] ?? lines.length).join('\n');
    return parseTask(id, body);
  });
  return { title, theory, tasks };
}

function parseTask(id: string, body: string): Record<string, unknown> {
  const task: Record<string, unknown> = { id };
  let meta: Record<string, unknown> | null = null;

  const prompt = body.replace(FENCE, (block, lang: string, role: string | undefined, content: string) => {
    if (lang === 'json' && !role && meta === null) {
      try {
        meta = JSON.parse(content) as Record<string, unknown>;
      } catch (e) {
        throw new LessonParseError(`задание ${id}: некорректный JSON (${(e as Error).message})`);
      }
      return '';
    }
    const key = role === 'code' ? 'code' : lang === 'sql' && role ? SQL_ROLES[role] : lang === 'sh' && role ? SHELL_ROLES[role] : undefined;
    if (!key) return block;
    if (key in task) throw new LessonParseError(`задание ${id}: блок «${role}» встречается дважды`);
    task[key] = content.trim();
    if (key === 'code') task.codeLanguage = lang;
    return '';
  });

  if (meta === null) throw new LessonParseError(`задание ${id}: нет блока \`\`\`json с параметрами`);
  return { ...(meta as Record<string, unknown>), ...task, prompt: prompt.replace(/\n{3,}/g, '\n\n').trim() };
}
