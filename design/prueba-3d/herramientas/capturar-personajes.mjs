// Capturas de la página de revisión de personajes.
// Uso: node herramientas/capturar-personajes.mjs carpeta_salida nombre=consulta [nombre=consulta ...] [--ancho 390 --alto 844 --dpr 2 --espera 500]
//   consulta: parámetros de personajes.html, por ejemplo "personaje=beto&clip=derecha&vista=juego&t=0.52"
//   (t = segundos del clip, en pausa; sin t, la animación corre y se captura después de la espera)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { abrirCelular, dormir, servir } from './navegador.mjs';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const salida = resolve(args[0]);
const trabajos = args.slice(1).filter((a, i, l) => !a.startsWith('--') && !(i > 0 && l[i - 1].startsWith('--'))).map((a) => { const k = a.indexOf('='); return [a.slice(0, k), a.slice(k + 1)]; });
mkdirSync(salida, { recursive: true });
const srv = await servir();
const cel = await abrirCelular({ ancho: Number(arg('ancho', 390)), alto: Number(arg('alto', 844)), dpr: Number(arg('dpr', 2)) });
try {
  for (const [nombre, consulta] of trabajos) {
    await cel.ir(`${srv.url}personajes.html?${consulta}`);
    await cel.esperar('window.__p3 && window.__p3.firstFrame > 0');
    await dormir(Number(arg('espera', 500)));
    writeFileSync(join(salida, nombre + '.png'), await cel.captura('png'));
    const st = await cel.evaluar('JSON.stringify({ ms: +window.__p3.stats.ms.toFixed(2), fps: Math.round(window.__p3.stats.fps) })');
    console.log('captura', nombre, st);
  }
  if (cel.consola.length) console.log('consola:', cel.consola.slice(0, 6).join(' | '));
} finally {
  await cel.cerrar();
  srv.parar();
}
