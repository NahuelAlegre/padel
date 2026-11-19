import { SIM_DT, createConfig, type GameConfig, type QualityEffect } from '../config';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { createBall, stepBall, type BallEvent, type Surface, type WallId } from './ball';
import { teamDir } from './court';
import { receiverIndex, serveBoxSign, serveSpot } from './formation';
import { contactNear, planIntercept, type InterceptPlan } from './intercept';
import {
  ATTITUDE,
  BACK_LINE,
  CALL_BAND,
  cameToIt,
  chooseOwner,
  closestPass,
  COVER_COMMIT,
  COVER_SLACK,
  DISORDER,
  disorderChance,
  NET_LINE,
  createPairState,
  followPerson,
  secondLook,
  shouldCover,
  startingLane,
  type CallKind,
  type PairState,
} from './pair';
import {
  createPlayer,
  lowestContact,
  lungeReach,
  movePlayer,
  playerReach,
  playerSpeed,
  type Player,
  type PlayerSetup,
} from './player';
import { backpedalOf, ballPressure, type BallAsk, type PressureParts } from './pressure';
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
  type ShotParams,
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
  type SwingWhy,
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
      /**
       * 0..1, how hard the ball was to play: what the shot before this one
       * did to whoever hit it. It is what the body shows (a low volley dug
       * out, a stretch, a hurried step back), and why the answer came out weak.
       */
      pressure: number;
      /** A computer player's swing that was not an ordinary one, and why (see `SwingWhy`). */
      why?: SwingWhy;
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
  /**
   * A practice court: nobody serves and nothing is scored. Whoever runs the
   * practice sends the players to their places with `rest` and puts balls
   * in play with `feed`.
   */
  practice?: boolean;
}

/** A ball put in play on a practice court: where it lands and how it flies. */
export interface Feed {
  targetX: number;
  targetY: number;
  /** What the shot is called, for whoever shows or hears it. */
  kind: ShotKind;
  params: ShotParams;
  /** Height it is struck at. Left out, a comfortable one. */
  z?: number;
}

/** How long before contact the swing animation starts. */
const SWING_LEAD = 0.12;
const SWING_DURATION = 0.42;
/** How often the advice on where to stand is refreshed for a hand-moved player, in steps. */
const GUIDE_EVERY = 12;
/** A lob at least this good (0..1) is one to follow to the net. */
const FOLLOW_LOB = 0.5;
/** Doubles: a lob over a pair at the net that is played further from the net than this sends the pair back. */
const BACK_LOB = 7;
/**
 * Doubles: a partner closer than this to the one who hits is in the way (both
 * went for the same ball), and right on top of it that adds this much to how
 * hard the ball is to play.
 */
const CROWD_DISTANCE = 1.4;
const CROWD_PRESSURE = 0.45;
/** Doubles: a ball struck closer to the net than this, from inside the court, takes the one who struck it to the net. */
const ADVANCE_FROM = 6;
/** Doubles: a partner who goes for a ball after all can only say so this long (seconds) before the other one's contact. */
const CLAIM_LEAD = 0.25;
/** The calls that mean "I am going for it". Changing one's mind to one of these is allowed; away from them, not. */
const GOES_FOR_IT: ReadonlySet<CallKind> = new Set(['mine', 'switch']);
/** Doubles: a computer player looks again at a ball of its partner's every this many steps (about 20 times a second). */
const LOOK_EVERY = 6;
/**
 * A ball fired at a computer player before it has read it: the hands still
 * go to it, from this long after the shot (a reflex, quicker than reading
 * where to run: `REFLEX_SHARE` of its reaction, within these limits), for a
 * ball that passes within reach of where it stands.
 */
const REFLEX_SHARE = 0.5;
const REFLEX_MIN = 0.12;
const REFLEX_MAX = 0.2;
/** How far past the moment it reads the ball a block is still looked for, in seconds. */
const REFLEX_AHEAD = 0.1;
/** A computer player hands a ball it cannot get to over to the person only if the person gets there with this much to spare. */
const HANDOFF_SLACK = 0.3;
/** How much wilder a ball is when the body was later than any swing can be (`ShotIntent.lateBy`): a poke. */
const LATE_POKE = 2.5;

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
  /** Doubles: how each pair stands and who owns the ball that is coming (see src/sim/pair.ts). */
  readonly pairs: [PairState, PairState] = [createPairState(), createPairState()];
  /** The last player of each team to strike the ball in this point (-1 = nobody yet). */
  readonly lastHitter: [number, number] = [-1, -1];
  lastPoint: { winner: TeamId; reason: PointReason } | null = null;
  /** Hits in the current rally, the serve included. */
  rallyHits = 0;
  /** True until a person wins a point: the rival goes easy meanwhile. */
  tutorial: boolean;
  /** A practice court: see `MatchOptions.practice`. */
  readonly practice: boolean;
  /** Practice: the feeder is holding the ball it is about to put in play. */
  ballHeld = false;

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
    pressure: 0,
    backpedal: 0,
  };
  private readonly ask: BallAsk = { ballX: 0, ballY: 0, ballZ: 0, speed: 0, gap: 0, reach: 1, retreat: 0, risk: 0 };
  /** The risk the last shot took by aiming near the walls, if it came off. It makes the ball harder for whoever gets it. */
  private lastRisk = 0;
  /** Why the last ball that was hit was hard: what each thing added to its pressure. */
  readonly pressureParts: PressureParts = { below: 0, stretch: 0, pace: 0, cramped: 0, backpedal: 0, risk: 0 };
  private rallyStartedAt = 0;

  constructor(options: MatchOptions) {
    this.config = options.config ?? createConfig();
    this.seed = options.seed ?? 1;
    this.rng = new Rng(this.seed);
    this.teamNames = [options.teams[0].name, options.teams[1].name];
    this.format = { ...this.config.rules.format };
    this.tutorial = options.tutorial ?? false;
    this.practice = options.practice ?? false;
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
    if (this.practice) this.rest(this.players.map((player) => ({ x: player.spotX, y: player.spotY })), this.serverId, true);
    else this.beginServe();
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
    if (this.practice || this.phase !== 'pointOver' || this.afterPause !== 'serve') return false;
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
      this.updatePairs();
      this.updatePlans();
      for (let i = 0; i < this.players.length; i++) {
        const player = this.players[i]!;
        const intent = this.intents[i]!;
        resetIntent(intent);
        this.controllers[i]!.update(this, player, intent);
        if (intent.home) player.homeMode = intent.home;
        if (intent.claim) this.claim(player);
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

    if (this.phase === 'serve' || this.ballHeld) {
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
      // Every point starts fresh: nobody carries the last one in the legs.
      player.strain = 0;
      player.pressure = 0;
      player.lane = startingLane(player.team, player.index);
      player.astray = null;
      player.doubtUntil = 0;
      player.call = null;
      player.callTraj = -1;
    }
    this.phase = 'serve';
    this.rally.live = false;
    this.trajectory = null;
    this.assigned[0] = -1;
    this.assigned[1] = -1;
    this.lastHitter[0] = -1;
    this.lastHitter[1] = -1;
    for (const team of [0, 1] as const) {
      const pair = this.pairs[team];
      // The serving pair takes the net behind the serve; the other one waits at the back.
      pair.home = team === this.score.servingTeam ? 'net' : 'back';
      pair.backSince = -1;
      pair.trajId = -1;
      pair.doubted = -1;
      pair.leader = -1;
    }
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
    ball.kick = 0;
    ball.grip = 0;
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
    this.lastRisk = 0;
    this.serveIntent = null;
    this.lastHitter[server.team] = server.id;
    // In padel the serving side takes the net behind the serve.
    for (const mate of this.teams[server.team]) mate.homeMode = 'net';
    this.pairs[server.team].home = 'net';
    this.pairs[server.team].backSince = -1;
    this.pairs[otherTeam(server.team)].home = 'back';
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
      pressure: 0,
    });

    // The serve is returned by the player standing diagonally.
    const receivers = this.teams[otherTeam(server.team)];
    const receiver = receivers[receiverIndex(receivers.length, side)] ?? receivers[0]!;
    this.onBallStruck(server.team, receiver.id);
  }

  // ---------------------------------------------------------------- practice

  /**
   * Practice: everybody walks to a place, and `feeder` waits there with a
   * ball in its hand. `spots` goes by position in `players`. With `now`
   * they are put there at once.
   */
  rest(spots: ReadonlyArray<{ x: number; y: number }>, feeder: number, now = false): void {
    for (const player of this.players) {
      const spot = spots[player.id];
      if (spot) {
        player.spotX = spot.x;
        player.spotY = spot.y;
      }
      if (now) {
        player.x = player.spotX;
        player.y = player.spotY;
        player.px = player.x;
        player.py = player.y;
        player.vx = 0;
        player.vy = 0;
      }
      player.plan = null;
      player.guide = null;
      player.swing = null;
      player.swingLockUntil = 0;
      player.cue = null;
      player.homeMode = 'back';
      player.anim.kind = 'idle';
      player.strain = 0;
      player.pressure = 0;
    }
    this.serverId = feeder;
    this.rally.live = false;
    this.trajectory = null;
    this.assigned[0] = -1;
    this.assigned[1] = -1;
    this.phase = 'pointOver';
    this.phaseStarted = this.time;
    this.phaseUntil = Infinity;
    this.afterPause = 'serve';
    this.ballHeld = true;
    this.holdBall();
    this.ballPrev.x = this.ball.x;
    this.ballPrev.y = this.ball.y;
    this.ballPrev.z = this.ball.z;
  }

  /** Practice: true once everybody is where `rest` sent them. */
  get settled(): boolean {
    for (const player of this.players) {
      if (Math.hypot(player.x - player.spotX, player.y - player.spotY) > 0.12) return false;
    }
    return true;
  }

  /** Practice: the feeder plays the ball it is holding. From here on it is a rally like any other. */
  feed(feed: Feed): void {
    const feeder = this.server;
    const config = this.config;
    const ball = this.ball;
    this.holdBall();
    ball.z = feed.z ?? 0.9;
    const launch = solveShot(ball.x, ball.y, ball.z, feed.targetX, feed.targetY, feed.params, config.physics, config.court);
    ball.vx = launch.vx;
    ball.vy = launch.vy;
    ball.vz = launch.vz;
    const speed = Math.hypot(launch.vx, launch.vy, launch.vz);

    registerHit(this.rally, feeder.team, false, 1);
    this.phase = 'rally';
    this.rallyStartedAt = this.time;
    this.rallyHits = 1;
    this.lastRisk = 0;
    this.ballHeld = false;
    const anim = feeder.anim;
    anim.kind = 'swing';
    anim.t0 = this.time - SWING_LEAD;
    anim.duration = SWING_DURATION;
    anim.contactAt = this.time;
    anim.shot = feed.kind;
    anim.side = ball.x >= feeder.x ? 1 : -1;
    anim.reachX = ball.x - feeder.x;
    anim.reachY = ball.y - feeder.y;
    anim.reachZ = ball.z;
    this.events.push({
      type: 'hit',
      player: feeder.id,
      team: feeder.team,
      kind: feed.kind,
      forehand: true,
      volley: false,
      quality: 'good',
      error: 0,
      x: ball.x,
      y: ball.y,
      z: ball.z,
      speed,
      pressure: 0,
    });
    this.onBallStruck(feeder.team, -1);
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
    context.backpedal = backpedalOf(-player.vy * teamDir(player.team), plan.z, this.config);
    return shotKind(context, intent, this.config);
  }

  /**
   * How hard the ball this player is waiting for is going to be (0..1), as
   * things stand: from where it is and how it is moving right now. For the
   * aim marker, so it shows what the shot can really do.
   */
  expectedPressure(player: Player): number {
    const plan = player.plan;
    const point = plan && this.trajectory ? pointAt(this.trajectory, plan.t) : null;
    if (!plan || !point) return 0;
    const ask = this.ask;
    ask.ballX = plan.x;
    ask.ballY = plan.y;
    ask.ballZ = plan.z;
    ask.speed = Math.hypot(point.vx, point.vy, point.vz);
    ask.gap = Math.hypot(plan.x - player.x, plan.y - player.y);
    ask.reach = playerReach(player, this.config, plan.z) + lungeReach(this.config);
    ask.retreat = -player.vy * teamDir(player.team);
    ask.risk = this.lastRisk;
    return ballPressure(ask, this.config);
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
    const gap = Math.hypot(ball.x - player.x, ball.y - player.y);
    if (pc.realReach) {
      // What a body can do, the same for everybody: standing, or one long step, and not off the floor.
      const standing = playerReach(player, this.config, ball.z);
      if (gap > standing + pc.real.lunge) return false;
      if (ball.z < lowestContact(this.config, gap > standing) || ball.z > pc.maxContactZ + 0.15) return false;
    } else {
      if (ball.z < pc.minContactZ * 0.5 || ball.z > pc.maxContactZ + 0.15) return false;
      const reach = playerReach(player, this.config);
      // A late swing lunges; whoever runs by itself and did not quite get there stretches.
      const most = error > 0 ? reach + pc.lungeExtra : player.manual ? reach * 1.1 : reach + pc.stretchExtra;
      if (gap > most) return false;
    }
    this.executeHit(player, intent, error, gap);
    return true;
  }

  private executeHit(player: Player, intent: ShotIntent, clock: number, gap: number): void {
    const config = this.config;
    const pc = config.player;
    const shots = config.shots;
    const ball = this.ball;
    const rules = config.rules;
    // A body that got there late meets the ball as late as it really was (see `ShotIntent.lateBy`).
    const error = clock + (intent.lateBy ?? 0);
    const quality = qualityFromError(error, config.timing);
    const effect = shots.quality[quality];
    const dir = teamDir(player.team);
    const incoming = Math.hypot(ball.vx, ball.vy, ball.vz);
    const reach = playerReach(player, config, ball.z);
    const retreat = -player.vy * dir;

    // What the ball asks of the player: that is the work of the shot before this one.
    const ask = this.ask;
    ask.ballX = ball.x;
    ask.ballY = ball.y;
    ask.ballZ = ball.z;
    ask.speed = incoming;
    ask.gap = gap;
    ask.reach = reach + lungeReach(config);
    ask.retreat = retreat;
    ask.risk = this.lastRisk;
    let pressure = ballPressure(ask, config, this.pressureParts);
    // Doubles: two of a pair on top of the same ball get in each other's way.
    const crowd = this.crowding(player);
    if (crowd > 0) {
      pressure = Math.min(1, pressure + crowd * CROWD_PRESSURE);
      this.pressureParts.cramped += crowd * CROWD_PRESSURE;
    }

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
      pressure,
      backpedal: backpedalOf(retreat, ball.z, config),
    };
    // The shot that comes out: the timing and the pressure are already in it.
    const shot = resolveShot(context, intent, config, quality);

    // How wild it is. The ball itself (reached at full stretch, coming fast,
    // dug out from the floor), the risk the player chose by aiming close to
    // the walls, and what the rally has done to the player so far: a run of
    // difficult balls gets to anybody, to some sooner than to others.
    const stretch = clamp((gap - pc.sweetSpot) / (reach - pc.sweetSpot), 0, 1.5);
    const fast = clamp((incoming - shots.paceFrom) / 12, 0, 1.5);
    const low = clamp((0.45 - ball.z) / 0.45, 0, 1);
    const strain = player.strain + (intent.tension ?? 0);
    let scale =
      1 +
      stretch * shots.stretchPenalty +
      fast * shots.pacePenalty +
      low * shots.lowPenalty +
      shot.risk * shots.riskPenalty +
      pressure * shots.pressure.scatterAdd +
      Math.max(0, strain - rules.strain.from) * rules.strain.error * (1 - player.composure) +
      this.heat * rules.heatError;
    scale *= player.errorScale * (intent.scatter ?? 1);
    // Later than any swing can be: the ball is only poked at.
    if (error > config.timing.lateMax) scale *= LATE_POKE;
    player.strain = player.strain * rules.strain.carry + pressure;
    player.pressure = pressure;
    this.lastRisk = quality === 'late' ? 0 : shot.risk;

    const params = {
      clearance: shot.params.clearance,
      apex: shot.params.apex,
      speed: shot.params.speed * (1 + this.heat),
    };
    const launch =
      shot.kind === 'backWall'
        ? solveBackWall(ball.x, ball.y, ball.z, shot.targetX, shot.targetY, player.team, params, config.physics, config.court)
        : solveShot(ball.x, ball.y, ball.z, shot.targetX, shot.targetY, params, config.physics, config.court);
    this.rallyHits++;
    const x = ball.x;
    const y = ball.y;
    const z = ball.z;
    const speed = this.launch(launch, effect, scale);
    ball.kick = shot.kick;
    ball.grip = shot.grip;

    registerHit(this.rally, player.team, false, 1);
    this.lastHitter[player.team] = player.id;
    // Striking the ball is the moment a pair gets back in order.
    for (const mate of this.teams[player.team]) mate.astray = null;
    player.swing = null;
    player.anim.kind = 'swing';
    player.anim.t0 = this.time - SWING_LEAD;
    player.anim.contactAt = this.time;
    player.anim.shot = shot.kind;
    player.anim.side = ball.x >= player.x ? 1 : -1;
    player.anim.reachX = x - player.x;
    player.anim.reachY = y - player.y;
    player.anim.reachZ = z;
    // After an attacking shot hold the net; otherwise fall back. A lob that
    // came out short is no way to the net: it is about to be smashed. A
    // controller can overrule this with its own idea of where to wait.
    const attacking =
      shot.kind === 'lob'
        ? shot.lobQuality >= FOLLOW_LOB
        : shot.kind === 'drop' || shot.kind === 'volley' || shot.kind === 'smash' || shot.kind === 'bandeja' || shot.kind === 'vibora';
    // In doubles a ball taken inside the court is a way to the net too: whoever came forward for it keeps going.
    const advancing = this.teams[player.team].length === 2 && shot.kind !== 'lob' && shot.kind !== 'backWall' && Math.abs(y) < ADVANCE_FROM;
    player.homeMode = attacking || advancing ? 'net' : 'back';

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
      pressure,
      why: intent.why,
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
    ball.kick = 0;
    ball.grip = 0;
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
    const pair = this.pairs[receiving];
    pair.trajId = trajectory.id;
    if (receiverId >= 0) {
      this.assigned[receiving] = receiverId;
      pair.why = 'alone';
      pair.offMiddle = Infinity;
      pair.switchChecked = true;
      return;
    }
    const members = this.teams[receiving];
    if (members.length !== 2) {
      // Alone (or more than a pair, which padel does not have): whoever gets to the ball with more time takes it.
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
      return;
    }
    // A pair: the ball is the one's on its side, the middle the forehand's (see src/sim/pair.ts).
    const plans = this.pairPlans;
    plans[0] = planIntercept(trajectory, members[0]!, this.time, this.config);
    plans[1] = planIntercept(trajectory, members[1]!, this.time, this.config);
    const owner = chooseOwner(members, plans, trajectory, this.time, pair, this.config.player.maxContactZ);
    this.assigned[receiving] = owner.id;
    // Whoever went up on its own goes back if the ball goes over its head.
    const leader = members.findIndex((player) => player.id === pair.leader);
    const lead = leader >= 0 ? plans[leader] : null;
    if (leader >= 0 && (!lead || (lead.kind !== 'volley' && Math.abs(lead.y) > BACK_LOB))) pair.leader = -1;
    // A lob over a pair at the net that the owner lets bounce: the two of them go back together.
    const plan = plans[members.indexOf(owner)];
    if (!members.some((player) => player.manual) && pair.home === 'net' && plan && plan.kind !== 'volley' && Math.abs(plan.y) > BACK_LOB) {
      this.shift(receiving, 'back', owner);
    }
    if (!members.some((player) => player.isHuman)) this.doubtOrNot(members, owner, trajectory, pair);
  }

  /**
   * Two computer players may doubt over a ball: both look at the other and
   * the one whose ball it is goes late. Through the middle that happens to
   * those without much composure. Into the hole of a pair that is out of
   * place (split, or somebody half way) it happens far more: nobody knows
   * whose it is. And whoever is out of place is caught flat-footed by a ball
   * of its own. A pair with a person in it never doubts: the person decides.
   */
  private doubtOrNot(members: readonly Player[], owner: Player, trajectory: Trajectory, pair: PairState): void {
    const a = members[0]!;
    const b = members[1]!;
    a.doubtUntil = 0;
    b.doubtUntil = 0;
    const composure = (a.composure + b.composure) / 2;
    const strain = (a.strain + b.strain) / 2;
    const loose = a.astray !== null || b.astray !== null || shapeOf(a) !== shapeOf(b);
    const highest = this.config.player.maxContactZ;
    const passA = closestPass(trajectory, a, this.time, highest);
    const passB = closestPass(trajectory, b, this.time, highest);
    const hole = loose && passA > DISORDER.holeGap && passB > DISORDER.holeGap;
    const base = hole ? DISORDER.hole : pair.why === 'middle' ? DISORDER.doubt : 0;
    if (base > 0 && this.rng.chance(disorderChance(base, composure, strain))) {
      // Into the hole, now and then nobody goes at all: the ball goes between them.
      const neither = hole && this.rng.chance(disorderChance(DISORDER.neither, composure, strain));
      const doubt = hole ? DISORDER.holeTime : DISORDER.doubtTime;
      for (const player of members) player.doubtUntil = neither ? Infinity : this.time + player.reaction + doubt;
      pair.doubted = trajectory.id;
      // Neither of them takes a second look at it either.
      if (neither) pair.switchChecked = true;
      return;
    }
    if (owner.astray && (owner === a ? passA : passB) < DISORDER.holeGap) {
      // Out of place, and the ball comes at it: caught flat-footed.
      owner.doubtUntil = this.time + owner.reaction + DISORDER.caught;
    }
  }

  /**
   * A pair of computer players changes where it waits, as `leader` decided.
   * The other one may not follow: it stays where the pair was, or stops half
   * way. That is the hole the other side can punish, and the one who went
   * says so to its partner, which is how the other side sees it. A pair with a
   * person in it never comes apart by itself: the person leads it.
   */
  private shift(team: TeamId, home: 'back' | 'net', leader: Player): void {
    const pair = this.pairs[team];
    if (pair.home === home) return;
    const before = pair.home;
    pair.home = home;
    const members = this.teams[team];
    if (members.length !== 2 || members.some((player) => player.isHuman)) return;
    const other = members[0] === leader ? members[1]! : members[0]!;
    other.astray = null;
    const stay = disorderChance(DISORDER.stay, other.composure, other.strain);
    const halfway = disorderChance(DISORDER.halfway, other.composure, other.strain);
    const roll = this.rng.next();
    if (roll < stay) {
      other.astray = 'stay';
      other.astrayHome = before;
      this.say(leader, home === 'net' ? 'up' : 'back', this.trajectory?.id ?? -1);
    } else if (roll < stay + halfway) {
      other.astray = 'halfway';
    }
  }

  /** 0..1, how much the partner of `player` is in its way right now: 1 on top of it, 0 from `CROWD_DISTANCE` away. */
  private crowding(player: Player): number {
    let most = 0;
    for (const mate of this.teams[player.team]) {
      if (mate === player) continue;
      const distance = Math.hypot(mate.x - player.x, mate.y - player.y);
      most = Math.max(most, 1 - distance / CROWD_DISTANCE);
    }
    return most;
  }

  /** Scratch for the contacts the two of a pair could make. */
  private readonly pairPlans: Array<InterceptPlan | null> = [null, null];

  /**
   * Doubles, every step: where each pair waits, the lob over a person at the
   * net that the partner crosses for, and what the computer players tell
   * their partners. None of this draws a random number.
   */
  private updatePairs(): void {
    if (this.phase !== 'rally') return;
    const trajectory = this.trajectory;
    for (const team of [0, 1] as const) {
      const members = this.teams[team];
      if (members.length !== 2) continue;
      const pair = this.pairs[team];
      const person = members.find((player) => player.manual) ?? null;
      const rally = this.rally;
      if (person) {
        const mate = members[0] === person ? members[1]! : members[0]!;
        followPerson(pair, person, this.time, ATTITUDE[mate.manual ? 'balanced' : mate.attitude]);
        this.lead(team, person, mate);
      } else if (rally.hitter === team) {
        // While the ball is theirs, the pair goes where the one who struck it decided to wait.
        const last = this.lastHitter[team];
        if (last >= 0) this.shift(team, this.players[last]!.homeMode, this.players[last]!);
      }

      const incoming = trajectory !== null && rally.live && rally.hitter !== team && pair.trajId === trajectory.id;
      if (!incoming || !trajectory) continue;
      const ownerId = this.assigned[team];
      const owner = this.players[ownerId];
      if (!owner) continue;
      const partner = members[0] === owner ? members[1]! : members[0]!;

      // A second look, once both have read the ball: the partner crosses for a lob over the head of a person at the net.
      const readBy = trajectory.t0 + Math.max(partner.reaction, owner.manual ? 0 : owner.reaction);
      if (!partner.manual && !pair.switchChecked && this.time >= readBy) {
        const plans = this.pairPlans;
        plans[0] = planIntercept(trajectory, members[0]!, this.time, this.config);
        plans[1] = planIntercept(trajectory, members[1]!, this.time, this.config);
        const other = secondLook(members, owner, plans, pair);
        if (other) {
          this.assigned[team] = other.id;
          if (!owner.manual) owner.plan = null;
          this.say(other, 'switch', trajectory.id);
          continue;
        }
      }
      // And it keeps an eye on it: if the owner is not getting there and it can, it goes, saying so.
      if (this.watch(team, owner, partner, trajectory, pair)) continue;

      // What the computer players say about this ball, once they have read it.
      const ambiguous = Math.abs(pair.offMiddle) <= CALL_BAND;
      if (pair.doubted === trajectory.id) {
        // They doubt: each one points at the other.
        for (const player of members) if (this.time >= trajectory.t0 + player.reaction) this.say(player, 'yours', trajectory.id);
        continue;
      }
      const plan = owner.plan;
      if (!owner.isHuman && partner.manual && plan && !plan.reachable && owner.callTraj !== trajectory.id && this.time >= trajectory.t0 + owner.reaction) {
        // Honest about what it does not get to: if the person can, it is the person's, and it says so at once.
        // Only what it cannot get a racket to, though: a ball that still passes within a stretch of it, it goes for.
        const stretch = contactNear(trajectory, owner, this.time, this.config, undefined, 0, undefined, false);
        const theirs = stretch ? null : planIntercept(trajectory, partner, this.time, this.config);
        if (theirs && theirs.reachable && theirs.slack >= HANDOFF_SLACK) {
          this.assigned[team] = partner.id;
          owner.plan = null;
          pair.why = 'cover';
          this.say(owner, 'yours', trajectory.id);
          continue;
        }
      }
      if (!owner.isHuman && plan && this.time >= trajectory.t0 + owner.reaction) {
        // A lob over the two of them that it lets bounce, with the person still at the net: back, together.
        const overBoth = plan.kind !== 'volley' && Math.abs(plan.y) > BACK_LOB && partner.manual && Math.abs(partner.y) < NET_LINE;
        if (pair.why === 'switch') this.say(owner, 'switch', trajectory.id);
        else if (overBoth) this.say(owner, 'back', trajectory.id);
        else if (pair.why === 'cover' || ambiguous) this.say(owner, 'mine', trajectory.id);
      }
      // The other one, if it is a computer player: "¡tuya!" for a ball that could have been its own.
      if (!partner.isHuman && this.time >= trajectory.t0 + partner.reaction) {
        const leftToPerson = owner.manual && (ambiguous || pair.why === 'cover');
        if (leftToPerson || (!owner.manual && ambiguous && pair.why !== 'cover' && pair.why !== 'switch')) {
          this.say(partner, 'yours', trajectory.id);
        }
      }
    }

    // A lob of a computer player that got past the other pair: up to the net, and it says so to the person.
    const rally = this.rally;
    if (rally.live && rally.bounces === 1 && trajectory) {
      const team = rally.hitter;
      const members = this.teams[team];
      const hitter = this.players[this.lastHitter[team]];
      const person = members.find((player) => player.manual);
      if (members.length === 2 && hitter && !hitter.isHuman && person && hitter.anim.shot === 'lob' && hitter.homeMode === 'net' && Math.abs(person.y) > BACK_LINE) {
        this.say(hitter, 'up', trajectory.id);
      }
    }
  }

  /**
   * Doubles: a computer player keeps an eye on a ball that is its partner's,
   * a few times a second once it has read it, and takes it when the partner
   * is not getting there (see `shouldCover`). Not while the two of them
   * doubt over it, and not a ball that is going out. Returns true when it
   * took it.
   */
  private watch(team: TeamId, owner: Player, watcher: Player, trajectory: Trajectory, pair: PairState): boolean {
    if (watcher.isHuman || this.tick % LOOK_EVERY !== 0 || pair.doubted === trajectory.id) return false;
    if (this.time < trajectory.t0 + watcher.reaction || (!owner.manual && this.time < trajectory.t0 + owner.reaction)) return false;
    if (this.shouldLeave(team)) return false;
    const config = this.config;
    const near = owner.manual ? owner.plan : null;
    if (owner.manual) {
      // It has come to be at it, and not at the person: it stops and plays it from where it is.
      const stand = contactNear(trajectory, watcher, this.time, config, COVER_COMMIT, 0, undefined, false);
      const reach = stand ? playerReach(owner, config, stand.z) + (config.player.realReach ? lungeReach(config) : 0) : 0;
      if (cameToIt(watcher, owner, stand, near, this.time, playerSpeed(owner, config), reach)) {
        this.take(team, owner, watcher, trajectory, pair);
        watcher.plan = stand;
        return true;
      }
    }
    const mine = planIntercept(trajectory, watcher, this.time, config);
    if (!mine || !mine.reachable || mine.slack < COVER_SLACK) return false;
    const run = owner.manual ? planIntercept(trajectory, owner, this.time, config) : owner.plan;
    const reach = playerReach(owner, config, mine.z) + (config.player.realReach ? lungeReach(config) : 0);
    if (!shouldCover(watcher, owner, mine, run, near, this.time, playerSpeed(owner, config), reach)) return false;
    this.take(team, owner, watcher, trajectory, pair);
    return true;
  }

  /** Doubles: `taker` covers a ball that was `owner`'s, and says so. */
  private take(team: TeamId, owner: Player, taker: Player, trajectory: Trajectory, pair: PairState): void {
    this.assigned[team] = taker.id;
    if (!owner.manual) owner.plan = null;
    pair.why = 'cover';
    this.say(taker, 'mine', trajectory.id);
  }

  /**
   * Doubles, next to a person: a partner whose attitude is to lead goes up
   * behind an attacking shot of its own even with the person at the back,
   * and calls the person up («¡arriba!»). It stays up until the person plays
   * a ball (and decides where the pair goes) or the pair is at the net.
   */
  private lead(team: TeamId, person: Player, mate: Player): void {
    const pair = this.pairs[team];
    const rally = this.rally;
    if (pair.leader >= 0 && (pair.home === 'net' || (rally.hitter === team && this.lastHitter[team] === person.id))) pair.leader = -1;
    if (pair.leader >= 0 || mate.manual || !ATTITUDE[mate.attitude].leads) return;
    if (!rally.live || rally.hitter !== team || this.lastHitter[team] !== mate.id || mate.homeMode !== 'net') return;
    if (pair.home === 'net' || Math.abs(person.y) < NET_LINE) return;
    pair.leader = mate.id;
    this.say(mate, 'up', this.trajectory?.id ?? -1);
  }

  /**
   * A player tells its partner something about a ball: once per ball, unless
   * it changes its mind and goes for it after all («¡tuya!... ¡mía!»).
   */
  private say(player: Player, call: CallKind, trajId: number): void {
    if (player.callTraj === trajId && (player.call === call || !GOES_FOR_IT.has(call) || GOES_FOR_IT.has(player.call!))) return;
    player.call = call;
    player.callAt = this.time;
    player.callTraj = trajId;
  }

  /**
   * «¡mía!»: a computer player goes for a ball that is its partner's. It is
   * taken while the ball is still on its way, never when the partner is about
   * to play it: there has to be time for the partner to hear it.
   */
  private claim(player: Player): void {
    const trajectory = this.trajectory;
    const team = player.team;
    if (player.isHuman || this.phase !== 'rally' || !trajectory || !this.rally.live || this.rally.hitter === team) return;
    const pair = this.pairs[team];
    if (this.teams[team].length !== 2 || this.assigned[team] === player.id || pair.trajId !== trajectory.id) return;
    const owner = this.players[this.assigned[team]];
    if (!owner || this.shouldLeave(team)) return;
    if (owner.plan && owner.plan.trajId === trajectory.id && owner.plan.t - this.time < CLAIM_LEAD) return;
    this.assigned[team] = player.id;
    pair.why = 'steal';
    if (!owner.manual) owner.plan = null;
    for (const mate of this.teams[team]) mate.doubtUntil = 0;
    this.say(player, 'mine', trajectory.id);
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
      if (this.time < player.doubtUntil) continue;
      // The player needs a moment to read a new ball. One fired at it gets the racket anyway: a block, from where it stands.
      const readAt = trajectory.t0 + player.reaction;
      if (this.time < readAt) {
        const reflex = trajectory.t0 + clamp(player.reaction * REFLEX_SHARE, REFLEX_MIN, REFLEX_MAX);
        if (!player.plan && this.time >= reflex && !this.shouldLeave(player.team)) {
          const block = contactNear(trajectory, player, this.time, this.config, readAt - this.time + REFLEX_AHEAD, 0, undefined, false);
          if (block) {
            block.reflex = true;
            player.plan = block;
          }
        }
        continue;
      }

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

    if (this.practice) {
      // Nothing is scored here: the result is only told, and the ball is left where it is.
      if (result.kind === 'point') this.events.push({ type: 'point', winner: result.winner, reason: result.reason });
      return;
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

/** Where a player stands, for a pair: at the net, half way or at the back. */
function shapeOf(player: Player): 'net' | 'mid' | 'back' {
  const depth = Math.abs(player.y);
  return depth < NET_LINE ? 'net' : depth > BACK_LINE ? 'back' : 'mid';
}

