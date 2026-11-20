#!/usr/bin/env node
/**
 * Strips of the animation studio (`?estudio`): a few frames of one situation
 * side by side, cut around the player on show, to see a movement and not a
 * single pose. One picture per situation, camera and side of the net.
 *
 *   npm run build && node scripts/strip.mjs --situaciones mia,tuya
 *
 * Options:
 *   --url <address>        a page already being served (otherwise it serves the build)
 *   --out .estudio         folder for the pictures
 *   --situaciones a,b      which situations, by their name in the address
 *   --camaras juego,zoom   which cameras
 *   --lados cerca,lejos    which sides of the net
 *   --cuadros -0.3,0,0.15  seconds from the key instant of each frame
 *   --2d                   the plain look
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPhone, option, root, sleep, startPreview } from './lib/browser.mjs';

const settings = {
  url: option('url', null),
  out: String(option('out', join(root, '.estudio'))),
  situations: String(option('situaciones', 'mia,tuya')).split(','),
  cameras: String(option('camaras', 'juego,zoom')).split(','),
  sides: String(option('lados', 'cerca,lejos')).split(','),
  frames: String(option('cuadros', '-0.3,-0.15,0,0.15,0.3,0.5')).split(',').map(Number),
  flat: option('2d', false) === true,
};

const CAMERA_LABEL = { juego: 'Juego', zoom: 'Zoom', costado: 'Costado' };

/** Presses one of the studio's buttons by what it says. */
const press = (label) =>
  `(() => { const b = [...document.querySelectorAll('.studio button')].find((el) => el.textContent.trim() === ${JSON.stringify(label)}); if (b && !b.disabled) b.click(); return !!b; })()`;

/** Where the player on show is on the screen: a box around it, in CSS pixels. */
const box = `(() => {
  const g = window.padel, s = window.padelStudio, p = g.match.players[s.player], at = { x: 0, y: 0 };
  g.renderer.project(p.x, p.y, 0, at); const feet = { ...at };
  g.renderer.project(p.x, p.y, 2.3, at); const head = { ...at };
  const h = Math.max(30, feet.y - head.y);
  return { x: feet.x - h * 0.62, y: head.y - h * 0.12, width: h * 1.24, height: h * 1.2 };
})()`;

async function main() {
  mkdirSync(settings.out, { recursive: true });
  const server = settings.url ? null : await startPreview();
  const phone = await openPhone({ width: 360, height: 800, dpr: 2 });
  try {
    const base = settings.url ?? server.url;
    for (const id of settings.situations) {
      for (const side of settings.sides) {
        for (const camera of settings.cameras) {
          await phone.goto(`${base}?estudio=${id}`);
          for (let i = 0; i < 200; i++) {
            if (await phone.evaluate('window.padelStudio?.ready === true && window.padelStudio.frames > 2')) break;
            await sleep(100);
          }
          if (side === 'lejos') await phone.evaluate(press('Lejos'));
          if (settings.flat) await phone.evaluate(press('2D'));
          await phone.evaluate(press(CAMERA_LABEL[camera] ?? 'Juego'));
          await sleep(200);
          // The key instant, in seconds into the loop.
          await phone.evaluate('window.padelStudio.at()');
          await sleep(100);
          const key = await phone.evaluate('window.padelStudio.time');
          const shots = [];
          let clip = null;
          // To the first frame, and from there one frame of the studio at a time (a sixtieth of a second).
          let at = Math.max(0, key + settings.frames[0]);
          await phone.evaluate(`window.padelStudio.at(${at})`);
          for (const offset of settings.frames) {
            const steps = Math.round((Math.max(0, key + offset) - at) * 60);
            if (steps > 0) {
              await phone.evaluate(`(() => { for (let i = 0; i < ${steps}; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); })()`);
              at += steps / 60;
            }
            await sleep(200);
            // The same box for every frame: the one around the player at the key instant, or the first.
            clip ??= await phone.evaluate(box);
            const file = join(settings.out, `_frame.png`);
            await phone.screenshot(file, clip);
            const { readFileSync } = await import('node:fs');
            shots.push(readFileSync(file).toString('base64'));
          }
          // Side by side, on a canvas in the page.
          const strip = await phone.evaluate(`(async () => {
            const sources = ${JSON.stringify(shots)};
            const images = await Promise.all(sources.map((data) => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.src = 'data:image/png;base64,' + data; })));
            const w = images[0].width, h = images[0].height, gap = 6;
            const canvas = document.createElement('canvas');
            canvas.width = images.length * w + (images.length - 1) * gap;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            images.forEach((img, i) => ctx.drawImage(img, i * (w + gap), 0));
            return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
          })()`);
          const name = `${id}-${camera}-${side}${settings.flat ? '-2d' : ''}-tira.png`;
          writeFileSync(join(settings.out, name), Buffer.from(strip, 'base64'));
          console.log(`  ${name}: cuadros a ${settings.frames.map((f) => (key + f).toFixed(2)).join(', ')} s`);
          await sleep(10);
        }
      }
    }
    if (phone.errors.length > 0) console.log(`Errores en la página:\n  ${phone.errors.join('\n  ')}`);
  } finally {
    await phone.close();
    server?.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
