/* Prueba 3D · página de revisión de personajes.
   Muestra cada clip en loop sobre un piso cuadriculado que corre con el desplazamiento que declara
   el clip: si un pie patina, se ve contra las líneas. Tiene selector de personaje, de clip, de
   vista, de velocidad y de cara, y una grilla con todos los clips a la vez, al tamaño del juego. */
(function (g) {
  'use strict';
  const P3 = g.P3;
  const { sin, cos, PI, min, max, abs, floor, atan2 } = Math;
  const $ = (id) => document.getElementById(id);
  const canvas = $('lienzo'), loading = $('carga'), cells = $('celdas');
  const q = new URLSearchParams(g.location.search);
  const ASSETS = g.P3_ASSETS || 'assets/';

  const NAMES = {
    listo: 'Espera activa', correr: 'Correr', correr_atras: 'Hacia atrás', lateral_izq: 'Lateral izq.', lateral_der: 'Lateral der.',
    split_step: 'Split step', arranque: 'Arranque', frenada: 'Frenada', carrera: 'Carrera completa',
    saque: 'Saque', derecha: 'Derecha', reves: 'Revés', volea: 'Volea', volea_reves: 'Volea de revés', bandeja: 'Bandeja', remate: 'Remate',
    globo: 'Globo', estirada: 'Estirada', estirada_reves: 'Estirada de revés',
    espera: 'Entre puntos', festejo: 'Festejo', lamento: 'Lamento', mania_gorra: 'Manía: gorra', mania_zapatilla: 'Manía: zapatilla', mania_saludo: 'Manía: saludo',
  };
  const GROUPS = [
    { id: 'moverse', label: 'Moverse', clips: ['listo', 'correr', 'correr_atras', 'lateral_izq', 'lateral_der', 'split_step', 'arranque', 'frenada', 'carrera'] },
    { id: 'golpes', label: 'Golpes', clips: ['saque', 'derecha', 'reves', 'volea', 'volea_reves', 'bandeja', 'remate', 'globo', 'estirada', 'estirada_reves'] },
    { id: 'gestos', label: 'Gestos', clips: ['espera', 'festejo', 'lamento', 'mania_gorra', 'mania_zapatilla', 'mania_saludo'] },
    { id: 'todos', label: 'Todos', clips: [] },
  ];
  const VIEWS = [
    { id: 'juego', label: 'Juego', pos: [0, -8.7, 5.25], yaw: 0, f: 1150 },          /* como la cámara del juego ve al rival */
    { id: 'espalda', label: 'Espalda', pos: [0, 7.4, 7.1], yaw: 180, f: 1150 },      /* como ve al jugador propio */
    { id: 'lado', label: 'Costado', pos: [-9.6, 0, 1.75], yaw: 90, f: 1150 },
    { id: 'cara', label: 'Cara', face: true, f: 2500 },
  ];
  const SPEEDS = [{ id: 1, label: '1×' }, { id: 0.5, label: '½' }, { id: 0.25, label: '¼' }];
  const FACES = [{ id: 'auto', label: 'Auto' }, { id: 'esfuerzo', label: 'Esfuerzo' }, { id: 'alegria', label: 'Alegría' }, { id: 'fastidio', label: 'Fastidio' }];
  const HEADINGS = [{ id: 0, label: 'Recto' }, { id: 35, label: 'Diagonal' }];
  const FEET = [{ id: 0, label: 'Normales' }, { id: 1, label: 'Grandes' }];
  const SKY_TOP = [0.31, 0.22, 0.50], SKY_LOW = [0.98, 0.66, 0.47], FOG = [0.95, 0.64, 0.47];
  const TARGET_Z = 1.08;

  const BG_VS = `#version 300 es
  in vec2 aPos; out vec2 vP;
  void main() { vP = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`;
  const BG_FS = `#version 300 es
  precision highp float;
  in vec2 vP; out vec4 o; uniform vec3 uTop, uLow; uniform float uHorizon;
  void main() {
    float t = clamp((vP.y - uHorizon) / max(0.25, 1.0 - uHorizon), 0.0, 1.0);
    vec3 c = mix(uLow, uTop, pow(t, 0.7));
    c *= 1.0 - 0.16 * dot(vP * 0.75, vP * 0.75);
    o = vec4(c, 1.0);
  }`;
  const GROUND_VS = `#version 300 es
  in vec2 aPos; uniform mat4 uVP; out vec2 vW;
  void main() { vW = aPos; gl_Position = uVP * vec4(aPos, 0.0, 1.0); }`;
  const GROUND_FS = `#version 300 es
  precision highp float;
  in vec2 vW; out vec4 o; uniform vec2 uScroll; uniform vec3 uFog; uniform float uLines;
  float grid(vec2 p, float cell, float hw) {
    vec2 d = abs(fract(p / cell - 0.5) - 0.5) * cell;
    vec2 w = fwidth(p) * 1.2;
    return 1.0 - min(smoothstep(hw, hw + w.x, d.x), smoothstep(hw, hw + w.y, d.y));
  }
  void main() {
    vec2 p = vW + uScroll;
    float r = length(vW);
    vec3 base = mix(vec3(0.30, 0.45, 0.76), vec3(0.17, 0.27, 0.55), smoothstep(0.0, 8.5, r));
    /* damero suave de un metro, para leer el avance aun de lejos */
    vec2 cell = floor(p);
    base *= 1.0 - 0.055 * mod(cell.x + cell.y, 2.0);
    float line = grid(p, 1.0, 0.010) * 0.30 + grid(p, 5.0, 0.026) * 0.22;
    vec3 col = mix(base, vec3(1.0, 0.96, 0.88), line * uLines);
    /* luz cálida que entra de costado */
    col *= 1.0 + 0.10 * smoothstep(6.0, -6.0, vW.x + vW.y * 0.4);
    col = mix(col, uFog, smoothstep(10.0, 38.0, r));
    o = vec4(col, 1.0);
  }`;
  const FX_VS = `#version 300 es
  precision highp float;
  in vec2 aPos; uniform mat4 uVP; uniform vec3 uC, uAx, uAy; out vec2 vP;
  void main() { vP = aPos; gl_Position = uVP * vec4(uC + uAx * aPos.x + uAy * aPos.y, 1.0); }`;
  const FX_FS = `#version 300 es
  precision highp float; precision highp int;
  in vec2 vP; out vec4 o; uniform int uKind; uniform float uA;
  void main() {
    float r = length(vP);
    if (uKind == 0) {                 /* pelota: tres tonos y borde */
      if (r > 1.0) discard;
      vec3 n = vec3(vP, sqrt(max(0.0, 1.0 - r * r)));
      float l = dot(n, normalize(vec3(-0.45, 0.55, 0.7)));
      vec3 c = mix(vec3(0.651, 0.749, 0.169), vec3(0.918, 0.965, 0.290), step(0.05, l));
      c = mix(c, vec3(0.992, 1.0, 0.851), step(0.78, l));
      c = mix(c, vec3(0.30, 0.36, 0.08), step(0.80, r));
      o = vec4(c, 1.0);
    } else if (uKind == 1) {          /* sombra de la pelota (se multiplica) */
      float a = smoothstep(1.0, 0.45, r) * uA;
      o = vec4(mix(vec3(1.0), vec3(0.42, 0.40, 0.66), a), 1.0);
    } else {                          /* destello del impacto, aditivo */
      vec2 q = abs(vP);
      float star = max(0.0, 1.0 - (q.x * 9.0 + q.y * 0.9)) + max(0.0, 1.0 - (q.y * 9.0 + q.x * 0.9));
      float a = clamp(star, 0.0, 1.0) * smoothstep(1.0, 0.2, r) * uA;
      o = vec4(vec3(1.0, 0.96, 0.84) * a, 0.0);
    }
  }`;

  async function main() {
    const ch = P3.parseCharacter(await P3.loadCharacter(g.P3_CHAR || ASSETS + 'personaje.bin'));
    const C = ch.clips, fps = ch.meta.fps;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, stencil: true, depth: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('Este navegador no tiene WebGL2.');
    const charGL = P3.makeCharacterGL(gl, ch);
    const pBg = P3.program(gl, BG_VS, BG_FS), pGround = P3.program(gl, GROUND_VS, GROUND_FS), pFx = P3.program(gl, FX_VS, FX_FS);
    const quad = (prog, data) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog.p, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      return vao;
    };
    const unit = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
    const bgVao = quad(pBg, unit), groundVao = quad(pGround, unit.map((v) => v * 70)), fxVao = quad(pFx, unit);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    const nb = ch.meta.bones.names.length, n = nb * 4 + 3;
    const cast = Object.keys(ch.meta.personajes || { jugador: 1 });
    const base = Object.fromEntries(cast.map((k) => [k, P3.styleOf(ch, k)]));
    /* prueba de estilización: zapatillas más grandes y canilla más fina, con escala de huesos.
       El corrimiento hacia arriba deja la suela apoyada en el piso. */
    const bigFeet = (st) => {
      const names = ch.meta.bones.names, out = Object.assign({}, st);
      out.scale = st.scale ? st.scale.slice() : new Float32Array(nb * 3).fill(1);
      out.shift = st.shift ? st.shift.slice() : new Float32Array(nb * 3);
      for (const side of ['.L', '.R']) {
        for (const b of ['foot', 'toe']) { const i = names.indexOf(b + side) * 3; out.scale[i] *= 1.16; out.scale[i + 1] *= 1.16; out.scale[i + 2] *= 1.16; out.shift[i + 2] += 0.014; }
        const i = names.indexOf('shin' + side) * 3; out.scale[i] *= 0.9; out.scale[i + 1] *= 0.9;
      }
      return out;
    };
    const big = Object.fromEntries(cast.map((k) => [k, bigFeet(base[k])]));
    const styles = new Proxy({}, { get: (_t, k) => (state.feet ? big : base)[k] });
    const iR = ch.meta.bones.names.indexOf('racket'), iHead = ch.meta.bones.names.indexOf('head');

    /* ---------- estado ---------- */
    const state = {
      who: cast.includes(q.get('personaje')) ? q.get('personaje') : cast[0],
      group: q.get('todos') === '1' ? 'todos' : 'moverse',
      clip: NAMES[q.get('clip')] ? q.get('clip') : 'correr',
      view: VIEWS.some((v) => v.id === q.get('vista')) ? q.get('vista') : 'juego',
      speed: q.has('vel') ? Number(q.get('vel')) : 1,
      face: q.get('cara') || 'auto',
      heading: q.get('rumbo') === '1' ? 35 : 0,
      feet: q.get('pies') === '1' ? 1 : 0,
      /* con «reducir movimiento» arranca en pausa: la animación empieza cuando la persona toca «Seguir» */
      paused: q.has('t') || !!(g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches && !q.has('mover')),
    };
    const gOf = (clip) => GROUPS.find((gr) => gr.clips.includes(clip));
    if (state.group !== 'todos') state.group = gOf(state.clip).id;

    /* ---------- líneas de tiempo ---------- */
    const table = (clip, t) => {
      const tab = clip.raiz.dist, f = P3.clamp((t - (clip.t0 || 0)) * fps, 0, tab.length - 1), i = floor(f);
      return tab[i] + (tab[min(tab.length - 1, i + 1)] - tab[i]) * (f - i);
    };
    const wrap1 = (x) => ((x % 1) + 1) % 1;
    function timeline(name) {
      const loopSeg = (clip, phase0, cycles) => ({ clip, len: cycles * clip.dur, time: (u) => wrap1(phase0 + u / clip.dur) * clip.dur, dist: (u) => (clip.zancada * u) / clip.dur, dir: clip.dir });
      const shot = (clip) => ({ clip, len: clip.dur, time: (u) => u, dist: (u) => (clip.raiz ? table(clip, u) : 0), dir: clip.raiz ? clip.raiz.dir : null });
      const still = (len) => ({ clip: C.listo, len, time: (u) => u % C.listo.dur, dist: () => 0, dir: null });
      const join = (s) => { s.join = true; return s; };            /* empalme exacto: no hace falta fundir */
      let segs = null, loop = null;
      if (name === 'arranque') segs = [still(0.45), shot(C.arranque), join(loopSeg(C.correr, C.arranque.enlace.fase, 2))];
      else if (name === 'frenada') segs = [loopSeg(C.correr, wrap1(C.frenada.enlace.fase - 1.5), 1.5), join(shot(C.frenada)), still(0.55)];
      else if (name === 'carrera') {
        const a = C.arranque.enlace.fase, b = C.frenada.enlace.fase;
        segs = [still(0.4), shot(C.arranque), join(loopSeg(C.correr, a, 2 + wrap1(b - a))), join(shot(C.frenada)), still(0.55)];
      } else if (C[name].loop) loop = C[name];
      else segs = [shot(C[name]), still(0.4)];
      const total = segs ? segs.reduce((a, s) => a + s.len, 0) : 0;
      return {
        name, loop, total, main: loop || (segs.find((s) => s.clip.name === name) || segs[1]).clip,
        at(T, out) {
          if (loop) { out.clip = loop; out.time = T % loop.dur; out.dist = loop.zancada ? (loop.zancada * T) / loop.dur : 0; out.dir = loop.dir || null; out.join = true; out.lap = 0; out.shot = false; return out; }
          const lap = floor(T / total);
          let u = T - lap * total, base = 0;
          for (const s of segs) {
            if (u < s.len || s === segs[segs.length - 1]) {
              out.clip = s.clip; out.time = s.time(min(u, s.len)); out.dist = base + s.dist(min(u, s.len)); out.dir = s.dir; out.join = !!s.join; out.lap = lap;
              out.shot = s.clip.name === name;
              return out;
            }
            u -= s.len; base += s.dist(s.len);
          }
          return out;
        },
      };
    }

    /* pelota de los golpes: llega por una parábola al centro de la pala y sale hacia el otro lado */
    const hw = { pose: new Float32Array(n), mats: new Float32Array(26 * 16), work: { rot: new Float32Array(nb * 9), pos: new Float32Array(nb * 3) } };
    function racketAt(clip, time, st) {
      const rc = ch.meta.racketCenter, rest = ch.meta.bones.rest[iR];
      P3.samplePose(ch, clip, time, hw.pose);
      P3.applyStyle(ch, hw.pose, st, 1);
      P3.poseToMatrices(ch, hw.pose, hw.mats, hw.work, st);
      const c = [rest[0] + rc[0], rest[1] + rc[1], rest[2] + rc[2]], o = iR * 16, m = hw.mats;
      return [0, 1, 2].map((r) => (m[o + r] * c[0] + m[o + 4 + r] * c[1] + m[o + 8 + r] * c[2] + m[o + 12 + r]) * st.k);
    }
    function ballPlan(clip, st) {
      if (clip.grupo !== 'golpe') return null;
      const h = racketAt(clip, clip.contact, st), tc = clip.contact, k = st.k, r0 = 0.033;
      const A = (p0, t0, p1, t1) => ({ t0, t1, p0, v: [(p1[0] - p0[0]) / (t1 - t0), (p1[1] - p0[1]) / (t1 - t0), (p1[2] - p0[2]) / (t1 - t0) + 4.9 * (t1 - t0)] });
      let arcs, held = null;
      const nm = clip.name;
      if (nm === 'saque') {
        const rel = clip.release, a = clip.ballHold[0].map((v) => v * k), b = clip.ballHold[1].map((v) => v * k), drop = rel + (tc - rel) * 0.6;
        const floorP = [h[0] - 0.02, h[1] - 0.03, r0];
        held = { until: rel, a, b };
        arcs = [A(b, rel, floorP, drop), A(floorP, drop, h, tc), A(h, tc, [1.4, -9.5, 0.7], tc + 0.75)];
      } else if (nm === 'remate') arcs = [A([h[0] * 0.5, h[1] - 4.2, 4.4], tc - 0.95, h, tc), A(h, tc, [0.2, -6.4, r0], tc + 0.30)];
      else if (nm === 'bandeja') arcs = [A([h[0] * 0.5, h[1] - 4.6, 4.2], tc - 0.95, h, tc), A(h, tc, [0.3, -9.5, 0.35], tc + 0.60)];
      else if (nm === 'globo') arcs = [A([h[0], h[1] - 6.5, 1.0], tc - 0.60, h, tc), A(h, tc, [0, -7.5, 6.6], tc + 0.85)];
      else if (clip.estirada) arcs = [A([h[0] * 0.9, h[1] - 6.5, 0.95], tc - 0.50, h, tc), A(h, tc, [0, -7, 4.6], tc + 0.80)];
      else if (nm.indexOf('volea') === 0) arcs = [A([h[0] * 0.5, h[1] - 7, 1.3], tc - 0.42, h, tc), A(h, tc, [-h[0] * 0.5, -8.5, 0.35], tc + 0.50)];
      else arcs = [A([h[0] * 0.7, h[1] - 7.5, 0.95], tc - 0.60, h, tc), A(h, tc, [-h[0] * 0.6, -9.5, 0.7], tc + 0.62)];
      return { arcs, held, tc, hit: h };
    }
    function ballAt(plan, t, out) {
      out.visible = false;
      if (!plan) return out;
      if (plan.held && t < plan.held.until) {
        const u = t / plan.held.until;
        out.x = P3.lerp(plan.held.a[0], plan.held.b[0], u); out.y = P3.lerp(plan.held.a[1], plan.held.b[1], u); out.z = P3.lerp(plan.held.a[2], plan.held.b[2], u);
        out.visible = true;
        return out;
      }
      for (const a of plan.arcs) {
        if (t >= a.t0 && t < a.t1) {
          const u = t - a.t0;
          out.x = a.p0[0] + a.v[0] * u; out.y = a.p0[1] + a.v[1] * u; out.z = max(0.033, a.p0[2] + a.v[2] * u - 4.9 * u * u);
          out.visible = true;
          return out;
        }
      }
      return out;
    }

    /* ---------- actores ---------- */
    function makeActor(name) {
      return {
        name, tl: timeline(name), T: 0, lap: 0, clip: null, pose: new Float32Array(n), target: new Float32Array(n), from: new Float32Array(n), mix: 1,
        mats: new Float32Array(26 * 16), work: { rot: new Float32Array(nb * 9), pos: new Float32Array(nb * 3) }, life: P3.makeLife(ch), face: P3.makeFace(ch),
        plan: undefined, ball: { x: 0, y: 0, z: 0, visible: false }, scroll: [0, 0], root: { x: 0, y: 0, yaw: 0, k: 1 }, twist: 0, time: 0, cur: null,
        draw: { x: 0, y: 0, yaw: 0, k: 1, mats: null, style: null, face: null }, head: [0, 0, 1.5], glint: 0, seg: {},
      };
    }
    const single = makeActor(state.clip);
    const all = [];
    for (const gr of GROUPS) for (const c of gr.clips) if (C[c]) all.push(makeActor(c));      /* la grilla muestra los clips; las secuencias, no */
    const tmpS = {};

    function update(a, dt, heading, forcedFace) {
      const st = styles[state.who];
      const s = a.tl.at(a.T, a.seg), clip = s.clip;
      const gesture = clip.grupo === 'reaccion' || clip.grupo === 'mania';
      if (a.plan === undefined || a.planWho !== st) { a.plan = ballPlan(a.tl.main, st); a.planWho = st; }
      P3.samplePose(ch, clip, s.time, a.target);
      const fresh = a.clip === null || s.lap !== a.lap;
      if (clip !== a.cur) {
        a.from.set(a.pose);
        a.mix = a.clip === null || s.join ? 1 : 0;
        a.cur = clip;
      } else if (fresh && a.clip !== null) { a.from.set(a.pose); a.mix = 0; }
      if (fresh) a.life.px = null;
      a.clip = clip; a.lap = s.lap; a.time = s.time;
      if (a.mix < 1) {
        a.mix = min(1, a.mix + dt / 0.14);
        P3.blendPose(nb, a.from, a.target, P3.smooth(a.mix), a.pose);
      } else a.pose.set(a.target);
      P3.applyStyle(ch, a.pose, st, clip.grupo === 'golpe' ? 1 : st.amp);
      /* rumbo: con la corrida en diagonal gira la pelvis y el piso corre hacia donde va */
      const tw = s.dir && heading ? (heading * PI) / 180 : 0;
      a.twist += (tw - a.twist) * (dt > 0 ? min(1, dt * 10) : 1);
      P3.twistHips(ch, a.pose, a.twist);
      P3.poseToMatrices(ch, a.pose, a.mats, a.work, st);
      let dx = 0, dy = 0;
      if (s.dir) { const c = cos(a.twist), sn = sin(a.twist); dx = (s.dir[0] * c - s.dir[1] * sn) * s.dist * st.k; dy = (s.dir[0] * sn + s.dir[1] * c) * s.dist * st.k; }
      a.scroll[0] = dx; a.scroll[1] = dy;
      a.root.x = dx; a.root.y = dy; a.root.k = st.k;
      ballAt(s.shot ? a.plan : null, s.time, a.ball);
      a.glint = s.shot && a.plan ? max(0, 1 - abs(s.time - a.plan.tc - 0.03) / 0.09) : 0;
      /* la cabeza sigue la pelota en los golpes; la trenza se mueve con resorte */
      const lifeBall = a.ball.visible ? { x: a.ball.x + dx, y: a.ball.y + dy, z: a.ball.z, visible: true } : a.ball;
      a.life.apply(a.pose, a.work, a.root, lifeBall, dt, a.ball.visible ? 0.45 : 0.8);
      P3.poseToMatrices(ch, a.pose, a.mats, a.work, st);
      if (state.face !== 'no') a.face.update(dt, s.shot || clip.loop ? clip : null, s.time, forcedFace);
      a.head[0] = a.work.pos[iHead * 3] * st.k; a.head[1] = a.work.pos[iHead * 3 + 1] * st.k; a.head[2] = a.work.pos[iHead * 3 + 2] * st.k;
      const d = a.draw;
      d.k = st.k; d.mats = a.mats; d.style = st; d.face = state.face === 'no' ? null : a.face.w;
      return gesture;
    }

    /* ---------- cámara y dibujo ---------- */
    const vp = new Float32Array(16);
    const env = { vp, eye: null, viewport: [1, 1], outlinePx: 1, shadow: P3.SHADOW_RGB };
    const camFace = { x: 0, y: 0, z: 1.6 };
    function cameraFor(view, a, dt) {
      if (!view.face) {
        const dz = view.pos[2] - TARGET_Z, dh = Math.hypot(view.pos[0], view.pos[1]);
        return P3.makeCamera({ pos: view.pos, pitch: (atan2(dz, dh) * 180) / PI, yaw: view.yaw, f: view.f });
      }
      /* de cerca: la cámara acompaña la cabeza con un poco de retraso */
      const k = dt > 0 ? 1 - Math.exp(-dt * 9) : 1;
      camFace.x += (a.head[0] - camFace.x) * k; camFace.y += (a.head[1] - camFace.y) * k; camFace.z += (a.head[2] + 0.13 * a.draw.k - camFace.z) * k;
      return P3.makeCamera({ pos: [camFace.x + 0.22, camFace.y - 2.5, camFace.z + 0.10], pitch: 2.3, yaw: -5, f: view.f });
    }
    const fxDraw = (kind, c, ax, ay, alpha, multiply) => {
      const u = pFx.u;
      gl.useProgram(pFx.p);
      gl.bindVertexArray(fxVao);
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform3fv(u.uC, c); gl.uniform3fv(u.uAx, ax); gl.uniform3fv(u.uAy, ay);
      gl.uniform1i(u.uKind, kind); gl.uniform1f(u.uA, alpha);
      if (multiply) gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (multiply) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    };
    function drawBall(a, cam, pxPerM) {
      const b = a.ball;
      if (!b.visible) return;
      const r = max(0.036, 2.6 / pxPerM);
      fxDraw(0, [b.x, b.y, b.z], [cam.right[0] * r, cam.right[1] * r, 0], [cam.up[0] * r, cam.up[1] * r, cam.up[2] * r], 1, false);
    }
    /* x, y, w, h en píxeles del lienzo, con el origen abajo a la izquierda */
    function drawActor(a, cam, x, y, w, h, dpr, lines) {
      const lay = { visH: (390 * h) / w, oy: h * 0.5, vh: h, s: w / 390 };
      P3.viewProj(cam, lay, vp);
      gl.viewport(x, y, w, h);
      gl.scissor(x, y, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.STENCIL_TEST);
      /* cielo: el horizonte queda donde lo pone la cámara */
      const hz = P3.clamp((-cam.f * Math.tan(Math.asin(P3.clamp(cam.fwd[2], -1, 1)))) / (lay.visH / 2), -3, 3);
      gl.useProgram(pBg.p);
      gl.bindVertexArray(bgVao);
      gl.uniform3fv(pBg.u.uTop, SKY_TOP); gl.uniform3fv(pBg.u.uLow, SKY_LOW); gl.uniform1f(pBg.u.uHorizon, hz);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.useProgram(pGround.p);
      gl.bindVertexArray(groundVao);
      gl.uniformMatrix4fv(pGround.u.uVP, false, vp);
      gl.uniform2f(pGround.u.uScroll, a.scroll[0], a.scroll[1]);
      gl.uniform3fv(pGround.u.uFog, FOG);
      gl.uniform1f(pGround.u.uLines, lines);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const dist = Math.hypot(cam.pos[0], cam.pos[1], cam.pos[2] - TARGET_Z);
      const pxPerM = (cam.f * lay.s) / dist;                  /* píxeles del lienzo por metro, a la altura del personaje */
      const b = a.ball;
      if (b.visible) { const sh = 0.07 + b.z * 0.012; fxDraw(1, [b.x, b.y, 0.014], [sh, 0, 0], [0, sh, 0], P3.clamp(0.8 - b.z * 0.12, 0.2, 0.8), true); }
      /* la pelota va atrás o adelante del personaje según la distancia a la cámara */
      const behind = b.visible && (b.x - cam.pos[0]) * cam.fwd[0] + (b.y - cam.pos[1]) * cam.fwd[1] > -cam.pos[0] * cam.fwd[0] - cam.pos[1] * cam.fwd[1];
      if (behind) drawBall(a, cam, pxPerM);
      env.eye = cam.pos;
      env.viewport[0] = w; env.viewport[1] = h;
      env.outlinePx = P3.clamp(0.019 * a.draw.k * pxPerM, 0.62 * dpr, 2.3 * dpr);
      charGL.draw(a.draw, env);
      if (!behind) drawBall(a, cam, pxPerM);
      if (a.glint > 0 && a.plan) {
        const r = 0.34 + 0.2 * (1 - a.glint), p = a.plan.hit;
        gl.blendFunc(gl.ONE, gl.ONE);
        fxDraw(2, p, [cam.right[0] * r, cam.right[1] * r, 0], [cam.up[0] * r, cam.up[1] * r, cam.up[2] * r], a.glint, false);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
    }

    /* ---------- interfaz ---------- */
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const painters = [];
    function chips(box, options, get, set, render) {
      const buttons = options.map((o) => {
        const b = el('button', '', render ? undefined : o.label);
        b.type = 'button';
        b.id = box.id + '-' + String(o.id).replace('.', '_');
        if (render) render(b, o);
        b.addEventListener('click', () => { set(o.id); refresh(); });
        box.appendChild(b);
        return b;
      });
      painters.push(() => buttons.forEach((b, i) => { const on = get() === options[i].id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }));
    }
    const swatch = (who) => { const p = ch.meta.palettes[styles[who].palette], c = p[ch.meta.materials.indexOf('shirt')]; return 'rgb(' + c.map((v) => Math.round(v * 255)).join(',') + ')'; };
    chips($('elenco'), cast.map((k) => ({ id: k, label: styles[k].label })), () => state.who, (v) => { state.who = v; },
      (b, o) => { const i = el('i'); i.style.background = swatch(o.id); b.appendChild(i); b.appendChild(document.createTextNode(o.label)); });
    chips($('grupos'), GROUPS, () => state.group, (v) => {
      state.group = v;
      const gr = GROUPS.find((x) => x.id === v);
      if (gr.clips.length && !gr.clips.includes(state.clip)) pick(gr.clips[1]);
    });
    chips($('vista'), VIEWS, () => state.view, (v) => { state.view = v; camFace.z = single.head[2]; camFace.x = single.head[0]; camFace.y = single.head[1]; });
    chips($('velocidad'), SPEEDS, () => state.speed, (v) => { state.speed = v; });
    chips($('cara'), FACES, () => state.face, (v) => { state.face = v; });
    chips($('rumbo'), HEADINGS, () => state.heading, (v) => { state.heading = v; });
    chips($('pies'), FEET, () => state.feet, (v) => { state.feet = v; });
    const clipBox = $('clips'), fichaN = $('ficha-nombre'), fichaD = $('ficha-datos'), meter = $('medidor'), pauseB = $('pausa');
    const num = (v, d) => v.toFixed(d).replace('.', ',');

    function pick(name) {
      state.clip = name;
      single.name = name; single.tl = timeline(name); single.T = 0; single.clip = null; single.cur = null; single.plan = undefined; single.life.px = null;
    }
    function describe(name) {
      const tl = single.tl, c = tl.main, parts = [num(c.dur, 2) + ' s'];
      if (name === 'carrera') return 'Espera, arranque, correr y frenada, encadenados por la distancia recorrida.';
      if (c.zancada) parts.push('zancada ' + num(c.zancada, 2) + ' m', num(c.velocidad, 1) + ' m/s');
      if (c.raiz) parts.push('avanza ' + num(c.raiz.total, 2) + ' m');
      if (c.contact !== undefined) parts.push('impacto en el cuadro ' + c.cuadro + ' (' + num(c.contact, 2) + ' s)');
      if (c.aterrizaje) parts.push('cae a los ' + num(c.aterrizaje, 2) + ' s');
      if (styles[state.who].mania === name) parts.push('la manía de ' + styles[state.who].label);
      return parts.join(' · ');
    }
    function refresh() {
      for (const p of painters) p();
      const gr = GROUPS.find((x) => x.id === state.group), todos = state.group === 'todos';
      clipBox.textContent = '';
      if (todos) clipBox.appendChild(el('p', '', 'Todas las animaciones a la vez, al tamaño en que se ven jugando. Tocá una para verla grande.'));
      else for (const c of gr.clips) {
        const b = el('button', c === state.clip ? 'on' : '', NAMES[c]);
        b.type = 'button';
        b.id = 'clip-' + c;
        b.setAttribute('aria-pressed', c === state.clip ? 'true' : 'false');
        if (styles[state.who].mania === c) b.appendChild(el('b', '', '★'));
        b.addEventListener('click', () => { pick(c); refresh(); });
        clipBox.appendChild(b);
      }
      cells.classList.toggle('on', todos);
      fichaN.textContent = todos ? styles[state.who].label : NAMES[state.clip];
      fichaD.textContent = todos ? Object.keys(C).length + ' animaciones · ' + (charGL.triangles(styles[state.who]) | 0).toLocaleString('es-AR') + ' triángulos' : describe(state.clip);
      const moving = !todos && !!(single.tl.main.zancada || single.tl.main.raiz || state.clip === 'carrera');
      $('rumbo').parentNode.classList.toggle('off', !moving);
      pauseB.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
      pauseB.textContent = state.paused ? 'Seguir' : 'Pausa';
      layoutCells();
    }
    pauseB.addEventListener('click', () => { state.paused = !state.paused; refresh(); });
    /* enlace a la escena del peloteo, donde los mismos clips se ven jugando */
    const other = g.P3_OTHER === undefined ? { label: 'Ver el peloteo', href: 'tiempo-real.html' } : g.P3_OTHER;
    if (other) { const a = el('a', '', other.label); a.id = 'enlace'; a.href = other.href; $('escenario').appendChild(a); }

    /* grilla de «Todos»: cuatro columnas */
    const COLS = 4;
    let cellRects = [];
    function layoutCells() {
      const w = canvas.clientWidth, h = canvas.clientHeight, top = 46, rows = Math.ceil(all.length / COLS);
      const cw = w / COLS, chh = (h - top) / rows;
      cellRects = all.map((a, i) => ({ x: (i % COLS) * cw, y: top + floor(i / COLS) * chh, w: cw, h: chh }));
      if (cells.children.length !== all.length) {
        cells.textContent = '';
        all.forEach((a) => {
          const b = el('button', '', NAMES[a.name]);
          b.type = 'button';
          b.id = 'celda-' + a.name;
          b.addEventListener('click', () => { state.group = gOf(a.name).id; pick(a.name); refresh(); });
          cells.appendChild(b);
        });
      }
      all.forEach((a, i) => { const r = cellRects[i], s = cells.children[i].style; s.left = r.x + 'px'; s.top = r.y + 'px'; s.width = r.w + 'px'; s.height = r.h + 'px'; });
    }

    let dpr = 1;
    function fit() {
      dpr = min(q.has('dpr') ? Number(q.get('dpr')) : 2, g.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      layoutCells();
    }
    g.addEventListener('resize', fit);
    if (g.ResizeObserver) new ResizeObserver(fit).observe(canvas);
    refresh();
    fit();
    if (q.has('t')) single.T = Number(q.get('t'));

    /* ---------- bucle ---------- */
    let last = -1, first = true, acc = 0, frames = 0, work = 0, shown = 0;
    const stats = { ms: 0, fps: 0, faceUpdates: 0, samples: [] };
    function frame(now) {
      const w0 = performance.now();
      const real = last < 0 ? 0 : min(0.1, (now - last) / 1000);
      last = now;
      const dt = state.paused ? 0 : real * state.speed;
      const forced = state.face === 'auto' ? null : state.face;
      const todos = state.group === 'todos';
      gl.enable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.scissor(0, 0, canvas.width, canvas.height);
      gl.clearColor(SKY_TOP[0], SKY_TOP[1], SKY_TOP[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      const st = styles[state.who];
      if (todos) {
        const view = VIEWS[0];
        for (let i = 0; i < all.length; i++) {
          const a = all[i], r = cellRects[i];
          const gesture = a.tl.main.grupo === 'reaccion' || a.tl.main.grupo === 'mania';
          a.T += dt * (gesture ? st.tempo : 1);
          update(a, dt, 0, forced);
          const cam = cameraFor(view, a, dt);
          drawActor(a, cam, Math.round(r.x * dpr), canvas.height - Math.round((r.y + r.h) * dpr), Math.round(r.w * dpr), Math.round(r.h * dpr), dpr, 0.55);
        }
      } else {
        const a = single, view = VIEWS.find((v) => v.id === state.view);
        const gesture = a.tl.main.grupo === 'reaccion' || a.tl.main.grupo === 'mania';
        a.T += dt * (gesture ? st.tempo : 1);
        update(a, dt, state.heading, forced);
        drawActor(a, cameraFor(view, a, real), 0, 0, canvas.width, canvas.height, dpr, 1);
      }
      gl.disable(gl.SCISSOR_TEST);
      if (first) {
        first = false;
        loading.remove();
        g.__p3 = { version: 'R', firstFrame: performance.now(), state, single, all, character: ch, styles, stats, gl, charGL, pick, refresh };
      }
      const spent = performance.now() - w0;
      if (stats.samples.length < 4000) stats.samples.push(spent);
      work += spent; acc += real; frames++;
      if (acc >= 0.5) {
        stats.ms = work / frames; stats.fps = frames / acc; stats.faceUpdates = charGL.faceUpdates;
        if (now - shown > 450) { meter.textContent = Math.round(stats.fps) + ' fps · ' + num(stats.ms, 1) + ' ms'; shown = now; }
        acc = 0; frames = 0; work = 0;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  main().catch((err) => {
    loading.classList.add('error');
    loading.textContent = 'No se pudo abrir la página: ' + err.message;
    console.error(err);
  });
})(window);
