/**
 * Builds the listening board (design/sonido/tablero.html): the board's
 * script, with the game's own sound code, bundled and inlined into one HTML
 * file that can be opened anywhere or published as an artifact.
 *
 *   npm run sound-board
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { root } from './lib/browser.mjs';

const dir = join(root, 'design', 'sonido');
const result = await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    write: false,
    target: 'es2022',
    minify: true,
    lib: { entry: join(dir, 'tablero.ts'), formats: ['iife'], name: 'Tablero', fileName: () => 'tablero.js' },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ('output' in r ? r.output : []));
const chunk = outputs.find((o) => o.type === 'chunk');
if (!chunk) throw new Error('The board did not build.');
const code = chunk.code.replace(/<\/script/gi, '<\\/script');
const template = readFileSync(join(dir, 'tablero.template.html'), 'utf8');
const html = template.replace('/*BUNDLE*/', () => code);
writeFileSync(join(dir, 'tablero.html'), html);
console.log(`design/sonido/tablero.html: ${(html.length / 1024).toFixed(1)} KB (script ${(code.length / 1024).toFixed(1)} KB)`);
