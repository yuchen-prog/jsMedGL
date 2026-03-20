import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@jsmedgl/core': resolve(__dirname, '../../packages/core/src'),
      '@jsmedgl/parser-nifti': resolve(__dirname, '../../packages/parser-nifti/src'),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
