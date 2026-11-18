/* Prueba 3D · versión A: bucle principal de la escena con sprites prerrenderizados. */
(function (g) {
  'use strict';
  const P3 = g.P3;
  const scene = document.getElementById('escena');
  const canvas = document.getElementById('lienzo');
  const veil = document.getElementById('velo');
  const loading = document.getElementById('carga');
  const ASSETS = (g.P3_ASSETS || 'assets/');
  const q = new URLSearchParams(g.location.search);

  async function main() {
    const [court, sprites] = await Promise.all([P3.loadCourt(ASSETS + 'cancha/'), P3.loadJSON(ASSETS + 'sprites/sprites.json')]);
    const names = Object.keys(sprites.views);
    const imgs = await Promise.all(names.map((n) => P3.loadImage(ASSETS + 'sprites/' + sprites.views[n].file)));
    const sheets = Object.fromEntries(names.map((n, i) => [n, imgs[i]]));
    const R = P3.makeSpriteRenderer(canvas, court, sprites, sheets);
    const count = names.reduce((a, n) => a + Object.values(sprites.views[n].clips).reduce((b, c) => b + c.frames.length, 0), 0);
    const ui = P3.makeUI(scene, {
      version: 'A', name: 'Sprites',
      other: g.P3_OTHER === undefined ? { label: 'Ver versión B', href: 'tiempo-real.html' } : g.P3_OTHER,
      note: 'Personajes renderizados antes en Blender: ' + count + ' cuadros en dos hojas. En pantalla todo es Canvas 2D.',
    });
    let rally = P3.buildRally(sprites.clips, P3.SCALES[ui.state.scale]);
    const clock = P3.makeClock(rally.duration);
    if (q.has('t')) { clock.t = Number(q.get('t')); clock.paused = true; ui.state.paused = true; }
    if (q.has('desde')) clock.t = Number(q.get('desde'));
    clock.speed = q.has('vel') ? Number(q.get('vel')) : 1;
    const follow = P3.makeFollow();
    let lay = P3.layout(g.innerWidth, g.innerHeight);
    const dprCap = q.has('dpr') ? Number(q.get('dpr')) : 2;
    const fit = () => { lay = P3.layout(g.innerWidth, g.innerHeight); R.resize(lay, Math.min(dprCap, g.devicePixelRatio || 1)); };
    fit();
    g.addEventListener('resize', fit);
    ui.onChange((key) => {
      if (key === 'escala') rally = P3.buildRally(sprites.clips, P3.SCALES[ui.state.scale]);
      if (key === 'paused') clock.paused = ui.state.paused;
    });
    const st = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    const views = ['espalda', 'frente'];
    const ball = { x: 0, y: 0, z: 0, trail: [] }, bt = {}, markP = {}, aimP = {};
    const showAim = q.get('ayudas') === 'apuntar';     /* demostración de la marca de objetivo */
    let prevT = clock.t, first = true, closeK = 0;
    const tmp = {};

    function frame(now) {
      const w0 = performance.now();
      const t = clock.tick(now);
      const snap = first || clock.wrapped || clock.paused;
      const chars = [];
      for (let i = 0; i < 2; i++) {
        const s = rally.player(i, t, st[i]);
        chars.push({ x: s.x, y: s.y, k: s.k, clip: s.clip, time: s.time, view: views[i] });
      }
      rally.ball(t, ball);
      ball.trail.length = 0;
      if (ball.visible && !ball.held && ball.speed > 5) {
        for (let k = 1; k <= 5; k++) { rally.ball(Math.max(0, t - k * 0.014), bt); ball.trail.push([bt.x, bt.y, bt.z]); }
      }
      const moving = ui.state.follow && !ui.state.reduce;
      const mark = rally.mark(t, markP);
      const ctx = { player: st[0], rival: st[1], ball, mark, lay };
      if (first || clock.paused || clock.wrapped) follow.jump(ctx, moving); else follow.update(ctx, clock.dt, moving);
      closeK = P3.clamp(closeK + (ui.state.close ? 1 : -1) * clock.dt / 0.5, 0, 1);
      /* efectos de impacto (cortos y chicos); con «reducir movimiento» no se dibujan */
      const fx = [];
      if (!ui.state.reduce) for (const e of rally.events) { const age = t - e.t, dur = P3.FX[e.type]; if (dur && age >= 0 && age < dur) fx.push({ e, age }); }
      ball.timing = rally.timing(t);
      const fade = rally.fade(t);
      veil.style.opacity = clock.paused ? 0 : (1 - fade) * 0.9;
      R.draw({ follow, chars, ball, fx, mark, aim: showAim ? rally.aim(t, aimP) : null, fade, nearAlpha: P3.NEAR_WALL_ALPHA, closeK: P3.smooth(closeK), focus: st[0] });
      if (!first && !clock.paused) {
        for (const e of P3.crossed(rally.events, prevT, t)) {
          if (e.type !== 'golpe' || !e.label) continue;
          const pl = st[e.who];
          const c = R.toCss(R.place(pl.x, pl.y, 2.05 * pl.k, tmp));
          ui.label(e.label, c.x, c.y - 6, e.label.charAt(0) === '¡');
        }
      }
      prevT = t;
      if (first) {
        first = false;
        loading.remove();
        g.__p3 = { version: 'A', firstFrame: performance.now(), ui, renderer: R, clock };
      }
      ui.tick(performance.now() - w0);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  main().catch((err) => {
    loading.classList.add('error');
    loading.textContent = 'No se pudo abrir la escena: ' + err.message;
    console.error(err);
  });
})(window);
