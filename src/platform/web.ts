import type { Insets } from '../core/layout';
import { createLocalAnalytics, createMemoryStore } from './memory';
import { createWebSound } from './sound';
import type { Assets, Display, Haptics, HapticStrength, KeyValueStore, Launch, Lifecycle, Picture, Platform } from './types';

/**
 * The browser implementation of the platform. Everything that is specific to
 * running inside a web page lives in this file.
 */

function loadImage(path: string): Promise<Picture> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${path}`));
    image.src = path;
  });
}

/** One white pixel as AVIF. Whether the browser decodes it says whether it can show the format. */
const AVIF_PROBE =
  'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAIgAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAKm1kYXQSAAoIGAAGiAhoNCAyFBlHh4Yhh5555oJAAJBBGex24O9g';

async function fetchBytes(path: string): Promise<ArrayBuffer> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return response.arrayBuffer();
}

/**
 * Paths are relative to the page, so the same build works in a subfolder, in
 * a native shell and from disk. From disk the browser refuses to read plain
 * files with `fetch`: pictures still load, the rest does not.
 */
function createWebAssets(): Assets {
  // Asked once. Without this, a browser that cannot decode AVIF would
  // download every picture in it for nothing before falling back.
  const avif = loadImage(AVIF_PROBE).then(
    (image) => image.width > 0,
    () => false,
  );
  return {
    async image(all) {
      const paths = (await avif) ? all : all.filter((path) => !path.endsWith('.avif'));
      let last: unknown = new Error('No picture to load');
      for (const path of paths) {
        try {
          return await loadImage(path);
        } catch (error) {
          // This device cannot decode that format, or the file is not there: try the next one.
          last = error;
        }
      }
      throw last;
    },
    async bytes(path) {
      // A host of static files does not always compress a file it does not
      // know, so the big ones are shipped twice: as they are, and gzipped.
      // A browser that can unpack asks for the small one.
      if (typeof DecompressionStream === 'function') {
        try {
          const packed = await fetchBytes(`${path}.gz`);
          const head = new Uint8Array(packed, 0, 2);
          // Some servers unpack a .gz on the way: then this is the file itself already.
          if (head[0] !== 0x1f || head[1] !== 0x8b) return packed;
          const unpacked = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
          return await new Response(unpacked).arrayBuffer();
        } catch {
          // No packed twin, or it would not unpack: the file as it is.
        }
      }
      return fetchBytes(path);
    },
  };
}

function createWebStore(): KeyValueStore {
  let backing: Storage | null = null;
  try {
    // Private modes and some embedded views throw on access or on write.
    const probe = '__padel_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    backing = window.localStorage;
  } catch {
    backing = null;
  }
  if (!backing) return createMemoryStore();

  // Safari drops the storage of a site that is not opened for a week. Asking
  // for persistence is free, and it is granted to installed web apps.
  try {
    void navigator.storage?.persist?.().catch(() => false);
  } catch {
    // Not available: nothing to do.
  }

  const store = backing;
  return {
    get: async (key) => {
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    set: async (key, value) => {
      try {
        store.setItem(key, value);
      } catch {
        // Full or blocked: the value just does not outlive this visit.
      }
    },
    remove: async (key) => {
      try {
        store.removeItem(key);
      } catch {
        // Same as above.
      }
    },
  };
}

const VIBRATION_MS: Record<HapticStrength, number> = { light: 10, medium: 16, heavy: 26 };

function createWebHaptics(): Haptics {
  const available = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  return {
    available,
    impact(strength) {
      if (!available) return;
      // Browsers only allow vibration after the person has touched the page.
      if (navigator.userActivation?.hasBeenActive === false) return;
      navigator.vibrate(VIBRATION_MS[strength]);
    },
  };
}

function createWebDisplay(): Display {
  // The safe area only exists as CSS environment variables: an invisible
  // element padded with them is the way to read it from a script.
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;inset:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.append(probe);

  const root = document.documentElement;
  const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
  return {
    safeArea(): Insets {
      const style = getComputedStyle(probe);
      return {
        top: parseFloat(style.paddingTop) || 0,
        right: parseFloat(style.paddingRight) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0,
      };
    },
    prefersReducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    canGoImmersive: typeof root.requestFullscreen === 'function' && document.fullscreenEnabled === true,
    async setImmersive(on) {
      try {
        if (on) {
          if (!document.fullscreenElement) await root.requestFullscreen({ navigationUI: 'hide' });
          // Only some browsers can lock the orientation, and only in fullscreen.
          await orientation.lock?.('portrait').catch(() => {});
          return document.fullscreenElement !== null;
        }
        if (document.fullscreenElement) await document.exitFullscreen();
        return true;
      } catch {
        return false;
      }
    },
  };
}

function createWebLifecycle(): Lifecycle {
  const background: Array<() => void> = [];
  const hidden = (): void => {
    for (const listener of background) listener();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hidden();
  });
  // Safari does not always report a page being put away as a visibility change.
  window.addEventListener('pagehide', hidden);
  return {
    onBackground: (listener) => {
      background.push(listener);
    },
    // A web page has no system "back" to listen to. A native shell wires this.
    onBack: () => {},
  };
}

function createWebLaunch(): Launch {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    params = new URLSearchParams();
  }
  return {
    elapsed: () => performance.now(),
    flag: (name) => params.has(name),
  };
}

export function createWebPlatform(): Platform {
  return {
    assets: createWebAssets(),
    storage: createWebStore(),
    haptics: createWebHaptics(),
    sound: createWebSound(),
    display: createWebDisplay(),
    lifecycle: createWebLifecycle(),
    analytics: createLocalAnalytics(),
    launch: createWebLaunch(),
  };
}
