import { createConfig, type GameConfig, type RivalId } from '../src/config';
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

export function aiEntry(config: GameConfig, rival: RivalId, seed: number, name = 'IA'): PlayerEntry {
  const level = config.rivals[rival];
  return {
    name,
    isHuman: false,
    manual: false,
    speedFactor: level.speedFactor,
    reaction: level.reaction,
    errorScale: level.errorScale,
    reachScale: 1,
    hand: 1,
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
}

export const SKILLS = {
  beginner: { timing: 0.16, position: 0.7, reaction: 0.35, aimSmart: 0.4, armEarly: 0.6 },
  average: { timing: 0.1, position: 0.45, reaction: 0.25, aimSmart: 0.6, armEarly: 0.4 },
  expert: { timing: 0.05, position: 0.25, reaction: 0.18, aimSmart: 0.8, armEarly: 0.2 },
} satisfies Record<string, ScriptedSkill>;

/**
 * Plays like a person with the default controls: it goes through the real
 * InputState and HumanController, pushing the stick toward where it thinks it
 * should stand (with a delay and an error) and releasing the aim around the
 * arrival of the ball.
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

  constructor(
    private readonly rng: Rng,
    private readonly skill: ScriptedSkill,
  ) {}

  onServeSetup(): void {
    this.trajectory = null;
    this.thumbOffset = null;
    this.released = false;
    this.serveAt = -1;
    this.input.clear();
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
    let targetY = -7.2 * (me.team === 0 ? 1 : -1);
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
        const pick = rng.next();
        if (pick < 0.15) this.input.pushSwing({ aim, depth: 1, lob: true, power: 1 });
        else if (pick < 0.2) this.input.pushSwing({ aim, depth: 0.1, lob: false, power: 1 });
        else this.input.pushSwing({ aim, depth: rng.range(0.6, 1), lob: false, power: 1 });
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
