import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createScene, fillScene, type SceneOptions } from '../src/app/scene';
import { CAST } from '../src/characters/cast';
import { createConfig } from '../src/config';
import { InputState } from '../src/input/state';
import type { ScenePlayer, SceneWhy } from '../src/render/scene';
import { figureScale } from '../src/render/stage/camera';
import { contactOf, FigureAnimator, holdOf, strideOf, strokeClipName, strokeTime } from '../src/render/toon/animator';
import { parseCharacter, styleOf, type Character } from '../src/render/toon/character';
import { Match } from '../src/sim/match';
import type { ShotKind } from '../src/sim/types';
import { aiEntry, humanEntry, SKILLS } from './helpers';

function loadCharacter(): Character {
  const file = readFileSync(new URL('../public/art/character.bin', import.meta.url));
  return parseCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
}

const character = loadCharacter();
const DT = 1 / 60;
const noBall = { x: 0, y: 8, z: 1, visible: true };

/** Somebody standing on the near side, doing nothing. */
function player(more: Partial<ScenePlayer> = {}): ScenePlayer {
  return {
    id: 0,
    team: 0,
    isHuman: true,
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
 * Watches a foot of a figure that faces the far end: where the ball of the
 * foot is on the court, and the most it moved over the floor between two
 * frames while it was on it.
 */
class Planted {
  worst = 0;
  private last: number[] | null = null;

  constructor(
    private readonly animator: FigureAnimator,
    private readonly side: 'L' | 'R',
    private readonly k: number,
  ) {}

  at(): number[] {
    const pos = this.animator.skeleton.pos;
    const toe = character.bone(`toe.${this.side}`) * 3;
    return [this.animator.x - pos[toe]! * this.k, this.animator.y - pos[toe + 1]! * this.k, pos[toe + 2]!];
  }

  check(): void {
    const at = this.at();
    const down = at[2]! < 0.045;
    if (down && this.last) this.worst = Math.max(this.worst, Math.hypot(at[0]! - this.last[0]!, at[1]! - this.last[1]!));
    this.last = down ? at : null;
  }
}
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Where a point of the character's own axes is on court, for a figure facing the far end. */
function onCourt(who: ScenePlayer, k: number, local: readonly [number, number, number]): [number, number, number] {
  // Facing the far end the character is turned half way round.
  return [who.x - local[0] * k, who.y - local[1] * k, local[2] * k];
}

describe('las piernas siguen al piso', () => {
  for (const [name, vx, vy] of [
    ['correr', 0, 4],
    ['lateral_izq', -3, 0],
    ['lateral_der', 3, 0],
  ] as const) {
    it(`${name}: un ciclo son los metros de una zancada, a cualquier velocidad`, () => {
      const clip = character.clips[name]!;
      const k = 1.2;
      const stride = strideOf(clip) * k;
      for (const speed of [1.5, 3, 5.5]) {
        const animator = new FigureAnimator(character);
        const length = Math.hypot(vx, vy);
        const who = player({ vx: (vx / length) * speed, vy: (vy / length) * speed });
        // Warm up, so the fade from standing is over.
        for (let i = 0; i < 30; i++) {
          who.stride += speed * DT;
          animator.update(who, k, 1, noBall, DT);
        }
        const start = who.stride;
        const first = animator.bones.slice();
        let half: Float32Array | null = null;
        while (who.stride < start + stride - 1e-9) {
          const step = Math.min(speed * DT, start + stride - who.stride);
          who.stride += step;
          animator.update(who, k, 1, noBall, DT);
          if (!half && who.stride >= start + stride / 2) half = animator.bones.slice();
        }
        // One stride later the legs are where they were, and half way they were not.
        const legs = ['thigh.L', 'shin.L', 'thigh.R', 'shin.R'].map((bone) => character.bone(bone));
        for (const bone of legs) {
          for (let c = 0; c < 12; c++) {
            expect(animator.bones[bone * 16 + c]!).toBeCloseTo(first[bone * 16 + c]!, 3);
          }
        }
        const apart = legs.reduce((sum, bone) => sum + Math.abs(half![bone * 16 + 5]! - first[bone * 16 + 5]!), 0);
        expect(apart).toBeGreaterThan(0.05);
      }
    });
  }

  for (const [name, dx, dy] of [
    ['correr', 0, 1],
    ['correr_atras', 0, -1],
    ['lateral_izq', -1, 0],
    ['lateral_der', 1, 0],
  ] as const) {
    it(`${name}: el pie apoyado no patina`, () => {
      const clip = character.clips[name]!;
      const k = 1.2;
      const speed = 3.6;
      const animator = new FigureAnimator(character);
      const who = player({ vx: dx * speed, vy: dy * speed });
      const toes = { L: character.bone('toe.L'), R: character.bone('toe.R') };
      // Where the ball of each foot is on the court. Facing the far end, the character is turned half way round.
      const toe = (side: 'L' | 'R'): [number, number] => [
        animator.x - animator.skeleton.pos[toes[side] * 3]! * k,
        animator.y - animator.skeleton.pos[toes[side] * 3 + 1]! * k,
      ];
      let travelled = 0;
      const planted: Partial<Record<string, [number, number]>> = {};
      let worst = 0;
      let checked = 0;
      for (let frame = 0; frame < 240; frame++) {
        who.x += dx * speed * DT;
        who.y += dy * speed * DT;
        who.stride += speed * DT;
        travelled += speed * DT;
        animator.update(who, k, 1, noBall, DT);
        // The same sum the animator does: in at the part of the cycle the clip asks for, then on with the metres.
        const phase = (clip.entrada ?? 0) + travelled / (strideOf(clip) * k);
        const time = (phase - Math.floor(phase)) * clip.dur;
        for (const [foot, from, to] of clip.apoyos ?? []) {
          const key = `${foot} ${from}`;
          // Not the very edges of a step: there the foot is rolling on or off.
          if (frame < 20 || time < from + 0.02 || time > to - 0.02) {
            delete planted[key];
            continue;
          }
          const now = toe(foot as 'L' | 'R');
          const start = (planted[key] ??= now);
          worst = Math.max(worst, Math.hypot(now[0] - start[0], now[1] - start[1]));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(40);
      // The body covered a dozen metres; a planted foot moved a couple of centimetres at most.
      expect(travelled).toBeGreaterThan(12);
      expect(worst).toBeLessThan(0.03);
    });
  }

  it('corre hacia donde va, también en diagonal: la pelvis gira lo que falta', () => {
    const k = 1.2;
    const hips = character.bone('hips') * 16;
    const facing = (vx: number, vy: number): number => {
      const animator = new FigureAnimator(character);
      const who = player({ vx, vy });
      for (let i = 0; i < 40; i++) {
        who.stride += Math.hypot(vx, vy) * DT;
        animator.update(who, k, 1, noBall, DT);
      }
      // Which way the front of the pelvis points across the court (see the test of the head).
      return animator.bones[hips + 4]!;
    };
    const straight = facing(0, 4);
    expect(facing(-2.4, 3.2)).toBeLessThan(straight - 0.25);
    expect(facing(2.4, 3.2)).toBeGreaterThan(straight + 0.25);
  });

  it('justo antes de que pegue el rival, quien espera da su saltito; quien corre, no', () => {
    const k = 1.2;
    const hips = character.bone('hips');
    const rise = (who: ScenePlayer, hop: boolean): number => {
      const animator = new FigureAnimator(character);
      for (let i = 0; i < 20; i++) animator.update(who, k, 1, noBall, DT, { rivalHitIn: Infinity, holding: false, resting: false });
      let low = Infinity;
      let high = -Infinity;
      for (let i = 0; i < 60; i++) {
        who.stride += Math.hypot(who.vx, who.vy) * DT;
        animator.update(who, k, 1, noBall, DT, { rivalHitIn: hop ? 0.6 - i * DT : Infinity, holding: false, resting: false });
        const z = animator.skeleton.pos[hips * 3 + 2]!;
        low = Math.min(low, z);
        high = Math.max(high, z);
      }
      return high - low;
    };
    expect(rise(player(), true)).toBeGreaterThan(rise(player(), false) + 0.04);
    // Somebody already running has no hop to take: the legs are the ones of the run.
    const running = rise(player({ vy: 4.5 }), true);
    const runningAnyway = rise(player({ vy: 4.5 }), false);
    expect(running).toBeCloseTo(runningAnyway, 2);
  });

  it('las zancadas son de persona: ni pasitos ni saltos', () => {
    for (const name of ['correr', 'lateral_izq', 'lateral_der']) {
      const stride = strideOf(character.clips[name]!);
      expect(stride).toBeGreaterThan(0.6);
      expect(stride).toBeLessThan(2.2);
    }
  });

  it('parado, respira en su lugar; al arrancar y al frenar no hay saltos', () => {
    const animator = new FigureAnimator(character);
    const who = player();
    const hips = character.bone('hips');
    let last: number[] | null = null;
    let worst = 0;
    const frame = (): void => {
      animator.update(who, 1.2, 1, noBall, DT);
      const now = [animator.skeleton.pos[hips * 3]!, animator.skeleton.pos[hips * 3 + 1]!, animator.skeleton.pos[hips * 3 + 2]!];
      if (last) worst = Math.max(worst, distance(now, last));
      last = now;
    };
    for (let i = 0; i < 40; i++) frame();
    // Off it goes, then across, then it stops.
    for (const [vx, vy, frames] of [[0, 4.5, 40], [4, 0, 40], [0, -4, 40], [0, 0, 40]] as const) {
      who.vx = vx;
      who.vy = vy;
      for (let i = 0; i < frames; i++) {
        who.stride += Math.hypot(vx, vy) * DT;
        frame();
      }
    }
    // The pelvis never moves more than a couple of centimetres from one frame to the next.
    expect(worst).toBeLessThan(0.035);
  });
});

describe('los golpes llegan a tiempo', () => {
  const strokes: Array<[string, Partial<ScenePlayer>]> = [
    ['derecha', { shot: 'drive', animSide: 1 }],
    ['reves', { shot: 'drive', animSide: -1 }],
    ['volea', { shot: 'volley', animSide: 1, reachZ: 1.4 }],
    ['volea_reves', { shot: 'volley', animSide: -1, reachZ: 1.4 }],
    ['globo', { shot: 'lob', animSide: 1 }],
    ['bandeja', { shot: 'bandeja', animSide: 1, reachZ: 2.0 }],
    ['remate', { shot: 'smash', animSide: 1, reachZ: 2.4 }],
    ['estirada', { shot: 'drive', animSide: 1, reachX: 1.3, reachZ: 0.6 }],
    ['estirada_reves', { shot: 'drive', animSide: -1, reachX: -1.3, reachZ: 0.6 }],
    ['saque', { anim: 'serve', shot: 'serve', animSide: 1 }],
  ];

  it('cada golpe de la simulación tiene su clip', () => {
    for (const [name, more] of strokes) {
      expect(strokeClipName(player({ anim: 'swing', ...more }))).toBe(name);
      expect(character.clips[name]).toBeDefined();
    }
    for (const shot of ['bandeja', 'vibora'] as ShotKind[]) expect(strokeClipName(player({ anim: 'swing', shot, reachZ: 2.1 }))).toBe('bandeja');
    // The same ball is over the head of somebody life-sized and at the shoulder of somebody drawn half as big again.
    const high = player({ anim: 'swing', shot: 'bandeja', reachZ: 2.0, animSide: 1 });
    expect(strokeClipName(high, 1.2)).toBe('bandeja');
    expect(strokeClipName(high, 1.5)).toBe('volea');
    // A smash that is not high enough to jump for is played with the feet on the floor.
    expect(strokeClipName(player({ anim: 'swing', shot: 'smash', reachZ: 2.0 }), 1.2)).toBe('bandeja');
    // And a ball far over the head is played from above whatever the shot is called.
    expect(strokeClipName(player({ anim: 'swing', shot: 'volley', reachZ: 2.6 }), 1.2)).toBe('bandeja');
    // Low volleys, short balls and balls off the wall are played with the stroke of a drive.
    for (const shot of ['volley', 'drop', 'wallExit', 'backWall'] as ShotKind[]) {
      expect(strokeClipName(player({ anim: 'swing', shot, animSide: 1 }))).toBe('derecha');
      expect(strokeClipName(player({ anim: 'swing', shot, animSide: -1 }))).toBe('reves');
    }
    // A ball at the shoulder is taken like a volley even if it bounced first.
    expect(strokeClipName(player({ anim: 'swing', shot: 'wallExit', reachZ: 1.5, animSide: -1 }))).toBe('volea_reves');
    // A file without the newer clips still has a stroke for everything.
    const old = (name: string): boolean => ['derecha', 'reves', 'globo', 'remate', 'saque'].includes(name);
    expect(strokeClipName(player({ anim: 'swing', shot: 'volley', reachZ: 1.4 }), 1, old)).toBe('derecha');
    expect(strokeClipName(player({ anim: 'swing', shot: 'bandeja', reachZ: 2.1 }), 1, old)).toBe('remate');
    expect(strokeClipName(player({ anim: 'swing', shot: 'drive', reachX: -1.4, reachZ: 0.5, animSide: -1 }), 1, old)).toBe('reves');
  });

  it('el armado se acelera si falta tiempo y espera si sobra: nunca salta', () => {
    for (const name of ['derecha', 'volea', 'bandeja', 'remate', 'globo', 'saque']) {
      const clip = character.clips[name]!;
      const contact = contactOf(clip);
      for (const lead of [1.6, 0.9, 0.5, 0.33, 0.2]) {
        // Asked for late, a stroke starts further into its clip: as far as the time left allows.
        let time = clamp01((contact - lead) / contact) * contact;
        let last = time;
        let worst = 0;
        for (let eta = lead; eta > -0.2; eta -= DT) {
          time = strokeTime(clip, eta, time, DT);
          expect(time, name).toBeGreaterThanOrEqual(last - 1e-9);
          worst = Math.max(worst, time - last);
          last = time;
        }
        // With time to spare nothing goes faster than the clip; in a hurry, the windup is squeezed, not skipped.
        const roomy = lead >= holdOf(clip) + (contact - holdOf(clip));
        expect(worst, `${name} con ${lead} s`).toBeLessThan(roomy ? DT * 1.01 : DT * 6);
        expect(strokeTime(clip, 0, time, DT)).toBeCloseTo(contact, 9);
      }
    }
  });

  for (const [name, more] of strokes) {
    it(`${name}: la pala está donde dice el clip en el instante del contacto, venga de donde venga`, () => {
      const clip = character.clips[name]!;
      const k = 1.2;
      // Armed with plenty of time, with the time of the clip, and in a hurry.
      for (const lead of [1.4, contactOf(clip), 0.2, 0.09]) {
        const animator = new FigureAnimator(character);
        const who = player({ anim: 'swing', animPhase: -1, ...more });
        // The ball is exactly where this clip meets it: nothing to reach for.
        const hit = clip.hit!;
        const ball = onCourt(who, k, hit);
        // The ball of a serve is in the server's hand: the simulation has it at life size, and it is shown as big as the server.
        const own = name === 'saque' ? k : 1;
        who.reachX = (ball[0] - who.x) / own;
        who.reachY = (ball[1] - who.y) / own;
        who.reachZ = ball[2] / own;
        for (let i = 0; i < 20; i++) animator.update(player(), k, 1, noBall, DT);
        const frames = Math.round(lead / DT);
        const racket: [number, number, number] = [0, 0, 0];
        let seenBefore = -1;
        for (let i = frames; i >= 0; i--) {
          who.contactIn = i * DT;
          animator.update(who, k, 1, noBall, DT);
          // It never gets ahead of the ball: before the contact the racket has not passed the point of contact.
          if (i > 0) seenBefore = Math.max(seenBefore, i);
        }
        animator.racketOnCourt(k, 1, racket);
        // Within a hand: the fade in may not be over when it was asked for at the last moment.
        const slack = lead < 0.15 ? 0.3 : 0.03;
        expect(distance(racket, ball), `${name} con ${lead.toFixed(2)} s`).toBeLessThan(slack * k);
        expect(seenBefore).toBeGreaterThan(0);
      }
    });
  }

  it('armado con tiempo, lleva la pala atrás y espera: no pega al aire', () => {
    const clip = character.clips.derecha!;
    const contact = contactOf(clip);
    let time = 0;
    // A ball that is far away: the body goes through its preparation and holds.
    for (let eta = 2; eta > 0.5; eta -= DT) {
      time = strokeTime(clip, eta, time, DT);
      expect(time).toBeLessThan(contact - 0.1);
    }
    const held = time;
    expect(held).toBeGreaterThan(0.05);
    // Close to the contact the clip is in step with the ball, and never runs backwards.
    let last = time;
    for (let eta = 0.5; eta > -0.4; eta -= DT) {
      time = strokeTime(clip, eta, time, DT);
      expect(time).toBeGreaterThanOrEqual(last - 1e-9);
      last = time;
    }
    expect(strokeTime(clip, 0, held, DT)).toBeCloseTo(contact, 9);
    expect(strokeTime(clip, -10, held, DT)).toBeCloseTo(clip.dur, 9);
  });

  it('un clip sin metadatos usa valores razonables; con metadatos, los suyos', () => {
    const plain = { ...character.clips.derecha!, contact: undefined, armado: undefined, zancada: undefined };
    expect(contactOf(plain)).toBeCloseTo(plain.dur * 0.52, 9);
    expect(contactOf({ ...plain, contact: 0.31 })).toBe(0.31);
    expect(holdOf(plain)).toBeLessThan(contactOf(plain));
    expect(holdOf({ ...plain, contact: 0.5, armado: [0.2, 0.36] })).toBe(0.36);
    expect(strideOf({ ...character.clips.correr!, zancada: undefined })).toBeCloseTo(1.8, 9);
    expect(strideOf({ ...character.clips.correr!, zancada: 1.6 })).toBe(1.6);
    expect(strideOf({ ...plain, name: 'otro' })).toBeGreaterThan(0.5);
  });

  it('si la pelota no viene adonde el clip la espera, el cuerpo llega con un paso, no deslizándose', () => {
    const clip = character.clips.derecha!;
    const k = 1.2;
    const who = player({ anim: 'swing', animPhase: -1, shot: 'drive', animSide: 1 });
    const expected = onCourt(who, k, clip.hit!);
    // Further ahead and a little further out: still within what a real person reaches standing.
    const ball: [number, number, number] = [expected[0] + 0.15, expected[1] + 0.45, expected[2]];
    expect(strokeClipName({ ...who, reachX: ball[0] - who.x, reachY: ball[1] - who.y, reachZ: ball[2] }, k)).toBe('derecha');
    who.reachX = ball[0] - who.x;
    who.reachY = ball[1] - who.y;
    who.reachZ = ball[2];
    const animator = new FigureAnimator(character);
    for (let i = 0; i < 20; i++) animator.update(player(), k, 1, noBall, DT);
    const racket: [number, number, number] = [0, 0, 0];
    let slid = 0;
    // The ball is on the forehand side: the right foot is the one behind, and it stays where it is.
    const back = new Planted(animator, 'R', k);
    const front = new Planted(animator, 'L', k);
    for (let i = 40; i >= 0; i--) {
      who.contactIn = i * DT;
      animator.update(who, k, 1, noBall, DT);
      slid = Math.max(slid, Math.hypot(animator.x - who.x, animator.y - who.y));
      back.check();
      front.check();
    }
    animator.racketOnCourt(k, 1, racket);
    expect(distance(racket, ball)).toBeLessThan(0.12);
    // The whole figure did not move from where the simulation has the player.
    expect(slid).toBeLessThan(0.01);
    // A foot on the floor never slid over it: the front one got there in the air.
    expect(back.worst).toBeLessThan(0.005);
    expect(front.worst).toBeLessThan(0.005);
    // And the front foot stepped toward the ball: further ahead than the clip has it.
    expect(front.at()[1]! - onCourt(who, k, [0.16, -0.24, 0])[1]).toBeGreaterThan(0.1);
    // Afterwards it comes back to its place.
    for (let i = 1; i < 60; i++) {
      who.contactIn = -i * DT;
      who.animPhase = i / 25;
      animator.update(who, k, 1, noBall, DT);
      back.check();
      front.check();
    }
    expect(Math.hypot(animator.x - who.x, animator.y - who.y)).toBeLessThan(0.01);
    expect(back.worst).toBeLessThan(0.005);
    expect(front.worst).toBeLessThan(0.005);
  });

  it('pega mientras corre: los pies siguen la carrera y los brazos golpean', () => {
    const k = 1.2;
    const running = player({ vy: 4.5 });
    // A ball a little to the side: running, the body leans into it, and the feet are still the run's.
    const swinging = player({ vy: 4.5, anim: 'swing', animPhase: -1, shot: 'drive', animSide: 1, reachX: 0.9, reachY: 0.3, reachZ: 0.8 });
    const legs = new FigureAnimator(character);
    const both = new FigureAnimator(character);
    // Where a foot is on the court, and whether it is on the floor: a figure that faces the far end is turned half way round.
    const foot = (animator: FigureAnimator, side: string): { at: number[]; down: boolean } => {
      const pos = animator.skeleton.pos;
      const ankle = character.bone(`foot.${side}`) * 3;
      const toe = character.bone(`toe.${side}`) * 3;
      return {
        at: [ankle, toe].flatMap((at) => [animator.x - pos[at]! * k, animator.y - pos[at + 1]! * k, pos[at + 2]! * k]),
        down: pos[toe + 2]! < 0.045,
      };
    };
    let worst = 0;
    let planted = 0;
    for (let i = 0; i < 64; i++) {
      running.stride += 4.5 * DT;
      running.y += 4.5 * DT;
      swinging.stride = running.stride;
      swinging.y = running.y;
      swinging.contactIn = (60 - i) * DT;
      legs.update(running, k, 1, noBall, DT);
      both.update(swinging, k, 1, noBall, DT);
      for (const side of ['L', 'R']) {
        const a = foot(legs, side);
        if (!a.down) continue;
        planted++;
        const b = foot(both, side).at;
        for (let c = 0; c < b.length; c++) worst = Math.max(worst, Math.abs(a.at[c]! - b[c]!));
      }
    }
    // A foot the run has on the floor stays there while the body leans into the ball: not one centimetre.
    expect(planted).toBeGreaterThan(30);
    expect(worst).toBeLessThan(0.01);
    const bone = (animator: FigureAnimator, name: string): number[] => {
      const at = character.bone(name) * 16;
      return [...animator.bones.slice(at, at + 12)];
    };
    const arm = distance(bone(legs, 'forearm.R').slice(0, 3), bone(both, 'forearm.R').slice(0, 3));
    const other = distance(bone(legs, 'forearm.L').slice(0, 3), bone(both, 'forearm.L').slice(0, 3));
    expect(Math.max(arm, other)).toBeGreaterThan(0.2);
  });

  it('la cabeza sigue a la pelota', () => {
    const k = 1.2;
    const head = character.bone('head') * 16;
    const facing = (ballX: number): number => {
      const animator = new FigureAnimator(character);
      const who = player();
      for (let i = 0; i < 60; i++) animator.update(who, k, 1, { x: ballX, y: 2, z: 1, visible: true }, DT);
      // Which way the face points across the court. The head looks along its own -y, and a
      // figure that faces the far end is turned half way round, so the two signs cancel.
      return animator.bones[head + 4]!;
    };
    const left = facing(-4);
    const right = facing(4);
    expect(left).toBeLessThan(-0.15);
    expect(right).toBeGreaterThan(0.15);
    expect(Math.abs(facing(0))).toBeLessThan(0.12);
  });
});

describe('el cuerpo llega a la pelota como una persona', () => {
  /** Plays a stroke from rest to its contact, frame by frame; returns what the body did on the way. */
  function play(who: ScenePlayer, k: number, frames = 40): { animator: FigureAnimator; slid: number; hips: number; knee: number; toe: number; high: number } {
    const animator = new FigureAnimator(character);
    for (let i = 0; i < 20; i++) animator.update(player(), k, 1, noBall, DT);
    const pos = animator.skeleton.pos;
    const hips = character.bone('hips') * 3 + 2;
    const knees = ['shin.L', 'shin.R'].map((name) => character.bone(name) * 3 + 2);
    const toes = ['toe.L', 'toe.R'].map((name) => character.bone(name) * 3 + 2);
    const seen = { animator, slid: 0, hips: Infinity, knee: Infinity, toe: Infinity, high: -Infinity };
    for (let i = frames; i >= 0; i--) {
      who.contactIn = i * DT;
      animator.update(who, k, 1, noBall, DT);
      seen.slid = Math.max(seen.slid, Math.hypot(animator.x - who.x, animator.y - who.y));
      seen.knee = Math.min(seen.knee, ...knees.map((at) => pos[at]!));
      seen.toe = Math.min(seen.toe, ...toes.map((at) => pos[at]!));
      seen.high = Math.max(seen.high, pos[hips]!);
    }
    seen.hips = pos[hips]!;
    return seen;
  }

  it('una pelota baja: la cadera baja hasta casi el piso y la rodilla no lo atraviesa', () => {
    // The far side is drawn biggest: for it, the lowest ball the simulation lets anybody hit is lowest.
    const k = 1.5;
    const ball: [number, number, number] = [0.62, -5.8, 0.2];
    const who = player({ anim: 'swing', animPhase: -1, shot: 'drive', animSide: 1, reachX: ball[0], reachY: ball[1] + 6, reachZ: ball[2] });
    const seen = play(who, k);
    const racket: [number, number, number] = [0, 0, 0];
    seen.animator.racketOnCourt(k, 1, racket);
    expect(distance(racket, ball)).toBeLessThan(0.08);
    // The hips are at 0.95 m standing: they came down more than half a metre.
    expect(0.95 - seen.hips).toBeGreaterThan(0.5);
    // A knee nearly on the floor, never through it, and no foot under it.
    expect(seen.knee).toBeGreaterThan(0.07);
    expect(seen.knee).toBeLessThan(0.2);
    expect(seen.toe).toBeGreaterThan(0.02);
    expect(seen.slid).toBeLessThan(0.01);
  });

  it('el remate a una pelota más baja salta menos, y los pies no atraviesan el piso', () => {
    const k = 1.2;
    const clip = character.clips.remate!;
    const jumped = (z: number): { high: number; toe: number; racket: number } => {
      const at = onCourt(player(), k, clip.hit!);
      const ball: [number, number, number] = [at[0], at[1], z];
      const who = player({ anim: 'swing', animPhase: -1, shot: 'smash', animSide: 1, reachX: ball[0], reachY: ball[1] + 6, reachZ: z });
      const seen = play(who, k, 60);
      const racket: [number, number, number] = [0, 0, 0];
      seen.animator.racketOnCourt(k, 1, racket);
      return { high: seen.high, toe: seen.toe, racket: distance(racket, ball) };
    };
    // Where the clip meets the ball, and a ball 40 cm lower: the smash of the game is rarely as high as the clip's.
    const full = jumped(clip.hit![2] * k);
    const lower = jumped(clip.hit![2] * k - 0.4);
    expect(lower.high).toBeLessThan(full.high - 0.15);
    expect(lower.racket).toBeLessThan(0.1);
    expect(Math.min(full.toe, lower.toe)).toBeGreaterThan(0.02);
  });

  it('a fondo con el alcance real: la estirada llega sin deslizar el cuerpo, con el pie de atrás plantado', () => {
    for (const k of [1.2, 1.5]) {
      // A ball a metre and a half to the side, the furthest a real person reaches with a lunge.
      const ball: [number, number, number] = [1.55, -5.95, 0.5];
      const who = player({ anim: 'swing', animPhase: -1, shot: 'drive', animSide: 1, reachX: ball[0], reachY: ball[1] + 6, reachZ: ball[2] });
      expect(strokeClipName(who, k)).toBe('estirada');
      const animator = new FigureAnimator(character);
      for (let i = 0; i < 20; i++) animator.update(player(), k, 1, noBall, DT);
      // On the forehand side the right foot goes after the ball and the left one stays where it is.
      const back = new Planted(animator, 'L', k);
      const out = new Planted(animator, 'R', k);
      const start = out.at();
      let slid = 0;
      for (let i = 40; i >= 0; i--) {
        who.contactIn = i * DT;
        animator.update(who, k, 1, noBall, DT);
        slid = Math.max(slid, Math.hypot(animator.x - who.x, animator.y - who.y));
        back.check();
        out.check();
      }
      const racket: [number, number, number] = [0, 0, 0];
      animator.racketOnCourt(k, 1, racket);
      expect(distance(racket, ball), `k ${k}`).toBeLessThan(0.1);
      expect(slid, `k ${k}`).toBeLessThan(0.01);
      expect(back.worst, `k ${k}`).toBeLessThan(0.005);
      expect(out.worst, `k ${k}`).toBeLessThan(0.005);
      // The lunge: the right foot ends well out toward the ball.
      expect(out.at()[0]! - start[0]!, `k ${k}`).toBeGreaterThan(0.35);
    }
  });

  it('a la carrera, la última zancada es la estocada: el pie sale hacia la pelota y, apoyado, no patina', () => {
    const k = 1.2;
    const run = (reachX: number): { out: number; skate: number } => {
      const who = player({ vy: 3, anim: 'swing', animPhase: -1, shot: 'drive', animSide: 1, reachX, reachY: 0.3, reachZ: 0.7 });
      const plain = player({ vy: 3 });
      const lunging = new FigureAnimator(character);
      const running = new FigureAnimator(character);
      const feet = [new Planted(lunging, 'L', k), new Planted(lunging, 'R', k)];
      const theRun = new Planted(running, 'R', k);
      let out = 0;
      for (let i = 50; i >= -20; i--) {
        for (const one of [who, plain]) {
          one.stride += 3 * DT;
          one.y += 3 * DT;
        }
        who.contactIn = i * DT;
        who.animPhase = i > 0 ? -1 : -i / 30;
        lunging.update(who, k, 1, noBall, DT);
        running.update(plain, k, 1, noBall, DT);
        for (const foot of feet) foot.check();
        // On the forehand side the right foot goes after the ball: how much further out than the run has it.
        const foot = feet[1]!.at();
        if (foot[2]! < 0.045 && Math.abs(i) < 20) out = Math.max(out, foot[0]! - theRun.at()[0]!);
      }
      return { out, skate: Math.max(feet[0]!.worst, feet[1]!.worst) };
    };
    // A ball well out to the side: the last stride comes down half a metre further toward it.
    const far = run(1.3);
    expect(far.out).toBeGreaterThan(0.3);
    // On the floor it stays put, as in any stride of the run (a few millimetres as it lands).
    expect(far.skate).toBeLessThan(0.008);
    // A ball within easy reach: the run is the run.
    expect(run(0.6).out).toBeLessThan(0.02);
  });

  it('la estirada es para una pelota más lejos de lo que llega una persona parada, y al costado', () => {
    const at = (reachX: number, reachY: number, k: number): string =>
      strokeClipName(player({ anim: 'swing', shot: 'drive', animSide: 1, reachX, reachY, reachZ: 0.5 }), k);
    // Beyond the 1.15 m of a person standing: at full stretch, however big the figure is drawn.
    expect(at(1.2, 0.1, 1.5)).toBe('estirada');
    expect(at(1.2, 0.1, 1.2)).toBe('estirada');
    // Within it, standing: the step and the hips do it.
    expect(at(1.0, 0.1, 1.5)).toBe('derecha');
    // Far, but ahead of the body: the front foot steps forward instead.
    expect(at(0.4, 1.3, 1.2)).toBe('derecha');
    // In the character's own metres a ball this far to the side is only reached at full stretch.
    expect(at(1.0, 0.1, 1)).toBe('estirada');
  });
});

describe('lo que le pasa a la computadora se ve sin leer', () => {
  const k = 1.2;
  /** Where a bone is, in the character's own axes at life size. */
  const at = (animator: FigureAnimator, name: string): number[] => {
    const i = character.bone(name) * 3;
    return [...animator.skeleton.pos.slice(i, i + 3)];
  };
  /** Two figures that have been standing the same way: one gets something, the other is how it would be without it. */
  function twins(): [FigureAnimator, FigureAnimator] {
    const one = new FigureAnimator(character);
    const other = new FigureAnimator(character);
    for (let i = 0; i < 20; i++) {
      one.update(player(), k, 1, noBall, DT);
      other.update(player(), k, 1, noBall, DT);
    }
    return [one, other];
  }

  it('bloqueo: la pala se pone donde va a estar la pelota, sin armar, y la espera; la cabeza se aparta', () => {
    // A ball at the chest, fired at the body: on the forehand side, and on the backhand side.
    for (const [side, ball] of [
      [1, [0.3, -5.6, 1.25]],
      [-1, [-0.35, -5.6, 1.3]],
    ] as const) {
      const volley = (why: SceneWhy | null): { waiting: number; free: number } => {
        const who = player({ isHuman: false, anim: 'swing', animPhase: -1, shot: 'volley', animSide: side, why, reachX: ball[0], reachY: ball[1] + 6, reachZ: ball[2] });
        const animator = new FigureAnimator(character);
        for (let i = 0; i < 20; i++) animator.update(player(), k, 1, noBall, DT);
        const racket: [number, number, number] = [0, 0, 0];
        let waiting = 0;
        for (let i = 18; i >= 0; i--) {
          who.contactIn = i * DT;
          animator.update(who, k, 1, noBall, DT);
          animator.racketOnCourt(k, 1, racket);
          // The last eighth of a second before the ball gets there.
          if (i <= 8) waiting = Math.max(waiting, distance(racket, ball));
        }
        return { waiting, free: at(animator, 'hand.L')[2]! };
      };
      const block = volley('block');
      const ordinary = volley(null);
      // The racket of a block is already on the ball's way; an ordinary volley is still coming at it.
      expect(block.waiting, `lado ${side}`).toBeLessThan(0.02);
      expect(ordinary.waiting, `lado ${side}`).toBeGreaterThan(0.3);
      // On the forehand the free hand comes up beside the face.
      if (side === 1) {
        expect(block.free).toBeGreaterThan(1.4);
        expect(ordinary.free).toBeLessThan(1.3);
      }
    }
  });

  it('apurado: los brazos siguen la carrera hasta último momento, y la pala igual llega', () => {
    const apart = (why: SceneWhy | null): { early: number; contact: number } => {
      const who = player({ isHuman: false, vy: 3, anim: 'swing', animPhase: -1, shot: 'drive', animSide: 1, why, reachX: 0.7, reachY: 0.4, reachZ: 0.8 });
      const plain = player({ vy: 3 });
      const swinging = new FigureAnimator(character);
      const running = new FigureAnimator(character);
      const a: [number, number, number] = [0, 0, 0];
      const b: [number, number, number] = [0, 0, 0];
      let early = 0;
      for (let i = 40; i >= 0; i--) {
        for (const one of [who, plain]) {
          one.stride += 3 * DT;
          one.y += 3 * DT;
        }
        who.contactIn = i * DT;
        swinging.update(who, k, 1, noBall, DT);
        running.update(plain, k, 1, noBall, DT);
        swinging.racketOnCourt(k, 1, a);
        running.racketOnCourt(k, 1, b);
        // Until a fifth of a second before the contact.
        if (i * DT > 0.22) early = Math.max(early, distance(a, b));
      }
      return { early, contact: distance(a, [who.x + who.reachX, who.y + who.reachY, who.reachZ]) };
    };
    const hurried = apart('hurried');
    const ordinary = apart(null);
    // Hurried, the racket is the run's until the very end; an ordinary stroke winds up long before.
    expect(hurried.early).toBeLessThan(0.01);
    expect(ordinary.early).toBeGreaterThan(0.5);
    expect(hurried.contact).toBeLessThan(0.05);
  });

  it('no llegó: un momento después del golpe al aire, baja la cabeza; y se le pasa', () => {
    const head = (anim: 'whiff' | 'swing'): number[] => {
      const who = player({ isHuman: false, anim, animPhase: -1, shot: 'drive', animSide: 1, reachX: 0.6, reachY: 0.3, reachZ: 0.85 });
      const animator = new FigureAnimator(character);
      for (let i = 0; i < 20; i++) animator.update(player(), k, 1, noBall, DT);
      const heights: number[] = [];
      for (let i = 20; i >= -70; i--) {
        who.contactIn = i * DT;
        who.animPhase = i > 0 ? -1 : -i / 40;
        animator.update(who, k, 1, noBall, DT);
        heights.push(at(animator, 'head')[2]!);
      }
      return heights;
    };
    const missed = head('whiff');
    const hit = head('swing');
    const frame = (i: number): number => 20 - i;
    // Up to the swing, the same body.
    expect(Math.abs(missed[frame(10)]! - hit[frame(10)]!)).toBeLessThan(0.005);
    // A third of a second after it, the head of the one that missed hangs.
    expect(hit[frame(-20)]! - missed[frame(-20)]!).toBeGreaterThan(0.03);
    // And it is over by the time the follow-through is.
    expect(Math.abs(missed[frame(-60)]! - hit[frame(-60)]!)).toBeLessThan(0.005);
  });

  it('sorprendido: se queda un momento en los talones, y enseguida sigue', () => {
    const [caught, other] = twins();
    let arms = 0;
    let back = 0;
    for (let i = 0; i < 50; i++) {
      // Caught for a fifth of a second.
      caught.update(player({ isHuman: false, surprise: i < 12 ? 1 : 0 }), k, 1, noBall, DT);
      other.update(player({ isHuman: false }), k, 1, noBall, DT);
      arms = Math.max(arms, distance(at(caught, 'hand.L'), at(other, 'hand.L')));
      // The character looks along its own -y: back over its heels is +y.
      back = Math.max(back, at(caught, 'hips')[1]! - at(other, 'hips')[1]!);
    }
    expect(arms).toBeGreaterThan(0.3);
    expect(back).toBeGreaterThan(0.04);
    // A moment later it is as it always is.
    expect(distance(at(caught, 'hand.L'), at(other, 'hand.L'))).toBeLessThan(0.005);
    expect(distance(at(caught, 'hips'), at(other, 'hips'))).toBeLessThan(0.005);
  });

  it('la tensión de un punto largo: corriendo, nada; cuando espera, más bajo y con los pies más abiertos', () => {
    const [tense, other] = twins();
    const width = (animator: FigureAnimator): number => Math.abs(at(animator, 'toe.L')[0]! - at(animator, 'toe.R')[0]!);
    let y = -6;
    let stride = 0;
    // It runs to its place and waits there for the ball.
    for (let i = 0; i < 100; i++) {
      const vy = i < 40 ? 4 : 0;
      y += vy * DT;
      stride += vy * DT;
      tense.update(player({ vy, y, stride, tension: 1 }), k, 1, noBall, DT);
      other.update(player({ vy, y, stride }), k, 1, noBall, DT);
      const lower = at(other, 'hips')[2]! - at(tense, 'hips')[2]!;
      const wider = width(tense) - width(other);
      if (i === 30) {
        expect(Math.abs(lower)).toBeLessThan(0.005);
        expect(Math.abs(wider)).toBeLessThan(0.005);
      }
      if (i === 99) {
        expect(lower).toBeGreaterThan(0.05);
        // The feet came down wider when it stopped.
        expect(wider).toBeGreaterThan(0.05);
      }
    }
  });

  it('el robo: si sale bien, un festejo corto con la pala; si sale mal, «perdón» al compañero; ninguno dura', () => {
    {
      const [glad, other] = twins();
      glad.stoleWell();
      let most = 0;
      let lasted = 0;
      for (let i = 0; i < 60; i++) {
        glad.update(player(), k, 1, noBall, DT);
        other.update(player(), k, 1, noBall, DT);
        const apart = distance(at(glad, 'hand.R'), at(other, 'hand.R'));
        most = Math.max(most, apart);
        if (apart > 0.01) lasted = (i + 1) * DT;
      }
      expect(most).toBeGreaterThan(0.3);
      expect(lasted).toBeLessThan(0.6);
    }
    {
      const [sorry, other] = twins();
      // The partner is on the left of the court as the camera sees it: on its left, since it faces the far end.
      sorry.stoleBadly(-2.5);
      let up = 0;
      let toward = 0;
      let lasted = 0;
      for (let i = 0; i < 90; i++) {
        sorry.update(player(), k, 1, noBall, DT);
        other.update(player(), k, 1, noBall, DT);
        const hand = at(sorry, 'hand.L');
        up = Math.max(up, hand[2]!);
        toward = Math.max(toward, hand[0]! - at(other, 'hand.L')[0]!);
        if (distance(hand, at(other, 'hand.L')) > 0.01) lasted = (i + 1) * DT;
      }
      expect(up).toBeGreaterThan(1.5);
      expect(toward).toBeGreaterThan(0.2);
      expect(lasted).toBeLessThan(1.2);
    }
  });
});

describe('lo que cada personaje le agrega', () => {
  const k = 1.5;
  const bone = (animator: FigureAnimator, name: string): [number, number, number] => {
    const at = character.bone(name) * 3;
    return [animator.skeleton.pos[at]!, animator.skeleton.pos[at + 1]!, animator.skeleton.pos[at + 2]!];
  };
  /** The body of somebody on the far side, facing the camera, after holding a pose for a moment. */
  function posed(more: Partial<ScenePlayer>, frames = 30): FigureAnimator {
    const animator = new FigureAnimator(character);
    const who = player({ team: 1, y: 7, isHuman: false, restSide: -1, ...more });
    for (let i = 0; i < 10; i++) animator.update(player({ team: 1, y: 7, isHuman: false, restSide: -1 }), k, -1, noBall, DT);
    for (let i = 0; i < frames; i++) animator.update(who, k, -1, noBall, DT);
    return animator;
  }
  const armed = { anim: 'swing' as const, animPhase: -1, contactIn: 0.5 };
  const tell = (pose: 'pointAim' | 'plantWide' | 'crouchOpenFace' | 'stepIn', kind: 'drive' | 'lob' | 'drop', aimX = 0) => ({
    ...armed,
    shot: kind === 'lob' ? ('lob' as const) : ('drive' as const),
    tell: { kind, pose, aimX, t: 0.4 },
  });

  it('Beto señala con la mano libre a dónde va a tirar', () => {
    const plain = bone(posed(armed), 'hand.L');
    // Facing the camera, the character's left is the court's +x.
    const left = bone(posed(tell('pointAim', 'drive', 3)), 'hand.L');
    const right = bone(posed(tell('pointAim', 'drive', -3)), 'hand.L');
    expect(left[0]).toBeGreaterThan(right[0] + 0.5);
    // The hand is out in front of the body, not hanging at its side.
    expect(left[1]).toBeLessThan(plain[1] - 0.1);
    // Up for a lob, down for a short one.
    const lob = bone(posed(tell('pointAim', 'lob', 0)), 'hand.L');
    const drop = bone(posed(tell('pointAim', 'drop', 0)), 'hand.L');
    expect(lob[2]).toBeGreaterThan(drop[2] + 0.4);
  });

  it('Romina se planta con las piernas abiertas y la pala atrás de la cabeza', () => {
    const plain = posed(armed);
    const planted = posed(tell('plantWide', 'drive'));
    const apart = (animator: FigureAnimator): number => bone(animator, 'foot.L')[0] - bone(animator, 'foot.R')[0];
    expect(apart(planted)).toBeGreaterThan(apart(plain) + 0.3);
    expect(bone(planted, 'hips')[2]).toBeLessThan(bone(plain, 'hips')[2] - 0.04);
    expect(bone(planted, 'hand.R')[2]).toBeGreaterThan(bone(plain, 'hand.R')[2] + 0.15);
    // The feet stay on the floor.
    expect(bone(planted, 'foot.L')[2]).toBeCloseTo(bone(plain, 'foot.L')[2], 2);
  });

  it('Chela se agacha para el globo y da un paso para la chiquita', () => {
    const plain = posed(armed);
    const low = posed(tell('crouchOpenFace', 'lob'));
    expect(bone(low, 'hips')[2]).toBeLessThan(bone(plain, 'hips')[2] - 0.18);
    expect(bone(low, 'hand.R')[2]).toBeLessThan(0.8);
    const stepped = posed(tell('stepIn', 'drop'));
    // On the far side, toward the net is toward the camera.
    expect(stepped.y).toBeCloseTo(7 - 0.25, 2);
    expect(plain.y).toBeCloseTo(7, 6);
  });

  it('el gesto suelta antes del contacto: el golpe es el del clip', () => {
    const animator = new FigureAnimator(character);
    const who = player({ team: 1, y: 7, isHuman: false, restSide: -1, ...tell('plantWide', 'drive') });
    const clip = character.clips.derecha!;
    const at = [who.x + clip.hit![0] * k, who.y + clip.hit![1] * k, clip.hit![2] * k] as const;
    who.animSide = -1;
    who.reachX = at[0] - who.x;
    who.reachY = at[1] - who.y;
    who.reachZ = at[2];
    const racket: [number, number, number] = [0, 0, 0];
    for (let i = 60; i >= 0; i--) {
      who.contactIn = i * DT;
      animator.update(who, k, -1, noBall, DT);
    }
    animator.racketOnCourt(k, -1, racket);
    expect(distance(racket, at)).toBeLessThan(0.05 * k);
  });

  it('las manías son del cuerpo entero y solo mientras descansa', () => {
    const plain = posed({});
    const wave = posed({ act: { clip: 'wave', t: 0.3, duration: 0.7 } });
    expect(bone(wave, 'hand.L')[2]).toBeGreaterThan(bone(plain, 'hand.L')[2] + 0.5);
    // Tapping the shoe with the racket: a foot comes up to meet it, and the other stays on the floor.
    const tap = posed({ act: { clip: 'shoeTap', t: 0.28, duration: 0.56 } });
    expect(bone(tap, 'hand.R')[2]).toBeLessThan(bone(plain, 'hand.R')[2] - 0.12);
    expect(Math.max(bone(tap, 'foot.L')[2], bone(tap, 'foot.R')[2])).toBeGreaterThan(Math.max(bone(plain, 'foot.L')[2], bone(plain, 'foot.R')[2]) + 0.08);
    expect(Math.min(bone(tap, 'foot.L')[2], bone(tap, 'foot.R')[2])).toBeLessThan(0.2);
    const cap = posed({ act: { clip: 'cap', t: 0.2, duration: 0.4 } });
    expect(distance(bone(cap, 'hand.L'), bone(cap, 'head'))).toBeLessThan(0.45);
    // In the middle of a stroke there is no tic.
    const busy = posed({ ...armed, act: { clip: 'wave', t: 0.3, duration: 0.7 } });
    expect(bone(busy, 'hand.L')[2]).toBeLessThan(bone(wave, 'hand.L')[2] - 0.3);
  });

  it('aparecen y se van de a poco, sin saltos', () => {
    const animator = new FigureAnimator(character);
    const base = { team: 1 as const, y: 7, isHuman: false, restSide: -1 as const };
    for (let i = 0; i < 20; i++) animator.update(player(base), k, -1, noBall, DT);
    let last = bone(animator, 'hand.L');
    let worst = 0;
    const frame = (who: ScenePlayer): void => {
      animator.update(who, k, -1, noBall, DT);
      const now = bone(animator, 'hand.L');
      worst = Math.max(worst, distance(now, last));
      last = now;
    };
    for (let i = 0; i < 20; i++) frame(player({ ...base, act: { clip: 'wave', t: 0.05 + i * DT, duration: 0.7 } }));
    for (let i = 0; i < 20; i++) frame(player(base));
    // An arm going up over the head in a blink still moves a hand's width per frame, not a metre.
    expect(worst).toBeLessThan(0.28);
    expect(distance(last, bone(posed({}), 'hand.L'))).toBeLessThan(0.05);
  });
});

describe('el saque', () => {
  it('antes de sacar, la pelota está en la mano libre, delante del cuerpo', () => {
    const k = 1.2;
    const animator = new FigureAnimator(character);
    const who = player();
    for (let i = 0; i < 20; i++) animator.update(who, k, 1, noBall, DT, { rivalHitIn: Infinity, holding: true, resting: false });
    const ball: [number, number, number] = [0, 0, 0];
    expect(animator.ballInHand(k, 1, ball)).toBe(true);
    // Where the clip of the serve says the ball is at its very start, for somebody facing the far end.
    const hold = character.clips.saque!.ballHold![0];
    expect(ball[0]).toBeCloseTo(who.x - hold[0] * k, 2);
    expect(ball[1]).toBeCloseTo(who.y - hold[1] * k, 2);
    expect(ball[2]).toBeCloseTo(hold[2] * k, 2);
    // In front of the body, at the chest, a hand's width from the free hand.
    expect(ball[1]).toBeGreaterThan(who.y + 0.3);
    expect(ball[2]).toBeGreaterThan(0.9);
    const hand = character.bone('hand.L') * 3;
    const at = [who.x - animator.skeleton.pos[hand]! * k, who.y - animator.skeleton.pos[hand + 1]! * k, animator.skeleton.pos[hand + 2]! * k];
    expect(distance(ball, at)).toBeLessThan(0.25);
  });

  it('con el cuerpo de cada personaje, la pala igual llega al punto de contacto', () => {
    for (const name of ['beto', 'romina', 'chela']) {
      const style = styleOf(character, name);
      const k = 1.5 * style.size;
      for (const clipName of ['derecha', 'reves', 'bandeja']) {
        const clip = character.clips[clipName]!;
        const animator = new FigureAnimator(character, style);
        // Its bones are scaled and it stands its own way: its racket is not quite where the clip says.
        const own = animator.hitOf(clip)!;
        expect(distance(own, clip.hit!)).toBeLessThan(0.12);
        const who = player({ anim: 'swing', animPhase: -1, shot: clipName === 'bandeja' ? 'bandeja' : 'drive', animSide: clipName === 'reves' ? -1 : 1 });
        const ball = onCourt(who, k, own);
        who.reachX = ball[0] - who.x;
        who.reachY = ball[1] - who.y;
        who.reachZ = ball[2];
        for (let i = 50; i >= 0; i--) {
          who.contactIn = i * DT;
          animator.update(who, k, 1, noBall, DT);
        }
        const racket: [number, number, number] = [0, 0, 0];
        animator.racketOnCourt(k, 1, racket);
        expect(distance(racket, ball), `${name} ${clipName}`).toBeLessThan(0.04 * k);
      }
    }
  });
});

describe('el festejo de un punto ganado', () => {
  const k = 1.2;
  const hands = (animator: FigureAnimator): number[] => {
    const l = character.bone('hand.L') * 3;
    const r = character.bone('hand.R') * 3;
    return [...animator.skeleton.pos.slice(l, l + 3), ...animator.skeleton.pos.slice(r, r + 3)];
  };
  const apart = (a: number[], b: number[]): number => Math.hypot(...a.map((v, i) => v - b[i]!));

  it('dura menos que la pausa entre puntos y termina solo', () => {
    expect(character.clips.festejo!.dur).toBeLessThanOrEqual(1);
    const still = new FigureAnimator(character);
    const glad = new FigureAnimator(character);
    const who = player();
    for (let i = 0; i < 20; i++) {
      still.update(who, k, 1, noBall, DT);
      glad.update(who, k, 1, noBall, DT);
    }
    glad.cheer();
    let most = 0;
    let worst = 0;
    let last = hands(glad);
    for (let i = 0; i < 80; i++) {
      still.update(who, k, 1, noBall, DT);
      glad.update(who, k, 1, noBall, DT);
      most = Math.max(most, apart(hands(glad), hands(still)));
      worst = Math.max(worst, apart(hands(glad), last));
      last = hands(glad);
    }
    // It does something with its arms, without a jump on the way in or out...
    expect(most).toBeGreaterThan(0.25);
    expect(worst).toBeLessThan(0.3);
    // ...and a second and a bit later it is standing as if nothing had happened.
    expect(apart(hands(glad), hands(still))).toBeLessThan(0.02);
  });

  it('quien pierde el punto se desinfla un momento, y también se le pasa', () => {
    const sad = new FigureAnimator(character);
    const still = new FigureAnimator(character);
    const who = player();
    const rest = { rivalHitIn: Infinity, holding: false, resting: true };
    for (let i = 0; i < 20; i++) {
      sad.update(who, k, 1, noBall, DT, rest);
      still.update(who, k, 1, noBall, DT, rest);
    }
    sad.lament();
    let most = 0;
    for (let i = 0; i < 90; i++) {
      sad.update(who, k, 1, noBall, DT, rest);
      still.update(who, k, 1, noBall, DT, rest);
      most = Math.max(most, apart(hands(sad), hands(still)));
    }
    expect(most).toBeGreaterThan(0.15);
    expect(apart(hands(sad), hands(still))).toBeLessThan(0.02);
    expect(character.clips.lamento!.dur).toBeLessThanOrEqual(1);
  });

  it('caminando a su lugar, festeja de la cintura para arriba', () => {
    const glad = new FigureAnimator(character);
    const calm = new FigureAnimator(character);
    const walking = player({ vx: 2.2 });
    for (let i = 0; i < 20; i++) {
      walking.stride += 2.2 * DT;
      glad.update(walking, k, 1, noBall, DT);
      calm.update(walking, k, 1, noBall, DT);
    }
    glad.cheer();
    let most = 0;
    for (let i = 0; i < 20; i++) {
      walking.stride += 2.2 * DT;
      glad.update(walking, k, 1, noBall, DT);
      calm.update(walking, k, 1, noBall, DT);
      most = Math.max(most, apart(hands(glad), hands(calm)));
      // The legs are the ones of somebody walking.
      for (const name of ['thigh.L', 'shin.R']) {
        const at = character.bone(name) * 16;
        for (let c = 0; c < 12; c++) expect(glad.bones[at + c]!).toBeCloseTo(calm.bones[at + c]!, 2);
      }
    }
    expect(most).toBeGreaterThan(0.2);
  });

  it('no demora nada: si hay que pegar, espera; y el punto siguiente lo corta', () => {
    const glad = new FigureAnimator(character);
    const calm = new FigureAnimator(character);
    const who = player();
    for (let i = 0; i < 20; i++) {
      glad.update(who, k, 1, noBall, DT);
      calm.update(who, k, 1, noBall, DT);
    }
    glad.cheer();
    for (let i = 0; i < 12; i++) {
      glad.update(who, k, 1, noBall, DT);
      calm.update(who, k, 1, noBall, DT);
    }
    // A stroke takes the body back: a moment later it is just somebody with the racket up.
    const swinging = player({ anim: 'swing', animPhase: -1, contactIn: 0.6, shot: 'smash', reachZ: 2.6 });
    for (let i = 0; i < 16; i++) {
      glad.update(swinging, k, 1, noBall, DT);
      calm.update(swinging, k, 1, noBall, DT);
    }
    expect(apart(hands(glad), hands(calm))).toBeLessThan(0.03);
    // And a new point starts from scratch.
    glad.cheer();
    glad.reset();
    calm.reset();
    glad.update(who, k, 1, noBall, DT);
    calm.update(who, k, 1, noBall, DT);
    expect(apart(hands(glad), hands(calm))).toBeLessThan(1e-6);
  });
});

describe('en un partido de verdad', () => {
  it('en el contacto, la pala está cerca de la pelota', () => {
    const config = createConfig();
    const match = new Match({
      config,
      seed: 77,
      teams: [
        { name: 'Vos', players: [humanEntry(5, SKILLS.average)] },
        { name: 'Romina', players: [aiEntry(config, 'romina', 6)] },
      ],
    });
    const scene = createScene();
    const input = new InputState();
    const options: SceneOptions = {
      aids: 'minimal',
      aidStrength: 1,
      reduceMotion: false,
      debug: false,
      cueLead: 0,
      tutorial: null,
      cast: [null, CAST.romina],
      acts: [null, null],
    };
    const animators = [new FigureAnimator(character), new FigureAnimator(character)];
    const racket: [number, number, number] = [0, 0, 0];
    const gaps: number[] = [];
    const byClip: Record<string, number[]> = {};
    for (let frame = 0; frame < 240 * 60 && match.phase !== 'matchOver'; frame++) {
      const hits: Array<{ player: number; x: number; y: number; z: number }> = [];
      for (let step = 0; step < 2; step++) {
        match.step();
        for (const event of match.events) if (event.type === 'hit') hits.push(event);
        match.events.length = 0;
      }
      fillScene(scene, match, 1, input, options);
      for (let i = 0; i < 2; i++) {
        const who = scene.players[i]!;
        animators[i]!.update(who, figureScale(who.y), who.team === 0 ? 1 : -1, scene.ball, DT);
      }
      for (const hit of hits) {
        const who = scene.players[hit.player]!;
        animators[hit.player]!.racketOnCourt(figureScale(who.y), who.team === 0 ? 1 : -1, racket);
        const gap = distance(racket, [hit.x, hit.y, hit.z]);
        gaps.push(gap);
        (byClip[strokeClipName(who, figureScale(who.y))] ??= []).push(gap);
      }
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)]!;
    const p90 = gaps[Math.floor(gaps.length * 0.9)]!;
    const report = Object.entries(byClip)
      .map(([name, list]) => `${name} ${list.length}: ${(list.reduce((a, b) => a + b, 0) / list.length).toFixed(2)}`)
      .join(' · ');
    void report;
    expect(gaps.length).toBeGreaterThan(60);
    // On the ball for most hits. The rest are balls taken at full stretch, two metres from the feet,
    // and swings that came late: the simulation is generous with those, and the body only goes so far.
    expect(median).toBeLessThan(0.2);
    expect(p90).toBeLessThan(1);
  });
});
