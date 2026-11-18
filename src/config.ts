import type { MatchFormat } from './sim/score';
import type { Quality, ShotKind } from './sim/types';

/**
 * Every tunable of the game lives here.
 * Units are metres, seconds and metres per second unless noted otherwise.
 *
 * World axes: x runs across the court (-5 left .. +5 right as seen from the
 * camera), y runs along it (-10 near back wall .. +10 far back wall, net at 0)
 * and z points up.
 */

export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;

/**
 * Bump this whenever a change makes the same inputs play out differently
 * (physics, rules, shot maths, AI). Recorded matches carry the version they
 * were played with, so an old recording is replayed right or cleanly refused.
 */
export const PHYSICS_VERSION = 1;

export interface SideSegment {
  /** Distance from the back wall where this segment ends. */
  upTo: number;
  /** Height where the glass ends (0 = no glass, fence from the floor). */
  glass: number;
  /** Height where the fence ends. Anything above flies out of the court. */
  fence: number;
}

export interface CourtConfig {
  halfWidth: number;
  halfLength: number;
  /** Distance from the net to each service line. */
  serviceLine: number;
  netCenter: number;
  netPost: number;
  backGlass: number;
  backFence: number;
  side: SideSegment[];
}

export interface PhysicsConfig {
  gravity: number;
  ballRadius: number;
  /** Vertical speed kept after a bounce on the floor. */
  floorRestitution: number;
  /** Horizontal speed kept after a bounce on the floor. */
  floorGrip: number;
  glassRestitution: number;
  glassGrip: number;
  /** The fence kills the ball: low restitution and a lot of speed lost. */
  fenceRestitution: number;
  fenceGrip: number;
  netRestitution: number;
  netGrip: number;
  /** Half height of the band around the tape where the ball clips it and still goes over. */
  cordBand: number;
  /** Impacts slower than this stop bouncing and start rolling. */
  rollSpeed: number;
  rollDecel: number;
}

export interface PlayerConfig {
  maxSpeed: number;
  accel: number;
  radius: number;
  /** How close to the net a player may stand. */
  netGap: number;
  /**
   * Horizontal distance from the body at which the ball can be hit. Each
   * player multiplies it by its own `reachScale`: a person gets a generous
   * reach, so getting close is enough.
   */
  reach: number;
  /** Extra reach for a swing that comes late, when the ball has already gone by. */
  lungeExtra: number;
  /** Ideal lateral distance between body and ball at contact. */
  sweetSpot: number;
  /** The ball is taken slightly in front of the body. */
  contactAhead: number;
  minContactZ: number;
  maxContactZ: number;
  /** A ball at least this high is played over the head... */
  overheadZ: number;
  /** ...as a smash this close to the net... */
  smashMaxNetDistance: number;
  /** ...and as a bandeja or a víbora up to here. */
  overheadMaxNetDistance: number;
  /** A ball taken in the air this close to the net is a volley. */
  volleyMaxNetDistance: number;
  /**
   * A ball that got past the player and is this close to its own back wall
   * is played against the glass (contrapared).
   */
  backWallZone: number;
  backWallBehind: number;
  /** Distance from the net of the two resting positions. */
  homeBack: number;
  homeNet: number;
}

export interface TimingConfig {
  /** A swing this close to the ideal contact is perfect. */
  perfect: number;
  /** A swing up to this late is good; later than that it is "late". */
  good: number;
  /** A swing this long after the ideal contact can still reach the ball. */
  lateMax: number;
  /** Minimum time between two swings: a new one replaces the armed one. */
  reswipeGap: number;
  /** An automatically moved player waits this long for a ball slightly out of reach. */
  graceAfter: number;
  /** Subtracted from the swing time of human players: touch and display latency. */
  latencyCompensation: number;
  /** After missing a contact, the next opportunity has to be at least this far ahead. */
  replanLead: number;
  /**
   * How far ahead a hand-moved player looks for the ball passing within reach.
   * Long enough to see the rebound off the back glass while the ball goes by.
   */
  manualLookahead: number;
  /**
   * Assisted movement only: a person who swings while the player is waiting
   * for a later contact takes the ball right there if it passes within reach
   * in the next `takeNow` seconds (or did in the last `takeNowBack`).
   */
  takeNow: number;
  takeNowBack: number;
}

export interface ShotSpec {
  /** Distance from the net where the ball lands: from `depthNear` to `depthFar` as the player asks for more depth. */
  depthNear: number;
  depthFar: number;
  /** Minimum height above the net tape. */
  clearance: number;
  /** Peak height of the arc. 0 means "as flat as `speed` allows". */
  apex: number;
  /** Top horizontal speed. */
  speed: number;
  /** Half width of the zone the shot can be aimed at. */
  aimRange: number;
}

/**
 * What a timing quality does to the shot. The scatter is applied to the
 * launch, not to the landing point: a flat, fast ball leaves little margin
 * over the net and before the back wall, a high and slow one forgives a lot.
 * Errors into the net, long and wide all come out of the same three numbers.
 */
export interface QualityEffect {
  /** Scatter of the horizontal direction, in degrees. */
  azimuth: number;
  /** Scatter of the launch angle, in degrees. */
  elevation: number;
  /** Scatter of the launch speed, as a fraction. */
  speed: number;
  /** Multiplier on the speed of the shot. */
  pace: number;
  /** Extra net clearance: a floating ball. */
  lift: number;
  /** 0..1, how much the landing point is pulled back toward mid court. */
  shorten: number;
}

export interface ShotsConfig {
  specs: Record<ShotKind, ShotSpec>;
  quality: Record<Quality, QualityEffect>;
  /** Scatter of the serve, which has no timing: same fields as a quality. */
  serve: QualityEffect;
  /** Asking for this little depth (0..1) or less is a chiquita. */
  dropAt: number;
  /** An overhead from mid court aimed at least this wide (0..1) is a víbora, otherwise a bandeja. */
  viboraAim: number;
  /** Extra scatter when the ball is hit away from the sweet spot. */
  stretchPenalty: number;
  /** Extra scatter against a fast incoming ball (above `paceFrom` m/s). */
  pacePenalty: number;
  paceFrom: number;
  /** Extra scatter when the ball is dug out close to the floor. */
  lowPenalty: number;
  /** Extra scatter when aiming close to the walls: the risk the player chooses. */
  riskPenalty: number;
  /** Depth weak shots are pulled toward. */
  shortDepth: number;
}

export interface RulesConfig {
  format: MatchFormat;
  serveAttempts: number;
  /** Pause after a point, a game and a fault before the next serve. */
  pointPause: number;
  gamePause: number;
  faultPause: number;
  /** The pause can be skipped once this much of it has passed. */
  skipAfter: number;
  /** Lateral position of the server and distance behind the service line. */
  serverX: number;
  serverBehindLine: number;
  /** Height the ball is released from, and speed it is thrown down with. */
  serveDropHeight: number;
  serveDropSpeed: number;
  /** Time between the release and the hit. */
  serveWindup: number;
  /** A point that lasts longer than this is replayed (safety net). */
  maxPointTime: number;
  /**
   * Long rallies heat up: after `heatAfter` hits every further hit is
   * `heatPerHit` faster, up to `heatMax`, and that much harder to control
   * (`heatError` times the heat is added to the scatter). It keeps points
   * short and tense.
   */
  heatAfter: number;
  heatPerHit: number;
  heatMax: number;
  heatError: number;
}

/** How a computer player plays. Nothing here lets it break the rules a person plays by. */
export interface AILevel {
  /** Delay before it starts moving to a new ball. */
  reaction: number;
  speedFactor: number;
  /** Standard deviation of its swing timing, in seconds. */
  timingSigma: number;
  /** Multiplier on the scatter of its shots (1 = same as a person). */
  errorScale: number;
  /** 0..1, how often it picks the best target instead of a random one. */
  smart: number;
  lobChance: number;
  dropChance: number;
  /** 0..1, how often it follows its serve and its attacking shots to the net. */
  netRush: number;
  /** Seconds it takes to serve once in position. */
  serveDelay: number;
}

export type RivalId = 'lola' | 'tincho' | 'mora';

export interface GameConfig {
  court: CourtConfig;
  physics: PhysicsConfig;
  player: PlayerConfig;
  timing: TimingConfig;
  shots: ShotsConfig;
  rules: RulesConfig;
  rivals: Record<RivalId, AILevel>;
}

/** The two ways to play a match today. Both are real padel: full games and golden point. */
export const FORMATS = {
  /** The one-touch match: first to 2 games. */
  quick: { gamesToWin: 2, setsToWin: 1, goldenPoint: true, tieBreakAt: null, tieBreakPoints: 5 },
  /** A short set: first to 4 games, with a short tie-break at 3-3. */
  match: { gamesToWin: 4, setsToWin: 1, goldenPoint: true, tieBreakAt: 3, tieBreakPoints: 5 },
} satisfies Record<string, MatchFormat>;

export type FormatName = keyof typeof FORMATS;

const defaults: GameConfig = {
  court: {
    halfWidth: 5,
    halfLength: 10,
    serviceLine: 6.95,
    netCenter: 0.88,
    netPost: 0.92,
    backGlass: 3,
    backFence: 4,
    side: [
      { upTo: 2, glass: 3, fence: 4 },
      { upTo: 4, glass: 2, fence: 3 },
      { upTo: 10, glass: 0, fence: 3 },
    ],
  },
  physics: {
    gravity: 9.8,
    ballRadius: 0.05,
    floorRestitution: 0.72,
    floorGrip: 0.8,
    glassRestitution: 0.62,
    glassGrip: 0.94,
    fenceRestitution: 0.28,
    fenceGrip: 0.55,
    netRestitution: 0.1,
    netGrip: 0.3,
    cordBand: 0.035,
    rollSpeed: 0.8,
    rollDecel: 3,
  },
  player: {
    maxSpeed: 5.2,
    accel: 26,
    radius: 0.35,
    netGap: 0.6,
    reach: 1.25,
    lungeExtra: 0.6,
    sweetSpot: 0.62,
    contactAhead: 0.2,
    minContactZ: 0.15,
    maxContactZ: 2.7,
    overheadZ: 1.9,
    smashMaxNetDistance: 4.5,
    overheadMaxNetDistance: 8,
    volleyMaxNetDistance: 6,
    backWallZone: 2.4,
    backWallBehind: 0.25,
    homeBack: 7.4,
    homeNet: 3.2,
  },
  timing: {
    perfect: 0.06,
    good: 0.15,
    lateMax: 0.24,
    reswipeGap: 0.15,
    graceAfter: 0.1,
    latencyCompensation: 0.03,
    replanLead: 0.2,
    manualLookahead: 1.1,
    takeNow: 0.15,
    takeNowBack: 0.06,
  },
  shots: {
    specs: {
      serve: { depthNear: 5.8, depthFar: 5.8, clearance: 0.45, apex: 0, speed: 13.5, aimRange: 1.6 },
      // Groundstroke: derecha or revés.
      drive: { depthNear: 4.8, depthFar: 8.2, clearance: 0.55, apex: 0, speed: 16, aimRange: 3.8 },
      volley: { depthNear: 4.6, depthFar: 7.6, clearance: 0.3, apex: 0, speed: 18, aimRange: 3.9 },
      lob: { depthNear: 8.3, depthFar: 8.3, clearance: 2, apex: 5.6, speed: 30, aimRange: 3.4 },
      // Chiquita (after the bounce) or dejada (in the air): short and soft.
      drop: { depthNear: 2.2, depthFar: 2.2, clearance: 0.3, apex: 0, speed: 9, aimRange: 3.4 },
      // Steep and short on purpose: it bounces over the walls or back over the net.
      smash: { depthNear: 3.6, depthFar: 3.6, clearance: 0.2, apex: 0, speed: 26, aimRange: 3.7 },
      // The safe overhead from mid court: deep, to keep the net.
      bandeja: { depthNear: 7.6, depthFar: 7.6, clearance: 0.45, apex: 0, speed: 15, aimRange: 3.2 },
      // The aggressive one: faster, lower and to the side.
      vibora: { depthNear: 7, depthFar: 7, clearance: 0.3, apex: 0, speed: 19.5, aimRange: 3.9 },
      // Off the back glass: higher over the net, to win time.
      wallExit: { depthNear: 5.2, depthFar: 8, clearance: 0.9, apex: 0, speed: 13.5, aimRange: 3.6 },
      // Against the own back glass; `speed` is how hard it is sent into it.
      backWall: { depthNear: 6.5, depthFar: 6.5, clearance: 0.6, apex: 0, speed: 21, aimRange: 3 },
    },
    quality: {
      perfect: { azimuth: 0.5, elevation: 0.5, speed: 0.01, pace: 1.12, lift: 0, shorten: 0 },
      good: { azimuth: 1.3, elevation: 1.2, speed: 0.02, pace: 1, lift: 0.1, shorten: 0 },
      // Swinging early arms the shot and it is played when the ball arrives:
      // as good as a good one, it only misses the perfect.
      early: { azimuth: 1.3, elevation: 1.2, speed: 0.02, pace: 1, lift: 0.1, shorten: 0 },
      // A late ball still goes back, weak and high. It is risk and pressure
      // that send it out, not the timing by itself.
      late: { azimuth: 2.4, elevation: 1.6, speed: 0.035, pace: 0.76, lift: 0.7, shorten: 0.35 },
    },
    serve: { azimuth: 0.7, elevation: 0.7, speed: 0.012, pace: 1, lift: 0, shorten: 0 },
    dropAt: 0.22,
    viboraAim: 0.55,
    stretchPenalty: 0.6,
    pacePenalty: 0.8,
    paceFrom: 9,
    lowPenalty: 0.5,
    riskPenalty: 1.6,
    shortDepth: 4.8,
  },
  rules: {
    format: { ...FORMATS.quick },
    serveAttempts: 2,
    pointPause: 1,
    gamePause: 1,
    faultPause: 0.8,
    skipAfter: 0.25,
    serverX: 2.2,
    serverBehindLine: 0.9,
    serveDropHeight: 1.0,
    serveDropSpeed: 1.5,
    serveWindup: 0.57,
    maxPointTime: 90,
    heatAfter: 5,
    heatPerHit: 0.03,
    heatMax: 0.45,
    heatError: 1.2,
  },
  rivals: {
    // Calm: stays back and puts everything in the middle.
    lola: {
      reaction: 0.4,
      speedFactor: 0.74,
      timingSigma: 0.2,
      errorScale: 1.4,
      smart: 0.25,
      lobChance: 0.1,
      dropChance: 0.02,
      netRush: 0.1,
      serveDelay: 1.2,
    },
    // Lobs a lot and takes the net behind them.
    tincho: {
      reaction: 0.28,
      speedFactor: 0.88,
      timingSigma: 0.11,
      errorScale: 1.1,
      smart: 0.55,
      lobChance: 0.38,
      dropChance: 0.06,
      netRush: 0.8,
      serveDelay: 1,
    },
    // Attacks: serve and volley, smashes whatever is short.
    mora: {
      reaction: 0.2,
      speedFactor: 0.96,
      timingSigma: 0.085,
      errorScale: 1,
      smart: 0.85,
      lobChance: 0.14,
      dropChance: 0.12,
      netRush: 1,
      serveDelay: 0.9,
    },
  },
};

/** A fresh, independent copy of the default configuration. */
export function createConfig(): GameConfig {
  return structuredClone(defaults);
}

/** How touches, mouse drags and keys turn into movement and shots. Not used by the simulation. */
export interface ControlsConfig {
  /** A touch has to start below this fraction of the screen height (0 = anywhere). */
  zoneTop: number;
  /** A touch that moves less than this, in CSS pixels, is a tap. */
  tapMaxDistance: number;
  /** Floating stick: radius in CSS pixels, and the part of it that does nothing. */
  stickRadius: number;
  stickDeadzone: number;
  /**
   * Two-thumb scheme: the pad under the aiming thumb, in CSS pixels measured
   * from where the thumb went down.
   *   sideways `aimRadius`   aims at the edge of the court
   *   up `deepAt`            asks for full depth
   *   up `lobAt` or more     is a lob
   *   down `dropAt` or more  is a chiquita
   * With no drag at all the ball goes to the middle at `restDepth` (0..1).
   */
  aimRadius: number;
  deepAt: number;
  lobAt: number;
  dropAt: number;
  restDepth: number;
  /**
   * One-hand scheme: a drag moves, a flick hits.
   *   a touch still down after `moveDelay` ms is the stick
   *   released before that, having moved `flickMinDistance` px, it is a flick
   *   lifting off a drag faster than `flingSpeed` px/ms is a flick too
   */
  moveDelay: number;
  flickMinDistance: number;
  flingWindow: number;
  flingSpeed: number;
  flingMinDistance: number;
  /** Flick: angle from straight up, in degrees, that already aims at the edge. */
  flickAimAngle: number;
  /** Flick: pointing down past this angle from straight up is a chiquita. */
  flickDropAngle: number;
  /** Flick: length in CSS pixels that asks for no depth and for full depth; longer than `flickLobLength` is a lob. */
  flickShortLength: number;
  flickDeepLength: number;
  flickLobLength: number;
  /** How far to the side the keyboard aims when a direction is held. */
  keyAim: number;
  /**
   * How much earlier than the real contact the timing ring closes, per
   * scheme. Releasing a held thumb is immediate; a flick takes a moment, and
   * people start it on the cue.
   */
  cueLead: { two: number; one: number };
}

export const CONTROLS: ControlsConfig = {
  zoneTop: 0.5,
  tapMaxDistance: 14,
  stickRadius: 46,
  stickDeadzone: 0.18,
  aimRadius: 64,
  deepAt: 70,
  lobAt: 112,
  dropAt: 40,
  restDepth: 0.6,
  moveDelay: 110,
  flickMinDistance: 26,
  flingWindow: 70,
  flingSpeed: 1.1,
  flingMinDistance: 34,
  flickAimAngle: 40,
  flickDropAngle: 115,
  flickShortLength: 34,
  flickDeepLength: 120,
  flickLobLength: 165,
  keyAim: 0.85,
  cueLead: { two: 0.01, one: 0.06 },
};
