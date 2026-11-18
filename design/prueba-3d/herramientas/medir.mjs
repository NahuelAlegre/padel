// Mide las dos versiones en un Chrome sin ventana con emulación de celular (390 x 844, DPR 2).
// Uso: node herramientas/medir.mjs [medidas.json]
//
// Qué mide:
//   - peso descargado, por tipo de recurso (lo que viaja por la red, ya comprimido)
//   - tiempo hasta el primer cuadro: sin límites, con CPU 4x y con red de celular emulada
//   - trabajo de JavaScript por cuadro (media, p95, máximo), con CPU 4x, con cámara fija y con cámara que acompaña
//   - memoria: heap de JavaScript y memoria de imágenes y texturas (calculada)
// Qué NO mide: la GPU. El freno de CPU de DevTools no frena la placa de video; el rasterizado
// corre en la GPU real de esta máquina. Los números de GPU de un teléfono hay que medirlos en un teléfono.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abrirCelular, carpeta, dormir, servir } from './navegador.mjs';

const salida = process.argv[2] || join(carpeta, 'medidas.json');
const PAGINAS = [['A', 'sprites.html'], ['B', 'tiempo-real.html']];
const REDES = {
  '4G rápido': { downloadThroughput: (9e6 / 8) * 0.9, uploadThroughput: (1.5e6 / 8) * 0.9, latency: 165 },
  '4G lento': { downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9, latency: 562 },
};
const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { media: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2), n: a.length };
};
const tipo = (url) => {
  if (/fonts\.(googleapis|gstatic)/.test(url)) return 'tipografía (externa)';
  if (/assets\/cancha\//.test(url)) return 'cancha';
  if (/assets\/sprites\//.test(url)) return 'sprites';
  if (/personaje\.bin/.test(url)) return 'modelo y animaciones';
  return 'página y código';
};

async function cargar(cel, url, { cpu = 1, red = null } = {}) {
  await cel.S('Network.setCacheDisabled', { cacheDisabled: true });
  await cel.S('Emulation.setCPUThrottlingRate', { rate: cpu });
  await cel.S('Network.emulateNetworkConditions', red ? { offline: false, ...red } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cel.ir('about:blank');
  await dormir(150);
  await cel.ir(url);
  await cel.esperar('window.__p3 && window.__p3.firstFrame > 0', 60000);
  return cel.evaluar('window.__p3.firstFrame');
}

const srv = await servir();
const res = { fecha: new Date().toISOString(), equipo: 'PC de escritorio (Ryzen 7 8700G, Radeon RX 7800 XT), Chrome sin ventana', versiones: {} };
try {
  for (const [letra, pagina] of PAGINAS) {
    const cel = await abrirCelular({});
    const base = `${srv.url}${pagina}?panel=0`;
    const v = (res.versiones[letra] = { pagina });
    // --- peso ---
    await cargar(cel, base);
    await dormir(600);
    const porTipo = {};
    let total = 0;
    for (const r of cel.red) {
      if (!r.bytes || /^data:|about:/.test(r.url)) continue;
      const t = tipo(r.url);
      porTipo[t] = (porTipo[t] || 0) + r.bytes;
      total += r.bytes;
    }
    v.peso = { porTipo, total, sinTipografia: total - (porTipo['tipografía (externa)'] || 0), pedidos: cel.red.filter((r) => r.bytes).length };
    v.gpu = await cel.evaluar(`(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); if (!gl) return 'sin WebGL2'; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'desconocida'; })()`);
    // --- primer cuadro ---
    const rep = async (opts, n = 3) => { const a = []; for (let i = 0; i < n; i++) a.push(await cargar(cel, base, opts)); return Math.round(a.sort((x, y) => x - y)[Math.floor(n / 2)]); };
    v.primerCuadro = { 'sin límites': await rep({}), 'CPU 4x': await rep({ cpu: 4 }) };
    for (const [nombre, red] of Object.entries(REDES)) v.primerCuadro[nombre + ' + CPU 4x'] = await rep({ cpu: 4, red }, 1);
    // --- trabajo por cuadro ---
    v.cuadro = {};
    for (const [nombre, extra] of [['cámara fija', '&camara=fija'], ['cámara que acompaña', '&camara=sigue&reducir=0']]) {
      for (const cpu of [1, 4]) {
        await cargar(cel, base + extra, { cpu });
        await cel.evaluar('window.__p3.ui.perf.samples.length = 0, window.__t = []; (function f(t){ window.__t.push(t); requestAnimationFrame(f); })(performance.now()), 1');
        await dormir(9000);
        const m = await cel.evaluar('({ js: window.__p3.ui.perf.samples.slice(), t: window.__t.slice() })');
        const dts = m.t.slice(1).map((x, i) => x - m.t[i]);
        v.cuadro[`${nombre}, CPU ${cpu}x`] = { js: stats(m.js), intervalo: stats(dts), fps: +(1000 / (dts.reduce((a, b) => a + b, 0) / dts.length)).toFixed(1) };
      }
    }
    // --- memoria ---
    await cargar(cel, base);
    await dormir(1500);
    try { await cel.S('HeapProfiler.collectGarbage'); } catch { /* no disponible */ }
    const heap = await cel.S('Runtime.getHeapUsage');
    v.memoria = await cel.evaluar(`(() => {
      const mb = (b) => +(b / 1048576).toFixed(1);
      const imgs = performance.getEntriesByType('resource').filter((r) => /\\.webp/.test(r.name)).length;
      const c = document.getElementById('lienzo');
      const o = { lienzoMB: mb(c.width * c.height * 4), imagenes: imgs };
      const r = window.__p3.renderer;
      if (window.__p3.version === 'A') o.imagenesYHojasMB = mb(r.memory() - c.width * c.height * 4); else o.texturasYMallaMB = mb(r.memory());
      return o;
    })()`);
    v.memoria.heapJsMB = +(heap.usedSize / 1048576).toFixed(1);
    if (cel.consola.length) v.consola = cel.consola.slice(0, 6);
    await cel.cerrar();
    console.log(letra, JSON.stringify(v.peso), JSON.stringify(v.primerCuadro));
    for (const k in v.cuadro) console.log('  ', k, JSON.stringify(v.cuadro[k]));
    console.log('  memoria', JSON.stringify(v.memoria), v.gpu);
  }
  // --- tiempo de GPU por cuadro de la versión B (consulta de tiempo de WebGL2), en la GPU integrada de esta máquina.
  //     "solo capas" dibuja la cancha sin personajes: es el piso de costo que comparten las dos versiones.
  {
    const v = res.versiones.B;
    v.gpuMs = {};
    for (const dpr of [2, 3]) {
      const cel = await abrirCelular({ dpr });
      for (const [nombre, extra] of [['cámara que acompaña', '&camara=sigue&reducir=0'], ['cámara que acompaña, solo capas', '&camara=sigue&reducir=0&solo=capas'], ['cámara fija (fondo en caché)', '&camara=fija']]) {
        await cargar(cel, `${srv.url}tiempo-real.html?panel=0&gpu=1&dpr=${dpr}${extra}`);
        await dormir(6000);
        const g = await cel.evaluar('({ ok: window.__p3.renderer.gpu.ok, ms: window.__p3.renderer.gpu.ms, n: window.__p3.renderer.gpu.n })');
        v.gpuMs[`${nombre}, DPR ${dpr}`] = g.ok && g.n ? +(g.ms / g.n).toFixed(3) : null;
        console.log('B GPU', nombre, 'DPR', dpr, v.gpuMs[`${nombre}, DPR ${dpr}`], 'ms', g.n, 'muestras');
      }
      await cel.cerrar();
    }
  }
} finally {
  srv.parar();
}
writeFileSync(salida, JSON.stringify(res, null, 2));
console.log('guardado', salida);
