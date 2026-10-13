import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { serviceWorker } from './scripts/service-worker.mjs';

export default defineConfig({
  // Relative asset URLs so the same build runs from any folder or host.
  base: './',
  plugins: [react(), serviceWorker()],
  test: { include: ['test/**/*.test.ts'] },
});
