import { flag, parseArgs, value } from '../args';
import { cleanMessage, tagId } from '../objects';
import { fatal, requireRepo, type Command } from './common';

const globRegex = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

export const tag: Command = (ctx, argv) => {
  const p = parseArgs(argv, {
    flags: { '-a': 'annotate', '--annotate': 'annotate', '-m': 'message', '--message': 'message', '-d': 'delete', '--delete': 'delete', '-l': 'list', '--list': 'list', '-f': 'force', '--force': 'force', '-n': 'lines' },
    values: ['message'],
  });
  if (p.error) return fatal(ctx, p.error);
  const repo = requireRepo(ctx);
  if (!repo) return 128;

  if (flag(p, 'delete')) {
    let code = 0;
    for (const name of p.args) {
      const t = repo.tags.get(name);
      if (!t) {
        ctx.err(`error: tag '${name}' not found.`);
        code = 1;
        continue;
      }
      repo.tags.delete(name);
      ctx.out(`Deleted tag '${name}' (was ${repo.short(t.annotation?.id ?? t.target)})`);
    }
    return code;
  }
  if (flag(p, 'list') || p.args.length === 0) {
    const pattern = p.args[0] ? globRegex(p.args[0]) : null;
    for (const name of [...repo.tags.keys()].sort()) if (!pattern || pattern.test(name)) ctx.out(name);
    return 0;
  }

  const [name, rev = 'HEAD'] = p.args;
  if (!/^[^\s~^:?*[\\]+$/.test(name) || name.includes('..')) return fatal(ctx, `'${name}' is not a valid tag name.`);
  if (repo.tags.has(name) && !flag(p, 'force')) return fatal(ctx, `tag '${name}' already exists`);
  const target = repo.resolve(rev);
  if (!target) return fatal(ctx, `Failed to resolve '${rev}' as a valid ref.`);
  const message = value(p, 'message');
  if (flag(p, 'annotate') && message === undefined) {
    ctx.err('error: в учебной песочнице нет редактора для описания тега.');
    ctx.err(`hint: укажите его в команде: git tag -a ${name} -m "Описание"`);
    return 1;
  }
  const old = repo.tags.get(name);
  if (message !== undefined) {
    const tagger = repo.signature();
    const text = cleanMessage(message);
    repo.tags.set(name, { target, annotation: { id: tagId({ object: target, name, tagger, message: text }), tagger, message: text } });
  } else repo.tags.set(name, { target });
  if (old) ctx.out(`Updated tag '${name}' (was ${repo.short(old.annotation?.id ?? old.target)})`);
  return 0;
};
