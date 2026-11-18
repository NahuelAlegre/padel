import { describe, expect, it } from 'vitest';

/**
 * The game has to run wrapped as an app (a PWA, or Capacitor for the stores)
 * as well as in a browser tab. That only stays true if the code keeps two
 * promises, and these tests are what holds it to them.
 */

// Every source file, as text. Vite inlines them at test time.
const sources = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.entries(sources).map(([path, text]) => ({ path: path.replace('../src/', ''), text }));

/** Code only: comments say things like "no localStorage here", and that is fine. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('preparado para ser una app', () => {
  it('lee los archivos fuente', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((file) => file.path === 'platform/web.ts')).toBe(true);
  });

  it('lo que depende del dispositivo solo se usa dentro de src/platform', () => {
    // Storage, vibration, where the page lives, fullscreen, orientation and
    // being put in the background: each has an interface in platform/types.ts.
    const forbidden: Array<[string, RegExp]> = [
      ['localStorage', /\blocalStorage\b/],
      ['sessionStorage', /\bsessionStorage\b/],
      ['indexedDB', /\bindexedDB\b/],
      ['navigator', /\bnavigator\./],
      ['location', /\b(window\.|document\.)?location\b\s*[.=[]/],
      ['history', /\bhistory\.(pushState|replaceState|back|go)\b/],
      ['fullscreen', /requestFullscreen|exitFullscreen|fullscreenElement/],
      ['orientation', /screen\.orientation/],
      ['visibility', /visibilitychange|document\.hidden|pagehide/],
      ['matchMedia', /\bmatchMedia\b/],
      ['cookies', /document\.cookie/],
    ];
    const offences: string[] = [];
    for (const file of files) {
      if (file.path.startsWith('platform/')) continue;
      const text = code(file.text);
      for (const [name, pattern] of forbidden) {
        if (pattern.test(text)) offences.push(`${file.path}: ${name}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('la simulación no toca el navegador ni el reloj: corre igual en cualquier lado', () => {
    const offences: string[] = [];
    for (const file of files) {
      if (!file.path.startsWith('sim/') && !file.path.startsWith('control/')) continue;
      const text = code(file.text);
      for (const [name, pattern] of [
        ['window', /\bwindow\b/],
        ['document', /\bdocument\b/],
        ['Math.random', /Math\.random/],
        ['Date', /\bDate\b/],
        ['performance', /\bperformance\b/],
        ['render', /from '\.\.\/render\//],
        ['ui', /from '\.\.\/ui\//],
        ['platform', /from '\.\.\/platform\//],
      ] as Array<[string, RegExp]>) {
        if (pattern.test(text)) offences.push(`${file.path}: ${name}`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('nada se carga de internet: ni fuentes, ni scripts, ni imágenes', () => {
    const offences: string[] = [];
    for (const file of files) {
      const text = code(file.text);
      // A namespace URI inside a string is not a request; an address to fetch is.
      const urls = text.match(/https?:\/\/[^\s'"`)]+/g) ?? [];
      for (const url of urls) offences.push(`${file.path}: ${url}`);
      if (/XMLHttpRequest|new WebSocket|importScripts|sendBeacon/.test(text)) offences.push(`${file.path}: network call`);
      // The game's own files are read in one place only, by a path relative to its folder.
      if (/\bfetch\(|new Image\(/.test(text) && file.path !== 'platform/web.ts') offences.push(`${file.path}: loads a file`);
    }
    expect(offences).toEqual([]);
  });

  it('no hay rutas ni estado en la dirección de la página', () => {
    for (const file of files) {
      const text = code(file.text);
      expect(/\bURLSearchParams\b/.test(text) && !file.path.startsWith('platform/'), file.path).toBe(false);
      expect(/hashchange|popstate/.test(text), file.path).toBe(false);
    }
  });
});
