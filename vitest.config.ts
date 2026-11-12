import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the project's own tests — never the staged copy under packaging/.
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'packaging', 'dist'],
    testTimeout: 15000,
  },
});
