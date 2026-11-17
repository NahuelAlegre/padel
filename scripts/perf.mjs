#!/usr/bin/env node
/**
 * Frame-rate measurement under phone-like conditions.
 *
 *   npm run build && npm run perf
 *
 * Serves the production build, opens it in a Chrome (or Edge) already
 * installed on this machine, emulates a portrait phone, throttles the CPU
 * through the DevTools protocol, lets the demo (AI against AI) run and records
 * the time between frames.
 *
 * Options:
 *   --throttle 1,4     CPU slowdown factors to measure (default 1,4)
 *   --seconds 12       how long each measurement lasts
 *   --width 360 --height 800 --dpr 3    emulated screen
 *   --headed           use a visible window (and the real GPU) instead of headless
 *   --url <url>        measure a page that is already being served
 *   CHROME_PATH=...    browser executable to use
 */
import { openPhone, option, sleep, startPreview } from './lib/browser.mjs';

const settings = {
  throttles: String(option('throttle', '1,4')).split(',').map(Number),
  seconds: Number(option('seconds', 12)),
  width: Number(option('width', 360)),
  height: Number(option('height', 800)),
  dpr: Number(option('dpr', 3)),
  headed: option('headed', false) === true,
  url: option('url', ''),
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
        canvas: `${canvas.width}x${canvas.height}`,
      });
    };
    requestAnimationFrame(tick);
  });
}

async function main() {
  const preview = settings.url ? null : await startPreview();
  const url = settings.url || `${preview.url}?demo&loop`;
  const phone = await openPhone(settings);
  const results = [];
  try {
    for (const rate of settings.throttles) {
      await phone.throttle(rate);
      await phone.goto(url);
      // Let the page settle: start-up work and the automatic resolution probe.
      await sleep(4000);
      results.push({ rate, ...(await phone.evaluate(`(${measureInPage.toString()})(${settings.seconds})`)) });
    }
  } finally {
    await phone.close();
    preview?.stop();
  }

  const ms = (value) => `${value.toFixed(1)} ms`;
  console.log(`\nNavegador: ${phone.browserName} (${settings.headed ? 'ventana visible' : 'headless'})`);
  console.log(`Pantalla emulada: ${settings.width}x${settings.height} CSS, DPR ${settings.dpr}, vertical, táctil`);
  console.log(`Página: ${url}\n`);
  console.table(
    results.map((r) => ({
      'CPU': `${r.rate}x`,
      'fps': Number(r.fps.toFixed(1)),
      'mediana': ms(r.median),
      'p95': ms(r.p95),
      'p99': ms(r.p99),
      'peor': ms(r.worst),
      '>17,5 ms': `${(r.over17 * 100).toFixed(1)}%`,
      '>34 ms': `${(r.over34 * 100).toFixed(1)}%`,
      'trabajo JS': `${r.work.toFixed(2)} ms`,
      'canvas': r.canvas,
      'cuadros': r.frames,
      'estado': r.state,
    })),
  );
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
});
