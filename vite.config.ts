import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from https://nahuelalegre.github.io/padel/,
// so every asset URL has to be prefixed with the repository name.
export default defineConfig({
  base: '/padel/',
  build: {
    target: 'es2022',
    // The whole game is a few dozen KB: one chunk means one request.
    cssCodeSplit: false,
    reportCompressedSize: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
