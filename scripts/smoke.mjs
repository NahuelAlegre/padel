#!/usr/bin/env node
/**
 * End-to-end check: plays the game on an emulated phone with real touches.
 *
 *   npm run build && npm run smoke
 *
 * Opens the production build in a headless Chrome set up as a portrait phone
 * with a touch screen, taps through the menu and plays a short match by
 * swiping with one finger, the way a person would: it looks at the timing ring
 * and lifts the finger when the ball arrives. Then it tries the pause menu,
 * the options and the two-thumb stick mode.
 *
 * It fails (exit code 1) if the page logs an error, if swipes do not turn
 * into hits or if the match never ends. Screenshots of every stage are saved
 * so the result can be looked at.
 *
 * Options:
 *   --out .smoke       folder for the screenshots
 *   --throttle 4       CPU slowdown factor (default 1)
 *   --width 360 --height 800 --dpr 3    emulated screen
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openPhone, option, root, sleep, startPreview } from './lib/browser.mjs';

const out = resolve(root, String(option('out', '.smoke')));
const throttle = Number(option('throttle', 1));
const size = {
  width: Number(option('width', 360)),
  height: Number(option('height', 800)),
  dpr: Number(option('dpr', 3)),
};

/** Time a swipe takes from finger down to finger up, in milliseconds. */
const SWIPE_MS = 60;

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FALLA'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function main() {
  mkdirSync(out, { recursive: true });
  const preview = await startPreview();
  const phone = await openPhone(size);
  const shot = (name) => phone.screenshot(join(out, `${name}.png`));

  /** Centre of the first button whose label matches, in CSS pixels. */
  const buttonAt = (label) =>
    phone.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().replace(/^✓ /, '') === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)});
      if (!button) return null;
      const r = button.getBoundingClientRect();
      // A button that is scrolled out of view cannot be tapped by a finger either.
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const visible = r.top >= 0 && r.bottom <= innerHeight && button.contains(top);
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible };
    })()`);
  const tapButton = async (label) => {
    const at = await buttonAt(label);
    if (!at) throw new Error(`No hay un botón "${label}" en pantalla`);
    if (!at.visible) throw new Error(`El botón "${label}" está fuera de la pantalla o tapado`);
    await phone.tap(at.x, at.y);
    await sleep(150);
  };
  const state = () =>
    phone.evaluate(`(() => {
      const g = window.padel, m = g.match, me = m.players[0];
      return {
        state: g.state,
        phase: m.phase,
        serving: m.phase === 'serve' && m.serverId === 0,
        eta: me.plan ? me.plan.t - m.time : null,
        kind: me.plan ? me.plan.kind : null,
        armed: me.swing !== null,
        rivalX: m.players[1].x,
        x: me.x,
        y: me.y,
        time: m.time,
      };
    })()`);

  try {
    if (throttle > 1) await phone.throttle(throttle);
    await phone.goto(preview.url);
    await sleep(400);
    await shot('01-menu');
    check('el menú abre', (await buttonAt('Jugar')) !== null);

    // A one-game match keeps the run short. Everything else is the default setup.
    await phone.evaluate(`(() => {
      const g = window.padel;
      g.settings.games = 1;
      window.__events = [];
      g.onSimEvent = (event) => window.__events.push({ ...event });
    })()`);
    await tapButton('Jugar');
    await sleep(300);
    check('tocar "Jugar" empieza el partido', (await state()).state === 'playing');
    await shot('02-saque');

    // ---------------------------------------------------------------- one-finger match
    const taken = new Set();
    const once = async (name, condition) => {
      if (!condition || taken.has(name)) return;
      taken.add(name);
      await shot(name);
    };
    const cx = size.width / 2;
    const baseY = size.height * 0.84;
    let lastSwipeFor = -1;
    let servedAt = 0;
    let pausedOnce = false;
    const started = Date.now();

    while (Date.now() - started < 240_000) {
      const s = await state();
      if (s.state === 'over') break;

      if (s.serving && Date.now() - servedAt > 1500) {
        servedAt = Date.now();
        await sleep(350);
        await phone.swipe(cx, baseY, cx + 25, baseY - 70, SWIPE_MS);
        continue;
      }

      if (s.eta !== null) {
        await once('03-anillo-de-timing', s.eta > 0.15 && s.eta < 0.32);
        await once('04-pelota-de-pared', s.kind === 'wall' && s.eta > 0.1 && s.eta < 0.3);
        // Lift the finger when the ball arrives: start the swipe that much earlier.
        const lead = SWIPE_MS / 1000 + 0.03;
        if (!s.armed && s.eta <= lead && s.eta > -0.15 && lastSwipeFor !== Math.round(s.time * 10)) {
          lastSwipeFor = Math.round(s.time * 10);
          const away = s.rivalX > 0 ? -1 : 1;
          const pick = Math.random();
          if (pick < 0.15) await phone.swipe(cx, baseY, cx + away * 20, baseY - 230, SWIPE_MS + 30);
          else if (pick < 0.27) await phone.tap(cx, baseY);
          else if (pick < 0.35) await phone.swipe(cx, baseY - 80, cx + away * 15, baseY, SWIPE_MS);
          else await phone.swipe(cx, baseY, cx + away * (25 + Math.random() * 40), baseY - 75, SWIPE_MS);
          await sleep(140);
          await once('05-golpe', true);
          continue;
        }
      }

      // Half way through, pause with the button and look at the menus.
      if (!pausedOnce && s.phase === 'pointOver' && s.time > 12) {
        pausedOnce = true;
        await tapButton('Pausa');
        check('el botón de pausa pausa', (await state()).state === 'paused');
        const frozen = (await state()).time;
        await shot('06-pausa');
        await tapButton('Opciones');
        await shot('07-opciones');
        await tapButton('Volver');
        await sleep(300);
        check('en pausa el partido no avanza', (await state()).time === frozen);
        await tapButton('Seguir');
        check('"Seguir" vuelve al partido', (await state()).state === 'playing');
      }
      await sleep(4);
    }

    const end = await state();
    await shot('08-final');
    check('el partido termina', end.state === 'over', `estado: ${end.state}`);

    const events = await phone.evaluate('window.__events');
    const mine = events.filter((e) => e.type === 'hit' && e.team === 0 && e.kind !== 'serve');
    const count = (key) => mine.reduce((acc, e) => ({ ...acc, [e[key]]: (acc[e[key]] ?? 0) + 1 }), {});
    check('los deslizamientos se convierten en golpes', mine.length >= 5, `${mine.length} golpes`);
    check('hubo saques propios', events.some((e) => e.type === 'hit' && e.team === 0 && e.kind === 'serve'));
    console.log('\n        timing de los golpes:', count('quality'));
    console.log('        tipos de golpe:      ', count('kind'));
    const timed = mine.filter((e) => e.quality === 'perfect' || e.quality === 'good').length;
    check('levantando el dedo al cerrarse el anillo sale bien', timed / Math.max(1, mine.length) >= 0.6);
    const points = events.filter((e) => e.type === 'point').length;
    check('se jugaron puntos', points >= 4, `${points} puntos`);

    // ---------------------------------------------------------------- two-thumb stick mode
    await phone.evaluate(`(() => {
      const g = window.padel;
      g.settings.controlMode = 'manual';
      g.settings.games = 1;
      g.applySettings();
      g.start('play');
      window.__events.length = 0;
    })()`);
    await sleep(300);
    // Serve, then hold the stick (left side) to the right while the other thumb swipes.
    await phone.swipe(size.width * 0.75, baseY, size.width * 0.75 + 20, baseY - 70, SWIPE_MS);
    await sleep(900);
    const before = await state();
    const finger = (id, x, y) => ({ x: Math.round(x), y: Math.round(y), id, radiusX: 8, radiusY: 8, force: 1 });
    const stickX = size.width * 0.25;
    await phone.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(1, stickX, baseY)] });
    await phone.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finger(1, stickX + 46, baseY)] });
    await sleep(450);
    const swipeX = size.width * 0.75;
    await phone.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [finger(1, stickX + 46, baseY), finger(2, swipeX, baseY)],
    });
    await shot('09-joystick');
    // Note: with two emulated fingers Chrome sometimes reports this move at
    // the coordinates divided by the device pixel ratio. The release below
    // arrives right, and that is what the gesture is read from.
    await phone.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [finger(1, stickX + 46, baseY), finger(2, swipeX, baseY - 70)],
    });
    await phone.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [finger(1, stickX + 46, baseY)] });
    await sleep(150);
    const during = await state();
    await phone.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
    const after = await state();
    const manualEvents = await phone.evaluate('window.__events');
    check('el joystick mueve al jugador', during.x - before.x > 0.8, `x: ${before.x.toFixed(2)} → ${during.x.toFixed(2)}`);
    check('al soltar el joystick el jugador frena', Math.abs(after.x - during.x) < 0.6);
    check(
      'con el joystick apretado, el otro pulgar pega',
      manualEvents.some((e) => (e.type === 'whiff' || e.type === 'hit') && (e.player === 0) && e.kind !== 'serve'),
    );

    // ---------------------------------------------------------------- desktop: mouse and keyboard
    await phone.asDesktop(1280, 800);
    await phone.goto(preview.url);
    await sleep(300);
    await phone.evaluate(`(() => {
      const g = window.padel;
      g.settings.controlMode = 'assisted';
      g.settings.games = 1;
      g.applySettings();
      window.__events = [];
      g.onSimEvent = (event) => window.__events.push({ ...event });
    })()`);
    const stage = await phone.evaluate(`(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return { left: r.left, width: r.width, height: r.height }; })()`);
    check(
      'en escritorio el juego es una columna vertical centrada',
      Math.abs(stage.width - 450) < 2 && Math.abs(stage.left - 415) < 2 && stage.height === 800,
      `${Math.round(stage.width)}x${stage.height} a ${Math.round(stage.left)} px del borde`,
    );
    const play = await buttonAt('Jugar');
    await phone.mouseDrag(play.x, play.y, play.x, play.y, 20);
    await sleep(300);
    check('un clic en "Jugar" empieza el partido', (await state()).state === 'playing');

    await sleep(400);
    await phone.key('Space', 32);
    await sleep(900);
    let desktopEvents = await phone.evaluate('window.__events');
    check('la barra espaciadora saca', desktopEvents.some((e) => e.type === 'hit' && e.kind === 'serve' && e.team === 0));

    // Drag the mouse over the lower half of the column: it has to count as a swipe.
    const mouseX = stage.left + stage.width / 2;
    await phone.mouseDrag(mouseX, 690, mouseX + 30, 620, 60);
    await sleep(250);
    desktopEvents = await phone.evaluate('window.__events');
    check(
      'arrastrar el mouse es un golpe',
      desktopEvents.some((e) => (e.type === 'whiff' || e.type === 'hit') && e.player === 0 && e.kind !== 'serve'),
    );
    await shot('10-escritorio');

    await phone.key('KeyP', 80);
    await sleep(150);
    check('la tecla P pausa', (await state()).state === 'paused');
    await phone.key('KeyP', 80);
    await sleep(150);
    check('y vuelve a jugar', (await state()).state === 'playing');

    // Switching to another tab or app has to pause the game by itself.
    await phone.evaluate(`(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    await sleep(100);
    check('al perder de vista la página, se pausa sola', (await state()).state === 'paused');

    check('la página no tiró errores', phone.errors.length === 0, phone.errors.slice(0, 3).join(' | '));
  } finally {
    await phone.close();
    preview.stop();
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length} de ${checks.length} verificaciones pasaron. Capturas en ${out}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
