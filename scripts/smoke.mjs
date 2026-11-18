#!/usr/bin/env node
/**
 * End-to-end check: plays the game on an emulated phone with real touches.
 *
 *   npm run build && npm run smoke
 *
 * Opens the production build in a headless Chrome set up as a portrait phone
 * with a touch screen and goes through what a person would:
 *
 *   - the first visit, straight onto the court, in 3D, with the rival saying hello;
 *   - a whole match with two thumbs: one on the stick, the other holding,
 *     aiming and letting go, while the rival gives its shots away, has its
 *     tics and says its lines. All along it watches the screen stay clean
 *     and the camera keep everything that matters in view;
 *   - the start screen, the options, and a few points with one hand, the
 *     still camera and every aid on;
 *   - losing the graphics context in the middle of a point and getting it
 *     back, and a device with no WebGL2 at all: the game goes on in 2D;
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
 *   --nogpu            run the browser without a graphics card
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
/** The shots that get their name on screen with the minimal aids. */
const SPECIAL = new Set(['Bandeja', 'Víbora', 'Salida de pared', '¡Remate!', 'Contrapared']);

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
  const phone = await openPhone({ width: WIDTH, height: HEIGHT, dpr: 3, gpu: !option('nogpu', false) });
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
        // The rival: what its windup gives away, the tic it is in, and what it is saying.
        tell: g.scene.players[1]?.tell?.pose ?? null,
        act: g.scene.players[1]?.act?.clip ?? null,
        bubble: document.querySelector('#bubble.show')?.textContent ?? null,
        // How it is being drawn, and what is on screen besides the world.
        look: g.renderer.look,
        cam: [g.renderer.director.follow.pan, g.renderer.director.follow.zoom],
        aids: (() => {
          const f = g.renderer.director.frame;
          return {
            glow: f.ball.glow,
            eta: g.scene.contact ? g.scene.contact.eta : null,
            bounce: f.bounce ? [f.bounce.x, f.bounce.y] : null,
            ring: f.ring !== null,
            steps: f.guide !== null,
            timing: f.timing !== null,
            aim: f.aim !== null,
            // The mark of a shot that is already armed: the thumb has let go.
            armed: f.aim !== null && g.scene.aim !== null && g.scene.aim.armed,
            label: g.renderer.director.label ? g.renderer.director.label.text : null,
            hint: document.querySelector('#hint').textContent,
          };
        })(),
        // Where the things that matter fall on screen.
        view: (() => {
          const at = { x: 0, y: 0 };
          const on = (x, y, z) => { g.renderer.project(x, y, z, at); return [at.x, at.y]; };
          return {
            feet: on(me.x, me.y, 0),
            head: on(me.x, me.y, 2.2),
            ball: m.rally.live ? on(m.ball.x, m.ball.y, m.ball.z) : null,
            ballInCourt: Math.abs(m.ball.x) <= 5.2 && Math.abs(m.ball.y) <= 10.2,
            glass: on(0, -10, 0),
            rival: on(rival.x, rival.y, 2.8),
          };
        })(),
      };
    })()`);
  /** Adds what one look at the screen says to a running tally. */
  const tally2 = () => ({ samples: 0, not3d: 0, ring: 0, steps: 0, timing: 0, glow: 0, glowFar: 0, bounce: 0, bounceFar: 0, aim: 0, aimNoThumb: 0, labels: new Set(), hints: new Set(), panMax: 0, zoomMin: 9, zoomMax: 0, out: 0, ballOut: 0, glassLow: 0, moved: 0 });
  const note = (t, state) => {
    t.samples++;
    if (state.look !== '3d') t.not3d++;
    const a = state.aids;
    if (a.ring) t.ring++;
    if (a.steps) t.steps++;
    if (a.timing) t.timing++;
    if (a.glow > 0) {
      t.glow++;
      if (a.eta === null || a.eta > 0.2 || a.eta < -0.09) t.glowFar++;
    }
    if (a.bounce) {
      t.bounce++;
      if (a.bounce[1] > 0) t.bounceFar++;
    }
    if (a.aim) {
      t.aim++;
      if (a.armed) t.aimNoThumb++;
    }
    if (a.label) t.labels.add(a.label);
    if (a.hint) t.hints.add(a.hint);
    const [pan, zoom] = state.cam;
    t.panMax = Math.max(t.panMax, Math.abs(pan));
    t.zoomMin = Math.min(t.zoomMin, zoom);
    t.zoomMax = Math.max(t.zoomMax, zoom);
    if (pan !== 0 || zoom !== 1) t.moved++;
    const v = state.view;
    const inside = (p) => p[0] >= 0 && p[0] <= WIDTH && p[1] >= 0 && p[1] <= HEIGHT;
    if (!inside(v.feet) || !inside(v.head) || !inside(v.rival)) t.out++;
    if (v.ball && v.ballInCourt && !inside(v.ball)) t.ballOut++;
    if (v.glass[1] > HEIGHT - 20) t.glassLow++;
  };
  const reaches = async (expected, timeoutMs = 2500) => {
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(20)) {
      if ((await look()).state === expected) return true;
    }
    return false;
  };
  /** A button by its text. `group` narrows it to the options of one setting, for labels that repeat. */
  const buttonAt = (label, group = '', reveal = false) =>
    phone.evaluate(`(() => {
      const wanted = ${JSON.stringify(label)};
      const scope = ${JSON.stringify(group)} ? document.querySelector('[data-key="' + ${JSON.stringify(group)} + '"]') : document;
      if (!scope) return null;
      const button = [...scope.querySelectorAll('button')].find((b) => {
        const own = [...b.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
        return own === wanted || b.getAttribute('aria-label') === wanted;
      });
      if (!button) return null;
      if (${reveal}) button.scrollIntoView({ block: 'center' });
      const r = button.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        bottom: r.bottom,
        visible: r.top >= 0 && r.bottom <= innerHeight && button.contains(top),
        focused: document.activeElement === button,
        primary: button.classList.contains('primary'),
        pressed: button.getAttribute('aria-pressed') === 'true',
      };
    })()`);
  const tapButton = async (label, group = '') => {
    let at = null;
    for (const deadline = Date.now() + 2500; Date.now() < deadline; await sleep(25)) {
      at = await buttonAt(label, group, true);
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
    for (const deadline = Date.now() + 4000; Date.now() < deadline && (await look()).look !== '3d'; ) await sleep(50);
    const timings = await phone.evaluate('window.padel.renderer.timings');
    s = await look();
    check('se ve en 3D', s.look === '3d', `primer cuadro a los ${Math.round(timings.firstFrame)} ms de crear el renderer, en 3D a los ${Math.round(timings.first3d)} ms`);
    const ghost = await phone.evaluate('window.padel.scene.tutorial');
    check('el tutorial no tiene texto: lo muestran los pulgares fantasma', s.aids.hint === '' && ghost?.step === 'serve', `texto de ayuda: "${s.aids.hint}"`);
    await sleep(300);
    s = await look();
    check('el rival saluda con un globito que no frena nada', s.bubble === '¡Hola! Soy Beto, el profe.' && s.serving, s.bubble ?? 'sin globito');
    const hello = await phone.evaluate(`(() => {
      const g = window.padel, who = g.match.players[1], at = { x: 0, y: 0 };
      g.renderer.project(who.x, who.y, 3.0, at);
      const r = document.querySelector('#bubble').getBoundingClientRect();
      return { head: at, left: r.left, right: r.right, bottom: r.bottom, top: r.top };
    })()`);
    check(
      'el globito está sobre la cabeza del rival, dentro de la pantalla',
      hello.left >= 0 && hello.right <= WIDTH && hello.head.x > hello.left && hello.head.x < hello.right && Math.abs(hello.bottom - hello.head.y) < 40,
      `termina a ${Math.round(hello.head.y - hello.bottom)} px de la cabeza`,
    );
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
    const tells = new Set();
    const tics = new Set();
    const said = new Set();
    const seen = tally2();
    let helloClosed = null;
    let tellShot = false;
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
        if (state.state === 'playing') note(seen, state);
        if (state.tell) {
          tells.add(state.tell);
          if (!tellShot) {
            tellShot = true;
            await shot('03b-gesto-delator');
          }
        }
        if (state.act) tics.add(state.act);
        if (state.bubble) said.add(state.bubble);
        // The first serve of the match closes the hello at once.
        if (helloClosed === null && state.phase !== 'serve') helloClosed = state.bubble !== '¡Hola! Soy Beto, el profe.';
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
    check('el saque cierra el saludo: nadie espera a que termine', helloClosed === true);
    check('el rival decide su golpe antes de pegar y lo delata', tells.has('pointAim'), [...tells].join(', '));
    check('entre puntos tiene sus manías', tics.size > 0, [...tics].join(', '));

    section('Pantalla limpia (ayudas mínimas, como viene)');
    check('todo el partido se vio en 3D', seen.not3d === 0 && seen.samples > 200, `${seen.samples} miradas`);
    check('sin anillo bajo tu jugador y sin anillo de timing', seen.ring + seen.timing === 0);
    const wallHints = await phone.evaluate('window.padel.profile.hints.wall');
    check(
      'las huellas, solo como pista de la pelota que va a salir del vidrio: dos veces como mucho',
      wallHints <= 2 && (seen.steps === 0 || wallHints > 0) && seen.steps < seen.samples * 0.2,
      `${wallHints} pistas, huellas en ${seen.steps} de ${seen.samples} miradas`,
    );
    check('una sola señal de timing: la pelota se enciende en el último instante', seen.glow > 0 && seen.glowFar === 0, `encendida en ${seen.glow} de ${seen.samples} miradas`);
    check('la marca de pique, solo en tu lado', seen.bounce > 0 && seen.bounceFar === 0, `${seen.bounce} miradas con marca`);
    check('la marca de objetivo, solo mientras el pulgar apunta', seen.aim > 0 && seen.aimNoThumb === 0, `${seen.aim} miradas con marca, ${seen.aimNoThumb} con el pulgar ya suelto`);
    const plain = [...seen.labels].filter((label) => !SPECIAL.has(label));
    check('solo se nombran los golpes especiales', plain.length === 0, [...seen.labels].join(', ') || 'ninguno esta vez');
    check('ningún texto de ayuda en todo el partido', seen.hints.size === 0, [...seen.hints].join(' | '));
    const assist = await phone.evaluate('window.padel.profile.assist');
    check('las ayudas mínimas se fueron apagando con los aciertos', assist < 1, `queda ${Math.round(assist * 100)} % de lo que se apaga`);

    section('Cámara que acompaña');
    check('se mueve, y siempre dentro de sus límites', seen.moved > seen.samples * 0.3 && seen.zoomMin >= 1 && seen.zoomMax <= 1.3 && seen.panMax < 3.2, `zoom ${seen.zoomMin.toFixed(2)} a ${seen.zoomMax.toFixed(2)}, paneo hasta ${seen.panMax.toFixed(2)} m`);
    check('tu jugador y el rival, siempre enteros en pantalla', seen.out === 0);
    check('la pelota en juego, siempre en pantalla', seen.ballOut === 0);
    check('tu vidrio de fondo, siempre a la vista', seen.glassLow === 0);
    console.log('        dijo:   ', [...said].join(' · ') || '(nada más que el saludo)');
    console.log('\n        timing: ', tally(mine, 'quality'));
    console.log('        golpes: ', tally(mine, 'kind'));
    console.log('        puntos: ', all.filter((e) => e.type === 'point').length, '  rival:', tally(all.filter((e) => e.type === 'hit' && e.team === 1), 'kind'));

    // ------------------------------------------------------------ screens
    section('Final, inicio y opciones');
    const rematch = await buttonAt('Revancha');
    check('al terminar, "Revancha" es el botón principal y ya está enfocado', !!rematch?.visible && rematch.focused && rematch.primary);
    const quote = await phone.evaluate(`document.querySelector('.panel .quote')?.textContent ?? null`);
    check('el rival pide la revancha al lado del botón', !!quote && quote.startsWith('Beto: «'), quote ?? 'sin frase');
    const history = await phone.evaluate(`JSON.stringify(window.padel.profile.rivals.beto)`);
    check('queda la historia con ese rival', /"played":1/.test(history), history);
    await tapButton('Menú');
    await sleep(200);
    await shot('06-inicio');
    const pointsBefore = await phone.evaluate('window.padel.profile.pointsWon + window.padel.profile.pointsLost');
    const quick = await buttonAt('Partida rápida');
    check('en el inicio, "Partida rápida" es el botón principal', !!quick?.visible && quick.primary && quick.focused);
    check('y queda en la mitad de abajo, al alcance del pulgar', !!quick && quick.y > HEIGHT * 0.5, `a ${Math.round(quick?.y ?? 0)} px de ${HEIGHT}`);
    const about = await phone.evaluate(`[...document.querySelectorAll('[data-key="rival"] .note')].map((n) => n.textContent).join(' | ')`);
    check('el inicio dice quién es el rival y cómo van', about.includes('«el Profe» ★') && /Vas 1 a 0|Te lleva 1 a 0/.test(about), about);

    // ------------------------------------------------------------ tutorial
    section('Tutorial: lecciones cortas que se juegan');
    const tutorialButton = await buttonAt('Tutorial');
    check('el inicio tiene "Tutorial" a mano, sin sacarle el lugar a la partida rápida', !!tutorialButton?.visible && !tutorialButton.primary);
    await tapButton('Tutorial');
    await shot('06b-tutorial');
    const lessonList = await phone.evaluate(`[...document.querySelectorAll('.lessons .btn')].map((b) => b.textContent)`);
    check('son ocho lecciones y se ofrece la primera', lessonList.length === 8 && !!(await buttonAt('1. Moverse y pegar'))?.primary, lessonList.join(' · '));
    await tapButton('3. Globo');
    check('cualquiera se puede elegir, y empieza a un toque', await reaches('playing'));
    const lessonState = () =>
      phone.evaluate(`(() => {
        const g = window.padel, box = document.querySelector('#lesson'), ghost = g.scene.tutorial, aim = g.renderer.director.frame.aim;
        return {
          state: g.state,
          screen: g.screens.current,
          mode: g.mode,
          name: box.querySelector('b').textContent,
          cue: box.querySelector('small').textContent,
          pips: box.querySelector('.pips').textContent,
          lessonShown: !box.hidden,
          scoreHidden: document.querySelector('.score').hidden,
          coach: g.scene.players[1]?.character ?? null,
          coachNet: Math.abs(g.match.players[1].y),
          ghost: ghost ? { step: ghost.step, drag: ghost.drag ? { ...ghost.drag } : null } : null,
          aim: aim ? { double: aim.double, radius: aim.radius } : null,
          progress: g.drill ? g.drill.progress : -1,
          incoming: g.match.rally.live && g.match.rally.hitter !== 0,
          eta: g.match.players[0].plan ? g.match.players[0].plan.t - g.match.time : null,
        };
      })()`);
    let lessonView = await lessonState();
    for (const deadline = Date.now() + 4000; Date.now() < deadline && !(lessonView.incoming && lessonView.ghost); await sleep(40)) lessonView = await lessonState();
    await shot('06c-leccion-globo');
    check('en lugar del marcador, el nombre de la lección y sus tres pelotas', lessonView.lessonShown && lessonView.scoreHidden && lessonView.name === '3. Globo' && lessonView.pips === '○○○', `${lessonView.name} ${lessonView.pips}`);
    check('el profe es Beto, y para el globo se para en la red', lessonView.coach === 'beto' && lessonView.coachNet < 4, `a ${lessonView.coachNet.toFixed(1)} m de la red`);
    check('el pulgar fantasma muestra el gesto: arrastrar bien arriba', lessonView.ghost?.step === 'aim' && lessonView.ghost.drag?.y < -110, JSON.stringify(lessonView.ghost));
    // Three lobs, with the real thumb: press, drag well up, let go. The ball comes to where the person stands.
    let markSaid = null;
    let plainMark = null;
    for (const deadline = Date.now() + 45000; Date.now() < deadline; await sleep(40)) {
      lessonView = await lessonState();
      if (lessonView.state !== 'playing' || lessonView.progress >= 3) break;
      if (!lessonView.incoming || lessonView.eta === null || phone.fingers.has(2)) continue;
      await phone.touchDown(2, AIM.x, AIM.y);
      await phone.touchMove(2, AIM.x + 6, AIM.y - 40);
      await sleep(70);
      plainMark ??= (await lessonState()).aim;
      await phone.touchMove(2, AIM.x + 6, AIM.y - 135);
      await sleep(70);
      markSaid ??= (await lessonState()).aim;
      await phone.touchUp(2);
      // Wait for this ball to be played before the next one.
      for (const until = Date.now() + 4000; Date.now() < until && (await lessonState()).incoming; await sleep(40));
    }
    check('la marca de objetivo dice qué golpe es: con el globo, doble anillo', plainMark?.double === false && markSaid?.double === true, JSON.stringify({ plainMark, markSaid }));
    for (const deadline = Date.now() + 5000; Date.now() < deadline && (await lessonState()).screen !== 'tutorial'; await sleep(50));
    lessonView = await lessonState();
    await shot('06d-leccion-hecha');
    const afterLesson = await phone.evaluate(`(() => ({
      text: document.querySelector('.panel .result')?.textContent ?? '',
      done: [...document.querySelectorAll('.lessons .btn')].filter((b) => b.querySelector('small')).map((b) => b.textContent),
      saved: window.padel.profile.lessons.join(','),
      shots: window.padel.profile.shots.lob,
      points: window.padel.profile.pointsWon + window.padel.profile.pointsLost,
    }))()`);
    check('con tres globos la lección queda hecha y vuelve la lista', lessonView.screen === 'tutorial' && afterLesson.text === '¡Globo: hecha!', afterLesson.text);
    check('la lista la marca con una tilde y una palabra, y ofrece la siguiente', afterLesson.done.length === 1 && afterLesson.done[0].includes('✓ Hecha') && !!(await buttonAt('4. Chiquita'))?.primary, afterLesson.done.join(' · '));
    check('queda guardada, y no cuenta como partido ni como puntos', afterLesson.saved === 'lob' && afterLesson.shots >= 3 && afterLesson.points === pointsBefore, `${afterLesson.saved}, ${afterLesson.points} puntos`);
    // A lesson can be left at any time, from its own pause.
    await tapButton('1. Moverse y pegar');
    await reaches('playing');
    await sleep(300);
    const pauseAt = await phone.evaluate(`(() => { const r = document.querySelector('#pause').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await phone.tap(pauseAt.x, pauseAt.y);
    check('en pausa, la lección ofrece volver a las lecciones', (await reaches('paused')) && !!(await buttonAt('Lecciones'))?.visible);
    await tapButton('Menú');
    check('y al salir vuelve el inicio de siempre', (await look()).screen === 'menu' && !!(await buttonAt('Partida rápida'))?.primary);

    // ------------------------------------------------------------ hints
    section('Pistas en contexto: el golpe que conviene, una vez');
    const hint = await phone.evaluate(`(() => {
      const g = window.padel;
      // The ball off the glass is already known, so that hint is out of the way.
      g.profile.shots = { lob: 0, drop: 0, wall: 1 };
      g.profile.hints = { lob: 0, drop: 0, wall: 0 };
      g.start('quick');
      g.stopLoop();
      const m = g.match, me = m.players[0], rival = m.players[1];
      let servedAt = -9;
      for (let i = 0; i < 60 * 60; i++) {
        if (m.phase === 'serve' && m.serverId === me.id && m.time - servedAt > 1.5) {
          g.input.pushSwing({ aim: 0, depth: 0.6, lob: false, power: 1 });
          servedAt = m.time;
        }
        // Nobody is on the stick here: the person is stood where the advice says, so the ball comes within reach.
        if (m.rally.live && m.rally.hitter !== me.team && me.guide) {
          me.x = me.guide.stanceX;
          me.y = me.guide.stanceY;
        }
        g.advance(1 / 60);
        const plan = me.plan;
        const eta = plan ? plan.t - m.time : 9;
        if (plan && m.rally.live && m.rally.hitter !== me.team && eta < 1.2 && eta > 0.3 && Math.abs(plan.y) >= 5 && plan.z < 1.9) {
          // The rival is at the net: the ball to play is the lob.
          rival.y = 3;
          const first = g.sceneOptions().tutorial;
          const shown = first ? { step: first.step, drag: first.drag ? { ...first.drag } : null } : null;
          const counted = g.profile.hints.lob;
          g.sceneOptions();
          const again = g.profile.hints.lob;
          // Once the person has played one, nobody points at it again.
          g.profile.shots.lob = 1;
          const after = g.sceneOptions().tutorial;
          return { shown, counted, again, after: after === null };
        }
      }
      return null;
    })()`);
    check('con el rival en la red y sin haber tirado nunca un globo, el pulgar fantasma lo muestra', hint?.shown?.step === 'aim' && hint.shown.drag?.y < -110, JSON.stringify(hint?.shown ?? null));
    // An earlier ball of this same match may have shown it already: what matters is that this one counts once, and that there are never more than two.
    check('cuenta una sola vez por pelota, y dos veces como mucho en total', !!hint && hint.counted >= 1 && hint.counted <= 2 && hint.again === hint.counted, hint ? String(hint.counted) + ' y ' + String(hint.again) : 'sin pista');
    check('y después del primer globo no aparece más', hint?.after === true);
    await phone.evaluate(`(() => { const g = window.padel; g.toMenu(); g.saved = null; return g.platform.storage.remove('padel.match.v1'); })()`);
    await sleep(200);
    await phone.evaluate(`window.padel.toMenu()`);
    await sleep(150);
    await tapButton('Opciones');
    await sleep(150);
    await shot('07-opciones');
    check('las opciones no se van de la pantalla: "Volver" siempre a mano', !!(await buttonAt('Volver'))?.visible);
    await tapButton('Una mano');
    check('se puede cambiar de esquema desde las opciones', (await phone.evaluate('window.padel.settings.scheme')) === 'one');
    check('el movimiento asistido viene apagado', (await phone.evaluate('window.padel.settings.assistedMovement')) === false);
    await tapButton('Ninguna', 'lines');
    check('las frases del rival se pueden apagar', (await phone.evaluate('window.padel.settings.lines')) === 'none');
    await tapButton('Muchas', 'lines');
    check('las ayudas vienen en "Mínimas"', !!(await buttonAt('Mínimas', 'aids', true))?.pressed);
    await tapButton('Completas', 'aids');
    check('y se pueden pedir completas', (await phone.evaluate('window.padel.settings.aids')) === 'full');
    check('la cámara viene en "Acompaña"', !!(await buttonAt('Acompaña', 'camera', true))?.pressed);
    await shot('07b-opciones-camara');
    await tapButton('Fija', 'camera');
    check('y se puede elegir "Fija"', (await phone.evaluate('window.padel.settings.camera')) === 'fixed');
    await tapButton('Volver');

    // ------------------------------------------------------------ one hand
    section('Una mano: arrastrar para moverse, deslizar rápido para pegar');
    await tapButton('Partida rápida');
    check('"Partida rápida" empieza a un toque', await reaches('playing'));
    await sleep(200);
    check('al que ya conoce lo saluda distinto', (await look()).bubble === '¡Volviste! Me alegra.', (await look()).bubble ?? 'sin globito');

    // The graphics context goes away in the middle of the game, and comes back.
    section('Sin 3D: nadie se queda sin jugar');
    await phone.evaluate(`(() => {
      const gl = document.querySelector('#world').getContext('webgl2');
      window.__lose = gl.getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    })()`);
    await sleep(300);
    s = await look();
    check('si se pierde el contexto gráfico, el juego sigue en 2D', s.look === '2d' && s.state === 'playing');
    const clock = s.time;
    await sleep(400);
    check('y el partido no se frena', (await look()).time > clock + 0.2);
    await shot('07c-respaldo-2d');
    await phone.evaluate('window.__lose.restoreContext()');
    await sleep(500);
    check('cuando el contexto vuelve, vuelve el 3D', (await look()).look === '3d', `pérdidas: ${await phone.evaluate('window.padel.renderer.losses')}`);
    await shot('07d-de-vuelta-en-3d');

    section('Una mano, cámara fija y ayudas completas');
    await watchEvents();
    const full = tally2();
    await playOneHand({
      maxMs: 150_000,
      until: async (state) => {
        if (state.state === 'playing') note(full, state);
        return state.state === 'over' || myHits(await events()).length >= 6;
      },
    });
    all = await events();
    mine = myHits(all);
    await shot('08-una-mano');
    check('el deslizamiento rápido pega', mine.length >= 3, `${mine.length} golpes`);
    check('y el saque sale con un solo deslizamiento', all.some((e) => e.type === 'hit' && e.team === 0 && e.kind === 'serve'));
    check('con la cámara fija no se mueve nada', full.moved === 0 && full.samples > 50, `${full.samples} miradas`);
    check('y la cancha entera entra igual', full.out === 0 && full.ballOut === 0 && full.glassLow === 0);
    check('con las ayudas completas vuelven el anillo propio, el de timing y las huellas', full.ring === full.samples && full.timing > 0 && full.steps > 0);
    check('y cada golpe dice su nombre', full.labels.size > 0, [...full.labels].join(', '));
    await phone.evaluate(`(() => { const g = window.padel; g.settings.aids = 'minimal'; g.settings.camera = 'follow'; g.applySettings(); })()`);
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
    const behind = await phone.evaluate(`(() => { const r = window.padel.renderer; return { look: r.look, drawn: r.timings.first3d >= 0 }; })()`);
    check('con el club de fondo, en 3D, aunque el partido no esté corriendo', behind.look === '3d' && behind.drawn);
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

    // ------------------------------------------------------------ no WebGL2
    await phone.goto(`${preview.url}?2d`);
    await sleep(400);
    await tapButton('Partida rápida');
    await reaches('playing');
    await sleep(500);
    const flat = await phone.evaluate(`(() => { const r = window.padel.renderer; return { look: r.look, court: r.court !== null, time: window.padel.match.time }; })()`);
    await shot('09b-sin-webgl2');
    check('un dispositivo sin WebGL2 juega en 2D, con la cancha de siempre', flat.look === '2d' && flat.court && flat.time > 0.2);

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
        const g = window.padel, at = { x: 0, y: 0 };
        const y = (cx, cy, cz) => { g.renderer.project(cx, cy, cz, at); return at.y; };
        return {
          score: rect('.score').top, scoreBottom: rect('.score').bottom, pause: rect('#pause').top, hint: innerHeight - rect('#hint').bottom,
          farWall: y(0, 10, 4), nearGlass: y(0, -10, 0),
          safe: g.platform.display.safeArea(),
        };
      })()`);
      await shot('10-con-notch');
      check('el juego lee la zona segura del dispositivo', layout.safe.top === insets.top && layout.safe.bottom === insets.bottom);
      check('el marcador y la pausa quedan debajo del notch', layout.score >= insets.top && layout.pause >= insets.top, `a ${Math.round(layout.score)} px`);
      check('la cancha queda entera debajo del marcador', layout.farWall >= layout.scoreBottom, `el fondo empieza a ${Math.round(layout.farWall)} px, el marcador termina a ${Math.round(layout.scoreBottom)}`);
      check('y tu vidrio queda arriba de la barra de inicio y de los pulgares', layout.hint >= insets.bottom && layout.nearGlass <= HEIGHT - insets.bottom - 60, `a ${Math.round(HEIGHT - layout.nearGlass)} px del borde`);
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
    check(
      'baja la cancha en AVIF y el personaje comprimido, una sola vez cada uno',
      assets.includes('art/court/piso.avif') && assets.includes('art/character.bin.gz') && !assets.some((file) => file.endsWith('.webp') || file.endsWith('.bin')),
    );

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
      const running = await phone.evaluate(`({ state: window.padel.state, time: window.padel.match.time, look: window.padel.renderer.look, court: window.padel.renderer.court !== null })`);
      check('y juega', running.state === 'playing' && running.time > 0.5, `${running.time.toFixed(1)} s de partido`);
      // A page opened from disk cannot read the character file: it gets the 2D look, with the real court.
      check('desde un archivo se ve en 2D, con la cancha de siempre', running.look === '2d' && running.court);
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
