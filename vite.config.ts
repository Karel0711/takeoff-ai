import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset URLs so the same build runs from any folder or host.
  base: './',
  plugins: [react()],
  test: { include: ['test/**/*.test.ts'] },
});
