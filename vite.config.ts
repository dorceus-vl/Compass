import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';

// A fresh service-worker cache name per build, so a deploy never serves the old app shell.
const swStamp = () => ({ name: 'sw-stamp', apply: 'build' as const, closeBundle() {
  const p = 'dist/sw.js', src = readFileSync(p, 'utf8');
  if (!src.includes("'compass-v1'")) throw new Error("sw-stamp: the 'compass-v1' placeholder is missing from dist/sw.js");
  writeFileSync(p, src.replace("'compass-v1'", `'compass-${Date.now()}'`));
} });

// npm run dev: the app here, /api/* to the Worker (npm run dev:worker, port 8790).
export default defineConfig({
  root: 'web',
  publicDir: 'public',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [react(), swStamp()],
  server: { proxy: { '/api': 'http://localhost:8790' } },
});
