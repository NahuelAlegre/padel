import { CAST } from './characters/cast';
import { toAILevel } from './characters/style';
import type { CharacterId } from './characters/types';
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
export const PHYSICS_VERSION = 6;

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
  /** Extra reach of a lunge, for a swing that comes late, when the ball has already gone by. */
  lungeExtra: number;
  /**
   * Extra reach of a player that runs by itself and does not quite get there:
   * it stretches for the ball, and a ball played like that comes back weak.
   */
  stretchExtra: number;
  /** Ideal lateral distance between body and ball at contact. */
  sweetSpot: number;
  /** The ball is taken slightly in front of the body. */
  contactAhead: number;
  minContactZ: number;
  maxContactZ: number;
  /** A ball at least this high is played over the head... */
  overheadZ: number;
  /** ...as a smash when it is at least this high, with room to hit it down, and this close to the net... */
  smashZ: number;
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
  /**
   * Holding the net. A player up to `holdNetDistance` from it has a net to
   * hold: a lob that goes over within reach can be taken in the air (bandeja,
   * víbora) instead of letting it go to the glass. When the contact is
   * chosen, that is worth up to half of `holdNetBonus` more, or less, by how
   * much the player wants the net. A player moved by hand chooses with the
   * stick: going back faster than `holdNetMaxRetreat` means the glass.
   */
  holdNetDistance: number;
  holdNetBonus: number;
  holdNetMaxRetreat: number;
  /**
   * The reach of a real person, the same for everybody: what the body can be
   * seen doing is what it can hit. Off, the reach is today's generous one
   * (`reach` times each player's `reachScale`, plus a lunge for a late swing).
   */
  realReach: boolean;
  real: RealReach;
}

/**
 * How far a real person gets to the ball, in metres from the middle of the
 * feet to the middle of the ball at the moment of contact.
 *
 *   standing    arm and racket, with the trunk leaning: up to `reach`.
 *   lunge       one long step toward the ball: `lunge` more, and a weaker ball.
 *   high        over the head the arm goes up, not out: from `highFrom` the
 *               reach shrinks to `highReach` at the highest contact.
 *   low         a ball under `floorZ` is lost; one under `lowZ` is dug out
 *               with the knees bent, and comes out weak (see the pressure).
 *               Lunging, the body cannot also get that low: `lungeFloorZ`.
 */
export interface RealReach {
  reach: number;
  lunge: number;
  highFrom: number;
  highReach: number;
  floorZ: number;
  lungeFloorZ: number;
}

export interface TimingConfig {
  /** A swing this close to the ideal contact is perfect. */
  perfect: number;
  /** A swing up to this late is good; later than that it is "late". */
  good: number;
  /** A swing this long after the ideal contact can still reach the ball. */
  lateMax: number;
  /**
   * Minimum time between two asks that arm a swing. Once armed for a ball,
   * asking again only changes where it goes, never when the racket comes; and
   * a swing at the air takes all of its stroke (see `Match.requestSwing`).
   */
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

/**
 * How hard a ball is to play, 0..1, and what that does to the answer.
 *
 * The ball is hard because of what the other player did with it: it came low
 * to somebody at the net, fast, away from the body, into a corner, over the
 * head of somebody going backwards. A hard ball lowers the ceiling of the
 * answer before anything else: it comes back slower, higher and with less
 * angle, which is a ball to attack. That is how a point is built.
 */
export interface PressureConfig {
  /** Closer to the net than this, a ball under the tape has to be hit upwards. Full weight from `belowFull` in. */
  belowFrom: number;
  belowFull: number;
  /** How far under the tape (plus `belowMargin`) counts as all the way down. */
  belowSpan: number;
  belowMargin: number;
  /**
   * Anywhere on the court, a ball lower than `floorFrom` has to be picked up
   * from the floor: all the way down `floorSpan` below that. It is what a
   * sliced volley that dies at the back leaves.
   */
  floorFrom: number;
  floorSpan: number;
  /** A ball is fast from `paceFrom` m/s, and as fast as it gets `paceSpan` above that. */
  paceFrom: number;
  paceSpan: number;
  /**
   * How much of the way from the sweet spot to the edge of the reach is
   * still comfortable. Past that the player is stretching, up to a lunge.
   */
  comfort: number;
  /** A ball this close to the back glass leaves no room to swing; the side wall adds `corner` of that. */
  crampedWithin: number;
  corner: number;
  /** Going away from the net this fast under a high ball is a full backpedal. */
  backpedalSpeed: number;
  /** How much each thing weighs. The sum is cut at 1. */
  weights: {
    below: number;
    stretch: number;
    pace: number;
    cramped: number;
    backpedal: number;
    /** The risk the other player took by aiming near the walls, when it came off. */
    risk: number;
  };
  /** The answer to a ball of pressure p: pace × (1 − paceCut·p)... */
  paceCut: number;
  /** ...p × liftAdd metres more over the net... */
  liftAdd: number;
  /** ...aim range × (1 − aimCut·p)... */
  aimCut: number;
  /** ...the landing point pulled p × shortenAdd of the way toward mid court... */
  shortenAdd: number;
  /** ...and scatter + scatterAdd·p. */
  scatterAdd: number;
  /** Backpedalling more than this (0..1), an overhead cannot be a smash. */
  forcedBandeja: number;
  /** A lob under pressure p loses p × lobCut of its quality: it lands short. */
  lobCut: number;
}

/** What the first bounce of a ball keeps of its speed: `kick` of the vertical, `grip` of the horizontal. */
export interface Spin {
  kick?: number;
  grip?: number;
}

/** What a perfectly timed swing adds to a shot. Each shot has its own. */
export interface PerfectBonus {
  /** Its own spin, instead of the usual one of the shot (see `Spin`). */
  kick?: number;
  grip?: number;
  /** Multiplier on the pace. */
  pace?: number;
  /** Metres added to the height over the net (negative: it skims it). */
  clearance?: number;
  /** Metres added to the depth. */
  depth?: number;
  /** Multiplier on how wide it can be aimed. */
  aim?: number;
}

export interface ShotsConfig {
  specs: Record<ShotKind, ShotSpec>;
  quality: Record<Quality, QualityEffect>;
  /**
   * The depth of a lob is not chosen with the thumb: it comes out of the
   * swing. 1 lands it at `depthFar`, next to the glass; 0 at `depthNear`,
   * where it can be smashed.
   */
  lobQuality: Record<Quality, number>;
  /** How much higher a better lob flies, in metres per point of quality over a good one. */
  lobApexGain: number;
  perfect: Partial<Record<ShotKind, PerfectBonus>>;
  /** No shot is asked to clear the net by less than this, however good the swing. */
  minClearance: number;
  /**
   * The spin each shot leaves with, as what its first bounce does (an
   * ordinary one keeps `floorRestitution` of the vertical speed and
   * `floorGrip` of the horizontal).
   *
   * The smash kicks: it jumps off the floor and leaves the glass over
   * everybody's head, back toward the net. The chiquita bites: it lands and
   * stays, instead of rolling on to whoever is waiting at the back. The
   * volley, the bandeja and the víbora are sliced: they skid and die at the
   * back glass instead of coming back off it. That is what the net is for.
   * Under pressure the spin is the first thing to go.
   */
  spin: Partial<Record<ShotKind, Spin>>;
  pressure: PressureConfig;
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
   * A safety net against the point that never ends. After `heatAfter` hits
   * a rally heats up: every further hit is `heatPerHit` faster, up to
   * `heatMax`, and that much harder to control (`heatError` times the heat
   * is added to the scatter).
   */
  heatAfter: number;
  heatPerHit: number;
  heatMax: number;
  heatError: number;
  /**
   * What a run of difficult balls does to a player. After each of its own
   * hits, strain = carry × strain + the pressure of that ball. Above `from`
   * its scatter grows by `error` × (1 − composure) for every point of strain.
   * Whoever attacks builds none; whoever defends does. It starts from zero
   * at every point.
   */
  strain: {
    carry: number;
    from: number;
    error: number;
  };
}

/**
 * Hit zones (experimental, docs/zonas.md): where the ball is met around the
 * body, in the player's own axes, decides how much of the shot it asked for
 * comes out. Off, nothing of this happens and the game plays as it always
 * did. See src/sim/zones.ts.
 *
 *   body    the ball comes at the chest: closer than `bodyFree` to the
 *           body's forward line (all of it at `bodyFull`), up to `bodyAhead`
 *           in front of it (none from `bodyAheadFree`), and below `bodyTop`
 *           (none from the overhead height). It can only be blocked.
 *   behind  the ball is past the line of the body: from `behindFrom` behind
 *           it (`behindFromHigh` over the head, where the back arches), all
 *           of it at `behindFull`. Further than `behindOut` it is not
 *           reached at all: the golden rule (docs/dobles.md, section 4).
 */
export interface ZonesConfig {
  on: boolean;
  /** The body faces the net and turns toward the ball that is coming, by this much at most, in degrees. */
  turn: number;
  bodyFull: number;
  bodyFree: number;
  bodyAhead: number;
  bodyAheadFree: number;
  bodyTop: number;
  behindFrom: number;
  behindFromHigh: number;
  behindFull: number;
  behindOut: number;
  /** How much each part adds to the pressure of the ball (see `ballPressure`). */
  weights: { body: number; behind: number };
  /** A block goes to the middle: its aim is cut by `blockAim` × how much at the body it was... */
  blockAim: number;
  /** ...and it is hard to direct: this much more scatter. */
  blockScatter: number;
  /** A late slap is wild: this much more scatter, times how far behind. */
  behindScatter: number;
  /**
   * What a contact fully at the body, or fully past the line of it, costs
   * when a contact is chosen (for whoever stands still, and for where to
   * run to), against the comfort of the ball itself (see src/sim/intercept.ts).
   */
  dodge: number;
  /**
   * A computer player's feet end up this far from its spot, in metres per
   * second of the spread of its timing for that ball (see src/control/ai.ts),
   * and never further than `placeMost`: as steady as its hands, and as
   * shaken by a demanding ball.
   */
  place: number;
  placeMost: number;
  /**
   * How often a computer player plays the ball at the body of whoever is at
   * the net, when it can, times its `aggression`: the aggressive often, the
   * quiet hardly ever (see src/control/ai.ts).
   */
  bodyShot: number;
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
  /**
   * 0..1, how often it mishits a ball it got to: the unforced error. Timing
   * only makes a shot weak, and a player that plays safe would otherwise
   * never miss.
   */
  mishit: number;
  /** 0..1, how often it picks the best target instead of a random one. */
  smart: number;
  /** 0..1, how often it finishes a ball that is there to be attacked instead of just putting it back. */
  punish: number;
  /** 0..1, how much it would rather take a lob in the air than give up the net. */
  holdNet: number;
  /** 0..1, how little a run of difficult balls gets to it. A person has 0.5. */
  composure: number;
  lobChance: number;
  dropChance: number;
  /** 0..1, how often it follows its serve and its attacking shots to the net. */
  netRush: number;
  /** Seconds it takes to serve once in position. */
  serveDelay: number;
  /** Pace of its shots against the usual one (1 = the same as a person). */
  power: number;
  /**
   * Taste for the ball that comes back off a wall: above 0 it waits for the
   * rebound, below 0 it takes the ball before the glass when it can.
   */
  wallBias: number;
  /** 0..1, how wide it aims: 0 plays through the middle, 1 hunts the side walls. */
  angle: number;
  /** 0..1, how often its ordinary shot is hard and deep instead of safe and to the middle. */
  aggression: number;
  /** 0..1, how often it plays the ball to the opponent instead of away, like a coach feeding balls. */
  feed: number;
  /** From this many hits into a rally, every further hit adds `impatience` to its scatter. */
  impatientAfter: number;
  impatience: number;
  /** Multiplier on its scatter when it has to play the ball off the glass. */
  wallScatter: number;
  /** Reached late, it always lobs. */
  lobUnderPressure: boolean;
  /** Seconds before contact at which it has decided its shot, and its windup shows it. */
  tellLead: number;
  /**
   * Doubles, 0..1: its taste for going after a ball of its partner's that it
   * plays better, saying «¡mía!» first. Only the aggressive have it (see
   * `withAttitude` in src/characters/style.ts).
   */
  steal: number;
}

/** The rivals are the characters of the cast. */
export type RivalId = CharacterId;

export interface GameConfig {
  court: CourtConfig;
  physics: PhysicsConfig;
  player: PlayerConfig;
  timing: TimingConfig;
  shots: ShotsConfig;
  rules: RulesConfig;
  zones: ZonesConfig;
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
    stretchExtra: 0.35,
    sweetSpot: 0.62,
    contactAhead: 0.2,
    minContactZ: 0.15,
    maxContactZ: 2.7,
    overheadZ: 1.9,
    smashZ: 2.2,
    smashMaxNetDistance: 4.5,
    overheadMaxNetDistance: 6.6,
    volleyMaxNetDistance: 6,
    backWallZone: 2.4,
    backWallBehind: 0.25,
    homeBack: 7.4,
    homeNet: 3.2,
    holdNetDistance: 6.6,
    holdNetBonus: 1.2,
    holdNetMaxRetreat: 2.5,
    realReach: false,
    real: { reach: 1.15, lunge: 0.45, highFrom: 1.7, highReach: 0.75, floorZ: 0.2, lungeFloorZ: 0.32 },
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
      // How deep it lands is the quality of the swing: see `lobQuality`.
      lob: { depthNear: 4.5, depthFar: 9.3, clearance: 2, apex: 5.6, speed: 30, aimRange: 3.4 },
      // Chiquita (after the bounce) or dejada (in the air): short and soft.
      drop: { depthNear: 2.2, depthFar: 2.2, clearance: 0.3, apex: 0, speed: 9, aimRange: 3.4 },
      // Steep and short on purpose: it bounces over the walls or back over the net.
      smash: { depthNear: 3.6, depthFar: 3.6, clearance: 0.12, apex: 0, speed: 26, aimRange: 3.7 },
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
      // What a perfect adds to the ball itself depends on the shot: see `perfect`.
      perfect: { azimuth: 0.5, elevation: 0.5, speed: 0.01, pace: 1, lift: 0, shorten: 0 },
      good: { azimuth: 1.3, elevation: 1.2, speed: 0.02, pace: 1, lift: 0.1, shorten: 0 },
      // Swinging early arms the shot and it is played when the ball arrives:
      // as good as a good one, it only misses the perfect.
      early: { azimuth: 1.3, elevation: 1.2, speed: 0.02, pace: 1, lift: 0.1, shorten: 0 },
      // A late ball still goes back, weak and high. It is risk and pressure
      // that send it out, not the timing by itself.
      late: { azimuth: 2.4, elevation: 1.6, speed: 0.035, pace: 0.76, lift: 0.7, shorten: 0.35 },
    },
    serve: { azimuth: 0.7, elevation: 0.7, speed: 0.012, pace: 1, lift: 0, shorten: 0 },
    lobQuality: { perfect: 1, good: 0.8, early: 0.7, late: 0.1 },
    lobApexGain: 0.6,
    perfect: {
      // More pace and lower over the net: a harder ball for whoever gets it.
      drive: { pace: 1.15, clearance: -0.12 },
      volley: { pace: 1.15, clearance: -0.1 },
      // Faster and wider.
      vibora: { pace: 1.15, aim: 1.1 },
      // Shorter and softer: it dies at the feet.
      drop: { depth: -0.5, pace: 0.9, grip: 0.4 },
      // Deeper and lower: it bounces next to the glass and does not come out.
      bandeja: { depth: 0.6, clearance: -0.1 },
      // It does not float.
      wallExit: { clearance: -0.3 },
      // It jumps even more: over the glass, or all the way back over the net.
      smash: { kick: 0.97 },
    },
    minClearance: 0.15,
    spin: {
      smash: { kick: 0.9 },
      drop: { grip: 0.5 },
      // Sliced: they stay low after the bounce and die at the back glass.
      volley: { kick: 0.55 },
      bandeja: { kick: 0.4 },
      vibora: { kick: 0.45 },
    },
    pressure: {
      belowFrom: 6.5,
      belowFull: 5,
      belowSpan: 0.55,
      belowMargin: 0.15,
      floorFrom: 0.5,
      floorSpan: 0.35,
      paceFrom: 14,
      paceSpan: 8,
      comfort: 0.5,
      crampedWithin: 0.8,
      corner: 0.3,
      backpedalSpeed: 3,
      weights: { below: 0.5, stretch: 0.6, pace: 0.5, cramped: 0.4, backpedal: 0.35, risk: 0.15 },
      paceCut: 0.4,
      liftAdd: 1,
      aimCut: 0.5,
      shortenAdd: 0.6,
      scatterAdd: 1.2,
      forcedBandeja: 0.5,
      lobCut: 0.85,
    },
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
    // Points end because somebody built them. The heat is only what keeps one from lasting for ever.
    heatAfter: 10,
    heatPerHit: 0.05,
    heatMax: 0.6,
    heatError: 1.5,
    strain: { carry: 0.5, from: 0.6, error: 2 },
  },
  zones: {
    on: false,
    turn: 15,
    // At the body: closer than 30 cm or so to the body's own line, and right in front of it up to arm's length.
    bodyFull: 0.15,
    bodyFree: 0.45,
    bodyAhead: 1,
    bodyAheadFree: 1.6,
    bodyTop: 1.6,
    // Past the body: a ball a little behind the line is still met; 90 cm behind it, not any more.
    behindFrom: 0.2,
    behindFromHigh: 0.3,
    behindFull: 0.9,
    behindOut: 0.9,
    weights: { body: 1, behind: 0.6 },
    blockAim: 0.8,
    blockScatter: 2,
    behindScatter: 1,
    dodge: 0.7,
    place: 5.5,
    placeMost: 0.6,
    bodyShot: 0.5,
  },
  // How each character plays, worked out from its style (see src/characters).
  rivals: {
    beto: toAILevel(CAST.beto),
    romina: toAILevel(CAST.romina),
    chela: toAILevel(CAST.chela),
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
