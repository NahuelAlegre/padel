#!/usr/bin/env node
/**
 * The moments the body has to work for the ball, frame by frame.
 *
 *   npm run build && npm run frames
 *   npm run frames -- --url http://localhost:5183/      (a dev server that is already running)
 *
 * Plays the demo (the computer against itself) with a fixed seed, so the
 * same moments come up every time and two versions of the animation can be
 * put side by side. It looks for the balls that ask the most of a body: the
 * lowest one, the furthest one (a lunge), a backhand, one over the head, on
 * the near side and on the far one. Each is saved frame by frame around its
 * contact: a close crop of the player at the density of the phone, and the
 * whole screen at the contact.
 *
 * Options:
 *   --url <address>     a page already being served (otherwise it serves the build)
 *   --out .frames       folder for the pictures
 *   --label ahora       prefix of every file, to tell two versions apart
 *   --seed 1            seed of the demo
 *   --single            one against one instead of doubles
 *   --alcance real      the reach of a real person (real) or today's (actual)
 *   --seconds 80        how much of the match to look through
 *   --2d                the plain look, without 3D
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPhone, option, root, startPreview } from './lib/browser.mjs';

const settings = {
  url: option('url', null),
  out: String(option('out', join(root, '.frames'))),
  label: String(option('label', 'ahora')),
  seed: Number(option('seed', 1)),
  doubles: option('single', false) !== true,
  reach: String(option('alcance', 'real')),
  seconds: Number(option('seconds', 80)),
  flat: option('2d', false) === true,
};

/** Frames around the contact, at 60 per second: from a third of a second before to a quarter after. */
const OFFSETS = [-20, -12, -7, -3, 0, 5, 12];

/** Runs in the page: a demo that always plays the same, stopped, moved on by hand. */
function install() {
  window.__frames = {
    begin(seed) {
      // Every random choice of the match comes from here, so it plays the same every time.
      let s = seed >>> 0;
      Math.random = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      Date.now = () => 1700000000000;
      const game = window.padel;
      game.start('demo');
      game.stopLoop();
      this.frame = 0;
      this.hits = [];
      game.onSimEvent = (event) => {
        if (event.type !== 'hit' || event.kind === 'serve') return;
        const player = game.match.players[event.player];
        this.hits.push({
          frame: this.frame,
          player: event.player,
          near: player.team === 0,
          kind: event.kind,
          forehand: event.forehand,
          z: event.z,
          gap: Math.hypot(event.x - player.x, event.y - player.y),
          speed: Math.hypot(player.vx, player.vy),
        });
      };
    },
    step(frames) {
      for (let i = 0; i < frames; i++) {
        this.frame++;
        window.padel.advance(1 / 60);
      }
    },
    scan(frames) {
      const game = window.padel;
      for (let i = 0; i < frames && game.match.phase !== 'matchOver'; i++) this.step(1);
      return this.hits;
    },
    /** Where on screen a player and the ball it is about to meet are, in CSS pixels. */
    box(index) {
      const game = window.padel;
      const player = game.match.players[index];
      const anim = player.anim;
      const at = { x: 0, y: 0 };
      const xs = [];
      const ys = [];
      const k = 1.2 + 0.3 * Math.min(1, Math.max(0, (player.y + 8) / 16));
      for (const [x, y, z] of [
        [player.x, player.y, 0],
        [player.x, player.y, 2.3 * k],
        [player.x + anim.reachX, player.y + anim.reachY, anim.reachZ],
      ]) {
        game.renderer.project(x, y, z, at);
        xs.push(at.x);
        ys.push(at.y);
      }
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    },
  };
}

/** The balls worth looking at, one of each kind, from what the scan saw. */
function choose(hits) {
  const pick = [];
  const take = (name, list, better) => {
    const best = list.reduce((a, b) => (a && better(a) >= better(b) ? a : b), null);
    if (best && !pick.some((p) => p.hit === best)) pick.push({ name, hit: best });
  };
  for (const near of [true, false]) {
    const side = hits.filter((hit) => hit.near === near);
    const where = near ? 'cerca' : 'lejos';
    // The most common one: a forehand at the waist, where the simulation likes it.
    take(`${where}-derecha`, side.filter((hit) => hit.forehand && hit.kind !== 'lob' && hit.z > 0.55 && hit.z < 1 && hit.gap < 0.8 && hit.speed < 1), (hit) => -Math.abs(hit.z - 0.8));
    take(`${where}-baja`, side.filter((hit) => hit.z < 0.45 && hit.speed < 1), (hit) => -hit.z);
    take(`${where}-lejana`, side.filter((hit) => hit.gap > 0.95 && hit.speed < 1), (hit) => hit.gap);
    take(`${where}-reves-baja`, side.filter((hit) => !hit.forehand && hit.z < 0.7 && hit.speed < 1), (hit) => -hit.z);
    take(`${where}-arriba`, side.filter((hit) => hit.z > 1.9), (hit) => hit.z);
    take(`${where}-corriendo`, side.filter((hit) => hit.speed > 2.5), (hit) => hit.gap);
  }
  return pick.sort((a, b) => a.hit.frame - b.hit.frame);
}

async function main() {
  mkdirSync(settings.out, { recursive: true });
  const server = settings.url ? null : await startPreview();
  const phone = await openPhone({ width: 360, height: 800, dpr: 3 });
  try {
    const query = [settings.doubles ? 'dobles' : '', settings.reach === 'real' ? 'alcance=real' : '', settings.flat ? '2d' : ''].filter(Boolean).join('&');
    const base = settings.url ?? server.url;
    await phone.goto(`${base}${query ? `?${query}` : ''}`);
    // Until the court and the character are here the game is drawn without them.
    for (let i = 0; i < 100; i++) {
      const ready = await phone.evaluate('!!window.padel && window.padel.renderer.court !== null && (window.padel.renderer.look === "3d") === ' + !settings.flat);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await phone.evaluate(`(${install.toString()})()`);
    await phone.evaluate(`window.__frames.begin(${settings.seed})`);
    const hits = await phone.evaluate(`window.__frames.scan(${Math.round(settings.seconds * 60)})`);
    const moments = choose(hits);
    const look = await phone.evaluate('window.padel.renderer.look');
    console.log(`${settings.doubles ? 'Dobles' : '1 contra 1'}, alcance ${settings.reach}, semilla ${settings.seed}, ${look}: ${hits.length} golpes, ${moments.length} momentos`);

    const report = [];
    for (const moment of moments) {
      const hit = moment.hit;
      // From the start again for every moment: what comes before is the same, so the frame is too.
      await phone.evaluate(`window.__frames.begin(${settings.seed})`);
      await phone.evaluate(`window.__frames.step(${hit.frame + OFFSETS[0]})`);
      let frame = hit.frame + OFFSETS[0];
      const box = await phone.evaluate(`window.__frames.box(${hit.player})`);
      // A square round the player and its ball, a little bigger than both.
      const size = Math.max(70, Math.max(box.right - box.left, box.bottom - box.top) * 1.5);
      const cx = (box.left + box.right) / 2;
      const cy = (box.top + box.bottom) / 2;
      const clip = {
        x: Math.round(Math.min(Math.max(cx - size / 2, 0), 360 - size)),
        y: Math.round(Math.min(Math.max(cy - size / 2, 0), 800 - size)),
        width: Math.round(size),
        height: Math.round(size),
      };
      for (const offset of OFFSETS) {
        const target = hit.frame + offset;
        await phone.evaluate(`window.__frames.step(${target - frame})`);
        frame = target;
        const name = `${settings.label}-${moment.name}-${offset >= 0 ? '+' : ''}${offset}`;
        await phone.screenshot(join(settings.out, `${name}.png`), clip);
        if (offset === 0) await phone.screenshot(join(settings.out, `${settings.label}-${moment.name}-pantalla.png`));
      }
      const line = `${moment.name}: cuadro ${hit.frame}, jugador ${hit.player}, ${hit.kind}${hit.forehand ? '' : ' de revés'}, pelota a ${Math.round(hit.z * 100)} cm del piso y ${Math.round(hit.gap * 100)} cm del cuerpo, ${hit.speed.toFixed(1)} m/s`;
      report.push(line);
      console.log(`  ${line}`);
    }
    writeFileSync(join(settings.out, `${settings.label}-momentos.txt`), `${report.join('\n')}\n`);
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
