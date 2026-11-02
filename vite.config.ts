import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // Fonts travel inside the stylesheet: the published page can't fetch them from anywhere else.
  build: { assetsInlineLimit: (file) => (file.endsWith('.woff2') ? true : undefined) },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60_000 },
});
