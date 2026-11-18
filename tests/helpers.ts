import { createConfig, type AILevel, type GameConfig, type RivalId } from '../src/config';
import { AIController } from '../src/control/ai';
import { HumanController } from '../src/control/human';
import { Rng } from '../src/core/rng';
import { InputState } from '../src/input/state';
import type { InterceptPlan } from '../src/sim/intercept';
import { Match, type Controller, type PlayerEntry, type SimEvent } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { Trajectory } from '../src/sim/trajectory';
import type { PlayerIntent } from '../src/sim/types';

/** Reach multiplier the game gives to a person (see src/app/game.ts). */
export const HUMAN_REACH = 1.3;
/** How much the advice to a person leans toward holding the net (see src/app/game.ts). */
export const HUMAN_HOLD_NET = 0.6;

/** Nothing of a character: normal pace, no taste for the walls, aims wide, hits deep, no habits. */
const plain = {
  mishit: 0,
  power: 1,
  wallBias: 0,
  angle: 1,
  aggression: 1,
  feed: 0,
  impatientAfter: Infinity,
  impatience: 0,
  wallScatter: 1,
  lobUnderPressure: false,
  tellLead: 0.35,
};

/**
 * Computer players of three strengths with no personality. The tests of the
 * mechanics use these, so tuning a character does not move them.
 */
export const LEVELS = {
  easy: { reaction: 0.4, speedFactor: 0.74, timingSigma: 0.2, errorScale: 1.4, smart: 0.25, punish: 0.1, holdNet: 0.1, composure: 0.3, lobChance: 0.1, dropChance: 0.02, netRush: 0.1, serveDelay: 1.2, ...plain },
  medium: { reaction: 0.28, speedFactor: 0.88, timingSigma: 0.11, errorScale: 1.1, smart: 0.55, punish: 0.5, holdNet: 0.5, composure: 0.5, lobChance: 0.38, dropChance: 0.06, netRush: 0.8, serveDelay: 1, ...plain },
  hard: { reaction: 0.2, speedFactor: 0.96, timingSigma: 0.085, errorScale: 1, smart: 0.85, punish: 0.9, holdNet: 0.85, composure: 0.8, lobChance: 0.14, dropChance: 0.12, netRush: 1, serveDelay: 0.9, ...plain },
} satisfies Record<string, AILevel>;

export type LevelName = keyof typeof LEVELS;

/** A computer player: one of the plain levels, or a character of the cast as the game sets it up. */
export function aiEntry(config: GameConfig, who: LevelName | RivalId, seed: number, name = 'IA'): PlayerEntry {
  const level: AILevel = who in LEVELS ? LEVELS[who as LevelName] : config.rivals[who as RivalId];
  return {
    name,
    isHuman: false,
    manual: false,
    speedFactor: level.speedFactor,
    reaction: level.reaction,
    errorScale: level.errorScale,
    reachScale: 1,
    hand: 1,
    wallBias: level.wallBias,
    holdNet: level.holdNet,
    composure: level.composure,
    controller: new AIController(level, new Rng(seed)),
  };
}

export interface ScriptedSkill {
  /** Spread of the moment the thumb is released, in seconds. */
  timing: number;
  /** How far from the ideal spot the person ends up standing, in metres. */
  position: number;
  /** Seconds before the person starts running to a new ball. */
  reaction: number;
  /** How often the shot is aimed at the open court. */
  aimSmart: number;
  /** How often the thumb is released early on purpose, arming the shot. */
  armEarly: number;
  /**
   * 0..1, how much padel there is in its decisions, with the same hands: how
   * often it picks the shot the situation asks for (see `ScriptedHuman`).
   * At 0 it hits any shot anywhere and waits at the back.
   */
  tactics: number;
}

export const SKILLS = {
  beginner: { timing: 0.16, position: 0.7, reaction: 0.35, aimSmart: 0.4, armEarly: 0.6, tactics: 0 },
  average: { timing: 0.1, position: 0.45, reaction: 0.25, aimSmart: 0.6, armEarly: 0.4, tactics: 0 },
  expert: { timing: 0.05, position: 0.25, reaction: 0.18, aimSmart: 0.8, armEarly: 0.2, tactics: 0 },
} satisfies Record<string, ScriptedSkill>;

export type SkillName = keyof typeof SKILLS;

/** The same hands, playing padel: what the head adds is the difference between the two. */
export function withTactics(skill: ScriptedSkill, tactics = 1): ScriptedSkill {
  return { ...skill, tactics };
}

/** Closer to the net than this, a player is "at the net" for whoever decides a shot. */
const NET_ZONE = 5;
/** A ball met this close to the net and this far over the tape is one to attack. */
const ATTACK_ZONE = 6.5;
const ATTACK_ABOVE_TAPE = 0.25;

/**
 * Plays like a person with the default controls: it goes through the real
 * InputState and HumanController, pushing the stick toward where it thinks it
 * should stand (with a delay and an error) and releasing the aim around the
 * arrival of the ball.
 *
 * With `tactics` it also plays padel, with the same thumbs:
 *   - after an attacking shot it waits at the net, not at the back, and holds
 *     it against a lob when the advice on where to stand says it can;
 *   - a ball over its head goes down and away (a smash, close to the net);
 *   - against a rival at the net it lobs, cross and deep, or plays at the feet;
 *   - a ball to attack (close to the net, over the tape) it finishes: short
 *     when the rival is far back, hard and away otherwise;
 *   - a low ball at the net it only puts back, deep through the middle;
 *   - from the back, with nobody at the net, it builds: a lob or a chiquita to
 *     go up, a deep one otherwise.
 *
 * It arms its shots early as often as without tactics. Waiting for the ball
 * to get a perfect out of a lob was tried: it pays with expert hands and
 * costs with average ones, so it is not part of what "tactics" means here.
 */
export class ScriptedHuman implements Controller {
  private readonly input = new InputState();
  private readonly inner = new HumanController(this.input);
  private trajectory: Trajectory | null = null;
  private offsetX = 0;
  private offsetY = 0;
  private thumbOffset: number | null = null;
  private released = false;
  private serveAt = -1;
  /** Whether the shot it has just played was thought out: then it follows it to the net. */
  private thinking = false;

  constructor(
    private readonly rng: Rng,
    private readonly skill: ScriptedSkill,
  ) {}

  onServeSetup(): void {
    this.trajectory = null;
    this.thumbOffset = null;
    this.released = false;
    this.serveAt = -1;
    this.thinking = this.thinks();
    this.input.clear();
  }

  /** Is this decision a padel one? Draws nothing at the two ends, so 0 plays exactly as it always did. */
  private thinks(): boolean {
    const tactics = this.skill.tactics;
    return tactics >= 1 || (tactics > 0 && this.rng.chance(tactics));
  }

  update(match: Match, me: Player, intent: PlayerIntent): void {
    const rng = this.rng;
    if (match.phase === 'serve' && match.serverId === me.id) {
      if (this.serveAt < 0) this.serveAt = match.time + 0.5;
      if (match.time >= this.serveAt) {
        this.input.pushSwing({ aim: rng.range(-0.8, 0.8), depth: 0.6, lob: false, power: 1 });
      }
    }

    const incoming = match.rally.live && match.rally.hitter !== me.team && match.trajectory !== null;
    if (incoming && match.trajectory !== this.trajectory) {
      // A new ball: misjudge a little where to stand, and decide when to let go.
      this.trajectory = match.trajectory;
      this.offsetX = rng.gauss() * this.skill.position;
      this.offsetY = rng.gauss() * this.skill.position;
      this.thumbOffset = null;
      this.released = false;
    }

    let targetX = 0;
    // Where it waits for the next ball: at the net behind a shot that takes it there, when it is thinking.
    const rest = this.thinking && me.homeMode === 'net' ? 3.4 : 7.2;
    let targetY = -rest * (me.team === 0 ? 1 : -1);
    let moving = true;
    if (incoming && this.trajectory) {
      const guide: InterceptPlan | null = me.guide;
      if (match.time < this.trajectory.t0 + this.skill.reaction) {
        moving = false;
      } else if (guide) {
        targetX = guide.stanceX + this.offsetX;
        targetY = guide.stanceY + this.offsetY;
      } else {
        moving = false;
      }
    }
    const dx = targetX - me.x;
    const dy = targetY - me.y;
    const distance = Math.hypot(dx, dy);
    // The stick is in screen space: up the screen is toward the net for team 0.
    const flip = me.team === 0 ? 1 : -1;
    if (moving && distance > 0.3) this.input.setMove('stick', (dx / distance) * flip, (dy / distance) * flip);
    else this.input.setMove('stick', 0, 0);

    if (incoming && !this.released) {
      // The person watches the timing ring, which follows the ball that can be
      // hit from where the player is standing right now. How far off the thumb
      // will be is decided once per ball.
      const contact = me.plan;
      if (this.thumbOffset === null && contact) {
        const early = rng.chance(this.skill.armEarly) ? -rng.range(0.15, 0.45) : 0;
        this.thumbOffset = match.config.timing.latencyCompensation + early + rng.gauss() * this.skill.timing;
      }
      if (this.thumbOffset !== null && contact && match.time >= contact.t + this.thumbOffset) {
        this.released = true;
        const rival = match.teams[me.team === 0 ? 1 : 0][0]!;
        const open = rival.x > 0 ? rng.range(-1, -0.5) : rng.range(0.5, 1);
        const aim = rng.chance(this.skill.aimSmart) ? open : rng.range(-1, 1);
        this.thinking = this.thinks();
        if (!this.thinking) {
          const pick = rng.next();
          if (pick < 0.15) this.input.pushSwing({ aim, depth: 1, lob: true, power: 1 });
          else if (pick < 0.2) this.input.pushSwing({ aim, depth: 0.1, lob: false, power: 1 });
          else this.input.pushSwing({ aim, depth: rng.range(0.6, 1), lob: false, power: 1 });
        } else {
          const rivalNet = Math.abs(rival.y);
          const rivalAtNet = rivalNet < NET_ZONE;
          const myNet = Math.abs(contact.y);
          const meAtNet = myNet < NET_ZONE;
          const high = contact.z >= match.config.player.overheadZ;
          // A ball to attack: close to the net and over the tape.
          const sitter = myNet < ATTACK_ZONE && contact.z >= match.config.court.netCenter + ATTACK_ABOVE_TAPE;
          const swing = (to: number, depth: number, lob = false): void => this.input.pushSwing({ aim: to, depth, lob, power: 1 });
          if (high) {
            // Over the head: down and away. Close to the net that is a smash.
            swing(open, rng.range(0.85, 1));
          } else if (rivalAtNet && !meAtNet) {
            // Take the net back: a lob over the one at the net, cross and deep. Now and then, at the feet.
            if (rng.chance(0.15)) swing(aim, 0.1);
            else swing(rng.range(0.4, 0.9) * (rival.x > 0 ? -1 : 1), 1, true);
          } else if (sitter) {
            // Finish it: short when the rival is far back; otherwise away and not deep, so it
            // dies in the side fence instead of coming back off the glass.
            if (rivalNet > 7 && rng.chance(0.35)) swing(open, 0.1);
            else swing(open > 0 ? rng.range(0.85, 1) : rng.range(-1, -0.85), rng.range(0.3, 0.5));
          } else if (meAtNet) {
            // A low ball at the net is not one to win the point with: deep, through the middle.
            swing(rng.range(-0.3, 0.3), rng.range(0.75, 0.95));
          } else {
            // From the back, with nobody at the net: build, and look for the moment to go up.
            const pick = rng.next();
            if (pick < 0.25) swing(rng.range(-0.6, 0.6), 1, true);
            else if (pick < 0.37) swing(aim, 0.1);
            else swing(aim, rng.range(0.7, 0.95));
          }
        }
      }
    }
    this.inner.update(match, me, intent);
  }
}

export function humanEntry(seed: number, skill: ScriptedSkill, overrides: Partial<PlayerEntry> = {}): PlayerEntry {
  return {
    name: 'Vos',
    isHuman: true,
    manual: true,
    speedFactor: 1,
    reaction: 0,
    errorScale: 1,
    reachScale: HUMAN_REACH,
    hand: 1,
    holdNet: HUMAN_HOLD_NET,
    controller: new ScriptedHuman(new Rng(seed), skill),
    ...overrides,
  };
}

export interface MatchSummary {
  winner: number;
  points: number;
  simSeconds: number;
  hits: number;
  rallyLengths: number[];
  reasons: Record<string, number>;
  kinds: Record<string, number>;
  qualities: [Record<string, number>, Record<string, number>];
  pointsWon: [number, number];
  faults: number;
  stalled: boolean;
}

/** Runs a match to the end without rendering and returns what happened. */
export function playMatch(match: Match, maxSimSeconds = 3600, onEvent?: (event: SimEvent) => void): MatchSummary {
  const summary: MatchSummary = {
    winner: -1,
    points: 0,
    simSeconds: 0,
    hits: 0,
    rallyLengths: [],
    reasons: {},
    kinds: {},
    qualities: [{}, {}],
    pointsWon: [0, 0],
    faults: 0,
    stalled: false,
  };
  let rally = 0;
  const maxTicks = maxSimSeconds * 120;
  while (match.phase !== 'matchOver') {
    match.step();
    for (const event of match.events) {
      onEvent?.(event);
      if (event.type === 'hit') {
        summary.hits++;
        rally++;
        summary.kinds[event.kind] = (summary.kinds[event.kind] ?? 0) + 1;
        if (event.kind !== 'serve') {
          const bucket = summary.qualities[event.team];
          bucket[event.quality] = (bucket[event.quality] ?? 0) + 1;
        }
      } else if (event.type === 'point') {
        summary.points++;
        summary.pointsWon[event.winner]++;
        summary.reasons[event.reason] = (summary.reasons[event.reason] ?? 0) + 1;
        summary.rallyLengths.push(rally);
        rally = 0;
      } else if (event.type === 'fault') {
        summary.faults++;
        rally = 0;
      } else if (event.type === 'let') {
        rally = 0;
      } else if (event.type === 'match') {
        summary.winner = event.winner;
      }
    }
    match.events.length = 0;
    if (match.tick > maxTicks) {
      summary.stalled = true;
      break;
    }
  }
  summary.simSeconds = match.time;
  return summary;
}

export function testConfig(): GameConfig {
  return createConfig();
}
