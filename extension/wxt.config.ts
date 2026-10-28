import { defineConfig } from 'wxt';
import { buildManifest } from './src/manifest';

export default defineConfig({
  srcDir: 'src',
  manifest: buildManifest(),
  vite: () => ({
    esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  }),
});
