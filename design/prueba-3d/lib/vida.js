/* Prueba 3D · versión B: lo que solo se puede hacer dibujando en vivo.
   - La cabeza sigue la pelota.
   - La trenza se mueve con resorte: se atrasa cuando el cuerpo arranca y se pasa cuando frena.
   Las dos cosas corrigen la pose antes de calcular las matrices; los clips no cambian. */
(function (g) {
  'use strict';
  const P3 = (g.P3 = g.P3 || {});
  const { sin, cos, atan2, asin, sqrt, min, max, PI } = Math;

  const qmul = (a, ao, b, out, oo) => {
    const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
    const x = aw * b[0] + ax * b[3] + ay * b[2] - az * b[1];
    const y = aw * b[1] - ax * b[2] + ay * b[3] + az * b[0];
    const z = aw * b[2] + ax * b[1] - ay * b[0] + az * b[3];
    const w = aw * b[3] - ax * b[0] - ay * b[1] - az * b[2];
    out[oo] = x; out[oo + 1] = y; out[oo + 2] = z; out[oo + 3] = w;
  };
  /* giro alrededor de Z (yaw) y después de X (cabeceo), como cuaternión */
  const yawPitch = (yaw, pitch, out) => {
    const cy = cos(yaw / 2), sy = sin(yaw / 2), cp = cos(pitch / 2), sp = sin(pitch / 2);
    out[0] = cy * sp; out[1] = sy * sp; out[2] = sy * cp; out[3] = cy * cp;
    return out;
  };
  /* giro chico alrededor de X y de Y */
  const tilt = (rx, ry, out) => {
    const cx = cos(rx / 2), sx = sin(rx / 2), cy = cos(ry / 2), sy = sin(ry / 2);
    out[0] = sx * cy; out[1] = cx * sy; out[2] = sx * sy; out[3] = cx * cy;
    return out;
  };

  P3.makeLife = function (ch) {
    const names = ch.meta.bones.names;
    const iHead = names.indexOf('head'), iNeck = names.indexOf('neck');
    const iB = ['braid1', 'braid2', 'braid3'].map((n) => names.indexOf(n));
    const L = { yaw: 0, pitch: 0, bx: 0, by: 0, vbx: 0, vby: 0, px: null, py: 0, pz: 0, vx: 0, vy: 0, vz: 0 };
    const q = new Float32Array(4), tmp = new Float32Array(4);

    /* work: rotaciones y posiciones del mundo del personaje calculadas con la pose sin corregir */
    L.apply = function (pose, work, char, ball, dt, amount) {
      /* --- cabeza: dirección a la pelota, en el marco del cuello --- */
      const s = char.yaw === 180 ? -1 : 1, k = char.k;
      const bx = (s * (ball.x - char.x)) / k, by = (s * (ball.y - char.y)) / k, bz = ball.z / k;      /* pelota en ejes del personaje */
      const hx = work.pos[iHead * 3], hy = work.pos[iHead * 3 + 1], hz = work.pos[iHead * 3 + 2] + 0.12;
      const dx = bx - hx, dy = by - hy, dz = bz - hz;
      const o = iNeck * 9, r = work.rot;
      /* al marco del cuello: R^T · d */
      const lx = r[o] * dx + r[o + 3] * dy + r[o + 6] * dz;
      const ly = r[o + 1] * dx + r[o + 4] * dy + r[o + 7] * dz;
      const lz = r[o + 2] * dx + r[o + 5] * dy + r[o + 8] * dz;
      const len = sqrt(lx * lx + ly * ly + lz * lz) || 1;
      let yaw = atan2(lx, -ly), pitch = asin(P3.clamp(lz / len, -1, 1));
      if (Math.abs(yaw) > 1.9) yaw = 0;                      /* pelota a la espalda: no se da vuelta */
      yaw = P3.clamp(yaw, -1.1, 1.1);
      pitch = P3.clamp(pitch, -0.35, 0.6);
      const f = dt <= 0 ? 1 : 1 - Math.exp(-dt * 9);        /* en pausa: mira directo, sin transición */
      L.yaw += (yaw - L.yaw) * f;
      L.pitch += (pitch - L.pitch) * f;
      yawPitch(L.yaw * 0.85, -L.pitch * 0.8, q);
      const hk = iHead * 4, w = amount * (ball.visible ? 1 : 0);
      /* mezcla entre la cabeza del clip y la que mira la pelota */
      const d = pose[hk] * q[0] + pose[hk + 1] * q[1] + pose[hk + 2] * q[2] + pose[hk + 3] * q[3];
      const sg = d < 0 ? -1 : 1;
      for (let c = 0; c < 4; c++) pose[hk + c] = pose[hk + c] * (1 - w) + q[c] * sg * w;

      /* --- trenza: péndulo amortiguado que se atrasa respecto del movimiento de la cabeza --- */
      const wx = char.x + s * hx * k, wy = char.y + s * hy * k, wz = hz * k;     /* cabeza en el mundo */
      if (L.px === null || dt <= 0) { L.px = wx; L.py = wy; L.pz = wz; }
      const inv = dt > 0 ? 1 / dt : 0;
      const vx = (wx - L.px) * inv, vy = (wy - L.py) * inv;
      L.px = wx; L.py = wy; L.pz = wz;
      const sm = 1 - Math.exp(-dt * 14);
      L.vx += (vx - L.vx) * sm; L.vy += (vy - L.vy) * sm;
      /* velocidad en ejes del personaje: la trenza cuelga hacia atrás de hacia donde se va */
      const mvx = s * L.vx, mvy = s * L.vy;
      const tx = P3.clamp(-mvy * 0.10, -0.7, 0.7), ty = P3.clamp(mvx * 0.12, -0.7, 0.7);
      const K = 70, Dm = 7.5, h = min(dt, 0.033);
      L.vbx += ((tx - L.bx) * K - L.vbx * Dm) * h; L.bx += L.vbx * h;
      L.vby += ((ty - L.by) * K - L.vby * Dm) * h; L.by += L.vby * h;
      const gains = [0.35, 0.8, 1.15];
      for (let i = 0; i < 3; i++) {
        tilt(L.bx * gains[i] * amount, L.by * gains[i] * amount, tmp);
        qmul(pose, iB[i] * 4, tmp, pose, iB[i] * 4);
      }
    };
    return L;
  };
})(window);
