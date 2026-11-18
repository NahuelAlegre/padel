/* Prueba 3D · base compartida por las dos versiones (sin dependencias).
   Cámara, capas de la cancha, peloteo guionado e interruptores.
   Ejes del mundo, en metros: x a lo ancho (-5..5), y a lo largo (-10 fondo propio .. +10 fondo rival,
   red en 0), z hacia arriba. Son los mismos ejes que usa el motor. */
(function (g) {
  'use strict';
  const P3 = (g.P3 = g.P3 || {});
  const { sin, cos, sqrt, abs, min, max, PI, atan2, floor } = Math;

  P3.clamp = (v, a, b) => max(a, min(b, v));
  P3.lerp = (a, b, t) => a + (b - a) * t;
  P3.smooth = (t) => { t = P3.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  P3.GRAVITY = 9.8;
  P3.COURT = { halfW: 5, halfL: 10, service: 6.95, net: 0.88 };
  /* Hacia el sol: atrás y a la izquierda. Coincide con la luz con la que se renderizó la cancha. */
  P3.SUN = (() => { const v = [-0.42, 0.80, 0.43]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
  P3.SHADOW_RGB = [0.60, 0.56, 0.80];        /* la sombra multiplica el piso y lo vira al violeta */
  /* duración de los efectos de impacto, en segundos: cortos, para no ensuciar la pantalla */
  P3.FX = { golpe: 0.16, pique: 0.2, vidrio: 0.22 };

  /* ------------------------------------------------------------------
     Cámara. La de referencia es la del render de la cancha; la de juego se aparta
     de ella solo un poco (paneo, giro y acercamiento).
     ------------------------------------------------------------------ */
  P3.REF = { pos: [0, -25.91, 16.52], pitch: 30, yaw: 0, f: 790.9, design: [390, 844] };

  P3.makeCamera = function (o) {
    const p = (o.pitch * PI) / 180, w = ((o.yaw || 0) * PI) / 180;
    const cam = {
      pos: o.pos.slice(), f: o.f,
      right: [cos(w), -sin(w), 0],
      fwd: [sin(w) * cos(p), cos(w) * cos(p), -sin(p)],
    };
    const r = cam.right, f = cam.fwd;
    cam.up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    /** Mundo → px de diseño, con origen en el centro del cuadro de diseño. out.d es la profundidad. */
    cam.project = function (x, y, z, out) {
      const dx = x - cam.pos[0], dy = y - cam.pos[1], dz = z - cam.pos[2];
      const d = dx * f[0] + dy * f[1] + dz * f[2];
      out.x = (cam.f * (dx * r[0] + dy * r[1] + dz * r[2])) / d;
      out.y = (-cam.f * (dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2])) / d;
      out.d = d;
      return out;
    };
    return cam;
  };

  /* ------------------------------------------------------------------
     Cámara que acompaña. Criterio (pádel, no tenis): la pelota que pasa al jugador sigue en juego
     porque rebota en el vidrio, así que la cámara nunca se pega al jugador. Queda en un punto
     medio: se mueve sobre todo de costado y con un zoom leve, de límites estrictos.
       1. Siempre a la vista, con margen: el jugador propio, la pelota, su marca de pique y el
          vidrio del fondo propio.
       2. El rival y la red, siempre a la vista.
       3. Paneo lateral y zoom entre zoomMin y zoomMax. Nada más.
       4. Se abre cuando la pelota va al fondo propio o es un globo; se cierra con el juego en la red.
       5. Zona muerta y suavizado: no sigue cada pasito y no salta.
       6. Con «reducir movimiento»: fija, con la cancha entera.
     ------------------------------------------------------------------ */
  P3.CAMERA = {
    zoomMin: 1.0, zoomMax: 1.30,                    /* límites estrictos */
    zoomOpen: 1.04, zoomMid: 1.16, zoomNet: 1.28,   /* abierta, media y con el juego en la red */
    panShare: 0.55,                                 /* parte del paneo que es traslación (da parallax); el resto es giro */
    margin: { player: 52, ball: 26, mark: 30, rival: 24 },   /* px de diseño hasta el borde */
    hard: 10,                                       /* margen mínimo que no se rompe ni en transición */
    bar: 78, top: 34,                               /* franjas reservadas abajo (barra) y arriba, en px de diseño */
    deadZone: 0.5,                                  /* m que tiene que cambiar el encuadre ideal para que la cámara se mueva */
    panSpeed: 1.7,                                  /* m/s con que el destino del paneo busca el encuadre ideal */
  };

  /** Cámara de juego a partir del paneo (m) y el zoom. */
  P3.followCamera = function (follow) {
    const R = P3.REF, c = follow.pan || 0, dx = c * P3.CAMERA.panShare;
    return P3.makeCamera({ pos: [R.pos[0] + dx, R.pos[1], R.pos[2]], pitch: R.pitch, yaw: (atan2(c - dx, 28) * 180) / PI, f: R.f * (follow.zoom || 1) });
  };

  P3.makeFollow = function () {
    const C = P3.CAMERA, HALF = P3.REF.design[0] / 2;
    const s = { pan: 0, vpan: 0, zoom: 1, vzoom: 0, x: 0, aim: 0, target: 0, mode: 'media', timer: 0, moving: false };
    const ref = P3.makeCamera(P3.REF), shifted = P3.followCamera({ pan: 1, zoom: 1 });
    const pa = {}, pb = {};
    /* dónde cae un punto con la cámara de referencia y cuánto se corre por cada metro de paneo */
    const item = (x, y, z, margin) => { ref.project(x, y, z, pa); shifted.project(x, y, z, pb); return { x0: pa.x, y0: pa.y, g: pa.x - pb.x, L: HALF - margin }; };
    const spring = (cur, vel, target, k, dt) => { vel += ((target - cur) * k * k - 2 * k * vel) * dt; return [cur + vel * dt, vel]; };
    const gNear = item(0, -10, 0, 0).g;

    /* intervalo de paneo que deja todos los puntos adentro de sus márgenes, con un zoom dado */
    function interval(items, zoom, hard) {
      let lo = -Infinity, hi = Infinity;
      for (const it of items) {
        const L = hard ? HALF - C.hard : it.L;
        lo = max(lo, (it.x0 - L / zoom) / it.g);
        hi = min(hi, (it.x0 + L / zoom) / it.g);
      }
      /* no mostrar mucho más allá de las paredes laterales */
      const cmax = max(0.35, (zoom * 189 - HALF + 30) / gNear);
      return [max(lo, -cmax), min(hi, cmax), lo <= hi];
    }

    function plan(ctx) {
      const { player, rival, ball, mark, lay } = ctx;
      const live = ball.visible && !ball.held;
      /* 4. qué pide el juego */
      let want = 'media';
      if (live && (ball.z > 2.6 || (mark && mark.y < -5) || (ball.y < -6.8 && ball.vy < 0.5))) want = 'abierta';
      else if (player.y > -5.6) want = 'red';
      /* 1 y 2. topes de zoom para que entren, de arriba abajo, el rival, la pelota y el vidrio propio */
      const visTop = lay.cy - P3.REF.design[1] / 2 - lay.visH / 2 + C.top;
      const visBot = lay.cy - P3.REF.design[1] / 2 + lay.visH / 2 - C.bar;
      let cap = C.zoomMax;
      const down = [item(0, -P3.COURT.halfL, 0, 0), item(player.x, max(-P3.COURT.halfL, player.y - 2.5), 0, 0)];
      for (const it of down) if (it.y0 > 1) cap = min(cap, visBot / it.y0);
      const up = [item(rival.x, rival.y, 1.95 * rival.k, 0), item(0, 0, 1.0, 0)];
      if (live) up.push(item(ball.x, ball.y, ball.z + 0.2, 0));
      for (const it of up) if (it.y0 < -1) cap = min(cap, visTop / it.y0);
      /* 1 y 2. de costado: jugador, pelota, marca de pique y rival */
      const items = [item(player.x, player.y, 0.9 * player.k, C.margin.player), item(rival.x, rival.y, 0.9 * rival.k, C.margin.rival)];
      if (live) items.push(item(ball.x, ball.y, ball.z, C.margin.ball));
      if (mark) items.push(item(mark.x, mark.y, 0, C.margin.mark));
      return { want, cap, items, pref: 0.62 * player.x };
    }

    function fit(items, zoom) {
      /* si con ese zoom no entra todo, se abre hasta que entre */
      let z = zoom, iv = interval(items, z);
      for (let n = 0; n < 8 && !iv[2] && z > C.zoomMin; n++) { z = max(C.zoomMin, z - 0.035); iv = interval(items, z); }
      return [z, iv];
    }
    const zoomOf = (mode) => (mode === 'abierta' ? C.zoomOpen : mode === 'red' ? C.zoomNet : C.zoomMid);

    s.update = function (ctx, dt, enabled) {
      dt = min(dt, 0.05);
      if (!enabled) {
        [s.pan, s.vpan] = spring(s.pan, s.vpan, 0, 3.0, dt);
        [s.zoom, s.vzoom] = spring(s.zoom, s.vzoom, 1, 2.2, dt);
        s.target = 0; s.moving = false;
      } else {
        const pl = plan(ctx);
        /* cambia de plano enseguida para abrir y con un poco de espera para cerrar */
        if (pl.want !== s.mode) { s.timer += dt; if (s.timer >= (pl.want === 'abierta' ? 0 : 0.35)) { s.mode = pl.want; s.timer = 0; } } else s.timer = 0;
        const [zt, iv] = fit(pl.items, P3.clamp(min(zoomOf(s.mode), pl.cap), C.zoomMin, C.zoomMax));
        /* 5. zona muerta: el destino solo se mueve si algo se sale del margen o si el ideal se alejó bastante */
        const pref = P3.clamp(pl.pref, iv[0], iv[1]);
        if (s.target < iv[0]) s.target = iv[0]; else if (s.target > iv[1]) s.target = iv[1];
        if (!s.moving && abs(pref - s.target) > C.deadZone) s.moving = true;
        if (s.moving) {
          s.target += P3.clamp(pref - s.target, -C.panSpeed * dt, C.panSpeed * dt);
          if (abs(pref - s.target) < 0.06) s.moving = false;
        }
        [s.pan, s.vpan] = spring(s.pan, s.vpan, s.target, 3.0, dt);
        [s.zoom, s.vzoom] = spring(s.zoom, s.vzoom, zt, zt < s.zoom ? 2.8 : 1.9, dt);     /* abre rápido, cierra más despacio */
        s.zoom = P3.clamp(s.zoom, C.zoomMin, C.zoomMax);
        /* garantía: aun en plena transición, nada importante toca el borde */
        const hard = interval(pl.items, s.zoom, true);
        if (hard[0] <= hard[1]) { if (s.pan < hard[0]) { s.pan = hard[0]; s.vpan = max(0, s.vpan); } else if (s.pan > hard[1]) { s.pan = hard[1]; s.vpan = min(0, s.vpan); } }
      }
      s.x = s.pan * C.panShare; s.aim = s.pan;
      return s;
    };
    /* sin transición: para arrancar, para el reinicio del peloteo o para mirar un instante fijo */
    s.jump = function (ctx, enabled) {
      s.vpan = s.vzoom = 0; s.timer = 0; s.moving = false;
      if (!enabled) { s.pan = s.target = 0; s.zoom = 1; } else {
        const pl = plan(ctx);
        s.mode = pl.want;
        const [zt, iv] = fit(pl.items, P3.clamp(min(zoomOf(s.mode), pl.cap), C.zoomMin, C.zoomMax));
        s.zoom = zt;
        s.pan = s.target = P3.clamp(pl.pref, iv[0], iv[1]);
      }
      s.x = s.pan * C.panShare; s.aim = s.pan;
      return s;
    };
    return s;
  };

  /* ------------------------------------------------------------------
     Cuadro: columna vertical que entra en la ventana. El cuadro de diseño (390 x 844)
     siempre ocupa el ancho de la columna; si la pantalla es más alta, se ve más cielo y más vereda.
     ------------------------------------------------------------------ */
  P3.layout = function (vw, vh) {
    const D = P3.REF.design;
    const colW = min(vw, vh * (D[0] / 700));
    const s = colW / D[0];
    const visH = vh / s;                       /* alto visible, en px de diseño */
    const cy = P3.clamp(D[1] / 2 + 6, visH / 2 - D[1] * 0.1, D[1] * 1.1 - visH / 2);   /* centro visible */
    return { vw, vh, s, colW, colX: (vw - colW) / 2, visH, cy, ox: vw / 2, oy: vh / 2 - (cy - D[1] / 2) * s };
  };

  /* ------------------------------------------------------------------
     Carga de recursos
     ------------------------------------------------------------------ */
  P3.loadJSON = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  P3.loadImage = (url) => new Promise((ok, fail) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => ok(im);
    im.onerror = () => fail(new Error('No se pudo cargar ' + url));
    im.src = url;
  });
  P3.loadCourt = async function (dir) {
    const meta = await P3.loadJSON(dir + 'cancha.json');
    const images = await Promise.all(meta.layers.map((l) => P3.loadImage(dir + l.file)));
    meta.layers.forEach((l, i) => {
      l.image = images[i];
      /* rectángulo de la capa en px de diseño, con origen en el centro del cuadro */
      l.dx = (l.x - meta.render[0] / 2) / meta.dpr;
      l.dy = (l.y - meta.render[1] / 2) / meta.dpr;
      l.dw = l.w / meta.dpr;
      l.dh = l.h / meta.dpr;
    });
    meta.byName = Object.fromEntries(meta.layers.map((l) => [l.name, l]));
    return meta;
  };
  P3.NEAR_WALL_ALPHA = 0.7;                  /* la pared del fondo propio se dibuja más tenue para no tapar al jugador */

  /* ------------------------------------------------------------------
     Escala de los personajes: tres variantes, con exageración según la profundidad
     ------------------------------------------------------------------ */
  P3.SCALES = [
    { id: 'real', label: '1,0', near: 1.0, far: 1.0 },
    { id: 'prof', label: '1,2 – 1,5', near: 1.2, far: 1.5 },
    { id: 'grande', label: '1,7', near: 1.7, far: 1.7 },
  ];
  P3.scaleAt = (variant, y) => P3.lerp(variant.near, variant.far, P3.clamp((y + 8) / 16, 0, 1));

  /* ------------------------------------------------------------------
     Peloteo guionado. Todo sale de una lista de golpes: quién, con qué clip, dónde se para
     y cuándo es el impacto. El punto de impacto sale de la animación (centro de la pala en
     ese cuadro, con la escala del personaje), y la pelota vuela en parábolas entre impactos,
     piques y paredes. Es determinista: sample(t) no guarda estado.
     ------------------------------------------------------------------ */
  const BALL_R = 0.033;

  function arc(p0, t0, p1, t1) {
    const T = t1 - t0;
    return {
      t0, t1, p0,
      v: [(p1[0] - p0[0]) / T, (p1[1] - p0[1]) / T, (p1[2] - p0[2]) / T + 0.5 * P3.GRAVITY * T],
    };
  }
  function arcAt(a, t, out) {
    const u = t - a.t0;
    out[0] = a.p0[0] + a.v[0] * u;
    out[1] = a.p0[1] + a.v[1] * u;
    out[2] = a.p0[2] + a.v[2] * u - 0.5 * P3.GRAVITY * u * u;
    return out;
  }

  P3.buildRally = function (clips, variant) {
    const C = Object.fromEntries(clips.map((c) => [c.name, c]));
    const kN = variant.near, kF = variant.far;
    const who = [
      { name: 'jugador', yaw: 180, look: 1 },   /* 0: propio, de espaldas, mira hacia +y */
      { name: 'rival', yaw: 0, look: -1 },      /* 1: rival, de frente, mira hacia -y */
    ];
    /* punto del mundo de un punto local del personaje */
    const toWorld = (pl, root, local, k) => {
      const s = pl.yaw === 180 ? -1 : 1;
      return [root[0] + s * local[0] * k, root[1] + s * local[1] * k, local[2] * k];
    };
    const scaleOf = (i, y) => P3.scaleAt(variant, y);

    /* golpes: jugador, clip, dónde se para (x, y) y momento del impacto */
    const hits = [
      { who: 0, clip: 'saque', root: [1.5, -7.9], t: 1.0 },
      { who: 1, clip: 'derecha', root: [-2.3, 8.3], t: 2.4 },
      { who: 0, clip: 'reves', root: [-2.2, -8.9], t: 4.42, label: 'Salida de pared' },
      { who: 1, clip: 'globo', root: [2.6, 7.4], t: 5.95, label: 'Globo' },
      { who: 0, clip: 'remate', root: [-0.2, -4.4], t: 7.75, label: '¡Remate!' },
    ];
    for (const h of hits) {
      h.k = scaleOf(h.who, h.root[1]);
      h.point = toWorld(who[h.who], h.root, C[h.clip].hit, h.k);
      h.start = h.t - C[h.clip].contact;
      h.end = h.start + C[h.clip].dur;
    }
    const g0 = BALL_R;
    /* recorrido de la pelota: [tiempo, punto, tipo] */
    const serve = hits[0], sc = C.saque;
    const tRel = serve.start + sc.release;
    const hold0 = toWorld(who[0], serve.root, sc.ballHold[0], serve.k);
    const hold1 = toWorld(who[0], serve.root, sc.ballHold[1], serve.k);
    const dropT = tRel + (serve.t - tRel) * 0.6;
    const way = [
      [tRel, hold1, 'suelta'],
      [dropT, [serve.point[0] - 0.02, serve.point[1] - 0.03, g0], 'pique'],
      [serve.t, serve.point, 'golpe', 0],
      [1.95, [-2.0, 4.4, g0], 'pique'],
      [hits[1].t, hits[1].point, 'golpe', 1],
      [3.45, [-2.6, -6.6, g0], 'pique'],
      [3.85, [-3.0, -9.93, 1.0], 'vidrio'],
      [hits[2].t, hits[2].point, 'golpe', 2],
      [5.5, [1.3, 4.0, g0], 'pique'],
      [hits[3].t, hits[3].point, 'golpe', 3],
      [hits[4].t, hits[4].point, 'golpe', 4],
      [8.12, [-1.4, 6.3, g0], 'pique'],
      [8.48, [-1.9, 9.93, 2.3], 'vidrio'],
      [9.4, [-1.5, 4.6, g0], 'pique'],
      [9.95, [-1.35, 3.3, g0], 'pique'],
      [10.35, [-1.3, 2.7, g0], 'pique'],
    ];
    const arcs = [];
    for (let i = 0; i < way.length - 1; i++) arcs.push(arc(way[i][1], way[i][0], way[i + 1][1], way[i + 1][0]));
    const events = way.map((w) => ({ t: w[0], pos: w[1], type: w[2], hit: w[3] }));
    /* solo se nombran los golpes especiales; una derecha o un saque no llevan cartel */
    for (const e of events) if (e.type === 'golpe') { e.who = hits[e.hit].who; e.label = hits[e.hit].label || null; }
    /* marca de pique: solo el primer pique en el lado propio de una pelota que viene del rival */
    const marks = [];
    /* marca de objetivo (demostración): a dónde va el golpe propio, mientras se arma */
    const aims = [];
    for (let i = 0; i < way.length - 1; i++) {
      const a = way[i], b = way[i + 1];
      if (a[2] !== 'golpe' || b[2] !== 'pique') continue;
      const h = hits[a[3]];
      if (h.who === 1 && b[1][1] < 0) marks.push({ t0: a[0], t1: b[0], x: b[1][0], y: b[1][1] });
      if (h.who === 0) aims.push({ t0: h.start + 0.12, t1: a[0], x: b[1][0], y: b[1][1] });
    }
    const ownHits = hits.filter((h) => h.who === 0 && h.clip !== 'saque').map((h) => h.t);

    /* recorrido de cada jugador: puntos [tiempo, x, y]; entre puntos se mueve con arranque y frenado suaves */
    const paths = [
      [[0, 1.5, -7.9], [1.55, 1.5, -7.9], [3.55, -2.2, -8.9], [5.0, -2.2, -8.9], [7.0, -0.2, -4.4], [8.85, -0.2, -4.4], [9.4, -0.1, -4.7], [10.5, -0.1, -4.7]],
      [[0, -2.3, 8.3], [3.05, -2.3, 8.3], [5.4, 2.6, 7.4], [6.6, 2.6, 7.4], [7.6, 0.6, 7.9], [8.0, 0.4, 8.0], [9.0, -0.9, 6.9], [10.5, -0.9, 6.9]],
    ];
    const extra = [{ who: 0, clip: 'festejo', start: 9.45, end: 9.45 + C.festejo.dur }];
    const DUR = 10.9;

    function pathAt(path, t, out) {
      let i = 0;
      while (i + 2 < path.length && path[i + 1][0] <= t) i++;
      const a = path[i], b = path[i + 1];
      const u = P3.smooth((t - a[0]) / (b[0] - a[0] || 1));
      out.x = P3.lerp(a[1], b[1], u);
      out.y = P3.lerp(a[2], b[2], u);
      return out;
    }
    /* distancia recorrida hasta t (para que los pasos avancen con el movimiento real) */
    function travelled(path, t) {
      let d = 0;
      for (let i = 0; i + 1 < path.length; i++) {
        const a = path[i], b = path[i + 1];
        const len = Math.hypot(b[1] - a[1], b[2] - a[2]);
        if (t >= b[0]) d += len;
        else { if (t > a[0]) d += len * P3.smooth((t - a[0]) / (b[0] - a[0])); break; }
      }
      return d;
    }
    const strokes = [0, 1].map((i) => hits.filter((h) => h.who === i).map((h) => ({ clip: h.clip, start: h.start, end: h.end }))
      .concat(extra.filter((e) => e.who === i)).sort((a, b) => a.start - b.start));
    const tmpA = { x: 0, y: 0 }, tmpB = { x: 0, y: 0 };

    function playerAt(i, t, out) {
      const path = paths[i], pl = who[i];
      pathAt(path, t, out);
      out.yaw = pl.yaw;
      out.k = scaleOf(i, out.y);
      out.who = i;
      const st = strokes[i].find((s) => t >= s.start && t < s.end);
      if (st) { out.clip = st.clip; out.time = t - st.start; out.since = t - st.start; out.blend = P3.smooth(min(1, (t - st.start) / 0.12) * 1) * P3.smooth(min(1, (st.end - t) / 0.16)); return out; }
      pathAt(path, t - 0.03, tmpA);
      pathAt(path, t + 0.03, tmpB);
      const vx = (tmpB.x - tmpA.x) / 0.06, vy = (tmpB.y - tmpA.y) / 0.06;
      const sp = Math.hypot(vx, vy);
      const s = pl.yaw === 180 ? -1 : 1;
      const lx = s * vx, ly = s * vy;           /* velocidad en ejes del personaje (mira a -y local) */
      out.speed = sp;
      out.blend = 1;
      if (sp < 0.45) { out.clip = 'listo'; out.time = t % C.listo.dur; return out; }
      const dist = travelled(path, t);
      if (abs(lx) > abs(ly) * 0.75) {
        out.clip = lx > 0 ? 'lateral_izq' : 'lateral_der';
        out.time = ((dist / 1.05) % 1) * C[out.clip].dur;
      } else {
        out.clip = 'correr';
        const ph = (dist / 1.45) % 1;
        out.time = (ly < 0 ? ph : 1 - ph) * C.correr.dur;     /* hacia atrás: el mismo trote, al revés */
      }
      return out;
    }

    const ballTmp = [0, 0, 0];
    function ballAt(t, out) {
      out.visible = true;
      out.held = false;
      if (t < way[0][0]) {
        const u = P3.clamp((t - serve.start) / (tRel - serve.start), 0, 1);
        out.x = P3.lerp(hold0[0], hold1[0], u); out.y = P3.lerp(hold0[1], hold1[1], u); out.z = P3.lerp(hold0[2], hold1[2], u);
        out.held = true;
        out.speed = 0; out.vx = out.vy = out.vz = 0;
        return out;
      }
      let a = arcs[arcs.length - 1];
      for (let i = 0; i < arcs.length; i++) if (t < arcs[i].t1) { a = arcs[i]; break; }
      if (t >= a.t1) { out.x = a.p0[0]; out.visible = t < a.t1 + 0.3; arcAt(a, a.t1, ballTmp); } else arcAt(a, t, ballTmp);
      out.x = ballTmp[0]; out.y = ballTmp[1]; out.z = max(BALL_R, ballTmp[2]);
      const u = min(t, a.t1) - a.t0;
      out.speed = Math.hypot(a.v[0], a.v[1], a.v[2] - P3.GRAVITY * u);
      out.vx = a.v[0]; out.vy = a.v[1]; out.vz = a.v[2] - P3.GRAVITY * u;
      return out;
    }

    const within = (list, t, out) => {
      const m = list.find((e) => t >= e.t0 && t < e.t1);
      if (!m) return null;
      out.x = m.x; out.y = m.y; out.k = (t - m.t0) / (m.t1 - m.t0); out.left = m.t1 - t;
      return out;
    };
    return {
      duration: DUR, events, hits, arcs, who,
      player: playerAt, ball: ballAt,
      mark: (t, out) => within(marks, t, out),
      aim: (t, out) => within(aims, t, out),
      /* señal de timing: sube en el último instante antes de que el jugador propio le pegue (0 a 1) */
      timing: (t) => {
        let k = 0;
        for (const tc of ownHits) { const d = tc - t; if (d >= 0 && d < 0.18) k = max(k, P3.smooth(1 - d / 0.18)); else if (d < 0 && d > -0.07) k = max(k, 1 + d / 0.07); }
        return k;
      },
      /* fundido corto al reiniciar el peloteo */
      fade: (t) => min(1, t / 0.25, (DUR - t) / 0.25),
    };
  };

  /* Reloj del peloteo: avanza con el tiempo real, con pausa y velocidad ajustable. */
  P3.makeClock = function (duration) {
    const c = { t: 0, speed: 1, paused: false, last: -1, loops: 0 };
    c.tick = function (now) {
      const dt = c.last < 0 ? 0 : min(0.1, (now - c.last) / 1000);
      c.last = now;
      if (!c.paused) {
        c.t += dt * c.speed;
        if (c.t >= duration) { c.t -= duration; c.loops++; c.wrapped = true; } else c.wrapped = false;
      }
      c.dt = dt;
      return c.t;
    };
    return c;
  };

  /* Eventos que pasaron entre dos instantes (para disparar carteles y efectos una sola vez). */
  P3.crossed = function (events, t0, t1) {
    if (t1 >= t0) return events.filter((e) => e.t > t0 && e.t <= t1);
    return events.filter((e) => e.t > t0 || e.t <= t1);
  };
})(window);
