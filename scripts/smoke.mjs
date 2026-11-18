#!/usr/bin/env node
/**
 * End-to-end check: plays the game on an emulated phone with real touches.
 *
 *   npm run build && npm run smoke
 *
 * Opens the production build in a headless Chrome set up as a portrait phone
 * with a touch screen and goes through what a person would:
 *
 *   - the first visit, straight onto the court;
 *   - a whole match with two thumbs: one on the stick, the other holding,
 *     aiming and letting go;
 *   - the start screen, the options, and a few points with one hand:
 *     dragging to move and flicking to hit;
 *   - closing the game in the middle of a match and picking it up again;
 *   - pause, the notch, a computer with mouse and keyboard, and the build
 *     opened straight from disk, as an app shell would load it.
 *
 * It fails (exit code 1) if any check fails or the page logs an error.
 * Screenshots of every stage are saved so the result can be looked at.
 *
 * Options:
 *   --out .smoke       folder for the screenshots
 *   --throttle 4       CPU slowdown factor (default 1)
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openPhone, option, root, sleep, startPreview } from './lib/browser.mjs';

const out = resolve(root, String(option('out', '.smoke')));
const throttle = Number(option('throttle', 1));
const WIDTH = 360;
const HEIGHT = 800;
/** Where the thumbs rest: the stick on the left, the aiming thumb on the right. */
const STICK = { x: WIDTH * 0.25, y: HEIGHT * 0.86 };
const AIM = { x: WIDTH * 0.75, y: HEIGHT * 0.86 };
const STICK_RADIUS = 46;

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? '  ok  ' : ' FALLA'}  ${name}${detail ? `  (${detail})` : ''}`);
}
function section(title) {
  console.log(`\n${title}`);
}

async function main() {
  mkdirSync(out, { recursive: true });
  const preview = await startPreview();
  const phone = await openPhone({ width: WIDTH, height: HEIGHT, dpr: 3 });
  await phone.watchNetwork();
  const shot = (name) => phone.screenshot(join(out, `${name}.png`));

  /** What the bot needs to know about the game to play it, read from the page. */
  const look = () =>
    phone.evaluate(`(() => {
      const g = window.padel, m = g.match, me = m.players[0], rival = m.players[1];
      const incoming = m.phase === 'rally' && m.rally.live && m.rally.hitter !== me.team;
      return {
        state: g.state,
        screen: g.screens.current,
        phase: m.phase,
        time: m.time,
        // During the pause after a point: how long it has lasted and what comes next.
        pause:
          m.phase === 'pointOver'
            ? { since: m.time - m.phaseStarted, left: m.phaseUntil - m.time, then: m.afterPause }
            : null,
        serving: m.phase === 'serve' && m.serverId === me.id,
        incoming,
        me: [me.x, me.y],
        guide: me.guide ? [me.guide.stanceX, me.guide.stanceY] : null,
        eta: me.plan ? me.plan.t - m.time : null,
        armed: me.swing !== null,
        aiming: g.scene.aim !== null,
        rivalX: rival.x,
        score: m.score.points.concat(m.score.games),
        introDone: g.profile.introDone,
        tutorial: m.tutorial,
      };
    })()`);
  const reaches = async (expected, timeoutMs = 2500) => {
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(20)) {
      if ((await look()).state === expected) return true;
    }
    return false;
  };
  const buttonAt = (label) =>
    phone.evaluate(`(() => {
      const wanted = ${JSON.stringify(label)};
      const button = [...document.querySelectorAll('button')].find((b) => {
        const own = [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
        return own === wanted || b.getAttribute('aria-label') === wanted;
      });
      if (!button) return null;
      const r = button.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        bottom: r.bottom,
        visible: r.top >= 0 && r.bottom <= innerHeight && button.contains(top),
        focused: document.activeElement === button,
        primary: button.classList.contains('primary'),
      };
    })()`);
  const tapButton = async (label) => {
    let at = null;
    for (const deadline = Date.now() + 2500; Date.now() < deadline; await sleep(25)) {
      at = await buttonAt(label);
      if (at?.visible) break;
    }
    if (!at) throw new Error(`No hay un botón "${label}" en pantalla`);
    if (!at.visible) throw new Error(`El botón "${label}" está fuera de la pantalla o tapado`);
    await phone.tap(at.x, at.y);
    await sleep(150);
  };
  const watchEvents = () =>
    phone.evaluate(`(() => { window.__events = []; window.padel.onSimEvent = (e) => window.__events.push({ ...e }); })()`);
  const events = () => phone.evaluate('window.__events');
  const myHits = (list) => list.filter((e) => e.type === 'hit' && e.team === 0 && e.kind !== 'serve');
  const tally = (list, key) => list.reduce((acc, e) => ({ ...acc, [e[key]]: (acc[e[key]] ?? 0) + 1 }), {});

  /**
   * Plays with two thumbs. The left one holds the stick toward where it is
   * best to stand; the right one presses, drags to aim and lets go: half the
   * time right away (the shot stays armed), half the time as the ball arrives.
   */
  async function playTwoThumbs({ until, maxMs, shots = {} }) {
    let aimHeld = false;
    let aimMode = 'timed';
    let aimSince = 0;
    let lastBall = -1;
    let servedAt = 0;
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      const s = await look();
      if (await until(s)) break;
      if (s.state !== 'playing') {
        await sleep(30);
        continue;
      }

      if (s.serving && Date.now() - servedAt > 1200) {
        servedAt = Date.now();
        await phone.touchUp(1);
        await sleep(200);
        await phone.touchDown(2, AIM.x, AIM.y);
        await phone.touchMove(2, AIM.x - 20, AIM.y - 30);
        await sleep(60);
        if (shots.serve) await shots.serve();
        await phone.touchUp(2);
        aimHeld = false;
        continue;
      }

      // Left thumb: run to the advised spot while the ball is coming.
      const target = s.incoming && s.guide ? s.guide : null;
      if (target) {
        const dx = target[0] - s.me[0];
        const dy = target[1] - s.me[1];
        const distance = Math.hypot(dx, dy);
        if (distance < 0.3) {
          await phone.touchUp(1);
        } else {
          const tilt = Math.min(1, distance / 0.8) * STICK_RADIUS;
          // Up the screen is toward the net.
          const x = STICK.x + (dx / distance) * tilt;
          const y = STICK.y - (dy / distance) * tilt;
          if (phone.fingers.has(1)) await phone.touchMove(1, x, y);
          else {
            await phone.touchDown(1, STICK.x, STICK.y);
            await phone.touchMove(1, x, y);
          }
        }
      } else {
        await phone.touchUp(1);
      }

      // Right thumb: press, aim away from the rival, let go.
      const ball = s.incoming ? Math.round(s.time * 2) : -1;
      if (s.incoming && !aimHeld && !s.armed && ball !== lastBall) {
        lastBall = ball;
        aimHeld = true;
        aimSince = Date.now();
        aimMode = Math.random() < 0.5 ? 'early' : 'timed';
        const away = s.rivalX > 0 ? -1 : 1;
        const pick = Math.random();
        // Far up is a lob, down is a chiquita, anything else a normal shot.
        const dy = pick < 0.18 ? -125 : pick < 0.26 ? 50 : -40 - Math.random() * 30;
        await phone.touchDown(2, AIM.x, AIM.y);
        await phone.touchMove(2, AIM.x + away * (25 + Math.random() * 35), AIM.y + dy);
        if (shots.aiming) await shots.aiming(await look());
      } else if (aimHeld) {
        const waited = Date.now() - aimSince;
        const release =
          !s.incoming || (aimMode === 'early' ? waited > 140 : s.eta !== null && s.eta <= 0.03) || waited > 4000;
        if (release) {
          await phone.touchUp(2);
          aimHeld = false;
          if (shots.released) await shots.released(aimMode);
        }
      }
      await sleep(6);
    }
    await phone.touchUp(1);
    await phone.touchUp(2);
  }

  /**
   * Plays with one thumb: drag to run to the spot, lift, then flick to hit.
   * The same thumb cannot do both at once, so it stops a moment before the ball.
   */
  async function playOneHand({ until, maxMs }) {
    let flicked = -1;
    let servedAt = 0;
    const base = { x: WIDTH * 0.5, y: HEIGHT * 0.86 };
    const flick = async (dx, dy) => {
      await phone.touchDown(1, base.x, base.y);
      await phone.touchMove(1, base.x + dx * 0.5, base.y + dy * 0.5);
      await phone.touchMove(1, base.x + dx, base.y + dy);
      await phone.touchUp(1);
    };
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      const s = await look();
      if (await until(s)) break;
      if (s.state !== 'playing') {
        await sleep(30);
        continue;
      }
      if (s.serving && Date.now() - servedAt > 1200) {
        servedAt = Date.now();
        await phone.touchUp(1);
        await sleep(250);
        await flick(15, -70);
        continue;
      }
      const ball = s.incoming ? Math.round(s.time * 2) : -1;
      if (!s.incoming || !s.guide) {
        await phone.touchUp(1);
        await sleep(8);
        continue;
      }
      const dx = s.guide[0] - s.me[0];
      const dy = s.guide[1] - s.me[1];
      const distance = Math.hypot(dx, dy);
      const close = distance < 0.4 || (s.eta !== null && s.eta < 0.4);
      if (!close && !s.armed) {
        // Drag: held long enough, the touch is the stick.
        if (!phone.fingers.has(1)) {
          await phone.touchDown(1, base.x, base.y);
          await sleep(140);
        }
        await phone.touchMove(1, base.x + (dx / distance) * STICK_RADIUS, base.y - (dy / distance) * STICK_RADIUS);
      } else if (phone.fingers.has(1)) {
        // Lift gently: letting go of the stick must not count as a shot.
        await phone.touchMove(1, base.x, base.y);
        await sleep(90);
        await phone.touchUp(1);
      } else if (!s.armed && flicked !== ball) {
        flicked = ball;
        const away = s.rivalX > 0 ? -1 : 1;
        await flick(away * (20 + Math.random() * 30), -85);
      }
      await sleep(6);
    }
    await phone.touchUp(1);
  }

  try {
    if (throttle > 1) await phone.throttle(throttle);

    // ------------------------------------------------------------ first visit
    section('Primera visita');
    await phone.goto(preview.url);
    const opened = await phone.evaluate('performance.now()');
    let s = await look();
    check('abre directo en la cancha, con el saque listo', s.state === 'playing' && s.serving, `${Math.round(opened)} ms desde que empezó a cargar`);
    check('sin menú ni pantalla de título en el medio', s.screen === null);
    check('el primer peloteo es el tutorial', s.tutorial === true && s.introDone === false);
    await sleep(300);
    await shot('01-primera-visita');
    await watchEvents();

    // ------------------------------------------------------------ two thumbs
    section('Dos pulgares: joystick, y mantener, apuntar y soltar');
    let aimSeen = false;
    let aimKinds = new Set();
    let earlyReleases = 0;
    let timedReleases = 0;
    let pausedOnce = false;
    let skipped = null;
    let skipDetail = 'no hubo una pausa en la que probarlo';
    let shots = 0;
    await playTwoThumbs({
      maxMs: 420_000,
      shots: {
        serve: async () => {
          const aim = await phone.evaluate('window.padel.scene.aim');
          if (aim?.kind === 'serve' && !shots) await shot('02-apuntando-el-saque');
        },
        aiming: async (state) => {
          const aim = await phone.evaluate('window.padel.scene.aim');
          if (aim) {
            aimSeen = true;
            aimKinds.add(aim.kind);
            if (shots++ === 1) await shot('03-marca-de-objetivo');
          }
          void state;
        },
        released: async (mode) => {
          if (mode === 'early') earlyReleases++;
          else timedReleases++;
        },
      },
      until: async (state) => {
        if (state.state === 'over') return true;
        // Once, between two points: the pause button, and skipping the wait.
        if (!pausedOnce && state.phase === 'pointOver' && state.time > 8) {
          pausedOnce = true;
          await phone.touchReset();
          await tapButton('Pausa');
          check('el botón de pausa pausa', await reaches('paused'));
          const frozen = (await look()).time;
          await shot('04-pausa');
          await sleep(300);
          check('en pausa el partido no avanza', (await look()).time === frozen);
          await tapButton('Seguir');
          check('"Seguir" vuelve al partido', await reaches('playing'));
        } else if (skipped !== true && pausedOnce && state.pause?.then === 'serve' && state.pause.since < 0.3) {
          // A tap during the wait between points moves on. Not in its first
          // quarter of a second, so the thumb that was playing cannot eat the result.
          await phone.touchReset();
          await sleep(320);
          const before = await look();
          if (before.pause && before.pause.left > 0.3) {
            await phone.tap(WIDTH / 2, HEIGHT * 0.7);
            await sleep(60);
            const after = await look();
            const took = after.time - before.time;
            // Over well before it would have ended by itself: it was the tap.
            skipped = after.phase !== 'pointOver' && took < before.pause.left - 0.1;
            skipDetail = `a los ${before.pause.since.toFixed(2)} s de una pausa a la que le quedaban ${before.pause.left.toFixed(2)} s`;
          }
        }
        return false;
      },
    });

    s = await look();
    await shot('05-final');
    check('el partido termina', s.state === 'over', `estado: ${s.state}`);
    let all = await events();
    let mine = myHits(all);
    check('la marca de objetivo aparece mientras se apunta', aimSeen, [...aimKinds].join(', '));
    check('soltar pega: los gestos se convierten en golpes', mine.length >= 5, `${mine.length} golpes`);
    check('el joystick mueve al jugador hasta la pelota', mine.length >= 5);
    const early = mine.filter((e) => e.quality === 'early').length;
    check('soltar antes deja el golpe armado y sale igual', earlyReleases > 0 && early > 0, `${early} golpes armados de ${earlyReleases} sueltas tempranas`);
    const onTime = mine.filter((e) => e.quality === 'perfect' || e.quality === 'good').length;
    check('soltar cuando llega la pelota da bien o perfecto', timedReleases > 0 && onTime > 0, `${onTime} de ${timedReleases} sueltas a tiempo`);
    check('un toque en la pausa entre puntos la saltea', skipped === true, skipDetail);
    check('hubo saques propios', all.some((e) => e.type === 'hit' && e.team === 0 && e.kind === 'serve'));
    check('el tutorial termina solo después del primer golpe bueno', s.introDone === true);
    console.log('\n        timing: ', tally(mine, 'quality'));
    console.log('        golpes: ', tally(mine, 'kind'));
    console.log('        puntos: ', all.filter((e) => e.type === 'point').length, '  rival:', tally(all.filter((e) => e.type === 'hit' && e.team === 1), 'kind'));

    // ------------------------------------------------------------ screens
    section('Final, inicio y opciones');
    const rematch = await buttonAt('Revancha');
    check('al terminar, "Revancha" es el botón principal y ya está enfocado', !!rematch?.visible && rematch.focused && rematch.primary);
    await tapButton('Menú');
    await sleep(200);
    await shot('06-inicio');
    const quick = await buttonAt('Partida rápida');
    check('en el inicio, "Partida rápida" es el botón principal', !!quick?.visible && quick.primary && quick.focused);
    check('y queda en la mitad de abajo, al alcance del pulgar', !!quick && quick.y > HEIGHT * 0.5, `a ${Math.round(quick?.y ?? 0)} px de ${HEIGHT}`);
    await tapButton('Opciones');
    await sleep(150);
    await shot('07-opciones');
    check('las opciones no se van de la pantalla: "Volver" siempre a mano', !!(await buttonAt('Volver'))?.visible);
    await tapButton('Una mano');
    check('se puede cambiar de esquema desde las opciones', (await phone.evaluate('window.padel.settings.scheme')) === 'one');
    check('el movimiento asistido viene apagado', (await phone.evaluate('window.padel.settings.assistedMovement')) === false);
    await tapButton('Volver');

    // ------------------------------------------------------------ one hand
    section('Una mano: arrastrar para moverse, deslizar rápido para pegar');
    await tapButton('Partida rápida');
    check('"Partida rápida" empieza a un toque', await reaches('playing'));
    await watchEvents();
    await playOneHand({
      maxMs: 150_000,
      until: async (state) => state.state === 'over' || myHits(await events()).length >= 6,
    });
    all = await events();
    mine = myHits(all);
    await shot('08-una-mano');
    check('el deslizamiento rápido pega', mine.length >= 3, `${mine.length} golpes`);
    check('y el saque sale con un solo deslizamiento', all.some((e) => e.type === 'hit' && e.team === 0 && e.kind === 'serve'));
    console.log('\n        timing: ', tally(mine, 'quality'), '  golpes:', tally(mine, 'kind'));

    // A slow drag is only movement: letting go must not hit.
    await phone.touchReset();
    await watchEvents();
    const before = await look();
    await phone.touchDown(1, WIDTH / 2, HEIGHT * 0.86);
    await sleep(160);
    await phone.touchMove(1, WIDTH / 2 + 40, HEIGHT * 0.86);
    await sleep(420);
    const during = await look();
    await sleep(120);
    await phone.touchUp(1);
    await sleep(200);
    const swings = (await events()).filter((e) => (e.type === 'whiff' || e.type === 'hit') && e.player === 0);
    if (before.phase === 'rally' && during.phase === 'rally') {
      check('arrastrar despacio mueve al jugador', during.me[0] - before.me[0] > 0.6, `x: ${before.me[0].toFixed(2)} → ${during.me[0].toFixed(2)}`);
      check('y soltar despacio no es un golpe', swings.length === 0);
    }

    // ------------------------------------------------------------ save and resume
    section('Cerrar a mitad de partido y volver');
    await phone.touchReset();
    // Wait for a point to be played, so there is something to pick up again.
    for (const deadline = Date.now() + 60_000; Date.now() < deadline; await sleep(100)) {
      const state = await look();
      if (state.phase === 'serve' && state.score.some((n) => n > 0)) break;
      if (state.serving) await phone.swipe(WIDTH / 2, HEIGHT * 0.86, WIDTH / 2 + 10, HEIGHT * 0.86 - 70, 40);
    }
    const leaving = (await look()).score;
    await sleep(150);
    await phone.goto(preview.url);
    await sleep(300);
    s = await look();
    await shot('09-volver');
    check('la segunda visita abre en el inicio, no en la cancha', s.state === 'menu' && s.screen === 'menu');
    const goOn = await buttonAt('Seguir el partido');
    check('el partido a medias se puede seguir', !!goOn?.visible);
    check('"Partida rápida" sigue siendo el botón principal', !!(await buttonAt('Partida rápida'))?.primary);
    if (goOn?.visible) {
      await tapButton('Seguir el partido');
      await reaches('playing');
      const back = (await look()).score;
      check('y sigue con el mismo marcador', JSON.stringify(back) === JSON.stringify(leaving), `${leaving.join(' ')} → ${back.join(' ')}`);
    }

    // ------------------------------------------------------------ background
    await phone.evaluate(`(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    check('al pasar a segundo plano se pausa sola', await reaches('paused'));

    // ------------------------------------------------------------ notch
    section('Zonas seguras (notch y barra de inicio)');
    const insets = { top: 47, bottom: 34, left: 0, right: 0 };
    if (await phone.setSafeArea(insets)) {
      await phone.goto(preview.url);
      await sleep(300);
      await tapButton('Partida rápida');
      await reaches('playing');
      await sleep(300);
      const layout = await phone.evaluate(`(() => {
        const rect = (q) => document.querySelector(q).getBoundingClientRect();
        const g = window.padel;
        return {
          score: rect('.score').top, pause: rect('#pause').top, hint: innerHeight - rect('#hint').bottom,
          courtTop: g.renderer.camera.bounds.top, courtBottom: g.renderer.camera.bounds.bottom,
          safe: g.platform.display.safeArea(),
        };
      })()`);
      await shot('10-con-notch');
      check('el juego lee la zona segura del dispositivo', layout.safe.top === insets.top && layout.safe.bottom === insets.bottom);
      check('el marcador y la pausa quedan debajo del notch', layout.score >= insets.top && layout.pause >= insets.top, `a ${Math.round(layout.score)} px`);
      check('la cancha también baja', layout.courtTop >= insets.top + 78 - 1, `empieza a ${Math.round(layout.courtTop)} px`);
      check('la zona del pulgar queda arriba de la barra de inicio', layout.hint >= insets.bottom && layout.courtBottom <= HEIGHT * 0.88 - insets.bottom + 1);
      await phone.setSafeArea({ top: 0, bottom: 0, left: 0, right: 0 });
    } else {
      console.log('        (este navegador no permite emular la zona segura: sin verificar)');
    }

    // ------------------------------------------------------------ desktop
    section('Computadora: mouse y teclado');
    await phone.asDesktop(1280, 800);
    await phone.goto(preview.url);
    await sleep(300);
    await phone.evaluate(`(() => { const g = window.padel; g.settings.scheme = 'two'; g.applySettings(); })()`);
    const stage = await phone.evaluate(`(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return { left: r.left, width: r.width, height: r.height }; })()`);
    check('el juego es una columna vertical centrada', Math.abs(stage.width - 450) < 2 && Math.abs(stage.left - 415) < 2, `${Math.round(stage.width)}x${stage.height} a ${Math.round(stage.left)} px del borde`);
    const play = await buttonAt('Partida rápida');
    await phone.mouseDrag(play.x, play.y, play.x, play.y, 20);
    check('un clic en "Partida rápida" empieza el partido', await reaches('playing'));
    await watchEvents();
    await sleep(300);
    // Hold, drag and release with the mouse: aim and serve.
    const mouseX = stage.left + stage.width * 0.7;
    await phone.mouseDrag(mouseX, 690, mouseX - 20, 660, 80);
    await sleep(900);
    check('mantener, arrastrar y soltar con el mouse saca', (await events()).some((e) => e.type === 'hit' && e.kind === 'serve' && e.team === 0));
    const start = await look();
    await phone.key('ArrowLeft', 37, 500);
    const moved = await look();
    check('las flechas mueven al jugador', start.me[0] - moved.me[0] > 0.5, `x: ${start.me[0].toFixed(2)} → ${moved.me[0].toFixed(2)}`);
    await phone.key('KeyK', 75);
    await sleep(250);
    check('una tecla de golpe pega (o deja el golpe armado)', (await look()).armed || (await events()).some((e) => (e.type === 'hit' || e.type === 'whiff') && e.player === 0 && e.kind !== 'serve'));
    await shot('11-computadora');
    await phone.key('KeyP', 80);
    check('la tecla P pausa', await reaches('paused'));
    await phone.key('KeyP', 80);
    check('y vuelve a jugar', await reaches('playing'));

    // ------------------------------------------------------------ packaged
    section('Como app: abierto desde un archivo, sin servidor');
    const outside = phone.requests.filter((url) => !url.startsWith(preview.url) && !url.startsWith('data:') && !url.startsWith('about:'));
    check('no pide nada fuera de su propio paquete', outside.length === 0, outside.slice(0, 2).join(' '));
    const assets = phone.requests.filter((url) => url.startsWith(preview.url)).map((url) => url.slice(preview.url.length) || 'index.html');
    console.log('        archivos pedidos:', [...new Set(assets)].join(', '));

    await phone.setScreen(WIDTH, HEIGHT, 3);
    const fileUrl = pathToFileURL(join(root, 'dist', 'index.html')).href;
    await phone.goto(fileUrl);
    await sleep(500);
    const local = await phone.evaluate(`(() => {
      const g = window.padel;
      return g ? { state: g.state, phase: g.match.phase, protocol: location.protocol } : null;
    })()`);
    check('abre desde file://, como lo cargaría una app', !!local && local.protocol === 'file:', local ? `estado: ${local.state}` : 'no arrancó');
    if (local) {
      await phone.evaluate(`window.padel.start('demo')`);
      await sleep(1500);
      const running = await phone.evaluate(`({ state: window.padel.state, time: window.padel.match.time })`);
      check('y juega', running.state === 'playing' && running.time > 0.5, `${running.time.toFixed(1)} s de partido`);
      await shot('12-desde-archivo');
    }

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
