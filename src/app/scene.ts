import { SIM_DT } from '../config';
import { lerp } from '../core/math';
import type { InputState } from '../input/state';
import { teamDir } from '../sim/court';
import type { Match } from '../sim/match';
import type { Player } from '../sim/player';
import { resolveShot, serveTarget, type ShotContext } from '../sim/shots';
import { pointAt } from '../sim/trajectory';
import type { ShotIntent } from '../sim/types';
import {
  createPointerFeedback,
  type PointerFeedback,
  type Scene,
  type SceneAim,
  type ScenePlayer,
  type SceneTutorial,
} from '../render/scene';

export interface SceneOptions {
  bounceMarker: boolean;
  timingAid: boolean;
  positionGuide: boolean;
  reduceMotion: boolean;
  debug: boolean;
  /** How much earlier than the real contact the timing ring closes, in seconds. */
  cueLead: number;
  tutorial: SceneTutorial | null;
}

export function createScene(pointer: PointerFeedback = createPointerFeedback()): Scene {
  return {
    time: 0,
    ball: { x: 0, y: 0, z: 0, visible: true },
    players: [],
    bounce: null,
    contact: null,
    aim: null,
    guide: null,
    tutorial: null,
    heat: 0,
    pointer,
    reduceMotion: false,
    debug: false,
  };
}

const bounce = { x: 0, y: 0, eta: 0, first: true };
const contact = { x: 0, y: 0, z: 0, eta: 0, perfect: 0, good: 0 };
const aim: SceneAim = { x: 0, y: 0, kind: 'drive', forehand: true, risk: 0, armed: false };
const guide = { x: 0, y: 0 };
const intent: ShotIntent = { aim: 0, depth: 0.6, lob: false, power: 1 };
const context: ShotContext = {
  team: 0,
  hand: 1,
  playerX: 0,
  playerY: 0,
  ballX: 0,
  ballY: 0,
  ballZ: 0,
  bounces: 1,
  walls: 0,
};

/**
 * Fills `scene` with the state of the match between its last two steps.
 * `alpha` is how far into the current step the frame falls (0..1): the
 * simulation runs at a fixed rate and the screen at its own, so positions
 * are blended to keep the motion smooth at any refresh rate.
 */
export function fillScene(
  scene: Scene,
  match: Match,
  alpha: number,
  input: InputState,
  options: SceneOptions,
): void {
  const time = match.time - (1 - alpha) * SIM_DT;
  scene.time = time;
  scene.reduceMotion = options.reduceMotion;
  scene.debug = options.debug;
  scene.tutorial = options.tutorial;
  scene.heat = match.config.rules.heatMax > 0 ? match.heat / match.config.rules.heatMax : 0;

  scene.ball.x = lerp(match.ballPrev.x, match.ball.x, alpha);
  scene.ball.y = lerp(match.ballPrev.y, match.ball.y, alpha);
  scene.ball.z = lerp(match.ballPrev.z, match.ball.z, alpha);
  scene.ball.visible = true;

  let human: Player | null = null;
  for (let i = 0; i < match.players.length; i++) {
    const player = match.players[i]!;
    if (player.isHuman && !human) human = player;
    let out: ScenePlayer | undefined = scene.players[i];
    const x = lerp(player.px, player.x, alpha);
    const y = lerp(player.py, player.y, alpha);
    if (!out) {
      out = {
        id: player.id,
        team: player.team,
        isHuman: player.isHuman,
        x,
        y,
        vx: 0,
        vy: 0,
        stride: 0,
        anim: 'idle',
        animPhase: 0,
        animSide: 1,
        restSide: 1,
        shot: 'drive',
        reachX: 0,
        reachY: 0,
        reachZ: 0,
      };
      scene.players[i] = out;
    }
    // Distance covered since the last frame drives the run cycle.
    const moved = Math.hypot(x - out.x, y - out.y);
    out.stride = moved < 2 ? out.stride + moved : 0;
    out.id = player.id;
    out.team = player.team;
    out.isHuman = player.isHuman;
    out.x = x;
    out.y = y;
    out.vx = player.vx;
    out.vy = player.vy;
    const anim = player.anim;
    out.anim = anim.kind;
    out.animPhase = anim.duration > 0 ? (time - anim.t0) / anim.duration : 1;
    out.animSide = anim.side;
    out.restSide = (player.hand * teamDir(player.team)) as 1 | -1;
    out.shot = anim.shot;
    out.reachX = anim.reachX;
    out.reachY = anim.reachY;
    out.reachZ = anim.reachZ;
  }
  scene.players.length = match.players.length;

  // Where the ball lands next. After the first bounce the mark moves on to
  // the next one, so it keeps following the ball when it comes off a wall.
  scene.bounce = null;
  const trajectory = match.trajectory;
  if (options.bounceMarker && match.rally.live && trajectory) {
    for (let i = 0; i < trajectory.bounces.length; i++) {
      const next = trajectory.bounces[i]!;
      if (next.t <= time) continue;
      bounce.x = next.x;
      bounce.y = next.y;
      bounce.eta = next.t - time;
      bounce.first = i === 0;
      scene.bounce = bounce;
      break;
    }
  }

  scene.contact = null;
  scene.guide = null;
  scene.aim = null;
  if (!human) return;

  // Where and when the person meets the ball.
  const plan = human.plan;
  if (options.timingAid && plan) {
    contact.x = plan.x;
    contact.y = plan.y;
    contact.z = plan.z;
    contact.eta = plan.t - options.cueLead - time;
    contact.perfect = match.config.timing.perfect;
    contact.good = match.config.timing.good;
    scene.contact = contact;
  }

  // Where it would be best to stand. Shown only while it is some way off.
  const advice = human.guide;
  if (options.positionGuide && human.manual && advice) {
    const away = Math.hypot(advice.stanceX - human.x, advice.stanceY - human.y);
    if (away > 0.45) {
      guide.x = advice.stanceX;
      guide.y = advice.stanceY;
      scene.guide = guide;
    }
  }

  // Where the person is aiming: the thumb that is down, or the armed shot.
  const dir = teamDir(human.team);
  let armed = false;
  let asked: ShotIntent | null = null;
  if (input.aim.active) {
    intent.aim = input.aim.aim * dir;
    intent.depth = input.aim.depth;
    intent.lob = input.aim.lob;
    asked = intent;
  } else if (human.swing) {
    asked = human.swing.intent;
    armed = true;
  }
  if (!asked) return;

  const serving = (match.phase === 'serve' || match.phase === 'windup') && match.serverId === human.id;
  if (serving) {
    const target = serveTarget(human.team, match.serveBox(), asked, match.config);
    aim.x = target.x;
    aim.y = target.y;
    aim.kind = 'serve';
    aim.forehand = true;
    aim.risk = 0;
    aim.armed = match.phase === 'windup';
    scene.aim = aim;
    return;
  }
  if (match.phase !== 'rally') return;

  // The shot depends on the ball that will be hit. With one within reach it
  // is that one; otherwise a plain ball at a comfortable height stands in.
  context.team = human.team;
  context.hand = human.hand;
  context.playerX = human.x;
  context.playerY = human.y;
  const point = plan && trajectory ? pointAt(trajectory, plan.t) : null;
  if (plan && point) {
    context.ballX = plan.x;
    context.ballY = plan.y;
    context.ballZ = plan.z;
    context.bounces = point.bounces;
    context.walls = point.walls;
  } else {
    context.ballX = human.x + human.hand * dir * 0.6;
    context.ballY = human.y + dir * 0.2;
    context.ballZ = 0.9;
    context.bounces = 1;
    context.walls = 0;
  }
  const shot = resolveShot(context, asked, match.config);
  aim.x = shot.targetX;
  aim.y = shot.targetY;
  aim.kind = shot.kind;
  aim.forehand = shot.forehand;
  aim.risk = shot.risk;
  aim.armed = armed;
  scene.aim = aim;
}
