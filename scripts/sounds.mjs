/**
 * Renders the game's sounds to WAV files, to listen to them outside the
 * browser or look at them in an audio editor. The game itself never loads
 * these files: it renders the same recipes in the browser, after the first
 * frame.
 *
 *   npm run sounds                 every sound into out/sounds/
 *   npm run sounds -- --only hit   only the sounds whose name contains "hit"
 *   npm run sounds -- --sr 48000   the board's versions and the club at another rate
 *
 * Names: game-* are the takes the game plays, board-* the versions that were
 * on the listening board, club-* the ambience.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { option, root } from './lib/browser.mjs';

const sr = Number(option('sr', 44100));
const only = option('only', '');
const outDir = join(root, String(option('out', join('out', 'sounds'))));

function wav(channels, rate) {
  const frames = channels[0].length;
  const data = Buffer.alloc(44 + frames * channels.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + frames * channels.length * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(channels.length, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * channels.length * 2, 28);
  data.writeUInt16LE(channels.length * 2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(frames * channels.length * 2, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      const s = Math.max(-1, Math.min(1, channel[i] ?? 0));
      data.writeInt16LE(Math.round(s * 32767), offset);
      offset += 2;
    }
  }
  return data;
}

const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
try {
  const { catalogue } = await server.ssrLoadModule('/src/audio/catalogue.ts');
  // The game's own takes are always at the game's rate; the rest at --sr.
  mkdirSync(outDir, { recursive: true });
  let count = 0;
  for (const item of catalogue(sr)) {
    if (only && !item.name.includes(only)) continue;
    const started = performance.now();
    const rendered = item.render();
    const channels = Array.isArray(rendered) ? rendered : [rendered];
    writeFileSync(join(outDir, `${item.name}.wav`), wav(channels, item.sr));
    const ms = (performance.now() - started).toFixed(1);
    const seconds = (channels[0].length / item.sr).toFixed(2);
    console.log(`${item.name.padEnd(40)} ${seconds.padStart(6)} s  ${ms.padStart(7)} ms`);
    count++;
  }
  console.log(`\n${count} sounds in ${outDir}`);
} finally {
  await server.close();
}
