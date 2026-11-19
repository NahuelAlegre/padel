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
export type SoundCue = 'hit' | 'bounce' | 'glass' | 'fence' | 'net' | 'netCord' | 'step' | 'split' | 'slide' | 'swing';

/** Where on the court a sound happens, and how strong it is. */
export interface SoundPlace {
  /** 0..1: how hard the ball was hit, how fast it bounced, how fast a player ran. */
  intensity: number;
  /** -1 left .. 1 right, as the camera sees the court. */
  pan: number;
  /** 0 at the near end of the court, 1 at the far end: far is quieter and duller. */
  depth: number;
  /** Seconds into the sound to start from: a swing noticed a little late. */
  offset: number;
}

/**
 * The game's sound. Nothing the game needs to be played goes only through
 * it: the game plays the same in silence.
 */
export interface Sound {
  play(cue: SoundCue, place?: Partial<SoundPlace>): void;
  /** Everything on or off. */
  setEnabled(enabled: boolean): void;
  /** 0..1 each: the sounds of the match, and the club around it. */
  setVolumes(effects: number, ambience: number): void;
  /** Pause: everything stops where it is, quiet, until it is false again. */
  setPaused(paused: boolean): void;
  /** Stops the sounds of the match that are still ringing. The club goes on. */
  hush(): void;
  /** How it is doing, for checks and a debug screen. */
  status(): SoundStatus;
}

export interface SoundStatus {
  /** The device is producing sound right now (woken up, not paused, not hidden). */
  running: boolean;
  /** Sounds of the match started so far. */
  played: number;
  /** Most sounds ever playing at once. */
  peak: number;
  /** Takes rendered so far, and still to render. */
  rendered: number;
  pending: number;
  /** Milliseconds since load at which rendering started; -1 before. */
  renderStartedAt: number;
  /** The club around the court is playing. */
  club: boolean;
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
  /** The value given to a developer switch (`?alcance=real` gives "real"), or null when there is none. */
  value(name: string): string | null;
  /**
   * Opens the game again with these developer switches (`"estudio"`), or
   * with none (`""`): the way into the animation studio and out of it.
   */
  reopen(switches: string): void;
  /**
   * Writes these switches where they are kept (the address, on the web)
   * without opening anything again: what is on show, for opening it again.
   */
  note(switches: string): void;
}
