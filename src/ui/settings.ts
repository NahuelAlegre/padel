import { CAST, CHARACTER_IDS } from '../characters/cast';
import type { RivalId } from '../config';
import type { ControlScheme } from '../input/pointer';
import type { AidLevel } from '../render/scene';
import type { CameraName } from '../render/view';
import { ATTITUDES, type Attitude } from '../sim/pair';

export type QualityName = 'auto' | 'high' | 'medium' | 'low';
/** How far a player gets to the ball: today's generous reach, or a real person's, the same for everybody. */
export type ReachName = 'generous' | 'real';
/** Doubles: the side of the pair the person plays, seen from its own end. */
export type SideName = 'drive' | 'reves';
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
  /**
   * Experimental, off by default: a quick match is played in doubles, the
   * person and a partner of the cast against the other two. It takes effect
   * from the next match.
   */
  doubles: boolean;
  /** Experimental: today's generous reach, or a real person's for everybody (see `realReach` in src/config.ts). */
  reach: ReachName;
  /**
   * Experimental, off by default: where the ball is met around the body
   * decides how the shot comes out, for everybody (docs/zonas.md, `zones`
   * in src/config.ts). It takes effect from the next match.
   */
  zones: boolean;
  /**
   * Doubles: drive (right) or revés (left, the one with the forehand toward
   * the middle). Revés by default: the person takes the middle, as the
   * stronger of a pair does, and that is where playing positionally pays.
   */
  side: SideName;
  /** Doubles: who plays with the person. The other two of the cast are the pair against it. */
  partner: RivalId;
  /**
   * Doubles: the attitude the person asked each partner for. Each one
   * remembers its own; one nobody asked anything plays its own attitude
   * (see `partnerAttitude`).
   */
  attitudes: Partial<Record<RivalId, Attitude>>;
}

/** How `partner` plays next to the person: what it was asked for, or its own attitude. */
export function partnerAttitude(settings: Settings, partner: RivalId): Attitude {
  return settings.attitudes[partner] ?? CAST[partner].attitude;
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
    doubles: false,
    reach: 'generous',
    zones: false,
    side: 'reves',
    partner: 'beto',
    attitudes: {},
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
    doubles: flag('doubles'),
    reach: pick(data.reach, ['generous', 'real'] as const, base.reach),
    zones: flag('zones'),
    side: pick(data.side, ['drive', 'reves'] as const, base.side),
    partner: pick(data.partner, RIVALS, base.partner),
    attitudes: readAttitudes(data.attitudes),
  };
}

/** The attitudes asked of each partner, keeping only the ones that still make sense. */
function readAttitudes(saved: unknown): Partial<Record<RivalId, Attitude>> {
  const out: Partial<Record<RivalId, Attitude>> = {};
  if (typeof saved !== 'object' || saved === null) return out;
  for (const id of RIVALS) {
    const value = (saved as Record<string, unknown>)[id];
    if (ATTITUDES.includes(value as Attitude)) out[id] = value as Attitude;
  }
  return out;
}
