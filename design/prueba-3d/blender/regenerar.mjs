// Regenera los assets de la prueba 3D con un solo comando. Corre Blender en modo consola
// (sin ventana), siempre con --factory-startup: no lee ni escribe las preferencias ni los addons
// del usuario, y no toca ninguna sesión de Blender que esté abierta.
//
// Uso:
//   node design/prueba-3d/blender/regenerar.mjs [qué] [opciones]
//
//   qué:  todo (por defecto) | cancha | personaje | sprites | revision
//         cancha     capas de la cancha: Cycles (HIP) y después el revelado a WebP
//         personaje  malla, esqueleto y clips para la versión en tiempo real
//         sprites    hojas de sprites para la versión de sprites (EEVEE)
//         revision   hojas para mirar el modelo y las animaciones; no toca los assets
//
//   --blender <ruta>   ejecutable de Blender. Si falta: variable BLENDER, la instalación
//                      habitual de Windows o «blender» en el PATH
//   --gpu <id>         GPU para EEVEE, como la lista «blender --gpu-backend vulkan --gpu-device help».
//                      Por defecto 1002/747e/0 (la RX 7800 XT de esta PC). «--gpu ninguna» deja la de Blender
//   --cycles <texto>   parte del nombre de la GPU para Cycles (HIP). Por defecto «RX 7800 XT»
//   --muestras <n>     muestras de Cycles para la cancha (256)
//   --conservar        no borra la carpeta temporal (EXR de la cancha y cuadros sueltos)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = resolve(fileURLToPath(new URL('.', import.meta.url)));
const assets = resolve(aqui, '..', 'assets');
const argv = process.argv.slice(2);
const opcion = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const que = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'todo';
const VALIDOS = ['todo', 'cancha', 'personaje', 'sprites', 'revision'];
if (!VALIDOS.includes(que)) { console.error('No sé regenerar «' + que + '». Opciones: ' + VALIDOS.join(', ')); process.exit(2); }

function buscarBlender() {
  const c = [opcion('blender'), process.env.BLENDER, 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
    '/Applications/Blender.app/Contents/MacOS/Blender'];
  return c.find((p) => p && existsSync(p)) || 'blender';
}
const blender = buscarBlender();
const gpu = opcion('gpu', process.env.BLENDER_GPU_DEVICE || '1002/747e/0');
/* EEVEE dibuja con la GPU de visualización: se elige con Vulkan y el id del dispositivo */
const gpuEevee = gpu === 'ninguna' ? [] : ['--gpu-backend', 'vulkan', '--gpu-device', gpu];
const cycles = opcion('cycles', process.env.CYCLES_GPU || 'RX 7800 XT');
const muestras = opcion('muestras', '256');
const tmp = mkdtempSync(join(tmpdir(), 'padel-prueba3d-blender-'));

function correr(titulo, script, args, extra = []) {
  const cmd = ['-b', '--factory-startup', ...extra, '--python', join(aqui, script), '--', ...args];
  console.log('\n== ' + titulo + '\n   blender ' + cmd.map((a) => (/\s/.test(a) ? '"' + a + '"' : a)).join(' '));
  const t0 = Date.now();
  const r = spawnSync(blender, cmd, { encoding: 'utf8', env: { ...process.env, CYCLES_GPU: cycles }, maxBuffer: 64 * 1024 * 1024 });
  const salida = (r.stdout || '') + (r.stderr || '');
  for (const linea of salida.split(/\r?\n/)) if (/^(GPU|CAPA|HOJA|CLIP|VERTS|WROTE|OK|RES)\b|Traceback|Error/.test(linea)) console.log('   ' + linea.trim());
  if (r.status !== 0 || /Traceback \(most recent call last\)/.test(salida)) {
    console.error('   Falló (código ' + r.status + '). Últimas líneas:\n' + salida.split(/\r?\n/).slice(-15).join('\n'));
    process.exit(1);
  }
  console.log('   listo en ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
}
const pesos = (dir) => readdirSync(dir).map((f) => f + ' ' + (statSync(join(dir, f)).size / 1024).toFixed(1) + ' KB').join(' · ');

console.log('Blender: ' + blender + '\nGPU para EEVEE: ' + (gpuEevee.length ? gpu + ' (Vulkan)' : 'la que elija Blender') + ' · GPU para Cycles: ' + cycles + ' (HIP)\nTemporales: ' + tmp);
try {
  if (que === 'todo' || que === 'cancha') {
    correr('Cancha: render de las capas con Cycles', 'cancha.py', [join(tmp, 'cancha'), 'capas', muestras]);
    correr('Cancha: revelado y exportación a WebP', 'revelar.py', [join(tmp, 'cancha'), 'capas', join(assets, 'cancha')]);
    console.log('   ' + pesos(join(assets, 'cancha')));
  }
  if (que === 'todo' || que === 'personaje') {
    correr('Personaje: malla, esqueleto y clips', 'exportar.py', [join(assets, 'personaje.bin')]);
  }
  if (que === 'todo' || que === 'sprites') {
    correr('Sprites: render de las dos vistas con EEVEE', 'render_sprites.py', [join(tmp, 'sprites'), join(assets, 'sprites')], gpuEevee);
    console.log('   ' + pesos(join(assets, 'sprites')));
  }
  if (que === 'revision') {
    const out = join(tmp, 'revision');
    for (const [nombre, ...a] of [['modelo-cuerpo.png', 'rival', '2', 'todo', '20,200'], ['modelo-cara.png', 'rival', '2', 'cara', '0,35'],
      ['modelo-pies.png', 'jugador', '2', 'pies', '0,40,180'], ['modelo-manos.png', 'rival', '2', 'manos', '0,90']]) correr('Revisión: ' + nombre, 'vista.py', [join(out, nombre), ...a], gpuEevee);
    for (const [clip, vista, variante] of [['derecha', 'frente', 'rival'], ['reves', 'espalda', 'jugador'], ['remate', 'espalda', 'jugador'], ['saque', 'espalda', 'jugador'], ['globo', 'frente', 'rival']]) {
      correr('Revisión: clip ' + clip, 'vista_anim.py', [join(out, 'clip-' + clip + '.png'), clip, vista, '7', variante], gpuEevee);
    }
    console.log('\nHojas de revisión en ' + out + ' (no se borran).');
  }
} finally {
  if (que !== 'revision' && !argv.includes('--conservar')) { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows a veces lo suelta después */ } }
}
console.log('\nListo.');
