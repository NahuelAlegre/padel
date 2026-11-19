import { defineConfig } from 'vite';

/**
 * The animation studio, built on its own: one classic script beside the
 * game's (see `vite.config.ts`), that only `?estudio` downloads. It reaches
 * the game through the running instance, so it carries none of its code.
 *
 * It is built first and starts the output folder empty; the game's build
 * comes after it, keeps it and learns its name.
 */
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    copyPublicDir: false,
    modulePreload: false,
    reportCompressedSize: true,
    rollupOptions: {
      input: 'src/studio/main.ts',
      // Its `open` is what the game calls: it is kept, and everything it needs with it.
      preserveEntrySignatures: 'exports-only',
      output: {
        format: 'iife',
        name: 'PadelStudio',
        entryFileNames: 'assets/studio-[hash].js',
      },
    },
  },
});
