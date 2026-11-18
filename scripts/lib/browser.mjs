/**
 * Shared plumbing for the scripts that drive a real browser: serve the
 * production build, launch a Chrome or Edge that is already installed, and
 * talk to it through the DevTools protocol.
 *
 * No dependencies: the protocol is spoken over Node's built-in WebSocket
 * (Node 22 or newer).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Value of `--name value` on the command line, `true` for a bare `--name`, else the fallback. */
export function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

export function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) throw new Error('No Chrome or Edge found. Set CHROME_PATH to the browser executable.');
  return found;
}

/** Starts `vite preview` on the production build and waits until it answers. */
export async function startPreview() {
  if (!existsSync(join(root, 'dist', 'index.html'))) {
    throw new Error('There is no build to open. Run "npm run build" first.');
  }
  const port = 4300 + Math.floor(Math.random() * 400);
  const server = spawn(
    process.execPath,
    [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(port), '--strictPort'],
    { cwd: root, stdio: 'ignore' },
  );
  const url = `http://localhost:${port}/`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return { url, stop: () => server.kill() };
    } catch {
      // Not up yet.
    }
    await sleep(100);
  }
  server.kill();
  throw new Error('The preview server did not start.');
}

/** Minimal DevTools protocol client. */
class Devtools {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    this.listeners = [];
    socket.addEventListener('message', (message) => {
      const data = JSON.parse(message.data);
      if (data.id) {
        const entry = this.pending.get(data.id);
        if (!entry) return;
        this.pending.delete(data.id);
        if (data.error) entry.reject(new Error(`${entry.method}: ${data.error.message}`));
        else entry.resolve(data.result);
        return;
      }
      for (const listener of this.listeners) listener(data.method, data.params);
      this.waiters = this.waiters.filter((waiter) => {
        if (waiter.method !== data.method) return true;
        waiter.resolve(data.params);
        return false;
      });
    });
  }

  static async connect(address) {
    const socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('Could not connect to the browser.')), { once: true });
    });
    return new Devtools(socket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  waitFor(method) {
    return new Promise((resolve) => this.waiters.push({ method, resolve }));
  }
}

/**
 * Opens a page that behaves like a phone held upright: small viewport, dense
 * screen, touch input. Returns helpers to drive it and a `close` to clean up.
 */
export async function openPhone({ width = 360, height = 800, dpr = 3, headed = false, gpu = true } = {}) {
  // A throwaway profile in an absolute, writable temporary folder, never the
  // person's own, and no error dialogs: if the browser has a problem it must
  // not put a window on somebody's screen.
  const profile = mkdtempSync(join(tmpdir(), 'padel-browser-'));
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--noerrdialogs',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${width},${height + 90}`,
    'about:blank',
  ];
  // The game draws with WebGL2: ask for the real graphics card, which a
  // headless browser does not always use by itself. Without it the page
  // still works, on a software renderer or on the 2D look.
  if (gpu) args.unshift('--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11');
  else args.unshift('--disable-gpu');
  if (!headed) args.unshift('--headless=new');
  const browser = spawn(findBrowser(), args, { stdio: ['ignore', 'ignore', 'pipe'] });

  const address = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('The browser did not open its DevTools port.')), 20000);
    browser.stderr.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    browser.on('exit', () => reject(new Error('The browser closed before it was ready.')));
  });

  const devtools = await Devtools.connect(address);
  const { targetId } = await devtools.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await devtools.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => devtools.send(method, params, sessionId);

  const errors = [];
  devtools.listeners.push((method, params) => {
    if (method === 'Runtime.exceptionThrown') {
      errors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      errors.push(params.args.map((arg) => arg.value ?? arg.description).join(' '));
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: dpr,
    mobile: true,
    screenOrientation: { type: 'portraitPrimary', angle: 0 },
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

  const version = await devtools.send('Browser.getVersion');

  return {
    width,
    height,
    dpr,
    /** Everything the page logged as an error or threw. */
    errors,
    browserName: version.product,
    send,

    async goto(url) {
      const loaded = devtools.waitFor('Page.loadEventFired');
      await send('Page.navigate', { url });
      await loaded;
    },

    /** Evaluates an expression in the page and returns its JSON-serialisable value. */
    async evaluate(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails) {
        throw new Error(`The page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
      }
      return result.value;
    },

    throttle: (rate) => send('Emulation.setCPUThrottlingRate', { rate }),

    /** A finger going down at (x0, y0), sliding to (x1, y1) in `ms` milliseconds and lifting. */
    async swipe(x0, y0, x1, y1, ms = 70, id = 1) {
      const point = (x, y) => [{ x: Math.round(x), y: Math.round(y), id, radiusX: 8, radiusY: 8, force: 1 }];
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x0, y0) });
      const steps = Math.max(1, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        await sleep(ms / steps);
        const k = i / steps;
        await send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: point(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k),
        });
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },

    tap(x, y) {
      return this.swipe(x, y, x, y, 40);
    },

    /**
     * Several fingers at once. Each has an id and stays down until `touchUp`:
     * what the two-thumb controls need.
     *
     * How Chrome reads the list of points is not what the protocol notes
     * suggest: a touchStart or a touchMove takes every finger that is down
     * and reports the ones that changed, but a touchEnd lifts exactly the
     * fingers it lists (all of them when the list is empty) and leaves the
     * others where they were.
     *
     * And one more thing it does not say: when two different fingers move
     * within the same frame, the emulation merges the moves and delivers the
     * second one with its coordinates divided by the pixel density. A real
     * touch screen has no such step. So a move of another finger waits for
     * the frame of the previous one to be over.
     */
    fingers: new Map(),
    lastMove: { id: -1, at: 0 },
    async settle(id) {
      const wait = this.lastMove.id !== id ? 34 - (Date.now() - this.lastMove.at) : 0;
      if (wait > 0) await sleep(wait);
      this.lastMove = { id, at: Date.now() };
    },
    touchPoints(only) {
      return [...this.fingers]
        .filter(([id]) => only === undefined || id === only)
        .map(([id, at]) => ({ x: Math.round(at.x), y: Math.round(at.y), id, radiusX: 8, radiusY: 8, force: 1 }));
    },
    async touchDown(id, x, y) {
      this.fingers.set(id, { x, y });
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.touchPoints() });
    },
    async touchMove(id, x, y) {
      if (!this.fingers.has(id)) return;
      await this.settle(id);
      this.fingers.set(id, { x, y });
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.touchPoints() });
    },
    async touchUp(id) {
      if (!this.fingers.has(id)) return;
      // The last finger lifts with an empty list, which every version accepts.
      const lifted = this.fingers.size === 1 ? [] : this.touchPoints(id);
      this.fingers.delete(id);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: lifted });
    },
    async touchReset() {
      if (this.fingers.size === 0) return;
      this.fingers.clear();
      await send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    },

    /** Every address the page asked for, to check that nothing comes from outside. */
    requests: [],
    async watchNetwork() {
      await send('Network.enable');
      devtools.listeners.push((method, params) => {
        if (method === 'Network.requestWillBeSent') this.requests.push(params.request.url);
      });
    },

    /** What every file weighed as it travelled, headers included: what a visit really downloads. */
    transfers: [],
    async watchTransfers() {
      await send('Network.enable');
      const urls = new Map();
      devtools.listeners.push((method, params) => {
        if (method === 'Network.requestWillBeSent') urls.set(params.requestId, params.request.url);
        else if (method === 'Network.loadingFinished' && urls.has(params.requestId)) {
          this.transfers.push({ url: urls.get(params.requestId), bytes: params.encodedDataLength });
        }
      });
    },

    /** Pretends the device reserves part of the screen (notch, home bar). False where the browser cannot. */
    async setSafeArea(insets) {
      try {
        await send('Emulation.setSafeAreaInsetsOverride', { insets });
        return true;
      } catch {
        return false;
      }
    },

    /** Changes the emulated phone screen. */
    async setScreen(nextWidth, nextHeight, nextDpr) {
      this.width = nextWidth;
      this.height = nextHeight;
      this.dpr = nextDpr;
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setDeviceMetricsOverride', {
        width: nextWidth,
        height: nextHeight,
        deviceScaleFactor: nextDpr,
        mobile: true,
        screenOrientation: { type: 'portraitPrimary', angle: 0 },
      });
    },

    /** Switches the page to a desktop window with a mouse and no touch screen. */
    async asDesktop(desktopWidth, desktopHeight) {
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await send('Emulation.setDeviceMetricsOverride', {
        width: desktopWidth,
        height: desktopHeight,
        deviceScaleFactor: 1,
        mobile: false,
      });
    },

    /** Left button down at (x0, y0), drag to (x1, y1) in `ms` milliseconds, release. A click when both match. */
    async mouseDrag(x0, y0, x1, y1, ms = 70) {
      const event = (type, x, y, buttons) =>
        send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1 });
      await event('mouseMoved', x0, y0, 0);
      await event('mousePressed', x0, y0, 1);
      const steps = Math.max(1, Math.round(ms / 16));
      for (let i = 1; i <= steps; i++) {
        await sleep(ms / steps);
        const k = i / steps;
        await event('mouseMoved', x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 1);
      }
      await event('mouseReleased', x1, y1, 0);
    },

    /** Presses and releases a key, given as a KeyboardEvent.code plus its legacy key code. */
    async key(code, keyCode, holdMs = 30) {
      const key = code === 'Space' ? ' ' : code.replace(/^Key/, '').toLowerCase();
      const base = { code, key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      await sleep(holdMs);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },

    /** Saves a PNG of the page as the phone shows it, or of a part of it: `clip` is { x, y, width, height } in CSS pixels. */
    async screenshot(path, clip) {
      const { writeFileSync } = await import('node:fs');
      const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      writeFileSync(path, Buffer.from(data, 'base64'));
    },

    async close() {
      await devtools.send('Browser.close').catch(() => {});
      browser.kill();
      await sleep(300);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
