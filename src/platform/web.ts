import type { Insets } from '../core/layout';
import { createLocalAnalytics, createMemoryStore, silentSound } from './memory';
import type { Display, Haptics, HapticStrength, KeyValueStore, Launch, Lifecycle, Platform } from './types';

/**
 * The browser implementation of the platform. Everything that is specific to
 * running inside a web page lives in this file.
 */

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
    storage: createWebStore(),
    haptics: createWebHaptics(),
    sound: silentSound,
    display: createWebDisplay(),
    lifecycle: createWebLifecycle(),
    analytics: createLocalAnalytics(),
    launch: createWebLaunch(),
  };
}
