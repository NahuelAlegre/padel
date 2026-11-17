import { SIM_DT, createConfig, type GameConfig, type QualityEffect } from '../config';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { createBall, stepBall, type BallEvent, type Surface, type WallId } from './ball';
import { teamDir } from './court';
import { receiverIndex, serveBoxSign, serveSpot } from './formation';
import { contactNear, planIntercept } from './intercept';
import { createPlayer, movePlayer, type Player, type PlayerSetup } from './player';
import {
  applyBallEvent,
  canHit,
  createRally,
  registerHit,
  type FaultReason,
  type PointReason,
  type RallyResult,
} from './rules';
import { awardPoint, createScore, serveSide, type MatchFormat, type ScoreState } from './score';
import { qualityFromError, solveShot, type Launch } from './shots';
import { predictTrajectory, type Trajectory } from './trajectory';
import {
  createIntent,
  otherTeam,
  resetIntent,
  type PlayerIntent,
  type Quality,
  type ShotIntent,
  type ShotKind,
  type TeamId,
} from './types';

/**
 * serve     the server holds the ball and waits for the swing
 * windup    the ball was released and is about to be struck
 * rally     the ball is in play
 * pointOver pause after a point, a fault or a let
 * matchOver nothing else happens
 */
export type Phase = 'serve' | 'windup' | 'rally' | 'pointOver' | 'matchOver';

/** What happened during a step, for rendering, sound, HUD and statistics. */
export type SimEvent =
  | { type: 'serveReady'; server: number; attempt: number }
  | { type: 'toss'; player: number }
  | {
      type: 'hit';
      player: number;
      team: TeamId;
      kind: ShotKind;
      quality: Quality;
      /** Timing error in seconds: negative = early, positive = late. */
      error: number;
      x: number;
      y: number;
      z: number;
      speed: number;
    }
  | { type: 'whiff'; player: number; reason: 'far' | 'nothing' }
  | { type: 'bounce'; x: number; y: number; speed: number }
  | { type: 'wall'; wall: WallId; surface: Surface; x: number; y: number; z: number; speed: number }
  | { type: 'net'; x: number; z: number; cord: boolean }
  | { type: 'out'; x: number; y: number; z: number }
  | { type: 'fault'; reason: FaultReason; attempt: number }
  | { type: 'let' }
  | { type: 'point'; winner: TeamId; reason: PointReason }
  | { type: 'game'; winner: TeamId }
  | { type: 'match'; winner: TeamId };

/** Decides what one player does. Humans and AIs implement the same interface. */
export interface Controller {
  update(match: Match, me: Player, intent: PlayerIntent): void;
  /** Called every time a serve is set up. */
  onServeSetup?(): void;
}

export interface PlayerEntry extends PlayerSetup {
  controller: Controller;
}

export interface TeamSetup {
  name: string;
  players: PlayerEntry[];
}

export interface MatchOptions {
  teams: [TeamSetup, TeamSetup];
  config?: GameConfig;
  seed?: number;
  firstServer?: TeamId;
}

/** How long before contact the swing animation starts. */
const SWING_LEAD = 0.12;
const SWING_DURATION = 0.42;

/**
 * The whole simulation of a match: players, ball, rules and score.
 *
 * It knows nothing about the screen or the input devices. `step()` advances it
 * by exactly SIM_DT; rendering reads its state and drains `events`.
 */
export class Match {
  readonly config: GameConfig;
  readonly rng: Rng;
  readonly players: Player[] = [];
  /** Players of each team. Nothing assumes one player per team. */
  readonly teams: [Player[], Player[]] = [[], []];
  readonly teamNames: [string, string];
  readonly ball = createBall();
  /** Ball position at the previous step, for render interpolation. */
  readonly ballPrev = { x: 0, y: 0, z: 0 };
  readonly rally = createRally();
  readonly score: ScoreState;
  readonly format: MatchFormat;

  phase: Phase = 'serve';
  tick = 0;
  time = 0;
  /** Future of the ball if nobody touches it. Recomputed after every hit. */
  trajectory: Trajectory | null = null;
  /** Drained by whoever is listening (the app does it once per frame). */
  events: SimEvent[] = [];
  serverId = 0;
  serveAttempt = 1;
  /** Player of each team in charge of the incoming ball (-1 = nobody yet). */
  readonly assigned: [number, number] = [-1, -1];
  lastPoint: { winner: TeamId; reason: PointReason } | null = null;
  /** Hits in the current rally, the serve included. */
  rallyHits = 0;

  private readonly controllers: Controller[] = [];
  private readonly intents: PlayerIntent[] = [];
  private readonly walkIntent = createIntent();
  private readonly ballEvents: BallEvent[] = [];
  private phaseUntil = 0;
  private afterPause: 'serve' | 'matchOver' = 'serve';
  private serveHitAt = 0;
  private serveIntent: ShotIntent | null = null;
  private rallyStartedAt = 0;

  constructor(options: MatchOptions) {
    this.config = options.config ?? createConfig();
    this.rng = new Rng(options.seed ?? 1);
    this.teamNames = [options.teams[0].name, options.teams[1].name];
    this.format = {
      gamesToWin: this.config.rules.gamesToWin,
      setsToWin: this.config.rules.setsToWin,
      goldenPoint: this.config.rules.goldenPoint,
    };

    for (const team of [0, 1] as const) {
      options.teams[team].players.forEach((entry, index) => {
        const { controller, ...setup } = entry;
        const player = createPlayer(this.players.length, team, index, setup);
        this.players.push(player);
        this.teams[team].push(player);
        this.controllers.push(controller);
        this.intents.push(createIntent());
      });
    }
    if (this.teams[0].length === 0 || this.teams[1].length === 0) {
      throw new Error('Each team needs at least one player');
    }

    this.score = createScore(options.firstServer ?? 0);
    this.assignSpots();
    this.beginServe();
  }

  get server(): Player {
    return this.players[this.serverId]!;
  }

  get teamSizes(): [number, number] {
    return [this.teams[0].length, this.teams[1].length];
  }

  /** Extra pace of the current rally, 0 at the start and growing with every hit. */
  get heat(): number {
    const rules = this.config.rules;
    return clamp((this.rallyHits - rules.heatAfter) * rules.heatPerHit, 0, rules.heatMax);
  }

  /** Advances the simulation by one fixed step. */
  step(): void {
    this.tick++;
    this.time = this.tick * SIM_DT;

    for (const player of this.players) {
      player.px = player.x;
      player.py = player.y;
    }
    this.ballPrev.x = this.ball.x;
    this.ballPrev.y = this.ball.y;
    this.ballPrev.z = this.ball.z;

    if (this.phase === 'pointOver' && this.time >= this.phaseUntil) {
      if (this.afterPause === 'matchOver') this.phase = 'matchOver';
      else this.beginServe();
    }

    if (this.phase !== 'matchOver') {
      this.updatePlans();
      for (let i = 0; i < this.players.length; i++) {
        const intent = this.intents[i]!;
        resetIntent(intent);
        this.controllers[i]!.update(this, this.players[i]!, intent);
      }
    }

    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i]!;
      if (this.phase === 'rally') {
        movePlayer(player, this.intents[i]!, SIM_DT, this.config);
      } else {
        // Between points everybody walks to the position the rules give them.
        this.walkIntent.hasTarget = true;
        this.walkIntent.targetX = player.spotX;
        this.walkIntent.targetY = player.spotY;
        movePlayer(player, this.walkIntent, SIM_DT, this.config);
      }
    }

    if (this.phase !== 'matchOver') {
      for (let i = 0; i < this.players.length; i++) {
        const swing = this.intents[i]!.swing;
        if (swing) this.requestSwing(this.players[i]!, swing);
      }
    }

    if (this.phase === 'windup' && this.time >= this.serveHitAt) this.executeServe();
    if (this.phase === 'rally') this.resolveSwings();

    if (this.phase === 'serve') {
      this.holdBall();
    } else {
      this.stepBall();
    }

    if (this.phase === 'rally' && this.time - this.rallyStartedAt > this.config.rules.maxPointTime) {
      // Safety net: a point that never ends is replayed.
      this.finishRally({ kind: 'let' });
    }
  }

  // ---------------------------------------------------------------- serve

  /** Gives every player the position it has to take for the next serve. */
  private assignSpots(): void {
    const side = serveSide(this.score);
    const servingTeam = this.score.servingTeam;
    const sizes = this.teamSizes;
    const serverIndex = this.score.serverIndex[servingTeam] % sizes[servingTeam];
    this.serverId = this.teams[servingTeam][serverIndex]!.id;
    for (const player of this.players) {
      const spot = serveSpot(
        player.team,
        player.index,
        sizes[player.team],
        servingTeam,
        serverIndex,
        side,
        this.config,
      );
      player.spotX = spot.x;
      player.spotY = spot.y;
    }
  }

  private beginServe(): void {
    this.assignSpots();
    for (const player of this.players) {
      player.x = player.spotX;
      player.y = player.spotY;
      player.px = player.x;
      player.py = player.y;
      player.vx = 0;
      player.vy = 0;
      player.plan = null;
      player.swing = null;
      player.swingLockUntil = 0;
      player.homeMode = 'back';
      player.anim.kind = 'idle';
    }
    this.phase = 'serve';
    this.rally.live = false;
    this.trajectory = null;
    this.assigned[0] = -1;
    this.assigned[1] = -1;
    this.serveIntent = null;
    this.holdBall();
    this.ballPrev.x = this.ball.x;
    this.ballPrev.y = this.ball.y;
    this.ballPrev.z = this.ball.z;
    for (const controller of this.controllers) controller.onServeSetup?.();
    this.events.push({ type: 'serveReady', server: this.serverId, attempt: this.serveAttempt });
  }

  /** Keeps the ball in the server's hand, on its forehand side and a little in front. */
  private holdBall(): void {
    const server = this.server;
    const dir = teamDir(server.team);
    const ball = this.ball;
    ball.x = server.x + server.hand * dir * 0.4;
    ball.y = server.y + dir * 0.3;
    ball.z = this.config.rules.serveDropHeight;
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.rolling = false;
    ball.outside = false;
  }

  private startServe(server: Player, intent: ShotIntent): void {
    const rules = this.config.rules;
    this.phase = 'windup';
    this.serveIntent = intent;
    this.serveHitAt = this.time + rules.serveWindup;
    this.ball.vz = -rules.serveDropSpeed;
    server.anim.kind = 'serve';
    server.anim.t0 = this.time;
    server.anim.duration = rules.serveWindup + 0.3;
    server.anim.side = (server.hand * teamDir(server.team)) as 1 | -1;
    server.anim.shot = 'serve';
    this.events.push({ type: 'toss', player: server.id });
  }

  private executeServe(): void {
    const server = this.server;
    const config = this.config;
    const intent = this.serveIntent ?? { kind: 'safe', aim: 0 };
    const dir = teamDir(server.team);
    const side = serveSide(this.score);
    const box = serveBoxSign(server.team, side);
    const spec = config.shots.specs.serve;
    const ball = this.ball;

    const targetX = box * (config.court.halfWidth / 2) + clamp(intent.aim, -1, 1) * spec.aimRange;
    const launch = solveShot(ball.x, ball.y, ball.z, targetX, dir * spec.depth, spec, config.physics, config.court);
    const x = ball.x;
    const y = ball.y;
    const z = ball.z;
    const speed = this.launch(launch, config.shots.serve, server.errorScale);

    registerHit(this.rally, server.team, true, box);
    this.phase = 'rally';
    this.rallyStartedAt = this.time;
    this.rallyHits = 1;
    this.serveIntent = null;
    // In padel the serving side takes the net behind the serve.
    for (const mate of this.teams[server.team]) mate.homeMode = 'net';
    this.events.push({
      type: 'hit',
      player: server.id,
      team: server.team,
      kind: 'serve',
      quality: 'good',
      error: 0,
      x,
      y,
      z,
      speed,
    });

    // The serve is returned by the player standing diagonally.
    const receivers = this.teams[otherTeam(server.team)];
    const receiver = receivers[receiverIndex(receivers.length, side)] ?? receivers[0]!;
    this.onBallStruck(server.team, receiver.id);
  }

  // ---------------------------------------------------------------- swings

  private requestSwing(player: Player, intent: ShotIntent): void {
    if (this.time < player.swingLockUntil) return;
    if (this.phase === 'serve') {
      if (player.id === this.serverId) this.startServe(player, intent);
      return;
    }
    if (this.phase !== 'rally') return;

    const timing = this.config.timing;
    player.swingLockUntil = this.time + timing.reswipeGap;

    const plan = player.plan;
    if (!plan || !this.rally.live || this.rally.hitter === player.team) {
      // Nothing to hit: swing at the air so the input is visibly acknowledged.
      player.swing = null;
      this.playSwing(player, 'whiff', this.time, intent.kind);
      this.events.push({ type: 'whiff', player: player.id, reason: 'nothing' });
      return;
    }

    // A swing before the contact is armed and waits for the ball; a swing
    // after it reaches for the ball straight away. Either way the error
    // against the ideal moment decides the quality.
    const at = this.time - (player.isHuman ? timing.latencyCompensation : 0);
    const executeAt = Math.max(plan.t, this.time);
    player.swing = { intent, requestedAt: this.time, executeAt, error: at - plan.t };
    this.playSwing(player, 'swing', executeAt - SWING_LEAD, intent.kind);
  }

  private playSwing(player: Player, kind: 'swing' | 'whiff', t0: number, shot: ShotKind): void {
    const anim = player.anim;
    anim.kind = kind;
    anim.t0 = t0;
    anim.duration = SWING_DURATION;
    anim.shot = shot;
    const ballSide = this.ball.x >= player.x ? 1 : -1;
    anim.side = player.plan ? (player.plan.x >= player.plan.stanceX ? 1 : -1) : ballSide;
  }

  private resolveSwings(): void {
    const timing = this.config.timing;
    for (const player of this.players) {
      const swing = player.swing;
      if (!swing) continue;
      // A player that moves by hand changes its own contact while it runs.
      if (player.manual && player.plan && swing.error < 0) {
        swing.executeAt = Math.max(player.plan.t, swing.requestedAt);
      }
      if (this.time + 1e-9 < swing.executeAt) continue;
      if (this.tryHit(player, swing.intent, swing.error)) continue;
      if (this.time > swing.executeAt + timing.graceAfter) {
        player.swing = null;
        this.events.push({ type: 'whiff', player: player.id, reason: 'far' });
      }
    }
  }

  private tryHit(player: Player, intent: ShotIntent, error: number): boolean {
    const pc = this.config.player;
    const ball = this.ball;
    if (!canHit(this.rally, player.team, ball.y)) return false;
    if (ball.z < pc.minContactZ * 0.5 || ball.z > pc.maxContactZ + 0.15) return false;
    const gap = Math.hypot(ball.x - player.x, ball.y - player.y);
    const reach = error > 0 ? pc.lungeReach : pc.reach * 1.1;
    if (gap > reach) return false;
    this.executeHit(player, intent, error, gap);
    return true;
  }

  private executeHit(player: Player, intent: ShotIntent, error: number, gap: number): void {
    const config = this.config;
    const pc = config.player;
    const ball = this.ball;
    const dir = teamDir(player.team);
    const quality = qualityFromError(error, config.timing);
    const netDistance = Math.abs(ball.y);
    const wasVolley = this.rally.bounces === 0;

    // A drive taken in the air near the net is a volley; a high ball is a smash.
    let kind: ShotKind = intent.kind;
    if (kind === 'drive') {
      if (ball.z >= pc.smashZ && netDistance <= pc.smashMaxNetDistance) kind = 'smash';
      else if (wasVolley && netDistance <= pc.volleyMaxNetDistance) kind = 'volley';
    }
    const shots = config.shots;
    const spec = shots.specs[kind];
    const effect = shots.quality[quality];

    // How hard the ball was to play: reached at full stretch, coming fast, or
    // dug out from the floor. All of it widens the scatter of the shot.
    const incoming = Math.hypot(ball.vx, ball.vy, ball.vz);
    const stretch = clamp((gap - pc.sweetSpot) / (pc.reach - pc.sweetSpot), 0, 2);
    const fast = clamp((incoming - shots.paceFrom) / 12, 0, 1.5);
    const low = clamp((0.45 - ball.z) / 0.45, 0, 1);
    let scale = 1 + stretch * shots.stretchPenalty + fast * shots.pacePenalty + low * shots.lowPenalty;
    scale += this.heat * config.rules.heatError;
    scale *= player.errorScale;
    if (kind === 'safe') scale *= 0.6;

    const depth = spec.depth + (shots.shortDepth - spec.depth) * effect.shorten;
    const launch = solveShot(
      ball.x,
      ball.y,
      ball.z,
      clamp(intent.aim, -1, 1) * spec.aimRange,
      dir * depth,
      {
        clearance: spec.clearance + effect.lift,
        apex: spec.apex,
        speed: spec.speed * effect.pace * (1 + this.heat),
      },
      config.physics,
      config.court,
    );
    this.rallyHits++;
    const x = ball.x;
    const y = ball.y;
    const z = ball.z;
    const speed = this.launch(launch, effect, scale);

    registerHit(this.rally, player.team, false, 1);
    player.swing = null;
    // After a lob, a drop or anything played at the net, hold the net; otherwise fall back.
    const attacking = kind === 'lob' || kind === 'drop' || kind === 'volley' || kind === 'smash';
    player.homeMode = attacking ? 'net' : 'back';

    this.events.push({ type: 'hit', player: player.id, team: player.team, kind, quality, error, x, y, z, speed });
    this.onBallStruck(player.team, -1);
  }

  /**
   * Sends the ball off with the scatter of a real swing: direction, launch
   * angle and speed are each a little off. Returns the launch speed.
   */
  private launch(ideal: Launch, effect: QualityEffect, scale: number): number {
    const rng = this.rng;
    const toRad = Math.PI / 180;
    const flat = Math.hypot(ideal.vx, ideal.vy);
    const azimuth = Math.atan2(ideal.vx, ideal.vy) + rng.gauss() * effect.azimuth * scale * toRad;
    const elevation = Math.atan2(ideal.vz, flat) + rng.gauss() * effect.elevation * scale * toRad;
    const speed = Math.hypot(flat, ideal.vz) * (1 + rng.gauss() * effect.speed * scale);
    const ball = this.ball;
    const cos = Math.cos(elevation);
    ball.vx = speed * cos * Math.sin(azimuth);
    ball.vy = speed * cos * Math.cos(azimuth);
    ball.vz = speed * Math.sin(elevation);
    ball.rolling = false;
    return speed;
  }

  /** Recomputes the future of the ball and decides who goes for it. */
  private onBallStruck(hitter: TeamId, receiverId: number): void {
    const trajectory = predictTrajectory(this.ball, this.rally, this.time, this.config);
    this.trajectory = trajectory;
    for (const player of this.players) player.plan = null;

    const receiving = otherTeam(hitter);
    this.assigned[hitter] = -1;
    if (receiverId >= 0) {
      this.assigned[receiving] = receiverId;
      return;
    }
    // Several players: the one that gets to the ball with more time takes it.
    const members = this.teams[receiving];
    let best = members[0]!;
    let bestScore = -Infinity;
    if (members.length > 1) {
      for (const player of members) {
        const plan = planIntercept(trajectory, player, this.time, this.config);
        const score = plan ? plan.slack + (plan.reachable ? 100 : 0) : -Infinity;
        if (score > bestScore) {
          best = player;
          bestScore = score;
        }
      }
    }
    this.assigned[receiving] = best.id;
  }

  /**
   * True when the ball coming to `team` will lose the point (or the serve) by
   * itself: it is going out, so the right play is not to touch it.
   */
  shouldLeave(team: TeamId): boolean {
    const end = this.trajectory?.end;
    if (!end) return false;
    if (end.result.kind !== 'point') return true;
    return end.result.winner === team;
  }

  private updatePlans(): void {
    const trajectory = this.trajectory;
    const timing = this.config.timing;
    for (const player of this.players) {
      const incoming =
        this.phase === 'rally' && trajectory !== null && this.rally.live && this.rally.hitter !== player.team;
      if (!incoming) {
        player.plan = null;
        continue;
      }
      if (player.manual) {
        player.plan = contactNear(trajectory, player, this.time, this.config);
        continue;
      }
      if (this.assigned[player.team] !== player.id) {
        player.plan = null;
        continue;
      }
      // The player needs a moment to read a new ball.
      if (this.time < trajectory.t0 + player.reaction) continue;

      const plan = player.plan;
      const current = plan !== null && plan.trajId === trajectory.id;
      if (current && this.time <= plan.t + timing.lateMax) continue;
      if (this.shouldLeave(player.team)) {
        player.plan = null;
        continue;
      }
      // After a missed contact only a real second chance counts, far enough
      // ahead to be seen coming (typically the rebound off the wall).
      player.plan = planIntercept(trajectory, player, this.time, this.config, current ? timing.replanLead : 0);
    }
  }

  // ---------------------------------------------------------------- ball and rules

  private stepBall(): void {
    const events = this.ballEvents;
    events.length = 0;
    stepBall(this.ball, SIM_DT, this.config.physics, this.config.court, events);
    for (const event of events) {
      switch (event.type) {
        case 'floor':
          this.events.push({ type: 'bounce', x: event.x, y: event.y, speed: event.speed });
          break;
        case 'wall':
          this.events.push({
            type: 'wall',
            wall: event.wall,
            surface: event.surface,
            x: event.x,
            y: event.y,
            z: event.z,
            speed: event.speed,
          });
          break;
        case 'net':
          this.events.push({ type: 'net', x: event.x, z: event.z, cord: event.cord });
          break;
        case 'out':
          this.events.push({ type: 'out', x: event.x, y: event.y, z: event.z });
          break;
        case 'cross':
          break;
      }
      const result = applyBallEvent(this.rally, event, this.config.court);
      if (result) this.finishRally(result);
    }
  }

  private finishRally(result: RallyResult): void {
    const rules = this.config.rules;
    this.rally.live = false;
    for (const player of this.players) {
      player.plan = null;
      // A swing that was still waiting for the ball never happens.
      if (player.swing) player.anim.kind = 'idle';
      player.swing = null;
    }

    if (result.kind === 'let') {
      this.events.push({ type: 'let' });
      this.pause(rules.faultPause, 'serve');
      return;
    }

    let winner: TeamId;
    let reason: PointReason;
    if (result.kind === 'fault') {
      this.events.push({ type: 'fault', reason: result.reason, attempt: this.serveAttempt });
      if (this.serveAttempt < rules.serveAttempts) {
        this.serveAttempt++;
        this.pause(rules.faultPause, 'serve');
        return;
      }
      winner = otherTeam(this.rally.hitter);
      reason = 'doubleFault';
    } else {
      winner = result.winner;
      reason = result.reason;
    }

    this.serveAttempt = 1;
    this.lastPoint = { winner, reason };
    const award = awardPoint(this.score, winner, this.format, this.teamSizes);
    this.events.push({ type: 'point', winner, reason });
    if (award.game !== null) this.events.push({ type: 'game', winner: award.game });
    if (award.match !== null) {
      this.events.push({ type: 'match', winner: award.match });
      this.pause(rules.gamePause, 'matchOver');
      return;
    }
    // Players walk to their next positions during the pause.
    this.assignSpots();
    this.pause(award.game !== null ? rules.gamePause : rules.pointPause, 'serve');
  }

  private pause(duration: number, then: 'serve' | 'matchOver'): void {
    this.phase = 'pointOver';
    this.phaseUntil = this.time + duration;
    this.afterPause = then;
  }
}
