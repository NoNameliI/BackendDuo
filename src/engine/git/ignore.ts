interface Rule {
  regex: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function globToRegex(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        out += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return out;
}

/** Subset of .gitignore semantics: comments, negation, anchoring, trailing "/", *, ?, **. */
export function parseIgnore(text: string): Rule[] {
  return text.split('\n').flatMap((raw) => {
    let line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) return [];
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const body = globToRegex(line);
    return [{ regex: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`), negate, dirOnly }];
  });
}

/** True when the repository-relative file path is ignored (a match on any parent directory counts). */
export function isIgnored(rules: Rule[], path: string): boolean {
  const parts = path.split('/');
  // A file inside an ignored directory is ignored, and negation cannot re-include it.
  for (let i = 1; i < parts.length; i++) {
    if (matches(rules, parts.slice(0, i).join('/'), true)) return true;
  }
  return matches(rules, path, false);
}

function matches(rules: Rule[], path: string, isDir: boolean): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.regex.test(path)) ignored = !rule.negate;
  }
  return ignored;
}
