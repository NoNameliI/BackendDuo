import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

type Log = { code?: string; message: string; id?: string };
type LogHandler = (level: 'warn' | 'info' | 'debug' | 'error', log: Log) => void;

// PGlite's Emscripten runtime contains `eval` and a Node-only branch importing `node:module`.
// Neither runs in the webview, so exactly these two notices are dropped; everything else is reported.
function quietPglite(level: Parameters<LogHandler>[0], log: Log, handler: LogHandler) {
  const fromPglite = (log.id ?? log.message).includes('@electric-sql/pglite');
  const known = log.code === 'EVAL' || log.message.includes('"node:module" has been externalized');
  if (fromPglite && known) return;
  handler(level, log);
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // PGlite ships its own WASM and data files; pre-bundling would break their relative URLs.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: {
    format: 'es',
    rolldownOptions: { onLog: quietPglite },
  },
  build: {
    target: 'es2022',
    // Monaco's editor core is one lazily loaded chunk of roughly 3.4 MB, served from disk in the desktop app.
    chunkSizeWarningLimit: 4000,
    rolldownOptions: { onLog: quietPglite },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
