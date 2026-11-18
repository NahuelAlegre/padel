/* Prueba 3D · el personaje en tiempo real, sin librerías.
   - Lectura de assets/personaje.bin (formato PAD1, versiones 1 y 2).
   - Poses: muestreo de clips, mezcla y matrices de hueso.
   - Lo que cambia por personaje sobre el mismo modelo: piezas, escala de huesos, postura, amplitud.
   - Cara: parpadeo y expresiones, moviendo los vértices de la cara en la CPU.
   - Dibujo: sombreado toon de tres tonos, contorno de tinta por casco invertido y sombra en el piso. */
(function (g) {
  'use strict';
  const P3 = (g.P3 = g.P3 || {});
  const { sin, cos, PI, min, max, sqrt, floor } = Math;
  const clamp = (v, a, b) => max(a, min(b, v));
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  /* ---------- utilidades GL ---------- */
  P3.program = function (gl, vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  };

  /* El mismo vértice sirve para el color, el contorno y la sombra (uMode). */
  const CHAR_VS = `#version 300 es
  precision highp float; precision highp int;
  in vec3 aPos; in vec3 aNrm; in float aMat; in float aOut; in vec3 aJoints; in vec2 aWeights;
  uniform mat4 uVP; uniform mat4 uBones[26]; uniform vec3 uCenter, uHalf;
  uniform vec4 uRoot;            /* x, y, giro, escala */
  uniform vec4 uPal[26];
  uniform int uMode;             /* 0 color, 1 contorno, 2 sombra */
  uniform vec3 uSun; uniform vec2 uViewport; uniform float uOutlinePx;
  out vec3 vN; out vec3 vW; flat out vec4 vBase;
  void main() {
    vec4 p = vec4(uCenter + uHalf * aPos, 1.0);
    float w2 = 1.0 - aWeights.x - aWeights.y;
    mat4 B = uBones[int(aJoints.x)] * aWeights.x + uBones[int(aJoints.y)] * aWeights.y + uBones[int(aJoints.z)] * w2;
    vec3 lp = (B * p).xyz;
    vec3 ln = mat3(B) * aNrm;
    float c = cos(uRoot.z), s = sin(uRoot.z);
    vec3 wp = vec3(c * lp.x - s * lp.y, s * lp.x + c * lp.y, lp.z) * uRoot.w + vec3(uRoot.xy, 0.0);
    vec3 wn = normalize(vec3(c * ln.x - s * ln.y, s * ln.x + c * ln.y, ln.z));
    vBase = uPal[int(aMat + 0.5)];
    vN = wn; vW = wp;
    if (uMode == 2) {
      wp = vec3(wp.xy - uSun.xy * (wp.z / uSun.z), 0.012);     /* aplastada contra el piso, lejos del sol */
      gl_Position = uVP * vec4(wp, 1.0);
      return;
    }
    vec4 clip = uVP * vec4(wp, 1.0);
    if (uMode == 1) {
      vec4 cn = uVP * vec4(wp + wn * 0.02, 1.0);
      vec2 d = cn.xy / cn.w - clip.xy / clip.w;
      float l = length(d * uViewport);
      if (l > 1e-5) clip.xy += (d * uViewport / l) * (uOutlinePx * aOut * 2.0) / uViewport * clip.w;
      clip.z += 0.0006 * clip.w;
    }
    gl_Position = clip;
  }`;
  const CHAR_FS = `#version 300 es
  precision highp float; precision highp int;
  in vec3 vN; in vec3 vW; flat in vec4 vBase; out vec4 o;
  uniform int uMode; uniform vec3 uKey, uSun, uEye, uInk, uShadowTint, uLightGain, uRim, uShadowCol;
  void main() {
    if (uMode == 1) { o = vec4(uInk, 1.0); return; }
    if (uMode == 2) { o = vec4(uShadowCol, 1.0); return; }
    vec3 n = normalize(vN);
    vec3 base = vBase.rgb;
    float ndl = dot(n, uKey);
    float mid = step(0.22, ndl), hi = step(0.80, ndl);
    vec3 col;
    if (vBase.a > 0.5) {                       /* materiales planos: ojos, cejas, boca */
      col = mix(base * (0.5 + 0.5 * uShadowTint), base, mid);
    } else {
      col = mix(base * uShadowTint, base, mid);
      col = mix(col, min(base * uLightGain + 0.03, vec3(1.0)), hi);
      float facing = 1.0 - abs(dot(n, normalize(uEye - vW)));
      float rim = step(0.56, facing) * step(0.18, dot(n, uSun)) * 0.9;
      col = mix(col, min(base * 0.45 + uRim * 0.62, vec3(1.0)), rim);
    }
    o = vec4(col, 1.0);
  }`;

  /* ---------- lectura del binario ---------- */
  P3.parseCharacter = function (buf) {
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'PAD1') throw new Error('Formato de personaje desconocido');
    const jl = dv.getUint32(4, true);
    const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl)));
    const base = 8 + jl;
    const m = meta.mesh;
    const view = (T, off, n) => new T(buf, base + off, n);
    const data = {
      meta,
      pos: view(Int16Array, m.pos, m.nv * 3), nrm: view(Int8Array, m.nrm, m.nv * 3), mat: view(Uint8Array, m.mat, m.nv),
      out: view(Uint8Array, m.out, m.nv), joints: view(Uint8Array, m.joints, m.nv * 3), weights: view(Uint8Array, m.weights, m.nv * 2),
      idx: view(Uint16Array, m.idx, m.nt || m.ni), clips: {}, morph: null,
    };
    if (m.morfos) {
      const f = m.morfos;
      data.morph = { start: f.inicio, count: f.cantidad, names: f.nombres, deltas: view(Int16Array, f.datos, f.nombres.length * f.cantidad * 3) };
    }
    const nb = meta.bones.names.length, ch = nb * 4 + 3;
    for (const c of meta.clips) {
      const d = view(Int16Array, c.data, ch * c.frames);
      const out = new Float32Array(ch * c.frames);          /* por cuadro: nb cuaterniones + pelvis */
      for (let k = 0; k < ch; k++) {
        let acc = 0;
        const sc = k < nb * 4 ? 1 / 32767 : 1 / 10000;
        /* las diferencias se guardaron en 16 bits con desborde: se acumulan igual, módulo 65536 */
        for (let f = 0; f < c.frames; f++) { acc = ((acc + d[k * c.frames + f] + 32768) & 0xffff) - 32768; out[f * ch + k] = acc * sc; }
      }
      data.clips[c.name] = Object.assign({}, c, { samples: out });
    }
    /* pose de referencia para la amplitud: el primer cuadro de la espera */
    const names = meta.bones.names;
    data.ref = data.clips.listo ? data.clips.listo.samples.slice(0, ch) : null;
    data.upper = ['spine', 'chest', 'neck', 'head', 'clav.L', 'clav.R', 'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R']
      .map((n) => names.indexOf(n)).filter((i) => i >= 0);
    return data;
  };

  /* El personaje es un binario. Donde el hosting no sirve binarios genéricos (los Artifacts),
     viaja como texto en base64 y se decodifica acá. */
  P3.loadCharacter = async function (url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' ' + r.status);
    if (!/\.txt$/.test(url)) return r.arrayBuffer();
    const bin = atob((await r.text()).trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };

  /* ---------- poses ---------- */
  /* Pose de un clip en un instante: cuaterniones locales + pelvis, interpolados entre cuadros. */
  P3.samplePose = function (ch, clip, time, out) {
    const nb = ch.meta.bones.names.length, n = nb * 4 + 3, fps = ch.meta.fps;
    let f = (time - (clip.t0 || 0)) * fps, f0, f1;      /* t0: desfase para que un cuadro caiga justo en el impacto */
    if (clip.loop) { f = ((f % clip.frames) + clip.frames) % clip.frames; f0 = floor(f); f1 = (f0 + 1) % clip.frames; } else {
      f = clamp(f, 0, clip.frames - 1); f0 = floor(f); f1 = min(clip.frames - 1, f0 + 1);
    }
    const u = f - f0, s = clip.samples, a = f0 * n, b = f1 * n;
    for (let i = 0; i < nb; i++) {
      const k = i * 4;
      const d = s[a + k] * s[b + k] + s[a + k + 1] * s[b + k + 1] + s[a + k + 2] * s[b + k + 2] + s[a + k + 3] * s[b + k + 3];
      const sg = d < 0 ? -1 : 1;
      for (let c = 0; c < 4; c++) out[k + c] = s[a + k + c] * (1 - u) + s[b + k + c] * u * sg;
    }
    for (let c = 0; c < 3; c++) out[nb * 4 + c] = s[a + nb * 4 + c] * (1 - u) + s[b + nb * 4 + c] * u;
    return out;
  };
  P3.blendPose = function (nb, a, b, w, out) {
    for (let i = 0; i < nb; i++) {
      const k = i * 4;
      const d = a[k] * b[k] + a[k + 1] * b[k + 1] + a[k + 2] * b[k + 2] + a[k + 3] * b[k + 3];
      const sg = d < 0 ? -1 : 1;
      for (let c = 0; c < 4; c++) out[k + c] = a[k + c] * (1 - w) + b[k + c] * w * sg;
    }
    for (let c = 0; c < 3; c++) out[nb * 4 + c] = a[nb * 4 + c] * (1 - w) + b[nb * 4 + c] * w;
    return out;
  };

  /* producto de cuaterniones (x, y, z, w): a · b gira primero con b y después con a */
  const qmul = (a, ao, b, bo, out, oo) => {
    const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3], bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
    out[oo] = aw * bx + ax * bw + ay * bz - az * by;
    out[oo + 1] = aw * by - ax * bz + ay * bw + az * bx;
    out[oo + 2] = aw * bz + ax * by - ay * bx + az * bw;
    out[oo + 3] = aw * bw - ax * bx - ay * by - az * bz;
  };
  P3.qmul = qmul;
  /* (inclinación adelante, giro a la izquierda, rolido), en grados: Rz(giro) · Rx(inclinación) · Ry(rolido) */
  const eulerQuat = (lean, twist, side, out, oo) => {
    const k = PI / 360, qx = [sin(lean * k), 0, 0, cos(lean * k)], qy = [0, sin(side * k), 0, cos(side * k)], qz = [0, 0, sin(twist * k), cos(twist * k)];
    const t = [0, 0, 0, 1];
    qmul(qz, 0, qx, 0, t, 0);
    qmul(t, 0, qy, 0, out, oo);
  };

  /* De la pose a las matrices de cada hueso (por columnas): M = T(P) · R · S · T(-reposo) + R · corrimiento.
     st es el estilo del personaje (P3.styleOf): con escalas de hueso, la distancia a los hijos también se estira. */
  P3.poseToMatrices = function (ch, pose, mats, work, st) {
    const B = ch.meta.bones, nb = B.names.length;
    const rot = work.rot, pos = work.pos;      /* rotación (9) y posición (3) del mundo por hueso */
    const sc = st && st.scale ? st.scale : null, sh = st && st.shift ? st.shift : null;
    for (let i = 0; i < nb; i++) {
      const k = i * 4;
      let x = pose[k], y = pose[k + 1], z = pose[k + 2], w = pose[k + 3];
      const l = 1 / (sqrt(x * x + y * y + z * z + w * w) || 1);
      x *= l; y *= l; z *= l; w *= l;
      /* matriz local por filas */
      const r0 = 1 - 2 * (y * y + z * z), r1 = 2 * (x * y - z * w), r2 = 2 * (x * z + y * w);
      const r3 = 2 * (x * y + z * w), r4 = 1 - 2 * (x * x + z * z), r5 = 2 * (y * z - x * w);
      const r6 = 2 * (x * z - y * w), r7 = 2 * (y * z + x * w), r8 = 1 - 2 * (x * x + y * y);
      const par = B.parents[i], o = i * 9, rest = B.rest[i];
      if (par < 0) {
        rot[o] = r0; rot[o + 1] = r1; rot[o + 2] = r2; rot[o + 3] = r3; rot[o + 4] = r4; rot[o + 5] = r5; rot[o + 6] = r6; rot[o + 7] = r7; rot[o + 8] = r8;
        pos[i * 3] = pose[nb * 4]; pos[i * 3 + 1] = pose[nb * 4 + 1]; pos[i * 3 + 2] = pose[nb * 4 + 2];
      } else {
        const p = par * 9, pr = B.rest[par];
        for (let r = 0; r < 3; r++) {
          const a = rot[p + r * 3], b = rot[p + r * 3 + 1], c = rot[p + r * 3 + 2];
          rot[o + r * 3] = a * r0 + b * r3 + c * r6;
          rot[o + r * 3 + 1] = a * r1 + b * r4 + c * r7;
          rot[o + r * 3 + 2] = a * r2 + b * r5 + c * r8;
        }
        let dx = rest[0] - pr[0], dy = rest[1] - pr[1], dz = rest[2] - pr[2];
        if (sc) { dx *= sc[par * 3]; dy *= sc[par * 3 + 1]; dz *= sc[par * 3 + 2]; }
        pos[i * 3] = pos[par * 3] + rot[p] * dx + rot[p + 1] * dy + rot[p + 2] * dz;
        pos[i * 3 + 1] = pos[par * 3 + 1] + rot[p + 3] * dx + rot[p + 4] * dy + rot[p + 5] * dz;
        pos[i * 3 + 2] = pos[par * 3 + 2] + rot[p + 6] * dx + rot[p + 7] * dy + rot[p + 8] * dz;
      }
      let sx = 1, sy = 1, sz = 1, ox = rest[0], oy = rest[1], oz = rest[2];
      if (sc) {
        sx = sc[i * 3]; sy = sc[i * 3 + 1]; sz = sc[i * 3 + 2];
        ox = ox * sx - sh[i * 3]; oy = oy * sy - sh[i * 3 + 1]; oz = oz * sz - sh[i * 3 + 2];
      }
      const m = i * 16;
      mats[m] = rot[o] * sx; mats[m + 1] = rot[o + 3] * sx; mats[m + 2] = rot[o + 6] * sx; mats[m + 3] = 0;
      mats[m + 4] = rot[o + 1] * sy; mats[m + 5] = rot[o + 4] * sy; mats[m + 6] = rot[o + 7] * sy; mats[m + 7] = 0;
      mats[m + 8] = rot[o + 2] * sz; mats[m + 9] = rot[o + 5] * sz; mats[m + 10] = rot[o + 8] * sz; mats[m + 11] = 0;
      mats[m + 12] = pos[i * 3] - (rot[o] * ox + rot[o + 1] * oy + rot[o + 2] * oz);
      mats[m + 13] = pos[i * 3 + 1] - (rot[o + 3] * ox + rot[o + 4] * oy + rot[o + 5] * oz);
      mats[m + 14] = pos[i * 3 + 2] - (rot[o + 6] * ox + rot[o + 7] * oy + rot[o + 8] * oz);
      mats[m + 15] = 1;
    }
    return mats;
  };

  /* ---------- lo propio de cada personaje ---------- */
  /* Estilo de un personaje del binario (o de una paleta suelta, como 'rival'): qué piezas dibuja,
     cuánto escala cada hueso, su postura, su tempo y su amplitud. */
  P3.styleOf = function (ch, name) {
    const P = (ch.meta.personajes || {})[name];
    const B = ch.meta.bones, nb = B.names.length, M = ch.meta.mesh;
    const st = {
      name, label: P ? P.nombre : name, palette: P ? P.paleta : name, k: P ? P.escala : 1, tempo: P ? P.tempo : 1,
      amp: P ? P.amplitud : 1, mania: P ? P.mania : null, scale: null, shift: null, post: null, ranges: [[0, M.ni]], triangles: 0,
    };
    if (M.piezas) {
      const want = P ? P.piezas : ['trenza'];
      st.ranges = [[0, M.base]];
      for (const piece of M.piezas) {
        if (!want.includes(piece.nombre) || !piece.cantidad) continue;
        const last = st.ranges[st.ranges.length - 1];
        if (last[0] + last[1] === piece.inicio) last[1] += piece.cantidad; else st.ranges.push([piece.inicio, piece.cantidad]);
      }
    }
    st.triangles = st.ranges.reduce((a, r) => a + r[1], 0) / 3;
    if (P && Object.keys(P.huesos).length) {
      st.scale = new Float32Array(nb * 3).fill(1);
      st.shift = new Float32Array(nb * 3);
      for (const b in P.huesos) {
        const i = B.names.indexOf(b);
        if (i < 0) continue;
        st.scale.set(P.huesos[b].s, i * 3);
        st.shift.set(P.huesos[b].d, i * 3);
      }
    }
    if (P && Object.keys(P.postura).length) {
      st.post = [];
      for (const b in P.postura) {
        const i = B.names.indexOf(b), q = [0, 0, 0, 1];
        if (i < 0) continue;
        eulerQuat(P.postura[b][0], P.postura[b][1], P.postura[b][2], q, 0);
        st.post.push([i, q]);
      }
    }
    return st;
  };

  /* Amplitud y postura, sobre la pose ya muestreada.
     amp exagera (o achica) cuánto se aparta el tren superior de la posición de espera. */
  const tq = [0, 0, 0, 1];
  P3.applyStyle = function (ch, pose, st, amp) {
    if (!st) return pose;
    if (amp !== undefined && amp !== 1 && ch.ref) {
      const ref = ch.ref;
      for (const i of ch.upper) {
        const k = i * 4;
        const d = pose[k] * ref[k] + pose[k + 1] * ref[k + 1] + pose[k + 2] * ref[k + 2] + pose[k + 3] * ref[k + 3];
        const sg = d < 0 ? -1 : 1;
        for (let c = 0; c < 4; c++) pose[k + c] = ref[k + c] + (pose[k + c] * sg - ref[k + c]) * amp;
      }
    }
    if (st.post) for (const [i, q] of st.post) { qmul(pose, i * 4, q, 0, tq, 0); pose[i * 4] = tq[0]; pose[i * 4 + 1] = tq[1]; pose[i * 4 + 2] = tq[2]; pose[i * 4 + 3] = tq[3]; }
    return pose;
  };

  /* Correr en diagonal con el mismo clip: gira la pelvis (y con ella las piernas) hacia donde se va
     y reparte el contragiro entre la columna y el pecho, que sigue mirando a la red. Ángulo en radianes. */
  const qa = [0, 0, 0, 1], qb = [0, 0, 0, 1], qc = [0, 0, 0, 1], qz = [0, 0, 0, 1];
  P3.twistHips = function (ch, pose, angle) {
    if (!angle) return pose;
    const names = ch.meta.bones.names, iH = names.indexOf('hips') * 4, iS = names.indexOf('spine') * 4, iC = names.indexOf('chest') * 4;
    const conj = (q, o, out) => { out[0] = -q[o]; out[1] = -q[o + 1]; out[2] = -q[o + 2]; out[3] = q[o + 3]; };
    /* contragiro de la columna: h* · z(-a/2) · h · s */
    qz[2] = sin(-angle / 4); qz[3] = cos(-angle / 4);
    conj(pose, iH, qa);
    qmul(qa, 0, qz, 0, qb, 0);
    qmul(qb, 0, pose, iH, qc, 0);
    /* contragiro del pecho: (h·s)* · z(-a/2) · (h·s) · c, con la pelvis y la columna originales */
    qmul(pose, iH, pose, iS, qa, 0);          /* qa = h·s */
    const hs = [qa[0], qa[1], qa[2], qa[3]];
    qmul(qc, 0, pose, iS, qb, 0);             /* columna nueva */
    pose[iS] = qb[0]; pose[iS + 1] = qb[1]; pose[iS + 2] = qb[2]; pose[iS + 3] = qb[3];
    conj(hs, 0, qa);
    qmul(qa, 0, qz, 0, qb, 0);
    qmul(qb, 0, hs, 0, qc, 0);
    qmul(qc, 0, pose, iC, qb, 0);
    pose[iC] = qb[0]; pose[iC + 1] = qb[1]; pose[iC + 2] = qb[2]; pose[iC + 3] = qb[3];
    /* pelvis: z(a) · h */
    qz[2] = sin(angle / 2); qz[3] = cos(angle / 2);
    qmul(qz, 0, pose, iH, qb, 0);
    pose[iH] = qb[0]; pose[iH + 1] = qb[1]; pose[iH + 2] = qb[2]; pose[iH + 3] = qb[3];
    return pose;
  };

  /* ---------- cara ---------- */
  /* Pesos de las expresiones: salen de los tramos que marca cada clip (`caras`) y de un parpadeo
     cada tanto. `forced` fija una expresión (para revisar). */
  P3.makeFace = function (ch) {
    const names = ch.morph ? ch.morph.names : [];
    const iBlink = names.indexOf('parpadeo');
    const F = { w: new Float32Array(names.length), next: 1.2 + Math.random() * 2.5, blink: -1 };
    F.update = function (dt, clip, time, forced) {
      let busy = 0;
      for (let i = 0; i < names.length; i++) {
        if (i === iBlink) continue;
        let target = 0;
        if (forced) target = forced === names[i] ? 1 : 0;
        else if (clip && clip.caras) for (const c of clip.caras) if (c[2] === names[i] && time >= c[0] && time <= c[1]) target = 1;
        F.w[i] = dt <= 0 ? target : F.w[i] + (target - F.w[i]) * (1 - Math.exp(-dt * 22));
        busy = max(busy, F.w[i]);
      }
      if (iBlink >= 0) {
        let w = 0;
        if (forced) w = forced === 'parpadeo' ? 1 : 0;
        else if (dt > 0) {
          F.next -= dt;
          if (F.blink < 0 && F.next <= 0) { F.blink = 0; F.next = 2.2 + Math.random() * 3.2; }
          if (F.blink >= 0) {
            F.blink += dt / 0.16;
            const u = F.blink;
            w = u < 0.36 ? smooth(u / 0.36) : 1 - smooth((u - 0.36) / 0.64);
            if (u >= 1) F.blink = -1;
          }
        }
        F.w[iBlink] = w * (1 - min(1, busy * 2.2));     /* con otra expresión marcada, el parpadeo no se suma */
      }
      return F.w;
    };
    return F;
  };

  /* ---------- dibujo ---------- */
  P3.makeCharacterGL = function (gl, ch) {
    const pChar = P3.program(gl, CHAR_VS, CHAR_FS);
    const M = ch.meta.mesh;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const attr = (name, data, size, type, norm, usage) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pChar.p, name);
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, norm, 0, 0); }
      return b;
    };
    const posBuf = attr('aPos', ch.pos, 3, gl.SHORT, true, gl.DYNAMIC_DRAW);
    attr('aNrm', ch.nrm, 3, gl.BYTE, true);
    attr('aMat', ch.mat, 1, gl.UNSIGNED_BYTE, false);
    attr('aOut', ch.out, 1, gl.UNSIGNED_BYTE, true);
    attr('aJoints', ch.joints, 3, gl.UNSIGNED_BYTE, false);
    attr('aWeights', ch.weights, 2, gl.UNSIGNED_BYTE, true);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ch.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    const palettes = {};
    const palette = (name) => {
      if (!palettes[name]) {
        const src = ch.meta.palettes[name] || ch.meta.palettes.rival, a = new Float32Array(26 * 4);
        src.forEach((c, i) => { a[i * 4] = c[0]; a[i * 4 + 1] = c[1]; a[i * 4 + 2] = c[2]; a[i * 4 + 3] = ch.meta.flat[i] ? 1 : 0; });
        palettes[name] = a;
      }
      return palettes[name];
    };
    const key = (() => { const v = [-0.5, -0.6, 0.62]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
    const defaults = P3.styleOf(ch, 'rival');

    /* cara: los vértices de la cara se recalculan solo cuando cambian los pesos */
    const F = ch.morph;
    const facePos = F ? new Int16Array(F.count * 3) : null, faceBase = F ? ch.pos.slice(F.start * 3, (F.start + F.count) * 3) : null;
    let faceKey = '';
    const C = { faceUpdates: 0, drawCalls: 0 };
    function setFace(w) {
      if (!F) return;
      let k = '';
      if (w) for (let i = 0; i < F.names.length; i++) k += (w[i] * 40 + 0.5) | 0;
      if (k === faceKey) return;
      faceKey = k;
      facePos.set(faceBase);
      const n = F.count * 3;
      if (w) for (let t = 0; t < F.names.length; t++) {
        const wt = ((w[t] * 40 + 0.5) | 0) / 40;
        if (!wt) continue;
        const d = F.deltas, o = t * n;
        for (let i = 0; i < n; i++) facePos[i] += d[o + i] * wt;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, F.start * 6, facePos);
      C.faceUpdates++;
    }

    /* c: { x, y, yaw (grados), k (escala), mats, palette, style, face }.
       env: { vp, eye, sun, viewport: [w, h], outlinePx, shadow (color o null), keepDepth } */
    C.draw = function (c, env) {
      const u = pChar.u, st = c.style || defaults;
      gl.useProgram(pChar.p);
      gl.bindVertexArray(vao);
      setFace(c.face || null);
      gl.uniformMatrix4fv(u.uVP, false, env.vp);
      gl.uniformMatrix4fv(u.uBones, false, c.mats);
      gl.uniform3fv(u.uCenter, M.center);
      gl.uniform3fv(u.uHalf, M.half);
      gl.uniform4f(u.uRoot, c.x, c.y, (c.yaw * PI) / 180, c.k);
      gl.uniform4fv(u.uPal, palette(c.palette || st.palette));
      gl.uniform3fv(u.uSun, env.sun || P3.SUN);
      gl.uniform3fv(u.uKey, env.key || key);
      gl.uniform3fv(u.uEye, env.eye);
      gl.uniform3fv(u.uInk, ch.meta.ink);
      gl.uniform3fv(u.uShadowTint, ch.meta.shadowTint);
      gl.uniform3fv(u.uLightGain, ch.meta.lightGain);
      gl.uniform3fv(u.uRim, ch.meta.rimColor);
      gl.uniform2f(u.uViewport, env.viewport[0], env.viewport[1]);
      const pass = () => { for (const r of st.ranges) { gl.drawElements(gl.TRIANGLES, r[1], gl.UNSIGNED_SHORT, r[0] * 2); C.drawCalls++; } };
      if (env.shadow) {
        /* 1) sombra en el piso: se multiplica una sola vez por píxel, gracias al stencil */
        gl.uniform3fv(u.uShadowCol, env.shadow);
        gl.uniform1i(u.uMode, 2);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.STENCIL_TEST);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.stencilFunc(gl.NOTEQUAL, 1, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        gl.blendFunc(gl.DST_COLOR, gl.ZERO);
        pass();
        gl.disable(gl.STENCIL_TEST);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      /* 2) cuerpo y 3) contorno, con profundidad propia */
      gl.enable(gl.DEPTH_TEST);
      if (!env.keepDepth) gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.uniform1i(u.uMode, 0);
      pass();
      gl.cullFace(gl.FRONT);
      gl.uniform1i(u.uMode, 1);
      gl.uniform1f(u.uOutlinePx, env.outlinePx);
      pass();
      gl.cullFace(gl.BACK);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
    };
    C.triangles = (st) => (st || defaults).triangles;
    C.vertices = M.nv;
    return C;
  };
})(window);
