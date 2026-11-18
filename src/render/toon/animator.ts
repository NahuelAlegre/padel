import { clamp, smoothstep } from '../../core/math';
import type { MannerismClip, TellCue, TellPose } from '../../characters/types';
import type { ScenePlayer } from '../scene';
import {
  blendPose,
  boneToCharacter,
  createSkeleton,
  samplePose,
  skinMatrices,
  solveSkeleton,
  type Character,
  type Clip,
  type Skeleton,
} from './character';
import { bendLimb, worldRotations, type Limb } from './reach';

/**
 * Turns what the simulation says about a player into the pose of its body.
 *
 * The simulation knows where the player is, how fast it moves, whether it has
 * the racket back or is swinging, which stroke that is and when the racket
 * meets the ball. The clips know what a run or a forehand looks like. This is
 * what goes in between:
 *
 *   - Legs follow the ground: a run cycle advances with the metres really
 *     covered, so the feet do not skate, whatever the speed.
 *   - A stroke is stretched in time so that the frame of the clip in which
 *     the racket meets the ball falls on the instant the simulation hits it.
 *     Armed early, the body takes the racket back and waits there.
 *   - The upper body can be in a stroke while the legs keep running: a player
 *     may be moved while it aims.
 *   - The ball is where the simulation says, not where the clip expects it.
 *     Around the contact the body takes a step toward it, sinks for a low
 *     one with its feet still on the floor, and the arm takes the racket
 *     the rest of the way.
 *   - A character adds its own on top: the windup that gives its shot away
 *     and a short tic between points, as a few places for its hands, its
 *     hips and its feet to be.
 *   - Changes are cross-faded, never cut.
 *   - The head follows the ball and the braid swings behind the movement.
 *
 * Clips may carry what is needed for this (metres per cycle, moment of
 * contact, where the racket is then). When a clip does not, a reasonable
 * value is used.
 */

/** Metres one cycle of each way of moving covers at life size, for clips that do not say. */
const DEFAULT_STRIDE: Record<string, number> = { correr: 1.45, lateral_izq: 1.05, lateral_der: 1.05 };
/** Below this speed, in metres per second, the player is standing. */
const STANDING_SPEED = 0.45;
/** Seconds a change of clip takes to fade in. */
const FADE = 0.14;
/** The last stretch before the contact is always played in step with it; before that the body waits. */
const SYNCED_LEAD = 0.24;
/** Seconds a stroke takes to take over the upper body, and to give it back. */
const STROKE_IN = 0.12;
const STROKE_OUT = 0.2;
/**
 * A stroke asked for at the last moment (a flick, a key, a thumb let go as
 * the ball arrives) has no time to fade in: it is there by the time the ball
 * is, in no less than this. It reads as a quick swing, not as a jump.
 */
const QUICKEST = 0.035;
/** How far the body may step toward a ball it would not reach from where it stands, in metres. */
const MAX_LUNGE = 0.9;
/** A player that moved further than this between two frames did not run there: it was put there. */
const TELEPORT = 1.5;
/**
 * A ball lower than the clip expects: how much lower it can be before the
 * body starts to sink for it, and how far it sinks, in metres at life size.
 */
const CROUCH_FREE = 0.1;
const MAX_CROUCH = 0.36;
/** How far the arm takes the racket from where the clip has it, in metres at life size. */
const MAX_ARM = 0.5;
/** Seconds a gesture of a character takes to show, and to go away. */
const GESTURE_IN = 0.14;
const GESTURE_OUT = 0.12;
/**
 * A tell is a windup: it is held until this long before the contact, in
 * seconds, and then it lets go, so that the swing itself is the stroke's.
 * The racket lets go first, because the swing needs it; the free hand, the
 * hips and the feet can keep saying it a little longer.
 */
const TELL_RACKET_UNTIL = 0.3;
const TELL_BODY_UNTIL = 0.16;

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
}

function noGesture(): Gesture {
  return { free: null, racket: null, crouch: 0, stance: 0, tip: 0, step: 0 };
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

/** A tic between points, `t` seconds into it. */
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

/** Strokes in which the body does not sink for a lower ball: over the head and in the serve, the arm bends instead. */
const NO_CROUCH: ReadonlySet<string> = new Set(['remate', 'saque']);

/** Bones that belong to the legs: they follow the ground when the player moves. */
const LEG_BONES = ['thigh.L', 'shin.L', 'foot.L', 'toe.L', 'thigh.R', 'shin.R', 'foot.R', 'toe.R'];

export interface AnimatedFigure {
  /** Where the body is drawn, on the court: a step away from the player while it lunges. */
  x: number;
  y: number;
  /** The matrix of every bone. */
  bones: Float32Array;
}

/** What a clip says about its own stroke, with something sensible where it says nothing. */
export function contactOf(clip: Clip): number {
  return clip.contact ?? clip.dur * 0.52;
}

export function strideOf(clip: Clip): number {
  return clip.stride ?? DEFAULT_STRIDE[clip.name] ?? 1.2;
}

/**
 * A ball is "over the head" from this height up, in metres at life size.
 * Lower for the shots that are meant to be played from above.
 */
const OVERHEAD_FROM = 1.5;
const OVERHEAD_ANYWAY = 1.95;

/**
 * Which clip plays a stroke of the simulation. `k` is how much bigger than
 * life the player is drawn: a ball two metres up is over the head of somebody
 * life-sized and at the chest of somebody drawn half as big again, and it is
 * the body that has to look right.
 */
export function strokeClipName(player: ScenePlayer, k = 1): string {
  if (player.anim === 'serve') return 'saque';
  // Forehand: the ball is on the side the racket hand is on.
  const forehand = player.animSide === player.restSide;
  const height = player.reachZ / k;
  const fromAbove = player.shot === 'smash' || player.shot === 'bandeja' || player.shot === 'vibora';
  if (height >= (fromAbove ? OVERHEAD_FROM : OVERHEAD_ANYWAY)) return 'remate';
  if (player.shot === 'lob') return forehand ? 'globo' : 'reves';
  return forehand ? 'derecha' : 'reves';
}

/**
 * Which moment of a stroke clip to show `eta` seconds before the contact
 * (negative after it), given the moment that was shown `dt` seconds ago.
 *
 * Close to the contact the clip is in step with the simulation: the contact
 * frame falls on the contact. Further away than that, the body goes through
 * its preparation in real time and then holds the racket back.
 */
export function strokeTime(clip: Clip, eta: number, previous: number, dt: number): number {
  const contact = contactOf(clip);
  const hold = Math.max(0, contact - Math.min(SYNCED_LEAD, contact * 0.6));
  const inStep = contact - eta;
  if (inStep >= hold) return Math.min(inStep, clip.dur);
  return Math.min(Math.max(previous, 0) + dt, hold);
}

export class FigureAnimator implements AnimatedFigure {
  x = 0;
  y = 0;
  readonly bones: Float32Array;
  /** Where every bone is, in the character's own axes, after the last update. */
  readonly skeleton: Skeleton;

  private readonly pose: Float32Array;
  private readonly ground: Float32Array;
  private readonly groundFrom: Float32Array;
  private readonly groundNext: Float32Array;
  private readonly stroke: Float32Array;
  private readonly legs: boolean[];
  private groundClip = '';
  private groundMix = 1;
  private idleTime = 0;
  private readonly strokeFrom: Float32Array;
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
  private lungeX = 0;
  private lungeY = 0;
  private started = false;

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

  private readonly racket: number;
  private readonly at: [number, number, number] = [0, 0, 0];
  /** The racket arm and both legs, for bending them to where they have to be. */
  private readonly arm: Limb;
  private readonly bothLegs: Limb[];
  private readonly freeArm: Limb;
  private readonly world: Float32Array;
  private readonly ankles = new Float32Array(6);
  /** The gesture on show, or the last one while it goes away, and how much of it there is. */
  private gesture = noGesture();
  private gestureWeight = 0;
  private gestureRacket = 0;
  /** The little celebration of a point won: whether it is on, how far into it, and how much of it shows. */
  private cheering = false;
  private cheerTime = 0;
  private cheerWeight = 0;
  private readonly cheerPose: Float32Array;
  private seenX = 0;
  private seenY = 0;

  constructor(private readonly character: Character) {
    const size = character.poseSize;
    this.bones = new Float32Array(26 * 16);
    this.skeleton = createSkeleton(character);
    this.pose = new Float32Array(size);
    this.ground = new Float32Array(size);
    this.groundFrom = new Float32Array(size);
    this.groundNext = new Float32Array(size);
    this.stroke = new Float32Array(size);
    this.strokeFrom = new Float32Array(size);
    this.legs = character.meta.bones.names.map((name) => LEG_BONES.includes(name));
    this.head = character.bone('head');
    this.neck = character.bone('neck');
    this.braid = ['braid1', 'braid2', 'braid3'].map((name) => character.bone(name)).filter((bone) => bone >= 0);
    this.racket = character.bone('racket');
    // The racket is in the right hand: the arm is the one that hand hangs from.
    const hand = character.meta.bones.parents[this.racket] ?? -1;
    const fore = character.meta.bones.parents[hand] ?? -1;
    this.arm = { upper: character.meta.bones.parents[fore] ?? -1, lower: fore, end: hand };
    this.freeArm = { upper: character.bone('upper_arm.L'), lower: character.bone('forearm.L'), end: character.bone('hand.L') };
    this.bothLegs = ['L', 'R'].map((side) => ({
      upper: character.bone(`thigh.${side}`),
      lower: character.bone(`shin.${side}`),
      end: character.bone(`foot.${side}`),
    }));
    this.world = new Float32Array(character.bones * 4);
    this.cheerPose = new Float32Array(size);
  }

  /** Forgets everything: the next update starts from scratch, with no fade (a new point, a new match). */
  reset(): void {
    this.started = false;
    this.cheering = false;
    this.cheerWeight = 0;
  }

  /**
   * The point was won: a short celebration, inside the pause that follows
   * every point anyway. It never delays anything: the next serve cuts it.
   */
  cheer(): void {
    if (!this.character.clips.festejo) return;
    this.cheering = true;
    this.cheerTime = 0;
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
  ): void {
    const character = this.character;
    const clips = character.clips;
    // Put somewhere else between two frames (a new point): nothing is carried over.
    const moved = Math.hypot(player.x - this.seenX, player.y - this.seenY);
    this.seenX = player.x;
    this.seenY = player.y;
    const snap = !this.started || moved > TELEPORT;
    this.started = true;
    // The character faces -y in its own axes. `s` takes the court's x and y to them.
    const s = facing > 0 ? -1 : 1;

    // ------------------------------------------------------------ the ground
    const speed = Math.hypot(player.vx, player.vy);
    const sideways = s * player.vx;
    const along = s * player.vy;
    let name = 'listo';
    let time = 0;
    if (speed < STANDING_SPEED) {
      this.idleTime += dt;
      time = this.idleTime;
    } else if (Math.abs(sideways) > Math.abs(along) * 0.75) {
      name = sideways > 0 ? 'lateral_izq' : 'lateral_der';
      const clip = clips[name]!;
      time = cycle(player.stride / (strideOf(clip) * k)) * clip.dur;
    } else {
      name = 'correr';
      const clip = clips[name]!;
      const phase = cycle(player.stride / (strideOf(clip) * k));
      // Backwards is the same run, played the other way.
      time = (along < 0 ? phase : 1 - phase) * clip.dur;
    }
    const groundClip = clips[name] ?? clips.listo!;
    samplePose(character, groundClip, time, this.groundNext);
    if (name !== this.groundClip) {
      this.groundFrom.set(this.ground);
      this.groundMix = snap || this.groundClip === '' ? 1 : 0;
      this.groundClip = name;
    }
    if (this.groundMix < 1) {
      this.groundMix = Math.min(1, this.groundMix + dt / FADE);
      blendPose(character.bones, this.groundFrom, this.groundNext, smoothstep(0, 1, this.groundMix), this.ground);
    } else {
      this.ground.set(this.groundNext);
    }

    // A point just won. Between points everybody walks to their place for
    // the next one, so the legs keep walking and the rest celebrates; standing
    // still, the whole body does. A stroke in progress is finished first.
    const festejo = clips.festejo;
    if (festejo && (this.cheering || this.cheerWeight > 0)) {
      const busy = player.anim !== 'idle' && player.animPhase < 1;
      // The clip keeps playing while it fades, so the way out is not a still pose.
      if (!busy || !this.cheering) this.cheerTime = Math.min(this.cheerTime + dt, festejo.dur);
      if (this.cheerTime >= festejo.dur - FADE) this.cheering = false;
      const on = this.cheering && !busy;
      this.cheerWeight = snap ? 0 : clamp(this.cheerWeight + dt / (on ? FADE : -FADE), 0, 1);
      if (this.cheerWeight > 0) {
        samplePose(character, festejo, this.cheerTime, this.cheerPose);
        const upper = smoothstep(0, 1, this.cheerWeight);
        const lower = upper * (1 - smoothstep(0.5, 1.8, speed));
        const ground = this.ground;
        const cheer = this.cheerPose;
        const bones = character.bones;
        for (let i = 0; i < bones; i++) {
          const w = this.legs[i] || i === 0 ? lower : upper;
          if (w <= 0) continue;
          const o = i * 4;
          const dot = ground[o]! * cheer[o]! + ground[o + 1]! * cheer[o + 1]! + ground[o + 2]! * cheer[o + 2]! + ground[o + 3]! * cheer[o + 3]!;
          const sign = dot < 0 ? -1 : 1;
          for (let c = 0; c < 4; c++) ground[o + c] = ground[o + c]! * (1 - w) + cheer[o + c]! * sign * w;
        }
        const p = bones * 4;
        for (let c = 0; c < 3; c++) ground[p + c] = ground[p + c]! * (1 - lower) + cheer[p + c]! * lower;
      }
    }

    // ------------------------------------------------------------ the stroke
    const wanted = player.anim !== 'idle' && player.animPhase < 1;
    const eta = player.contactIn;
    if (wanted) {
      const next = clips[strokeClipName(player, k)] ?? null;
      // A stroke that is past its contact cannot be before it again: that is another stroke.
      const another = this.strokePhase !== 'before' && eta > 0.02;
      if (next && (next !== this.strokeClip || another)) {
        if (this.strokeClip && this.strokeWeight > 0) {
          this.strokeFrom.set(this.stroke);
          this.strokeMix = snap ? 1 : 0;
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
        this.strokeAt = strokeTime(this.strokeClip, eta, this.strokeAt, dt);
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
    const clip = this.strokeClip;
    const active =
      clip !== null && this.strokePhase !== 'off' && !(this.strokePhase === 'after' && this.strokeAt >= clip.dur - STROKE_OUT);
    const target = active ? 1 : 0;
    // What is left until the contact, for a stroke on its way to it; nothing, for one that is past it.
    const left = this.strokePhase === 'before' ? eta : 0;
    const rate = dt / (target > this.strokeWeight ? clamp(left, QUICKEST, STROKE_IN) : STROKE_OUT);
    // The ball is being hit right now and the stroke has only just been asked for: the racket is on it in this
    // very frame. With the sparkle and the short freeze of a good hit, it is the frame that gets looked at.
    const struck = active && this.strokePhase === 'after' && this.strokeAt <= contactOf(clip) + 0.03;
    this.strokeWeight = snap || struck ? target : clamp(this.strokeWeight + clamp(target - this.strokeWeight, -rate, rate), 0, 1);
    if (clip && !active && this.strokeWeight <= 0) {
      this.strokeClip = null;
      this.strokePhase = 'off';
    }

    // ------------------------------------------------------------ together
    const pose = this.pose;
    pose.set(this.ground);
    let lungeX = 0;
    let lungeY = 0;
    let reach = 0;
    if (clip && this.strokeWeight > 0) {
      samplePose(character, clip, Math.min(this.strokeAt, clip.dur), this.stroke);
      if (this.strokeMix < 1) {
        this.strokeMix = Math.min(1, this.strokeMix + dt / clamp(left, QUICKEST, FADE));
        blendPose(character.bones, this.strokeFrom, this.stroke, smoothstep(0, 1, this.strokeMix), this.stroke);
      }
      const upper = smoothstep(0, 1, this.strokeWeight);
      // Standing, the whole body plays the stroke. Moving, the legs stay with the ground.
      const lower = upper * (1 - smoothstep(0.5, 1.8, speed));
      const bones = character.bones;
      for (let i = 0; i < bones; i++) {
        const w = this.legs[i] || i === 0 ? lower : upper;
        if (w <= 0) continue;
        const o = i * 4;
        const dot = pose[o]! * this.stroke[o]! + pose[o + 1]! * this.stroke[o + 1]! + pose[o + 2]! * this.stroke[o + 2]! + pose[o + 3]! * this.stroke[o + 3]!;
        const sign = dot < 0 ? -1 : 1;
        for (let c = 0; c < 4; c++) pose[o + c] = pose[o + c]! * (1 - w) + this.stroke[o + c]! * sign * w;
      }
      const p = bones * 4;
      for (let c = 0; c < 3; c++) pose[p + c] = pose[p + c]! * (1 - lower) + this.stroke[p + c]! * lower;

      // The ball is where the simulation says, not where the clip expects it:
      // around the contact the body takes a step toward it.
      const hit = clip.hit;
      if (hit && player.anim !== 'whiff' && this.strokePhase !== 'off' && Number.isFinite(player.contactIn)) {
        const near = lungeWeight(player.contactIn);
        if (near > 0) {
          // The ball of a serve is in the server's own hand: it is as much bigger than life as the server.
          const own = player.anim === 'serve' ? k : 1;
          const wantX = player.reachX * own - s * hit[0] * k;
          const wantY = player.reachY * own - s * hit[1] * k;
          const length = Math.hypot(wantX, wantY);
          const scale = length > MAX_LUNGE ? MAX_LUNGE / length : 1;
          lungeX = wantX * scale * near;
          lungeY = wantY * scale * near;
          reach = near * upper;
        }
      }
    }
    // The step eases in and out by itself, so nothing jumps if the plan changes. Right at the contact it hurries.
    const ease = snap ? 1 : 1 - Math.exp(-dt * (Math.abs(eta) < 0.06 ? 40 : 18));
    this.lungeX += (lungeX - this.lungeX) * ease;
    this.lungeY += (lungeY - this.lungeY) * ease;
    // What the character adds: its tell while the racket is back, a tic while it rests.
    const made = this.readGesture(player, s);
    const windup = player.tell !== null;
    const showing = made && !(windup && player.contactIn < TELL_BODY_UNTIL);
    const holding = made && !(windup && player.contactIn < TELL_RACKET_UNTIL);
    this.gestureWeight = snap ? (showing ? 1 : 0) : clamp(this.gestureWeight + dt / (showing ? GESTURE_IN : -GESTURE_OUT), 0, 1);
    this.gestureRacket = snap ? (holding ? 1 : 0) : clamp(this.gestureRacket + dt / (holding ? GESTURE_IN : -GESTURE_OUT), 0, 1);
    const gesture = smoothstep(0, 1, this.gestureWeight);
    this.x = player.x + this.lungeX;
    this.y = player.y + this.lungeY + facing * this.gesture.step * gesture;

    // ------------------------------------------------------------ life
    solveSkeleton(character, pose, this.skeleton);
    if (clip && reach > 0.001) this.reach(player, clip, s, k, reach);
    if (gesture > 0.001) this.gesticulate(gesture, Math.min(gesture, smoothstep(0, 1, this.gestureRacket)));
    this.look(pose, s, k, ball, dt, this.strokeWeight > 0.5 ? 0.4 : 0.8, snap);
    solveSkeleton(character, pose, this.skeleton);
    skinMatrices(character, this.skeleton, this.bones);
  }

  /**
   * Takes the racket from where the clip has it to where the ball really is.
   * `weight` is how much of the way: it grows as the contact comes and goes
   * away after it, so the whole swing is bent toward the ball instead of the
   * racket jumping to it. The skeleton has to be the one of the pose.
   */
  private reach(player: ScenePlayer, clip: Clip, s: number, k: number, weight: number): void {
    const hit = clip.hit;
    if (!hit || this.arm.upper < 0) return;
    const character = this.character;
    const pose = this.pose;
    const skeleton = this.skeleton;
    const pos = skeleton.pos;
    // What separates the ball from where this clip meets it, in the character's own axes at life size.
    // The ball of a serve drops from the server's own hand: it is as much bigger than life as the server.
    const own = player.anim === 'serve' ? k : 1;
    const dx = (s * (player.x + player.reachX * own - this.x)) / k - hit[0];
    const dy = (s * (player.y + player.reachY * own - this.y)) / k - hit[1];
    let dz = (player.reachZ * own) / k - hit[2];

    // A low ball: the body sinks, and the legs bend so the feet stay where they were.
    const sink = NO_CROUCH.has(clip.name) ? 0 : clamp(-dz - CROUCH_FREE, 0, MAX_CROUCH);
    if (sink * weight > 0.004 && this.bothLegs.every((leg) => leg.upper >= 0 && leg.lower >= 0 && leg.end >= 0)) {
      for (let i = 0; i < 2; i++) {
        const foot = this.bothLegs[i]!.end * 3;
        for (let c = 0; c < 3; c++) this.ankles[i * 3 + c] = pos[foot + c]!;
      }
      const pelvis = character.bones * 4 + 2;
      pose[pelvis] = pose[pelvis]! - sink * weight;
      solveSkeleton(character, pose, skeleton);
      worldRotations(character, pose, this.world);
      // Knees go forward: the character looks along its own -y.
      for (let i = 0; i < 2; i++) {
        bendLimb(character, pose, skeleton, this.world, this.bothLegs[i]!, this.ankles[i * 3]!, this.ankles[i * 3 + 1]!, this.ankles[i * 3 + 2]!, 0, -0.6, 0);
      }
      solveSkeleton(character, pose, skeleton);
      dz += sink;
    }

    // The arm takes the racket the rest of the way, as far as an arm goes.
    const far = Math.hypot(dx, dy, dz);
    const scale = (far > MAX_ARM ? MAX_ARM / far : 1) * weight;
    worldRotations(character, pose, this.world);
    const hand = this.arm.end * 3;
    bendLimb(character, pose, skeleton, this.world, this.arm, pos[hand]! + dx * scale, pos[hand + 1]! + dy * scale, pos[hand + 2]! + dz * scale);
    solveSkeleton(character, pose, skeleton);
  }

  /**
   * Works out which gesture the character is making, if any. While there is
   * one it is kept in `this.gesture`; when it ends, the last one stays there
   * to fade away. Returns whether one is on show.
   */
  private readGesture(player: ScenePlayer, s: number): boolean {
    const tell = player.tell;
    if (tell && tell.pose) {
      this.gesture = noGesture();
      // Where the ball is meant to go is measured across the court; the character has its own left.
      tellGesture(tell.pose, tell.kind, s * tell.aimX, this.gesture);
      return true;
    }
    const act = player.act;
    const resting = player.anim === 'idle' || player.animPhase >= 1;
    if (act && resting && act.t < act.duration) {
      this.gesture = noGesture();
      actGesture(act.clip, act.t, act.duration, this.gesture);
      return true;
    }
    return false;
  }

  /**
   * Puts the limbs where the gesture has them, as much as `weight` says, and
   * the hand with the racket as much as `racket` says. The skeleton has to be
   * the one of the pose.
   */
  private gesticulate(weight: number, racket: number): void {
    const character = this.character;
    const pose = this.pose;
    const skeleton = this.skeleton;
    const pos = skeleton.pos;
    const g = this.gesture;

    if ((g.crouch > 0 || g.stance > 0) && this.bothLegs.every((leg) => leg.upper >= 0 && leg.lower >= 0 && leg.end >= 0)) {
      for (let i = 0; i < 2; i++) {
        const foot = this.bothLegs[i]!.end * 3;
        for (let c = 0; c < 3; c++) this.ankles[i * 3 + c] = pos[foot + c]!;
      }
      const pelvis = character.bones * 4 + 2;
      pose[pelvis] = pose[pelvis]! - g.crouch * weight;
      solveSkeleton(character, pose, skeleton);
      worldRotations(character, pose, this.world);
      for (let i = 0; i < 2; i++) {
        // The left foot goes further left and the right one further right.
        const out = (i === 0 ? 1 : -1) * g.stance * weight;
        bendLimb(character, pose, skeleton, this.world, this.bothLegs[i]!, this.ankles[i * 3]! + out, this.ankles[i * 3 + 1]!, this.ankles[i * 3 + 2]!, 0, -0.6, 0);
      }
      solveSkeleton(character, pose, skeleton);
    }

    if (g.free || g.racket) {
      worldRotations(character, pose, this.world);
      for (let i = 0; i < 2; i++) {
        const limb = i === 0 ? this.freeArm : this.arm;
        const target = i === 0 ? g.free : g.racket;
        if (!target || limb.upper < 0 || limb.lower < 0 || limb.end < 0) continue;
        const hand = limb.end * 3;
        const w = i === 0 ? weight : racket;
        if (w <= 0.001) continue;
        // Elbows stay low and a little out, so an arm that comes up does not cross the body.
        bendLimb(
          character,
          pose,
          skeleton,
          this.world,
          limb,
          pos[hand]! + (target[0] - pos[hand]!) * w,
          pos[hand + 1]! + (target[1] - pos[hand + 1]!) * w,
          pos[hand + 2]! + (target[2] - pos[hand + 2]!) * w,
          i === 0 ? 0.15 : -0.15,
          0,
          -0.35,
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
      multiplyInto(pose, this.neck * 4, this.q);
    }
    solveSkeleton(character, pose, skeleton);
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
      multiplyInto(pose, this.braid[i]! * 4, q);
    }
  }
}

/** Fraction of a cycle, always from 0 to 1. */
function cycle(turns: number): number {
  return turns - Math.floor(turns);
}

/** How much of the step toward the ball is taken `eta` seconds before the contact (negative after it). */
function lungeWeight(eta: number): number {
  if (eta >= 0) return 1 - smoothstep(0.04, 0.3, eta);
  return 1 - smoothstep(0.05, 0.32, -eta);
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

/** pose[at..at+4] = pose[at..at+4] * q. */
function multiplyInto(pose: Float32Array, at: number, q: Float32Array): void {
  const ax = pose[at]!;
  const ay = pose[at + 1]!;
  const az = pose[at + 2]!;
  const aw = pose[at + 3]!;
  const bx = q[0]!;
  const by = q[1]!;
  const bz = q[2]!;
  const bw = q[3]!;
  pose[at] = aw * bx + ax * bw + ay * bz - az * by;
  pose[at + 1] = aw * by - ax * bz + ay * bw + az * bx;
  pose[at + 2] = aw * bz + ax * by - ay * bx + az * bw;
  pose[at + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
