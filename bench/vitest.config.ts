import { defineConfig } from 'vitest/config';

// The benchmark: npx vitest run -c bench/vitest.config.ts (see bench/README in bench/run.test.ts).
export default defineConfig({
  define: { __BUILD__: JSON.stringify('bench') },
  test: { include: ['bench/**/*.test.ts'], testTimeout: 6 * 60 * 60 * 1000, hookTimeout: 60000, fileParallelism: false },
});
