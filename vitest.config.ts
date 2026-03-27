import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.config.ts',
        'tests/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@jsmedgl/core': resolve(__dirname, 'packages/core/src'),
      '@jsmedgl/parser-nifti': resolve(__dirname, 'packages/parser-nifti/src'),
      '@jsmedgl/react': resolve(__dirname, 'packages/react/src'),
      '@jsmedgl/renderer-2d': resolve(__dirname, 'packages/renderer-2d/src'),
    },
  },
});
