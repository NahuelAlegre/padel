import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ScenePlayer } from '../src/render/scene';
import { BALL_ON_RACKET, BallOnRacket, onFace, racketPull, type RacketFace } from '../src/render/stage/contact';
import type { BallFrame, EffectFrame, FigureFrame } from '../src/render/stage/frame';
import { FigureAnimator } from '../src/render/toon/animator';
import { parseCharacter } from '../src/render/toon/character';

const file = readFileSync(new URL('../public/art/character.bin', import.meta.url));
const character = parseCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
const DT = 1 / 60;
/** The radius of a padel ball: how far off the face of the racket the middle of the ball rests. */
const RADIUS = 0.033;

function player(more: Partial<ScenePlayer> = {}): ScenePlayer {
  return {
    id: 0,
    team: 0,
    isHuman: false,
    x: 0,
    y: -6,
    vx: 0,
    vy: 0,
    stride: 0,
    anim: 'idle',
    animPhase: 0,
    contactIn: Infinity,
    animSide: 1,
    restSide: 1,
    shot: 'drive',
    reachX: 0.6,
    reachY: 0.2,
    reachZ: 0.9,
    character: null,
    tell: null,
    act: null,
    call: null,
    why: null,
    surprise: 0,
    tension: 0,
    stealing: false,
    ...more,
  };
}

const distance = (a: ArrayLike<number>, b: ArrayLike<number>): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/**
 * A forehand of somebody on the near side to a ball that is not where the
 * clip meets it, frame by frame: the ball comes in along a straight line,
 * and is hit at the contact and goes back the other way, or is missed and
 * goes on. Returns, for every frame, where the ball really is and where it
 * is drawn, and the sparkle of the hit as it is drawn.
 */
function play(hit: boolean, contact = [0.75, -5.6, 0.85]): Array<{ eta: number; real: number[]; drawn: number[]; face: RacketFace; spark: EffectFrame | null }> {
  const k = 1.2;
  const who = player({ anim: 'swing', animPhase: -1, reachX: contact[0]! - 0, reachY: contact[1]! + 6, reachZ: contact[2]! });
  const animator = new FigureAnimator(character);
  for (let i = 0; i < 20; i++) animator.update(player(), k, 1, { x: 0, y: 8, z: 1, visible: true }, DT);
  const figure: FigureFrame = { player: who, x: 0, y: -6, k, facing: 1, depth: 10, palette: new Float32Array(), parts: null, bones: null };
  const onRacket = new BallOnRacket();
  const incoming = { vx: -2, vy: -16, vz: 1 };
  const outgoing = { vx: 3, vy: 18, vz: 3 };
  const rows: Array<{ eta: number; real: number[]; drawn: number[]; face: RacketFace; spark: EffectFrame | null }> = [];
  let effect: EffectFrame | null = null;
  for (let i = 30; i >= -20; i--) {
    const eta = i * DT;
    who.contactIn = eta;
    if (eta <= 0) who.animPhase = -eta / 0.6;
    const v = eta > 0 || !hit ? incoming : outgoing;
    const real = [contact[0]! - v.vx * eta, contact[1]! - v.vy * eta, contact[2]! - v.vz * eta];
    animator.update(who, k, 1, { x: real[0]!, y: real[1]!, z: real[2]!, visible: true }, DT);
    figure.x = animator.x;
    figure.y = animator.y;
    // The simulation hits it in the step that crosses the contact.
    if (hit && eta <= 0 && eta > -DT) {
      onRacket.hit(0, contact[0]!, contact[1]!, contact[2]!);
      effect = { kind: 'hit', x: contact[0]!, y: contact[1]!, z: contact[2]!, age: 0, strong: false };
    }
    const ball: BallFrame = { x: real[0]!, y: real[1]!, z: real[2]!, visible: true, over: null, glow: 0, trail: new Float32Array(15), trailCount: 0 };
    const effects = effect ? [{ ...effect }] : [];
    const face: RacketFace = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, reach: 0, half: 0 };
    onRacket.place([figure], (_, out) => animator.racketFace(k, 1, out), (_, out, behind) => animator.racketAtContact(k, 1, out, behind), ball, v, effects);
    animator.racketFace(k, 1, face);
    rows.push({ eta, real, drawn: [ball.x, ball.y, ball.z], face, spark: effects[0] ?? null });
  }
  return rows;
}

describe('la pelota dibujada sobre la pala', () => {
  it('entera en el contacto, nada fuera del rato que dura, y sin escalones', () => {
    expect(racketPull(0)).toBe(1);
    expect(racketPull(BALL_ON_RACKET.hold * 0.9)).toBe(1);
    expect(racketPull(-BALL_ON_RACKET.hold * 0.9)).toBe(1);
    expect(racketPull(BALL_ON_RACKET.before)).toBe(0);
    expect(racketPull(-BALL_ON_RACKET.after)).toBe(0);
    let last = racketPull(0.2);
    for (let eta = 0.2; eta >= -0.2; eta -= 0.001) {
      const w = racketPull(eta);
      expect(Math.abs(w - last)).toBeLessThan(0.03);
      last = w;
    }
  });

  it('sobre la cara de la pala: del lado por donde llega, apoyada y no más lejos del centro que el corazón de la cabeza', () => {
    const face: RacketFace = { x: 1, y: 2, z: 1, nx: 0, ny: -1, nz: 0, reach: 0.07, half: 0.02 };
    const out = [0, 0, 0];
    onFace(face, 1.3, 1.5, 1.1, 1, out);
    expect(out[1]).toBeCloseTo(2 - (0.02 + RADIUS), 9);
    expect(Math.hypot(out[0]! - 1, out[2]! - 1)).toBeCloseTo(0.07, 9);
    onFace(face, 1.01, 2.4, 1.02, -1, out);
    expect(out[1]).toBeCloseTo(2 + 0.02 + RADIUS, 9);
    expect(out[0]).toBeCloseTo(1.01, 9);
  });

  it('en un golpe: llega a la pala, sale del punto donde la pala la tocó por su camino, y vuelve a él sin saltos', () => {
    const rows = play(true);
    const at = rows.find((row) => Math.abs(row.eta) < 1e-9)!;
    // Without it the racket would not quite be on the ball: the trick has something to do.
    expect(distance(at.real, [at.face.x, at.face.y, at.face.z])).toBeGreaterThan(0.05);
    // At the contact it rests on a face of the racket, within its head.
    const from = at.drawn.map((v, c) => v - [at.face.x, at.face.y, at.face.z][c]!);
    const along = from[0]! * at.face.nx + from[1]! * at.face.ny + from[2]! * at.face.nz;
    const across = Math.hypot(from[0]! - along * at.face.nx, from[1]! - along * at.face.ny, from[2]! - along * at.face.nz);
    expect(Math.abs(Math.abs(along) - (at.face.half + RADIUS))).toBeLessThan(0.005);
    expect(across).toBeLessThan(at.face.reach + 0.01);
    // And the sparkle of the hit is there too.
    expect(distance([at.spark!.x, at.spark!.y, at.spark!.z], at.drawn)).toBeLessThan(0.002);
    for (const row of rows) {
      // Away from the contact it is where the simulation has it.
      if (row.eta >= BALL_ON_RACKET.before || row.eta <= -BALL_ON_RACKET.after) expect(distance(row.drawn, row.real), `${row.eta}`).toBeLessThan(1e-9);
    }
    // No jumps: from one frame to the next it moves about as much as the ball does, never a big step aside.
    let worst = 0;
    for (let i = 1; i < rows.length; i++) {
      const extra = distance(
        rows[i]!.drawn.map((v, c) => v - rows[i]!.real[c]!),
        rows[i - 1]!.drawn.map((v, c) => v - rows[i - 1]!.real[c]!),
      );
      worst = Math.max(worst, extra);
    }
    expect(worst).toBeLessThan(0.08);
    // After the contact it leaves from where the racket met it, not with the racket's follow-through.
    const after = rows.filter((row) => row.eta < 0 && row.eta > -BALL_ON_RACKET.after);
    for (let i = 1; i < after.length; i++) {
      const moved = after[i]!.drawn.map((v, c) => v - after[i - 1]!.drawn[c]!);
      const real = after[i]!.real.map((v, c) => v - after[i - 1]!.real[c]!);
      // Its way: it moves forward, as the ball does, however the racket goes on.
      expect(moved[1]! * real[1]!).toBeGreaterThan(0);
    }
  });

  it('una pelota que no se golpeó vuelve a su camino, sin saltos, y no se queda en la pala', () => {
    const rows = play(false);
    const at = rows.findIndex((row) => row.eta <= 0);
    // It was coming to the racket, as it does to one that hits it.
    expect(distance(rows[at - 1]!.drawn, rows[at - 1]!.real)).toBeGreaterThan(0.03);
    // From there it goes back to its path, a little every frame, and is on it before the time a hit lets go of it.
    for (let i = at; i < rows.length; i++) {
      const off = distance(rows[i]!.drawn, rows[i]!.real);
      expect(off, `${rows[i]!.eta}`).toBeLessThanOrEqual(distance(rows[i - 1]!.drawn, rows[i - 1]!.real) + 1e-9);
      if (rows[i]!.eta <= -BALL_ON_RACKET.after) expect(off).toBeLessThan(1e-9);
    }
  });

  it('nunca salta: de un cuadro al otro se aparta de su camino, o vuelve, menos de lo que avanza por él', () => {
    for (const hit of [true, false]) {
      const rows = play(hit);
      for (let i = 1; i < rows.length; i++) {
        const turned = distance(
          rows[i]!.drawn.map((v, c) => v - rows[i]!.real[c]!),
          rows[i - 1]!.drawn.map((v, c) => v - rows[i - 1]!.real[c]!),
        );
        // Some twenty degrees off its way at most, and a few millimetres.
        expect(turned, `${hit} ${rows[i]!.eta}`).toBeLessThanOrEqual(0.35 * distance(rows[i]!.real, rows[i - 1]!.real) + 0.004 + 1e-9);
      }
    }
  });

  it('a una pala que quedó lejos la pelota no va: si no llega, no llega', () => {
    const k = 1.2;
    const contact = [0.6, -5.6, 0.9];
    // The racket meets it 10 cm off, or 70 cm off: a body that did not get there.
    for (const [away, pulled] of [
      [0.1, true],
      [0.7, false],
    ] as const) {
      const who = player({ anim: 'swing', reachX: 0.6, reachY: 0.4, reachZ: 0.9 });
      const figure: FigureFrame = { player: who, x: 0, y: -6, k, facing: 1, depth: 10, palette: new Float32Array(), parts: null, bones: null };
      const face: RacketFace = { x: contact[0]! + away, y: contact[1]!, z: contact[2]!, nx: 0, ny: -1, nz: 0, reach: 0.06 * k, half: 0.02 * k };
      const onRacket = new BallOnRacket();
      let most = 0;
      for (let i = 10; i >= -10; i--) {
        const eta = i * DT;
        who.contactIn = eta;
        if (i === 0) onRacket.hit(0, contact[0]!, contact[1]!, contact[2]!);
        const real = [contact[0]!, contact[1]! + (eta > 0 ? 16 : -18) * eta, contact[2]!];
        const ball: BallFrame = { x: real[0]!, y: real[1]!, z: real[2]!, visible: true, over: null, glow: 0, trail: new Float32Array(15), trailCount: 0 };
        onRacket.place(
          [figure],
          (_, out) => {
            Object.assign(out, face);
            return true;
          },
          (_, out) => {
            out[0] = face.x;
            out[1] = face.y;
            out[2] = face.z;
            return true;
          },
          ball,
          eta > 0 ? { vx: 0, vy: -16, vz: 0 } : { vx: 0, vy: 18, vz: 0 },
          [],
        );
        most = Math.max(most, distance([ball.x, ball.y, ball.z], real));
      }
      if (pulled) expect(most).toBeGreaterThan(0.08);
      else expect(most).toBeLessThan(1e-9);
    }
  });
});
