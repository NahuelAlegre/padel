import type { Analytics, AnalyticsValue, Assets, Haptics, KeyValueStore, Sound } from './types';

/** Nothing to load: for tests, and for a shell with no files. The game falls back to what it can draw by itself. */
export const noAssets: Assets = {
  image: () => Promise.reject(new Error('No assets here')),
  bytes: () => Promise.reject(new Error('No assets here')),
};

/** Storage that lasts as long as the page: the fallback when nothing better works, and the one tests use. */
export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
  };
}

/** No sound: for tests, and for a shell that cannot play any. The game plays the same without it. */
export const silentSound: Sound = {
  play: () => {},
  setEnabled: () => {},
  setVolumes: () => {},
  setPaused: () => {},
  hush: () => {},
  status: () => ({ running: false, played: 0, peak: 0, rendered: 0, pending: 0, renderStartedAt: -1, club: false }),
};

export const noHaptics: Haptics = {
  available: false,
  impact: () => {},
};

/** Keeps the last events in memory, for a debug screen or a test. Nothing leaves the device. */
export function createLocalAnalytics(limit = 200): Analytics & { events: Array<{ event: string; data: Record<string, AnalyticsValue> }> } {
  const events: Array<{ event: string; data: Record<string, AnalyticsValue> }> = [];
  return {
    events,
    track(event, data = {}) {
      events.push({ event, data });
      if (events.length > limit) events.shift();
    },
  };
}
