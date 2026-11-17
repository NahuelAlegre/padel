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
  /** Horizontal distance from the body at which the ball can be hit. */
  reach: number;
  /** Extra reach granted to late swings, when the ball has already gone by. */
  lungeReach: number;
  /** Ideal lateral distance between body and ball at contact. */
  sweetSpot: number;
  /** The ball is taken slightly in front of the body. */
  contactAhead: number;
  minContactZ: number;
  maxContactZ: number;
  /** Contact above this height turns a drive into a smash... */
  smashZ: number;
  /** ...as long as the player is this close to the net. */
  smashMaxNetDistance: number;
  /** A drive taken in the air this close to the net is a volley. */
  volleyMaxNetDistance: number;
  /** Distance from the net of the two resting positions. */
  homeBack: number;
  homeNet: number;
}

export interface TimingConfig {
  /** |error| below this is a perfect hit. */
  perfect: number;
  /** |error| below this is a good hit. Beyond it the hit is early or late. */
  good: number;
  /** A swing this long after the ideal contact can still reach the ball. */
  lateMax: number;
  /** Minimum time between two swings: a new swipe replaces the armed one. */
  reswipeGap: number;
  /** An armed swing waits this long for a ball that is slightly out of reach. */
  graceAfter: number;
  /** Subtracted from the swipe time of human players: touch and display latency. */
  latencyCompensation: number;
  /**
   * How much earlier than the real contact the timing ring closes on screen.
   * A swipe is judged when the finger lifts, and people start it on the cue:
   * with this lead, starting on the ring ends on the ball. Display only.
   */
  cueLead: number;
  /** After missing a contact, the next opportunity has to be at least this far ahead. */
  replanLead: number;
  /**
   * A person who swipes while the assisted player is waiting for a later
   * contact takes the ball right there if it passes within reach in the next
   * `takeNow` seconds (or did in the last `takeNowBack`).
   */
  takeNow: number;
  takeNowBack: number;
}

export interface ShotSpec {
  /** Distance from the net where the ball should land. */
  depth: number;
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
  /** Extra scatter when the ball is hit away from the sweet spot. */
  stretchPenalty: number;
  /** Extra scatter against a fast incoming ball (above `paceFrom` m/s). */
  pacePenalty: number;
  paceFrom: number;
  /** Extra scatter when the ball is dug out close to the floor. */
  lowPenalty: number;
  /** Depth weak shots are pulled toward. */
  shortDepth: number;
}

export interface RulesConfig {
  gamesToWin: number;
  setsToWin: number;
  goldenPoint: boolean;
  serveAttempts: number;
  /** Pause after a point, a game and a fault before the next serve. */
  pointPause: number;
  gamePause: number;
  faultPause: number;
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

export interface AILevel {
  /** Delay before the AI starts moving to a new ball. */
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
  /** Seconds it takes to serve once in position. */
  serveDelay: number;
}

export type AILevelName = 'easy' | 'normal' | 'hard';

export interface GameConfig {
  court: CourtConfig;
  physics: PhysicsConfig;
  player: PlayerConfig;
  timing: TimingConfig;
  shots: ShotsConfig;
  rules: RulesConfig;
  ai: Record<AILevelName, AILevel>;
}

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
    lungeReach: 1.9,
    sweetSpot: 0.62,
    contactAhead: 0.2,
    minContactZ: 0.2,
    maxContactZ: 2.6,
    smashZ: 1.9,
    smashMaxNetDistance: 6.5,
    volleyMaxNetDistance: 6,
    homeBack: 7.4,
    homeNet: 3.2,
  },
  timing: {
    perfect: 0.07,
    good: 0.16,
    lateMax: 0.22,
    reswipeGap: 0.2,
    graceAfter: 0.1,
    latencyCompensation: 0.03,
    cueLead: 0.06,
    replanLead: 0.2,
    takeNow: 0.15,
    takeNowBack: 0.06,
  },
  shots: {
    specs: {
      safe: { depth: 6.6, clearance: 1.0, apex: 0, speed: 12.5, aimRange: 1.5 },
      drive: { depth: 7.4, clearance: 0.55, apex: 0, speed: 16, aimRange: 3.8 },
      volley: { depth: 6.8, clearance: 0.3, apex: 0, speed: 18, aimRange: 3.9 },
      lob: { depth: 8.3, clearance: 2, apex: 5.6, speed: 30, aimRange: 3.4 },
      drop: { depth: 2.2, clearance: 0.3, apex: 0, speed: 9, aimRange: 3.4 },
      smash: { depth: 3.6, clearance: 0.2, apex: 0, speed: 26, aimRange: 3.7 },
      serve: { depth: 5.8, clearance: 0.45, apex: 0, speed: 13.5, aimRange: 1.6 },
    },
    quality: {
      perfect: { azimuth: 0.6, elevation: 0.6, speed: 0.01, pace: 1.14, lift: 0, shorten: 0 },
      good: { azimuth: 1.6, elevation: 1.6, speed: 0.025, pace: 1, lift: 0.1, shorten: 0 },
      early: { azimuth: 4, elevation: 3.2, speed: 0.06, pace: 0.8, lift: 0.5, shorten: 0.3 },
      late: { azimuth: 4.5, elevation: 3.2, speed: 0.06, pace: 0.78, lift: 0.5, shorten: 0.3 },
    },
    serve: { azimuth: 0.7, elevation: 0.7, speed: 0.012, pace: 1, lift: 0, shorten: 0 },
    stretchPenalty: 0.7,
    pacePenalty: 0.8,
    paceFrom: 9,
    lowPenalty: 0.5,
    shortDepth: 4.8,
  },
  rules: {
    gamesToWin: 2,
    setsToWin: 1,
    goldenPoint: true,
    serveAttempts: 2,
    pointPause: 1.6,
    gamePause: 2.4,
    faultPause: 1.1,
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
  ai: {
    easy: {
      reaction: 0.4,
      speedFactor: 0.74,
      timingSigma: 0.16,
      errorScale: 1.4,
      smart: 0.25,
      lobChance: 0.12,
      dropChance: 0.03,
      serveDelay: 1.3,
    },
    normal: {
      reaction: 0.3,
      speedFactor: 0.84,
      timingSigma: 0.1,
      errorScale: 1.15,
      smart: 0.55,
      lobChance: 0.18,
      dropChance: 0.08,
      serveDelay: 1.1,
    },
    hard: {
      reaction: 0.24,
      speedFactor: 0.92,
      timingSigma: 0.075,
      errorScale: 1,
      smart: 0.85,
      lobChance: 0.22,
      dropChance: 0.12,
      serveDelay: 0.9,
    },
  },
};

/** A fresh, independent copy of the default configuration. */
export function createConfig(): GameConfig {
  return structuredClone(defaults);
}

/** How touches, mouse drags and keys turn into shots. Not used by the simulation. */
export interface ControlsConfig {
  /** A gesture has to start below this fraction of the screen height (0 = anywhere). */
  gestureZoneTop: number;
  /** A drag shorter than this, in CSS pixels, is a tap. */
  swipeMinDistance: number;
  /** A touch held longer than this many milliseconds without moving is ignored. */
  tapMaxDuration: number;
  /** Angle from straight up, in degrees, that already aims at the edge of the court. */
  aimMaxAngle: number;
  /** A swipe at least this long is a lob: a fraction of the screen height, kept within pixel bounds. */
  lobLengthFraction: number;
  lobLengthMin: number;
  lobLengthMax: number;
  /** ...as long as it points up within this many degrees. */
  lobMaxAngle: number;
  /** A swipe pointing down past this angle from straight up is a drop shot. */
  dropMinAngle: number;
  /** Radius of the virtual stick in CSS pixels, and the part of it that does nothing. */
  stickRadius: number;
  stickDeadzone: number;
  /** How far to the side the keyboard aims when a direction is held. */
  keyAim: number;
}

export const CONTROLS: ControlsConfig = {
  gestureZoneTop: 0.5,
  swipeMinDistance: 22,
  tapMaxDuration: 350,
  aimMaxAngle: 38,
  lobLengthFraction: 0.2,
  lobLengthMin: 120,
  lobLengthMax: 190,
  lobMaxAngle: 42,
  dropMinAngle: 115,
  stickRadius: 46,
  stickDeadzone: 0.18,
  keyAim: 0.85,
};
