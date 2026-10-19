import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// npm run dev: the app here, /api/* to the Worker (npm run dev:worker, port 8790).
export default defineConfig({
  root: 'web',
  publicDir: 'public',
  build: { outDir: '../dist', emptyOutDir: true },
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8790' } },
});
