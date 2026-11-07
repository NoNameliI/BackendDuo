// Launcher: loads scripts/pack-private.ts through Vite (same `@/` alias as the app) and runs it.
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
});
let failed = false;
try {
  const { main } = await server.ssrLoadModule('/scripts/pack-private.ts');
  await main();
} catch (e) {
  failed = true;
  console.error(e instanceof Error ? e.message : 'Ошибка сборки пакета.');
} finally {
  await server.close();
}
process.exit(failed ? 1 : 0);
