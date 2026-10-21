import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: ['index.html', 'play.html', 'edit.html'],
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,mjs}'],
    passWithNoTests: true,
  },
});
