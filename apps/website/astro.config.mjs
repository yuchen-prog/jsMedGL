import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  site: 'https://yuchen-prog.github.io',
  base: '/jsMedgl/',
  integrations: [react(), tailwind()],
  vite: {
    resolve: {
      alias: {
        '@jsmedgl/parser-nifti': resolve(__dirname, '../../packages/parser-nifti/src'),
        '@jsmedgl/renderer-2d': resolve(__dirname, '../../packages/renderer-2d/src'),
      },
    },
  },
});
