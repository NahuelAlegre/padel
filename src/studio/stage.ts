import type { MannerismClip } from '../characters/types';
import type { Scene, ScenePlayer } from '../render/scene';

/**
 * What the demo never shows, staged: one player moved by hand, frame by
 * frame, over a court where everybody else waits for a serve. The same
 * renderer draws it, so it looks as it would in a match; only the play
 * around it is made up.
 */
export interface Staged {
  /** Seconds the loop lasts, and the key instant inside it. */
  readonly length: number;
  readonly key: number;
  /** Puts the staged player and the ball where they are `t` seconds into the loop. `from` is the `t` of the frame before. */
  at(scene: Scene, t: number, from: number, react: (player: number, well: boolean) => void): void;
  /** A few words about what is on show at `t`. */
  note(t: number): string;
}

/** The run: how fast, when the ball is met, and how far to the side of the racket and ahead of the feet. */
const RUN = { speed: 4, contact: 0.7, length: 1.6, out: 1.3, ahead: 0.3, height: 0.7, stop: 0.3 };
/** An ordinary forehand in place: when, and where the ball is met. */
const SWING = { contact: 0.7, length: 2.4, reachX: 0.62, reachY: 0.2, reachZ: 0.85, follow: 0.45, sorry: 0.3 };
/** The tics, each this long, with this much stillness after it. */
const TIC = { duration: 0.9, gap: 0.6 };
const TICS: Array<[MannerismClip, string]> = [
  ['cap', 'la gorra'],
  ['whistle', 'silbido'],
  ['sleeves', 'las mangas'],
  ['shoeTap', 'la zapatilla'],
  ['neck', 'el cuello'],
  ['glasses', 'los anteojos'],
  ['wave', 'saludo'],
  ['kissRacket', 'beso a la pala'],
];

/** Nobody else is doing anything: the ball is the staged one. */
function clear(scene: Scene): void {
  scene.serving = -1;
  scene.bounce = null;
  scene.contact = null;
  scene.aim = null;
  scene.guide = null;
  scene.tutorial = null;
}

/** The ball comes from the other side to where it is met and goes back, a little higher each way. */
function ball(scene: Scene, x: number, y: number, z: number, side: number, facing: number, t: number): void {
  const away = Math.abs(t);
  Object.assign(scene.ball, {
    x: x - side * t * 0.8,
    y: y + facing * away * 11,
    z: z + away * 0.9,
    vx: -side * 0.8,
    vy: facing * (t < 0 ? -11 : 11),
    vz: t < 0 ? -0.9 : 0.9,
    visible: true,
    held: false,
    live: true,
  });
}

function still(who: ScenePlayer): void {
  who.vx = 0;
  who.vy = 0;
  who.anim = 'idle';
  who.animPhase = 0;
  who.contactIn = Infinity;
  who.tell = null;
  who.call = null;
  who.why = null;
  who.surprise = 0;
  who.tension = 0;
  who.stealing = false;
}

/**
 * The last stride of a run toward a ball out of reach becomes a lunge: it
 * runs across the court at 4 m/s and meets a ball 1.3 m to the side of its
 * racket, then stops. The computer stops to hit, so the demo never has it.
 */
export function stagedRun(base: Scene, index: number): Staged {
  const who = base.players[index]!;
  const facing = who.team === 0 ? 1 : -1;
  const side = who.restSide;
  // Back in its own half, running toward the side of its racket, the ball well inside the court.
  const y0 = -facing * 7.5;
  const path: Array<{ x: number; y: number; vx: number; vy: number; stride: number }> = [];
  const frames = Math.ceil(RUN.length * 60) + 1;
  let x = side * 2.6 - side * RUN.speed * 0.96 * RUN.contact;
  let y = y0;
  let stride = 0;
  for (let f = 0; f <= frames; f++) {
    const t = f / 60 - RUN.contact;
    const speed = RUN.speed * (t <= 0 ? 1 : Math.max(0, 1 - t / RUN.stop));
    const vx = side * speed * 0.96;
    const vy = facing * speed * 0.28;
    path.push({ x, y, vx, vy, stride });
    x += vx / 60;
    y += vy / 60;
    stride += Math.hypot(vx, vy) / 60;
  }
  const at = path[Math.round(RUN.contact * 60)]!;
  const target = [at.x + side * RUN.out, at.y + facing * RUN.ahead, RUN.height] as const;
  return {
    length: RUN.length,
    key: RUN.contact,
    at(scene, t) {
      clear(scene);
      const p = path[Math.min(path.length - 1, Math.max(0, Math.round(t * 60)))]!;
      const me = scene.players[index]!;
      still(me);
      Object.assign(me, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, stride: p.stride, shot: 'drive', animSide: side });
      const since = t - RUN.contact;
      if (since < 0.45) {
        me.anim = 'swing';
        me.animPhase = since <= 0 ? -1 : since / 0.45;
        me.contactIn = -since;
      }
      me.reachX = target[0] - p.x;
      me.reachY = target[1] - p.y;
      me.reachZ = target[2];
      ball(scene, target[0], target[1], target[2], side, facing, since);
    },
    note: () => 'corre a 4 m/s, pelota a 1,3 m',
  };
}

/**
 * A ball stolen from the partner: an ordinary forehand in place and, a moment
 * after it, the short «¡vamos!» if it went well or the «perdón» if it did not.
 * For when the demo has none: they are rare in it.
 */
export function stagedSteal(base: Scene, index: number, well: boolean): Staged {
  const who = base.players[index]!;
  const facing = who.team === 0 ? 1 : -1;
  const side = who.restSide;
  const x0 = who.x;
  const y0 = who.y;
  const target = [x0 + side * SWING.reachX, y0 + facing * SWING.reachY, SWING.reachZ] as const;
  return {
    length: SWING.length,
    key: SWING.contact,
    at(scene, t, from, react) {
      clear(scene);
      const me = scene.players[index]!;
      still(me);
      Object.assign(me, { x: x0, y: y0, shot: 'drive', animSide: side });
      const since = t - SWING.contact;
      if (since < SWING.follow) {
        me.anim = 'swing';
        me.animPhase = since <= 0 ? -1 : since / SWING.follow;
        me.contactIn = -since;
      }
      me.reachX = target[0] - x0;
      me.reachY = target[1] - y0;
      me.reachZ = target[2];
      ball(scene, target[0], target[1], target[2], side, facing, since);
      const when = SWING.contact + SWING.sorry;
      if (from < when && t >= when) react(index, well);
    },
    note: (t) => (t < SWING.contact + SWING.sorry ? 'golpe común' : well ? 'salió bien' : '«perdón» al compañero'),
  };
}

/** The tics between points, one after the other, while it waits. */
export function stagedTics(base: Scene, index: number): Staged {
  const who = base.players[index]!;
  const x0 = who.x;
  const y0 = who.y;
  const each = TIC.duration + TIC.gap;
  const which = (t: number): number => Math.min(TICS.length - 1, Math.floor(t / each));
  return {
    length: each * TICS.length,
    key: TIC.duration / 2,
    at(scene, t) {
      clear(scene);
      scene.ball.visible = false;
      scene.ball.live = false;
      const me = scene.players[index]!;
      still(me);
      me.x = x0;
      me.y = y0;
      const into = t - which(t) * each;
      me.act = into < TIC.duration ? { clip: TICS[which(t)]![0], t: into, duration: TIC.duration } : null;
    },
    note: (t) => TICS[which(t)]![1],
  };
}
