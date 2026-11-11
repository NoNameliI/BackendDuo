// Visual audit of the drill trainer: `npm run audit:visual` renders every number, level and a set of seeds with the
// real number view in headless Chromium at several window sizes and themes, and writes private/audit/report.md.
// `--check-dist` instead proves that no course text is in the production build. Env: AUDIT_ONLY=1,6 AUDIT_SEEDS=10
// AUDIT_COURSE=fixture AUDIT_PRIVATE_DIR=dir AUDIT_CHROMIUM=path. Writes only under private/audit/.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { auditCourseRoot, privateDrillRoots, readTree } from './drillCourses.ts';

const OUT = resolve('private', 'audit');
const PORT = 1421;
const LIMIT_MS = 5 * 60 * 1000;

const PROFILES = [
  { id: 'dark-1100x680', w: 1100, h: 680, theme: 'dark' },
  { id: 'dark-1280x800', w: 1280, h: 800, theme: 'dark' },
  { id: 'dark-1920x1080', w: 1920, h: 1080, theme: 'dark' },
  { id: 'light-1280x800', w: 1280, h: 800, theme: 'light' },
];

function safe(path) {
  const full = resolve(path);
  if (full !== OUT && !full.startsWith(OUT + sep)) throw new Error('refusing to write outside private/audit');
  return full;
}
const write = (name, text) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(safe(join(OUT, name)), text);
};

// --- dist check -------------------------------------------------------------------------------------------------

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

function checkDist() {
  if (!existsSync('dist')) {
    console.error('dist is missing: run npm run build first');
    return 2;
  }
  const roots = privateDrillRoots(process.env.AUDIT_PRIVATE_DIR ?? 'private');
  if (roots.length === 0) {
    console.log('dist check skipped: no drill course under private/*/course');
    return 0;
  }
  // The first 40 characters of the longest lines of every course file, plain and as an escaped JS string.
  const probes = new Set();
  for (const root of roots) {
    for (const text of Object.values(readTree(root))) {
      const lines = [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 40))];
      for (const line of lines.sort((a, b) => b.length - a.length).slice(0, 25)) {
        const head = line.slice(0, 40);
        probes.add(head);
        probes.add(JSON.stringify(head).slice(1, -1).replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
      }
    }
  }
  const text = /\.(js|mjs|css|html|json|map|txt|md|svg|webmanifest)$/i;
  let leaks = 0;
  for (const file of walk('dist').filter((f) => text.test(f))) {
    const body = readFileSync(file, 'utf8');
    if ([...probes].some((p) => body.includes(p))) leaks++;
  }
  console.log(leaks === 0 ? 'dist clean' : `dist leaks: ${leaks} files`);
  return leaks === 0 ? 0 : 1;
}

if (process.argv.includes('--check-dist')) process.exit(checkDist());

// --- browser ----------------------------------------------------------------------------------------------------

function chromiumPath() {
  if (process.env.AUDIT_CHROMIUM) return process.env.AUDIT_CHROMIUM;
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const newest = (prefix, rel) => {
    if (!existsSync(base)) return null;
    const dirs = readdirSync(base).filter((d) => d.startsWith(prefix)).sort().reverse();
    return dirs.map((d) => join(base, d, rel)).find((p) => existsSync(p)) ?? null;
  };
  const found =
    newest('chromium_headless_shell-', join('chrome-headless-shell-win64', 'chrome-headless-shell.exe')) ?? newest('chromium-', join('chrome-win64', 'chrome.exe'));
  if (!found) throw new Error('Chromium not found: set AUDIT_CHROMIUM to chrome.exe or install it under %LOCALAPPDATA%\\ms-playwright');
  return found;
}

// --- report -----------------------------------------------------------------------------------------------------

// Same rule as dedupeKey in src/audit/rules.ts (that file is TypeScript with app aliases, not loadable here).
const keyOf = (n, rule, where) => `${n}|${rule}|${where.replace(/:nth-[a-z-]+\([^)]*\)/g, '')}`;
const hex = (seed) => (seed >>> 0).toString(16).padStart(8, '0');

function group(defects) {
  const groups = new Map();
  for (const d of defects) {
    const k = keyOf(d.c.n, d.rule, d.where);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { n: d.c.n, rule: d.rule, where: d.where.replace(/:nth-[a-z-]+\([^)]*\)/g, ''), severity: d.severity, detail: d.detail, example: d, seeds: new Set(), cases: [] }));
    if (d.severity === 'critical' && g.severity !== 'critical') Object.assign(g, { severity: 'critical', detail: d.detail, example: d });
    g.seeds.add(`${d.c.level}:${d.c.seed}:${d.c.view}`);
    if (g.cases.length < 200) g.cases.push({ level: d.c.level, seed: d.c.seed, view: d.c.view, tag: d.c.tag, profile: d.profile, box: d.box, detail: d.detail });
  }
  return [...groups.values()].sort((a, b) => a.n - b.n || (a.severity === b.severity ? a.rule.localeCompare(b.rule) : a.severity === 'critical' ? -1 : 1));
}

const cell = (s) => String(s).replaceAll('|', '\\|');

function render(meta, groups, totals) {
  const row = (g) => {
    const e = g.example;
    const profile = PROFILES.find((p) => p.id === e.profile);
    const where = `${e.c.view === 'theory' ? 'теория' : e.c.level} · ${hex(e.c.seed)} · ${profile.w}×${profile.h} · ${profile.theme === 'dark' ? 'тёмная' : 'светлая'}`;
    return `| ${g.n} | ${g.rule} | ${g.severity === 'critical' ? 'критично' : 'мелко'} | ${g.seeds.size} (из ${meta.perNumber.get(g.n)}) | ${where} | \`${cell(g.where)}\` | ${cell(g.detail)} |`;
  };
  const head = '| № | Дефект | Важность | Зёрен (из N) | Пример: уровень · зерно (hex) · окно · тема | Где | Деталь |\n|---|---|---|---|---|---|---|';
  const critical = groups.filter((g) => g.severity === 'critical');
  const minor = groups.filter((g) => g.severity === 'minor');
  const summary = new Map();
  for (const g of groups) {
    const k = `${g.n}|${g.rule}`;
    summary.set(k, (summary.get(k) ?? 0) + 1);
  }
  const lines = [
    '# Визуальный аудит тренажёра',
    '',
    `- Дата: ${meta.date}`,
    `- Курс: \`${meta.root}\``,
    `- Случаев на окно: ${meta.cases} (зёрна 1..${meta.seeds}, «плохие» зёрна, теория); окон и тем: ${PROFILES.map((p) => `${p.w}×${p.h} ${p.theme === 'dark' ? 'тёмная' : 'светлая'}`).join(', ')}`,
    `- Длительность: ${meta.seconds} с`,
    `- Дефектов (уникальных по номеру, правилу и месту): критичных ${critical.length}, мелких ${minor.length}`,
    '',
    '## Сводка (номер × дефект × число мест)',
    '',
    '| № | Дефект | Мест |',
    '|---|---|---|',
    ...[...summary].map(([k, v]) => `| ${k.split('|')[0]} | ${k.split('|')[1]} | ${v} |`),
    '',
    '## Критичные',
    '',
    critical.length ? head : 'Нет.',
    ...critical.map(row),
    '',
    '## Мелкие',
    '',
    'Причину принятия каждого мелкого дефекта вносят после разбора.',
    '',
    minor.length ? `${head.split('\n')[0]} Причина принятия |\n${head.split('\n')[1]}---|` : 'Нет.',
    ...minor.map((g) => `${row(g)} |`),
    '',
  ];
  return { text: lines.join('\n'), summary: [...summary], totals };
}

// --- run --------------------------------------------------------------------------------------------------------

async function main() {
  const root = auditCourseRoot();
  if (!root) {
    console.log('audit:visual skipped: no drill course under private/*/course');
    return 0;
  }
  const started = Date.now();
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright-core');
  const profileDir = safe(join(OUT, '.profile'));
  mkdirSync(OUT, { recursive: true });
  for (const f of existsSync(OUT) ? readdirSync(OUT) : []) if (/\.png$|^report\.md$|^results\.json$/.test(f)) rmSync(safe(join(OUT, f)));

  const server = await createServer({ configFile: 'vite.audit.config.ts', logLevel: 'error', clearScreen: false });
  let context;
  try {
    await server.listen();
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      executablePath: chromiumPath(),
      deviceScaleFactor: 1,
      locale: 'ru-RU',
      viewport: { width: 1280, height: 800 },
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'],
    });
    const url = (theme) => `http://127.0.0.1:${PORT}/src/audit/audit.html?theme=${theme}`;
    const open = async (profile) => {
      const page = await context.newPage();
      await page.setViewportSize({ width: profile.w, height: profile.h });
      await page.emulateMedia({ colorScheme: profile.theme });
      await page.goto(url(profile.theme), { waitUntil: 'load' });
      await page.waitForFunction(() => window.__audit?.ready === true, undefined, { timeout: 180_000 });
      return page;
    };

    // The first load makes Vite optimize its dependencies (and reload once); the four pages start after that.
    const warm = await open(PROFILES[0]);
    const info = await warm.evaluate(() => window.__audit.course);
    if (!info) throw new Error('the audit page has no course');
    const only = process.env.AUDIT_ONLY ? process.env.AUDIT_ONLY.split(',').map(Number).filter(Number.isFinite) : undefined;
    const seeds = Number(process.env.AUDIT_SEEDS ?? 40);
    const cases = await warm.evaluate((o) => window.__audit.plan(o), { seeds, scan: 200, bad: 4, only });
    await warm.close();
    const pages = await Promise.all(PROFILES.map(open));

    const byNumber = new Map();
    for (const c of cases) byNumber.set(c.n, [...(byNumber.get(c.n) ?? []), c]);
    const perNumber = new Map([...byNumber].map(([n, list]) => [n, new Set(list.map((c) => `${c.level}:${c.seed}:${c.view}`)).size]));

    const defects = [];
    await Promise.all(
      pages.map(async (page, i) => {
        for (const [n, batch] of byNumber) {
          if (Date.now() - started > LIMIT_MS) throw new Error('audit exceeded the 5 minute limit');
          const found = await page.evaluate((cs) => window.__audit.run(cs), batch);
          for (const d of found) defects.push({ ...d, profile: PROFILES[i].id });
          console.log(`${PROFILES[i].id}: number ${n}: ${batch.length} cases, ${found.length} findings`);
        }
      }),
    );

    const groups = group(defects);
    const meta = { date: new Date().toISOString().slice(0, 10), root, cases: cases.length, seeds, seconds: 0, perNumber };

    // One screenshot per rule: the first critical defect, else the first minor one.
    const shots = new Map();
    for (const g of groups) {
      const best = shots.get(g.rule);
      if (!best || (best.severity !== 'critical' && g.severity === 'critical')) shots.set(g.rule, g);
    }
    for (const [rule, g] of [...shots].slice(0, 20)) {
      const e = g.example;
      const page = pages[PROFILES.findIndex((p) => p.id === e.profile)];
      await page.evaluate(([c, box]) => window.__audit.show(c, box), [e.c, e.box]);
      await page.screenshot({ path: safe(join(OUT, `${rule}.png`)) });
    }

    meta.seconds = Math.round((Date.now() - started) / 1000);
    const critical = groups.filter((g) => g.severity === 'critical').length;
    const { text, summary } = render(meta, groups, { critical });
    write('report.md', text);
    write(
      'results.json',
      JSON.stringify({ meta: { ...meta, perNumber: Object.fromEntries(perNumber), profiles: PROFILES }, defects: groups.map((g) => ({ n: g.n, rule: g.rule, severity: g.severity, where: g.where, detail: g.detail, seeds: g.seeds.size, cases: g.cases })) }, null, 1),
    );
    console.log(`audit:visual: ${cases.length} cases x ${PROFILES.length} windows in ${meta.seconds} s; critical ${critical}, minor ${groups.length - critical}`);
    console.log('number | defect | places');
    for (const [k, v] of summary) console.log(`${k.split('|')[0]} | ${k.split('|')[1]} | ${v}`);
    return critical > 0 ? 1 : 0;
  } finally {
    await context?.close().catch(() => {});
    await server.close().catch(() => {});
    for (const dir of ['.profile', '.vite']) rmSync(safe(join(OUT, dir)), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : 'audit failed');
    process.exit(2);
  },
);
