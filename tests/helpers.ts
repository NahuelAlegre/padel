import { createConfig, type AILevelName, type GameConfig } from '../src/config';
import { AIController } from '../src/control/ai';
import { HumanController } from '../src/control/human';
import { Rng } from '../src/core/rng';
import { InputState } from '../src/input/state';
import type { InterceptPlan } from '../src/sim/intercept';
import { Match, type Controller, type PlayerEntry, type SimEvent } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { PlayerIntent, ShotRequest } from '../src/sim/types';

export function aiEntry(config: GameConfig, level: AILevelName, seed: number, name = 'IA'): PlayerEntry {
  const params = config.ai[level];
  return {
    name,
    isHuman: false,
    manual: false,
    speedFactor: params.speedFactor,
    reaction: params.reaction,
    errorScale: params.errorScale,
    hand: 1,
    controller: new AIController(params, new Rng(seed)),
  };
}

/**
 * Plays like a person using the assisted controls: it goes through the real
 * InputState and HumanController, swiping around the contact with a given
 * timing spread and picking shots at random.
 */
export class ScriptedHuman implements Controller {
  private readonly input = new InputState();
  private readonly inner = new HumanController(this.input);
  private lastPlan: InterceptPlan | null = null;
  private swipeAt = -1;
  private serveAt = -1;

  constructor(
    private readonly rng: Rng,
    private readonly timingSigma: number,
    private readonly shots: ShotRequest[] = ['drive', 'drive', 'drive', 'lob', 'safe'],
    private readonly aimSmart = 0.6,
  ) {}

  onServeSetup(): void {
    this.lastPlan = null;
    this.swipeAt = -1;
    this.serveAt = -1;
  }

  update(match: Match, me: Player, intent: PlayerIntent): void {
    if (match.phase === 'serve' && match.serverId === me.id) {
      if (this.serveAt < 0) this.serveAt = match.time + 0.5;
      if (match.time >= this.serveAt) this.input.pushSwing({ kind: 'safe', aim: this.rng.range(-0.8, 0.8) });
    }
    const plan = me.plan;
    if (plan && plan !== this.lastPlan) {
      this.lastPlan = plan;
      // The match subtracts the latency compensation, so add it back to be centred.
      this.swipeAt = plan.t + match.config.timing.latencyCompensation + this.rng.gauss() * this.timingSigma;
    }
    if (!plan) this.lastPlan = null;
    if (plan && this.swipeAt >= 0 && match.time >= this.swipeAt) {
      const kind = this.shots[Math.floor(this.rng.next() * this.shots.length)] ?? 'drive';
      // Most of the time a person aims at the open court, the rest anywhere.
      const rival = match.teams[me.team === 0 ? 1 : 0][0]!;
      const open = rival.x > 0 ? this.rng.range(-1, -0.5) : this.rng.range(0.5, 1);
      const aim = this.rng.chance(this.aimSmart) ? open : this.rng.range(-1, 1);
      this.input.pushSwing({ kind, aim: kind === 'safe' ? 0 : aim });
      this.swipeAt = -1;
    }
    this.inner.update(match, me, intent);
  }
}

export function humanEntry(seed: number, timingSigma: number, shots?: ShotRequest[]): PlayerEntry {
  return {
    name: 'Vos',
    isHuman: true,
    manual: false,
    speedFactor: 1,
    reaction: 0.12,
    errorScale: 1,
    hand: 1,
    controller: new ScriptedHuman(new Rng(seed), timingSigma, shots),
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
