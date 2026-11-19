#!/usr/bin/env node
/**
 * Pictures of the animation studio (`?estudio`) on a phone held upright.
 *
 *   npm run build && node scripts/studio.mjs
 *   node scripts/studio.mjs --situaciones bloqueo,estocada --camara zoom
 *
 * For each situation it opens the studio on it, goes to its key instant (the
 * contact, the miss) and takes the whole screen at the density of a phone.
 * It also takes the list of situations once.
 *
 * Options:
 *   --url <address>        a page already being served (otherwise it serves the build)
 *   --out .estudio         folder for the pictures
 *   --situaciones a,b      which situations, by their name in the address
 *   --camara juego         juego, zoom or costado
 *   --lejos                the far side of the net
 *   --2d                   the plain look
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openPhone, option, root, sleep, startPreview } from './lib/browser.mjs';

const settings = {
  url: option('url', null),
  out: String(option('out', join(root, '.estudio'))),
  situations: String(option('situaciones', 'bloqueo,estocada,no-llego,remate')).split(','),
  camera: String(option('camara', 'juego')),
  far: option('lejos', false) === true,
  flat: option('2d', false) === true,
};

const CAMERA_LABEL = { juego: 'Juego', zoom: 'Zoom', costado: 'Costado' };

/** Presses one of the studio's buttons by what it says. */
const press = (label) =>
  `(() => { const b = [...document.querySelectorAll('.studio button')].find((el) => el.textContent.trim() === ${JSON.stringify(label)}); if (b && !b.disabled) b.click(); return !!b; })()`;

async function main() {
  mkdirSync(settings.out, { recursive: true });
  const server = settings.url ? null : await startPreview();
  const phone = await openPhone({ width: 360, height: 800, dpr: 3 });
  try {
    const base = settings.url ?? server.url;
    let first = true;
    for (const id of settings.situations) {
      await phone.goto(`${base}?estudio=${id}`);
      for (let i = 0; i < 200; i++) {
        if (await phone.evaluate('window.padelStudio?.ready === true && window.padelStudio.frames > 2')) break;
        await sleep(100);
      }
      const status = await phone.evaluate('JSON.stringify(window.padelStudio)');
      if (first) {
        // The list of situations, once.
        await phone.evaluate(`document.querySelector('.studio-pick').click()`);
        await sleep(300);
        await phone.screenshot(join(settings.out, 'lista.png'));
        await phone.evaluate(`document.querySelector('.studio-pick').click()`);
        first = false;
      }
      if (settings.far) await phone.evaluate(press('Lejos'));
      if (settings.flat) await phone.evaluate(press('2D'));
      await phone.evaluate(press(CAMERA_LABEL[settings.camera] ?? 'Juego'));
      await sleep(200);
      await phone.evaluate('window.padelStudio.at()');
      await sleep(300);
      const name = `${id}-${settings.camera}${settings.far ? '-lejos' : ''}${settings.flat ? '-2d' : ''}`;
      await phone.screenshot(join(settings.out, `${name}.png`));
      console.log(`  ${name}: ${status}`);
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
