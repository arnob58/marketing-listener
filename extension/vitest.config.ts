import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  test: {
    globals: true,
    environment: 'happy-dom',
    environmentOptions: { happyDOM: { settings: { disableIframePageLoading: true } } },
    setupFiles: ['tests/helpers/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
