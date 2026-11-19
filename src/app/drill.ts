import type { AILevel, GameConfig } from '../config';
import { AIController } from '../control/ai';
import type { Rng } from '../core/rng';
import type { Controller, Feed, Match, SimEvent } from '../sim/match';
import type { Player } from '../sim/player';
import type { PlayerIntent, ShotKind } from '../sim/types';

/**
 * The tutorial: short lessons that are played, not read.
 *
 * Each one is a situation set up on a practice court. The coach feeds a ball,
 * a ghost thumb shows the gesture, and the lesson is done when the shot has
 * come off a few times. Nothing here is a new rule: the balls fly, bounce and
 * are hit exactly as in a match, so what is learnt is the game itself.
 */

/** What the ghost thumb shows. The renderer turns it into pixels for the control scheme in use. */
export type Gesture = 'play' | 'side' | 'lob' | 'drop' | 'back' | 'aim' | 'watch';

export type LessonId = 'move' | 'aim' | 'lob' | 'drop' | 'wall' | 'bandeja' | 'smash' | 'read';

interface Spot {
  x: number;
  y: number;
}

/** One ball of a lesson: who stands where, what is fed and what counts as getting it right. */
interface Rep {
  /** Where the person starts, and where the coach stands, as metres from the net and across. */
  me: Spot;
  coach: Spot;
  feed: Feed;
  gesture: Gesture;
  /** For a gesture to one side: -1 is the left of the screen, 1 the right. */
  side: 1 | -1;
  /** The coach plays the person's ball back, once: the lesson is about that second ball. */
  rally: boolean;
}

export interface Lesson {
  id: LessonId;
  /** Balls that have to come off. */
  goal: number;
  /** Where to stand and the bounces after the glass are shown, whatever the aids are set to. */
  guide: boolean;
  follow: boolean;
  rep(index: number, config: GameConfig): Rep;
  /** Did the person's shot do what the lesson is about? `landing` is where it will bounce, when it is going in. */
  passed(hit: Extract<SimEvent, { type: 'hit' }>, landing: Spot | null, rep: Rep, hitsByPerson: number): boolean;
}

const ME_BACK = -7.2;
const ME_NET = -3.2;
const COACH_BACK = 7.4;
const COACH_NET = 3;

/** The side of a rep: they alternate, so the person does not learn only one. */
const sideOf = (index: number): 1 | -1 => (index % 2 === 0 ? 1 : -1);

const easy = (targetX: number, targetY: number, speed = 11): Feed => ({
  targetX,
  targetY,
  kind: 'drive',
  params: { clearance: 0.9, apex: 0, speed },
});

const lobbed = (config: GameConfig, targetX: number, targetY: number, apex: number): Feed => ({
  targetX,
  targetY,
  kind: 'lob',
  params: { clearance: config.shots.specs.lob.clearance, apex, speed: config.shots.specs.lob.speed },
});

const AIR: readonly ShotKind[] = ['bandeja', 'vibora', 'smash'];

/** In the order they are taught. Each one builds on the ones before it. */
export const LESSONS: readonly Lesson[] = [
  {
    // The ball comes to one side: go to it and hit it.
    id: 'move',
    goal: 3,
    guide: true,
    follow: false,
    rep: (index) => ({
      me: { x: 0, y: ME_BACK },
      coach: { x: 0, y: COACH_BACK },
      feed: easy(sideOf(index) * 2.3, -5.4),
      gesture: 'play',
      side: sideOf(index),
      rally: false,
    }),
    passed: (_hit, landing) => landing !== null,
  },
  {
    // The coach stands on one side: put the ball on the other.
    id: 'aim',
    goal: 3,
    guide: false,
    follow: false,
    rep: (index) => ({
      me: { x: 0, y: ME_BACK },
      coach: { x: sideOf(index) * 2.8, y: COACH_BACK },
      feed: easy(0.4, -5.6),
      gesture: 'side',
      // Away from where he is standing.
      side: sideOf(index) > 0 ? -1 : 1,
      rally: false,
    }),
    passed: (_hit, landing, rep) => landing !== null && landing.x * rep.side > 0.8,
  },
  {
    // He is at the net: over his head.
    id: 'lob',
    goal: 3,
    guide: false,
    follow: false,
    rep: (index) => ({
      me: { x: 0, y: ME_BACK },
      coach: { x: sideOf(index) * 0.8, y: COACH_NET },
      feed: { ...easy(0.5, -6, 10), z: 1.2 },
      gesture: 'lob',
      side: 1,
      rally: false,
    }),
    passed: (hit, landing) => hit.kind === 'lob' && landing !== null,
  },
  {
    // He is far back: short, just over the net.
    id: 'drop',
    goal: 3,
    guide: false,
    follow: false,
    rep: (index) => ({
      me: { x: 0, y: -6.4 },
      coach: { x: sideOf(index) * 1.2, y: 8 },
      feed: easy(0.4, -4.9),
      gesture: 'drop',
      side: 1,
      rally: false,
    }),
    passed: (hit, landing) => hit.kind === 'drop' && landing !== null,
  },
  {
    // A deep ball: let it bounce and come back off the glass.
    id: 'wall',
    goal: 3,
    guide: true,
    follow: true,
    rep: (index) => ({
      me: { x: 0, y: -7.4 },
      coach: { x: 0, y: COACH_BACK },
      feed: easy(sideOf(index) * 1.4, -8.7, 15),
      gesture: 'aim',
      side: 1,
      rally: false,
    }),
    passed: (hit, landing) => hit.kind === 'wallExit' && landing !== null,
  },
  {
    // At the net, and he lobs: a couple of steps back and take it in the air.
    id: 'bandeja',
    goal: 3,
    guide: true,
    follow: false,
    rep: (index, config) => ({
      me: { x: 0, y: ME_NET },
      coach: { x: 0, y: COACH_BACK },
      feed: lobbed(config, sideOf(index) * 0.5, -7, 5.2),
      gesture: 'back',
      side: 1,
      rally: false,
    }),
    passed: (hit, landing) => AIR.includes(hit.kind) && hit.volley && landing !== null,
  },
  {
    // A short lob: that one is smashed.
    id: 'smash',
    goal: 3,
    guide: true,
    follow: false,
    rep: (index, config) => ({
      me: { x: 0, y: ME_NET },
      coach: { x: 0, y: COACH_BACK },
      feed: lobbed(config, sideOf(index) * 0.4, -5.1, 4.8),
      gesture: 'aim',
      side: 1,
      rally: false,
    }),
    passed: (hit, landing) => hit.kind === 'smash' && landing !== null,
  },
  {
    // He points where he is going to play before he hits: watch him and get there.
    id: 'read',
    goal: 3,
    guide: false,
    follow: false,
    rep: () => ({
      me: { x: 0, y: ME_BACK },
      coach: { x: 0, y: COACH_BACK },
      feed: easy(0.3, -5.8),
      gesture: 'watch',
      side: 1,
      rally: true,
    }),
    // The first ball back is only to get him to play: the lesson is the second one.
    passed: (_hit, landing, _rep, hitsByPerson) => hitsByPerson >= 2 && landing !== null,
  },
];

export function lessonIndex(id: LessonId): number {
  return LESSONS.findIndex((lesson) => lesson.id === id);
}

/**
 * How the coach plays the one ball he returns: on time, never missing, wide
 * and not hard, and with his mind made up early enough to be read.
 */
const TEACHING: AILevel = {
  reaction: 0.2,
  speedFactor: 1,
  timingSigma: 0,
  errorScale: 0.3,
  mishit: 0,
  smart: 1,
  punish: 0,
  holdNet: 0,
  composure: 1,
  lobChance: 0,
  dropChance: 0,
  netRush: 0,
  serveDelay: 1,
  power: 0.92,
  wallBias: 0,
  angle: 1,
  aggression: 0,
  feed: 0,
  impatientAfter: Infinity,
  impatience: 0,
  wallScatter: 1,
  lobUnderPressure: false,
  tellLead: 0.55,
  steal: 0,
};

/** What a player set up as the coach needs to be (see `Drill.coach`). */
export const COACH_SETUP = {
  speedFactor: TEACHING.speedFactor,
  reaction: TEACHING.reaction,
  errorScale: TEACHING.errorScale,
} as const;

/**
 * The coach. He stands where the lesson puts him and lets the ball go by,
 * unless the lesson is a rally: then he plays the person's first ball back.
 */
class Coach implements Controller {
  returns = false;
  private readonly inner: AIController;
  private played = 0;

  constructor(rng: Rng) {
    this.inner = new AIController(TEACHING, rng);
  }

  /** A new ball is in play. */
  reset(): void {
    this.played = 0;
    this.inner.onServeSetup();
  }

  onHit(): void {
    this.played++;
  }

  update(match: Match, me: Player, intent: PlayerIntent): void {
    if (match.phase !== 'rally') return;
    if (this.returns && this.played < 1) {
      this.inner.update(match, me, intent);
      intent.home = 'back';
      return;
    }
    // Out of the way of nothing: he stays where he was put.
    intent.hasTarget = true;
    intent.targetX = me.spotX;
    intent.targetY = me.spotY;
  }
}

/** Seconds the players get to walk to their places, at most, and the pause once they are there. */
const WALK_MAX = 2.2;
const READY_PAUSE = 0.4;
/** After the person's shot, how long the ball is watched before the next one. */
const AFTER_SHOT = 1.15;
/** A ball nobody hit is given up on after this long. */
const GIVE_UP = 6;
/** After the last ball of a lesson, the moment it gets before the lesson is over. */
const AFTER_LAST = 1;

type Stage = 'walking' | 'playing' | 'watching' | 'done';

/**
 * Runs one lesson on a practice match: sends the players to their places,
 * has the coach feed the ball and counts the ones that come off.
 */
export class Drill {
  /** Balls that came off so far. */
  progress = 0;
  /** True once the lesson has been completed and its last ball has been watched. */
  done = false;
  /** Set for one step when a ball came off, for whoever wants to celebrate it. */
  justPassed = false;
  readonly coach: Coach;

  private stage: Stage = 'walking';
  private since = 0;
  private settledAt = -1;
  private index = 0;
  private current: Rep;
  private hitsByPerson = 0;
  private judged = false;

  constructor(
    readonly lesson: Lesson,
    private readonly config: GameConfig,
    rng: Rng,
  ) {
    this.coach = new Coach(rng);
    this.current = lesson.rep(0, config);
  }

  /** The gesture to show right now, or null while there is nothing to do. */
  get gesture(): { gesture: Gesture; side: 1 | -1 } | null {
    if (this.stage === 'done' || this.done) return null;
    return { gesture: this.current.gesture, side: this.current.side };
  }

  /** Puts everybody in place for the first ball. Call once, with the match of the lesson. */
  begin(match: Match): void {
    this.place(match, true);
  }

  private place(match: Match, now: boolean): void {
    const rep = (this.current = this.lesson.rep(this.index, this.config));
    const person = match.players.find((player) => player.isHuman)!;
    const coach = match.players.find((player) => !player.isHuman)!;
    const spots: Spot[] = [];
    spots[person.id] = rep.me;
    spots[coach.id] = rep.coach;
    match.rest(spots, coach.id, now);
    this.coach.returns = rep.rally;
    this.stage = 'walking';
    this.since = match.time;
    this.settledAt = -1;
    this.hitsByPerson = 0;
    this.judged = false;
  }

  /** Call after every step of the match. */
  step(match: Match): void {
    this.justPassed = false;
    const time = match.time;
    switch (this.stage) {
      case 'walking': {
        if (this.settledAt < 0 && (match.settled || time - this.since > WALK_MAX)) this.settledAt = time;
        if (this.settledAt >= 0 && time - this.settledAt >= READY_PAUSE) {
          this.coach.reset();
          match.feed(this.current.feed);
          this.stage = 'playing';
          this.since = time;
        }
        break;
      }
      case 'playing':
        if (time - this.since > GIVE_UP) this.next(match);
        break;
      case 'watching':
        if (time - this.since > (this.progress >= this.lesson.goal ? AFTER_LAST : AFTER_SHOT)) this.next(match);
        break;
      case 'done':
        break;
    }
  }

  /** Call with everything that happens in the match. */
  onEvent(event: SimEvent, match: Match): void {
    if (this.stage !== 'playing') return;
    if (event.type === 'hit') {
      const who = match.players[event.player];
      if (!who) return;
      if (!who.isHuman) {
        // The feed itself is his too, but only a ball he plays back counts as a return.
        if (match.rallyHits > 1) this.coach.onHit();
        return;
      }
      this.hitsByPerson++;
      if (this.judged) return;
      const passed = this.lesson.passed(event, landingOf(match, who.team), this.current, this.hitsByPerson);
      // In a rally the first ball back is not the one being judged.
      if (this.current.rally && this.hitsByPerson < 2 && !passed) return;
      this.judged = true;
      if (passed) {
        this.progress++;
        this.justPassed = true;
      }
      this.stage = 'watching';
      this.since = match.time;
    } else if (event.type === 'point') {
      // The ball died without being judged: on to the next one.
      this.stage = 'watching';
      this.since = match.time - AFTER_SHOT * 0.5;
    }
  }

  private next(match: Match): void {
    if (this.progress >= this.lesson.goal) {
      this.stage = 'done';
      this.done = true;
      return;
    }
    this.index++;
    this.place(match, false);
  }
}

/**
 * Where the ball that was just hit is going to bounce on the other half, or
 * null when it is not going in (the net, out, the glass before the floor).
 */
function landingOf(match: Match, hitter: number): Spot | null {
  const trajectory = match.trajectory;
  if (!trajectory) return null;
  const end = trajectory.end;
  // Nobody is going to touch it here: how it ends untouched is how good it was.
  if (end && end.result.kind === 'point' && end.result.winner !== hitter) return null;
  const first = trajectory.bounces[0];
  if (!first) return null;
  const other = hitter === 0 ? first.y > 0 : first.y < 0;
  return other ? { x: first.x, y: first.y } : null;
}
