/* Prueba 3D · versión B: renderer WebGL2 crudo, sin librerías.
   - Cancha: las capas horneadas se proyectan desde la cámara de referencia sobre planos del mundo
     (piso, paredes, red...). Con la cámara quieta se ve idéntica al render; si la cámara se mueve
     un poco, cada plano se desplaza con la perspectiva que le toca.
   - Personajes: los dibuja lib/personaje.js (malla con esqueleto, toon de tres tonos, contorno de
     tinta y sombra proyectada en el piso con la forma de la pose). */
(function (g) {
  'use strict';
  const P3 = (g.P3 = g.P3 || {});
  const { sin, cos, PI, min, max, sqrt, floor } = Math;

  const program = P3.program;

  /* matriz vista-proyección (por columnas) de una cámara de P3 y un encuadre de P3.layout */
  P3.viewProj = function (cam, lay, out) {
    const R = cam.right, U = cam.up, F = cam.fwd, C = cam.pos;
    const N = 1, FAR = 400;
    const kx = (2 * cam.f) / 390, kyy = (2 * cam.f) / lay.visH, ky = 1 - (2 * lay.oy) / lay.vh;
    const A = (FAR + N) / (FAR - N), B = (-2 * FAR * N) / (FAR - N);
    const tr = -(R[0] * C[0] + R[1] * C[1] + R[2] * C[2]);
    const tu = -(U[0] * C[0] + U[1] * C[1] + U[2] * C[2]);
    const tf = -(F[0] * C[0] + F[1] * C[1] + F[2] * C[2]);
    const m = out || new Float32Array(16);
    for (let c = 0; c < 3; c++) {
      m[c * 4 + 0] = kx * R[c];
      m[c * 4 + 1] = kyy * U[c] + ky * F[c];
      m[c * 4 + 2] = A * F[c];
      m[c * 4 + 3] = F[c];
    }
    m[12] = kx * tr; m[13] = kyy * tu + ky * tf; m[14] = A * tf + B; m[15] = tf;
    return m;
  };

  const LAYER_VS = `#version 300 es
  in vec3 aPos; uniform mat4 uVP; out vec3 vW;
  void main() { vW = aPos; gl_Position = uVP * vec4(aPos, 1.0); }`;
  const LAYER_FS = `#version 300 es
  precision highp float;
  in vec3 vW; out vec4 o;
  uniform sampler2D uTex; uniform vec3 uPos, uR, uU, uF; uniform float uFocal, uAlpha; uniform vec4 uRect;
  void main() {
    vec3 d = vW - uPos;
    float depth = dot(d, uF);
    if (depth < 0.5) discard;
    vec2 s = vec2(dot(d, uR), -dot(d, uU)) * (uFocal / depth);
    vec2 uv = (s - uRect.xy) / uRect.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
    o = texture(uTex, uv) * uAlpha;
  }`;
  const SCREEN_VS = `#version 300 es
  in vec2 aPos; in vec2 aUV; out vec2 vUV;
  void main() { vUV = aUV; gl_Position = vec4(aPos, 0.999, 1.0); }`;
  const SCREEN_FS = `#version 300 es
  precision highp float;
  in vec2 vUV; out vec4 o; uniform sampler2D uTex;
  void main() { o = texture(uTex, vUV); }`;

  /* Pelota, su sombra y los anillos de efecto: un cuadrado con forma dada por el fragment shader. */
  const FX_VS = `#version 300 es
  precision highp float;
  in vec2 aPos; uniform mat4 uVP; uniform vec3 uC, uAx, uAy; out vec2 vP;
  void main() { vP = aPos; gl_Position = uVP * vec4(uC + uAx * aPos.x + uAy * aPos.y, 1.0); }`;
  const FX_FS = `#version 300 es
  precision highp float; precision highp int;
  in vec2 vP; out vec4 o; uniform int uKind; uniform vec4 uCol; uniform float uA, uB;
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
    } else if (uKind == 1) {          /* sombra elíptica suave (se multiplica) */
      float a = smoothstep(1.0, 0.45, r) * uA;
      o = vec4(mix(vec3(1.0), uCol.rgb, a), 1.0);
    } else if (uKind == 2) {          /* mancha suave de luz, aditiva: polvo, reflejo, brillo de la pelota */
      float a = smoothstep(1.0, 0.0, r);
      a *= a * uA;
      o = vec4(uCol.rgb * a, 0.0);
    } else if (uKind == 3) {          /* marca: anillo fino con un punto al centro */
      float ring = smoothstep(1.0, 0.94, r) * smoothstep(1.0 - uB - 0.06, 1.0 - uB, r);
      if (r > 1.0) ring = 0.0;
      float a = max(ring, smoothstep(0.26, 0.18, r)) * uA;
      o = vec4(uCol.rgb * a, a);
    } else {                          /* destello de cuatro puntas, aditivo */
      vec2 q = abs(vP);
      float star = max(0.0, 1.0 - (q.x * 9.0 + q.y * 0.9)) + max(0.0, 1.0 - (q.y * 9.0 + q.x * 0.9));
      float a = clamp(star, 0.0, 1.0) * smoothstep(1.0, 0.2, r) * uA;
      o = vec4(uCol.rgb * a, 0.0);
    }
  }`;

  /* ---------- renderer ---------- */
  P3.makeRenderer = function (canvas, court, chData) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, stencil: true, depth: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('Este navegador no tiene WebGL2.');
    const R = { gl, canvas, lost: false };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); R.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { g.location.reload(); });

    const pLayer = program(gl, LAYER_VS, LAYER_FS), pScreen = program(gl, SCREEN_VS, SCREEN_FS);
    const pFx = program(gl, FX_VS, FX_FS);
    const charGL = P3.makeCharacterGL(gl, chData);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    /* texturas de las capas */
    const tex = {};
    for (const l of court.layers) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, l.image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      tex[l.name] = t;
    }

    /* planos sobre los que se proyecta cada capa: cuatro vértices por plano */
    const Q = (a, b, c, d) => [a, b, c, a, c, d].flat();
    const PROXY = {
      piso: Q([-90, -70, 0], [90, -70, 0], [90, 60, 0], [-90, 60, 0]),
      /* entorno: una «U» de paredes (fondo y costados) más el piso de adentro, para lo que está apoyado
         en la vereda (bancos, macetas). Cada rayo de la cámara de referencia toca uno solo de los cuatro. */
      entorno: [].concat(
        Q([-9.5, 17.3, 0], [9.5, 17.3, 0], [9.5, 17.3, 60], [-9.5, 17.3, 60]),
        Q([-9.5, -60, 0], [-9.5, 17.3, 0], [-9.5, 17.3, 60], [-9.5, -60, 60]),
        Q([9.5, 17.3, 0], [9.5, -60, 0], [9.5, -60, 60], [9.5, 17.3, 60]),
        Q([-9.5, -60, 0], [9.5, -60, 0], [9.5, 17.3, 0], [-9.5, 17.3, 0])),
      paredes: [].concat(
        Q([-5.04, 10, -0.1], [5.04, 10, -0.1], [5.04, 10, 4.2], [-5.04, 10, 4.2]),
        Q([-5, -10.04, -0.1], [-5, 10, -0.1], [-5, 10, 4.2], [-5, -10.04, 4.2]),
        Q([5, 10, -0.1], [5, -10.04, -0.1], [5, -10.04, 4.2], [5, 10, 4.2])),
      red: Q([-5.2, 0, -0.05], [5.2, 0, -0.05], [5.2, 0, 1.15], [-5.2, 0, 1.15]),
      cerca: Q([-5.1, -10, -0.1], [5.1, -10, -0.1], [5.1, -10, 3.2], [-5.1, -10, 3.2]),
      frente: Q([-9, -12.6, -0.3], [9, -12.6, -0.3], [9, -12.6, 2.2], [-9, -12.6, 2.2]),
    };
    const proxy = {};
    for (const k in PROXY) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(PROXY[k]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pLayer.p, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      proxy[k] = { vao, n: PROXY[k].length / 3 };
    }
    /* cielo: un cuadrado en pantalla que se actualiza con el encuadre */
    const skyVao = gl.createVertexArray(), skyBuf = gl.createBuffer();
    gl.bindVertexArray(skyVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 24 * 4, gl.DYNAMIC_DRAW);
    for (const [name, off] of [['aPos', 0], ['aUV', 8]]) {
      const loc = gl.getAttribLocation(pScreen.p, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 16, off);
    }
    /* cuadrado unitario para pelota y efectos */
    const fxVao = gl.createVertexArray(), fxBuf = gl.createBuffer();
    gl.bindVertexArray(fxVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, fxBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    { const loc = gl.getAttribLocation(pFx.p, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); }

    const vp = new Float32Array(16);
    const ref = P3.makeCamera(P3.REF);
    const M = chData.meta.mesh;
    R.triangles = charGL.triangles() | 0;
    R.vertices = M.nv;
    R.character = charGL;

    R.resize = function (lay, dpr) {
      const w = Math.round(lay.colW * dpr), h = Math.round(lay.vh * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      canvas.style.width = lay.colW + 'px';
      canvas.style.height = lay.vh + 'px';
      canvas.style.left = lay.colX + 'px';
      R.dpr = dpr;
    };

    function drawLayer(name, alpha) {
      const l = court.byName[name];
      if (!l) return;
      gl.useProgram(pLayer.p);
      gl.uniformMatrix4fv(pLayer.u.uVP, false, vp);
      gl.uniform3fv(pLayer.u.uPos, ref.pos);
      gl.uniform3fv(pLayer.u.uR, ref.right);
      gl.uniform3fv(pLayer.u.uU, ref.up);
      gl.uniform3fv(pLayer.u.uF, ref.fwd);
      gl.uniform1f(pLayer.u.uFocal, ref.f);
      gl.uniform1f(pLayer.u.uAlpha, alpha === undefined ? 1 : alpha);
      gl.uniform4f(pLayer.u.uRect, l.dx, l.dy, l.dw, l.dh);
      gl.bindTexture(gl.TEXTURE_2D, tex[name]);
      gl.bindVertexArray(proxy[name].vao);
      gl.drawArrays(gl.TRIANGLES, 0, proxy[name].n);
    }

    function drawSky(lay, shiftX) {
      const l = court.byName.cielo;
      const x0 = (l.dx + shiftX) / 195, x1 = (l.dx + l.dw + shiftX) / 195;
      const ny = (dy) => 1 - (2 * (lay.oy + dy * lay.s)) / lay.vh;
      const y0 = ny(l.dy), y1 = ny(l.dy + l.dh);
      gl.useProgram(pScreen.p);
      gl.bindVertexArray(skyVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([x0, y1, 0, 1, x1, y1, 1, 1, x1, y0, 1, 0, x0, y1, 0, 1, x1, y0, 1, 0, x0, y0, 0, 0]));
      gl.bindTexture(gl.TEXTURE_2D, tex.cielo);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    const env = { vp, eye: null, viewport: [1, 1], outlinePx: 1, shadow: P3.SHADOW_RGB };
    function drawCharacter(c, cam, lay) {
      const ppm = (cam.f * lay.s * R.dpr) / c.depth;        /* px del dispositivo por metro */
      env.eye = cam.pos;
      env.viewport[0] = canvas.width; env.viewport[1] = canvas.height;
      /* tinta de 1,9 cm del personaje, igual que en los sprites, pero nunca más fina que ~0,6 px CSS */
      env.outlinePx = P3.clamp(0.019 * c.k * ppm, 0.62 * R.dpr, 2.3 * R.dpr);
      charGL.draw(c, env);
    }

    function fx(kind, c, ax, ay, col, a, b, multiply) {
      const u = pFx.u;
      gl.useProgram(pFx.p);
      gl.bindVertexArray(fxVao);
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform3fv(u.uC, c);
      gl.uniform3fv(u.uAx, ax);
      gl.uniform3fv(u.uAy, ay);
      gl.uniform1i(u.uKind, kind);
      gl.uniform4fv(u.uCol, col);
      gl.uniform1f(u.uA, a);
      gl.uniform1f(u.uB, b);
      if (multiply) gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (multiply) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    function drawBall(ball, cam, lay) {
      if (!ball.visible) return;
      const tmp = {};
      cam.project(ball.x, ball.y, ball.z, tmp);
      const ppm = (cam.f * lay.s) / tmp.d;                      /* px CSS por metro */
      const r = max(0.085, 3.3 / ppm);                          /* nunca menos de 3,3 px de radio */
      /* sombra: justo debajo, más chica y más tenue cuanto más alta va la pelota */
      const h = ball.z, sh = r * (1.5 + h * 0.10);
      fx(1, [ball.x, ball.y, 0.014], [sh, 0, 0], [0, sh, 0], [0.42, 0.40, 0.66, 1], P3.clamp(0.85 - h * 0.11, 0.25, 0.85), 0, true);
      /* estela corta */
      for (let i = ball.trail.length - 1; i >= 0; i--) {
        const p = ball.trail[i], k = 1 - (i + 1) / (ball.trail.length + 1);
        fx(2, p, [cam.right[0] * r * k, cam.right[1] * r * k, 0], [cam.up[0] * r * k, cam.up[1] * r * k, cam.up[2] * r * k], [0.95, 1.0, 0.6, 1], 0.5 * k, 1.0, false);
      }

      fx(0, [ball.x, ball.y, ball.z], [cam.right[0] * r, cam.right[1] * r, 0], [cam.up[0] * r, cam.up[1] * r, cam.up[2] * r], [1, 1, 1, 1], 1, 0, false);
    }

    /* Efectos de impacto: chicos y cortos, sin anillos. Un destello en el golpe, un poco de polvo
       en el pique y un reflejo en el vidrio. */
    function drawFx(e, age, cam) {
      const col = [1.0, 0.96, 0.84, 1];
      if (e.type === 'golpe') {
        const u = age / P3.FX.golpe, r = 0.30 + 0.22 * u;
        fx(4, e.pos, [cam.right[0] * r, cam.right[1] * r, 0], [cam.up[0] * r, cam.up[1] * r, cam.up[2] * r], col, 0.95 * (1 - u) * (1 - u), 0, false);
      } else if (e.type === 'pique') {
        const u = age / P3.FX.pique, r = 0.14 + 0.30 * u;
        fx(2, [e.pos[0], e.pos[1], 0.02], [r, 0, 0], [0, r, 0], col, 0.5 * (1 - u), 0, false);
      } else if (e.type === 'vidrio') {
        const u = age / P3.FX.vidrio;
        fx(2, e.pos, [0.4 + 0.3 * u, 0, 0], [0, 0, 0.55 + 0.3 * u], col, 0.6 * (1 - u), 0, false);
      }
    }
    /* Señal de timing: la pelota y la pala se encienden en el último instante antes del golpe propio.
       Va por encima del personaje, porque en el impacto la pala tapa la pelota. */
    function drawTiming(ball, cam, lay) {
      if (!(ball.timing > 0) || !ball.visible) return;
      const tmp = {};
      cam.project(ball.x, ball.y, ball.z, tmp);
      const g = max(0.085, 3.3 / ((cam.f * lay.s) / tmp.d)) * (2.0 + 1.2 * ball.timing);
      fx(2, [ball.x, ball.y, ball.z], [cam.right[0] * g, cam.right[1] * g, 0], [cam.up[0] * g, cam.up[1] * g, cam.up[2] * g], [1.0, 0.98, 0.8, 1], 0.6 * ball.timing, 0, false);
    }
    /* Marca de pique: un anillo fino y chico con un punto, apoyado en el piso. */
    function drawMark(m, col, strong) {
      const r = 0.26 - 0.05 * m.k;
      fx(3, [m.x, m.y, 0.02], [r, 0, 0], [0, r, 0], col, P3.smooth(m.k * 6) * (strong ? 0.9 : 0.8), 0.16, false);
    }

    /* memoria de video de las texturas (con sus mipmaps) y de la malla */
    R.memory = () => {
      let b = 0;
      for (const l of court.layers) b += l.image.naturalWidth * l.image.naturalHeight * 4 * 1.333;
      return b + M.nv * 16 + (M.nt || M.ni) * 2;
    };
    /* tiempo de GPU por cuadro, si el navegador lo deja medir (solo con ?gpu=1) */
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    R.gpu = { ms: 0, n: 0, ok: !!timer };
    let pending = null, started = null;

    const bg = { tex: gl.createTexture(), fbo: gl.createFramebuffer(), key: '', last: '', still: 0, w: 0, h: 0 };
    gl.bindTexture(gl.TEXTURE_2D, bg.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bg.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bg.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const blitData = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, 1, 1, 1, 1, -1, -1, 0, 0, 1, 1, 1, 1, -1, 1, 0, 1]);
    function blitBackground() {
      gl.useProgram(pScreen.p);
      gl.bindVertexArray(skyVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, blitData);
      gl.bindTexture(gl.TEXTURE_2D, bg.tex);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.BLEND);
    }
    R.cached = () => bg.key !== '';

    /* un cuadro completo */
    R.draw = function (frame) {
      const { cam, lay, chars, ball, fade, skyShift, nearAlpha, mark, aim } = frame;
      const fxList = frame.fx;
      if (timer && R.measureGpu) {
        if (pending && gl.getQueryParameter(pending, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) { R.gpu.ms += gl.getQueryParameter(pending, gl.QUERY_RESULT) / 1e6; R.gpu.n++; }
          gl.deleteQuery(pending);
          pending = null;
        }
        if (!pending) { started = gl.createQuery(); gl.beginQuery(timer.TIME_ELAPSED_EXT, started); }
      }
      P3.viewProj(cam, lay, vp);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.STENCIL_TEST);
      gl.clearColor(0.16, 0.12, 0.2, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      /* Con la cámara quieta, el fondo se dibuja una vez a una textura y después se copia. */
      const key = [cam.pos[0], cam.pos[1], cam.pos[2], cam.fwd[0], cam.fwd[1], skyShift, canvas.width, canvas.height, lay.oy].join();
      if (key === bg.key) blitBackground();
      else {
        bg.still = key === bg.last ? bg.still + 1 : 0;
        bg.last = key;
        bg.key = '';
        const bake = bg.still >= 2;
        if (bake) {
          if (bg.w !== canvas.width || bg.h !== canvas.height) {
            bg.w = canvas.width; bg.h = canvas.height;
            gl.bindTexture(gl.TEXTURE_2D, bg.tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, bg.w, bg.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, bg.fbo);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        drawSky(lay, skyShift);
        drawLayer('piso');
        drawLayer('entorno');
        drawLayer('paredes');
        if (bake) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); bg.key = key; blitBackground(); }
      }
      const far = chars.filter((c) => c.y > 0), near = chars.filter((c) => c.y <= 0);
      const side = (list, ballHere) => {
        /* de más lejos a más cerca, con la pelota intercalada */
        const items = list.map((c) => ({ y: c.y, c }));
        if (ballHere) items.push({ y: ball.y, ball: true });
        items.sort((a, b) => b.y - a.y);
        for (const it of items) { if (it.ball) drawBall(ball, cam, lay); else if (fade > 0.02 && !frame.skipChars) drawCharacter(it.c, cam, lay); }
      };
      if (aim) drawMark(aim, [1.0, 0.416, 0.302, 1], true);
      for (const r of fxList) if (r.e.pos[1] > 0 && r.e.type !== 'golpe') drawFx(r.e, r.age, cam);
      side(far, ball.y > 0);
      for (const r of fxList) if (r.e.pos[1] > 0 && r.e.type === 'golpe') drawFx(r.e, r.age, cam);
      drawLayer('red');
      if (mark) drawMark(mark, [1.0, 0.96, 0.84, 1], false);
      for (const r of fxList) if (r.e.pos[1] <= 0 && r.e.type !== 'golpe') drawFx(r.e, r.age, cam);
      side(near, ball.y <= 0);
      for (const r of fxList) if (r.e.pos[1] <= 0 && r.e.type === 'golpe') drawFx(r.e, r.age, cam);
      drawTiming(ball, cam, lay);
      drawLayer('cerca', nearAlpha);
      drawLayer('frente');
      if (started) { gl.endQuery(timer.TIME_ELAPSED_EXT); pending = started; started = null; }
    };
    R.projectCss = function (cam, lay, x, y, z) {
      const o = cam.project(x, y, z, {});
      return { x: lay.ox + o.x * lay.s, y: lay.oy + o.y * lay.s, d: o.d };
    };
    return R;
  };
})(window);
