import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@jsmedgl/core': resolve(__dirname, '../../packages/core/src'),
      '@jsmedgl/parser-nifti': resolve(__dirname, '../../packages/parser-nifti/src'),
      '@jsmedgl/renderer-2d': resolve(__dirname, '../../packages/renderer-2d/src'),
      '@jsmedgl/renderer-3d': resolve(__dirname, '../../packages/renderer-3d/src'),
      '@jsmedgl/parser-dicom': resolve(__dirname, '../../packages/parser-dicom/src'),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
