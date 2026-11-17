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

/** Back swing, contact and follow-through of every kind of stroke. */
const STROKES: Record<'flat' | 'lob' | 'smash' | 'serve' | 'drop', [Pose, Pose, Pose]> = {
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
  drop: [
    { hx: 0.42, hy: 1.1, rx: 0.74, ry: 1.3 },
    { hx: 0.52, hy: 0.95, rx: 0.96, ry: 0.98 },
    { hx: 0.4, hy: 1.02, rx: 0.78, ry: 1.2 },
  ],
  smash: [
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

const pose: Pose = { hx: 0, hy: 0, rx: 0, ry: 0 };

function mix(a: Pose, b: Pose, t: number): void {
  pose.hx = lerp(a.hx, b.hx, t);
  pose.hy = lerp(a.hy, b.hy, t);
  pose.rx = lerp(a.rx, b.rx, t);
  pose.ry = lerp(a.ry, b.ry, t);
}

/** Share of the animation at which the racket meets the ball. */
const CONTACT_AT = { swing: 0.286, whiff: 0.286, serve: 0.655, idle: 0 } as const;

function solvePose(player: ScenePlayer): void {
  if (player.anim === 'idle' || player.animPhase >= 1) {
    mix(READY, READY, 0);
    return;
  }
  const stroke =
    player.anim === 'serve'
      ? STROKES.serve
      : player.shot === 'smash'
        ? STROKES.smash
        : player.shot === 'lob'
          ? STROKES.lob
          : player.shot === 'drop'
            ? STROKES.drop
            : STROKES.flat;
  const [back, contact, follow] = stroke;
  const at = CONTACT_AT[player.anim];
  const phase = player.animPhase;
  if (phase <= 0) {
    // Armed: racket back, waiting for the ball.
    mix(back, back, 0);
  } else if (phase < at) {
    const t = phase / at;
    mix(back, contact, t * t);
  } else if (phase < 0.72) {
    const t = (phase - at) / (0.72 - at);
    mix(contact, follow, 1 - (1 - t) * (1 - t));
  } else {
    mix(follow, READY, (phase - 0.72) / 0.28);
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

/**
 * Draws a player as a simple rounded figure: legs that run, a torso that
 * leans into the movement and a racket arm that follows the stroke.
 *
 * Everything is stroked twice, first wide in the outline colour and then in
 * the body colour, so the silhouette gets a single clean outline.
 *
 * (sx, sy) is the point between the feet on screen, `scale` pixels per metre.
 */
export function drawFigure(
  ctx: Ctx,
  sx: number,
  sy: number,
  scale: number,
  player: ScenePlayer,
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
  const lean = clamp(player.vx / 6, -1, 1) * 0.11;

  const X = (m: number): number => sx + m * scale;
  const Y = (m: number): number => sy - m * scale;

  const hipY = 0.9 - bob;
  const shoulderY = 1.42 - bob;
  const hipX = lean * 0.3;

  setLimb(0, X(hipX - 0.085), Y(hipY), X(-0.115 + spread), Y(0.06 + Math.max(0, sin) * lift), 0.13 * scale);
  setLimb(1, X(hipX + 0.085), Y(hipY), X(0.115 - spread), Y(0.06 + Math.max(0, -sin) * lift), 0.13 * scale);
  setLimb(2, X(hipX), Y(hipY + 0.06), X(lean), Y(shoulderY - 0.08), 0.36 * scale);

  solvePose(player);
  const side = player.anim === 'idle' || player.animPhase >= 1 ? player.restSide : player.animSide;
  const shoulderX = lean + side * 0.17;
  const handX = lean + side * pose.hx;
  const handY = pose.hy - bob;
  const headX = lean + side * pose.rx;
  const headY = pose.ry - bob;
  // Free arm, then racket arm.
  setLimb(3, X(lean - side * 0.17), Y(shoulderY - 0.04), X(lean - side * 0.3), Y(1.0 - bob), 0.09 * scale);
  setLimb(4, X(shoulderX), Y(shoulderY - 0.04), X(handX), Y(handY), 0.09 * scale);

  const headRadius = 0.135 * scale;
  const headCx = X(lean * 1.2);
  const headCy = Y(1.66 - bob);
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
  ctx.lineTo(lerp(hx, rx, 0.5), lerp(hy, ry, 0.5));
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(lerp(hx, rx, 0.8), lerp(hy, ry, 0.8), 0.2 * scale, 0.15 * scale, angle, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, scale * 0.05);
  ctx.stroke();
}
