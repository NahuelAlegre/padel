import type { CallKind } from '../../sim/pair';
import type { MannerismClip, TellCue, TellPose } from '../../characters/types';
import { clamp, smoothstep } from '../../core/math';
import type { ScenePlayer } from '../scene';
import type { RacketFace } from '../stage/contact';
import {
  blendPose,
  boneToCharacter,
  createSkeleton,
  multiplyQuaternions,
  samplePose,
  skinMatrices,
  solveSkeleton,
  stand,
  twistHips,
  widen,
  type Character,
  type Clip,
  type Skeleton,
  type Style,
} from './character';
import { armOf, elbowOf, keepElbow, keepWrist, legOf, reachLimb, worldRotations, wristOf, type Elbow, type Limb, type Wrist } from './reach';

/**
 * Turns what the simulation says about a player into the pose of its body.
 *
 * The simulation knows where the player is, how fast it moves, whether it has
 * the racket back or is swinging, which stroke that is and when the racket
 * meets the ball. The clips know what a run or a forehand looks like. This is
 * what goes in between:
 *
 *   - Legs follow the ground. A cycle advances with the metres really
 *     covered, so the feet do not skate at any speed. Which cycle depends on
 *     where the body is going next to where it faces (forward, backward or
 *     sideways), and the pelvis turns for what is left of the difference.
 *   - A stroke is stretched in time so that the frame of the clip in which
 *     the racket meets the ball falls on the instant the simulation hits it.
 *     What is stretched is the windup: armed early, the body takes the racket
 *     back and waits there; the swing itself keeps its own pace.
 *   - The upper body can be in a stroke while the legs keep running: a player
 *     may be moved while it aims.
 *   - The ball is where the simulation says, not where the clip expects it,
 *     and the body gets there the way a person does: never by sliding over
 *     the floor. Around the contact the hips sink for a low ball, down to a
 *     knee near the floor; for one further away the front foot steps toward
 *     it while the back one stays planted, and the hips go after the step;
 *     a jump is made smaller for a ball that is not so high. The arm takes
 *     the racket a little further, never by force: what it does not reach,
 *     it does not reach, and the swing goes on as the clip has it.
 *   - Elbows and knees bend only the way they bend, and every wrist is kept
 *     within its range, whatever the clips and the reach ask of them.
 *   - Just before the rival hits, somebody standing takes a little hop.
 *   - A character adds its own on top: how it stands and how wide it
 *     gestures, the windup that gives its shot away, a short tic between
 *     points and what it does when a point is won or lost.
 *   - Changes are cross-faded, never cut.
 *   - The head follows the ball and the braid swings behind the movement.
 *
 * Everything the clips say about themselves comes from the file (see
 * design/prueba-3d): metres per cycle, moment of contact, where the racket is
 * then, which part is the windup. A clip that does not say gets something
 * reasonable.
 */

/** Metres one cycle of each way of moving covers at life size, for clips that do not say. */
const DEFAULT_STRIDE: Record<string, number> = { correr: 1.8, correr_atras: 1.3, lateral_izq: 1.35, lateral_der: 1.35 };
/** Which way each cycle goes, in the character's axes, for clips that do not say. */
const DEFAULT_DIR: Record<string, [number, number]> = {
  correr: [0, -1],
  correr_atras: [0, 1],
  lateral_izq: [1, 0],
  lateral_der: [-1, 0],
};
/** Below this speed, in metres per second, the player is standing. */
const STANDING_SPEED = 0.45;
/** Up to this far from straight ahead it runs forward; from this far on, backward; in between, sideways. Radians. */
const FORWARD_UNTIL = (60 * Math.PI) / 180;
const BACKWARD_FROM = (125 * Math.PI) / 180;
/** A cycle is not changed for another until the direction is this far past the line between them. */
const GAIT_STICK = (8 * Math.PI) / 180;
/** The pelvis turns no further than this for a cycle that does not go quite where the body goes. */
const MOST_TWIST = (50 * Math.PI) / 180;
/** Seconds a change of clip takes to fade in. */
const FADE = 0.14;
/** Seconds a stroke takes to take over the upper body, and to give it back. */
const STROKE_IN = 0.12;
const STROKE_OUT = 0.2;
/**
 * A stroke asked for at the last moment (a flick, a key, a thumb let go as
 * the ball arrives) has no time to fade in: it is there by the time the ball
 * is, in no less than this. It reads as a quick swing, not as a jump.
 */
const QUICKEST = 0.035;
/** A player that moved further than this between two frames did not run there: it was put there. */
const TELEPORT = 1.5;
/**
 * How the body gets to a ball that is not where the clip meets it. In
 * metres at life size, in the character's own axes.
 *
 * The arm takes a little by itself; for more, the hips go toward the ball
 * with the feet where they are; for more than that, the front foot steps
 * toward it and the hips go after the step. What not even that reaches, the
 * whole figure goes after, and the feet follow it with steps: with the reach
 * of a real person that is next to nothing.
 */
const BODY = {
  /** What the arm takes before the body moves at all. */
  armEasy: 0.16,
  /**
   * The most the arm takes the hand from where the stroke has it: the swing
   * still looks like itself, the elbow a little more or less bent, never
   * thrown at the ball. Past `armSoft` it gives less and less, so it never
   * stops dead at the most.
   */
  arm: 0.32,
  armSoft: 0.16,
  /**
   * A block is all arm: no swing, nothing else moves, and the racket is put
   * in front of the body, which an elbow folds to without strain.
   */
  armBlock: 0.4,
  armBlockSoft: 0.3,
  /** Of that, how much is across the floor: past it the figure slides. */
  armAcross: 0.34,
  /** How far the hips go toward the ball with the feet where they are; running, leaning into it, a little more. */
  shift: 0.12,
  shiftRun: 0.24,
  /** How much of a step the hips go after. */
  follow: 0.6,
  /** The longest step toward the ball beyond the clip's own, for a stroke and for one at full stretch. */
  step: 0.45,
  stepStretch: 0.5,
  /** Running: how much further toward the ball the last stride can come down. */
  runLunge: 0.5,
  /** The feet are never closer than this. */
  apart: 0.3,
  /** A ball lower than the clip expects by this much the arm takes; for more, the hips sink. */
  lowFree: 0.04,
  /** The lowest the hips go: the knees bent all the way, the back one near the floor. Hips at rest are at 0.95. */
  lowest: 0.4,
  /** A ball higher than the clip expects: the knees straighten up to this much before the arm takes the rest. */
  rise: 0.14,
  riseFree: 0.06,
};
/** The step toward the ball is taken this long before the contact, and taken back this long after it. Seconds. */
const STEP_BEFORE = 0.34;
const STEP_BACK = 0.4;
/**
 * The hand lets go of the ball this long after the contact, in seconds: the
 * follow-through is the clip's. Held on to for longer, the arm keeps reaching
 * for a ball that is gone while the clip swings across the body, and the
 * elbow folds the wrong way.
 */
const LET_GO = 0.1;
/** A call to the partner gives the arm back this long before the player's own contact, in seconds. */
const CALL_CLEAR = 0.3;
/** Seconds a gesture of a character takes to show, and to go away. */
const GESTURE_IN = 0.14;
const GESTURE_OUT = 0.12;
/** Seconds the «perdón» of a stolen ball that went wrong lasts. */
const SORRY = 0.9;
/** How fast a short piece of a clip in the middle of play comes in and goes, in seconds. */
const FLASH_IN = 0.08;
const FLASH_OUT = 0.12;
/**
 * The computer swung and did not get there: a moment after the swing, the
 * trunk and the head of the lament (head down, «no» with the head), over
 * whatever the legs are doing. Seconds after the contact, and the piece of
 * the clip.
 */
const MISS_AFTER = 0.12;
const MISS_FROM = 0.12;
const MISS_TO = 0.6;
/** And on the way, the arm goes after the ball only this much of what is left. */
const MISS_ARM = 0.75;
/** A hurried stroke: no windup until this long before the contact, in seconds, and the legs still running. */
const HURRY_LEAD = 0.2;
const HURRY_LEGS = 0.35;
/**
 * A long point gets to the body: lower and wider, the trunk forward, as much
 * as this at the most (metres, metres and radians). Only while it waits.
 */
const TENSE = { crouch: 0.07, stance: 0.045, lean: 0.12 };
/**
 * A tell is a windup: it is held until this long before the contact, in
 * seconds, and then it lets go, so that the swing itself is the stroke's.
 * The racket lets go first, because the swing needs it; the free hand, the
 * hips and the feet can keep saying it a little longer.
 */
const TELL_RACKET_UNTIL = 0.3;
const TELL_BODY_UNTIL = 0.16;
/** Heights of the ball next to the body, in metres at life size, that decide which stroke the body plays. */
const HEIGHTS = {
  /** From here up a smash is the jumping one; below, the one with the feet on the floor. */
  smash: 1.9,
  /** From here up a shot meant to come from above does; below, it is a high volley. */
  above: 1.5,
  /** From here up any ball is played from above, whatever the shot is called. */
  aboveAnyway: 2.0,
  /**
   * From here up a volley is played as one; below, a ball this low in the air
   * (half a volley) is played with the stroke of a drive. Measured on the
   * figure, which is drawn bigger than life: a volley at the chest of a person
   * is at the waist of the rival drawn half as big again, and still a volley,
   * the knees bent for it.
   */
  volley: 0.75,
  /** From here up a short ball (a drop shot) is played with the stroke of a volley. */
  drop: 1.05,
  /** From here up a ball that has bounced is taken like a volley. */
  shoulder: 1.1,
  /** Up to here a ball far to the side is reached for at full stretch. */
  stretch: 1.2,
};
/**
 * The stroke at full stretch is for a ball beyond what a person reaches
 * standing: further than `STANDING_REACH` metres from the feet on the court
 * (the reach of a real person, `config.player.real.reach`), or further than
 * `STRETCH_FROM` to the side in the character's own metres, whatever size it
 * is drawn at. Either way the ball has to be mostly to the side, at least
 * `STRETCH_ASIDE` of the character's metres: for one far ahead the front foot
 * steps forward instead.
 */
const STANDING_REACH = 1.15;
const STRETCH_FROM = 0.95;
const STRETCH_ASIDE = 0.55;
/** Near the contact a stroke is not changed for another of the same side: the body gets to the ball instead. Seconds. */
const STROKE_SETTLED = 0.15;
/**
 * A foot on the floor stays where it is on the court. When the pose wants it
 * further than this from there, in metres on the court, it steps; near a
 * contact, only for more than the second. Running, the feet are the run's:
 * they stay where they are only below the first speed, in metres per second,
 * and not at all from the second.
 */
const FOOT_DRIFT = 0.07;
const FOOT_DRIFT_SET = 0.12;
/**
 * A foot wanted this much further than that, in metres on the court, steps
 * even while the other one is in the air in the pose: the leg would not reach.
 */
const FOOT_FAR = 0.26;
const PLANTED_UNTIL = 0.8;
const PLANTED_FROM = 1.3;
/** Past this much of a step, where it comes down is settled. */
const STEP_SETTLES = 0.6;
/** How close to the floor the joint of a knee gets, in metres at life size: with the kneecap, a knee nearly on it. */
const KNEE_FLOOR = 0.08;
/** A jump made smaller still lifts the feet this much of what the clip lifts them. */
const JUMP_KEEPS = 0.4;
/**
 * The head of the racket, in metres at life size: how far from its middle a
 * ball hit with it is drawn (the sweet part of a head 25 cm across), and half
 * its thickness.
 */
const RACKET_FACE = { reach: 0.06, half: 0.02 };

/** Bones that belong to the legs: they follow the ground when the player moves. */
const LEG_BONES = ['thigh.L', 'shin.L', 'foot.L', 'toe.L', 'thigh.R', 'shin.R', 'foot.R', 'toe.R'];
/** Strokes played over the head. */
const OVERHEAD: ReadonlySet<string> = new Set(['bandeja', 'remate']);
/** Tics that have a clip of their own. The rest are a few places for the hands to be. */
const MANIA_CLIPS: Partial<Record<MannerismClip, string>> = {
  cap: 'mania_gorra',
  glasses: 'mania_gorra',
  shoeTap: 'mania_zapatilla',
  wave: 'mania_saludo',
};

export interface AnimatedFigure {
  /** Where the body is drawn, on the court: where the simulation has the player, unless the ball is out of a body's reach. */
  x: number;
  y: number;
  /** The matrix of every bone. */
  bones: Float32Array;
}

/** What is going on around a player that the simulation does not say about the player itself. */
export interface Moment {
  /** Seconds until a rival hits the ball, when one is about to. Infinity otherwise. */
  rivalHitIn: number;
  /** This player is about to serve and has the ball in its hand. */
  holding: boolean;
  /** Between points: nobody is playing. */
  resting: boolean;
}

const PLAYING: Moment = { rivalHitIn: Infinity, holding: false, resting: false };

/** What a clip says about its own stroke, with something sensible where it says nothing. */
export function contactOf(clip: Clip): number {
  return clip.contact ?? clip.dur * 0.52;
}

/** Where the windup of a stroke ends: up to there the clip can be held; from there on it is in step with the ball. */
export function holdOf(clip: Clip): number {
  const contact = contactOf(clip);
  return clip.armado ? Math.min(clip.armado[1], contact) : Math.max(0, contact - Math.min(0.24, contact * 0.6));
}

export function strideOf(clip: Clip): number {
  return clip.zancada ?? DEFAULT_STRIDE[clip.name] ?? 1.3;
}

/**
 * Which clip plays a stroke of the simulation. `k` is how much bigger than
 * life the player is drawn: a ball two metres up is over the head of somebody
 * life-sized and at the chest of somebody drawn half as big again, and it is
 * the body that has to look right. `has` says which clips there are: one that
 * is missing is replaced by the nearest one.
 */
export function strokeClipName(player: ScenePlayer, k = 1, has: (name: string) => boolean = () => true): string {
  if (player.anim === 'serve') return 'saque';
  // Forehand: the ball is on the side the racket hand is on.
  const forehand = player.animSide === player.restSide;
  const side = (name: string): string => (forehand ? name : `${name}_reves`);
  const plain = forehand ? 'derecha' : 'reves';
  const pick = (name: string, otherwise: string): string => (has(name) ? name : otherwise);
  const height = player.reachZ / k;
  const fromAbove = player.shot === 'smash' || player.shot === 'bandeja' || player.shot === 'vibora';
  if (fromAbove) {
    if (player.shot === 'smash' && height >= HEIGHTS.smash) return 'remate';
    if (height >= HEIGHTS.above) return pick('bandeja', 'remate');
    return pick(side('volea'), plain);
  }
  if (height >= HEIGHTS.aboveAnyway) return pick('bandeja', 'remate');
  // A ball beyond the reach of somebody standing, to the side and not high: the body throws itself after the racket.
  const aside = Math.abs(player.reachX) / k;
  const far = Math.hypot(player.reachX, player.reachY);
  if (height <= HEIGHTS.stretch && aside >= STRETCH_ASIDE && (aside >= STRETCH_FROM || far >= STANDING_REACH)) {
    return pick(side('estirada'), plain);
  }
  switch (player.shot) {
    case 'lob':
      return forehand ? 'globo' : 'reves';
    case 'volley':
      return height >= HEIGHTS.volley ? pick(side('volea'), plain) : plain;
    case 'drop':
      return height >= HEIGHTS.drop ? pick(side('volea'), plain) : plain;
    default:
      return height >= HEIGHTS.shoulder ? pick(side('volea'), plain) : plain;
  }
}

/** The side of the body a stroke clip plays the ball on. */
function sideOf(clip: Clip): 'derecha' | 'reves' {
  return clip.lado ?? (clip.name.includes('reves') ? 'reves' : 'derecha');
}

/**
 * The foot that steps toward the ball in a stroke: 0 the left, 1 the right,
 * -1 none (the smash is played in the air, the serve where the ball is
 * dropped). A forehand steps in with the left foot and a backhand with the
 * right; at full stretch it is the other way round, the foot on the side of
 * the ball going after it.
 */
export function steppingFoot(clip: Clip): number {
  if (clip.name === 'remate' || clip.name === 'saque') return -1;
  const stretch = clip.estirada === true || clip.name.startsWith('estirada');
  return (sideOf(clip) === 'reves') !== stretch ? 1 : 0;
}

/** The clip of a block: the volley on the side of the ball, or the stroke of a drive in an older file. */
function blockClip(player: ScenePlayer, has: (name: string) => boolean): string {
  const forehand = player.animSide === player.restSide;
  const volley = forehand ? 'volea' : 'volea_reves';
  return has(volley) ? volley : forehand ? 'derecha' : 'reves';
}

/**
 * Which moment of a stroke clip to show `eta` seconds before the contact
 * (negative after it), given the moment that was shown `dt` seconds ago.
 *
 * From the end of the windup on, the clip is in step with the simulation: the
 * contact frame falls on the contact, and the swing keeps its own pace.
 * Before that the body goes through its windup, faster if there is little
 * time, and then holds the racket back for as long as it takes.
 */
export function strokeTime(clip: Clip, eta: number, previous: number, dt: number): number {
  const contact = contactOf(clip);
  const hold = holdOf(clip);
  const inStep = contact - eta;
  if (inStep >= hold) return Math.min(inStep, clip.dur);
  const at = Math.max(previous, 0);
  // Seconds of windup left to show, and real seconds left to show them in.
  const left = hold - at;
  const time = eta - (contact - hold);
  const rate = Number.isFinite(time) && time > 1e-3 ? Math.max(1, left / time) : 1;
  return Math.min(at + dt * rate, hold);
}

/**
 * What a character does with its body on top of whatever it is doing: a few
 * places for its limbs to be. In the character's own axes at life size: x to
 * its left, which is the side of the free hand; -y in front of it; z up.
 */
interface Gesture {
  /** Where the free hand goes, and the hand with the racket. */
  free: [number, number, number] | null;
  racket: [number, number, number] | null;
  /** How far the hips drop, and how much further apart each foot is planted. */
  crouch: number;
  stance: number;
  /** The head tips to one side, in radians. */
  tip: number;
  /** A step toward the net, in metres. */
  step: number;
  /** The trunk leans forward (backward, if less than 0), in radians. */
  lean: number;
  /** The hips sit back over the heels, in metres. */
  back: number;
}

function noGesture(): Gesture {
  return { free: null, racket: null, crouch: 0, stance: 0, tip: 0, step: 0, lean: 0, back: 0 };
}

/**
 * The computer read the ball later than it usually does (a drop shot with it
 * at the back, a perfect shot hiding where it goes): for a moment it is
 * caught on its heels, the racket coming up late, before it gets going.
 */
function surpriseGesture(out: Gesture): void {
  out.free = [0.44, -0.12, 1.18];
  out.racket = [-0.18, -0.34, 1.34];
  out.lean = -0.16;
  out.back = 0.07;
}

/**
 * A ball fired at its body before it read it: the racket blocks on its own
 * (see the stroke), and the rest of the body flinches. The head tips away
 * from the ball, and on the forehand the free hand comes up beside the face,
 * where it can be seen from behind too; on the backhand it goes with the
 * racket, as the volley has it. The hips stay where they are: a block is all
 * arm, and ducking would take the racket off the ball.
 */
function flinchGesture(forehand: boolean, out: Gesture): void {
  out.free = forehand ? [0.4, -0.18, 1.5] : null;
  // Away from the ball: to its left when the ball comes on the side of the racket.
  out.tip = forehand ? 0.22 : -0.22;
}

/**
 * «Perdón»: a ball it stole from its partner and lost. The free hand goes up,
 * open, toward the partner, and the head tips that way. `toward` is where
 * the partner is, in metres to the character's left.
 */
function sorryGesture(t: number, toward: number, out: Gesture): void {
  const side = clamp(toward / 2.4, -1, 1);
  out.free = [0.2 + side * 0.24, -0.3, 1.62 + Math.sin(t * 9) * 0.02];
  out.tip = side * 0.22;
  out.lean = 0.06;
}

/** The windup that gives a shot away. `across` is where the ball will go, in metres to the character's left. */
function tellGesture(pose: TellPose, kind: TellCue, across: number, out: Gesture): void {
  switch (pose) {
    case 'pointAim':
      // The free hand points to where the ball will go: to that side, and up for a lob.
      out.free = [clamp(across / 2.4, -1, 1) * 0.5, -0.42, kind === 'lob' ? 1.85 : kind === 'drop' ? 1.05 : 1.45];
      break;
    case 'plantWide':
      // Legs wide apart and the racket behind the head: something hard is coming.
      out.racket = [-0.24, 0.1, 1.72];
      out.free = [0.4, -0.25, 1.2];
      out.stance = 0.2;
      out.crouch = 0.07;
      break;
    case 'crouchOpenFace':
      // Knees bent and the racket low, its face open.
      out.racket = [-0.5, -0.3, 0.6];
      out.free = [0.38, -0.25, 0.92];
      out.crouch = 0.24;
      out.stance = 0.06;
      break;
    case 'stepIn':
      // A small step toward the net, standing tall.
      out.racket = [-0.4, -0.3, 1.02];
      out.step = 0.25;
      break;
  }
}

/**
 * Doubles: what a player tells its partner, with the free arm, `t` seconds
 * after it said it. `toward` is where the partner is, in metres to the
 * character's left. Every character does it the same way, so it is learnt once.
 */
function callGesture(kind: CallKind, t: number, toward: number, out: Gesture): void {
  const beat = Math.sin(t * 14);
  const side = clamp(toward / 2.4, -1, 1);
  switch (kind) {
    case 'mine':
      // The free hand straight up: this one is mine.
      out.free = [0.16, -0.12, 2.12 + beat * 0.03];
      break;
    case 'yours':
      // The free hand points at the partner, and the head goes with it: yours.
      out.free = [side * 0.55, -0.32, 1.32];
      out.tip = side * 0.18;
      break;
    case 'switch':
      // The arm sweeps across, to where the partner has to go: I go, you cross.
      out.free = [side * (0.35 + 0.1 * (beat + 1)), -0.15, 1.55];
      break;
    case 'up':
      // Beckoning forward: up to the net, together.
      out.free = [0.18, -0.5, 1.5 + beat * 0.12];
      break;
    case 'back':
      // Pointing back over the shoulder: back, together.
      out.free = [0.22, 0.32, 1.8];
      break;
  }
}

/** A tic between points that has no clip of its own, `t` seconds into it. */
function actGesture(clip: MannerismClip, t: number, duration: number, out: Gesture): void {
  const beat = Math.sin(t * 16);
  switch (clip) {
    case 'cap':
      out.free = [0.08, -0.12, 1.72];
      break;
    case 'glasses':
      out.free = [0.06, -0.17, 1.6];
      break;
    case 'whistle':
      out.free = [0.04, -0.17, 1.52];
      break;
    case 'sleeves':
      // The free hand goes across to the other shoulder and tugs.
      out.free = [-0.2, -0.1, 1.4 + beat * 0.03];
      break;
    case 'wave':
      out.free = [0.42 + beat * 0.12, -0.05, 1.95];
      break;
    case 'neck':
      out.tip = Math.sin((t / duration) * Math.PI * 2) * 0.32;
      break;
    case 'kissRacket':
      out.racket = [-0.1, -0.24, 1.5];
      break;
    case 'shoeTap':
      out.racket = [-0.2, -0.15, 0.45];
      out.crouch = 0.1 + Math.abs(beat) * 0.03;
      break;
  }
}

type Gait = 'stand' | 'correr' | 'correr_atras' | 'lateral_izq' | 'lateral_der' | 'hop';

export class FigureAnimator implements AnimatedFigure {
  x = 0;
  y = 0;
  readonly bones: Float32Array;
  /** Where every bone is, in the character's own axes, after the last update. */
  readonly skeleton: Skeleton;
  /** What is this character's own: its pieces, its size, how it stands. */
  readonly style: Style | null;

  private readonly pose: Float32Array;
  private readonly ground: Float32Array;
  private readonly groundFrom: Float32Array;
  private readonly groundNext: Float32Array;
  private readonly stroke: Float32Array;
  private readonly strokeFrom: Float32Array;
  private readonly extra: Float32Array;
  private readonly legs: boolean[];

  // The ground: standing, a cycle or the little hop.
  private gait: Gait = 'stand';
  private groundKey = '';
  private groundMix = 1;
  private idleTime = 0;
  private phase = 0;
  private lastStride = 0;
  private twist = 0;
  private hopAt = -1;
  private lastRivalHit = Infinity;

  // The stroke.
  private strokeClip: Clip | null = null;
  private strokeAt = 0;
  private strokeWeight = 0;
  /** A change of stroke clip half way through (the ball turned out to be another one) fades too. */
  private strokeMix = 1;
  /**
   * Where the stroke in progress is: winding up for a contact that has not
   * come, past the contact and finishing, or called off before it got there.
   */
  private strokePhase: 'before' | 'after' | 'off' = 'off';
  /** What the whole figure slides, on the court: only what the body could not reach. */
  private lungeX = 0;
  private lungeY = 0;
  private started = false;
  private readonly hits = new Map<string, [number, number, number]>();
  private readonly heldHits = new Map<string, [number, number, number]>();
  /**
   * The feet. A foot on the floor stays where it is on the court, whatever
   * the pose above it does. When the pose wants it somewhere else (a step
   * toward the ball, a wider stance, a stroke that comes in late, a body that
   * moved on) it steps there: up, across and down. Everything is x and y of
   * the left foot, then of the right one.
   */
  private readonly feet = {
    /** Where each foot is down, on the court, and whether it is. */
    at: new Float64Array(4),
    down: [false, false],
    /** A step: where it left from and where it is going, on the court; how far into it; how long it takes and how high it goes. */
    from: new Float64Array(4),
    to: new Float64Array(4),
    t: new Float32Array([1, 1]),
    dur: new Float32Array([0.2, 0.2]),
    high: new Float32Array(2),
    /** Where the fit wants each foot from where the pose has it, in the character's metres. */
    want: new Float32Array(4),
    /** Where each foot ended up from where the pose has it, in the character's metres: the step really taken. */
    off: new Float32Array(4),
    /**
     * Running: how far each foot comes down from where the run has it, in the
     * character's metres. It only changes while the foot is in the air, so a
     * foot on the floor goes back with the run as the run has it: it does not slide.
     */
    run: new Float32Array(4),
    /**
     * Running: how far a foot on the floor is held from where the run has it,
     * in the character's metres, so that it stays put on the court while the
     * whole figure slides toward a ball or back. In the air it lets go.
     */
    hold: new Float32Array(4),
    /** How far the figure is drawn from where the simulation has the player, on the court, and how much that changed in this frame. */
    drawn: new Float64Array(2),
    moved: new Float64Array(2),
  };
  /**
   * What the body does for the ball in this frame, in the character's own
   * axes at life size: how far the ball is from where the clip meets it, how
   * much of the way the body and the arm go, where the hips go, and what is
   * left for the whole figure to slide.
   */
  private readonly fit = {
    body: 0,
    arm: 0,
    dx: 0,
    dy: 0,
    dz: 0,
    ux: 0,
    uy: 0,
    need: 0,
    foot: -1,
    x: 0,
    y: 0,
    z: 0,
    /** Of how far the hips go down, how much is a jump made smaller: the feet in the air come down with it. */
    jump: 0,
    /** A swing at the air: what the body does not reach, it does not reach. Nothing slides after the ball. */
    short: false,
    /** Running: how far the foot of the last stride comes down toward the ball, in the character's metres. */
    runX: 0,
    runY: 0,
    slideX: 0,
    slideY: 0,
  };
  /** The toes, and how high they are off the floor standing: what tells a foot in the air. */
  private readonly toes: number[];
  private readonly toeFloor: number;
  /** How much each foot is in the air in this frame: 0 on the floor, 1 off it. */
  private readonly air = new Float32Array(2);
  /** The file has both legs, hip to ankle: they can be bent. */
  private readonly hasLegs: boolean;
  /**
   * Where the racket meets the ball with the body of this frame: the clip's
   * own place when the whole body plays the stroke, somewhere else when the
   * legs and the hips are running; as the clip has it, and as it is drawn,
   * with the wrists within range. And what it takes to work it out.
   */
  private readonly contact: [number, number, number] = [0, 0, 0];
  private readonly contactHeld: [number, number, number] = [0, 0, 0];
  /** Where the racket is going to meet the ball, in the character's own axes, as the stroke on show plans it; and whether it does in this frame. */
  private readonly planned: [number, number, number] = [0, 0, 0];
  private planning = false;
  private readonly lag: [number, number, number] = [0, 0, 0];
  private readonly probe: Float32Array;
  private readonly probeAt: Float32Array;
  private readonly probeSkeleton: Skeleton;

  // The head and the braid.
  private readonly head: number;
  private readonly neck: number;
  private readonly braid: number[];
  private lookYaw = 0;
  private lookPitch = 0;
  private swayX = 0;
  private swayY = 0;
  private swaySpeedX = 0;
  private swaySpeedY = 0;
  private lastX = 0;
  private lastY = 0;
  private speedX = 0;
  private speedY = 0;
  private readonly q = new Float32Array(4);
  private readonly turn = new Float32Array(4);
  /** The bone the trunk leans from. */
  private readonly spineBone: number;

  private readonly racket: number;
  private readonly at: [number, number, number] = [0, 0, 0];
  /** The racket arm, the free arm and both legs, for bending them to where they have to be. */
  private readonly arm: Limb;
  private readonly freeArm: Limb;
  private readonly bothLegs: Limb[];
  /** Both elbows and both wrists, kept within their range in every frame; and the wrists for working out a pose aside. */
  private readonly elbows: Elbow[];
  private readonly wrists: Wrist[];
  private readonly probeWrists: Wrist[];
  private readonly world: Float32Array;
  private readonly ankles = new Float32Array(6);
  /** The balls of the feet, where the toes bend: what a foot stands on. And where the ankles have to go. */
  private readonly balls = new Float32Array(6);
  private readonly targets = new Float32Array(6);
  /** Where the pose wants each foot, in the character's metres and on the court, and whether it is free of the floor. */
  private readonly wanted = new Float32Array(4);
  private readonly court = new Float64Array(4);
  private readonly loose = [false, false];
  /** The gesture on show, or the last one while it goes away, and how much of it there is. */
  private gesture = noGesture();
  private gestureWeight = 0;
  private gestureRacket = 0;
  /** What it does when a point ends, or its tic: a clip over whatever else, how far into it and how much of it shows. */
  private reaction: Clip | null = null;
  private reacting = false;
  private reactionTime = 0;
  private reactionWeight = 0;
  /**
   * A short piece of a clip over the trunk and the arms in the middle of play,
   * while the legs go on with what they are doing: the little celebration of
   * a ball it stole, the «no llegué» of a ball it did not get to. From `from`
   * to `to` seconds of the clip, at `weight`; `t` seconds into it.
   */
  private flash: { clip: Clip; from: number; to: number; weight: number; t: number } | null = null;
  /** The «no llegué» was already shown for this miss. */
  private missShown = false;
  /** «Perdón»: seconds left of it, and where the partner is, in metres across the court. */
  private sorryLeft = 0;
  private sorryToward = 0;
  private seenX = 0;
  private seenY = 0;
  /** Where the ball is in the free hand, in the axes of that hand: worked out once from the serve. */
  private readonly inHand: [number, number, number] | null;

  constructor(
    private readonly character: Character,
    style: Style | null = null,
  ) {
    const size = character.poseSize;
    this.style = style;
    this.bones = new Float32Array(26 * 16);
    this.skeleton = createSkeleton(character);
    this.pose = new Float32Array(size);
    this.ground = new Float32Array(size);
    this.groundFrom = new Float32Array(size);
    this.groundNext = new Float32Array(size);
    this.stroke = new Float32Array(size);
    this.strokeFrom = new Float32Array(size);
    this.extra = new Float32Array(size);
    this.legs = character.meta.bones.names.map((name) => LEG_BONES.includes(name));
    this.head = character.bone('head');
    this.neck = character.bone('neck');
    this.braid = ['braid1', 'braid2', 'braid3'].map((name) => character.bone(name)).filter((bone) => bone >= 0);
    this.racket = character.bone('racket');
    // The racket is in the right hand: the arm is the one that hand hangs from, the other one is free.
    const hand = character.meta.bones.parents[this.racket] ?? -1;
    const side = character.meta.bones.names[hand]?.endsWith('.L') ? 'L' : 'R';
    const other = side === 'L' ? 'R' : 'L';
    this.arm = armOf(character, side);
    this.freeArm = armOf(character, other);
    this.bothLegs = [legOf(character, 'L'), legOf(character, 'R')];
    this.elbows = [elbowOf(character, other), elbowOf(character, side)];
    this.wrists = [wristOf(character, other, false), wristOf(character, side, true)];
    this.probeWrists = this.wrists.map((wrist) => ({ ...wrist }));
    this.world = new Float32Array(character.bones * 4);
    this.inHand = this.measureHand();
    this.toes = ['toe.L', 'toe.R'].map((name) => character.bone(name));
    this.spineBone = character.bone('spine');
    this.hasLegs = this.bothLegs.every((leg) => leg.upper >= 0 && leg.lower >= 0 && leg.end >= 0);
    this.toeFloor = this.measureFloor();
    this.probe = new Float32Array(size);
    this.probeAt = new Float32Array(size);
    this.probeSkeleton = createSkeleton(character);
  }

  /** Forgets everything: the next update starts from scratch, with no fade (a new point, a new match). */
  reset(): void {
    this.started = false;
    this.reacting = false;
    this.reactionWeight = 0;
    this.hopAt = -1;
    this.flash = null;
    this.sorryLeft = 0;
  }

  /**
   * Doubles: a ball it stole from its partner («¡mía!») went in. A quick
   * «¡vamos!» with the racket, in the middle of play, that never stops it:
   * the jump of the celebration without the jump.
   */
  stoleWell(): void {
    this.play('festejo', 0.08, 0.46, 0.6);
  }

  /**
   * Doubles: a ball it stole from its partner went wrong. «Perdón», with the
   * free hand up toward the partner. `towardX` is where the partner is, in
   * metres across the court from this player.
   */
  stoleBadly(towardX: number): void {
    this.sorryLeft = SORRY;
    this.sorryToward = towardX;
  }

  private play(name: string, from: number, to: number, weight: number): void {
    const clip = this.character.clips[name];
    if (!clip) return;
    this.flash = { clip, from, to: Math.min(to, clip.dur), weight, t: 0 };
  }

  /**
   * The point was won: a short celebration, inside the pause that follows
   * every point anyway. It never delays anything: the next serve cuts it.
   */
  cheer(): void {
    this.react('festejo');
  }

  /** The point was lost: it sags for a moment. As short as the celebration, and cut the same way. */
  lament(): void {
    this.react('lamento');
  }

  private react(name: string): void {
    const clip = this.character.clips[name];
    if (!clip) return;
    this.reaction = clip;
    this.reacting = true;
    this.reactionTime = 0;
  }

  /**
   * Poses the body for this frame. `k` is how much bigger than life it is
   * drawn, `facing` which way it looks along the court, and `ball` where the
   * ball is, for the head to follow.
   */
  update(
    player: ScenePlayer,
    k: number,
    facing: 1 | -1,
    ball: { x: number; y: number; z: number; visible: boolean },
    dt: number,
    moment: Moment = PLAYING,
  ): void {
    const character = this.character;
    const clips = character.clips;
    const style = this.style;
    const tempo = style?.tempo ?? 1;
    this.planning = false;
    // Put somewhere else between two frames (a new point): nothing is carried over.
    const moved = Math.hypot(player.x - this.seenX, player.y - this.seenY);
    this.seenX = player.x;
    this.seenY = player.y;
    const snap = !this.started || moved > TELEPORT;
    this.started = true;
    // The character faces -y in its own axes. `s` takes the court's x and y to them.
    const s = facing > 0 ? -1 : 1;
    const busy = player.anim !== 'idle' && player.animPhase < 1;
    // A stroke that is only armed (the racket back, the swing not let go) whose contact has passed has not
    // hit anything yet: the ball may still come within reach a moment later. The racket waits at the
    // contact instead of swinging through the air and coming back.
    const eta = player.animPhase < 0 && player.contactIn < 0 ? 0 : player.contactIn;

    // ------------------------------------------------------------ the ground
    const speed = Math.hypot(player.vx, player.vy);
    // Metres covered since the last frame: what moves a cycle on.
    const covered = player.stride >= this.lastStride && player.stride - this.lastStride < 1 ? player.stride - this.lastStride : 0;
    this.lastStride = player.stride;
    let twist = 0;
    let clip: Clip;
    let time: number;
    let key: string;

    // The little hop just before a rival hits, for whoever is standing and waiting for the ball.
    const hop = clips.split_step;
    if (hop && this.hopAt < 0 && !busy && !moment.resting && !moment.holding && speed < 1.2) {
      const lands = (hop.aterrizaje ?? 0.33) / tempo;
      if (this.lastRivalHit > lands && moment.rivalHitIn <= lands && moment.rivalHitIn > lands - 0.12) this.hopAt = 0;
    }
    this.lastRivalHit = moment.rivalHitIn;
    if (hop && this.hopAt >= 0) {
      this.hopAt += dt * tempo;
      // It can be cut short to go after the ball, and a stroke cuts it at once.
      const cut = hop.corte ?? hop.dur * 0.55;
      if (this.hopAt >= hop.dur || busy || (speed > STANDING_SPEED && this.hopAt >= cut) || speed > 2.4) this.hopAt = -1;
    }

    if (hop && this.hopAt >= 0) {
      this.gait = 'hop';
      clip = hop;
      time = this.hopAt;
      key = 'split_step';
    } else if (speed < STANDING_SPEED) {
      this.gait = 'stand';
      this.idleTime += dt;
      if (moment.holding && clips.saque) {
        // The ball is in its hand: the very start of the serve, held.
        clip = clips.saque;
        time = 0;
        key = 'hold';
      } else {
        clip = (moment.resting ? clips.espera : null) ?? clips.listo!;
        time = this.idleTime;
        key = clip.name;
      }
    } else {
      // Where it is going next to where it faces, in its own axes: forward is -y, and x is its left.
      const mx = (s * player.vx) / speed;
      const my = (s * player.vy) / speed;
      const angle = Math.atan2(mx, -my);
      const wide = Math.abs(angle);
      const was = this.gait;
      let gait: Gait;
      if (wide <= FORWARD_UNTIL + (was === 'correr' ? GAIT_STICK : -GAIT_STICK)) gait = 'correr';
      else if (wide >= BACKWARD_FROM + (was === 'correr_atras' ? -GAIT_STICK : GAIT_STICK)) gait = 'correr_atras';
      else if (was === 'correr' && wide <= FORWARD_UNTIL + GAIT_STICK) gait = 'correr';
      else if (was === 'correr_atras' && wide >= BACKWARD_FROM - GAIT_STICK) gait = 'correr_atras';
      else gait = angle > 0 ? 'lateral_izq' : 'lateral_der';
      // An older file has no run of its own for going backward: the forward one, played the other way.
      const reversed = gait === 'correr_atras' && !clips.correr_atras;
      clip = clips[gait] ?? clips.correr ?? clips.listo!;
      if (gait !== was) this.phase = clip.entrada ?? 0;
      this.gait = gait;
      this.phase += covered / (strideOf(clip) * k);
      this.phase -= Math.floor(this.phase);
      time = (reversed ? 1 - this.phase : this.phase) * clip.dur;
      key = gait;
      // What the cycle does not cover of the direction, the pelvis turns.
      const dir = reversed ? DEFAULT_DIR.correr_atras! : (clip.dir ?? DEFAULT_DIR[gait] ?? DEFAULT_DIR.correr!);
      twist = clamp(Math.atan2(dir[0] * my - dir[1] * mx, dir[0] * mx + dir[1] * my), -MOST_TWIST, MOST_TWIST);
    }
    samplePose(character, clip, time, this.groundNext);
    if (key !== this.groundKey) {
      this.groundFrom.set(this.ground);
      this.groundMix = snap || this.groundKey === '' ? 1 : 0;
      this.groundKey = key;
    }
    if (this.groundMix < 1) {
      this.groundMix = Math.min(1, this.groundMix + dt / FADE);
      blendPose(character.bones, this.groundFrom, this.groundNext, smoothstep(0, 1, this.groundMix), this.ground);
    } else {
      this.ground.set(this.groundNext);
    }
    this.twist = snap ? twist : this.twist + (twist - this.twist) * Math.min(1, dt * 12);

    // ------------------------------------------------------------ reactions and tics
    // Between points everybody walks to their place for the next one, so the
    // legs keep walking and the rest reacts; standing still, the whole body
    // does. A stroke in progress is finished first.
    const tic = player.act && !busy && player.act.t < player.act.duration ? player.act : null;
    const mania = tic ? clips[MANIA_CLIPS[tic.clip] ?? ''] : undefined;
    if (tic && mania) {
      // A tic with a clip of its own: it lasts what the tic lasts.
      this.reaction = mania;
      this.reacting = true;
      this.reactionTime = (tic.t / tic.duration) * mania.dur;
    } else if (this.reaction && this.reaction.grupo === 'mania') {
      this.reacting = false;
    }
    const reaction = this.reaction;
    if (reaction && (this.reacting || this.reactionWeight > 0)) {
      if (!mania) {
        // The clip keeps playing while it fades, so the way out is not a still pose.
        if (!busy || !this.reacting) this.reactionTime = Math.min(this.reactionTime + dt * tempo, reaction.dur);
        if (this.reactionTime >= reaction.dur - FADE) this.reacting = false;
      }
      const on = this.reacting && !busy;
      this.reactionWeight = snap ? 0 : clamp(this.reactionWeight + dt / (on ? FADE : -FADE), 0, 1);
      if (this.reactionWeight > 0) {
        samplePose(character, reaction, this.reactionTime, this.extra);
        const upper = smoothstep(0, 1, this.reactionWeight);
        this.layer(this.ground, this.extra, upper, upper * (1 - smoothstep(0.5, 1.8, speed)));
      } else if (!this.reacting) {
        this.reaction = null;
      }
    }
    // The same gesture is wider on one of the cast and smaller on another. Not a stroke: that has a ball to meet.
    if (style) widen(character, this.ground, style.amplitude);

    // ------------------------------------------------------------ the stroke
    // What the computer goes through shows in the stroke (docs/ia.md). Hurried, it has no time for a
    // windup: the arms keep running until the last moment. A ball fired at its body is blocked: the
    // racket goes up in front at once, with no windup and no swing.
    const hurried = player.why === 'hurried' && player.anim !== 'serve';
    const block = player.why === 'block' && player.anim === 'swing';
    if (busy && !(hurried && eta > HURRY_LEAD && !this.strokeClip)) {
      let next = clips[block ? blockClip(player, (name) => name in clips) : strokeClipName(player, k, (name) => name in clips)] ?? null;
      // A stroke that is past its contact cannot be before it again: that is another stroke.
      const another = this.strokePhase !== 'before' && eta > 0.02;
      // Near its contact, at it and after it, a stroke is not changed for another one on the same side
      // and at about the same height (the simulation names the shot for good only when it is hit):
      // swapping clips then is a jump of the racket and of the feet. The body gets to the ball instead.
      const current = this.strokeClip;
      const settled = this.strokePhase === 'after' || (this.strokePhase === 'before' && eta < STROKE_SETTLED);
      if (next && current && next !== current && !another && settled && sideOf(next) === sideOf(current)) {
        if (OVERHEAD.has(next.name) === OVERHEAD.has(current.name) && next.name !== 'saque' && current.name !== 'saque') next = current;
      }
      if (next && (next !== this.strokeClip || another)) {
        if (this.strokeClip && this.strokeWeight > 0) {
          this.strokeFrom.set(this.stroke);
          // A new stroke that only starts at its contact has no time to fade from the one before: half
          // of each would put the racket nowhere near the ball. It is there at once.
          this.strokeMix = snap || (eta <= QUICKEST && this.strokePhase !== 'before') ? 1 : 0;
        } else {
          this.strokeMix = 1;
        }
        this.strokeClip = next;
        // With little time left it starts further into the clip.
        const start = contactOf(next) - eta;
        this.strokeAt = Number.isFinite(start) ? clamp(start, 0, contactOf(next)) : 0;
        this.strokePhase = 'before';
      }
      if (this.strokeClip) {
        // A block waits with the racket where it meets the ball, and only punches through after it.
        this.strokeAt = block ? Math.min(contactOf(this.strokeClip) - Math.min(eta, 0), this.strokeClip.dur) : strokeTime(this.strokeClip, eta, this.strokeAt, dt);
        this.strokePhase = eta <= 0 ? 'after' : 'before';
      }
    } else if (this.strokeClip) {
      if (this.strokePhase === 'after') {
        // The simulation is done with it; the body finishes its follow-through.
        this.strokeAt += dt;
      } else {
        // It never got to hit: the racket just comes back down.
        this.strokePhase = 'off';
      }
    }
    const swing = this.strokeClip;
    const active =
      swing !== null && this.strokePhase !== 'off' && !(this.strokePhase === 'after' && this.strokeAt >= swing.dur - STROKE_OUT);
    const target = active ? 1 : 0;
    // What is left until the contact, for a stroke on its way to it; nothing, for one that is past it.
    const left = this.strokePhase === 'before' ? eta : 0;
    const rate = dt / (target > this.strokeWeight ? clamp(left, QUICKEST, STROKE_IN) : STROKE_OUT);
    // The ball is being hit right now and the stroke has only just been asked for: the racket is on it in this
    // very frame. With the sparkle and the short freeze of a good hit, it is the frame that gets looked at.
    const struck = active && this.strokePhase === 'after' && this.strokeAt <= contactOf(swing) + 0.03;
    this.strokeWeight = snap || struck ? target : clamp(this.strokeWeight + clamp(target - this.strokeWeight, -rate, rate), 0, 1);
    if (swing && !active && this.strokeWeight <= 0) {
      this.strokeClip = null;
      this.strokePhase = 'off';
    }

    // ------------------------------------------------------------ together
    const pose = this.pose;
    pose.set(this.ground);
    let upper = 0;
    let lower = 0;
    if (swing && this.strokeWeight > 0) {
      samplePose(character, swing, Math.min(this.strokeAt, swing.dur), this.stroke);
      if (this.strokeMix < 1) {
        this.strokeMix = Math.min(1, this.strokeMix + dt / clamp(left, QUICKEST, FADE));
        blendPose(character.bones, this.strokeFrom, this.stroke, smoothstep(0, 1, this.strokeMix), this.stroke);
      }
      upper = smoothstep(0, 1, this.strokeWeight);
      // Standing, the whole body plays the stroke. Moving, the legs stay with the ground. Hurried, the legs
      // are still on their way there.
      lower = upper * (1 - smoothstep(0.5, 1.8, speed)) * (hurried ? 1 - (1 - HURRY_LEGS) * smoothstep(0.2, 1, speed) : 1);
      this.layer(pose, this.stroke, upper, lower);
    }
    // The computer swung and did not get there: a moment later, «no llegué», with the trunk and the head.
    if (player.anim !== 'whiff' || !swing) this.missShown = false;
    else if (!this.missShown && eta < -MISS_AFTER) {
      this.missShown = true;
      this.play('lamento', MISS_FROM, MISS_TO, 0.65);
    }
    // A short piece of a clip over the trunk and the arms, whatever the legs are doing.
    const flash = this.flash;
    if (flash) {
      flash.t += dt * tempo;
      const at = flash.from + flash.t;
      if (snap || at >= flash.to) {
        this.flash = null;
      } else {
        samplePose(character, flash.clip, at, this.extra);
        const w = flash.weight * smoothstep(0, FLASH_IN, at - flash.from) * (1 - smoothstep(flash.to - FLASH_OUT, flash.to, at));
        this.layer(pose, this.extra, w, 0);
      }
    }
    // How it stands, and the turn of the pelvis for the legs that follow the ground.
    if (style) stand(pose, style);
    if (this.twist !== 0) twistHips(character, pose, this.twist * (1 - lower));
    // In a stroke, the elbow and the wrist of the racket arm within their range from the start: what the body and
    // the arm do for the ball is done with the racket where it is going to be drawn.
    for (const wrist of this.wrists) {
      if (!snap) continue;
      wrist.held = 0;
      wrist.kept = false;
    }
    if (swing && this.strokeWeight > 0) {
      keepElbow(pose, this.elbows[1]!);
      keepWrist(pose, this.wrists[1]!);
    }
    solveSkeleton(character, pose, this.skeleton, style);

    // What the character adds: its tell while the racket is back, a tic while it rests.
    if (this.sorryLeft > 0) this.sorryLeft = snap ? 0 : Math.max(0, this.sorryLeft - dt);
    const made = this.readGesture(player, s, mania !== undefined);
    const windup = player.tell !== null;
    const showing = made && !(windup && player.contactIn < TELL_BODY_UNTIL);
    const holding = made && !(windup && player.contactIn < TELL_RACKET_UNTIL);
    this.gestureWeight = snap ? (showing ? 1 : 0) : clamp(this.gestureWeight + dt / (showing ? GESTURE_IN : -GESTURE_OUT), 0, 1);
    this.gestureRacket = snap ? (holding ? 1 : 0) : clamp(this.gestureRacket + dt / (holding ? GESTURE_IN : -GESTURE_OUT), 0, 1);
    const gesture = smoothstep(0, 1, this.gestureWeight);

    // ------------------------------------------------------------ the body goes to the ball
    // The ball is where the simulation says, not where the clip expects it. The
    // feet do not slide: the hips sink and go toward it, and the front foot steps.
    if (swing) this.planFit(player, swing, s, k, upper, lower, eta);
    else this.restFit();
    const clearance = this.clearance();
    this.finishFit(lower, pose[character.bones * 4 + 2]!, clearance);
    // What not even that reaches, the whole figure goes after: it eases in and out by itself, so nothing
    // jumps if the plan changes, and right at the contact it hurries. The feet follow it with steps.
    const ease = snap ? 1 : 1 - Math.exp(-dt * (Math.abs(eta) < 0.06 ? 40 : 18));
    this.lungeX += (s * this.fit.slideX * k - this.lungeX) * ease;
    this.lungeY += (s * this.fit.slideY * k - this.lungeY) * ease;
    this.x = player.x + this.lungeX;
    this.y = player.y + this.lungeY + facing * this.gesture.step * gesture;
    const feet = this.feet;
    feet.moved[0] = snap ? 0 : this.x - player.x - feet.drawn[0]!;
    feet.moved[1] = snap ? 0 : this.y - player.y - feet.drawn[1]!;
    feet.drawn[0] = this.x - player.x;
    feet.drawn[1] = this.y - player.y;
    // A long point gets to the body: while it waits, lower and wider, the trunk forward.
    const tense = player.tension * (1 - upper) * (1 - smoothstep(0.6, 1.6, speed));
    this.placeBody(
      lower,
      clearance,
      speed,
      s,
      k,
      dt,
      snap,
      Math.abs(eta) < 0.25,
      this.gesture.stance * gesture + TENSE.stance * tense,
      this.gesture.crouch * gesture + TENSE.crouch * tense,
      this.gesture.back * gesture,
    );

    // ------------------------------------------------------------ life
    // The arm takes the racket a little further toward the ball, and lets go of it right after the contact.
    // The ball of a serve is the one the server dropped: only the arm.
    const serving = player.anim === 'serve' && this.strokePhase !== 'off' && Number.isFinite(eta);
    const arm = (serving ? lungeWeight(eta) * upper : this.fit.arm) * (eta < 0 ? 1 - smoothstep(0, LET_GO, -eta) : 1);
    if (swing && arm > 0.001) this.reachArm(player, serving ? this.hitOf(swing, true) : this.contactHeld, s, k, arm);
    if (gesture > 0.001) this.gesticulate(gesture, Math.min(gesture, smoothstep(0, 1, this.gestureRacket)));
    const lean = this.gesture.lean * gesture + TENSE.lean * tense;
    if (Math.abs(lean) > 1e-3) this.leanTrunk(lean);
    this.look(pose, s, k, ball, dt, this.strokeWeight > 0.5 ? 0.4 : 0.8, snap);
    // And whatever the reach and the gestures did to them since; and a hand never flips over from one frame to
    // the next, which some clips have it do.
    for (const elbow of this.elbows) keepElbow(pose, elbow);
    for (const wrist of this.wrists) keepWrist(pose, wrist, dt);
    solveSkeleton(character, pose, this.skeleton, style);
    skinMatrices(character, this.skeleton, this.bones, style);
  }

  /** Lays one pose over another: `upper` of it on the trunk and the arms, `lower` on the legs and the pelvis. */
  private layer(pose: Float32Array, over: Float32Array, upper: number, lower: number): void {
    const bones = this.character.bones;
    for (let i = 0; i < bones; i++) {
      const w = this.legs[i] || i === 0 ? lower : upper;
      if (w <= 0) continue;
      const o = i * 4;
      const dot = pose[o]! * over[o]! + pose[o + 1]! * over[o + 1]! + pose[o + 2]! * over[o + 2]! + pose[o + 3]! * over[o + 3]!;
      const sign = dot < 0 ? -1 : 1;
      for (let c = 0; c < 4; c++) pose[o + c] = pose[o + c]! * (1 - w) + over[o + c]! * sign * w;
    }
    const p = bones * 4;
    for (let c = 0; c < 3; c++) pose[p + c] = pose[p + c]! * (1 - lower) + over[p + c]! * lower;
  }

  /**
   * Where the middle of the racket is at the contact of a clip, for this
   * character: its bones are scaled and it stands its own way, so it is not
   * quite where the clip says for everybody. Null for a clip with no contact.
   *
   * `held` says where it is drawn: with the wrist kept within its range, a
   * racket the clip holds with a wrist beyond it is somewhere else. The body
   * goes to the ball as the clip has it; the arm, from where the racket is.
   */
  hitOf(clip: Clip, held = false): [number, number, number] | null {
    if (!clip.hit) return null;
    const style = this.style;
    if (this.racket < 0 || (!held && (!style || (!style.scale && style.posture.length === 0)))) return clip.hit;
    const hits = held ? this.heldHits : this.hits;
    let hit = hits.get(clip.name);
    if (!hit) {
      const pose = samplePose(this.character, clip, contactOf(clip), new Float32Array(this.character.poseSize));
      if (style) stand(pose, style);
      if (held) this.keepJoints(pose);
      const skeleton = solveSkeleton(this.character, pose, createSkeleton(this.character), style);
      hit = boneToCharacter(skeleton, this.racket, this.character.meta.racketCenter, [0, 0, 0]);
      hits.set(clip.name, hit);
    }
    return hit;
  }

  /** The elbows and the wrists of a pose worked out aside, kept within their range as the ones on show are. */
  private keepJoints(pose: Float32Array): void {
    for (const elbow of this.elbows) keepElbow(pose, elbow);
    for (const wrist of this.probeWrists) {
      wrist.held = 0;
      keepWrist(pose, wrist);
    }
  }

  /** Where the ball sits in the free hand, in the axes of the hand, from what the serve says about its start. */
  private measureHand(): [number, number, number] | null {
    const serve = this.character.clips.saque;
    const hand = this.freeArm.end;
    if (!serve?.ballHold || hand < 0) return null;
    const pose = samplePose(this.character, serve, 0, new Float32Array(this.character.poseSize));
    const skeleton = solveSkeleton(this.character, pose, createSkeleton(this.character));
    const { rot, pos } = skeleton;
    const at = serve.ballHold[0];
    const dx = at[0] - pos[hand * 3]!;
    const dy = at[1] - pos[hand * 3 + 1]!;
    const dz = at[2] - pos[hand * 3 + 2]!;
    const o = hand * 9;
    // The rotation is by rows: its transpose takes the character's axes back to the hand's.
    return [
      rot[o]! * dx + rot[o + 3]! * dy + rot[o + 6]! * dz,
      rot[o + 1]! * dx + rot[o + 4]! * dy + rot[o + 7]! * dz,
      rot[o + 2]! * dx + rot[o + 5]! * dy + rot[o + 8]! * dz,
    ];
  }

  /**
   * Where the ball is while the free hand has it, on the court, with the pose
   * of the last update. False when this character cannot say (an older file).
   */
  ballInHand(k: number, facing: 1 | -1, out: [number, number, number]): boolean {
    const hand = this.freeArm.end;
    if (!this.inHand || hand < 0) return false;
    const s = facing > 0 ? -1 : 1;
    boneToCharacter(this.skeleton, hand, this.inHand, this.at);
    out[0] = this.x + s * this.at[0] * k;
    out[1] = this.y + s * this.at[1] * k;
    out[2] = this.at[2] * k;
    return true;
  }

  /** How high the toes are off the floor standing ready, for this character. */
  private measureFloor(): number {
    const ready = this.character.ready;
    if (!ready || this.toes.some((toe) => toe < 0)) return 0;
    const pose = new Float32Array(ready);
    if (this.style) stand(pose, this.style);
    const skeleton = solveSkeleton(this.character, pose, createSkeleton(this.character), this.style);
    return Math.min(...this.toes.map((toe) => skeleton.pos[toe * 3 + 2]!));
  }

  /** How far off the floor the lower foot is, with the skeleton of the pose: something only in a jump. */
  private clearance(): number {
    const left = this.toes[0]!;
    const right = this.toes[1]!;
    if (left < 0 || right < 0) return 0;
    const pos = this.skeleton.pos;
    return Math.max(0, Math.min(pos[left * 3 + 2]!, pos[right * 3 + 2]!) - this.toeFloor);
  }

  /**
   * Where the racket will meet the ball with the body as it is in this frame.
   * When the whole body plays the stroke it is the clip's own place. With the
   * legs and the hips running, the arms of the stroke go on top of the hips
   * of the run, and the racket ends up somewhere else: this says where.
   * `lower` is how much of the legs the stroke has once it is all there.
   *
   * It is worked out twice: as the clip has it, for the body (`this.contact`),
   * and as it is drawn, with the wrists within range, for the arm
   * (`this.contactHeld`). False for a clip with no contact.
   */
  private contactWith(clip: Clip, lower: number): boolean {
    const hit = this.hitOf(clip);
    const held = this.hitOf(clip, true);
    if (!hit || !held) return false;
    const out = this.contact;
    const drawn = this.contactHeld;
    if (lower >= 0.999 && this.twist === 0) {
      for (let c = 0; c < 3; c++) {
        out[c] = hit[c]!;
        drawn[c] = held[c]!;
      }
      return true;
    }
    const character = this.character;
    samplePose(character, clip, contactOf(clip), this.probeAt);
    this.probe.set(this.ground);
    this.layer(this.probe, this.probeAt, 1, lower);
    if (this.style) stand(this.probe, this.style);
    if (this.twist !== 0) twistHips(character, this.probe, this.twist * (1 - lower));
    solveSkeleton(character, this.probe, this.probeSkeleton, this.style);
    boneToCharacter(this.probeSkeleton, this.racket, character.meta.racketCenter, out);
    this.keepJoints(this.probe);
    solveSkeleton(character, this.probe, this.probeSkeleton, this.style);
    boneToCharacter(this.probeSkeleton, this.racket, character.meta.racketCenter, drawn);
    return true;
  }

  /** Nothing to reach: the body does nothing for a ball, and the feet go back to where the clips have them. */
  private restFit(): void {
    const fit = this.fit;
    fit.body = 0;
    fit.arm = 0;
    fit.foot = -1;
    fit.x = 0;
    fit.y = 0;
    fit.z = 0;
    fit.jump = 0;
    fit.short = false;
    fit.runX = 0;
    fit.runY = 0;
    fit.slideX = 0;
    fit.slideY = 0;
    this.feet.want.fill(0);
  }

  /**
   * Works out what the body has to do for the ball of this stroke: how far
   * the ball is from where the clip meets it, and where the front foot has to
   * step. How far the hips go depends on the step really taken: see
   * `finishFit`. The skeleton has to be the one of the pose.
   */
  private planFit(player: ScenePlayer, clip: Clip, s: number, k: number, upper: number, lower: number, eta: number): void {
    this.restFit();
    const fit = this.fit;
    if (!Number.isFinite(eta) || player.anim === 'serve' || this.strokePhase === 'off' || upper <= 0) return;
    // A block is played from where it stands: the arm, nothing else. A swing at the air goes after the
    // ball as far as the body goes, and falls short: the arm does not take it all the way.
    const block = player.why === 'block';
    const miss = player.anim === 'whiff';
    fit.body = block ? 0 : bodyWeight(eta) * upper;
    fit.arm = (block ? blockWeight(eta) : lungeWeight(eta)) * upper * (miss ? MISS_ARM : 1);
    fit.short = miss;
    if (fit.body <= 0 && fit.arm <= 0) return;
    if (!this.contactWith(clip, upper > 0 ? lower / upper : 1)) {
      fit.body = 0;
      fit.arm = 0;
      return;
    }
    const hit = this.contact;
    // Where the ball is from where the clip meets it, in the character's own axes at life size.
    fit.dx = (s * player.reachX) / k - hit[0];
    fit.dy = (s * player.reachY) / k - hit[1];
    fit.dz = player.reachZ / k - hit[2];
    const across = Math.hypot(fit.dx, fit.dy);
    fit.ux = across > 1e-6 ? fit.dx / across : 0;
    fit.uy = across > 1e-6 ? fit.dy / across : 0;
    fit.need = Math.max(0, across - BODY.armEasy);
    // Standing, the front foot steps for what the hips cannot do by themselves: a moment before the
    // contact, and back after it. Running, the feet are the run's.
    const foot = lower > 0.5 && this.hasLegs ? steppingFoot(clip) : -1;
    fit.foot = foot;
    // Running, the last stride before the contact becomes the lunge: whichever foot is in the air then
    // comes down further toward the ball.
    if (lower <= 0.5 && this.hasLegs && fit.need > BODY.shiftRun && eta <= STEP_BEFORE && eta > -STEP_BACK) {
      const length = Math.min(BODY.runLunge, (fit.need - BODY.shiftRun) / BODY.follow);
      fit.runX = fit.ux * length;
      fit.runY = fit.uy * length;
    }
    if (foot < 0 || fit.need <= BODY.shift || eta > STEP_BEFORE || eta < -STEP_BACK) return;
    const stretch = clip.estirada === true || clip.name.startsWith('estirada');
    const length = Math.min(stretch ? BODY.stepStretch : BODY.step, (fit.need - BODY.shift) / BODY.follow);
    let wx = fit.ux * length;
    let wy = fit.uy * length;
    // Never onto the other foot.
    const pos = this.skeleton.pos;
    const mine = this.bothLegs[foot]!.end * 3;
    const other = this.bothLegs[1 - foot]!.end * 3;
    const ax = pos[mine]! + wx - pos[other]!;
    const ay = pos[mine + 1]! + wy - pos[other + 1]!;
    const apart = Math.hypot(ax, ay);
    if (apart < BODY.apart) {
      const nx = apart > 1e-4 ? ax / apart : fit.ux;
      const ny = apart > 1e-4 ? ay / apart : fit.uy;
      wx = pos[other]! + nx * BODY.apart - pos[mine]!;
      wy = pos[other + 1]! + ny * BODY.apart - pos[mine + 1]!;
    }
    this.feet.want[foot * 2] = wx;
    this.feet.want[foot * 2 + 1] = wy;
  }

  /**
   * How far the hips go for the ball, given the step the front foot really
   * took, and what is left for the whole figure to slide. `hips` is how high
   * the pelvis is in the pose and `clearance` how far off the floor the lower
   * foot is.
   */
  private finishFit(lower: number, hips: number, clearance: number): void {
    const fit = this.fit;
    if (fit.body <= 0 && fit.arm <= 0) return;
    const off = this.feet.off;
    // Across the floor: as far as the hips go with the feet where they are, and then after the step.
    const stepped = fit.foot >= 0 ? Math.max(0, off[fit.foot * 2]! * fit.ux + off[fit.foot * 2 + 1]! * fit.uy) * lower : 0;
    // Running, the stride that came down toward the ball is the lunge.
    const run = this.feet.run;
    const lunged = Math.max(0, run[0]! * fit.ux + run[1]! * fit.uy, run[2]! * fit.ux + run[3]! * fit.uy) * (1 - lower);
    const taken = stepped + lunged;
    const free = BODY.shift + (BODY.shiftRun - BODY.shift) * (1 - lower);
    const shift = Math.min(fit.need, free + BODY.follow * taken) * fit.body;
    // A lower ball: first a jump that is not so high, then the knees, down to a knee near the floor
    // (less of that running, unless the run ended in a lunge). A higher one: the knees straighten.
    const low = Math.max(0, -fit.dz - BODY.lowFree);
    const air = Math.min(clearance, low);
    const kneel = Math.max(lower, Math.min(1, lunged / (BODY.runLunge * 0.6)));
    const sink = Math.min(low - air, Math.max(0, hips - BODY.lowest) * (0.4 + 0.6 * kneel));
    const rise = clearance > 0.01 ? 0 : clamp(fit.dz - BODY.riseFree, 0, Math.min(BODY.rise, Math.max(0, 0.93 - hips)));
    fit.x = fit.ux * shift;
    fit.y = fit.uy * shift;
    fit.z = (rise - air - sink) * fit.body;
    fit.jump = -air * fit.body;
    // What the arm cannot take across the floor, the whole figure slides.
    const rx = fit.dx - fit.x;
    const ry = fit.dy - fit.y;
    const rest = Math.hypot(rx, ry);
    const over = fit.short ? 0 : Math.max(0, rest - BODY.armAcross) * fit.arm;
    fit.slideX = rest > 1e-6 ? (rx / rest) * over : 0;
    fit.slideY = rest > 1e-6 ? (ry / rest) * over : 0;
  }

  /**
   * Puts the hips where the fit says (lower still for a crouching gesture)
   * and the feet on the floor. Where the pose wants each foot is where the
   * clip has it, plus the step toward the ball and a wider stance; a foot that
   * is down stays where it is on the court until that is too far, and then it
   * steps there. A foot the pose has in the air (a step of the clip, a jump,
   * the leg of a run coming forward) goes with the body. Running, the feet
   * are the run's. The legs bend for all of it.
   *
   * `this.x` and `this.y` have to be where the figure is drawn in this frame,
   * and the skeleton the one of the pose.
   */
  private placeBody(
    lower: number,
    clearance: number,
    speed: number,
    s: number,
    k: number,
    dt: number,
    snap: boolean,
    settled: boolean,
    stance: number,
    crouch: number,
    back: number,
  ): void {
    if (!this.hasLegs) return;
    const fit = this.fit;
    const feet = this.feet;
    const character = this.character;
    const pose = this.pose;
    const skeleton = this.skeleton;
    const pos = skeleton.pos;
    // Where the pose has each foot, and how much it is off the floor. A foot stands on its ball, where
    // the toes bend, as in the clips: that is the point that stays put while the heel comes up or turns.
    for (let i = 0; i < 2; i++) {
      const foot = this.bothLegs[i]!.end * 3;
      const toe = this.toes[i]!;
      for (let c = 0; c < 3; c++) {
        this.ankles[i * 3 + c] = pos[foot + c]!;
        this.balls[i * 3 + c] = toe >= 0 ? pos[toe * 3 + c]! : pos[foot + c]!;
      }
      this.air[i] = toe >= 0 ? smoothstep(0.02, 0.07, pos[toe * 3 + 2]! - this.toeFloor) : smoothstep(0.01, 0.06, clearance);
    }
    const planted = 1 - smoothstep(PLANTED_UNTIL, PLANTED_FROM, speed);
    const drift = settled ? FOOT_DRIFT_SET : FOOT_DRIFT;
    // Where the pose wants the ball of each foot, in the character's own metres and on the court: the
    // left foot further left for a wider stance. In the air a foot goes across with the body.
    const wanted = this.wanted;
    const court = this.court;
    const run = feet.run;
    const hold = feet.hold;
    for (let i = 0; i < 2; i++) {
      const air = this.air[i]!;
      // The last stride of a run toward the ball: a foot in the air goes there; on the floor it stays as it came down.
      if (snap) {
        run.fill(0, i * 2, i * 2 + 2);
        hold.fill(0, i * 2, i * 2 + 2);
      } else if (air > 0.5) {
        const follow = Math.min(1, dt * 14);
        run[i * 2] = run[i * 2]! + (fit.runX - run[i * 2]!) * follow;
        run[i * 2 + 1] = run[i * 2 + 1]! + (fit.runY - run[i * 2 + 1]!) * follow;
        hold[i * 2] = hold[i * 2]! * (1 - follow);
        hold[i * 2 + 1] = hold[i * 2 + 1]! * (1 - follow);
      } else {
        // On the floor, running, it stays put on the court when the figure slides. Standing it is held by
        // where it came down anyway, and the figure that slides is followed with steps.
        const loose = 1 - planted;
        hold[i * 2] = hold[i * 2]! - ((s * feet.moved[0]!) / k) * loose;
        hold[i * 2 + 1] = hold[i * 2 + 1]! - ((s * feet.moved[1]!) / k) * loose;
      }
      const wx = this.balls[i * 3]! + feet.want[i * 2]! * lower + run[i * 2]! + hold[i * 2]! + (i === 0 ? stance : -stance) + fit.x * air;
      const wy = this.balls[i * 3 + 1]! + feet.want[i * 2 + 1]! * lower + run[i * 2 + 1]! + hold[i * 2 + 1]! + fit.y * air;
      wanted[i * 2] = wx;
      wanted[i * 2 + 1] = wy;
      court[i * 2] = this.x + s * wx * k;
      court[i * 2 + 1] = this.y + s * wy * k;
      // In the air, or running, a foot is wherever the pose has it.
      this.loose[i] = snap || planted <= 0 || air > 0.5;
      if (this.loose[i]) {
        feet.down[i] = false;
        feet.t[i] = 1;
      } else if (feet.t[i]! >= 1 && !feet.down[i]) {
        // It has just come down: there it stays.
        feet.down[i] = true;
        feet.at[i * 2] = court[i * 2]!;
        feet.at[i * 2 + 1] = court[i * 2 + 1]!;
      }
    }
    // A foot that is down and is wanted somewhere else steps there, one foot at a time: while the other
    // one is in the air it waits. If both want to go, the one further from where it should be goes first.
    let first = -1;
    let furthest = drift;
    for (let i = 0; i < 2; i++) {
      if (this.loose[i] || feet.t[i]! < 1) continue;
      const other = 1 - i;
      const away = Math.hypot(court[i * 2]! - feet.at[i * 2]!, court[i * 2 + 1]! - feet.at[i * 2 + 1]!);
      if (feet.t[other]! < 1 || (this.loose[other] && away <= FOOT_FAR * k)) continue;
      if (away > furthest) {
        furthest = away;
        first = i;
      }
    }
    if (first >= 0) {
      const length = furthest / k;
      feet.from[first * 2] = feet.at[first * 2]!;
      feet.from[first * 2 + 1] = feet.at[first * 2 + 1]!;
      feet.to[first * 2] = court[first * 2]!;
      feet.to[first * 2 + 1] = court[first * 2 + 1]!;
      feet.dur[first] = clamp(0.1 + 0.22 * length, 0.12, 0.24);
      feet.high[first] = Math.min(0.12, 0.03 + 0.15 * length);
      feet.t[first] = 0;
    }
    for (let i = 0; i < 2; i++) {
      const o = i * 3;
      const q = i * 2;
      const air = this.air[i]!;
      const wx = wanted[q]!;
      const wy = wanted[q + 1]!;
      const cx = court[q]!;
      const cy = court[q + 1]!;
      let x = wx;
      let y = wy;
      // Down with the body only if the whole body is coming down from a jump: when the hips sink, the
      // knees bend and a foot in the air stays off the floor.
      const lift = this.balls[o + 2]! - this.toeFloor;
      let z = Math.max(this.balls[o + 2]! + fit.jump * air, this.toeFloor + Math.min(lift, lift * JUMP_KEEPS));
      if (!this.loose[i]) {
        let ax = feet.at[q]!;
        let ay = feet.at[q + 1]!;
        if (feet.t[i]! < 1) {
          // Up, across and down, to wherever the pose wants it now; on the way down it no longer changes
          // its mind, so it does not come down sliding.
          const t = Math.min(1, feet.t[i]! + dt / feet.dur[i]!);
          feet.t[i] = t;
          if (t < STEP_SETTLES) {
            feet.to[q] = cx;
            feet.to[q + 1] = cy;
          }
          const u = smoothstep(0, 1, t);
          ax = feet.from[q]! + (feet.to[q]! - feet.from[q]!) * u;
          ay = feet.from[q + 1]! + (feet.to[q + 1]! - feet.from[q + 1]!) * u;
          z += feet.high[i]! * Math.sin(Math.PI * t) * planted;
          if (t >= 1) {
            feet.down[i] = true;
            feet.at[q] = feet.to[q]!;
            feet.at[q + 1] = feet.to[q + 1]!;
          }
        }
        // Back to the character's own metres; walking, a little of the pose.
        x = wx + (s * (ax - this.x) / k - wx) * planted;
        y = wy + (s * (ay - this.y) / k - wy) * planted;
      }
      feet.off[q] = x - this.balls[o]!;
      feet.off[q + 1] = y - this.balls[o + 1]!;
      // The ankle, from the ball of the foot, with the foot turned as the pose has it.
      this.targets[o] = x - (this.balls[o]! - this.ankles[o]!);
      this.targets[o + 1] = y - (this.balls[o + 1]! - this.ankles[o + 1]!);
      this.targets[o + 2] = z - (this.balls[o + 2]! - this.ankles[o + 2]!);
    }
    // Nothing to do when the hips stay and the feet are where the pose has them: most of the time.
    const drop = fit.z - crouch;
    // The character looks along its own -y: sitting back is +y.
    const along = fit.y + back;
    let away = Math.abs(fit.x) + Math.abs(along) + Math.abs(drop);
    for (let c = 0; c < 6; c++) away += Math.abs(this.targets[c]! - this.ankles[c]!);
    if (away < 2e-3) return;
    const root = character.bones * 4;
    pose[root] = pose[root]! + fit.x;
    pose[root + 1] = pose[root + 1]! + along;
    pose[root + 2] = pose[root + 2]! + drop;
    solveSkeleton(character, pose, skeleton, this.style);
    worldRotations(character, pose, this.world);
    this.bendLegs();
    // A knee never goes through the floor, and a leg folded as far as a knee goes does not push its foot
    // through it either: the hips come up for them. Up comes the knee by less than the hips do, so it may
    // take a second look.
    for (let pass = 0; pass < 3; pass++) {
      const knee = Math.min(pos[this.bothLegs[0]!.lower * 3 + 2]!, pos[this.bothLegs[1]!.lower * 3 + 2]!);
      let up = knee < KNEE_FLOOR - 0.002 ? (KNEE_FLOOR - knee) * 1.5 : 0;
      for (let i = 0; i < 2; i++) up = Math.max(up, this.tooFolded(i));
      if (up <= 0) break;
      pose[root + 2] = pose[root + 2]! + up;
      fit.z += up;
      solveSkeleton(character, pose, skeleton, this.style);
      worldRotations(character, pose, this.world);
      this.bendLegs();
    }
  }

  /**
   * How much higher the hips would have to be for leg `i` to get its ankle to
   * its target, when the knee is as bent as it goes and the ankle is further
   * from the hip than the target: 0 otherwise. The skeleton has to be solved.
   */
  private tooFolded(i: number): number {
    const pos = this.skeleton.pos;
    const leg = this.bothLegs[i]!;
    const h = leg.upper * 3;
    const a = leg.end * 3;
    const o = i * 3;
    const reached = Math.hypot(pos[a]! - pos[h]!, pos[a + 1]! - pos[h + 1]!, pos[a + 2]! - pos[h + 2]!);
    const wanted = Math.hypot(this.targets[o]! - pos[h]!, this.targets[o + 1]! - pos[h + 1]!, this.targets[o + 2]! - pos[h + 2]!);
    return reached - wanted > 0.005 ? reached - wanted : 0;
  }

  /** Bends both legs so the ankles are at `this.targets`, each knee the way the pose has it pointing. */
  private bendLegs(): void {
    const character = this.character;
    for (let i = 0; i < 2; i++) {
      const o = i * 3;
      reachLimb(character, this.pose, this.skeleton, this.world, this.bothLegs[i]!, this.targets[o]!, this.targets[o + 1]!, this.targets[o + 2]!);
    }
    solveSkeleton(character, this.pose, this.skeleton, this.style);
  }

  /**
   * Takes the racket from where the clip has it toward where the ball really
   * is, with the body where the fit put it: a little, never all the way at
   * any cost (see `BODY.arm`). `weight` is how much of that: it grows as the
   * contact comes and goes away right after it, so the whole swing is bent
   * toward the ball instead of the racket jumping to it. `hit` is where the
   * racket meets the ball as it is drawn, without the arm. The skeleton has to
   * be the one of the pose.
   */
  private reachArm(player: ScenePlayer, hit: readonly [number, number, number] | null, s: number, k: number, weight: number): void {
    if (!hit || this.arm.upper < 0 || this.racket < 0) return;
    const character = this.character;
    const fit = this.fit;
    // What still separates the ball from where this clip meets it, in the character's own axes at life size.
    // The ball of a serve drops from the server's own hand: it is as much bigger than life as the server.
    const own = player.anim === 'serve' ? k : 1;
    const dx = (s * (player.x + player.reachX * own - this.x)) / k - hit[0] - fit.x;
    const dy = (s * (player.y + player.reachY * own - this.y)) / k - hit[1] - fit.y;
    const dz = (player.reachZ * own) / k - hit[2] - fit.z;
    // As far as the arm goes without being thrown at the ball: the further, the less of it.
    const far = Math.hypot(dx, dy, dz);
    if (far < 1e-6) return;
    const block = player.why === 'block' && player.anim === 'swing';
    const taken = soften(far, block ? BODY.armBlockSoft : BODY.armSoft, block ? BODY.armBlock : BODY.arm) / far;
    const scale = taken * weight;
    // Where the racket is going to be when it gets there: the clip's place, the body's way and all of the arm's.
    this.planned[0] = hit[0] + fit.x + dx * taken;
    this.planned[1] = hit[1] + fit.y + dy * taken;
    this.planned[2] = hit[2] + fit.z + dz * taken;
    this.planning = true;
    worldRotations(character, this.pose, this.world);
    // It is the racket that the arm takes there, with the wrist as the clip has it: the wrist is never bent for it.
    const racket = boneToCharacter(this.skeleton, this.racket, character.meta.racketCenter, this.at);
    reachLimb(character, this.pose, this.skeleton, this.world, this.arm, racket[0] + dx * scale, racket[1] + dy * scale, racket[2] + dz * scale, racket);
    solveSkeleton(character, this.pose, this.skeleton, this.style);
  }

  /**
   * Works out which gesture the character is making, if any. While there is
   * one it is kept in `this.gesture`; when it ends, the last one stays there
   * to fade away. Returns whether one is on show. A tic that has a clip of
   * its own is not a gesture: the clip does it.
   */
  private readGesture(player: ScenePlayer, s: number, clipped: boolean): boolean {
    const tell = player.tell;
    if (tell && tell.pose) {
      this.gesture = noGesture();
      // Where the ball is meant to go is measured across the court; the character has its own left.
      tellGesture(tell.pose, tell.kind, s * tell.aimX, this.gesture);
      return true;
    }
    // «Perdón», to the partner, for a ball it stole and lost.
    if (this.sorryLeft > 0) {
      this.gesture = noGesture();
      sorryGesture(SORRY - this.sorryLeft, s * this.sorryToward, this.gesture);
      return true;
    }
    // A ball fired at its body: around the block, it flinches.
    if (player.why === 'block' && player.anim === 'swing' && Math.abs(player.contactIn) < 0.35) {
      this.gesture = noGesture();
      flinchGesture(player.animSide === player.restSide, this.gesture);
      return true;
    }
    // A ball read late: caught on its heels.
    if (player.surprise > 0.25) {
      this.gesture = noGesture();
      surpriseGesture(this.gesture);
      return true;
    }
    const call = player.call;
    // What it tells its partner, as long as its own stroke is not about to need the arm.
    if (call && !(player.contactIn < CALL_CLEAR && player.contactIn > -0.2)) {
      this.gesture = noGesture();
      callGesture(call.kind, call.t, s * call.towardX, this.gesture);
      return true;
    }
    const act = player.act;
    const resting = player.anim === 'idle' || player.animPhase >= 1;
    if (act && resting && !clipped && act.t < act.duration) {
      this.gesture = noGesture();
      actGesture(act.clip, act.t, act.duration, this.gesture);
      return true;
    }
    return false;
  }

  /**
   * Leans the trunk forward by `angle` radians (back, if less than 0) from the
   * hips, round the character's own left-to-right axis. The skeleton has to
   * be the one of the pose; it is solved again.
   */
  private leanTrunk(angle: number): void {
    const spine = this.spineBone;
    const hips = this.character.meta.bones.parents[spine] ?? -1;
    if (spine < 0 || hips < 0) return;
    worldRotations(this.character, this.pose, this.world);
    // The turn is in the character's axes; the spine's own rotation is relative to the hips:
    // new = hips⁻¹ · turn · hips · old.
    const half = angle / 2;
    const q = this.q;
    q[0] = Math.sin(half);
    q[1] = 0;
    q[2] = 0;
    q[3] = Math.cos(half);
    const h = hips * 4;
    const inverse = this.turn;
    inverse[0] = -this.world[h]!;
    inverse[1] = -this.world[h + 1]!;
    inverse[2] = -this.world[h + 2]!;
    inverse[3] = this.world[h + 3]!;
    multiplyQuaternions(inverse, 0, q, 0, inverse, 0);
    multiplyQuaternions(inverse, 0, this.world, h, inverse, 0);
    multiplyQuaternions(inverse, 0, this.pose, spine * 4, this.pose, spine * 4);
    solveSkeleton(this.character, this.pose, this.skeleton, this.style);
  }

  /**
   * Puts the arms and the head where the gesture has them, as much as
   * `weight` says, and the hand with the racket as much as `racket` says.
   * How low the hips go and how wide the feet are is the body's: see
   * `placeBody`. The skeleton has to be the one of the pose.
   */
  private gesticulate(weight: number, racket: number): void {
    const character = this.character;
    const pose = this.pose;
    const skeleton = this.skeleton;
    const style = this.style;
    const pos = skeleton.pos;
    const g = this.gesture;

    if (g.free || g.racket) {
      worldRotations(character, pose, this.world);
      for (let i = 0; i < 2; i++) {
        const limb = i === 0 ? this.freeArm : this.arm;
        const target = i === 0 ? g.free : g.racket;
        if (!target || limb.upper < 0 || limb.lower < 0 || limb.end < 0) continue;
        const hand = limb.end * 3;
        const w = i === 0 ? weight : racket;
        if (w <= 0.001) continue;
        // The elbow keeps pointing the way the clip has it: down and a little out for an arm at the side.
        reachLimb(
          character,
          pose,
          skeleton,
          this.world,
          limb,
          pos[hand]! + (target[0] - pos[hand]!) * w,
          pos[hand + 1]! + (target[1] - pos[hand + 1]!) * w,
          pos[hand + 2]! + (target[2] - pos[hand + 2]!) * w,
        );
      }
    }

    if (g.tip !== 0 && this.neck >= 0) {
      // A turn round the character's own front-to-back axis: the head tips toward a shoulder.
      const half = (g.tip * weight) / 2;
      this.q[0] = 0;
      this.q[1] = Math.sin(half);
      this.q[2] = 0;
      this.q[3] = Math.cos(half);
      multiplyQuaternions(pose, this.neck * 4, this.q, 0, pose, this.neck * 4);
    }
    solveSkeleton(character, pose, skeleton, style);
  }

  /** Where the middle of the racket is, on the court, with the pose of the last update. */
  racketOnCourt(k: number, facing: 1 | -1, out: [number, number, number]): [number, number, number] {
    const s = facing > 0 ? -1 : 1;
    boneToCharacter(this.skeleton, this.racket, this.character.meta.racketCenter, this.at);
    out[0] = this.x + s * this.at[0] * k;
    out[1] = this.y + s * this.at[1] * k;
    out[2] = this.at[2] * k;
    return out;
  }

  /**
   * The head of the racket on the court, with the pose of the last update:
   * where a ball is drawn when it is hit (see `stage/contact.ts`). False when
   * there is no racket. The head is flat across the racket bone's own x and
   * y: its faces look along the bone's z.
   */
  racketFace(k: number, facing: 1 | -1, out: RacketFace): boolean {
    if (this.racket < 0) return false;
    const s = facing > 0 ? -1 : 1;
    boneToCharacter(this.skeleton, this.racket, this.character.meta.racketCenter, this.at);
    out.x = this.x + s * this.at[0] * k;
    out.y = this.y + s * this.at[1] * k;
    out.z = this.at[2] * k;
    const o = this.racket * 9;
    const rot = this.skeleton.rot;
    out.nx = s * rot[o + 2]!;
    out.ny = s * rot[o + 5]!;
    out.nz = rot[o + 8]!;
    out.reach = RACKET_FACE.reach * k;
    out.half = RACKET_FACE.half * k;
    return true;
  }

  /**
   * Where the middle of the racket is going to meet the ball, on the court,
   * as the stroke on show plans it in the last update: the clip's place, with
   * the body and the arm as they go for it. False when no stroke is going for
   * a ball.
   *
   * A hand that turns no faster than a wrist does can be a little behind the
   * turn the clip has it in at the moment, and so is the racket: `behind` is
   * how much of that to count, all of it to say where the racket is right at
   * the contact.
   */
  racketAtContact(k: number, facing: 1 | -1, out: number[], behind = 1): boolean {
    if (!this.planning) return false;
    const s = facing > 0 ? -1 : 1;
    const lag = behind > 0 ? this.racketBehind(this.lag) : this.lag.fill(0);
    out[0] = this.x + s * (this.planned[0] + lag[0] * behind) * k;
    out[1] = this.y + s * (this.planned[1] + lag[1] * behind) * k;
    out[2] = (this.planned[2] + lag[2] * behind) * k;
    return true;
  }

  /**
   * How far the middle of the racket is, in the character's own axes, from
   * where it would be if its hand had turned as far as it was going to in the
   * last update (see `keepWrist`): nothing, most of the time.
   */
  private racketBehind(out: [number, number, number]): [number, number, number] {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    const wrist = this.wrists[1]!;
    const hand = wrist.bone;
    const fore = this.arm.lower;
    if (!wrist.kept || hand < 0 || fore < 0 || this.racket < 0) return out;
    const { rot, pos } = this.skeleton;
    // The racket from the wrist, in the axes of the forearm.
    boneToCharacter(this.skeleton, this.racket, this.character.meta.racketCenter, this.at);
    const vx = this.at[0] - pos[hand * 3]!;
    const vy = this.at[1] - pos[hand * 3 + 1]!;
    const vz = this.at[2] - pos[hand * 3 + 2]!;
    const f = fore * 9;
    const ux = rot[f]! * vx + rot[f + 3]! * vy + rot[f + 6]! * vz;
    const uy = rot[f + 1]! * vx + rot[f + 4]! * vy + rot[f + 7]! * vz;
    const uz = rot[f + 2]! * vx + rot[f + 5]! * vy + rot[f + 8]! * vz;
    // Turned from the hand it has to the hand it was going for: wanted · last⁻¹.
    const l = wrist.last;
    const w = wrist.wanted;
    const q = this.turn;
    multiplyQuaternions(w, 0, [-l[0]!, -l[1]!, -l[2]!, l[3]!], 0, q, 0);
    const cx = q[1]! * uz - q[2]! * uy + q[3]! * ux;
    const cy = q[2]! * ux - q[0]! * uz + q[3]! * uy;
    const cz = q[0]! * uy - q[1]! * ux + q[3]! * uz;
    const tx = ux + 2 * (q[1]! * cz - q[2]! * cy);
    const ty = uy + 2 * (q[2]! * cx - q[0]! * cz);
    const tz = uz + 2 * (q[0]! * cy - q[1]! * cx);
    // Back to the character's axes: how far the racket is from there.
    out[0] = vx - (rot[f]! * tx + rot[f + 1]! * ty + rot[f + 2]! * tz);
    out[1] = vy - (rot[f + 3]! * tx + rot[f + 4]! * ty + rot[f + 5]! * tz);
    out[2] = vz - (rot[f + 6]! * tx + rot[f + 7]! * ty + rot[f + 8]! * tz);
    return out;
  }

  /** The head turns to the ball, and the braid lags behind the movement of the head like a pendulum. */
  private look(
    pose: Float32Array,
    s: number,
    k: number,
    ball: { x: number; y: number; z: number; visible: boolean },
    dt: number,
    amount: number,
    snap: boolean,
  ): void {
    const { rot, pos } = this.skeleton;
    const head = this.head;
    const q = this.q;
    if (head < 0 || this.neck < 0) return;

    // The ball in the character's own axes, seen from the head, in the frame of the neck.
    const hx = pos[head * 3]!;
    const hy = pos[head * 3 + 1]!;
    const hz = pos[head * 3 + 2]! + 0.12;
    const dx = (s * (ball.x - this.x)) / k - hx;
    const dy = (s * (ball.y - this.y)) / k - hy;
    const dz = ball.z / k - hz;
    const o = this.neck * 9;
    const lx = rot[o]! * dx + rot[o + 3]! * dy + rot[o + 6]! * dz;
    const ly = rot[o + 1]! * dx + rot[o + 4]! * dy + rot[o + 7]! * dz;
    const lz = rot[o + 2]! * dx + rot[o + 5]! * dy + rot[o + 8]! * dz;
    const length = Math.hypot(lx, ly, lz) || 1;
    let yaw = Math.atan2(lx, -ly);
    // A ball behind its back: it does not turn its head all the way round.
    if (Math.abs(yaw) > 1.9) yaw = 0;
    yaw = clamp(yaw, -1.1, 1.1);
    const pitch = clamp(Math.asin(clamp(lz / length, -1, 1)), -0.35, 0.6);
    const follow = snap ? 1 : 1 - Math.exp(-dt * 9);
    this.lookYaw += (yaw - this.lookYaw) * follow;
    this.lookPitch += (pitch - this.lookPitch) * follow;
    yawPitch(this.lookYaw * 0.85, -this.lookPitch * 0.8, q);
    const w = amount * (ball.visible ? 1 : 0);
    const h = head * 4;
    const dot = pose[h]! * q[0]! + pose[h + 1]! * q[1]! + pose[h + 2]! * q[2]! + pose[h + 3]! * q[3]!;
    const sign = dot < 0 ? -1 : 1;
    for (let c = 0; c < 4; c++) pose[h + c] = pose[h + c]! * (1 - w) + q[c]! * sign * w;

    // The braid: a damped pendulum that hangs back from wherever the head is going.
    const wx = this.x + s * hx * k;
    const wy = this.y + s * hy * k;
    if (snap) {
      this.lastX = wx;
      this.lastY = wy;
      this.speedX = 0;
      this.speedY = 0;
      this.swayX = 0;
      this.swayY = 0;
      this.swaySpeedX = 0;
      this.swaySpeedY = 0;
    }
    const inv = dt > 0 ? 1 / dt : 0;
    const vx = (wx - this.lastX) * inv;
    const vy = (wy - this.lastY) * inv;
    this.lastX = wx;
    this.lastY = wy;
    const smooth = 1 - Math.exp(-dt * 14);
    this.speedX += (vx - this.speedX) * smooth;
    this.speedY += (vy - this.speedY) * smooth;
    const tx = clamp(-(s * this.speedY) * 0.1, -0.7, 0.7);
    const ty = clamp(s * this.speedX * 0.12, -0.7, 0.7);
    const step = Math.min(dt, 0.033);
    this.swaySpeedX += ((tx - this.swayX) * 70 - this.swaySpeedX * 7.5) * step;
    this.swayX += this.swaySpeedX * step;
    this.swaySpeedY += ((ty - this.swayY) * 70 - this.swaySpeedY * 7.5) * step;
    this.swayY += this.swaySpeedY * step;
    const gains = [0.35, 0.8, 1.15];
    for (let i = 0; i < this.braid.length; i++) {
      tilt(this.swayX * gains[i]! * amount, this.swayY * gains[i]! * amount, q);
      multiplyQuaternions(pose, this.braid[i]! * 4, q, 0, pose, this.braid[i]! * 4);
    }
  }
}

/** `x` as it is up to `knee`, and from there on less and less, never past `top`: it comes to a stop softly, not dead. */
function soften(x: number, knee: number, top: number): number {
  if (x <= knee) return x;
  const room = top - knee;
  return knee + room * (1 - Math.exp(-(x - knee) / room));
}

/** How much of the arm's way to the ball is taken `eta` seconds before the contact (negative after it). */
function lungeWeight(eta: number): number {
  if (eta >= 0) return 1 - smoothstep(0.04, 0.3, eta);
  return 1 - smoothstep(0.05, 0.32, -eta);
}

/**
 * A block: the racket is where the ball is going to be well before it gets
 * there, and waits for it; after the contact it lets go as a stroke does.
 */
function blockWeight(eta: number): number {
  return eta >= 0 ? 1 - smoothstep(0.15, 0.32, eta) : lungeWeight(eta);
}

/**
 * How much of the body's way to the ball is taken `eta` seconds before the
 * contact (negative after it): the hips are set before the swing, and stay
 * a moment after it.
 */
function bodyWeight(eta: number): number {
  if (eta >= 0) return 1 - smoothstep(0.1, 0.45, eta);
  return 1 - smoothstep(0.15, 0.5, -eta);
}

/** A turn round z (side to side) and then round x (up and down), as a quaternion. */
function yawPitch(yaw: number, pitch: number, out: Float32Array): Float32Array {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  out[0] = cy * sp;
  out[1] = sy * sp;
  out[2] = sy * cp;
  out[3] = cy * cp;
  return out;
}

/** A small turn round x and round y. */
function tilt(rx: number, ry: number, out: Float32Array): Float32Array {
  const cx = Math.cos(rx / 2);
  const sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2);
  const sy = Math.sin(ry / 2);
  out[0] = sx * cy;
  out[1] = cx * sy;
  out[2] = sx * sy;
  out[3] = cx * cy;
  return out;
}
