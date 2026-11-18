import type { Analytics, AnalyticsValue, Haptics, KeyValueStore, Sound } from './types';

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

/** There is no sound yet: the game already says when one should play, and this ignores it. */
export const silentSound: Sound = {
  play: () => {},
  setEnabled: () => {},
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
