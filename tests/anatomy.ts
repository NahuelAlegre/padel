/**
 * Measuring a body: the angle of every joint of a solved skeleton, and how
 * far that is from what a person's joint does. For `anatomy.test.ts`, and as
 * the rule `docs/investigacion-anatomia.md` (section 6) sets.
 *
 * Every joint is measured as the turn of a bone from its parent's, split into
 * a twist about the bone and a swing of it (swing-twist), from the rest pose
 * of the skeleton: the T pose, arms out, palms down, thumbs forward, elbows
 * back. The right side is mirrored so that both sides read the same. Degrees.
 *
 * It does not use the game's own code for joints (`reach.ts`), so that it
 * measures it and does not agree with it by construction.
 */
import { CAST } from '../src/characters/cast';
import { asPartner, withAttitude } from '../src/characters/style';
import { createConfig, FORMATS, SIM_DT, type RivalId } from '../src/config';
import { AIController } from '../src/control/ai';
import { createScene, fillScene, type SceneOptions } from '../src/app/scene';
import { Rng } from '../src/core/rng';
import { InputState } from '../src/input/state';
import { figureScale } from '../src/render/stage/camera';
import { FigureAnimator, type Moment as AnimatorMoment } from '../src/render/toon/animator';
import { styleOf, type Character } from '../src/render/toon/character';
import { Match, type PlayerEntry } from '../src/sim/match';
import type { Attitude } from '../src/sim/pair';
import { Scan, SITUATIONS, type Moment } from '../src/studio/situations';
import { defaultSettings, partnerAttitude, RIVALS } from '../src/ui/settings';

const DEG = 180 / Math.PI;
type Q = [number, number, number, number];
export type Measures = Record<string, number>;

/** What a person's joints do: [least, most] that is expected (soft) and that is never seen (hard). Degrees. */
export interface Limit {
  soft: [number, number];
  hard: [number, number];
  /** In words, for a message. */
  what: string;
}

/**
 * The limits, by measure without its side. Section 6 of the research: soft
 * is what a person does, hard what should never be seen, not for a frame.
 * The wrist of the racket hand is measured as if the handle crossed the palm
 * on a slant, the way a racket is held: the model holds it square, like a
 * hammer, which alone would put that wrist 45° out of range in any pose.
 */
export const LIMITS: Record<string, Limit> = {
  'wrist.flex': { soft: [-65, 75], hard: [-70, 80], what: 'muñeca: extensión / flexión' },
  'wrist.deviation': { soft: [-20, 35], hard: [-25, 40], what: 'muñeca: desvío radial / cubital' },
  'wrist.twist': { soft: [-85, 80], hard: [-90, 85], what: 'antebrazo y muñeca: supinación / pronación' },
  'elbow.flex': { soft: [-5, 145], hard: [-8, 150], what: 'codo: hiperextensión / flexión' },
  'elbow.off': { soft: [-5, 5], hard: [-10, 10], what: 'codo: fuera de su plano' },
  'elbow.twist': { soft: [-5, 5], hard: [-10, 10], what: 'codo: giro sobre el antebrazo' },
  'shoulder.horizontal': { soft: [-40, 130], hard: [-45, 140], what: 'hombro: detrás del plano del cuerpo / cruzando' },
  'hip.flexion': { soft: [-20, 125], hard: [-30, 130], what: 'cadera: extensión / flexión' },
  'hip.abduction': { soft: [-25, 50], hard: [-30, 60], what: 'cadera: aducción / abducción' },
  'hips.spread': { soft: [0, 100], hard: [0, 110], what: 'ángulo entre los muslos' },
  'knee.flex': { soft: [-3, 145], hard: [-5, 150], what: 'rodilla: hiperextensión / flexión' },
  'knee.off': { soft: [-5, 5], hard: [-10, 10], what: 'rodilla: fuera de su plano' },
  'ankle.dorsi': { soft: [-50, 35], hard: [-60, 40], what: 'tobillo: flexión plantar / dorsal' },
  'trunk.twist': { soft: [-55, 55], hard: [-65, 65], what: 'tronco: giro de hombros contra cadera' },
};

/** A wrist that turns more than this between two frames at 60 a second (degrees) is flipping, not swinging. */
export const WRIST_JUMP = { soft: 20, hard: 30 };

/** The measure a key is measured against: `wrist.racket.flex` is a `wrist.flex`. */
export function limitOf(key: string): Limit | undefined {
  const parts = key.split('.');
  return LIMITS[parts.length === 3 ? `${parts[0]}.${parts[2]}` : key];
}

/**
 * How far a measure is beyond its range (0 within it), in degrees. The
 * direction of the upper arm goes round: what is beyond «across» and beyond
 * «behind» is the same arc, at the back, and it is measured to the nearer
 * end. And it only counts with the arm near the horizontal: raised or down,
 * «behind the body» means nothing.
 */
export function excess(key: string, value: number, all: Measures, which: 'soft' | 'hard'): number {
  const limit = limitOf(key);
  if (!limit) return 0;
  const [lo, hi] = limit[which];
  if (key.startsWith('shoulder.')) {
    const elevation = all[`shoulder.${key.split('.')[1]}.elevation`] ?? 0;
    if (elevation < -50 || elevation > 70) return 0;
    const past = (((value - hi) % 360) + 360) % 360;
    const gap = 360 - (hi - lo);
    return past > 0 && past < gap ? Math.min(past, gap - past) : 0;
  }
  return value < lo ? lo - value : value > hi ? value - hi : 0;
}

/** The turn of `child` from `parent` (rotations by rows, as the skeleton has them); mirrored (x to -x) for the right side. */
export function relative(rot: ArrayLike<number>, parent: number, child: number, mirror: boolean): Q {
  const p = parent * 9;
  const c = child * 9;
  const m = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += rot[p + k * 3 + i]! * rot[c + k * 3 + j]!;
      m[i * 3 + j] = s;
    }
  }
  if (mirror) {
    m[1] = -m[1]!;
    m[2] = -m[2]!;
    m[3] = -m[3]!;
    m[6] = -m[6]!;
  }
  return fromMatrix(m);
}

function fromMatrix(m: number[]): Q {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m as [number, number, number, number, number, number, number, number, number];
  const trace = m00 + m11 + m22;
  let q: Q;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
}

function multiply(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** The twist about one axis of the bone (0 x, 2 z) and the swing that is left, as a rotation vector. Degrees. */
export function swingTwist(q: Q, axis: 0 | 2): { twist: number; swing: [number, number, number] } {
  const n = Math.hypot(q[axis], q[3]);
  const twist: Q = [0, 0, 0, 1];
  if (n > 1e-9) {
    twist[axis] = q[axis] / n;
    twist[3] = q[3] / n;
  }
  let angle = 2 * Math.atan2(twist[axis], twist[3]);
  if (angle > Math.PI) angle -= 2 * Math.PI;
  if (angle < -Math.PI) angle += 2 * Math.PI;
  let swing = multiply(q, [-twist[0], -twist[1], -twist[2], twist[3]]);
  if (swing[3] < 0) swing = [-swing[0], -swing[1], -swing[2], -swing[3]];
  const sn = Math.hypot(swing[0], swing[1], swing[2]);
  const k = sn > 1e-9 ? (2 * Math.atan2(sn, swing[3])) / sn : 0;
  return { twist: angle * DEG, swing: [swing[0] * k * DEG, swing[1] * k * DEG, swing[2] * k * DEG] };
}

/** An axis of a bone, in the axes of another; mirrored for the right side. */
function axisIn(rot: ArrayLike<number>, frame: number, bone: number, local: [number, number, number], mirror: boolean): [number, number, number] {
  const b = bone * 9;
  const v = [0, 1, 2].map((r) => rot[b + r * 3]! * local[0] + rot[b + r * 3 + 1]! * local[1] + rot[b + r * 3 + 2]! * local[2]);
  const f = frame * 9;
  const u: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) u[c] = rot[f + c]! * v[0]! + rot[f + 3 + c]! * v[1]! + rot[f + 6 + c]! * v[2]!;
  if (mirror) u[0] = -u[0];
  return u;
}

/** How the handle crosses the palm of a player: 45° from the model's hammer grip, toward the little finger. */
const GRIP: Q = [0, 0, Math.sin((-45 / 2) * (Math.PI / 180)), Math.cos((-45 / 2) * (Math.PI / 180))];

/** Every joint of a solved skeleton (rotations by rows), in degrees. */
export function measure(character: Character, rot: ArrayLike<number>): Measures {
  const bone = (name: string): number => character.bone(name);
  const out: Measures = {};
  for (const [s, mirror] of [
    ['L', false],
    ['R', true],
  ] as const) {
    // The racket is in the right hand.
    const arm = s === 'R' ? 'racket' : 'free';
    // The wrist: the hand from the forearm. Its twist about the forearm is pronation (+) and supination (-).
    let wrist = relative(rot, bone(`forearm.${s}`), bone(`hand.${s}`), mirror);
    if (s === 'R') wrist = multiply(wrist, GRIP);
    const w = swingTwist(wrist, 0);
    out[`wrist.${arm}.flex`] = w.swing[1];
    out[`wrist.${arm}.deviation`] = w.swing[2];
    out[`wrist.${arm}.twist`] = w.twist;
    // The elbow: the forearm from the upper arm. Bending is a negative swing about z; past half a turn
    // backward it is read as bent, since an elbow never opens that far.
    const e = swingTwist(relative(rot, bone(`upper_arm.${s}`), bone(`forearm.${s}`), mirror), 0);
    const bent = -e.swing[2];
    out[`elbow.${arm}.flex`] = bent < -90 ? bent + 360 : bent;
    out[`elbow.${arm}.off`] = e.swing[1];
    out[`elbow.${arm}.twist`] = e.twist;
    // The shoulder: where the upper arm points, in the axes of the chest.
    const u = axisIn(rot, bone('chest'), bone(`upper_arm.${s}`), [mirror ? -1 : 1, 0, 0], mirror);
    out[`shoulder.${arm}.elevation`] = Math.asin(Math.max(-1, Math.min(1, u[2]))) * DEG;
    // 0 to the side, 90 forward, 180 across, below 0 behind (see `excess`: it goes round).
    out[`shoulder.${arm}.horizontal`] = Math.atan2(-u[1], u[0]) * DEG;
    // The hip: where the thigh points, in the axes of the pelvis.
    const t = axisIn(rot, bone('hips'), bone(`thigh.${s}`), [0, 0, -1], mirror);
    out[`hip.${s}.abduction`] = Math.asin(Math.max(-1, Math.min(1, t[0]))) * DEG;
    out[`hip.${s}.flexion`] = Math.atan2(-t[1], -t[2]) * DEG;
    // The knee: the shin from the thigh, about the shin.
    const k = swingTwist(relative(rot, bone(`thigh.${s}`), bone(`shin.${s}`), mirror), 2);
    out[`knee.${s}.flex`] = k.swing[0];
    out[`knee.${s}.off`] = k.swing[1];
    // The ankle: the foot from the shin. Bending it up is a negative swing about x.
    out[`ankle.${s}.dorsi`] = -swingTwist(relative(rot, bone(`shin.${s}`), bone(`foot.${s}`), mirror), 2).swing[0];
  }
  const left = axisIn(rot, bone('hips'), bone('thigh.L'), [0, 0, -1], false);
  const right = axisIn(rot, bone('hips'), bone('thigh.R'), [0, 0, -1], false);
  out['hips.spread'] = Math.acos(Math.max(-1, Math.min(1, left[0] * right[0] + left[1] * right[1] + left[2] * right[2]))) * DEG;
  out['trunk.twist'] = swingTwist(relative(rot, bone('hips'), bone('chest'), false), 2).twist;
  return out;
}

/** The measures with a limit. */
export const MEASURED = [
  ...['free', 'racket'].flatMap((arm) => ['wrist.flex', 'wrist.deviation', 'wrist.twist', 'elbow.flex', 'elbow.off', 'elbow.twist', 'shoulder.horizontal'].map((m) => m.replace('.', `.${arm}.`))),
  ...['L', 'R'].flatMap((side) => ['hip.abduction', 'hip.flexion', 'knee.flex', 'knee.off', 'ankle.dorsi'].map((m) => m.replace('.', `.${side}.`))),
  'hips.spread',
  'trunk.twist',
];

/** How far a hand turned on its forearm between two skeletons (degrees): no split, the whole turn. */
export function wristStep(character: Character, before: ArrayLike<number>, after: ArrayLike<number>, side: 'L' | 'R'): number {
  const a = relative(before, character.bone(`forearm.${side}`), character.bone(`hand.${side}`), side === 'R');
  const b = relative(after, character.bone(`forearm.${side}`), character.bone(`hand.${side}`), side === 'R');
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot)) * DEG;
}

// ---------------------------------------------------------------- where the animator is watched

/** The demo of the animation studio: doubles, the reach of a real person, everything else as somebody who never touched the options (see `Game.startFixedDemo`). */
export function studioDemo(seed: number): { match: Match; lineup: Array<RivalId | null> } {
  const config = createConfig();
  config.rules.format = { ...FORMATS.quick };
  config.player.realReach = true;
  const settings = defaultSettings(false);
  const ai = (id: RivalId, offset: number, partner = false, attitude?: Attitude): PlayerEntry => {
    const who = CAST[id];
    let level = config.rivals[id];
    if (partner) level = asPartner(level);
    if (attitude) level = withAttitude(level, attitude);
    return {
      name: who.name,
      isHuman: false,
      manual: false,
      speedFactor: level.speedFactor,
      reaction: level.reaction,
      errorScale: level.errorScale,
      reachScale: 1,
      hand: who.hand,
      wallBias: level.wallBias,
      holdNet: level.holdNet,
      composure: level.composure,
      reading: level.smart,
      attitude,
      controller: new AIController(level, new Rng(seed + offset)),
    };
  };
  const partner = settings.partner;
  const [rivalA, rivalB] = RIVALS.filter((id) => id !== partner) as [RivalId, RivalId];
  const mate = ai(partner, 3, true, partnerAttitude(settings, partner));
  const rival = (id: RivalId, offset: number): PlayerEntry => ai(id, offset, false, CAST[id].attitude);
  const me: PlayerEntry = { ...rival(settings.rival, 4), name: 'Vos' };
  const reves = settings.side === 'reves';
  const lineup: Array<RivalId | null> = reves ? [partner, null, rivalA, rivalB] : [null, partner, rivalA, rivalB];
  const match = new Match({
    config,
    seed,
    teams: [
      { name: 'A', players: reves ? [mate, me] : [me, mate] },
      { name: 'B', players: [rival(rivalA, 1), rival(rivalB, 2)] },
    ],
  });
  return { match, lineup };
}

/** Every situation of the studio that comes from play, found as the studio finds them (the same seeds, the same scan). */
export function studioMoments(): Array<{ key: string; moment: Moment; lineup: Array<RivalId | null> }> {
  const found = new Map<string, { moment: Moment; lineup: Array<RivalId | null> }>();
  const real = SITUATIONS.filter((situation) => situation.source === 'real');
  for (const seed of [7, 1, 2, 3, 4, 5]) {
    const { match, lineup } = studioDemo(seed);
    const scan = new Scan(match, 240);
    while (!scan.done) scan.run(1000);
    for (const [key, moment] of scan.found) {
      const old = found.get(key);
      if (!old || old.moment.score < moment.score) found.set(key, { moment, lineup });
    }
    if (real.every((situation) => found.has(Scan.key(situation.id, true)) || found.has(Scan.key(situation.id, false)))) break;
  }
  return [...found].map(([key, value]) => ({ key, ...value }));
}

/** A frame of somebody's body: who, which situation and when, where on the court, and the skeleton. */
export interface BodyFrame {
  where: string;
  who: string;
  eta: number;
  x: number;
  y: number;
  rot: Float32Array;
  /** Where the racket and the ball were, right at a contact of this player's (court metres), or null. */
  contact: { racket: [number, number, number]; ball: [number, number, number] } | null;
}

/**
 * Plays a match on from where it is, frame by frame at 60 a second, as the
 * game draws it, for `seconds`, and hands every frame of the body of player
 * `only` (as the studio shows it), or of every player, to `see`.
 */
export function watch(character: Character, match: Match, lineup: Array<RivalId | null>, seconds: number, where: string, see: (frame: BodyFrame) => void, only = -1): void {
  const scene = createScene();
  const input = new InputState();
  const cast = lineup.map((id) => (id ? CAST[id] : null));
  const options: SceneOptions = { aids: 'minimal', aidStrength: 1, reduceMotion: false, debug: false, cueLead: 0, tutorial: null, cast, acts: cast.map(() => null) };
  const names = lineup.map((id) => id ?? 'jugador');
  const animators = names.map((name) => new FigureAnimator(character, styleOf(character, name)));
  const moment: AnimatorMoment = { rivalHitIn: Infinity, holding: false, resting: false };
  const racket: [number, number, number] = [0, 0, 0];
  let accumulator = 0;
  const end = match.time + seconds;
  for (let frame = 0; match.time < end && match.phase !== 'matchOver'; frame++) {
    const dt = frame === 0 ? 0 : 1 / 60;
    accumulator += dt;
    const hits: Array<{ player: number; x: number; y: number; z: number }> = [];
    while (accumulator >= SIM_DT) {
      match.step();
      for (const event of match.events) if (event.type === 'hit' && event.kind !== 'serve') hits.push(event);
      match.events.length = 0;
      accumulator -= SIM_DT;
    }
    fillScene(scene, match, accumulator / SIM_DT, input, options);
    const serving = scene.ball.held ? scene.serving : -1;
    moment.resting = !scene.ball.live && scene.serving < 0;
    scene.players.forEach((who, i) => {
      if (only >= 0 && i !== only) return;
      const animator = animators[i]!;
      moment.rivalHitIn = Infinity;
      for (const other of scene.players) if (other.team !== who.team && other.anim !== 'idle' && other.contactIn > 0) moment.rivalHitIn = Math.min(moment.rivalHitIn, other.contactIn);
      moment.holding = serving === i;
      const k = figureScale(who.y) * (animator.style?.size ?? 1);
      const facing = who.team === 0 ? 1 : -1;
      animator.update(who, k, facing, scene.ball, dt, moment);
      const hit = hits.find((h) => h.player === i);
      if (hit) animator.racketOnCourt(k, facing, racket);
      see({
        where,
        who: names[i]!,
        eta: who.contactIn,
        x: who.x,
        y: who.y,
        rot: animator.skeleton.rot,
        contact: hit ? { racket: [...racket], ball: [hit.x, hit.y, hit.z] } : null,
      });
    });
  }
}
