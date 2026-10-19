import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';

// A fresh service-worker cache name per build, so a deploy never serves the old app shell.
const swStamp = () => ({ name: 'sw-stamp', closeBundle() { const p = 'dist/sw.js'; writeFileSync(p, readFileSync(p, 'utf8').replace("'compass-v1'", `'compass-${Date.now()}'`)); } });

// npm run dev: the app here, /api/* to the Worker (npm run dev:worker, port 8790).
export default defineConfig({
  root: 'web',
  publicDir: 'public',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [react(), swStamp()],
  server: { proxy: { '/api': 'http://localhost:8790' } },
});
