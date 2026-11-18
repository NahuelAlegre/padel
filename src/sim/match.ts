import { SIM_DT, createConfig, type GameConfig, type QualityEffect } from '../config';
import { clamp, lerp } from '../core/math';
import { Rng } from '../core/rng';
import { createBall, stepBall, type BallEvent, type Surface, type WallId } from './ball';
import { teamDir } from './court';
import { receiverIndex, serveBoxSign, serveSpot } from './formation';
import { contactNear, planIntercept } from './intercept';
import { createPlayer, movePlayer, playerReach, type Player, type PlayerSetup } from './player';
import { InputRecorder, type Recording } from './replay';
import {
  applyBallEvent,
  canHit,
  createRally,
  registerHit,
  type FaultReason,
  type PointReason,
  type RallyResult,
} from './rules';
import { awardPoint, cloneScore, createScore, serveSide, type MatchFormat, type ScoreState } from './score';
import {
  qualityFromError,
  resolveShot,
  serveTarget,
  shotKind,
  solveBackWall,
  solveShot,
  type Launch,
  type ShotContext,
} from './shots';
import { pointAt, predictTrajectory, type Trajectory } from './trajectory';
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
      /** The shot that came out, decided by the situation. */
      kind: ShotKind;
      /** Played on the side of the racket hand (derecha) or not (revés). */
      forehand: boolean;
      /** Taken in the air, before it bounced. */
      volley: boolean;
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
  | { type: 'tieBreak' }
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

/** Enough of a match to pick it up again at the start of a point. */
export interface MatchSnapshot {
  score: ScoreState;
  serveAttempt: number;
}

export interface MatchOptions {
  teams: [TeamSetup, TeamSetup];
  config?: GameConfig;
  seed?: number;
  firstServer?: TeamId;
  /** Continue a match from the point it was saved at. */
  resume?: MatchSnapshot;
  /** Keep the intents of the human players, to be able to replay the match. */
  record?: boolean;
  /** First ever point: the rival plays gently until the person wins one. */
  tutorial?: boolean;
}

/** How long before contact the swing animation starts. */
const SWING_LEAD = 0.12;
const SWING_DURATION = 0.42;
/** How often the advice on where to stand is refreshed for a hand-moved player, in steps. */
const GUIDE_EVERY = 12;

/**
 * The whole simulation of a match: players, ball, rules and score.
 *
 * It knows nothing about the screen or the input devices. `step()` advances it
 * by exactly SIM_DT; rendering reads its state and drains `events`.
 *
 * It is deterministic: the same seed and the same intents, step by step, play
 * the same match.
 */
export class Match {
  readonly config: GameConfig;
  readonly seed: number;
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
  /** True until a person wins a point: the rival goes easy meanwhile. */
  tutorial: boolean;

  private readonly controllers: Controller[] = [];
  private readonly intents: PlayerIntent[] = [];
  private readonly walkIntent = createIntent();
  private readonly ballEvents: BallEvent[] = [];
  private readonly recorder: InputRecorder | null;
  private phaseStarted = 0;
  private phaseUntil = 0;
  private afterPause: 'serve' | 'matchOver' = 'serve';
  private serveHitAt = 0;
  private serveIntent: ShotIntent | null = null;
  private readonly kindContext: ShotContext = {
    team: 0,
    hand: 1,
    playerX: 0,
    playerY: 0,
    ballX: 0,
    ballY: 0,
    ballZ: 0,
    bounces: 0,
    walls: 0,
  };
  private rallyStartedAt = 0;

  constructor(options: MatchOptions) {
    this.config = options.config ?? createConfig();
    this.seed = options.seed ?? 1;
    this.rng = new Rng(this.seed);
    this.teamNames = [options.teams[0].name, options.teams[1].name];
    this.format = { ...this.config.rules.format };
    this.tutorial = options.tutorial ?? false;
    this.recorder = options.record ? new InputRecorder() : null;

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

    if (options.resume) {
      this.score = cloneScore(options.resume.score);
      this.serveAttempt = options.resume.serveAttempt;
    } else {
      this.score = createScore(options.firstServer ?? 0);
    }
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

  /** What is needed to continue this match later from the current point. */
  snapshot(): MatchSnapshot {
    return { score: cloneScore(this.score), serveAttempt: this.serveAttempt };
  }

  /** The intents recorded so far, when the match was created with `record`. */
  recording(): Recording | null {
    return this.recorder ? this.recorder.recording(this.seed) : null;
  }

  /**
   * Cuts the pause between points short. Returns true if there was one to
   * skip. The very start of the pause cannot be skipped, so the touch that
   * ended the point does not also swallow its result.
   */
  skipPause(): boolean {
    if (this.phase !== 'pointOver' || this.afterPause !== 'serve') return false;
    if (this.time - this.phaseStarted < this.config.rules.skipAfter) return false;
    this.phaseUntil = this.time;
    return true;
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
        const player = this.players[i]!;
        const intent = this.intents[i]!;
        resetIntent(intent);
        this.controllers[i]!.update(this, player, intent);
        if (intent.home) player.homeMode = intent.home;
        this.showCue(player, intent.cue);
        if (this.recorder && player.isHuman) this.recorder.capture(this.tick, i, intent);
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
      player.guide = null;
      player.swing = null;
      player.swingLockUntil = 0;
      player.cue = null;
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

  /** Sign of x of the service box the next serve has to land in. */
  serveBox(): 1 | -1 {
    return serveBoxSign(this.server.team, serveSide(this.score));
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
    server.anim.contactAt = this.serveHitAt;
    server.anim.side = (server.hand * teamDir(server.team)) as 1 | -1;
    server.anim.shot = 'serve';
    server.anim.reachX = this.ball.x - server.x;
    server.anim.reachY = this.ball.y - server.y;
    server.anim.reachZ = 0.55;
    this.events.push({ type: 'toss', player: server.id });
  }

  private executeServe(): void {
    const server = this.server;
    const config = this.config;
    const intent = this.serveIntent ?? { aim: 0, depth: 0.6, lob: false, power: 1 };
    const side = serveSide(this.score);
    const box = serveBoxSign(server.team, side);
    const spec = config.shots.specs.serve;
    const ball = this.ball;

    const target = serveTarget(server.team, box, intent, config);
    const launch = solveShot(ball.x, ball.y, ball.z, target.x, target.y, spec, config.physics, config.court);
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
      forehand: true,
      volley: false,
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

  /**
   * A swing is not a hit yet: it arms the player. The racket goes back and the
   * ball is struck when it gets there, so a player can choose where to hit
   * well before the ball arrives. Asking again replaces what was armed.
   */
  private requestSwing(player: Player, intent: ShotIntent): void {
    if (this.time < player.swingLockUntil) return;
    if (this.phase === 'serve') {
      if (player.id === this.serverId) this.startServe(player, intent);
      return;
    }
    if (this.phase !== 'rally') return;

    const timing = this.config.timing;
    player.swingLockUntil = this.time + timing.reswipeGap;

    if (!this.rally.live || this.rally.hitter === player.team) {
      // The ball is not coming: swing at the air so the input is visibly acknowledged.
      player.swing = null;
      this.playSwing(player, 'whiff', this.time, intent);
      this.events.push({ type: 'whiff', player: player.id, reason: 'nothing' });
      return;
    }

    const at = this.time - (player.isHuman ? timing.latencyCompensation : 0);

    // Assisted movement may be waiting for a later, more comfortable contact,
    // typically the rebound off the back wall. A person who swings while the
    // ball is passing within reach means that ball: take it there. Unless it
    // has already got past: then the rebound that was planned is the better ball.
    const plan = player.plan;
    if (player.isHuman && !player.manual && this.trajectory && plan && plan.t - at > timing.good) {
      const passing = contactNear(
        this.trajectory,
        player,
        this.time,
        this.config,
        timing.takeNow,
        timing.takeNowBack,
        undefined,
        false,
      );
      if (passing && passing.t < plan.t - timing.good) player.plan = passing;
    }

    player.swing = { intent, at };
    this.playSwing(player, 'swing', Infinity, intent);
  }

  /**
   * A player that has decided its shot takes the racket back for it before it
   * swings. Nothing else changes: this is only what the opponent gets to see.
   */
  private showCue(player: Player, cue: ShotIntent | null): void {
    if (cue !== player.cue) {
      if (cue && !player.cue) player.cueAt = this.time;
      player.cue = cue;
    }
    // A swing that was asked for owns the animation.
    if (player.swing) return;
    const anim = player.anim;
    const armed = anim.kind === 'swing' && anim.t0 === Infinity;
    if (!cue) {
      if (armed) anim.kind = 'idle';
      return;
    }
    if (this.phase !== 'rally') return;
    const resting = anim.kind === 'idle' || this.time - anim.t0 >= anim.duration;
    if (!armed && !resting) return;
    this.playSwing(player, 'swing', Infinity, cue);
    // It has not swung yet, but it knows which ball it is waiting for.
    const plan = player.plan;
    if (plan) {
      anim.contactAt = plan.t;
      anim.reachX = plan.x - player.x;
      anim.reachY = plan.y - player.y;
      anim.reachZ = plan.z;
    }
  }

  /**
   * The shot an intent will turn into when the player meets the ball it is
   * waiting for. Only for show: it lets the windup be the right one before
   * the contact decides for real.
   */
  private predictKind(player: Player, intent: ShotIntent): ShotKind {
    const plan = player.plan;
    const point = plan && this.trajectory ? pointAt(this.trajectory, plan.t) : null;
    if (!plan || !point) return intent.lob ? 'lob' : intent.depth <= this.config.shots.dropAt ? 'drop' : 'drive';
    const context = this.kindContext;
    context.team = player.team;
    context.hand = player.hand;
    context.playerX = player.x;
    context.playerY = player.y;
    context.ballX = plan.x;
    context.ballY = plan.y;
    context.ballZ = plan.z;
    context.bounces = point.bounces;
    context.walls = point.walls;
    return shotKind(context, intent, this.config);
  }

  private playSwing(player: Player, kind: 'swing' | 'whiff', t0: number, intent: ShotIntent): void {
    const anim = player.anim;
    anim.kind = kind;
    anim.t0 = t0;
    anim.duration = SWING_DURATION;
    anim.contactAt = t0 + SWING_LEAD;
    // The final name of the shot is only known at contact; until then the
    // racket is held for the shot this would be with the ball it is waiting for.
    anim.shot = this.predictKind(player, intent);
    const plan = player.plan;
    anim.side = (plan ? plan.x >= player.x : this.ball.x >= player.x) ? 1 : -1;
  }

  private resolveSwings(): void {
    const timing = this.config.timing;
    for (const player of this.players) {
      const swing = player.swing;
      if (!swing) continue;
      const plan = player.plan;
      if (!plan) {
        // Nothing within reach yet: stay armed.
        player.anim.t0 = Infinity;
        player.anim.contactAt = Infinity;
        continue;
      }
      // Start the stroke so the racket arrives together with the ball.
      const anim = player.anim;
      anim.t0 = plan.t - SWING_LEAD;
      anim.contactAt = plan.t;
      anim.shot = this.predictKind(player, swing.intent);
      anim.side = plan.x >= player.x ? 1 : -1;
      anim.reachX = plan.x - player.x;
      anim.reachY = plan.y - player.y;
      anim.reachZ = plan.z;
      if (this.time + 1e-9 < plan.t) continue;

      if (this.tryHit(player, swing.intent, swing.at - plan.t)) continue;
      // A player that moves by itself gives up when it did not get there. A
      // player moved by hand stays armed: the ball may still come back.
      if (!player.manual && this.time > plan.t + timing.graceAfter) {
        player.swing = null;
        player.anim.kind = 'idle';
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
    const reach = playerReach(player, this.config);
    if (gap > (error > 0 ? reach + pc.lungeExtra : reach * 1.1)) return false;
    this.executeHit(player, intent, error, gap);
    return true;
  }

  private executeHit(player: Player, intent: ShotIntent, error: number, gap: number): void {
    const config = this.config;
    const pc = config.player;
    const shots = config.shots;
    const ball = this.ball;
    const quality = qualityFromError(error, config.timing);
    const effect = shots.quality[quality];

    const context: ShotContext = {
      team: player.team,
      hand: player.hand,
      playerX: player.x,
      playerY: player.y,
      ballX: ball.x,
      ballY: ball.y,
      ballZ: ball.z,
      bounces: this.rally.bounces,
      walls: this.rally.walls,
    };
    const shot = resolveShot(context, intent, config);
    const spec = shots.specs[shot.kind];

    // How hard the ball was to play: reached at full stretch, coming fast, dug
    // out from the floor, deep into a long rally. And the risk the player
    // chose by aiming close to the walls. All of it widens the scatter.
    const incoming = Math.hypot(ball.vx, ball.vy, ball.vz);
    const reach = playerReach(player, config);
    const stretch = clamp((gap - pc.sweetSpot) / (reach - pc.sweetSpot), 0, 1.5);
    const fast = clamp((incoming - shots.paceFrom) / 12, 0, 1.5);
    const low = clamp((0.45 - ball.z) / 0.45, 0, 1);
    let scale =
      1 +
      stretch * shots.stretchPenalty +
      fast * shots.pacePenalty +
      low * shots.lowPenalty +
      shot.risk * shots.riskPenalty +
      this.heat * config.rules.heatError;
    scale *= player.errorScale * (intent.scatter ?? 1);

    // A weak ball lands short and floats.
    const dir = teamDir(player.team);
    const depth = lerp(Math.abs(shot.targetY), shots.shortDepth, effect.shorten);
    const params = {
      clearance: shot.params.clearance + effect.lift,
      apex: shot.params.apex,
      speed: shot.params.speed * effect.pace * (1 + this.heat),
    };
    const launch =
      shot.kind === 'backWall'
        ? solveBackWall(ball.x, ball.y, ball.z, shot.targetX, dir * depth, player.team, params, config.physics, config.court)
        : solveShot(ball.x, ball.y, ball.z, shot.targetX, dir * depth, params, config.physics, config.court);
    this.rallyHits++;
    const x = ball.x;
    const y = ball.y;
    const z = ball.z;
    const speed = this.launch(launch, effect, scale);

    registerHit(this.rally, player.team, false, 1);
    player.swing = null;
    player.anim.kind = 'swing';
    player.anim.t0 = this.time - SWING_LEAD;
    player.anim.contactAt = this.time;
    player.anim.shot = shot.kind;
    player.anim.side = ball.x >= player.x ? 1 : -1;
    player.anim.reachX = x - player.x;
    player.anim.reachY = y - player.y;
    player.anim.reachZ = z;
    // After an attacking shot hold the net; otherwise fall back. A controller
    // can overrule this with its own idea of where to wait.
    const attacking = spec.apex > 0 || shot.kind === 'drop' || shot.kind === 'volley' || shot.kind === 'smash' || shot.kind === 'bandeja' || shot.kind === 'vibora';
    player.homeMode = attacking ? 'net' : 'back';

    this.events.push({
      type: 'hit',
      player: player.id,
      team: player.team,
      kind: shot.kind,
      forehand: shot.forehand,
      volley: context.bounces === 0,
      quality,
      error,
      x,
      y,
      z,
      speed,
    });
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
    for (const player of this.players) {
      player.plan = null;
      player.guide = null;
    }

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

  /**
   * Works out, for every player, where and when it can meet the ball.
   *
   * A player that moves by itself (AI, assisted movement) gets a plan: the
   * most comfortable contact it can run to. A player moved by hand gets the
   * moment the ball passes closest to where it is standing right now, plus,
   * as advice only, the place the plan would have taken it to.
   */
  private updatePlans(): void {
    const trajectory = this.trajectory;
    const timing = this.config.timing;
    for (const player of this.players) {
      const incoming =
        this.phase === 'rally' && trajectory !== null && this.rally.live && this.rally.hitter !== player.team;
      if (!incoming) {
        player.plan = null;
        player.guide = null;
        continue;
      }
      if (player.manual) {
        player.plan = contactNear(trajectory, player, this.time, this.config, undefined, undefined, player.contact);
        if (!player.guide || this.tick % GUIDE_EVERY === 0) {
          player.guide = this.shouldLeave(player.team) ? null : planIntercept(trajectory, player, this.time, this.config);
        }
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
      player.guide = null;
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
    if (this.tutorial && this.teams[winner].some((player) => player.isHuman)) this.tutorial = false;
    const award = awardPoint(this.score, winner, this.format, this.teamSizes);
    this.events.push({ type: 'point', winner, reason });
    if (award.game !== null) this.events.push({ type: 'game', winner: award.game });
    if (award.tieBreak) this.events.push({ type: 'tieBreak' });
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
    this.phaseStarted = this.time;
    this.phaseUntil = this.time + duration;
    this.afterPause = then;
  }
}
