import { CHARACTER_IDS } from '../characters/cast';
import type { RivalId } from '../config';
import type { ControlScheme } from '../input/pointer';
import type { AidLevel } from '../render/scene';
import type { CameraName } from '../render/view';

export type QualityName = 'auto' | 'high' | 'medium' | 'low';
/** How often the rival has something to say after a point. */
export type LineFrequency = 'many' | 'few' | 'none';

export interface Settings {
  /** 'two': stick plus hold-aim-release. 'one': drag to move, flick to hit. */
  scheme: ControlScheme;
  stickSide: 'left' | 'right';
  /** Accessibility: the player runs to the ball by itself. Off by default. */
  assistedMovement: boolean;
  rival: RivalId;
  /** Game speed, 1 = real time. For playing at one's own pace. */
  speed: number;
  /**
   * How much help is on screen. Very little by default: one signal for when
   * to hit. Everything is still there for whoever wants or needs it.
   */
  aids: AidLevel;
  /** The rival's speech bubbles. Nothing needed to play is ever said in them. */
  lines: LineFrequency;
  reduceMotion: boolean;
  vibration: boolean;
  /** Sound on or off. The game plays the same in silence: nothing needed to play is only heard. */
  sound: boolean;
  /** 0..1: the sounds of the match, and the club around it. Quiet by default. */
  effects: number;
  ambience: number;
  /** Some like the camera that goes with the play, some the still one. With reduced motion it is always still. */
  camera: CameraName;
  quality: QualityName;
  fullscreen: boolean;
  showFps: boolean;
}

export const SPEEDS = [0.6, 0.8, 1] as const;
export const VOLUMES = [0, 0.25, 0.5, 0.75, 1] as const;
/** Easiest first. */
export const RIVALS: readonly RivalId[] = CHARACTER_IDS;
export const QUALITY_SCALE: Record<Exclude<QualityName, 'auto'>, number> = {
  high: 1,
  medium: 0.75,
  low: 0.55,
};

export function defaultSettings(reduceMotion: boolean): Settings {
  return {
    scheme: 'two',
    stickSide: 'left',
    assistedMovement: false,
    rival: 'beto',
    speed: 1,
    aids: 'minimal',
    lines: 'many',
    reduceMotion,
    vibration: true,
    sound: true,
    effects: 0.5,
    ambience: 0.25,
    camera: 'follow',
    quality: 'auto',
    fullscreen: false,
    showFps: false,
  };
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Builds valid settings out of whatever was stored, ignoring anything missing or no longer valid. */
export function readSettings(saved: unknown, reduceMotion: boolean): Settings {
  const base = defaultSettings(reduceMotion);
  const data = (typeof saved === 'object' && saved !== null ? saved : {}) as Partial<Record<keyof Settings, unknown>>;
  const flag = (key: keyof Settings): boolean =>
    typeof data[key] === 'boolean' ? (data[key] as boolean) : (base[key] as boolean);
  return {
    scheme: pick(data.scheme, ['two', 'one'] as const, base.scheme),
    stickSide: pick(data.stickSide, ['left', 'right'] as const, base.stickSide),
    assistedMovement: flag('assistedMovement'),
    rival: pick(data.rival, RIVALS, base.rival),
    speed: pick(data.speed, SPEEDS, base.speed),
    aids: pick(data.aids, ['full', 'minimal', 'none'] as const, base.aids),
    lines: pick(data.lines, ['many', 'few', 'none'] as const, base.lines),
    reduceMotion: flag('reduceMotion'),
    vibration: flag('vibration'),
    sound: flag('sound'),
    effects: pick(data.effects, VOLUMES, base.effects as (typeof VOLUMES)[number]),
    ambience: pick(data.ambience, VOLUMES, base.ambience as (typeof VOLUMES)[number]),
    camera: pick(data.camera, ['follow', 'fixed'] as const, base.camera),
    quality: pick(data.quality, ['auto', 'high', 'medium', 'low'] as const, base.quality),
    fullscreen: flag('fullscreen'),
    showFps: flag('showFps'),
  };
}
