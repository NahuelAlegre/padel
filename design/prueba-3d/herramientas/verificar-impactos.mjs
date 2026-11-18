// Comprueba que en cada impacto el centro de la pala (calculado con las matrices de hueso que usa
// el renderer en tiempo real) coincide con la pelota del peloteo guionado.
// Uso: node herramientas/verificar-impactos.mjs
import { abrirCelular, dormir, servir } from './navegador.mjs';

const srv = await servir();
const cel = await abrirCelular({});
try {
  for (const t of [1.0, 2.4, 4.42, 5.95, 7.75]) {
    await cel.ir(`${srv.url}tiempo-real.html?t=${t}&panel=0`);
    await cel.esperar('window.__p3 && window.__p3.firstFrame > 0');
    await dormir(200);
    const r = await cel.evaluar(`(() => {
      const p3 = window.__p3, ch = p3.character, B = ch.meta.bones, rally = p3.rally();
      const hit = rally.hits.find((h) => Math.abs(h.t - ${t}) < 0.02);
      const pl = p3.players[hit.who];
      const i = B.names.indexOf('racket'), m = pl.mats, o = i * 16;
      const c = [B.rest[i][0] + ch.meta.racketCenter[0], B.rest[i][1] + ch.meta.racketCenter[1], B.rest[i][2] + ch.meta.racketCenter[2]];
      const lp = [0, 1, 2].map((r) => m[o + r] * c[0] + m[o + 4 + r] * c[1] + m[o + 8 + r] * c[2] + m[o + 12 + r]);
      const s = pl.st.yaw === 180 ? -1 : 1;
      const w = [pl.st.x + s * lp[0] * pl.st.k, pl.st.y + s * lp[1] * pl.st.k, lp[2] * pl.st.k];
      const b = p3.ball;
      return { clip: pl.st.clip, time: +pl.st.time.toFixed(3), pala: w.map((v) => +v.toFixed(3)), pelota: [b.x, b.y, b.z].map((v) => +v.toFixed(3)), error: +Math.hypot(w[0] - b.x, w[1] - b.y, w[2] - b.z).toFixed(3) };
    })()`);
    console.log(t, JSON.stringify(r));
  }
} finally {
  await cel.cerrar();
  srv.parar();
}
