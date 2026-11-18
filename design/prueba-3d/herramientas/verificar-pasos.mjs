// Comprueba, sobre los datos exportados y con el mismo código que usa el navegador, que los pies
// no patinen: mientras la bola del pie está apoyada, no se tiene que mover respecto del piso cuando
// la raíz avanza lo que declara el clip (zancada o tabla de recorrido).
// También revisa los empalmes arranque → correr → frenada y que el cuadro de contacto de cada golpe
// deje la pala donde dicen los metadatos.
// Uso: node herramientas/verificar-pasos.mjs [--json salida.json] [--archivo otro.bin]
import { writeFileSync } from 'node:fs';
import { cargarPersonaje, recorrido } from './personaje-node.mjs';

const iArchivo = process.argv.indexOf('--archivo');
const { P3, ch, nuevo, hueso } = cargarPersonaje(iArchivo > 0 ? process.argv[iArchivo + 1] : undefined);
const FPS = 120, PISO = 0.004;                 // se mide a 120 fps; apoyado = a menos de 4 mm del piso
const a = nuevo();
const pies = [['izq', hueso('toe.L')], ['der', hueso('toe.R')]];
const reposoZ = ch.meta.bones.rest[hueso('toe.L')][2];
const C = ch.clips;

function medir(clip) {
  const n = Math.round(clip.dur * FPS), dir = clip.dir || (clip.raiz && clip.raiz.dir) || [0, 0];
  const r = {};
  for (const [nombre, i] of pies) {
    let prev = null, maximo = 0, total = 0, apoyado = 0, ancla = null, desvio = 0;
    for (let f = 0; f <= n; f++) {
      const t = clip.loop ? Math.min(clip.dur - 1e-6, f / FPS) : f / FPS;
      P3.samplePose(ch, clip, t, a.pose);
      P3.poseToMatrices(ch, a.pose, a.mats, a.work);
      const d = recorrido(ch, clip, t);
      const p = [a.work.pos[i * 3] + dir[0] * d, a.work.pos[i * 3 + 1] + dir[1] * d, a.work.pos[i * 3 + 2]];
      const abajo = p[2] - reposoZ < PISO;
      if (abajo && prev) {
        const mm = Math.hypot(p[0] - prev[0], p[1] - prev[1]) * 1000;
        maximo = Math.max(maximo, mm); total += mm; apoyado++;
        /* desvío: cuánto se aleja el pie de donde apoyó, mientras sigue apoyado */
        desvio = Math.max(desvio, Math.hypot(p[0] - ancla[0], p[1] - ancla[1]) * 1000);
      } else if (abajo) ancla = p;
      prev = abajo ? p : null;
    }
    r[nombre] = { maximo, total, desvio, apoyado: apoyado / n };
  }
  return r;
}

const filas = [];
let peor = 0, peorLoc = 0;
console.log('clip                 grupo        avanza      pie izq: desvío · por cuadro   pie der: desvío · por cuadro   (mm; a 120 fps)');
for (const c of ch.meta.clips) {
  const clip = C[c.name], r = medir(clip);
  const avanza = clip.zancada ? clip.zancada.toFixed(2) + ' m/ciclo' : clip.raiz ? clip.raiz.total.toFixed(2) + ' m' : '—';
  const m = Math.max(r.izq.desvio, r.der.desvio);
  peor = Math.max(peor, m);
  if (clip.grupo === 'locomocion' || clip.grupo === 'base') peorLoc = Math.max(peorLoc, m);
  filas.push({ clip: c.name, grupo: c.grupo, avanza, izq: r.izq, der: r.der });
  const f = (x) => x.desvio.toFixed(1).padStart(8) + ' · ' + x.maximo.toFixed(2).padStart(6);
  console.log(c.name.padEnd(20), c.grupo.padEnd(11), avanza.padStart(11), '   ', f(r.izq), '      ', f(r.der));
}

// empalmes: la última pose de un clip contra la primera del siguiente (mayor diferencia entre articulaciones)
function pose(clip, t) { const b = nuevo(); P3.samplePose(ch, clip, t, b.pose); P3.poseToMatrices(ch, b.pose, b.mats, b.work); return b.work.pos; }
const dif = (p, q) => { let m = 0; for (let i = 0; i < p.length; i += 3) m = Math.max(m, Math.hypot(p[i] - q[i], p[i + 1] - q[i + 1], p[i + 2] - q[i + 2])); return m * 1000; };
const empalmes = [
  ['espera → arranque', dif(pose(C.listo, 0), pose(C.arranque, 0))],
  ['arranque → correr', dif(pose(C.arranque, C.arranque.dur), pose(C.correr, C.arranque.enlace.fase * C.correr.dur))],
  ['correr → frenada', dif(pose(C.correr, C.frenada.enlace.fase * C.correr.dur), pose(C.frenada, 0))],
  ['frenada → espera', dif(pose(C.frenada, C.frenada.dur), pose(C.listo, 0))],
  ['split step → espera', dif(pose(C.split_step, C.split_step.dur), pose(C.listo, 0))],
];
console.log('\nEmpalmes (mayor salto entre articulaciones, en mm):');
for (const [n, v] of empalmes) console.log('  ' + n.padEnd(22), v.toFixed(1));

// golpes: en el cuadro de contacto la pala está donde dicen los metadatos
const iR = hueso('racket'), rc = ch.meta.racketCenter, rest = ch.meta.bones.rest[iR];
let peorGolpe = 0;
for (const c of ch.meta.clips) {
  if (c.contact === undefined) continue;
  const clip = C[c.name];
  P3.samplePose(ch, clip, (clip.t0 || 0) + c.cuadro / ch.meta.fps, a.pose);
  P3.poseToMatrices(ch, a.pose, a.mats, a.work);
  const p = [rest[0] + rc[0], rest[1] + rc[1], rest[2] + rc[2]], o = iR * 16, m = a.mats;
  const w = [0, 1, 2].map((r) => m[o + r] * p[0] + m[o + 4 + r] * p[1] + m[o + 8 + r] * p[2] + m[o + 12 + r]);
  peorGolpe = Math.max(peorGolpe, Math.hypot(w[0] - c.hit[0], w[1] - c.hit[1], w[2] - c.hit[2]) * 1000);
}
console.log('\nContacto de los golpes: la pala queda a ' + peorGolpe.toFixed(1) + ' mm, como mucho, del punto declarado.');
console.log('Peor desvío de un pie apoyado: ' + peorLoc.toFixed(1) + ' mm en locomoción y ' + peor.toFixed(1) + ' mm en cualquier clip.');
const iJson = process.argv.indexOf('--json');
if (iJson > 0) writeFileSync(process.argv[iJson + 1], JSON.stringify({ fps: FPS, piso: PISO, clips: filas, empalmes: Object.fromEntries(empalmes), contacto: peorGolpe }, null, 1));
if (peorLoc > 15) { console.error('Hay pies que patinan en la locomoción.'); process.exit(1); }
