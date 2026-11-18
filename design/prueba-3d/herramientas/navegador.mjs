// Chrome o Edge sin ventana, manejado por el protocolo de DevTools. Sin dependencias (Node 22+).
// Regla del proyecto: perfil temporal ABSOLUTO y --noerrdialogs, nunca el perfil real del usuario.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const carpeta = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function buscarNavegador() {
  const c = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const f = c.find((p) => p && existsSync(p));
  if (!f) throw new Error('No encontré Chrome ni Edge. Definí CHROME_PATH.');
  return f;
}

export async function servir(dir = carpeta) {
  const port = 4400 + Math.floor(Math.random() * 400);
  const proc = spawn(process.execPath, [join(carpeta, 'herramientas', 'servir.mjs'), String(port), dir], { stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(url + 'lib/base.js'); if (r.ok || r.status === 404) return { url, parar: () => proc.kill() }; } catch { /* todavía no */ }
    await dormir(100);
  }
  proc.kill();
  throw new Error('El servidor local no arrancó.');
}

class Devtools {
  constructor(socket) {
    this.socket = socket; this.id = 1; this.pend = new Map(); this.oyentes = [];
    socket.addEventListener('message', (m) => {
      const d = JSON.parse(m.data);
      if (d.id) {
        const e = this.pend.get(d.id);
        if (!e) return;
        this.pend.delete(d.id);
        if (d.error) e.no(new Error(`${e.metodo}: ${d.error.message}`)); else e.si(d.result);
        return;
      }
      for (const o of this.oyentes) o(d.method, d.params, d.sessionId);
    });
  }
  static async conectar(dir) {
    const s = new WebSocket(dir);
    await new Promise((si, no) => { s.addEventListener('open', si, { once: true }); s.addEventListener('error', () => no(new Error('No pude conectar con el navegador.')), { once: true }); });
    return new Devtools(s);
  }
  enviar(metodo, params = {}, sessionId) {
    const id = this.id++;
    return new Promise((si, no) => { this.pend.set(id, { si, no, metodo }); this.socket.send(JSON.stringify({ id, method: metodo, params, sessionId })); });
  }
}

/** Abre una página como un celular en vertical. Devuelve ayudas para manejarla. */
export async function abrirCelular({ ancho = 390, alto = 844, dpr = 2, gpu = true, extra = [] } = {}) {
  const perfil = mkdtempSync(join(tmpdir(), 'padel-prueba3d-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, '--noerrdialogs', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--hide-scrollbars', '--mute-audio', `--window-size=${ancho},${alto + 90}`];
  if (gpu) args.push('--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11');
  args.push(...extra, 'about:blank');
  const proc = spawn(buscarNavegador(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const dir = await new Promise((si, no) => {
    let txt = '';
    const t = setTimeout(() => no(new Error('El navegador no informó su puerto de DevTools.')), 20000);
    proc.stderr.on('data', (c) => { txt += c; const m = txt.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); si(m[1]); } });
    proc.on('exit', () => no(new Error('El navegador se cerró al arrancar.')));
  });
  const dt = await Devtools.conectar(dir);
  const { targetId } = await dt.enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await dt.enviar('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => dt.enviar(m, p, sessionId);
  await S('Page.enable');
  await S('Runtime.enable');
  await S('Network.enable');
  await S('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: dpr, mobile: true });
  await S('Emulation.setTouchEmulationEnabled', { enabled: true });
  const red = [];
  const consola = [];
  dt.oyentes.push((m, p) => {
    if (m === 'Network.responseReceived') red.push({ id: p.requestId, url: p.response.url, tipo: p.response.mimeType, estado: p.response.status });
    if (m === 'Network.loadingFinished') { const r = red.find((x) => x.id === p.requestId); if (r) r.bytes = p.encodedDataLength; }
    if (m === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning')) consola.push(p.args.map((a) => a.value || a.description || '').join(' '));
    if (m === 'Runtime.exceptionThrown') consola.push('EXCEPCIÓN ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  });
  const evaluar = async (expr) => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    S, evaluar, red, consola,
    async ir(url) { red.length = 0; await S('Page.navigate', { url }); },
    async esperar(expr, ms = 20000) {
      const fin = Date.now() + ms;
      while (Date.now() < fin) { try { if (await evaluar(expr)) return true; } catch { /* la página todavía carga */ } await dormir(60); }
      throw new Error('Tiempo agotado esperando: ' + expr + '\n' + consola.join('\n'));
    },
    async captura(formato = 'png', calidad = 90) {
      const r = await S('Page.captureScreenshot', { format: formato, quality: formato === 'png' ? undefined : calidad, captureBeyondViewport: false });
      return Buffer.from(r.data, 'base64');
    },
    async cerrar() {
      try { await dt.enviar('Browser.close'); } catch { /* ya cerró */ }
      await dormir(300);
      try { proc.kill(); } catch { /* ya terminó */ }
      await dormir(200);
      try { rmSync(perfil, { recursive: true, force: true }); } catch { /* Windows a veces lo suelta después */ }
    },
  };
}
