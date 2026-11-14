// Drill set check: `npm run check:drill-set`. Opens the whole drill screen of the private trainer course in headless
// Chromium and switches numbers in many orders — in a timed set (forward, backward, shuffled, back and forth, after a
// restart and after a resume from storage) and one number at a time — checking that every page shows exactly the
// data of its own number: one «Данные» block when the number has files, file names starting with `<n>_`, no repeats,
// and no React key warnings. Needs private/*/course (skipped otherwise), like the visual audit.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { auditCourseRoot } from './drillCourses.ts';

const OUT = join('private', 'audit-setcheck');

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
  if (!found) throw new Error('Chromium not found: set AUDIT_CHROMIUM or install it under %LOCALAPPDATA%\\ms-playwright');
  return found;
}

/** What the page shows now: one entry per «Данные» block with the export names inside it. */
const READ_PAGE = () =>
  [...document.querySelectorAll('section[aria-label="Данные"]')].map((s) => [...new Set(s.textContent.match(/\b\d+_[0-9a-f]{8}(?:_[A-Za-z0-9]+)?\.(?:csv|txt|xlsx)\b/g) ?? [])]);

async function main() {
  if (!auditCourseRoot()) {
    console.log('check:drill-set skipped: no drill course under private/*/course');
    return 0;
  }
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright-core');
  const server = await createServer({
    configFile: 'vite.audit.config.ts',
    cacheDir: join(OUT, '.vite'),
    server: { port: 1423, strictPort: true },
    logLevel: 'error',
    clearScreen: false,
  });
  let browser;
  const problems = [];
  let checked = 0;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, executablePath: chromiumPath() });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'ru-RU' });
    page.on('console', (m) => {
      if (m.type() === 'error' && /same key|Encountered two children/i.test(m.text())) problems.push(`React: ${m.text().slice(0, 160)}`);
    });
    const url = 'http://127.0.0.1:1423/src/audit/setcheck.html';
    const open = async () => {
      await page.goto(url);
      await page.waitForFunction(() => window.__drill !== undefined, null, { timeout: 30_000 });
      return page.evaluate(() => window.__drill?.numbers ?? null);
    };
    const numbers = await open();
    if (!numbers) throw new Error('the drill course did not load');

    // Expected files per number come from the page itself on a fresh mount of that number alone (after a reload).
    const look = async (label, n) => {
      await page.waitForTimeout(60);
      const blocks = await page.evaluate(READ_PAGE);
      checked++;
      const names = blocks.flat();
      const where = `${label}, номер ${n}`;
      if (blocks.length > 1) problems.push(`${where}: блоков «Данные» ${blocks.length}: ${blocks.map((b) => b.join('+')).join(' | ')}`);
      const foreign = names.filter((x) => !x.startsWith(`${n}_`));
      if (foreign.length) problems.push(`${where}: чужие файлы ${foreign.join(', ')}`);
      if (new Set(names).size !== names.length) problems.push(`${where}: файлы повторяются: ${names.join(', ')}`);
      return names;
    };
    const select = (n) => page.evaluate((x) => window.__drill.store.getState().selectInSet(x), n);
    const walk = async (label, order) => {
      const seen = new Map();
      for (const n of order) {
        await select(n);
        const names = await look(label, n);
        const before = seen.get(n);
        if (before !== undefined && before.join() !== names.join()) problems.push(`${label}, номер ${n}: при возврате другие файлы (${before.join(', ')} → ${names.join(', ')})`);
        seen.set(n, names);
      }
    };
    let state = 7;
    const shuffled = (xs) => {
      const a = [...xs];
      for (let i = a.length - 1; i > 0; i--) {
        state = (state * 1103515245 + 12345) % 2147483648;
        const j = state % (i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    // A timed set: every order a learner can produce.
    await page.evaluate(() => window.__drill.store.getState().startSet());
    await walk('вариант, по порядку', numbers);
    await walk('вариант, обратно', [...numbers].reverse());
    await walk('вариант, вразнобой', shuffled(numbers));
    await walk('вариант, туда и обратно', numbers.flatMap((n, i) => (i > 0 ? [n, numbers[i - 1], n] : [n])));
    // A restarted set: new seeds, the old ones must not leak.
    await page.evaluate(() => window.__drill.store.getState().startSet());
    await walk('новый вариант', shuffled(numbers));
    // A set resumed after a reload in the middle.
    await select(numbers[Math.floor(numbers.length / 2)]);
    await page.waitForTimeout(400); // the set is saved on start; answers are saved debounced
    await open();
    await page.waitForFunction(() => window.__drill.store.getState().saved !== null, null, { timeout: 10_000 });
    await page.evaluate(() => window.__drill.store.getState().resumeSet());
    await walk('вариант после перезагрузки', shuffled(numbers));

    // One number at a time (also the «работа над ошибками» view: the same task screen).
    await page.evaluate(() => window.__drill.store.getState().discardSet?.());
    for (const n of shuffled(numbers)) {
      await page.evaluate((x) => window.__drill.store.getState().openNumber(x), n);
      await page.evaluate(() => window.__drill.store.getState().setTab('task'));
      await look('по номерам', n);
      await page.evaluate(() => window.__drill.store.getState().newInstance());
      await look('по номерам, новый вариант', n);
    }
  } finally {
    await browser?.close().catch(() => {});
    await server.close().catch(() => {});
    rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  if (problems.length) {
    console.error(`check:drill-set: ${problems.length} problem(s) in ${checked} pages:`);
    for (const p of problems.slice(0, 30)) console.error(`- ${p}`);
    return 1;
  }
  console.log(`check:drill-set: ${checked} pages, each shows only its own number's data`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : 'check failed');
    process.exit(2);
  },
);
