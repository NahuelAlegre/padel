/* Prueba 3D · versión B: bucle principal de la escena en tiempo real. */
(function (g) {
  'use strict';
  const P3 = g.P3;
  const scene = document.getElementById('escena');
  const canvas = document.getElementById('lienzo');
  const veil = document.getElementById('velo');
  const loading = document.getElementById('carga');
  const ASSETS = (g.P3_ASSETS || 'assets/');
  const q = new URLSearchParams(g.location.search);

  /* El personaje es un binario. Donde el hosting no sirve binarios genéricos (los Artifacts),
     viaja como texto en base64 y se decodifica acá. */
  async function loadCharacter(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' ' + r.status);
    if (!/\.txt$/.test(url)) return r.arrayBuffer();
    const bin = atob((await r.text()).trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  async function main() {
    const [court, buf] = await Promise.all([
      P3.loadCourt(ASSETS + 'cancha/'),
      loadCharacter(g.P3_CHAR || ASSETS + 'personaje.bin'),
    ]);
    const ch = P3.parseCharacter(buf);
    const R = P3.makeRenderer(canvas, court, ch);
    R.measureGpu = q.get('gpu') === '1';
    const skipChars = q.get('solo') === 'capas';
    const ui = P3.makeUI(scene, {
      version: 'B', name: 'Tiempo real',
      other: g.P3_OTHER === undefined ? { label: 'Ver versión A', href: 'sprites.html' } : g.P3_OTHER,
      note: 'Malla 3D dibujada en cada cuadro con WebGL2: ' + R.triangles.toLocaleString('es-AR') + ' triángulos por personaje.',
    });
    const nb = ch.meta.bones.names.length, n = nb * 4 + 3;
    let rally = P3.buildRally(ch.meta.clips, P3.SCALES[ui.state.scale]);
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
      if (key === 'escala') rally = P3.buildRally(ch.meta.clips, P3.SCALES[ui.state.scale]);
      if (key === 'paused') clock.paused = ui.state.paused;
    });

    const mk = () => ({
      st: { x: 0, y: 0 }, clip: null, pose: new Float32Array(n), target: new Float32Array(n), from: new Float32Array(n), mix: 1,
      mats: new Float32Array(26 * 16), work: { rot: new Float32Array(nb * 9), pos: new Float32Array(nb * 3) },
      life: P3.makeLife(ch),
    });
    const players = [mk(), mk()];
    const palettes = ['jugador', 'rival'];
    const ball = { x: 0, y: 0, z: 0, trail: [] };
    const bt = { x: 0, y: 0, z: 0 };
    let prevT = clock.t, first = true;
    const tmp = {};

    function frame(now) {
      const w0 = performance.now();
      const t = clock.tick(now), dt = clock.dt * clock.speed;
      const snap = first || clock.wrapped || clock.paused;
      const chars = [];
      for (let i = 0; i < 2; i++) {
        const p = players[i], st = rally.player(i, t, p.st);
        const clip = ch.clips[st.clip];
        P3.samplePose(ch, clip, st.time, p.target);
        if (st.clip !== p.clip) {
          /* cambio de clip: se funde desde la pose anterior en vez de saltar */
          p.from.set(p.pose);
          p.mix = snap || p.clip === null ? 1 : 0;
          p.clip = st.clip;
        }
        if (p.mix < 1) {
          p.mix = Math.min(1, p.mix + dt / 0.14);
          P3.blendPose(nb, p.from, p.target, P3.smooth(p.mix), p.pose);
        } else p.pose.set(p.target);
        P3.poseToMatrices(ch, p.pose, p.mats, p.work);
        chars.push({ x: st.x, y: st.y, yaw: st.yaw, k: st.k, mats: p.mats, palette: palettes[i], depth: 1, stroke: !clip.loop });
      }
      rally.ball(t, ball);
      /* vida propia del tiempo real: la cabeza sigue la pelota y la trenza se mueve con resorte */
      for (let i = 0; i < 2; i++) {
        const p = players[i];
        p.life.apply(p.pose, p.work, chars[i], ball, clock.paused ? 0 : dt, chars[i].stroke ? 0.4 : 0.8);
        P3.poseToMatrices(ch, p.pose, p.mats, p.work);
      }
      ball.trail.length = 0;
      if (ball.visible && !ball.held && ball.speed > 5) {
        for (let k = 1; k <= 5; k++) { rally.ball(Math.max(0, t - k * 0.014), bt); ball.trail.push([bt.x, bt.y, bt.z]); }
      }
      const moving = ui.state.follow && !ui.state.reduce;
      if (first || clock.paused) follow.jump(players[0].st, ball, moving); else follow.update(players[0].st, ball, clock.dt, moving);
      let cam = P3.followCamera(null, follow);
      if (ui.state.close) cam = P3.closeCamera(players[0].st, cam, follow, clock.dt);
      else follow.close = 0;
      for (const c of chars) { cam.project(c.x, c.y, 1.0, tmp); c.depth = tmp.d; }

      const rings = [];
      if (!ui.state.reduce) for (const e of rally.events) { const age = t - e.t; if (age >= 0 && age < 0.32 && e.type !== 'suelta') rings.push({ e, age }); }
      if (!first && !clock.paused) {
        for (const e of P3.crossed(rally.events, prevT, t)) {
          if (e.type !== 'golpe' || !e.label) continue;
          const pl = players[e.who].st;
          const s = R.projectCss(cam, lay, pl.x, pl.y, 2.05 * pl.k);
          ui.label(e.label, s.x, s.y - 6, e.label.charAt(0) === '¡');
        }
      }
      prevT = t;
      const fade = rally.fade(t);
      veil.style.opacity = clock.paused ? 0 : (1 - fade) * 0.9;
      R.draw({ skipChars, cam, lay, chars, ball, rings, fade, skyShift: -follow.x * P3.PARALLAX.cielo * 20, nearAlpha: P3.NEAR_WALL_ALPHA });
      if (first) {
        first = false;
        loading.remove();
        g.__p3 = { version: 'B', firstFrame: performance.now(), ui, renderer: R, clock, gl: R.gl, players, character: ch, rally: () => rally, ball };
      }
      ui.tick(performance.now() - w0);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* cámara de «ver de cerca»: se planta detrás del jugador. Solo cambia la cámara; la escena es la misma. */
  P3.closeCamera = function (pl, cam, follow, dt) {
    follow.close = Math.min(1, (follow.close || 0) + dt / 0.5);
    const u = P3.smooth(follow.close);
    const target = { pos: [pl.x * 0.9 - 0.3, pl.y - 6.6, 4.3], pitch: 27, yaw: 2, f: P3.REF.f };
    const base = { pos: cam.pos, pitch: P3.REF.pitch, yaw: (Math.atan2(cam.fwd[0], cam.fwd[1]) * 180) / Math.PI };
    return P3.makeCamera({
      pos: [0, 1, 2].map((i) => P3.lerp(base.pos[i], target.pos[i], u)),
      pitch: P3.lerp(base.pitch, target.pitch, u), yaw: P3.lerp(base.yaw, target.yaw, u), f: P3.REF.f,
    });
  };

  main().catch((err) => {
    loading.classList.add('error');
    loading.textContent = 'No se pudo abrir la escena: ' + err.message;
    console.error(err);
  });
})(window);
