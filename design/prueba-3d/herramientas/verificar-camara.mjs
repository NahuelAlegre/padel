// Comprueba las reglas de la cámara que acompaña simulando el peloteo completo, cuadro por cuadro,
// sin navegador. Corre tres bucles a 60 cuadros por segundo en varias pantallas y mide, en cada cuadro:
//   1. que el jugador propio, la pelota, su marca de pique y el vidrio del fondo propio estén a la vista
//   2. que el rival y la red estén a la vista
//   3. que el zoom no salga de sus límites
//   4. que se abra con la pelota al fondo propio o con un globo, y se cierre con el juego en la red
//   5. que no haya saltos (velocidad y aceleración de paneo y de zoom) y que haya zona muerta
// Uso: node herramientas/verificar-camara.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const carpeta = fileURLToPath(new URL('..', import.meta.url));
globalThis.window = globalThis;
await import('../lib/base.js');
const P3 = globalThis.P3;
const clips = JSON.parse(readFileSync(join(carpeta, 'assets/sprites/sprites.json'), 'utf8')).clips;
const C = P3.CAMERA;
const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
let fallas = 0;

for (const [vw, vh] of [[390, 844], [360, 800], [412, 915], [390, 700]]) {
  const lay = P3.layout(vw, vh);
  const top = lay.cy - 422 - lay.visH / 2, bot = lay.cy - 422 + lay.visH / 2 - C.bar;
  for (const variant of P3.SCALES) {
    const rally = P3.buildRally(clips, variant);
    const follow = P3.makeFollow();
    const st = [{}, {}], ball = {}, markP = {}, o = {};
    const dt = 1 / 60;
    const m = { margenJugador: 1e9, margenPelota: 1e9, margenMarca: 1e9, margenRival: 1e9, margenVidrio: 1e9, margenRed: 1e9, zoomMin: 9, zoomMax: 0,
      velPan: 0, acelPan: 0, velZoom: 0, quieta: 0, cuadros: 0, zoomGlobo: [], zoomRed: [], zoomFondo: [], malos: [] };
    let prevPan = null, prevVel = 0, prevZoom = null;
    for (let i = 0; i < Math.round((rally.duration * 3) / dt); i++) {
      const tAbs = i * dt, t = tAbs % rally.duration, wrapped = i > 0 && t < dt;
      rally.player(0, t, st[0]); rally.player(1, t, st[1]); rally.ball(t, ball);
      const mark = rally.mark(t, markP);
      const ctx = { player: st[0], rival: st[1], ball, mark, lay };
      if (i === 0 || wrapped) follow.jump(ctx, true); else follow.update(ctx, dt, true);
      const cam = P3.followCamera(follow);
      /* margen de un punto al borde visible: en x contra los costados, en y contra arriba y contra la barra */
      const margen = (x, y, z) => { cam.project(x, y, z, o); return Math.min(195 - Math.abs(o.x), o.y - top, bot - o.y); };
      const fade = rally.fade(t) > 0.5;
      const mJ = Math.min(margen(st[0].x, st[0].y, 0), margen(st[0].x, st[0].y, 1.8 * st[0].k));
      const mR = Math.min(margen(st[1].x, st[1].y, 0), margen(st[1].x, st[1].y, 1.8 * st[1].k));
      const mV = Math.min(margen(-2.5, -10, 0), margen(2.5, -10, 0), margen(st[0].x, Math.max(-10, st[0].y - 2.5), 0));
      const mN = Math.min(margen(-2.5, 0, 0.9), margen(2.5, 0, 0.9));
      m.margenJugador = Math.min(m.margenJugador, mJ); m.margenRival = Math.min(m.margenRival, mR);
      m.margenVidrio = Math.min(m.margenVidrio, mV); m.margenRed = Math.min(m.margenRed, mN);
      let mP = 1e9, mM = 1e9;
      if (ball.visible && !ball.held && fade) { mP = margen(ball.x, ball.y, ball.z); m.margenPelota = Math.min(m.margenPelota, mP); }
      if (mark) { mM = margen(mark.x, mark.y, 0); m.margenMarca = Math.min(m.margenMarca, mM); }
      if (Math.min(mJ, mR, mV, mN, mP, mM) < 0 && m.malos.length < 4) m.malos.push(`t=${fmt(t, 2)} jugador ${fmt(mJ)} rival ${fmt(mR)} vidrio ${fmt(mV)} red ${fmt(mN)} pelota ${fmt(mP)} marca ${fmt(mM)}`);
      m.zoomMin = Math.min(m.zoomMin, follow.zoom); m.zoomMax = Math.max(m.zoomMax, follow.zoom);
      if (prevPan !== null && !wrapped) {
        const v = (follow.pan - prevPan) / dt;
        m.velPan = Math.max(m.velPan, Math.abs(v));
        m.acelPan = Math.max(m.acelPan, Math.abs(v - prevVel) / dt);
        m.velZoom = Math.max(m.velZoom, Math.abs(follow.zoom - prevZoom) / dt);
        if (Math.abs(v) < 0.02) m.quieta++;
        prevVel = v;
      } else prevVel = 0;
      m.cuadros++;
      prevPan = follow.pan; prevZoom = follow.zoom;
      /* regla 4: zoom en tres momentos del peloteo */
      if (Math.abs(t - 6.9) < dt / 2) m.zoomGlobo.push(follow.zoom);          // el globo está en lo más alto
      if (Math.abs(t - 9.3) < dt / 2) m.zoomRed.push(follow.zoom);            // el jugador está en la red y la pelota, baja
      if (Math.abs(t - 3.8) < dt / 2) m.zoomFondo.push(follow.zoom);          // la pelota llega al vidrio propio
    }
    const ok = m.malos.length === 0 && m.zoomMin >= C.zoomMin - 1e-6 && m.zoomMax <= C.zoomMax + 1e-6;
    if (!ok) fallas++;
    const prom = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    console.log(`${vw}x${vh} escala ${variant.label}: ${ok ? 'CUMPLE' : 'FALLA'} · margen mínimo (px) jugador ${fmt(m.margenJugador)}, pelota ${fmt(m.margenPelota)}, marca ${fmt(m.margenMarca)}, vidrio propio ${fmt(m.margenVidrio)}, rival ${fmt(m.margenRival)}, red ${fmt(m.margenRed)}`
      + ` · zoom ${fmt(m.zoomMin, 2)} a ${fmt(m.zoomMax, 2)} (globo ${fmt(prom(m.zoomGlobo), 2)}, pelota al fondo ${fmt(prom(m.zoomFondo), 2)}, en la red ${fmt(prom(m.zoomRed), 2)})`
      + ` · paneo máx. ${fmt(m.velPan, 2)} m/s y ${fmt(m.acelPan, 1)} m/s², zoom máx. ${fmt(m.velZoom, 2)}/s · quieta el ${Math.round((100 * m.quieta) / m.cuadros)} % del tiempo`);
    for (const l of m.malos) console.log('   fuera de cuadro:', l);
  }
}
console.log(fallas ? `${fallas} combinaciones no cumplen` : 'Todas las combinaciones cumplen las reglas.');
process.exitCode = fallas ? 1 : 0;
