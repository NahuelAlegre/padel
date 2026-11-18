// Capturas de las dos versiones en momentos fijos del peloteo.
// Uso: node herramientas/capturar.mjs [salida] [--solo tiempo-real|sprites] [--t 2.42,4.4] [--extra "escala=2"] [--lado]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { abrirCelular, carpeta, dormir, servir } from './navegador.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const salida = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : join(carpeta, 'capturas'));
const solo = arg('solo', null);
const tiempos = arg('t', '0.95,2.42,4.42,5.95,7.74,9.7').split(',').map(Number);
const extra = arg('extra', '');
const prefijo = arg('prefijo', '');
const paginas = [['A', 'sprites.html'], ['B', 'tiempo-real.html']].filter((p) => !solo || p[1].startsWith(solo));
mkdirSync(salida, { recursive: true });

const srv = await servir();
const cel = await abrirCelular({ ancho: Number(arg('ancho', 390)), alto: Number(arg('alto', 844)), dpr: Number(arg('dpr', 2)) });
try {
  for (const [letra, pagina] of paginas) {
    for (const t of tiempos) {
      const vivo = process.argv.includes('--vivo');   // sin pausa: arranca en t y deja correr (para ver carteles y efectos)
      await cel.ir(`${srv.url}${pagina}?${vivo ? 'desde' : 't'}=${t}&panel=${process.argv.includes('--panel') ? 1 : 0}&fps=${vivo ? 1 : 0}${extra ? '&' + extra : ''}`);
      await cel.esperar('window.__p3 && window.__p3.firstFrame > 0');
      await dormir(Number(arg('espera', 350)));
      const nombre = `${prefijo}${letra}-${String(t).replace('.', '_')}.png`;
      writeFileSync(join(salida, nombre), await cel.captura('png'));
      console.log('captura', nombre);
    }
    if (cel.consola.length) console.log('consola:', cel.consola.slice(0, 5).join(' | '));
  }
} finally {
  await cel.cerrar();
  srv.parar();
}
