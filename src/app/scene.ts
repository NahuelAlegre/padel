import { SIM_DT } from '../config';
import { lerp } from '../core/math';
import { teamDir } from '../sim/court';
import type { Match } from '../sim/match';
import { createPointerFeedback, type PointerFeedback, type Scene, type ScenePlayer } from '../render/scene';

export interface SceneOptions {
  bounceMarker: boolean;
  timingAid: boolean;
  reduceMotion: boolean;
}

export function createScene(pointer: PointerFeedback = createPointerFeedback()): Scene {
  return {
    time: 0,
    ball: { x: 0, y: 0, z: 0, visible: true },
    players: [],
    bounce: null,
    contact: null,
    heat: 0,
    pointer,
    reduceMotion: false,
  };
}

const bounce = { x: 0, y: 0, eta: 0 };
const contact = { x: 0, y: 0, z: 0, eta: 0, perfect: 0, good: 0 };

/**
 * Fills `scene` with the state of the match between its last two steps.
 * `alpha` is how far into the current step the frame falls (0..1): the
 * simulation runs at a fixed rate and the screen at its own, so positions
 * are blended to keep the motion smooth at any refresh rate.
 */
export function fillScene(scene: Scene, match: Match, alpha: number, options: SceneOptions): void {
  const time = match.time - (1 - alpha) * SIM_DT;
  scene.time = time;
  scene.reduceMotion = options.reduceMotion;
  scene.heat = match.config.rules.heatMax > 0 ? match.heat / match.config.rules.heatMax : 0;

  scene.ball.x = lerp(match.ballPrev.x, match.ball.x, alpha);
  scene.ball.y = lerp(match.ballPrev.y, match.ball.y, alpha);
  scene.ball.z = lerp(match.ballPrev.z, match.ball.z, alpha);
  scene.ball.visible = true;

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
        animSide: 1,
        restSide: 1,
        shot: 'drive',
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
    out.anim = player.anim.kind;
    out.animPhase = player.anim.duration > 0 ? (time - player.anim.t0) / player.anim.duration : 1;
    out.animSide = player.anim.side;
    out.restSide = (player.hand * teamDir(player.team)) as 1 | -1;
    out.shot = player.anim.shot;
  }
  scene.players.length = match.players.length;

  // Where the ball lands next.
  scene.bounce = null;
  const trajectory = match.trajectory;
  if (options.bounceMarker && match.rally.live && trajectory?.bounce && trajectory.bounce.t > time) {
    bounce.x = trajectory.bounce.x;
    bounce.y = trajectory.bounce.y;
    bounce.eta = trajectory.bounce.t - time;
    scene.bounce = bounce;
  }

  // Where and when the person meets the ball.
  scene.contact = null;
  if (options.timingAid) {
    for (const player of match.players) {
      const plan = player.plan;
      if (!player.isHuman || !plan) continue;
      contact.x = plan.x;
      contact.y = plan.y;
      contact.z = plan.z;
      // Shown truthfully: the match already allows for the delay between what
      // the person sees and when the swipe arrives (latencyCompensation).
      contact.eta = plan.t - time;
      contact.perfect = match.config.timing.perfect;
      contact.good = match.config.timing.good;
      scene.contact = contact;
      break;
    }
  }
}
