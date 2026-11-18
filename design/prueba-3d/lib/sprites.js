/* Prueba 3D · versión A: todo en Canvas 2D.
   - Cancha: las mismas capas horneadas, dibujadas como imágenes. La cámara que acompaña se imita
     con un paneo, un zoom y una inclinación (shear) del plano del piso; el fondo y el cielo se
     corren menos, y eso da el parallax.
   - Personajes: cuadros prerrenderizados en Blender, elegidos por clip y tiempo.
   - Sombra: la silueta del mismo cuadro, volcada sobre el piso hacia donde cae la luz. */
(function (g) {
  'use strict';
  const P3 = (g.P3 = g.P3 || {});
  const { sin, cos, atan, PI, min, max, floor, hypot } = Math;

  P3.makeSpriteRenderer = function (canvas, court, sprites, sheets) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const ref = P3.makeCamera(P3.REF);
    const H = ref.pos[2], S = sin((P3.REF.pitch * PI) / 180), C = cos((P3.REF.pitch * PI) / 180), F = ref.f;
    const D0 = (H * F) / (F * S);                 /* profundidad en el centro del cuadro */
    const SEAM = -124;                            /* altura (px de diseño) de la línea del cerco: arriba, fondo; abajo, piso */
    const R = { ctx, canvas };
    let lay = null, dpr = 1;
    const sunX = -P3.SUN[0] / P3.SUN[2], sunY = P3.SUN[1] / P3.SUN[2];   /* corrimiento de la sombra por metro de altura: a la derecha y hacia la cámara */

    /* hojas de sombra: la silueta de cada hoja, a media resolución y en el color de la sombra */
    const shadowSheets = {};
    for (const name in sheets) {
      const im = sheets[name];
      const c = document.createElement('canvas');
      c.width = Math.ceil(im.naturalWidth / 2);
      c.height = Math.ceil(im.naturalHeight / 2);
      const x = c.getContext('2d');
      x.drawImage(im, 0, 0, c.width, c.height);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = 'rgb(' + P3.SHADOW_RGB.map((v) => Math.round(v * 255)).join(',') + ')';
      x.fillRect(0, 0, c.width, c.height);
      shadowSheets[name] = c;
    }
    R.memory = () => {
      let px = canvas.width * canvas.height;
      for (const n in sheets) px += sheets[n].naturalWidth * sheets[n].naturalHeight + shadowSheets[n].width * shadowSheets[n].height;
      for (const l of court.layers) px += l.image.naturalWidth * l.image.naturalHeight;
      return px * 4;
    };

    R.resize = function (l, d) {
      lay = l; dpr = d;
      const w = Math.round(l.colW * d), h = Math.round(l.vh * d);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      canvas.style.width = l.colW + 'px';
      canvas.style.height = l.vh + 'px';
      canvas.style.left = l.colX + 'px';
    };

    /* cámara 2D del cuadro actual */
    const cam = { A: 0, B: 0, Z: 1, rot: 0, zoomK: 1, zx: 0, zy: 0 };
    function setCamera(follow, closeK, focus) {
      const dx = follow.x, rot = (-F * (follow.aim - dx)) / 28;
      cam.rot = rot;
      cam.A = rot - (F * dx * S) / H;
      cam.B = (-dx * C) / H;
      cam.Z = D0 / (D0 - follow.dolly);
      cam.dx = dx;
      cam.dolly = follow.dolly;
      cam.zoomK = 1 + closeK * 2.4;                /* «ver de cerca»: zoom 2D sobre el jugador */
      cam.zx = focus ? focus.x : 0;
      cam.zy = focus ? focus.y : 0;
    }
    /* px de diseño → px del lienzo */
    const X = (dx) => (lay.ox - lay.colX + dx * lay.s) * dpr;
    const Y = (dy) => (lay.oy + dy * lay.s) * dpr;
    function close(px, py) {                        /* zoom alrededor del foco, en px de diseño */
      return [cam.zx + (px - cam.zx) * cam.zoomK, cam.zy + (py - cam.zy) * cam.zoomK];
    }
    const tmpG = {}, tmpH = {};
    /** Punto del mundo → px de diseño, con la cámara 2D aplicada. Devuelve también px por metro. */
    function place(x, y, z, out) {
      ref.project(x, y, 0, tmpG);
      let px = cam.Z * (tmpG.x + cam.A + cam.B * tmpG.y), py = cam.Z * tmpG.y;
      if (z) { ref.project(x, y, z, tmpH); px += cam.Z * (tmpH.x - tmpG.x); py += cam.Z * (tmpH.y - tmpG.y); }
      const p = close(px, py);
      out.x = p[0]; out.y = p[1];
      out.ppm = (F / tmpG.d) * cam.Z * cam.zoomK;
      out.elev = (P3.REF.pitch * PI) / 180 + atan(tmpG.y / F);
      out.d = tmpG.d;
      return out;
    }
    R.place = place;
    R.toCss = (o) => ({ x: lay.ox + o.x * lay.s, y: lay.oy + o.y * lay.s });

    /* transformación del lienzo para dibujar en px de diseño con: escala, corrimiento y shear */
    function setT(zoom, shiftX, shear, shearY0) {
      const k = lay.s * dpr * cam.zoomK;
      /* x' = zoom·(x + shiftX + shear·(y − y0)), y' = zoom·y ; después el zoom de «ver de cerca» */
      const e = X(cam.zx) + (zoom * (shiftX - shear * shearY0) - cam.zx) * k;
      const f = Y(cam.zy) - cam.zy * k;
      ctx.setTransform(zoom * k, 0, zoom * shear * k, zoom * k, e, f);
    }
    function layer(name, alpha) {
      const l = court.byName[name];
      if (!l) return;
      if (alpha !== undefined) ctx.globalAlpha = alpha;
      ctx.drawImage(l.image, l.dx, l.dy, l.dw, l.dh);
      if (alpha !== undefined) ctx.globalAlpha = 1;
    }
    /* Con la cámara quieta, el fondo (cielo, piso, entorno y paredes) se compone una vez y se reutiliza. */
    const bg = { canvas: document.createElement('canvas'), key: '', last: '', still: 0 };
    R.cached = () => bg.key !== '';
    function drawBackground() {
      const key = [cam.A, cam.B, cam.Z, cam.rot, cam.zoomK, cam.zx, cam.zy, canvas.width, canvas.height].join();
      if (key === bg.key) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(bg.canvas, 0, 0); return; }
      bg.still = key === bg.last ? bg.still + 1 : 0;
      bg.last = key;
      bg.key = '';
      drawBackgroundNow();
      if (bg.still >= 2) {
        if (bg.canvas.width !== canvas.width || bg.canvas.height !== canvas.height) { bg.canvas.width = canvas.width; bg.canvas.height = canvas.height; }
        bg.canvas.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0);
        bg.key = key;
      }
    }
    function drawBackgroundNow() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#291f34';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      /* cielo: solo gira con la cámara */
      setT(1, cam.rot, 0, 0);
      layer('cielo');
      /* piso */
      setT(cam.Z, cam.A, cam.B, 0);
      layer('piso');
      /* entorno: debajo de la línea del cerco va pegado al piso; arriba se corre entero, sin inclinarse */
      const e = court.byName.entorno;
      const seamSrc = (SEAM - e.dy) / e.dh;          /* fracción de la imagen donde cae la costura */
      const ih = e.image.naturalHeight, iw = e.image.naturalWidth;
      /* la parte de arriba se corre lo mismo que el piso en la costura, así no hay salto entre las dos */
      setT(cam.Z, cam.A + cam.B * SEAM, 0, 0);
      ctx.drawImage(e.image, 0, 0, iw, Math.ceil(ih * seamSrc) + 1, e.dx, e.dy, e.dw, e.dh * seamSrc + e.dh / ih);
      setT(cam.Z, cam.A, cam.B, 0);
      const sy0 = Math.floor(ih * seamSrc);
      ctx.drawImage(e.image, 0, sy0, iw, ih - sy0, e.dx, e.dy + (e.dh * sy0) / ih, e.dw, (e.dh * (ih - sy0)) / ih);
      layer('paredes');
    }

    function frameOf(view, clip, time) {
      const c = sprites.views[view].clips[clip];
      if (!c) return null;
      const n = c.frames.length;
      /* bucles: el cuadro que corresponde; golpes: el más cercano en el tiempo (hay uno justo en el impacto) */
      let i = c.loop ? floor(time * c.fps + 1e-4) : Math.round((time - c.t0) * c.fps);
      i = c.loop ? ((i % n) + n) % n : P3.clamp(i, 0, n - 1);
      return c.frames[i];
    }
    const pos = {};
    function drawChar(c) {
      const v = sprites.views[c.view], fr = frameOf(c.view, c.clip, c.time);
      if (!fr) return;
      place(c.x, c.y, 0, pos);
      const sc = (c.k * pos.ppm) / v.ppm;            /* px de diseño por px de sprite */
      const es = (v.elev * PI) / 180;
      /* sombra: la silueta volcada hacia donde cae la luz (derecha y hacia la cámara) */
      const kx = sunX / cos(es), ky = (sunY * sin(pos.elev)) / cos(es);
      const k = lay.s * dpr;
      ctx.setTransform(sc * k, 0, -sc * kx * k, -sc * ky * k, X(pos.x), Y(pos.y));
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(shadowSheets[c.view], fr[0] / 2, fr[1] / 2, fr[2] / 2, fr[3] / 2, -fr[4], -fr[5], fr[2], fr[3]);
      ctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(sc * k, 0, 0, sc * k, X(pos.x), Y(pos.y));
      ctx.drawImage(sheets[c.view], fr[0], fr[1], fr[2], fr[3], -fr[4], -fr[5], fr[2], fr[3]);
    }

    const bp = {}, gp = {};
    function drawBall(ball) {
      if (!ball.visible) return;
      place(ball.x, ball.y, ball.z, bp);
      place(ball.x, ball.y, 0, gp);
      const k = lay.s * dpr;
      const r = max(0.085 * bp.ppm, 3.3 * cam.zoomK);
      ctx.setTransform(k, 0, 0, k, X(0), Y(0));
      /* sombra debajo: marca la altura */
      const sh = r * (1.5 + ball.z * 0.10), a = P3.clamp(0.85 - ball.z * 0.11, 0.25, 0.85);
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgb(107,102,168)';
      ctx.beginPath();
      ctx.ellipse(gp.x, gp.y, sh * 0.82, sh * 0.82 * sin(gp.elev), 0, 0, 2 * PI);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      /* estela */
      for (let i = ball.trail.length - 1; i >= 0; i--) {
        const p = ball.trail[i], kk = 1 - (i + 1) / (ball.trail.length + 1);
        place(p[0], p[1], p[2], tmpT);
        ctx.globalAlpha = 0.3 * kk;
        ctx.fillStyle = '#f2ff99';
        ctx.beginPath(); ctx.arc(tmpT.x, tmpT.y, r * kk, 0, 2 * PI); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#4d5c14';
      ctx.beginPath(); ctx.arc(bp.x, bp.y, r, 0, 2 * PI); ctx.fill();
      ctx.fillStyle = '#a6bf2b';
      ctx.beginPath(); ctx.arc(bp.x, bp.y, r * 0.8, 0, 2 * PI); ctx.fill();
      ctx.fillStyle = '#eaf64a';
      ctx.beginPath(); ctx.arc(bp.x - r * 0.1, bp.y - r * 0.12, r * 0.66, 0, 2 * PI); ctx.fill();
      ctx.fillStyle = '#fdffd9';
      ctx.beginPath(); ctx.arc(bp.x - r * 0.26, bp.y - r * 0.3, r * 0.26, 0, 2 * PI); ctx.fill();
    }
    const tmpT = {}, rp = {};
    function drawRing(e, age) {
      const kk = age / 0.32, a = (1 - kk) * (1 - kk);
      place(e.pos[0], e.pos[1], e.pos[2], rp);
      const k = lay.s * dpr;
      ctx.setTransform(k, 0, 0, k, X(0), Y(0));
      ctx.globalAlpha = a * 0.85;
      ctx.strokeStyle = '#fff5d6';
      ctx.beginPath();
      if (e.type === 'pique') { const r = (0.18 + 0.55 * kk) * rp.ppm; ctx.lineWidth = r * 0.2; ctx.ellipse(rp.x, rp.y, r, r * sin(rp.elev), 0, 0, 2 * PI); } else {
        const r = (0.2 + 0.65 * kk) * rp.ppm; ctx.lineWidth = r * 0.18;
        if (e.type === 'vidrio') ctx.ellipse(rp.x, rp.y, r, r * cos(rp.elev), 0, 0, 2 * PI); else ctx.arc(rp.x, rp.y, r, 0, 2 * PI);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    R.draw = function (frame) {
      const { follow, chars, ball, rings, fade, nearAlpha, closeK, focus } = frame;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      setCamera(follow, 0, null);
      if (closeK > 0 && focus) { place(focus.x, focus.y, 0.9 * focus.k, pos); setCamera(follow, closeK, { x: pos.x, y: pos.y }); }
      drawBackground();
      const far = chars.filter((c) => c.y > 0), near = chars.filter((c) => c.y <= 0);
      const side = (list, ballHere) => {
        const items = list.map((c) => ({ y: c.y, c }));
        if (ballHere) items.push({ y: ball.y, ball: true });
        items.sort((a, b) => b.y - a.y);
        for (const it of items) { if (it.ball) drawBall(ball); else if (fade > 0.02) drawChar(it.c); }
      };
      for (const r of rings) if (r.e.pos[1] > 0) drawRing(r.e, r.age);
      side(far, ball.y > 0);
      setT(cam.Z, cam.A, cam.B, 0);
      layer('red');
      for (const r of rings) if (r.e.pos[1] <= 0) drawRing(r.e, r.age);
      side(near, ball.y <= 0);
      setT(cam.Z, cam.A, cam.B, 0);
      layer('cerca', nearAlpha);
      layer('frente');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    return R;
  };
})(window);
