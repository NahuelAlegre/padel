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
 * lowest one, the furthest one (a lunge), a backhand, one over the head, one
 * running, on the near side and on the far one. And for what the computer
 * gets wrong, and why: a hurried swing, a block of a ball at the body, a
 * ball it did not get to, a ball it stole from its partner and one of those
 * that went wrong, a ball that caught it by surprise, and the most a long
 * point got to somebody. Each is
 * saved frame by frame: a close crop of the player at the density of the
 * phone, and the whole screen at the contact.
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
 *   --buscar            only list the moments of that seed, without pictures
 *   --forzar perdon     also a «perdón» after an ordinary forehand, forced: a
 *                       stolen ball that goes wrong is rare in the demo
 *   --estudio carrera   only a run that ends at a ball out of reach, made up
 *                       frame by frame and drawn without the simulation (the
 *                       computer stops to hit, so the demo never shows it)
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
  scanOnly: option('buscar', false) === true,
  force: option('forzar', null),
  studio: option('estudio', null),
};

/** Frames around the contact, at 60 per second: from a third of a second before to a quarter after. */
const OFFSETS = [-20, -12, -7, -3, 0, 5, 12];
/** After a ball that caught somebody by surprise: from the shot that did it to when it gets going. */
const AFTER = [4, 10, 16, 22, 28, 36, 46];
/** A longer stretch after a stroke, for what the body does once the ball is gone (a miss, a steal). */
const LATER = [-7, 0, 8, 16, 26, 38, 52];
/** Somebody waiting for the ball, deep into a point. */
const STILL = [-6, 0, 6];
/** The made-up run (`--estudio carrera`): frames around its contact, and the frame of the contact. */
const STUDIO = [-24, -16, -10, -5, 0, 6, 14];
const STUDIO_AT = 40;

/** Runs in the page: a demo that always plays the same, stopped, moved on by hand. */
function install(studioAt) {
  // How far back to look for how fast somebody came to a ball, in frames.
  const ARRIVAL_FRAMES = 20;
  // The made-up run: how fast, and how far to the side and ahead of the feet the ball is met.
  const RUN = 4;
  const OUT = 1.3;
  const AHEAD = 0.3;
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
      this.tense = null;
      this.stolen = null;
      // Where everybody was at the end of each of the last frames: how fast it was going, measured on the court.
      this.trail = [];
      const speedOf = (player) => {
        const was = this.trail[player.id]?.at(-1);
        return was ? Math.hypot(player.x - was[0], player.y - was[1]) * 60 : 0;
      };
      // The computer stops to hit: how fast it came, in the third of a second before.
      const arrivalOf = (player) => {
        const trail = [...(this.trail[player.id] ?? []), [player.x, player.y]];
        let most = 0;
        for (let i = 1; i < trail.length; i++) most = Math.max(most, Math.hypot(trail[i][0] - trail[i - 1][0], trail[i][1] - trail[i - 1][1]) * 60);
        return most;
      };
      game.onSimEvent = (event) => {
        const match = game.match;
        this.followSteal(event, match);
        if (event.type === 'whiff' && event.reason === 'far') {
          // The computer swung and did not get there.
          const player = match.players[event.player];
          this.hits.push({ frame: this.frame, player: event.player, near: player.team === 0, kind: 'whiff', forehand: true, z: 1, gap: 0, speed: speedOf(player) });
          return;
        }
        if (event.type !== 'hit' || event.kind === 'serve') return;
        const player = match.players[event.player];
        if (match.pairs[player.team]?.why === 'steal') this.stolen = { player: player.id, team: player.team };
        this.hits.push({
          frame: this.frame,
          player: event.player,
          near: player.team === 0,
          kind: event.kind,
          forehand: event.forehand,
          z: event.z,
          gap: Math.hypot(event.x - player.x, event.y - player.y),
          speed: speedOf(player),
          arrival: arrivalOf(player),
          why: event.why ?? null,
          // «¡Mía!»: until the next ball comes to its pair, the pair still says it stole this one.
          steal: match.pairs[player.team]?.why === 'steal',
        });
        // Whoever this ball caught by surprise: it read it much later than it usually does.
        for (const other of match.players) {
          if (other.team === player.team || other.isHuman || other.read < other.reaction * 1.25) continue;
          this.hits.push({ frame: this.frame, player: other.id, near: other.team === 0, kind: 'surprise', forehand: true, z: 1, gap: other.read / other.reaction, speed: 0 });
        }
      };
    },
    /**
     * Doubles: how a ball somebody stole from its partner went, judged as the
     * renderer judges it (see `StageRenderer.followSteal`). One that went wrong
     * is a moment: the «perdón» to the partner.
     */
    followSteal(event, match) {
      const sorry = (id) => this.hits.push({ frame: this.frame, player: id, near: match.players[id].team === 0, kind: 'sorry', forehand: true, z: 1, gap: 0, speed: 0 });
      if (event.type === 'whiff') {
        // It called «¡mía!» and the swing did not get there.
        const player = match.players[event.player];
        if (match.pairs[player.team]?.why === 'steal' && match.assigned[player.team] === player.id) sorry(player.id);
        return;
      }
      const stolen = this.stolen;
      if (!stolen) return;
      let well = null;
      if (event.type === 'hit') well = match.players[event.player].team !== stolen.team ? true : null;
      else if (event.type === 'bounce') well = (event.y > 0) === (stolen.team === 0);
      else if (event.type === 'point') well = event.winner === stolen.team;
      if (well === null) {
        // Another ball of its own pair: that steal is over without a verdict.
        if (event.type === 'hit') this.stolen = null;
        return;
      }
      this.stolen = null;
      if (!well) sorry(stolen.player);
    },
    /** «Perdón» to the partner, as after a stolen ball that went wrong, whatever really happened (see `--forzar`). */
    sorry(index) {
      const game = window.padel;
      const who = game.match.players[index];
      const mate = game.match.players.find((other) => other !== who && other.team === who.team);
      game.renderer.animators[index]?.stoleBadly(mate ? mate.x - who.x : 0);
    },
    step(frames) {
      const game = window.padel;
      for (let i = 0; i < frames; i++) {
        this.frame++;
        game.advance(1 / 60);
        for (const player of game.match.players) {
          const trail = (this.trail[player.id] ??= []);
          trail.push([player.x, player.y]);
          if (trail.length > ARRIVAL_FRAMES) trail.shift();
        }
        // The most a long point has got to somebody standing and waiting for the ball.
        const match = game.match;
        if (!match.rally.live) continue;
        for (const player of match.players) {
          const swinging = player.anim.kind !== 'idle' && (match.time - player.anim.t0) / player.anim.duration < 1;
          if (swinging || Math.hypot(player.vx, player.vy) > 0.3) continue;
          if (!this.tense || player.strain > this.tense.gap) {
            this.tense = { frame: this.frame, player: player.id, near: player.team === 0, kind: 'tension', forehand: true, z: 1, gap: player.strain, speed: 0 };
          }
        }
      }
    },
    scan(frames) {
      const game = window.padel;
      for (let i = 0; i < frames && game.match.phase !== 'matchOver'; i++) this.step(1);
      return this.tense ? [...this.hits, this.tense] : this.hits;
    },
    /**
     * The made-up run: player `index` runs across the court at `RUN` metres a
     * second, meets a ball `OUT` metres to the side of its racket at frame
     * `studioAt` and stops. The same scene, frame by frame, for any version of
     * the animation; the simulation does not move meanwhile.
     */
    studioStart(index) {
      const game = window.padel;
      const who = game.scene.players[index];
      const facing = who.team === 0 ? 1 : -1;
      const side = who.restSide;
      const path = [];
      // From further back, so that it gets to the ball about where it is now.
      let x = who.x - side * RUN * 0.96 * (studioAt / 60);
      let y = who.y;
      let stride = who.stride;
      for (let f = 0; f <= studioAt + 60; f++) {
        const t = (f - studioAt) / 60;
        const speed = RUN * (t <= 0 ? 1 : Math.max(0, 1 - t / 0.3));
        const vx = side * speed * 0.96;
        const vy = facing * speed * 0.28;
        path.push({ x, y, vx, vy, stride });
        x += vx / 60;
        y += vy / 60;
        stride += Math.hypot(vx, vy) / 60;
      }
      const at = path[studioAt];
      this.studio = { index, frame: -1, path, side, facing, time: game.scene.time, ball: [at.x + side * OUT, at.y + facing * AHEAD, 0.7] };
      this.studioStep(1);
    },
    studioStep(frames) {
      const game = window.padel;
      const scene = game.scene;
      const st = this.studio;
      for (let i = 0; i < frames; i++) {
        st.frame++;
        const p = st.path[Math.min(st.frame, st.path.length - 1)];
        const t = (st.frame - studioAt) / 60;
        const who = scene.players[st.index];
        Object.assign(who, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, stride: p.stride, shot: 'drive', animSide: st.side, tell: null, act: null, call: null });
        Object.assign(who, { why: null, surprise: 0, tension: 0, stealing: false });
        const swinging = t < 0.45;
        who.anim = swinging ? 'swing' : 'idle';
        who.animPhase = t <= 0 ? -1 : Math.min(1, t / 0.45);
        who.contactIn = swinging ? -t : Infinity;
        who.reachX = st.ball[0] - p.x;
        who.reachY = st.ball[1] - p.y;
        who.reachZ = st.ball[2];
        // The ball comes from the other side to where it is met, and goes back.
        const away = Math.abs(t);
        Object.assign(scene.ball, {
          x: st.ball[0] - st.side * t * 0.8,
          y: st.ball[1] + st.facing * away * 11,
          z: st.ball[2] + away * 0.9,
          vx: -st.side * 0.8,
          vy: st.facing * (t < 0 ? -11 : 11),
          vz: t < 0 ? -0.9 : 0.9,
          visible: true,
          held: false,
          live: true,
        });
        scene.time = st.time + st.frame / 60;
        game.renderer.render(scene, 1 / 60);
      }
    },
    /** Where on screen the made-up runner and its ball are, in CSS pixels. */
    studioBox() {
      const game = window.padel;
      const st = this.studio;
      const at = { x: 0, y: 0 };
      const xs = [];
      const ys = [];
      const contact = st.path[studioAt];
      const start = st.path[Math.max(0, studioAt - 10)];
      for (const [x, y, z] of [
        [contact.x, contact.y, 0],
        [contact.x, contact.y, 2.8],
        [start.x, start.y, 0],
        [st.ball[0], st.ball[1], st.ball[2]],
      ]) {
        game.renderer.project(x, y, z, at);
        xs.push(at.x);
        ys.push(at.y);
      }
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
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
  const take = (name, list, better, offsets = OFFSETS) => {
    const best = list.reduce((a, b) => (a && better(a) >= better(b) ? a : b), null);
    if (best && !pick.some((p) => p.hit === best)) pick.push({ name, hit: best, offsets });
  };
  const strokes = hits.filter((hit) => hit.kind !== 'whiff' && hit.kind !== 'surprise' && hit.kind !== 'tension' && hit.kind !== 'sorry');
  // What the computer gets wrong, and why, so that it can be seen without reading (see docs/ia.md).
  for (const near of [true, false]) {
    const where = near ? 'cerca' : 'lejos';
    const side = hits.filter((hit) => hit.near === near);
    // A ball it got to with no time to set up ('forced' once the AI calls it so).
    take(`${where}-apurado`, side.filter((hit) => hit.why === 'hurried' || hit.why === 'forced'), (hit) => hit.arrival);
    take(`${where}-bloqueo`, side.filter((hit) => hit.why === 'reflex'), (hit) => -hit.frame);
    take(`${where}-no-llego`, side.filter((hit) => hit.kind === 'whiff'), (hit) => -hit.frame, LATER);
    take(`${where}-robo`, side.filter((hit) => hit.steal), (hit) => -hit.frame, LATER);
    take(`${where}-perdon`, side.filter((hit) => hit.kind === 'sorry'), (hit) => -hit.frame, LATER);
    take(`${where}-sorprendido`, side.filter((hit) => hit.kind === 'surprise'), (hit) => hit.gap, AFTER);
  }
  take('tension', hits.filter((hit) => hit.kind === 'tension'), (hit) => hit.gap, STILL);
  for (const near of [true, false]) {
    const side = strokes.filter((hit) => hit.near === near);
    const where = near ? 'cerca' : 'lejos';
    // The most common one: a forehand at the waist, where the simulation likes it.
    take(`${where}-derecha`, side.filter((hit) => hit.forehand && hit.kind !== 'lob' && hit.z > 0.55 && hit.z < 1 && hit.gap < 0.8 && hit.speed < 1), (hit) => -Math.abs(hit.z - 0.8));
    take(`${where}-baja`, side.filter((hit) => hit.z < 0.45 && hit.speed < 1), (hit) => -hit.z);
    take(`${where}-lejana`, side.filter((hit) => hit.gap > 0.95 && hit.speed < 1), (hit) => hit.gap);
    take(`${where}-reves-baja`, side.filter((hit) => !hit.forehand && hit.z < 0.7 && hit.speed < 1), (hit) => -hit.z);
    take(`${where}-arriba`, side.filter((hit) => hit.z > 1.9), (hit) => hit.z);
    // The end of a run: it came fast and the ball is out of its reach standing.
    take(`${where}-corriendo`, side.filter((hit) => hit.arrival > 2.5), (hit) => hit.gap);
  }
  if (settings.force === 'perdon') {
    for (const where of ['cerca', 'lejos']) {
      const plain = pick.find((p) => p.name === `${where}-derecha`);
      if (plain) pick.push({ name: `${where}-perdon-forzado`, hit: plain.hit, offsets: LATER, force: true });
    }
  }
  return pick.sort((a, b) => a.hit.frame - b.hit.frame);
}

/** The made-up run, for the player nearest the camera on its side: a few seconds into the demo. */
async function studio(phone) {
  await phone.evaluate('window.__frames.step(240)');
  await phone.evaluate('window.__frames.studioStart(0)');
  // It starts at frame 0: on to the first one to look at.
  await phone.evaluate(`window.__frames.studioStep(${STUDIO_AT + STUDIO[0]})`);
  let frame = STUDIO_AT + STUDIO[0];
  const box = await phone.evaluate('window.__frames.studioBox()');
  const size = Math.max(70, Math.max(box.right - box.left, box.bottom - box.top) * 1.5);
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const clip = {
    x: Math.round(Math.min(Math.max(cx - size / 2, 0), 360 - size)),
    y: Math.round(Math.min(Math.max(cy - size / 2, 0), 800 - size)),
    width: Math.round(size),
    height: Math.round(size),
  };
  for (const offset of STUDIO) {
    const target = STUDIO_AT + offset;
    if (target > frame) await phone.evaluate(`window.__frames.studioStep(${target - frame})`);
    frame = target;
    await phone.screenshot(join(settings.out, `${settings.label}-estudio-carrera-${offset >= 0 ? '+' : ''}${offset}.png`), clip);
  }
  console.log(`Estudio: una carrera a 4 m/s que termina en una pelota a 1,3 m al costado, ${STUDIO.length} cuadros`);
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
    await phone.evaluate(`(${install.toString()})(${STUDIO_AT})`);
    await phone.evaluate(`window.__frames.begin(${settings.seed})`);
    if (settings.studio === 'carrera') {
      await studio(phone);
      return;
    }
    const hits = await phone.evaluate(`window.__frames.scan(${Math.round(settings.seconds * 60)})`);
    const moments = choose(hits);
    const look = await phone.evaluate('window.padel.renderer.look');
    console.log(`${settings.doubles ? 'Dobles' : '1 contra 1'}, alcance ${settings.reach}, semilla ${settings.seed}, ${look}: ${hits.length} golpes, ${moments.length} momentos`);
    if (settings.scanOnly) {
      for (const moment of moments) console.log(`  ${moment.name}: cuadro ${moment.hit.frame}, jugador ${moment.hit.player}, venía a ${(moment.hit.arrival ?? 0).toFixed(1)} m/s`);
      return;
    }

    const report = [];
    for (const moment of moments) {
      const hit = moment.hit;
      // From the start again for every moment: what comes before is the same, so the frame is too.
      await phone.evaluate(`window.__frames.begin(${settings.seed})`);
      const offsets = moment.offsets;
      await phone.evaluate(`window.__frames.step(${hit.frame + offsets[0]})`);
      let frame = hit.frame + offsets[0];
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
      for (const offset of offsets) {
        const target = hit.frame + offset;
        await phone.evaluate(`window.__frames.step(${target - frame})`);
        frame = target;
        const name = `${settings.label}-${moment.name}-${offset >= 0 ? '+' : ''}${offset}`;
        await phone.screenshot(join(settings.out, `${name}.png`), clip);
        if (offset === 0) await phone.screenshot(join(settings.out, `${settings.label}-${moment.name}-pantalla.png`));
        if (offset === 0 && moment.force) await phone.evaluate(`window.__frames.sorry(${hit.player})`);
      }
      const line = moment.force
        ? `${moment.name}: cuadro ${hit.frame}, jugador ${hit.player}, «perdón» forzado después de un golpe común`
        : hit.kind === 'surprise' || hit.kind === 'tension' || hit.kind === 'whiff' || hit.kind === 'sorry'
          ? `${moment.name}: cuadro ${hit.frame}, jugador ${hit.player}${
              hit.kind === 'surprise'
                ? `, leyó ${hit.gap.toFixed(1)} veces más lento que de costumbre`
                : hit.kind === 'tension'
                  ? `, tensión ${hit.gap.toFixed(2)}`
                  : hit.kind === 'sorry'
                    ? ', le robó la pelota al compañero y salió mal'
                    : ', no llegó'
            }`
          : `${moment.name}: cuadro ${hit.frame}, jugador ${hit.player}, ${hit.kind}${hit.forehand ? '' : ' de revés'}${hit.why ? ` (${hit.why})` : ''}${hit.steal ? ' robada' : ''}, pelota a ${Math.round(hit.z * 100)} cm del piso y ${Math.round(hit.gap * 100)} cm del cuerpo, ${hit.speed.toFixed(1)} m/s (venía a ${hit.arrival.toFixed(1)})`;
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
