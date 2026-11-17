import type { AILevelName } from '../config';
import type { CameraName } from '../render/view';

export type QualityName = 'auto' | 'high' | 'medium' | 'low';

export interface Settings {
  /** Assisted: the player runs by itself. Manual: virtual stick. */
  controlMode: 'assisted' | 'manual';
  stickSide: 'left' | 'right';
  difficulty: AILevelName;
  /** Game speed, 1 = real time. An accessibility option as much as a difficulty one. */
  speed: number;
  /** Games needed to win the match. */
  games: number;
  bounceMarker: boolean;
  timingAid: boolean;
  reduceMotion: boolean;
  vibration: boolean;
  camera: CameraName;
  quality: QualityName;
  showFps: boolean;
}

export const SPEEDS = [0.7, 0.85, 1] as const;
export const GAME_COUNTS = [1, 2, 3] as const;
export const QUALITY_SCALE: Record<Exclude<QualityName, 'auto'>, number> = {
  high: 1,
  medium: 0.75,
  low: 0.55,
};

const STORAGE_KEY = 'padel.settings.v1';

function defaults(): Settings {
  const reduce =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  return {
    controlMode: 'assisted',
    stickSide: 'left',
    difficulty: 'easy',
    speed: 1,
    games: 2,
    bounceMarker: true,
    timingAid: true,
    reduceMotion: reduce,
    vibration: true,
    camera: 'mid',
    quality: 'auto',
    showFps: false,
  };
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Reads the saved settings, ignoring anything missing or no longer valid. */
export function loadSettings(): Settings {
  const base = defaults();
  let saved: Partial<Record<keyof Settings, unknown>> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw) as typeof saved;
  } catch {
    // Private mode or a corrupted entry: play with the defaults.
  }
  const flag = (key: keyof Settings): boolean =>
    typeof saved[key] === 'boolean' ? (saved[key] as boolean) : (base[key] as boolean);
  return {
    controlMode: pick(saved.controlMode, ['assisted', 'manual'] as const, base.controlMode),
    stickSide: pick(saved.stickSide, ['left', 'right'] as const, base.stickSide),
    difficulty: pick(saved.difficulty, ['easy', 'normal', 'hard'] as const, base.difficulty),
    speed: pick(saved.speed, SPEEDS, base.speed),
    games: pick(saved.games, GAME_COUNTS, base.games),
    bounceMarker: flag('bounceMarker'),
    timingAid: flag('timingAid'),
    reduceMotion: flag('reduceMotion'),
    vibration: flag('vibration'),
    camera: pick(saved.camera, ['low', 'mid', 'high'] as const, base.camera),
    quality: pick(saved.quality, ['auto', 'high', 'medium', 'low'] as const, base.quality),
    showFps: flag('showFps'),
  };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Nothing to do: the settings simply last for this visit only.
  }
}
