/**
 * Where a sound happens on the court. A rendered sound is dry; this puts it
 * in the court's air: a near one with a little of the glass around it, a far
 * one quieter, duller and with more of the space. The result is stereo, and
 * it is baked once, so playing it costs nothing more than a buffer.
 */
import { filter, mixInto, room, type Signal } from './synth/dsp';

export type Distance = 'near' | 'far';

/** The court: glass at both ends, mesh at the sides, open sky. Short and bright. */
const COURT = { rt60: 0.55, size: 0.9, damp: 3800, predelay: 0.012 };

export function place(sr: number, dry: Signal, distance: Distance): [Signal, Signal] {
  const far = distance === 'far';
  const source = far ? filter(sr, dry.slice(), 'lowpass', 3800, 0.6) : dry;
  const [wl, wr] = room(sr, source, { ...COURT, predelay: far ? 0.025 : COURT.predelay }, COURT.rt60);
  const n = wl.length;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const direct = far ? 0.42 : 1;
  const wet = far ? 0.32 : 0.14;
  mixInto(left, source, 0, direct);
  mixInto(right, source, 0, direct);
  // The glass behind: one clear early reflection, a little later on one side.
  const slap = Math.round(sr * (far ? 0.021 : 0.017));
  mixInto(left, source, slap, far ? 0.12 : 0.1);
  mixInto(right, source, slap + Math.round(sr * 0.004), far ? 0.1 : 0.08);
  mixInto(left, wl, 0, wet);
  mixInto(right, wr, 0, wet);
  // Cut the tail where it can no longer be heard.
  let end = n;
  while (end > sr * 0.05 && Math.abs(left[end - 1]!) < 2e-4 && Math.abs(right[end - 1]!) < 2e-4) end--;
  return [left.slice(0, end), right.slice(0, end)];
}
