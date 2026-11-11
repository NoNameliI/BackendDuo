// Dev server of the visual audit (npm run audit:visual): the app config plus `virtual:audit-course`, a module that
// exists only while serving and is read from disk in Node. The production config has no such plugin, so an import of
// the module from the app fails `vite build`. Raw private files stay denied (inherited fs.deny).
import { resolve } from 'node:path';
import { mergeConfig, type Plugin } from 'vite';
import base from './vite.config.ts';
import { auditCourseRoot, readTree } from './scripts/drillCourses.ts';

const ID = 'virtual:audit-course';

function auditCourse(): Plugin {
  return {
    name: 'audit-course',
    apply: 'serve',
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    load(id) {
      if (id !== `\0${ID}`) return undefined;
      const root = auditCourseRoot();
      if (!root) return 'export default null';
      const files = readTree(root);
      for (const path of Object.keys(files)) this.addWatchFile(resolve(process.cwd(), path.slice(1)));
      return `export default ${JSON.stringify({ root: `/${root}`, files })}`;
    },
  };
}

export default mergeConfig(base, {
  // Keeps the dependency cache (and anything derived from course files) under private/audit, removed after the run.
  cacheDir: 'private/audit/.vite',
  server: { host: '127.0.0.1', port: 1421, strictPort: true, hmr: false, watch: { ignored: ['**/private/audit/**'] } },
  plugins: [auditCourse()],
});

