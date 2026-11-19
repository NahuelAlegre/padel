import { SIM_DT } from '../src/config';
import type { Match, SimEvent } from '../src/sim/match';
import { lowestContact, playerReach, type Player } from '../src/sim/player';
import type { Trajectory } from '../src/sim/trajectory';
import type { Attitude } from '../src/sim/pair';

/**
 * Watches a match the way somebody next to the court would, and counts what
 * makes a computer player look like a person or not:
 *
 *   - a ball that goes right by a player, within its reach, which it had to
 *     play (untouched, it loses the point) and nobody of its pair even tried;
 *   - how long it takes to start going for a ball (its reaction);
 *   - the balls it took from its partner («¡mía!»), and how they came out;
 *   - why the points that end in a mistake ended in one.
 *
 * It looks only at what can be seen on the court and at the events of the
 * match: positions, the ball, swings and calls. Call `step()` after every
 * `match.step()`, before the events are cleared.
 */

/** From this long after the shot, any player can get the racket to a ball that comes at it. */
export const ANY_REFLEX = 0.25;
/** Highest ball counted as one that comes at a player: over this it is a jump. */
const HIGHEST = 2.2;
/** A ball counts as going by a player only if it passes this much closer to it than to its partner. */
const CLOSER = 0.5;
/** A ball counts as within reach only with this much to spare. */
const MARGIN = 0.1;
/** A windup still aiming at a contact this long (seconds) after it passed is a stale one. */
const STALE = 0.05;

/** Why a point ended in a mistake of whoever hit last, from what that swing was like. */
export type ErrorCause = 'forced' | 'gamble' | 'reflex' | 'long' | 'plain';

export const ERROR_NAME: Record<ErrorCause, string> = {
  forced: 'forzado (pelota exigida)',
  gamble: 'fue por todo con una exigida',
  reflex: 'bloqueo al cuerpo',
  long: 'punto largo',
  plain: 'no forzado',
};

/** Ways a point ends that the last hitter won: the other side did not get there. */
const WON_BY_HITTER = new Set(['doubleBounce', 'overNet', 'outAfterBounce']);
/** A ball at least this hard to play (0..1) is a difficult one. */
const HARD = 0.45;
/** From this many hits into a point, it is a long one. */
const LONG = 12;

export interface StealOutcome {
  /** It struck the ball and the point went on, or was won on that ball or the next. */
  good: number;
  /** It struck the ball into a mistake. */
  error: number;
  /** It did not get to it. */
  missed: number;
}

interface Watched {
  player: Player;
  /** The ball went by it within reach, and it had to be played. */
  by: boolean;
  attempted: boolean;
  /** When it first had somewhere to go for this ball, if it was its own, and whether by reflex. */
  plannedAt: number;
  reflex: boolean;
}

interface Ball {
  traj: Trajectory;
  team: 0 | 1;
  t0: number;
  mustPlay: boolean;
  touched: boolean;
  watched: Watched[];
  /** Who took it from its partner («¡mía!»), if anybody. */
  stealer: Player | null;
  stealCounted: boolean;
  /** Whose ball it was in the end, and why, for the record of a ball nobody tried. */
  owners: string[];
}

export interface ProbeTotals {
  /** Balls that went by a player of the pair within its reach and had to be played, by who: partner (computer) or person. */
  byPartner: number;
  byPerson: number;
  /** Of those, the ones nobody of the pair even tried. */
  untouchedPartner: number;
  untouchedPerson: number;
  /** The same for the computer pair across the net. */
  byRivals: number;
  untouchedRivals: number;
  /** Seconds from the shot to having somewhere to go, for the balls each one played: the partner, and the rivals. */
  reactionPartner: number[];
  reactionRivals: number[];
  /** Blocks of a ball at the body (reflex). */
  reflexPartner: number;
  reflexRivals: number;
  /** Balls taken from the partner («¡mía!»), by side and by the attitude of whoever took them, and how they came out. */
  steals: [Partial<Record<Attitude, StealOutcome>>, Partial<Record<Attitude, StealOutcome>>];
  /** Points that ended in a mistake, by why, for each side of the net. */
  errors: [Record<ErrorCause, number>, Record<ErrorCause, number>];
  /** Swings of computer players that met nothing because the ball was already out of reach («no llegó»), for each side. */
  lateMisses: [number, number];
  /** What happened with the balls nobody tried, for a look at why: owner and reason. */
  untouchedWhy: Record<string, number>;
  /**
   * Windups that went on aiming at a contact that had already passed without
   * a swing (`anim.contactAt` behind the clock by more than `STALE`): how many
   * times, and for how long in all, for each side. The body gets ready for one
   * ball and plays another.
   */
  stale: [number, number];
  staleSeconds: [number, number];
}

const emptyErrors = (): Record<ErrorCause, number> => ({ forced: 0, gamble: 0, reflex: 0, long: 0, plain: 0 });

export function emptyTotals(): ProbeTotals {
  return {
    byPartner: 0,
    byPerson: 0,
    untouchedPartner: 0,
    untouchedPerson: 0,
    byRivals: 0,
    untouchedRivals: 0,
    reactionPartner: [],
    reactionRivals: [],
    reflexPartner: 0,
    reflexRivals: 0,
    steals: [{}, {}],
    errors: [emptyErrors(), emptyErrors()],
    lateMisses: [0, 0],
    stale: [0, 0],
    staleSeconds: [0, 0],
    untouchedWhy: {},
  };
}

export class PairProbe {
  private ball: Ball | null = null;
  private lastHit: Extract<SimEvent, { type: 'hit' }> | null = null;
  private hits = 0;
  /** The steal of the point that has to wait for the next ball to know how it came out. */
  private pendingSteal: { player: Player; touches: number } | null = null;
  private touches: [number, number] = [0, 0];
  private readonly staleNow = new Set<number>();

  constructor(
    private readonly match: Match,
    readonly totals: ProbeTotals = emptyTotals(),
  ) {}

  step(): void {
    const match = this.match;
    for (const event of match.events) this.onEvent(event);
    this.watchWindups();
    const ball = this.ball;
    if (!ball || match.trajectory !== ball.traj || !match.rally.live) return;
    const config = match.config;
    const team = ball.team;
    const mates = match.teams[team];
    const b = match.ball;
    const rally = match.rally;
    const hittable = rally.hitter !== team && (b.y < 0) === (team === 0) && rally.bounces <= 1 && !(rally.isServe && rally.bounces === 0);
    const lowest = lowestContact(config, false) + 0.05;
    const owner = match.players[match.assigned[team]];
    const tag = owner ? `${owner.isHuman ? 'persona' : 'compu'}:${match.pairs[team].why}` : '-';
    if (ball.owners[ball.owners.length - 1] !== tag) ball.owners.push(tag);
    if (mates.length === 2 && match.pairs[team].why === 'steal' && owner && !owner.isHuman) ball.stealer = owner;
    for (const watched of ball.watched) {
      const player = watched.player;
      if (player.swing) watched.attempted = true;
      if (watched.plannedAt < 0 && player.plan && player.plan.trajId === ball.traj.id && match.assigned[team] === player.id) {
        watched.plannedAt = match.time;
        watched.reflex = player.plan.reflex === true;
      }
      if (watched.by || !hittable || b.z < lowest || b.z > HIGHEST || match.time < ball.t0 + ANY_REFLEX) continue;
      const gap = Math.hypot(b.x - player.x, b.y - player.y);
      const mate = mates.find((other) => other !== player);
      const other = mate ? Math.hypot(b.x - mate.x, b.y - mate.y) : Infinity;
      if (gap <= playerReach(player, config, b.z) - MARGIN && other > gap + CLOSER) watched.by = true;
    }
  }

  /** Windups of the computer players that went on past their contact (see `ProbeTotals.stale`). */
  private watchWindups(): void {
    const match = this.match;
    for (const player of match.players) {
      if (player.isHuman) continue;
      const anim = player.anim;
      const waiting = match.phase === 'rally' && anim.kind === 'swing' && anim.t0 === Infinity && match.time > anim.contactAt + STALE;
      if (waiting) {
        if (!this.staleNow.has(player.id)) this.totals.stale[player.team]++;
        this.staleNow.add(player.id);
        this.totals.staleSeconds[player.team] += SIM_DT;
      } else {
        this.staleNow.delete(player.id);
      }
    }
  }

  private onEvent(event: SimEvent): void {
    const match = this.match;
    switch (event.type) {
      case 'hit': {
        this.hits++;
        this.touches[event.team]++;
        if (this.ball && event.team === this.ball.team) {
          this.ball.touched = true;
          for (const watched of this.ball.watched) if (watched.player.id === event.player) watched.attempted = true;
        }
        this.settleSteal(event.team, false);
        if (this.ball?.stealer && this.ball.stealer.id === event.player) {
          // It took it, and struck it: how it comes out is known on the next ball, or at the end of the point.
          this.pendingSteal = { player: this.ball.stealer, touches: this.touches[event.team === 0 ? 1 : 0] };
          this.ball.stealCounted = true;
        }
        this.close();
        this.lastHit = event;
        const trajectory = match.trajectory;
        if (trajectory) {
          const team = event.team === 0 ? 1 : 0;
          const end = trajectory.end;
          this.ball = {
            traj: trajectory,
            team,
            t0: match.time,
            mustPlay: end !== null && end.result.kind === 'point' && end.result.winner === event.team,
            touched: false,
            watched: match.teams[team].map((player) => ({ player, by: false, attempted: false, plannedAt: -1, reflex: false })),
            stealer: null,
            stealCounted: false,
            owners: [],
          };
        }
        break;
      }
      case 'whiff': {
        if (this.ball) for (const watched of this.ball.watched) if (watched.player.id === event.player) watched.attempted = true;
        const player = match.players[event.player];
        if (event.reason === 'far' && player && !player.isHuman) this.totals.lateMisses[player.team]++;
        break;
      }
      case 'point': {
        const last = this.lastHit;
        if (this.ball?.stealer && !this.ball.stealCounted) this.steal(this.ball.stealer).missed++;
        if (last && this.hits > 1 && !WON_BY_HITTER.has(event.reason) && event.winner !== last.team) {
          this.totals.errors[last.team][this.causeOf(last)]++;
          // A steal that went straight into a mistake.
          if (this.pendingSteal && this.pendingSteal.player.id === last.player) {
            this.steal(this.pendingSteal.player).error++;
            this.pendingSteal = null;
          }
        }
        this.settleSteal(-1, true);
        this.close();
        this.reset();
        break;
      }
      case 'fault':
      case 'let':
        // Nothing to count: the ball did not have to be played, or the point is played again.
        this.ball = null;
        this.reset();
        break;
    }
  }

  /** A steal is good once the other side has had to play the ball back, or the point ended in its favour. */
  private settleSteal(hitter: number, pointOver: boolean): void {
    const pending = this.pendingSteal;
    if (!pending) return;
    if (pointOver || hitter !== pending.player.team) {
      this.steal(pending.player).good++;
      this.pendingSteal = null;
    }
  }

  private steal(player: Player): StealOutcome {
    const steals = this.totals.steals[player.team];
    return (steals[player.attitude] ??= { good: 0, error: 0, missed: 0 });
  }

  private causeOf(hit: Extract<SimEvent, { type: 'hit' }>): ErrorCause {
    if (hit.why === 'reflex') return 'reflex';
    if (hit.why === 'gamble') return 'gamble';
    if (hit.why === 'forced' || hit.pressure >= HARD) return 'forced';
    if (this.hits >= LONG) return 'long';
    return 'plain';
  }

  private close(): void {
    const ball = this.ball;
    if (!ball) return;
    const totals = this.totals;
    const team = ball.team;
    for (const watched of ball.watched) {
      const player = watched.player;
      const nearSide = team === 0;
      if (watched.plannedAt >= 0) {
        if (!player.isHuman && nearSide) totals.reactionPartner.push(watched.plannedAt - ball.t0);
        else if (!player.isHuman) totals.reactionRivals.push(watched.plannedAt - ball.t0);
        if (watched.reflex && nearSide) totals.reflexPartner++;
        else if (watched.reflex) totals.reflexRivals++;
      }
      if (!watched.by || !ball.mustPlay) continue;
      const untouched = !ball.touched && !watched.attempted;
      if (!nearSide) {
        totals.byRivals++;
        if (untouched) totals.untouchedRivals++;
      } else if (player.isHuman) {
        totals.byPerson++;
        if (untouched) totals.untouchedPerson++;
      } else {
        totals.byPartner++;
        if (untouched) {
          totals.untouchedPartner++;
          const key = ball.owners.join(' > ');
          totals.untouchedWhy[key] = (totals.untouchedWhy[key] ?? 0) + 1;
        }
      }
    }
    this.ball = null;
  }

  private reset(): void {
    this.lastHit = null;
    this.hits = 0;
    this.pendingSteal = null;
    this.touches = [0, 0];
  }
}

/** Adds what one probe counted to a running total. */
export function addTotals(into: ProbeTotals, from: ProbeTotals): void {
  into.byPartner += from.byPartner;
  into.byPerson += from.byPerson;
  into.untouchedPartner += from.untouchedPartner;
  into.untouchedPerson += from.untouchedPerson;
  into.byRivals += from.byRivals;
  into.untouchedRivals += from.untouchedRivals;
  into.reactionPartner.push(...from.reactionPartner);
  into.reactionRivals.push(...from.reactionRivals);
  into.reflexPartner += from.reflexPartner;
  into.reflexRivals += from.reflexRivals;
  for (const side of [0, 1] as const) {
    for (const [attitude, outcome] of Object.entries(from.steals[side]) as Array<[Attitude, StealOutcome]>) {
      const entry = (into.steals[side][attitude] ??= { good: 0, error: 0, missed: 0 });
      entry.good += outcome.good;
      entry.error += outcome.error;
      entry.missed += outcome.missed;
    }
    for (const key of Object.keys(from.errors[side]) as ErrorCause[]) into.errors[side][key] += from.errors[side][key];
    into.lateMisses[side] += from.lateMisses[side];
    into.stale[side] += from.stale[side];
    into.staleSeconds[side] += from.staleSeconds[side];
  }
  for (const [key, n] of Object.entries(from.untouchedWhy)) into.untouchedWhy[key] = (into.untouchedWhy[key] ?? 0) + n;
}
