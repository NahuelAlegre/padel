import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boneToCharacter, createSkeleton, parseCharacter, samplePose, solveSkeleton, stand, styleOf, type Character } from '../src/render/toon/character';
import { armOf, elbowOf, flexion, keepElbow, keepWrist, legOf, reachLimb, swivelLimb, worldRotations, wristOf } from '../src/render/toon/reach';
import { snapshot } from '../src/studio/snapshot';
import { excess, limitOf, measure, MEASURED, studioDemo, studioMoments, watch, wristStep, WRIST_JUMP, type BodyFrame } from './anatomy';

/**
 * The bodies on court do what a body does: no joint goes beyond what a
 * person's does (docs/investigacion-anatomia.md, section 6). Measured on the
 * clips as they come from Blender, and on what is drawn: every situation of
 * the animation studio, as it finds them, and a minute of doubles.
 */

function loadCharacter(): Character {
  const file = readFileSync(new URL('../public/art/character.bin', import.meta.url));
  return parseCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
}

const character = loadCharacter();
const RAD = Math.PI / 180;

/**
 * What the clips bring from Blender today beyond a hard limit: by clip and by
 * measure, how far beyond at the worst, in degrees, rounded up to 5, with any
 * of the cast. `.jump` is a hand that turns on its forearm more than a wrist
 * does from one frame to the next, at 60 a second.
 *
 * Where it comes from (section 2.3 of the research): the racket is held like a
 * hammer, the hands are set in the character's axes and not on the forearm,
 * their turn is interpolated as two directions, and a straight arm leaves the
 * forearm free to flip about itself. It is mended in the clips (step 4); the
 * game keeps what is drawn within range in the meantime. So this list can
 * only get shorter: a clip that goes further fails, and so does one that no
 * longer needs an entry, or needs 10° less, until the list says so.
 */
const CLIPS: Record<string, Record<string, number>> = {
  correr: { 'elbow.free.flex': 5, 'elbow.racket.flex': 10, 'elbow.racket.off': 35, 'elbow.racket.twist': 170, 'shoulder.free.horizontal': 15, 'shoulder.racket.horizontal': 15, 'wrist.racket.deviation': 85, 'wrist.racket.flex': 75, 'wrist.racket.jump': 55, 'wrist.racket.twist': 95 },
  correr_atras: { 'wrist.racket.deviation': 40, 'wrist.racket.flex': 15 },
  arranque: { 'elbow.free.flex': 20, 'elbow.free.off': 40, 'elbow.free.twist': 170, 'elbow.racket.flex': 5, 'wrist.free.deviation': 5, 'wrist.free.jump': 60, 'wrist.free.twist': 70, 'wrist.racket.deviation': 65, 'wrist.racket.flex': 75, 'wrist.racket.jump': 10, 'wrist.racket.twist': 95 },
  frenada: { 'elbow.free.flex': 5, 'shoulder.racket.horizontal': 10, 'wrist.free.deviation': 10, 'wrist.racket.deviation': 15, 'wrist.racket.flex': 75, 'wrist.racket.jump': 5 },
  saque: { 'shoulder.free.horizontal': 15, 'wrist.free.twist': 25, 'wrist.racket.deviation': 50, 'wrist.racket.flex': 5, 'wrist.racket.jump': 25, 'wrist.racket.twist': 85 },
  derecha: { 'elbow.racket.flex': 10, 'elbow.racket.off': 50, 'elbow.racket.twist': 170, 'shoulder.free.horizontal': 15, 'wrist.free.deviation': 5, 'wrist.racket.deviation': 95, 'wrist.racket.flex': 40, 'wrist.racket.jump': 65, 'wrist.racket.twist': 85 },
  reves: { 'ankle.R.dorsi': 5, 'wrist.free.deviation': 70, 'wrist.free.flex': 60, 'wrist.free.jump': 20, 'wrist.free.twist': 95, 'wrist.racket.deviation': 40, 'wrist.racket.jump': 45, 'wrist.racket.twist': 90 },
  volea: { 'elbow.free.flex': 10, 'elbow.free.off': 30, 'elbow.free.twist': 165, 'elbow.racket.flex': 15, 'elbow.racket.off': 45, 'elbow.racket.twist': 170, 'shoulder.free.horizontal': 35, 'wrist.free.deviation': 140, 'wrist.free.flex': 55, 'wrist.free.jump': 65, 'wrist.free.twist': 90, 'wrist.racket.deviation': 65, 'wrist.racket.flex': 10, 'wrist.racket.jump': 75, 'wrist.racket.twist': 85 },
  volea_reves: { 'ankle.R.dorsi': 5, 'elbow.free.flex': 20, 'elbow.free.off': 60, 'elbow.free.twist': 165, 'shoulder.racket.horizontal': 15, 'wrist.free.deviation': 45, 'wrist.free.jump': 65, 'wrist.free.twist': 95, 'wrist.racket.deviation': 10 },
  bandeja: { 'elbow.free.flex': 5, 'shoulder.free.horizontal': 25, 'wrist.free.deviation': 20, 'wrist.free.flex': 5, 'wrist.free.jump': 50, 'wrist.free.twist': 10, 'wrist.racket.deviation': 50, 'wrist.racket.flex': 40, 'wrist.racket.jump': 30, 'wrist.racket.twist': 90 },
  remate: { 'ankle.L.dorsi': 15, 'elbow.free.flex': 20, 'elbow.free.off': 85, 'elbow.free.twist': 170, 'elbow.racket.flex': 5, 'elbow.racket.off': 85, 'elbow.racket.twist': 115, 'shoulder.racket.horizontal': 70, 'wrist.free.deviation': 85, 'wrist.free.flex': 45, 'wrist.free.jump': 70, 'wrist.free.twist': 70, 'wrist.racket.deviation': 110, 'wrist.racket.flex': 70, 'wrist.racket.jump': 70, 'wrist.racket.twist': 95 },
  globo: { 'ankle.L.dorsi': 5, 'ankle.R.dorsi': 5, 'shoulder.free.horizontal': 20, 'wrist.free.deviation': 5, 'wrist.racket.deviation': 45, 'wrist.racket.flex': 25, 'wrist.racket.jump': 20, 'wrist.racket.twist': 85 },
  estirada: { 'hips.spread': 25, 'shoulder.free.horizontal': 75, 'wrist.free.deviation': 90, 'wrist.free.jump': 25, 'wrist.free.twist': 95, 'wrist.racket.deviation': 30, 'wrist.racket.flex': 25, 'wrist.racket.jump': 5, 'wrist.racket.twist': 10 },
  estirada_reves: { 'elbow.free.flex': 20, 'elbow.free.off': 45, 'elbow.free.twist': 170, 'hips.spread': 25, 'shoulder.free.horizontal': 35, 'wrist.free.deviation': 45, 'wrist.free.flex': 20, 'wrist.free.jump': 55, 'wrist.free.twist': 90, 'wrist.racket.deviation': 10 },
  festejo: { 'elbow.racket.flex': 5, 'shoulder.racket.horizontal': 25, 'wrist.free.deviation': 55, 'wrist.racket.deviation': 55, 'wrist.racket.flex': 25 },
  mania_zapatilla: { 'shoulder.free.horizontal': 40, 'wrist.free.flex': 5, 'wrist.free.jump': 5, 'wrist.racket.deviation': 10, 'wrist.racket.flex': 25, 'wrist.racket.jump': 40 },
  mania_saludo: { 'wrist.free.jump': 55, 'wrist.racket.deviation': 5, 'wrist.racket.flex': 20 },
};

/**
 * What is drawn still goes beyond a hard limit here, at the worst (degrees,
 * rounded up to 5), and why: none of it is the reach, the knees, the bend of
 * the elbows or the wrists, which are kept within range as they are drawn.
 * Pending work, each with its own: the list only gets shorter, as `CLIPS`.
 */
const DRAWN: Record<string, { worst: number; why: string }> = {
  'elbow.free.off': { worst: 75, why: 'clips: el codo doblado de costado cuando el brazo pasa por recto (CLIPS)' },
  'elbow.racket.off': { worst: 75, why: 'clips: el codo doblado de costado (CLIPS)' },
  'shoulder.free.horizontal': { worst: 75, why: 'clips (la estirada, CLIPS); los avisos a la pareja ya no lo pasan' },
  'shoulder.racket.horizontal': { worst: 90, why: 'clips (remate, CLIPS) y el giro de la cadera de la carrera bajo un golpe' },
  'hip.L.abduction': { worst: 35, why: 'la estirada: el clip abre las piernas y el cuerpo va más allá tras la pelota' },
  'hip.R.abduction': { worst: 15, why: 'la estirada' },
  'hip.L.flexion': { worst: 45, why: 'la estirada a la carrera: la pierna de atrás no llega al pie apoyado' },
  'hip.R.flexion': { worst: 35, why: 'la estirada a la carrera' },
  'hips.spread': { worst: 55, why: 'la estirada (el clip ya abre 131° entre muslos) y la cadera que va tras la pelota' },
  'ankle.L.dorsi': { worst: 60, why: 'el pie apoyado queda plano mientras la cadera baja: el talón no se levanta' },
  'ankle.R.dorsi': { worst: 65, why: 'el pie apoyado queda plano mientras la cadera baja' },
  'trunk.twist': { worst: 15, why: 'clips: un golpe sobre la carrera con la pelvis girada' },
};

/** Problems with a measured worst (degrees beyond a hard limit) against what a list allows. */
function ratchet(what: string, worst: number, allowed: number | undefined, problems: string[]): void {
  const round = (value: number): number => Math.ceil(value / 5) * 5;
  if (allowed === undefined) {
    if (worst > 0) problems.push(`${what}: se pasa ${worst.toFixed(0)}° del límite duro`);
  } else if (worst <= 0) {
    problems.push(`${what}: ya no se pasa del límite duro, hay que sacar la excepción (${allowed})`);
  } else if (worst > allowed) {
    problems.push(`${what}: se pasa ${worst.toFixed(0)}°, más que los ${allowed} de la excepción`);
  } else if (worst <= allowed - 10) {
    problems.push(`${what}: ahora se pasa ${worst.toFixed(0)}°, hay que bajar la excepción de ${allowed} a ${round(worst)}`);
  }
}

describe('anatomía: ningún cuerpo se rompe', () => {
  it('los clips solos, con cada personaje: nada pasa un límite duro salvo lo que ya traen, y eso solo puede achicarse', () => {
    const cast = Object.keys(character.meta.personajes ?? {});
    expect(cast.length).toBeGreaterThan(2);
    const pose = new Float32Array(character.poseSize);
    const skeleton = createSkeleton(character);
    const problems: string[] = [];
    for (const clip of Object.values(character.clips)) {
      const worst: Record<string, number> = {};
      for (const name of cast) {
        const style = styleOf(character, name);
        const frames = Math.max(2, Math.round(clip.dur * 60));
        let before: Float32Array | null = null;
        for (let f = 0; f <= frames; f++) {
          samplePose(character, clip, (f / frames) * clip.dur, pose);
          stand(pose, style);
          solveSkeleton(character, pose, skeleton, style);
          const m = measure(character, skeleton.rot);
          for (const key of MEASURED) worst[key] = Math.max(worst[key] ?? 0, excess(key, m[key]!, m, 'hard'));
          if (before) {
            for (const [side, arm] of [
              ['L', 'free'],
              ['R', 'racket'],
            ] as const) {
              worst[`wrist.${arm}.jump`] = Math.max(worst[`wrist.${arm}.jump`] ?? 0, wristStep(character, before, skeleton.rot, side) - WRIST_JUMP.hard);
            }
          }
          before = Float32Array.from(skeleton.rot);
        }
      }
      const allowed = CLIPS[clip.name] ?? {};
      for (const key of new Set([...Object.keys(worst), ...Object.keys(allowed)])) ratchet(`${clip.name}: ${key}`, worst[key] ?? 0, allowed[key], problems);
    }
    for (const name of Object.keys(CLIPS)) if (!character.clips[name]) problems.push(`${name}: ya no hay un clip así, hay que sacarlo de la lista`);
    expect(problems).toEqual([]);
  });

  describe('lo que se dibuja: las situaciones del estudio y un minuto de dobles', () => {
    const frames: BodyFrame[] = [];
    const see = (frame: BodyFrame): void => {
      frames.push({ ...frame, rot: Float32Array.from(frame.rot) });
    };
    let played = false;
    const play = (): BodyFrame[] => {
      if (played) return frames;
      played = true;
      // Every situation of the studio, the player it shows; and everybody in a minute of doubles.
      for (const { key, moment, lineup } of studioMoments()) watch(character, snapshot(moment.from), lineup, moment.end - moment.start, key, see, moment.player);
      const { match, lineup } = studioDemo(11);
      watch(character, match, lineup, 60, 'dobles', see);
      return frames;
    };

    it('ninguna articulación pasa un límite duro, salvo lo pendiente, que solo puede achicarse; y el p99 de las demás queda en el blando', { timeout: 30_000 }, () => {
      const all = play();
      expect(all.length).toBeGreaterThan(14000);
      const worst: Record<string, number> = {};
      const soft: Record<string, number[]> = {};
      const where: Record<string, string> = {};
      for (const frame of all) {
        const m = measure(character, frame.rot);
        for (const key of MEASURED) {
          const beyond = excess(key, m[key]!, m, 'hard');
          if (beyond > (worst[key] ?? 0)) where[key] = `${frame.where}, ${frame.who}`;
          worst[key] = Math.max(worst[key] ?? 0, beyond);
          (soft[key] ??= []).push(excess(key, m[key]!, m, 'soft'));
        }
      }
      const problems: string[] = [];
      for (const key of MEASURED) ratchet(`${key} (${limitOf(key)!.what}; peor en ${where[key] ?? '-'})`, worst[key] ?? 0, DRAWN[key]?.worst, problems);
      for (const key of MEASURED) {
        if (DRAWN[key]) continue;
        const values = soft[key]!.sort((a, b) => a - b);
        const p99 = values[Math.floor(values.length * 0.99)]!;
        if (p99 > 0.05) problems.push(`${key}: el p99 se pasa ${p99.toFixed(1)}° del límite blando`);
      }
      expect(problems).toEqual([]);
    });

    it('una mano nunca gira sobre el antebrazo más de lo que gira una muñeca entre dos cuadros', () => {
      const all = play();
      const last = new Map<string, BodyFrame>();
      const jumps: string[] = [];
      for (const frame of all) {
        const id = `${frame.where}/${frame.who}`;
        const before = last.get(id);
        // Somebody put somewhere else for a new point does not count.
        if (before && Math.hypot(frame.x - before.x, frame.y - before.y) < 1) {
          for (const side of ['L', 'R'] as const) {
            const step = wristStep(character, before.rot, frame.rot, side);
            if (step > WRIST_JUMP.hard) jumps.push(`${id} ${side}: ${step.toFixed(0)}°`);
          }
        }
        last.set(id, frame);
      }
      expect(jumps).toEqual([]);
    });

    it('la pala va hacia la pelota sin forzar el brazo: cerca, no siempre encima (la pelota dibujada hace el resto)', () => {
      const distances = play()
        .filter((frame) => frame.contact)
        .map(({ contact }) => Math.hypot(contact!.racket[0] - contact!.ball[0], contact!.racket[1] - contact!.ball[1], contact!.racket[2] - contact!.ball[2]))
        .sort((a, b) => a - b);
      expect(distances.length).toBeGreaterThan(25);
      // On the court, in metres: a racket head is a quarter of a metre across, and drawn bigger than life.
      expect(distances[Math.floor(distances.length / 2)]!).toBeLessThan(0.15);
      expect(distances[Math.floor(distances.length * 0.9)]!).toBeLessThan(0.35);
    });
  });
});

describe('las articulaciones que se corrigen al dibujar', () => {
  const posed = (clip: string, at: number): { pose: Float32Array; skeleton: ReturnType<typeof createSkeleton>; world: Float32Array } => {
    const pose = samplePose(character, character.clips[clip]!, at, new Float32Array(character.poseSize));
    const skeleton = solveSkeleton(character, pose, createSkeleton(character));
    return { pose, skeleton, world: worldRotations(character, pose, new Float32Array(character.bones * 4)) };
  };
  const joint = (skeleton: ReturnType<typeof createSkeleton>, bone: number): number[] => [...skeleton.pos.slice(bone * 3, bone * 3 + 3)];
  /** How far the lower bone of a limb is off the plane its hinge bends it in, in degrees. */
  const offPlane = (skeleton: ReturnType<typeof createSkeleton>, world: Float32Array, limb: ReturnType<typeof armOf>): number => {
    const [x, y, z, w] = world.slice(limb.upper * 4, limb.upper * 4 + 4) as unknown as [number, number, number, number];
    // The hinge: one axis of the upper bone, turned as the bone is.
    const axis = [0, 0, 0];
    axis[limb.hinge] = 1;
    const [ax, ay, az] = axis as [number, number, number];
    const cx = y * az - z * ay + w * ax;
    const cy = z * ax - x * az + w * ay;
    const cz = x * ay - y * ax + w * az;
    const n = [ax + 2 * (y * cz - z * cy), ay + 2 * (z * cx - x * cz), az + 2 * (x * cy - y * cx)];
    const a = joint(skeleton, limb.lower);
    const b = joint(skeleton, limb.end);
    const d = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const length = Math.hypot(d[0]!, d[1]!, d[2]!);
    return (Math.asin((d[0]! * n[0]! + d[1]! * n[1]! + d[2]! * n[2]!) / length) * 180) / Math.PI;
  };
  /** Whether two poses turn every bone the same way (a clip's turns are blended without being brought to length one). */
  const same = (a: Float32Array, b: Float32Array, bones: number[]): boolean =>
    bones.every((bone) => {
      const o = bone * 4;
      const dot = a[o]! * b[o]! + a[o + 1]! * b[o + 1]! + a[o + 2]! * b[o + 2]! + a[o + 3]! * b[o + 3]!;
      return Math.abs(dot) / (Math.hypot(...a.slice(o, o + 4)) * Math.hypot(...b.slice(o, o + 4))) > 1 - 1e-9;
    });
  const apart = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

  it('el brazo y la pierna doblan solo en la bisagra, entre sus topes, y la mano o el pie siguen mirando adonde miraban', () => {
    for (const [clip, at, limb, key] of [
      ['derecha', 0.45, armOf(character, 'R'), 'elbow.racket'],
      ['volea', 0.2, armOf(character, 'L'), 'elbow.free'],
      ['listo', 0.3, legOf(character, 'L'), 'knee.L'],
      ['correr', 0.1, legOf(character, 'R'), 'knee.R'],
    ] as const) {
      for (const [dx, dy, dz] of [
        [0.15, 0, 0],
        [0, -0.2, 0.1],
        [-0.1, 0.1, -0.25],
        [0, 0, 0.6],
        [0.05, 0.05, -0.6],
      ] as const) {
        const { pose, skeleton, world } = posed(clip, at);
        const before = measure(character, skeleton.rot);
        const plane = offPlane(skeleton, world, limb);
        const end = joint(skeleton, limb.end);
        const turned = [...world.slice(limb.end * 4, limb.end * 4 + 4)];
        const target = [end[0]! + dx, end[1]! + dy, end[2]! + dz];
        reachLimb(character, pose, skeleton, world, limb, target[0]!, target[1]!, target[2]!);
        solveSkeleton(character, pose, skeleton);
        const what = `${clip} ${key} hacia (${dx}, ${dy}, ${dz})`;
        // Only about the hinge: the lower bone is as far off the plane of the hinge as it was.
        expect(Math.abs(offPlane(skeleton, worldRotations(character, pose, new Float32Array(character.bones * 4)), limb) - plane), what).toBeLessThan(0.05);
        const bent = (flexion(skeleton, worldRotations(character, pose, new Float32Array(character.bones * 4)), limb) * 180) / Math.PI;
        expect(bent, what).toBeGreaterThanOrEqual(Math.min(2, before[`${key}.flex`]!) - 0.01);
        expect(bent, what).toBeLessThanOrEqual(Math.max(key.startsWith('knee') ? 150 : 145, before[`${key}.flex`]!) + 0.01);
        // Where it can, it gets there; where it cannot, it does not lock straight.
        const got = joint(skeleton, limb.end);
        if (apart(got, target) > 0.005) expect(bent, what).toBeGreaterThan(1.9);
        // The end keeps its turn in the character's axes.
        const now = worldRotations(character, pose, new Float32Array(character.bones * 4)).slice(limb.end * 4, limb.end * 4 + 4);
        expect(Math.abs(now[0]! * turned[0]! + now[1]! * turned[1]! + now[2]! * turned[2]! + now[3]! * turned[3]!), what).toBeGreaterThan(0.99999);
      }
    }
  });

  it('el brazo gira alrededor de la línea hombro–mano para poner el codo donde va: la mano no se mueve y el codo dobla igual, en su bisagra', () => {
    for (const [clip, at] of [
      ['listo', 0.3],
      ['correr', 0.2],
      ['volea', 0.2],
    ] as const) {
      // The free hand raised over the head, first by the shortest way, then the elbow put out to the side.
      const { pose, skeleton, world } = posed(clip, at);
      const arm = armOf(character, 'L');
      const shoulder = joint(skeleton, arm.upper);
      reachLimb(character, pose, skeleton, world, arm, shoulder[0]! + 0.07, shoulder[1]! - 0.1, shoulder[2]! + 0.4);
      solveSkeleton(character, pose, skeleton);
      const hand = joint(skeleton, arm.end);
      const bent = flexion(skeleton, worldRotations(character, pose, new Float32Array(character.bones * 4)), arm);
      const plane = offPlane(skeleton, worldRotations(character, pose, new Float32Array(character.bones * 4)), arm);
      const pole = [1, -0.35, 0];
      swivelLimb(character, pose, skeleton, worldRotations(character, pose, world), arm, pole[0]!, pole[1]!, pole[2]!);
      solveSkeleton(character, pose, skeleton);
      const now = worldRotations(character, pose, new Float32Array(character.bones * 4));
      expect(apart(joint(skeleton, arm.end), hand), clip).toBeLessThan(1e-4);
      expect(Math.abs(flexion(skeleton, now, arm) - bent), clip).toBeLessThan(1e-4);
      expect(Math.abs(offPlane(skeleton, now, arm) - plane), clip).toBeLessThan(0.05);
      // Off the line from the shoulder to the hand, the elbow points the way it was asked to.
      const s = joint(skeleton, arm.upper);
      const e = joint(skeleton, arm.lower);
      const line = [hand[0]! - s[0]!, hand[1]! - s[1]!, hand[2]! - s[2]!];
      const length = Math.hypot(line[0]!, line[1]!, line[2]!);
      const square = (v: number[]): number[] => {
        const along = (v[0]! * line[0]! + v[1]! * line[1]! + v[2]! * line[2]!) / (length * length);
        return [v[0]! - line[0]! * along, v[1]! - line[1]! * along, v[2]! - line[2]! * along];
      };
      const m = square([e[0]! - s[0]!, e[1]! - s[1]!, e[2]! - s[2]!]);
      const p = square(pole);
      const cos = (m[0]! * p[0]! + m[1]! * p[1]! + m[2]! * p[2]!) / (Math.hypot(m[0]!, m[1]!, m[2]!) * Math.hypot(p[0]!, p[1]!, p[2]!));
      expect(cos, clip).toBeGreaterThan(0.999);
    }
  });

  it('con el objetivo donde ya está la punta, nada cambia; y con la pala como punta, la muñeca queda como estaba', () => {
    const { pose, skeleton, world } = posed('derecha', 0.5);
    const arm = armOf(character, 'R');
    const racket = boneToCharacter(skeleton, character.bone('racket'), character.meta.racketCenter, [0, 0, 0]);
    const still = Float32Array.from(pose);
    reachLimb(character, pose, skeleton, world, arm, racket[0], racket[1], racket[2], racket);
    expect(same(pose, still, [arm.upper, arm.lower, arm.end])).toBe(true);
    // Toward the ball: the racket goes there, and the hand does not turn on its forearm.
    const wrist = [...pose.slice(arm.end * 4, arm.end * 4 + 4)];
    const target = [racket[0] + 0.12, racket[1] - 0.05, racket[2] + 0.08];
    reachLimb(character, pose, skeleton, world, arm, target[0]!, target[1]!, target[2]!, racket);
    solveSkeleton(character, pose, skeleton);
    expect(apart(boneToCharacter(skeleton, character.bone('racket'), character.meta.racketCenter, [0, 0, 0]), target)).toBeLessThan(0.002);
    expect(same(pose, Float32Array.from([...new Array<number>(arm.end * 4).fill(0), ...wrist]), [arm.end])).toBe(true);
  });

  it('la muñeca queda en su rango, y adentro no se toca; tampoco gira más rápido que una muñeca', () => {
    const racket = wristOf(character, 'R', true);
    const free = wristOf(character, 'L', false);
    let clamped = 0;
    for (const clip of Object.values(character.clips)) {
      for (let f = 0; f <= 20; f++) {
        const pose = samplePose(character, clip, (f / 20) * clip.dur, new Float32Array(character.poseSize));
        const skeleton = solveSkeleton(character, pose, createSkeleton(character));
        const before = measure(character, skeleton.rot);
        const original = Float32Array.from(pose);
        for (const wrist of [racket, free]) {
          wrist.held = 0;
          keepWrist(pose, wrist);
        }
        solveSkeleton(character, pose, skeleton);
        const after = measure(character, skeleton.rot);
        for (const arm of ['racket', 'free']) {
          const keys = ['flex', 'deviation', 'twist'].map((m) => `wrist.${arm}.${m}`);
          for (const key of keys) expect(excess(key, after[key]!, after, 'soft'), `${clip.name} ${key}`).toBe(0);
          const inside = keys.every((key) => excess(key, before[key]!, before, 'soft') === 0);
          const hand = character.bone(arm === 'racket' ? 'hand.R' : 'hand.L');
          // Well inside the range (each measure within six tenths of it), the hand is not touched.
          if (keys.every((key) => excess(key, before[key]! / 0.6, before, 'soft') === 0)) {
            expect(same(pose, original, [hand]), `${clip.name} ${arm}`).toBe(true);
          } else if (!inside) {
            clamped++;
          }
        }
      }
    }
    expect(clamped).toBeGreaterThan(50);
    // A hand that the clip flips half way round in one frame turns no faster than a wrist does.
    const wrist = wristOf(character, 'L', false);
    const pose = new Float32Array(character.poseSize);
    const hand = character.bone('hand.L') * 4;
    pose[hand + 3] = 1;
    keepWrist(pose, wrist, 1 / 60);
    pose.set([Math.sin(1.2), 0, 0, Math.cos(1.2)], hand);
    keepWrist(pose, wrist, 1 / 60);
    const turned = 2 * Math.acos(Math.min(1, Math.abs(pose[hand + 3]!)));
    expect(turned).toBeGreaterThan(20 * RAD);
    expect(turned).toBeLessThanOrEqual(WRIST_JUMP.hard * RAD);
  });

  it('el codo queda entre recto y doblado del todo, solo en su bisagra', () => {
    const elbow = elbowOf(character, 'R');
    const bone = elbow.bone * 4;
    for (const bent of [-30, -6, 0, 60, 140, 160, 175]) {
      const pose = new Float32Array(character.poseSize);
      // Bending the right elbow is a positive turn about z of the upper arm.
      pose.set([0, 0, Math.sin((bent * RAD) / 2), Math.cos((bent * RAD) / 2)], bone);
      keepElbow(pose, elbow);
      const skeleton = solveSkeleton(character, pose, createSkeleton(character));
      const m = measure(character, skeleton.rot);
      expect(m['elbow.racket.flex']!, `${bent}°`).toBeCloseTo(Math.min(145, Math.max(-4, bent)), 3);
      expect(Math.abs(m['elbow.racket.off']!)).toBeLessThan(1e-3);
    }
  });
});
