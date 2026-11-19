import type { Character } from '../characters/types';
import { SIM_DT } from '../config';
import { lerp } from '../core/math';
import type { InputState } from '../input/state';
import { teamDir } from '../sim/court';
import type { Match } from '../sim/match';
import type { Player } from '../sim/player';
import { backpedalOf } from '../sim/pressure';
import { resolveShot, serveTarget, type ShotContext } from '../sim/shots';
import { pointAt } from '../sim/trajectory';
import type { ShotIntent } from '../sim/types';
import {
  createPointerFeedback,
  type AidLevel,
  type PointerFeedback,
  type Scene,
  type SceneAct,
  type SceneAim,
  type SceneCall,
  type ScenePlayer,
  type SceneTell,
  type SceneTutorial,
} from '../render/scene';

export interface SceneOptions {
  /** How much help is on screen. */
  aids: AidLevel;
  /** 0..1: with the minimal aids, how much of them is left. They fade as the person gets it right. */
  aidStrength: number;
  reduceMotion: boolean;
  debug: boolean;
  /** How much earlier than the real contact the timing signal peaks, in seconds. */
  cueLead: number;
  tutorial: SceneTutorial | null;
  /** Show where to stand, whatever the level of help: a lesson, or a ball worth letting go to the glass. */
  guide?: boolean;
  /** Keep marking where the ball lands after its first bounce, whatever the level of help. */
  follow?: boolean;
  /** Who each player of the match is, by position in `match.players`. Null for nobody in particular. */
  cast: Array<Character | null>;
  /** The tic each of them is in the middle of, if any. */
  acts: Array<SceneAct | null>;
}

export function createScene(pointer: PointerFeedback = createPointerFeedback()): Scene {
  return {
    time: 0,
    ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, visible: true, held: false, live: false },
    players: [],
    serving: -1,
    aids: 'minimal',
    aidStrength: 1,
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
/** One per player, reused: what its windup is giving away. */
const tells: SceneTell[] = [];
/** One per player, reused: what it is telling its partner. */
const calls: SceneCall[] = [];
/** Seconds a call is shown for. */
const CALL_SHOWS = 0.9;
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
  pressure: 0,
  backpedal: 0,
};

/**
 * Fills `scene` with the state of the match between its last two steps.
 * `alpha` is how far into the current step the frame falls (0..1): the
 * simulation runs at a fixed rate and the screen at its own, so positions
 * are blended to keep the motion smooth at any refresh rate.
 *
 * This is also where the screen is kept clean. What help exists at each level
 * is decided here, once, for any renderer:
 *
 *   minimal   one timing signal, the first bounce of a ball coming to the
 *             person's side, and where the thumb is aiming while it is down
 *   full      everything: every bounce, the timing windows, where to stand,
 *             the aim with its scatter, for whoever wants or needs it
 *   none      nothing
 */
export function fillScene(
  scene: Scene,
  match: Match,
  alpha: number,
  input: InputState,
  options: SceneOptions,
): void {
  const time = match.time - (1 - alpha) * SIM_DT;
  const level = options.aids;
  scene.time = time;
  scene.reduceMotion = options.reduceMotion;
  scene.debug = options.debug;
  scene.tutorial = options.tutorial;
  scene.aids = level;
  scene.aidStrength = level === 'minimal' ? options.aidStrength : 1;
  scene.heat = match.config.rules.heatMax > 0 ? match.heat / match.config.rules.heatMax : 0;

  const held = match.phase === 'serve' || match.ballHeld;
  scene.ball.x = lerp(match.ballPrev.x, match.ball.x, alpha);
  scene.ball.y = lerp(match.ballPrev.y, match.ball.y, alpha);
  scene.ball.z = lerp(match.ballPrev.z, match.ball.z, alpha);
  scene.ball.vx = match.ball.vx;
  scene.ball.vy = match.ball.vy;
  scene.ball.vz = match.ball.vz;
  scene.ball.visible = true;
  scene.ball.held = held;
  scene.ball.live = match.rally.live;
  scene.serving = held || match.phase === 'windup' ? match.serverId : -1;

  let human: Player | null = null;
  let humanOut: ScenePlayer | null = null;
  for (let i = 0; i < match.players.length; i++) {
    const player = match.players[i]!;
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
        contactIn: Infinity,
        animSide: 1,
        restSide: 1,
        shot: 'drive',
        reachX: 0,
        reachY: 0,
        reachZ: 0,
        character: null,
        tell: null,
        act: null,
        call: null,
      };
      scene.players[i] = out;
    }
    if (player.isHuman && !human) {
      human = player;
      humanOut = out;
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
    out.contactIn = anim.kind === 'idle' ? Infinity : anim.contactAt - time;
    out.animSide = anim.side;
    out.restSide = (player.hand * teamDir(player.team)) as 1 | -1;
    out.shot = anim.shot;
    out.reachX = anim.reachX;
    out.reachY = anim.reachY;
    out.reachZ = anim.reachZ;

    const who = options.cast[i] ?? null;
    out.character = who ? who.id : null;
    out.act = options.acts[i] ?? null;
    // The windup gives the shot away while the racket is back, waiting for the ball.
    const cue = player.cue;
    if (cue && anim.kind === 'swing' && time < anim.t0) {
      const tell = (tells[i] ??= { kind: 'drive', pose: null, aimX: 0, t: 0 });
      tell.kind = cue.lob ? 'lob' : cue.depth <= match.config.shots.dropAt ? 'drop' : 'drive';
      tell.pose = who?.tell.cues[tell.kind] ?? null;
      tell.aimX = cue.aim * match.config.shots.specs.drive.aimRange - x;
      tell.t = Math.max(0, time - player.cueAt);
      out.tell = tell;
    } else {
      out.tell = null;
    }
    // Doubles: what it is telling its partner, for a moment.
    const said = time - player.callAt;
    const mate = player.call ? match.teams[player.team].find((other) => other !== player) : undefined;
    if (player.call && mate && said >= 0 && said < CALL_SHOWS) {
      const call = (calls[i] ??= { kind: 'mine', t: 0, towardX: 0 });
      call.kind = player.call;
      call.t = said;
      call.towardX = lerp(mate.px, mate.x, alpha) - x;
      out.call = call;
    } else {
      out.call = null;
    }
  }
  scene.players.length = match.players.length;

  scene.bounce = null;
  scene.contact = null;
  scene.guide = null;
  scene.aim = null;
  const trajectory = match.trajectory;

  // Where the ball lands next. For those who ask for everything, the mark
  // moves on after the bounce and keeps following the ball off the walls.
  // Otherwise it is only the first bounce of a ball coming to the person.
  if (level !== 'none' && match.rally.live && trajectory) {
    const coming = human !== null && match.rally.hitter !== human.team;
    for (let i = 0; i < trajectory.bounces.length; i++) {
      const next = trajectory.bounces[i]!;
      if (next.t <= time) continue;
      if (level === 'minimal' && !(options.follow && coming)) {
        const mine = human !== null && next.y * teamDir(human.team) < 0;
        if (!coming || i !== 0 || !mine) break;
      }
      bounce.x = next.x;
      bounce.y = next.y;
      bounce.eta = next.t - time;
      bounce.first = i === 0;
      scene.bounce = bounce;
      break;
    }
  }

  if (!human || !humanOut) return;

  // Where and when the person meets the ball. How it is shown is up to the
  // level: a glow on the ball in the last instant, or the ring with its windows.
  const plan = human.plan;
  if (level !== 'none' && plan) {
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
  if ((level === 'full' || (options.guide && level !== 'none')) && human.manual && advice) {
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
  // The mark is where the thumb points. Once it has let go there is nothing
  // left to decide, so the mark goes too, unless every aid was asked for.
  const marked = level === 'full' || (level === 'minimal' && !armed);

  const serving = (match.phase === 'serve' || match.phase === 'windup') && match.serverId === human.id;
  if (serving) {
    if (!marked) return;
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
    // What the ball that is coming allows: a difficult one cannot be aimed as wide or as deep.
    context.pressure = match.expectedPressure(human);
    context.backpedal = backpedalOf(-human.vy * dir, plan.z, match.config);
  } else {
    context.ballX = human.x + human.hand * dir * 0.6;
    context.ballY = human.y + dir * 0.2;
    context.ballZ = 0.9;
    context.bounces = 1;
    context.walls = 0;
    context.pressure = 0;
    context.backpedal = 0;
  }
  const shot = resolveShot(context, asked, match.config);
  if (marked) {
    aim.x = shot.targetX;
    aim.y = shot.targetY;
    aim.kind = shot.kind;
    aim.forehand = shot.forehand;
    aim.risk = level === 'full' ? shot.risk : 0;
    aim.armed = armed;
    scene.aim = aim;
  }

  // While the thumb is down the body already gets ready for the ball it can
  // reach, as it will once the thumb lets go: the racket goes back for that
  // shot. It is only how the player looks; nothing in the match has happened.
  const resting = humanOut.anim === 'idle' || humanOut.animPhase >= 1;
  if (!armed && plan && resting && match.rally.live && match.rally.hitter !== human.team) {
    humanOut.anim = 'swing';
    humanOut.animPhase = -1;
    humanOut.contactIn = plan.t - time;
    humanOut.shot = shot.kind;
    humanOut.animSide = plan.x >= human.x ? 1 : -1;
    humanOut.reachX = plan.x - humanOut.x;
    humanOut.reachY = plan.y - humanOut.y;
    humanOut.reachZ = plan.z;
  }
}
