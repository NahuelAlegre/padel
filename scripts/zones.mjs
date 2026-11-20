#!/usr/bin/env node
/**
 * The hit zones, played in a real browser (docs/zonas.md).
 *
 *   npm run build && node scripts/zones.mjs
 *   node scripts/zones.mjs --url http://localhost:5183/   (with the development server)
 *
 * Opens the game on an emulated phone in a headless Chrome, with the hit
 * zones on, in doubles with the real reach (?zonas&dobles&alcance=real) and
 * in 1 against 1 (?zonas). In each, a small player inside the page moves the
 * person and hits, the way a thumb would, in two ways: setting up at the side
 * of the ball, and standing on its line, where it comes at the body. While
 * it plays it looks at what the screen shows:
 *
 *   - where each of the person's balls was met (the zone of the hit), and
 *     how hard it was;
 *   - what the body was showing just before the contact (block, hurried);
 *   - the names on screen («Bloqueo» for a ball at the body);
 *   - balls the person swung at and never got to hit;
 *   - anything the page logged as an error.
 *
 * It saves a screenshot of the moment of a block in each match.
 *
 * Options:
 *   --url http://...   a server that is already running, instead of the build
 *   --seconds 60       how long each match is played for
 *   --out .zones       folder for the screenshots
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openPhone, option, root, sleep, startPreview } from './lib/browser.mjs';

const out = resolve(root, String(option('out', '.zones')));
const seconds = Number(option('seconds', 60));
const given = option('url', null);

/** The player inside the page: moves the person and hits, and writes down what happens. */
const BOT = (mode) => `(() => {
  const game = window.padel;
  // A new match on the same page goes on adding to what the last one wrote down.
  const before = window.zoneBot;
  if (before) cancelAnimationFrame(before.raf);
  const bot = { mode: ${JSON.stringify(mode)}, hits: before ? before.hits : [], labels: before ? before.labels : {}, swung: before ? before.swung : 0, unhit: before ? before.unhit : 0, raf: 0, swungFor: -1, served: -1, shot: before ? before.shot : false, lastLabel: null, lastAge: Infinity };
  window.zoneBot = bot;
  game.onSimEvent = (event) => {
    const match = game.match;
    const player = match.players[event.player];
    if (event.type === 'hit' && player && player.isHuman && event.kind !== 'serve') {
      const drawn = game.scene.players[event.player];
      bot.hits.push({ zone: event.zone, pressure: event.pressure, speed: event.speed, look: drawn ? drawn.why : null });
      bot.lastHitAt = match.time;
    }
  };
  const tick = () => {
    const match = game.match;
    const me = match.players.find((p) => p.isHuman);
    // Each name that comes up on screen, once.
    const label = game.renderer.director.label;
    if (label && (label.text !== bot.lastLabel || label.age < bot.lastAge)) bot.labels[label.text] = (bot.labels[label.text] || 0) + 1;
    bot.lastLabel = label ? label.text : null;
    bot.lastAge = label ? label.age : Infinity;
    if (me && game.state === 'playing') {
      const dir = me.team === 0 ? 1 : -1;
      if (match.phase === 'serve' && match.serverId === me.id && bot.served !== match.tick) {
        bot.served = match.tick;
        game.input.pushSwing({ aim: 0.5, depth: 0.6, lob: false, power: 1 });
      }
      const traj = match.trajectory;
      const mine = match.rally.live && traj && match.rally.hitter !== me.team && match.assigned[me.team] === me.id;
      let mx = 0;
      let my = 0;
      if (mine && me.guide) {
        // Setting up: to the side of the ball. On its line: where it comes at the body.
        const tx = bot.mode === 'stance' ? me.guide.stanceX : me.guide.x;
        const ty = bot.mode === 'stance' ? me.guide.stanceY : me.guide.y - dir * 0.05;
        const dx = tx - me.x;
        const dy = ty - me.y;
        const d = Math.hypot(dx, dy);
        const push = d > 0.05 ? Math.min(1, d / 0.6) : 0;
        mx = (dx / Math.max(d, 1e-6)) * push * dir;
        my = (dy / Math.max(d, 1e-6)) * push * dir;
      }
      game.input.setMove('stick', mx, my);
      if (mine && me.plan && bot.swungFor !== traj.id && match.time >= me.plan.t - 0.2) {
        bot.swungFor = traj.id;
        bot.swung++;
        bot.swingAt = match.time;
        game.input.pushSwing({ aim: Math.random() < 0.5 ? -0.8 : 0.8, depth: 0.8, lob: false, power: 1 });
      }
      // A swing that was still armed when the ball changed hands or the point ended never got its ball.
      if (bot.swingAt !== undefined && (!match.rally.live || match.rally.hitter === me.team || (traj && traj.id !== bot.swungFor))) {
        if (!(bot.lastHitAt >= bot.swingAt)) bot.unhit++;
        bot.swingAt = undefined;
      }
      // Pause on the first block, for the picture.
      if (!bot.shot && game.scene.players[me.id].why === 'block' && me.plan && match.time >= me.plan.t - 0.08) {
        bot.shot = true;
        bot.blockAt = match.time;
        game.pause();
      }
    }
    bot.raf = requestAnimationFrame(tick);
  };
  bot.raf = requestAnimationFrame(tick);
  return true;
})()`;

async function play(phone, url, name, mode) {
  await phone.goto(url);
  await sleep(1500);
  // Straight into a quick match, without the first-visit greeting.
  await phone.evaluate(`(() => { const g = window.padel; g.profile.introDone = true; if (g.state !== 'playing') g.start('quick'); return g.state; })()`);
  await sleep(500);
  await phone.evaluate(BOT(mode));
  let pictured = false;
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    await sleep(250);
    const state = await phone.evaluate(`({ state: window.padel.state, shot: window.zoneBot.shot })`);
    if (state.shot && !pictured && state.state === 'paused') {
      pictured = true;
      // The pause screen covers the court: take it away for the picture, then go on.
      await phone.evaluate(`(() => { const s = document.querySelector('#overlay'); if (s) s.style.visibility = 'hidden'; return true; })()`);
      await sleep(150);
      await phone.screenshot(join(out, `${name}-${mode}-bloqueo.png`));
      await phone.evaluate(`(() => { const s = document.querySelector('#overlay'); if (s) s.style.visibility = ''; window.padel.resume(); return true; })()`);
    } else if (state.state === 'paused') {
      await phone.evaluate(`window.padel.resume()`);
    } else if (state.state !== 'playing') {
      await phone.evaluate(`(() => { const g = window.padel; g.start('quick'); return true; })()`);
      await sleep(300);
      await phone.evaluate(BOT(mode));
    }
  }
  const bot = await phone.evaluate(`(() => { const b = window.zoneBot; cancelAnimationFrame(b.raf); return { hits: b.hits, labels: b.labels, swung: b.swung, unhit: b.unhit, config: window.padel.match.config.zones.on, real: window.padel.match.config.player.realReach, players: window.padel.match.players.length }; })()`);
  return bot;
}

function describe(name, mode, bot) {
  const n = bot.hits.length;
  const count = (zone) => bot.hits.filter((hit) => hit.zone === zone).length;
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
  const body = bot.hits.filter((hit) => hit.zone === 'body');
  const blocked = body.filter((hit) => hit.look === 'block').length;
  const behind = bot.hits.filter((hit) => hit.zone === 'behind');
  const hurried = behind.filter((hit) => hit.look === 'hurried').length;
  const ideal = bot.hits.filter((hit) => hit.zone === 'ideal');
  const meanOf = (hits, key) => (hits.length ? (hits.reduce((a, hit) => a + hit[key], 0) / hits.length).toFixed(2) : '-');
  console.log(
    [
      `\n${name}, ${mode === 'stance' ? 'al costado de la pelota' : 'en la línea de la pelota'} (zonas ${bot.config ? 'sí' : 'no'}, alcance ${bot.real ? 'real' : 'actual'}, ${bot.players} jugadores)`,
      `  golpes de la persona ${n}: ideal ${pct(ideal.length, n)}, al cuerpo ${pct(body.length, n)}, atrás ${pct(behind.length, n)}, lejos ${pct(count('far'), n)}, arriba ${pct(count('high'), n)}, abajo ${pct(count('low'), n)}`,
      `  presión media: ideal ${meanOf(ideal, 'pressure')}, al cuerpo ${meanOf(body, 'pressure')}   velocidad media: ideal ${meanOf(ideal, 'speed')} m/s, al cuerpo ${meanOf(body, 'speed')} m/s`,
      `  el cuerpo lo mostró antes del contacto: bloqueo en ${blocked} de ${body.length} al cuerpo, apurado en ${hurried} de ${behind.length} atrás`,
      `  carteles: ${Object.entries(bot.labels).map(([text, times]) => `${text} ×${times}`).join(', ') || 'ninguno'}`,
      `  golpes pedidos ${bot.swung}, sin pelota ${bot.unhit}`,
    ].join('\n'),
  );
}

async function main() {
  mkdirSync(out, { recursive: true });
  const preview = given ? null : await startPreview();
  const base = String(given ?? preview.url).replace(/\/?$/, '/');
  const phone = await openPhone({ width: 360, height: 800, dpr: 3 });
  try {
    for (const [name, query] of [
      ['dobles', '?zonas&dobles&alcance=real'],
      ['1 contra 1', '?zonas'],
    ]) {
      for (const mode of ['stance', 'line']) describe(name, mode, await play(phone, base + query, name.replace(/ /g, '-'), mode));
    }
    console.log(`\nErrores de la página: ${phone.errors.length ? phone.errors.join(' | ') : 'ninguno'}`);
    console.log(`Capturas en ${out}`);
    if (phone.errors.length) process.exitCode = 1;
  } finally {
    await phone.close();
    preview?.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
