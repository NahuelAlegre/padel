// Cuánto pesa el personaje y cuánto suma cada cosa.
// Parte assets/personaje.bin en sus piezas (malla base, piezas opcionales, caras, clips por grupo,
// metadatos) y comprime cada una por separado con gzip y con brotli. Como cada parte se comprime
// sola, la suma da un poco más que el archivo entero comprimido.
// Uso: node herramientas/pesar.mjs [--json salida.json]
import { writeFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { cargarPersonaje } from './personaje-node.mjs';

const { ch, bytes, buf } = cargarPersonaje();
const meta = ch.meta, M = meta.mesh, nb = meta.bones.names.length;
const gz = (b) => gzipSync(b, { level: 9 }).length;
const br = (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
const dv = new DataView(buf);
const jl = dv.getUint32(4, true), base = 8 + jl;
const cut = (off, len) => Buffer.from(buf, base + off, len);
const filas = [];
const fila = (nombre, partes, nota) => { const b = Buffer.concat(partes); filas.push({ nombre, bytes: b.length, gzip: gz(b), brotli: br(b), nota: nota || '' }); };

// malla: los vértices van en el orden cuerpo, cara y piezas; los índices, igual
const POR_VERTICE = [['pos', 6], ['nrm', 3], ['mat', 1], ['out', 1], ['joints', 3], ['weights', 2]];
const verts = (v0, n) => POR_VERTICE.map(([k, size]) => cut(M[k] + v0 * size, n * size));
const piezas = M.piezas || [];
const vPiezas = piezas.reduce((a, p) => a + p.vertices, 0);
const vBase = M.nv - vPiezas;
fila('Malla base (cuerpo, ropa, pala y cara)', [...verts(0, vBase), cut(M.idx, M.base * 2)], `${vBase} vértices, ${M.base / 3} triángulos`);
let v0 = vBase;
for (const p of piezas) {
  fila('Pieza: ' + p.nombre, [...verts(v0, p.vertices), cut(M.idx + p.inicio * 2, p.cantidad * 2)], `${p.vertices} vértices, ${p.cantidad / 3} triángulos`);
  v0 += p.vertices;
}
if (M.morfos) fila('Caras: ' + M.morfos.nombres.length + ' expresiones', [cut(M.morfos.datos, M.morfos.nombres.length * M.morfos.cantidad * 6)], `${M.morfos.cantidad} vértices que se mueven`);
const grupos = {};
for (const c of meta.clips) (grupos[c.grupo || 'base'] = grupos[c.grupo || 'base'] || []).push(c);
const NOMBRE = { base: 'Clips: espera activa', locomocion: 'Clips: locomoción', golpe: 'Clips: golpes', reaccion: 'Clips: reacciones', mania: 'Clips: manías' };
const clipBytes = (c) => cut(c.data, (nb * 4 + 3) * c.frames * 2);
for (const g of Object.keys(grupos)) {
  const cuadros = grupos[g].reduce((a, c) => a + c.frames, 0);
  fila(NOMBRE[g] || 'Clips: ' + g, grupos[g].map(clipBytes), `${grupos[g].length} clips, ${cuadros} cuadros`);
}
fila('Metadatos (JSON: huesos, paletas, personajes, clips)', [Buffer.from(buf, 8, jl)]);
const total = { nombre: 'Archivo completo', bytes: bytes.length, gzip: gz(bytes), brotli: br(bytes), nota: `${M.nv} vértices, ${(M.nt || M.ni) / 3} triángulos, ${meta.clips.length} clips` };
const porClip = meta.clips.map((c) => ({ clip: c.name, grupo: c.grupo, cuadros: c.frames, bytes: clipBytes(c).length, gzip: gz(clipBytes(c)) }));

const kb = (n) => (n / 1000).toFixed(1).padStart(7);       // KB de 1000 bytes, como en el resto del README
console.log('parte'.padEnd(54), 'sin comprimir     gzip   brotli   (KB)');
for (const f of [...filas, total]) console.log(f.nombre.padEnd(54), kb(f.bytes), '    ', kb(f.gzip), kb(f.brotli), '  ', f.nota);
console.log('\nPor clip (gzip, KB):');
console.log(porClip.map((c) => `${c.clip} ${(c.gzip / 1000).toFixed(1)}`).join(' · '));
const i = process.argv.indexOf('--json');
if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify({ partes: filas, total, clips: porClip }, null, 1));
