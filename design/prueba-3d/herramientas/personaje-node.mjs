// Carga en Node el mismo código que usa el navegador para leer y posar al personaje
// (lib/base.js y lib/personaje.js), sin navegador. Sirve para verificar los datos exportados.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const carpeta = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function cargarPersonaje(archivo = join(carpeta, 'assets', 'personaje.bin')) {
  const ctx = vm.createContext({ window: {}, TextDecoder, console });
  for (const f of ['lib/base.js', 'lib/personaje.js']) vm.runInContext(readFileSync(join(carpeta, f), 'utf8'), ctx, { filename: f });
  const P3 = ctx.window.P3;
  const bytes = readFileSync(archivo);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const ch = P3.parseCharacter(buf);
  const nb = ch.meta.bones.names.length;
  const nuevo = () => ({ pose: new Float32Array(nb * 4 + 3), mats: new Float32Array(26 * 16), work: { rot: new Float32Array(nb * 9), pos: new Float32Array(nb * 3) } });
  return { P3, ch, nb, bytes, buf, nuevo, hueso: (n) => ch.meta.bones.names.indexOf(n) };
}

/** Distancia recorrida por la raíz en el instante t de un clip (0 si el clip no avanza). */
export function recorrido(ch, clip, t) {
  if (clip.zancada) return (clip.zancada * t) / clip.dur;
  if (!clip.raiz) return 0;
  const tab = clip.raiz.dist, f = Math.max(0, Math.min(tab.length - 1, (t - (clip.t0 || 0)) * ch.meta.fps)), i = Math.floor(f);
  return tab[i] + (tab[Math.min(tab.length - 1, i + 1)] - tab[i]) * (f - i);
}
