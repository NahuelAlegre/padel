import type { Insets } from '../core/layout';

/**
 * Everything the game needs from the device it runs on, behind small
 * interfaces. Today they are implemented with browser APIs (see web.ts).
 * Wrapping the game as an app (a PWA, or Capacitor for the stores) means
 * writing another implementation of these, not touching the game.
 *
 * The rule for the rest of the code: no `localStorage`, `navigator`,
 * `location`, fullscreen or visibility APIs outside this folder. A test
 * enforces it.
 */
export interface Platform {
  assets: Assets;
  storage: KeyValueStore;
  haptics: Haptics;
  sound: Sound;
  display: Display;
  lifecycle: Lifecycle;
  analytics: Analytics;
  launch: Launch;
}

/** A picture that is decoded and can be drawn or uploaded as a texture. */
export type Picture = CanvasImageSource & { width: number; height: number };

/**
 * The game's own files: the pictures of the court and the character. They
 * travel with the game and are asked for by a path relative to its folder,
 * never by an address on the internet.
 */
export interface Assets {
  /**
   * A picture, decoded. Several paths are the same picture in several
   * formats, best first: the first one this device can decode is the answer.
   */
  image(paths: readonly string[]): Promise<Picture>;
  /**
   * A file as bytes. It fails where the shell cannot read files this way (a
   * page opened straight from disk): the game then goes without that file.
   * A big file may travel packed (a gzipped twin next to it, `<path>.gz`);
   * what comes back is always the file itself.
   */
  bytes(path: string): Promise<ArrayBuffer>;
}

/**
 * Small persistent storage. Asynchronous on purpose: native stores are, and
 * this way swapping one in changes nothing for the callers.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type HapticStrength = 'light' | 'medium' | 'heavy';

export interface Haptics {
  /** False where the device cannot vibrate: the option is then hidden. */
  readonly available: boolean;
  impact(strength: HapticStrength): void;
}

/** Sounds are asked for by what happened, not by file name. */
export type SoundCue = 'hit' | 'bounce' | 'glass' | 'fence' | 'net' | 'pointWon' | 'pointLost' | 'tap';

export interface Sound {
  /** `intensity` is 0..1: how hard the ball was hit, how loud the bounce. */
  play(cue: SoundCue, intensity?: number): void;
  setEnabled(enabled: boolean): void;
}

export interface Display {
  /** Space the device keeps for itself (notch, rounded corners, home bar), in CSS pixels. */
  safeArea(): Insets;
  /** The system asks for less motion. */
  prefersReducedMotion(): boolean;
  /** Whether the game can take the whole screen and hold it upright. */
  readonly canGoImmersive: boolean;
  /** Fullscreen and locked to portrait, where the device allows it. Resolves to whether it worked. */
  setImmersive(on: boolean): Promise<boolean>;
}

export interface Lifecycle {
  /** The game is no longer in front of the person: another tab, another app, the screen off. */
  onBackground(listener: () => void): void;
  /**
   * The system "back" action (the Android button). The listener returns true
   * when it handled it. Browsers have no such thing; a native shell does.
   */
  onBack(listener: () => boolean): void;
}

export type AnalyticsValue = string | number | boolean;

/** Hooks for measuring. What is done with them is up to the platform; nothing personal goes in. */
export interface Analytics {
  track(event: string, data?: Record<string, AnalyticsValue>): void;
}

export interface Launch {
  /** Milliseconds since the page or app started loading. */
  elapsed(): number;
  /** Developer switches (on the web, the query string). The game never depends on them. */
  flag(name: string): boolean;
}
