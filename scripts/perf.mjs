#!/usr/bin/env node
/**
 * Weight, time to the first frame and frame times, under phone-like conditions.
 *
 *   npm run build && npm run perf
 *
 * Serves the production build, opens it in a Chrome (or Edge) already
 * installed on this machine, emulates a portrait phone and measures:
 *
 *   - what a first visit downloads, file by file, as it travels;
 *   - how long it takes from asking for the page to the first frame on
 *     screen and to the first frame in 3D, with the CPU slowed down and on
 *     slower connections;
 *   - the time between frames and the work of the game in each of them while
 *     the demo plays (computer against computer), with the CPU slowed down,
 *     in 3D and in the 2D look it falls back to.
 *
 * What this cannot emulate is the graphics card of a phone: the time between
 * frames is the one of this machine's. The work of the game per frame, which
 * is what the CPU slowdown stretches, is the number to watch.
 *
 * Options:
 *   --throttle 1,4,6   CPU slowdown factors to measure (default 1,4,6)
 *   --seconds 10       how long each frame measurement lasts
 *   --width 360 --height 800 --dpr 3    emulated screen
 *   --headed           use a visible window instead of headless
 *   --nogpu            run the browser without a graphics card
 *   --only frames      measure only one part: weight, start or frames
 *   --dobles           also measure the frames of a doubles demo: four characters on court
 *   CHROME_PATH=...    browser executable to use
 */
import { openPhone, option, sleep, startPreview } from './lib/browser.mjs';

const settings = {
  throttles: String(option('throttle', '1,4,6')).split(',').map(Number),
  seconds: Number(option('seconds', 10)),
  width: Number(option('width', 360)),
  height: Number(option('height', 800)),
  dpr: Number(option('dpr', 3)),
  headed: option('headed', false) === true,
  gpu: !option('nogpu', false),
  only: String(option('only', '')),
  doubles: option('dobles', false) === true,
};

/** Connections, as DevTools has them: bytes per second and milliseconds of delay per request. */
const NETWORKS = {
  'sin límite': null,
  '4G rápida': { latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
  '4G lenta': { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
};

/** Runs in the page: records the time between animation frames. */
function measureInPage(seconds) {
  return new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    const end = last + seconds * 1000;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (now < end) {
        requestAnimationFrame(tick);
        return;
      }
      deltas.shift();
      const sorted = [...deltas].sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      const total = deltas.reduce((a, b) => a + b, 0);
      const canvas = document.querySelector('#court');
      const game = window.padel;
      resolve({
        frames: deltas.length,
        fps: (deltas.length / total) * 1000,
        median: at(0.5),
        p95: at(0.95),
        p99: at(0.99),
        worst: sorted[sorted.length - 1],
        over17: deltas.filter((delta) => delta > 17.5).length / deltas.length,
        over34: deltas.filter((delta) => delta > 34).length / deltas.length,
        work: game ? game.stats.workMs : NaN,
        state: game ? game.state : 'missing',
        look: game ? game.renderer.look : '?',
        canvas: `${canvas.width}x${canvas.height}`,
      });
    };
    requestAnimationFrame(tick);
  });
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const ms = (value) => `${value.toFixed(1)} ms`;

async function main() {
  const preview = await startPreview();
  const phone = await openPhone(settings);
  const wants = (part) => !settings.only || settings.only === part;
  try {
    console.log(`\nNavegador: ${phone.browserName} (${settings.headed ? 'ventana visible' : 'headless'})`);
    console.log(`Pantalla emulada: ${settings.width}x${settings.height} CSS, DPR ${settings.dpr}, vertical, táctil`);
    const card = await (async () => {
      await phone.goto(`${preview.url}?demo`);
      await sleep(1500);
      return phone.evaluate(`(() => {
        const gl = document.querySelector('#world')?.getContext('webgl2');
        const info = gl?.getExtension('WEBGL_debug_renderer_info');
        return gl ? (info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'WebGL2') : 'sin WebGL2';
      })()`);
    })();
    console.log(`Placa de video: ${card}`);

    // ------------------------------------------------------------ weight
    if (wants('weight')) {
      await phone.watchTransfers();
      await phone.send('Network.setCacheDisabled', { cacheDisabled: true });
      phone.transfers.length = 0;
      await phone.goto(preview.url);
      await sleep(2500);
      const files = phone.transfers
        .filter((entry) => entry.url.startsWith(preview.url))
        .map((entry) => ({ file: entry.url.slice(preview.url.length).replace(/\?.*$/, '') || 'index.html', bytes: entry.bytes }));
      const kind = (file) => (file.startsWith('art/court/') ? 'cancha' : file.startsWith('art/') ? 'personaje' : file.endsWith('.js') ? 'código' : 'página y estilos');
      const groups = {};
      for (const entry of files) groups[kind(entry.file)] = (groups[kind(entry.file)] ?? 0) + entry.bytes;
      console.log('\nPeso de la primera visita (lo que viaja por la red, con sus cabeceras)');
      console.table(files.map((entry) => ({ archivo: entry.file, viaja: kb(entry.bytes) })));
      console.table(Object.entries(groups).map(([name, bytes]) => ({ parte: name, viaja: kb(bytes) })));
      console.log(`Total: ${kb(files.reduce((sum, entry) => sum + entry.bytes, 0))} en ${files.length} archivos`);
    }

    // ------------------------------------------------------------ start
    if (wants('start')) {
      const rows = [];
      for (const [name, network] of Object.entries(NETWORKS)) {
        for (const rate of [1, 4]) {
          await phone.throttle(rate);
          await phone.send('Network.enable');
          await phone.send('Network.setCacheDisabled', { cacheDisabled: true });
          await phone.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, ...(network ?? {}) });
          await phone.goto(`${preview.url}?demo`);
          let seen = null;
          for (const deadline = Date.now() + 20000; Date.now() < deadline; await sleep(50)) {
            seen = await phone.evaluate(`(() => {
              const r = window.padel?.renderer;
              if (!r || r.timings.firstFrame < 0) return null;
              if (r.look !== '3d' && r.pending > 0) return null;
              return { born: r.born, first: r.timings.firstFrame, first3d: r.timings.first3d, look: r.look };
            })()`);
            if (seen && (seen.first3d >= 0 || seen.look === '2d')) break;
          }
          rows.push({
            'conexión': name,
            'CPU': `${rate}x`,
            'primer cuadro': seen ? ms(seen.born + seen.first) : 'no llegó',
            'primer cuadro en 3D': seen && seen.first3d >= 0 ? ms(seen.born + seen.first3d) : 'no hubo',
          });
        }
      }
      await phone.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await phone.send('Network.setCacheDisabled', { cacheDisabled: false });
      console.log('\nTiempo desde que se pide la página (sin nada en caché)');
      console.table(rows);
    }

    // ------------------------------------------------------------ frames
    if (wants('frames')) {
      const results = [];
      const queries = ['demo&loop', 'demo&loop&2d'];
      if (settings.doubles) queries.push('demo&loop&dobles', 'demo&loop&dobles&2d');
      for (const query of queries) {
        for (const rate of settings.throttles) {
          await phone.throttle(rate);
          await phone.goto(`${preview.url}?${query}`);
          // Let the page settle: start-up work and the automatic resolution probe.
          await sleep(4000);
          results.push({ rate, players: query.includes('dobles') ? 4 : 2, ...(await phone.evaluate(`(${measureInPage.toString()})(${settings.seconds})`)) });
        }
      }
      console.log('\nCuadros, con la demo andando');
      console.table(
        results.map((r) => ({
          'jugadores': r.players,
          'aspecto': r.look,
          'CPU': `${r.rate}x`,
          'trabajo del juego': `${r.work.toFixed(2)} ms`,
          'fps': Number(r.fps.toFixed(1)),
          'mediana': ms(r.median),
          'p95': ms(r.p95),
          'p99': ms(r.p99),
          'peor': ms(r.worst),
          '>17,5 ms': `${(r.over17 * 100).toFixed(1)}%`,
          '>34 ms': `${(r.over34 * 100).toFixed(1)}%`,
          'canvas': r.canvas,
          'cuadros': r.frames,
          'estado': r.state,
        })),
      );
    }
    if (phone.errors.length) console.log('\nErrores de la página:', phone.errors.slice(0, 5));
  } finally {
    await phone.close();
    preview.stop();
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
