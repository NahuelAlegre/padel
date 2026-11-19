import type { CallKind } from '../../sim/pair';
import type { MannerismClip, TellPose } from '../../characters/types';
import { clamp, lerp } from '../../core/math';
import type { ScenePlayer } from '../scene';

type Ctx = CanvasRenderingContext2D;

/** Hand and racket-head positions in metres: x toward the racket side, y up from the floor. */
interface Pose {
  hx: number;
  hy: number;
  rx: number;
  ry: number;
}

const READY: Pose = { hx: 0.24, hy: 1.02, rx: 0.34, ry: 1.38 };

/** Back swing, contact and follow-through of every family of strokes. */
const STROKES: Record<'flat' | 'lob' | 'overhead' | 'serve' | 'soft', [Pose, Pose, Pose]> = {
  flat: [
    { hx: 0.46, hy: 1.2, rx: 0.84, ry: 1.52 },
    { hx: 0.56, hy: 0.98, rx: 1.04, ry: 0.92 },
    { hx: -0.1, hy: 1.3, rx: -0.44, ry: 1.6 },
  ],
  lob: [
    { hx: 0.48, hy: 0.92, rx: 0.9, ry: 0.72 },
    { hx: 0.54, hy: 0.86, rx: 1.0, ry: 0.66 },
    { hx: 0.22, hy: 1.62, rx: 0.3, ry: 2.1 },
  ],
  soft: [
    { hx: 0.42, hy: 1.1, rx: 0.74, ry: 1.3 },
    { hx: 0.52, hy: 0.95, rx: 0.96, ry: 0.98 },
    { hx: 0.4, hy: 1.02, rx: 0.78, ry: 1.2 },
  ],
  overhead: [
    { hx: 0.3, hy: 1.62, rx: 0.1, ry: 2.05 },
    { hx: 0.24, hy: 1.86, rx: 0.34, ry: 2.42 },
    { hx: -0.04, hy: 1.0, rx: -0.26, ry: 0.62 },
  ],
  serve: [
    { hx: 0.42, hy: 0.92, rx: 0.78, ry: 0.7 },
    { hx: 0.46, hy: 0.72, rx: 0.84, ry: 0.5 },
    { hx: 0.3, hy: 1.24, rx: 0.52, ry: 1.62 },
  ],
};

function strokeOf(player: ScenePlayer): [Pose, Pose, Pose] {
  if (player.anim === 'serve') return STROKES.serve;
  switch (player.shot) {
    case 'smash':
    case 'bandeja':
    case 'vibora':
      return STROKES.overhead;
    case 'lob':
    case 'backWall':
      return STROKES.lob;
    case 'drop':
      return STROKES.soft;
    default:
      return STROKES.flat;
  }
}

const pose: Pose = { hx: 0, hy: 0, rx: 0, ry: 0 };

function mix(a: Pose, b: Pose, t: number): void {
  pose.hx = lerp(a.hx, b.hx, t);
  pose.hy = lerp(a.hy, b.hy, t);
  pose.rx = lerp(a.rx, b.rx, t);
  pose.ry = lerp(a.ry, b.ry, t);
}

/** Share of the animation at which the racket meets the ball. */
const CONTACT_AT = { swing: 0.286, whiff: 0.286, serve: 0.655, idle: 0 } as const;

/**
 * Sets `pose` for the current moment of the animation and returns how much
 * the racket should be pulled toward the real position of the ball (0..1):
 * fully at contact, not at all at rest.
 */
function solvePose(player: ScenePlayer): number {
  if (player.anim === 'idle' || player.animPhase >= 1) {
    mix(READY, READY, 0);
    return 0;
  }
  const [back, contact, follow] = strokeOf(player);
  const at = CONTACT_AT[player.anim];
  const phase = player.animPhase;
  if (phase <= 0) {
    // Armed: racket back, waiting for the ball.
    mix(back, back, 0);
    return 0;
  }
  if (phase < at) {
    const t = phase / at;
    mix(back, contact, t * t);
    return player.anim === 'whiff' ? 0 : t * t;
  }
  if (phase < 0.72) {
    const t = (phase - at) / (0.72 - at);
    mix(contact, follow, 1 - (1 - t) * (1 - t));
    return player.anim === 'whiff' ? 0 : clamp(1 - t * 3, 0, 1);
  }
  mix(follow, READY, (phase - 0.72) / 0.28);
  return 0;
}

/**
 * What a character does with its body on top of the stroke or of standing
 * still: the windup that gives its shot away, or a tic between points. Each is
 * a few targets for the limbs and how much of them to apply.
 */
const overlay = {
  weight: 0,
  /** Racket arm: a pose that replaces the one of the stroke. */
  racket: null as Pose | null,
  /** Free hand: metres from the middle of the body toward the free side, and height. */
  free: false,
  freeX: 0,
  freeY: 0,
  /** Free hand measured across the screen instead (pointing somewhere on court). */
  freeAcross: false,
  /** Extra distance of each foot from the middle. */
  stance: 0,
  /** How far the hips drop. */
  crouch: 0,
  /** Head off to one side. */
  head: 0,
};

const TELL_RACKET: Record<'plantWide' | 'crouchOpenFace' | 'stepIn', Pose> = {
  plantWide: { hx: 0.2, hy: 1.74, rx: -0.14, ry: 2.1 },
  crouchOpenFace: { hx: 0.5, hy: 0.62, rx: 0.98, ry: 0.5 },
  stepIn: { hx: 0.4, hy: 1.02, rx: 0.72, ry: 1.2 },
};
const ACT_RACKET: Record<'kissRacket' | 'shoeTap', Pose> = {
  kissRacket: { hx: 0.12, hy: 1.4, rx: 0.02, ry: 1.74 },
  shoeTap: { hx: 0.26, hy: 0.62, rx: 0.14, ry: 0.2 },
};

/** How much of a tell is showing `t` seconds after the player made up its mind. */
export function tellWeight(t: number): number {
  const k = clamp(t / 0.14, 0, 1);
  return 1 - (1 - k) * (1 - k);
}

function resetOverlay(): void {
  overlay.weight = 0;
  overlay.racket = null;
  overlay.free = false;
  overlay.freeAcross = false;
  overlay.stance = 0;
  overlay.crouch = 0;
  overlay.head = 0;
}

function freeHand(x: number, y: number, across = false): void {
  overlay.free = true;
  overlay.freeX = x;
  overlay.freeY = y;
  overlay.freeAcross = across;
}

function setTell(pose: TellPose, kind: 'drive' | 'lob' | 'drop', aimX: number, t: number): void {
  overlay.weight = tellWeight(t);
  switch (pose) {
    case 'pointAim':
      // The free hand points to where the ball will go: to that side, and up for a lob.
      freeHand(clamp(aimX / 2.4, -1, 1) * 0.62, kind === 'lob' ? 1.9 : kind === 'drop' ? 1.04 : 1.44, true);
      break;
    case 'plantWide':
      overlay.racket = TELL_RACKET.plantWide;
      overlay.stance = 0.2;
      overlay.crouch = 0.07;
      freeHand(0.44, 1.2);
      break;
    case 'crouchOpenFace':
      overlay.racket = TELL_RACKET.crouchOpenFace;
      overlay.crouch = 0.24;
      overlay.stance = 0.06;
      freeHand(0.4, 0.92);
      break;
    case 'stepIn':
      // The step itself is taken by whoever places the figure on the court.
      overlay.racket = TELL_RACKET.stepIn;
      break;
  }
}

/** Doubles: what a player tells its partner, with the free arm (see the 3D one in the animator). */
function setCall(kind: CallKind, t: number, towardX: number): void {
  overlay.weight = tellWeight(t);
  const beat = Math.sin(t * 14);
  const side = clamp(towardX / 2.4, -1, 1);
  switch (kind) {
    case 'mine':
      freeHand(0.12, 2.05 + beat * 0.03);
      break;
    case 'yours':
      freeHand(side * 0.62, 1.32, true);
      break;
    case 'switch':
      freeHand(side * (0.4 + 0.1 * (beat + 1)), 1.55, true);
      break;
    case 'up':
      freeHand(0.14, 1.5 + beat * 0.12);
      break;
    case 'back':
      freeHand(0.3, 1.78);
      break;
  }
}

function setAct(clip: MannerismClip, t: number, duration: number): void {
  // In and out in a blink, so it can be cut at any moment without a jump.
  overlay.weight = clamp(Math.min(t, duration - t) / 0.12, 0, 1);
  const beat = Math.sin(t * 16);
  switch (clip) {
    case 'cap':
      freeHand(0.1, 1.76);
      break;
    case 'glasses':
      freeHand(0.04, 1.86);
      break;
    case 'whistle':
      freeHand(0.05, 1.6);
      break;
    case 'sleeves':
      // The free hand goes across to the other shoulder and tugs.
      freeHand(-0.2, 1.4 + beat * 0.03);
      break;
    case 'wave':
      freeHand(0.42 + beat * 0.12, 1.96);
      break;
    case 'neck':
      overlay.head = Math.sin((t / duration) * Math.PI * 2) * 0.08;
      break;
    case 'kissRacket':
      overlay.racket = ACT_RACKET.kissRacket;
      break;
    case 'shoeTap':
      overlay.racket = ACT_RACKET.shoeTap;
      overlay.crouch = 0.1 + Math.abs(beat) * 0.03;
      break;
  }
}

/** Limbs are capsules: [x0, y0, x1, y1, width] in screen pixels. */
const limbs = new Float32Array(5 * 5);

function setLimb(index: number, x0: number, y0: number, x1: number, y1: number, width: number): void {
  const o = index * 5;
  limbs[o] = x0;
  limbs[o + 1] = y0;
  limbs[o + 2] = x1;
  limbs[o + 3] = y1;
  limbs[o + 4] = width;
}

function strokeLimbs(ctx: Ctx, extra: number): void {
  for (let i = 0; i < 5; i++) {
    const o = i * 5;
    ctx.lineWidth = limbs[o + 4]! + extra;
    ctx.beginPath();
    ctx.moveTo(limbs[o]!, limbs[o + 1]!);
    ctx.lineTo(limbs[o + 2]!, limbs[o + 3]!);
    ctx.stroke();
  }
}

/** Length of the racket from the hand to the middle of its head, in metres. */
const RACKET = 0.45;
/** How far the hand gets from the shoulder with the arm stretched. */
const ARM = 0.72;

/**
 * Draws a player as a simple rounded figure: legs that run, a torso that
 * leans into the movement and a racket arm that follows the stroke.
 *
 * The game lets a player hit a ball that is some way off, so at contact the
 * racket is taken to where the ball really is: the arm stretches and, when
 * that is not enough, the body leans after it.
 *
 * A character adds two things on top, both small and both whole-body so they
 * read at the size of a rival: the windup that gives its shot away, and a tic
 * between points.
 *
 * Everything is stroked twice, first wide in the outline colour and then in
 * the body colour, so the silhouette gets a single clean outline.
 *
 * (sx, sy) is the point between the feet on screen and `scale` the pixels per
 * metre of the figure. (ballX, ballY) is where the ball of the current stroke
 * is met, in the same metres, measured from the feet: x to the right, y up.
 */
export function drawFigure(
  ctx: Ctx,
  sx: number,
  sy: number,
  scale: number,
  player: ScenePlayer,
  ballX: number,
  ballY: number,
  body: string,
  edge: string,
): void {
  const speed = Math.hypot(player.vx, player.vy);
  const run = clamp(speed / 4.5, 0, 1);
  const phi = player.stride * 3.9;
  const sin = Math.sin(phi);
  const lateral = speed > 0.2 ? player.vx / speed : 0;
  const forward = speed > 0.2 ? Math.abs(player.vy) / speed : 0;

  // Feet scissor sideways when running across, and lift in turns when running along.
  const spread = sin * 0.24 * run * lateral;
  const lift = 0.17 * run * (0.4 + 0.6 * forward);
  const bob = Math.abs(Math.cos(phi)) * 0.035 * run;
  let lean = clamp(player.vx / 6, -1, 1) * 0.11;

  const reachWeight = solvePose(player);
  const resting = player.anim === 'idle' || player.animPhase >= 1;
  const side = resting ? player.restSide : player.animSide;

  // What the character adds: its tell while the racket is back, a tic while it rests.
  resetOverlay();
  const tell = player.tell;
  const act = player.act;
  const call = player.call;
  if (tell?.pose && player.anim === 'swing' && player.animPhase <= 0) setTell(tell.pose, tell.kind, tell.aimX, tell.t);
  else if (call && !(player.contactIn < 0.3 && player.contactIn > -0.2)) setCall(call.kind, call.t, call.towardX);
  else if (act && resting) setAct(act.clip, act.t, act.duration);
  const w = overlay.weight;

  const drop = overlay.crouch * w;
  const shoulderY = 1.42 - bob - drop;
  if (overlay.racket && w > 0) {
    pose.hx = lerp(pose.hx, overlay.racket.hx, w);
    pose.hy = lerp(pose.hy - drop, overlay.racket.hy, w);
    pose.rx = lerp(pose.rx, overlay.racket.rx, w);
    pose.ry = lerp(pose.ry - drop, overlay.racket.ry, w);
  } else {
    pose.hy -= drop;
    pose.ry -= drop;
  }

  // Racket head and hand, in figure metres, from the pose of the stroke.
  let headX = lean + side * pose.rx;
  let headY = pose.ry - bob;
  let handX = lean + side * pose.hx;
  let handY = pose.hy - bob;

  if (reachWeight > 0) {
    // Take the racket to the ball. If the arm cannot get there, lean after it.
    const fromX = ballX - (lean + side * 0.17);
    const fromY = ballY - (shoulderY - 0.04);
    const distance = Math.max(0.01, Math.hypot(fromX, fromY));
    const beyond = Math.max(0, distance - (ARM + RACKET));
    lean += clamp((fromX / distance) * beyond * 0.8, -0.5, 0.5) * reachWeight;
    const shoulderX = lean + side * 0.17;
    const dx = ballX - shoulderX;
    const dy = ballY - (shoulderY - 0.04);
    const d = Math.max(0.01, Math.hypot(dx, dy));
    const arm = clamp(d - RACKET, 0.2, ARM + 0.25);
    const targetHandX = shoulderX + (dx / d) * arm;
    const targetHandY = shoulderY - 0.04 + (dy / d) * arm;
    headX = lerp(headX, ballX, reachWeight);
    headY = lerp(headY, ballY, reachWeight);
    handX = lerp(handX, targetHandX, reachWeight);
    handY = lerp(handY, targetHandY, reachWeight);
  }

  const X = (m: number): number => sx + m * scale;
  const Y = (m: number): number => sy - m * scale;

  const hipY = 0.9 - bob - drop;
  const hipX = lean * 0.3;
  const apart = 0.115 + overlay.stance * w;
  setLimb(0, X(hipX - 0.085), Y(hipY), X(-apart + spread), Y(0.06 + Math.max(0, sin) * lift), 0.13 * scale);
  setLimb(1, X(hipX + 0.085), Y(hipY), X(apart - spread), Y(0.06 + Math.max(0, -sin) * lift), 0.13 * scale);
  setLimb(2, X(hipX), Y(hipY + 0.06), X(lean), Y(shoulderY - 0.08), 0.36 * scale);
  // Free arm, then racket arm.
  let freeX = lean - side * 0.3;
  let freeY = 1.0 - bob - drop;
  if (overlay.free && w > 0) {
    const targetX = overlay.freeAcross ? lean + overlay.freeX : lean - side * overlay.freeX;
    freeX = lerp(freeX, targetX, w);
    freeY = lerp(freeY, overlay.freeY - drop, w);
  }
  setLimb(3, X(lean - side * 0.17), Y(shoulderY - 0.04), X(freeX), Y(freeY), 0.09 * scale);
  setLimb(4, X(lean + side * 0.17), Y(shoulderY - 0.04), X(handX), Y(handY), 0.09 * scale);

  const headRadius = 0.135 * scale;
  const headCx = X(lean * 1.2 + overlay.head * w);
  const headCy = Y(1.66 - bob - drop);
  const outline = Math.max(2, scale * 0.045);

  ctx.lineCap = 'round';
  ctx.strokeStyle = edge;
  strokeLimbs(ctx, outline * 2);
  ctx.fillStyle = edge;
  ctx.beginPath();
  ctx.arc(headCx, headCy, headRadius + outline, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = body;
  strokeLimbs(ctx, 0);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(headCx, headCy, headRadius, 0, Math.PI * 2);
  ctx.fill();

  // Racket: handle from the hand, and an oval head along the same direction.
  const hx = X(handX);
  const hy = Y(handY);
  const rx = X(headX);
  const ry = Y(headY);
  const angle = Math.atan2(ry - hy, rx - hx);
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(2, scale * 0.07);
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(lerp(hx, rx, 0.55), lerp(hy, ry, 0.55));
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(lerp(hx, rx, 0.85), lerp(hy, ry, 0.85), 0.2 * scale, 0.15 * scale, angle, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, scale * 0.05);
  ctx.stroke();
}
