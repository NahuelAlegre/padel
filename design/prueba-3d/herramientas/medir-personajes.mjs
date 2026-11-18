// Mide la página de revisión de personajes en un Chrome sin ventana con emulación de celular
// (390 x 844, DPR 2) y, en particular, cuánto cuestan las caras.
// Uso: node herramientas/medir-personajes.mjs [medidas-personajes.json]
//
//   - peso descargado de la página
//   - tiempo hasta el primer cuadro, sin límites y con CPU 4x
//   - trabajo de JavaScript por cuadro con CPU 4x: un personaje, con y sin caras; y los 24 clips a la vez
//   - costo de actualizar la cara: microsegundos por actualización (mezcla en la CPU + subida de 780 bytes)
//   - tiempo de GPU por cuadro (consulta de tiempo de WebGL2) en la GPU de esta máquina
// La GPU de un teléfono no se emula: esos números hay que medirlos en un teléfono.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abrirCelular, carpeta, dormir, servir } from './navegador.mjs';

const salida = process.argv[2] || join(carpeta, 'medidas-personajes.json');
const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { media: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3), p50: +q(0.5).toFixed(3), p95: +q(0.95).toFixed(3), max: +s[s.length - 1].toFixed(2), n: a.length };
};
async function cargar(cel, url, cpu = 1) {
  await cel.S('Network.setCacheDisabled', { cacheDisabled: true });
  await cel.S('Emulation.setCPUThrottlingRate', { rate: cpu });
  await cel.ir('about:blank');
  await dormir(150);
  await cel.ir(url);
  await cel.esperar('window.__p3 && window.__p3.firstFrame > 0', 60000);
  return cel.evaluar('window.__p3.firstFrame');
}

const srv = await servir();
const res = { fecha: new Date().toISOString(), equipo: 'PC de escritorio (Ryzen 7 8700G), Chrome sin ventana, celular emulado de 390 x 844 a DPR 2' };
const cel = await abrirCelular({});
try {
  const base = `${srv.url}personajes.html`;
  await cargar(cel, base + '?clip=derecha');
  await dormir(500);
  const porTipo = {};
  let total = 0;
  for (const r of cel.red) {
    if (!r.bytes || /^data:|about:/.test(r.url)) continue;
    const t = /fonts\.(googleapis|gstatic)/.test(r.url) ? 'tipografía (externa)' : /personaje\.bin/.test(r.url) ? 'modelo, caras y animaciones' : 'página y código';
    porTipo[t] = (porTipo[t] || 0) + r.bytes;
    total += r.bytes;
  }
  res.peso = { porTipo, total, sinTipografia: total - (porTipo['tipografía (externa)'] || 0) };
  res.gpu = await cel.evaluar(`(() => { const gl = window.__p3.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'desconocida'; })()`);
  const rep = async (cpu) => { const a = []; for (let i = 0; i < 3; i++) a.push(await cargar(cel, base + '?clip=derecha', cpu)); return Math.round(a.sort((x, y) => x - y)[1]); };
  res.primerCuadro = { 'sin límites': await rep(1), 'CPU 4x': await rep(4) };

  // trabajo por cuadro, CPU 4x
  res.cuadro = {};
  for (const [nombre, consulta] of [['un personaje, con caras', 'clip=derecha&personaje=romina'], ['un personaje, sin caras', 'clip=derecha&personaje=romina&cara=no'],
    ['los 24 clips a la vez, con caras', 'todos=1&personaje=romina'], ['los 24 clips a la vez, sin caras', 'todos=1&personaje=romina&cara=no']]) {
    await cargar(cel, `${base}?${consulta}`, 4);
    await dormir(800);
    await cel.evaluar('window.__p3.stats.samples.length = 0, window.__p3.charGL.faceUpdates = 0, 1');
    await dormir(7000);
    const m = await cel.evaluar('({ js: window.__p3.stats.samples.slice(), caras: window.__p3.charGL.faceUpdates })');
    res.cuadro[nombre] = { js: stats(m.js), actualizacionesDeCaraPorCuadro: +(m.caras / m.js.length).toFixed(2) };
    console.log(nombre, JSON.stringify(res.cuadro[nombre]));
  }

  // costo de una actualización de cara: se fuerzan 4000 con pesos distintos y se mide el total
  await cargar(cel, `${base}?clip=listo&cara=no`, 1);
  await dormir(500);
  res.cara = await cel.evaluar(`(() => {
    const p3 = window.__p3, gl = p3.gl, ch = p3.character, a = p3.single, N = 4000;
    const w = new Float32Array(ch.morph.names.length), env = { vp: new Float32Array(16), eye: [0, -5, 2], viewport: [8, 8], outlinePx: 1, shadow: null };
    gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 1, 1);
    const draw = (face) => { a.draw.face = face; p3.charGL.draw(a.draw, env); };
    gl.finish();
    let t0 = performance.now();
    for (let i = 0; i < N; i++) draw(null);
    gl.finish();
    const sin = performance.now() - t0;
    p3.charGL.faceUpdates = 0;
    t0 = performance.now();
    for (let i = 0; i < N; i++) { w[i % w.length] = ((i * 7) % 40) / 40; draw(w); }
    gl.finish();
    const con = performance.now() - t0;
    gl.disable(gl.SCISSOR_TEST);
    return { actualizaciones: p3.charGL.faceUpdates, microsegundosPorActualizacion: +(((con - sin) / p3.charGL.faceUpdates) * 1000).toFixed(2),
      vertices: ch.morph.count, bytesSubidos: ch.morph.count * 6, expresiones: ch.morph.names };
  })()`);
  res.cara.conCpu4x = '≈ ' + (res.cara.microsegundosPorActualizacion * 4).toFixed(1) + ' µs';
  console.log('cara', JSON.stringify(res.cara));

  // GPU: consulta de tiempo alrededor de un cuadro de la página (si el navegador la deja medir)
  res.gpuMs = {};
  for (const [nombre, consulta] of [['un personaje', 'clip=derecha&personaje=romina'], ['un personaje, sin caras', 'clip=derecha&personaje=romina&cara=no'], ['los 24 clips a la vez', 'todos=1&personaje=romina']]) {
    await cargar(cel, `${base}?${consulta}`, 1);
    await dormir(600);
    res.gpuMs[nombre] = await cel.evaluar(`new Promise((done) => {
      const gl = window.__p3.gl, ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!ext) { done(null); return; }
      const out = []; let pending = null;
      function tick() {
        if (pending && gl.getQueryParameter(pending, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) out.push(gl.getQueryParameter(pending, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(pending); pending = null;
        }
        if (out.length >= 120) { done(+(out.reduce((a, b) => a + b, 0) / out.length).toFixed(3)); return; }
        if (!pending) { const qy = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, qy); requestAnimationFrame(() => { gl.endQuery(ext.TIME_ELAPSED_EXT); pending = qy; tick(); }); } else requestAnimationFrame(tick);
      }
      tick();
    })`);
    console.log('GPU', nombre, res.gpuMs[nombre], 'ms');
  }
  if (cel.consola.length) res.consola = cel.consola.slice(0, 6);
} finally {
  await cel.cerrar();
  srv.parar();
}
writeFileSync(salida, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res.peso), JSON.stringify(res.primerCuadro));
console.log('guardado', salida);
