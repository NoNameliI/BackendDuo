export interface Command {
  id: string;
  group: string;
  title: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
}

const normalize = (text: string) => text.toLowerCase().replace(/ё/g, 'е');

/** Every word of the query must occur in the title or hint; order of commands is preserved. */
export function filterCommands(commands: Command[], query: string, limit = 12): Command[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands.slice(0, limit);
  return commands
    .filter((c) => {
      const haystack = normalize(`${c.title} ${c.hint ?? ''} ${c.group}`);
      return words.every((w) => haystack.includes(w));
    })
    .slice(0, limit);
}

/** «Go to course» commands for every course except the active one. */
export function courseCommands(
  list: { id: string; title: string }[],
  activeId: string,
  go: (fn: () => void) => () => void,
  open: (id: string) => void,
): Command[] {
  return list
    .filter((c) => c.id !== activeId)
    .map((c) => ({ id: `course:${c.id}`, group: 'Курсы', title: `Перейти в курс «${c.title}»`, run: go(() => open(c.id)) }));
}
