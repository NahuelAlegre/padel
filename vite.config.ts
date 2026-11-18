import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The build has to run from anywhere: GitHub Pages under /padel/, the root of
 * a local server inside a native shell (Capacitor serves the app from
 * capacitor://localhost or https://localhost) and a plain file opened from
 * disk. Two things make that work:
 *
 *   - `base: './'`: every asset is referenced relative to index.html.
 *   - One classic script instead of an ES module. Browsers refuse to load
 *     module scripts from file://, and the game is a single chunk anyway.
 */
function classicScript(): Plugin {
  return {
    name: 'padel-classic-script',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // `defer` keeps the timing of a module: it runs once the page is parsed.
        return html
          .replace(/<script type="module" crossorigin src=/g, '<script defer src=')
          .replace(/<link rel="stylesheet" crossorigin href=/g, '<link rel="stylesheet" href=');
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [classicScript()],
  build: {
    target: 'es2022',
    // The whole game is a few dozen KB: one script and one stylesheet.
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: true,
    rollupOptions: {
      output: { format: 'iife' },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
