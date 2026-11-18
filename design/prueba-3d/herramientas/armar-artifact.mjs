// Arma la versión para publicar como Artifact: un fragmento HTML (sin doctype, html, head ni body)
// más la lista de archivos que lo acompañan.
// Uso: node herramientas/armar-artifact.mjs carpeta_salida [urlA] [urlB]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { carpeta } from './navegador.mjs';

const out = process.argv[2];
const urls = { A: process.argv[3] || '', B: process.argv[4] || '' };
mkdirSync(out, { recursive: true });
const PAGINAS = {
  A: { archivo: 'sprites.html', otra: 'B', etiqueta: 'Ver versión B', assets: ['assets/sprites'] },
  B: { archivo: 'tiempo-real.html', otra: 'A', etiqueta: 'Ver versión A', assets: ['assets/personaje.bin'] },
};
for (const [letra, p] of Object.entries(PAGINAS)) {
  const html = readFileSync(join(carpeta, p.archivo), 'utf8');
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].split('\n').filter((l) => /<title>|claude:viewport|<link /.test(l)).join('\n');
  let body = html.match(/<body>([\s\S]*?)<\/body>/)[1].trim();
  const otra = urls[p.otra];
  // Los Artifacts no sirven .bin: ahí el personaje viaja como texto en base64 (la página lo decodifica).
  let extra = '';
  if (letra === 'B') {
    writeFileSync(join(out, 'personaje.b64.txt'), readFileSync(join(carpeta, 'assets/personaje.bin')).toString('base64'));
    extra = 'window.P3_CHAR = "assets/personaje.b64.txt";';
  }
  const inline = `<script>window.P3_OTHER = ${otra ? JSON.stringify({ label: p.etiqueta, href: otra }) : 'null'};${extra}</script>\n`;
  body = body.replace('<script src="lib/base.js"></script>', inline + '<script src="lib/base.js"></script>');
  writeFileSync(join(out, p.archivo), head + '\n' + body + '\n');
  const libs = [...body.matchAll(/src="(lib\/[^"]+)"/g)].map((m) => m[1]).concat(['lib/estilo.css']);
  const files = [...libs, ...readdirSync(join(carpeta, 'assets/cancha')).map((f) => 'assets/cancha/' + f)];
  for (const a of p.assets) {
    if (a.endsWith('.bin')) files.push(a); else files.push(...readdirSync(join(carpeta, a)).map((f) => a + '/' + f));
  }
  writeFileSync(join(out, letra + '-archivos.json'), JSON.stringify(files, null, 1));
  console.log(letra, p.archivo, files.length, 'archivos');
}
