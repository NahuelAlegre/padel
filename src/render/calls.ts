import { clamp, smoothstep } from '../core/math';
import type { CallKind } from '../sim/pair';

/**
 * How a call to the partner moves in time, the same in every look of the game
 * (the 3D animator and the plain figure): each one is a short movement, in, a
 * beat and out, never a pose that is held. Where the hands go is each look's.
 *
 * The two that are made most look nothing alike, from behind or from the
 * front and at the size of a rival:
 *   «¡mía!»   the one who goes: the free hand up, open, next to the head, for
 *             a moment, on its way to the ball. Up, and nothing else.
 *   «¡tuya!»  the one who leaves it: the head and then the trunk turn to the
 *             partner, the arm goes out level toward it, low, and it takes
 *             half a step back to give it room. Out, to the side, and the
 *             whole body with it. With the partner on the side of the racket
 *             it points with the racket, out at the height of the shoulder:
 *             never low at its side or up behind it, which is a stroke being
 *             armed; and the free hand lets go of it and hangs.
 * «¡Voy!» (crossing behind the partner for a lob over it) is its own ball:
 * «¡mía!», with a look at the partner, who has to cross the other way.
 * «¡Arriba!» and «¡atrás!» move up and down at its side, never over the
 * shoulder: a hand up by the head is «¡mía!».
 */
export interface CallMotion {
  /** How much of the way the hand (or the racket) goes to its place: 0..1, a little over 1 at the snap. */
  arm: number;
  /**
   * The beat on top: the push up of «¡mía!» and the «go» of «¡tuya!» (0..1),
   * the two calls up of «¡arriba!» and the two sweeps back of «¡atrás!» (0..1
   * each, one after the other).
   */
  beat: number;
  /** «¡Mía!» on its way down: the hand opens out to the side first, so that it does not come down over the face. 0..1. */
  away: number;
  /** How much the head and the trunk turn to the partner, 0..1. */
  look: number;
  /** How much of the half step that gives the partner room it takes, 0..1. */
  room: number;
}

/** A rise from `from` to `to` that goes a little past the top and settles: the snap of a hand that is shown. */
export function snapUp(t: number, from: number, to: number): number {
  const u = clamp((t - from) / (to - from), 0, 1) - 1;
  return 1 + 2.2 * u * u * u + 1.2 * u * u;
}

/** One beat, 0 to 1 and back, between `from` and `to`. */
function beatOf(t: number, from: number, to: number): number {
  return Math.sin(clamp((t - from) / (to - from), 0, 1) * Math.PI);
}

/**
 * Where a call is `t` seconds after it starts to show. `still` (0..1) is how
 * much the player is standing: somebody running is already on its way out of
 * the way, and takes no step for it. All of them are over in 0.9 s.
 */
export function callMotion(kind: CallKind, t: number, still: number, out: CallMotion): CallMotion {
  out.away = 0;
  out.look = 0;
  out.room = 0;
  switch (kind) {
    case 'mine':
    case 'switch':
      out.arm = snapUp(t, 0.03, 0.2) * (1 - smoothstep(0.5, 0.74, t));
      out.beat = beatOf(t, 0.2, 0.42);
      out.away = smoothstep(0.42, 0.6, t);
      if (kind === 'switch') out.look = smoothstep(0.05, 0.2, t) * (1 - smoothstep(0.45, 0.65, t));
      break;
    case 'yours':
      // The head leads, then the trunk and the arm; «go» once at the end of it.
      out.look = smoothstep(0, 0.14, t) * (1 - smoothstep(0.62, 0.86, t));
      out.arm = snapUp(t, 0.08, 0.27) * (1 - smoothstep(0.56, 0.8, t));
      out.beat = beatOf(t, 0.3, 0.52);
      out.room = smoothstep(0.1, 0.36, t) * (1 - smoothstep(0.64, 0.9, t)) * still;
      break;
    case 'up':
      // «Vení, vení».
      out.arm = smoothstep(0, 0.12, t) * (1 - smoothstep(0.64, 0.86, t));
      out.beat = beatOf(t, 0.12, 0.34) + beatOf(t, 0.36, 0.58);
      out.look = out.arm;
      break;
    case 'back':
      // Back, forward again, and back: «para atrás».
      out.arm = smoothstep(0, 0.1, t) * (1 - smoothstep(0.66, 0.88, t));
      out.beat = smoothstep(0.1, 0.3, t) - smoothstep(0.3, 0.4, t) + smoothstep(0.4, 0.6, t);
      out.look = out.arm;
      break;
  }
  return out;
}
