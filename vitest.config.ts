import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: './globalSetup.ts',
    setupFiles: ['./testSetup.ts'],
    include: ['packages/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist', '**/dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'packages/**/test/', '**/*.d.ts', '**/*.config.{js,ts}', '**/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@evergreen-ai/mastra': './packages/mastra/src/index.ts',
    },
  },
});
