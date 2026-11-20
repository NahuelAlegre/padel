import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { CONTROLS, type GameConfig, type RivalId } from '../../src/config';
import { HumanController } from '../../src/control/human';
import { Rng } from '../../src/core/rng';
import { InputState } from '../../src/input/state';
import { Match, type Controller, type PlayerEntry, type SimEvent } from '../../src/sim/match';
import { LANE_NET, SLIDE, SLIDE_MAX } from '../../src/sim/pair';
import type { Player } from '../../src/sim/player';
import type { Trajectory } from '../../src/sim/trajectory';
import type { PlayerIntent, ShotIntent } from '../../src/sim/types';
import { aiEntry, humanEntry, pairEntry, partnerEntry, ScriptedHuman, SKILLS, testConfig, withTactics, type ScriptedSkill } from '../helpers';

/**
 * Net camping: `npx vitest run --config vitest.sim.config.ts netcamp`.
 *
 * What the user found playing doubles (2026-11-20): standing at the net and
 * pressing the hit button without a stop is close to unbeatable, and a lob
 * over the head is the partner's problem. This plays that person against
 * the same person pressing once and on time, and against a person who plays
 * padel: goes up with its partner and goes back when a lob goes over.
 *
 *   plantado, apretando sin parar   stands at the net and never goes back; presses every `reswipeGap`
 *   plantado, una vez a tiempo      the same feet, and one press per ball with average hands
 *   normal                          the positional player of the doubles report (average hands)
 *   normal, temprano                the same, arming every shot early, as the net camper that presses at once
 *   normal que se adelanta          the same, and now and then a press just before the rival strikes
 *
 * In doubles: you on the left (revés) with each character of the cast, against
 * the other two. In singles: against each of them. Nothing is asserted.
 *
 *   NETCAMP_MATCHES=10   quicker, noisier (20 by default)
 *   NETCAMP_JSON=path    also writes the numbers to a file
 *   NETCAMP_ONLY=doubles only doubles (or singles)
 *   SIM_REACH=real       everybody with the reach of a real person
 *   SIM_ZONES=on         hit zones on
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const MATCHES = Number(env?.NETCAMP_MATCHES ?? 20);
const JSON_PATH = env?.NETCAMP_JSON;
const ONLY = env?.NETCAMP_ONLY;

/** Where the net camper stands, metres from the net. */
const CAMP = 3;
/** Closer to the net than this, somebody is at the net. */
const NET_ZONE = 5;
/** A lob over somebody at the net that bounces further back than this sends a pair back (see `BACK_LOB` in src/sim/match.ts). */
const DEEP = 7;

type Press = 'spam' | 'once' | 'early';
type Aim = 'neutral' | 'open';

/**
 * A person who stands at the net and never goes back. It steps sideways to
 * the line of a ball that comes to it (the ones closer to it than to its
 * partner) and returns the serve like anybody, and that is all the moving it
 * does. `spam` presses the hit button every `reswipeGap`, all the time;
 * `once` presses it once per ball, around the contact, with `skill`'s hands;
 * `early` presses it once per ball as soon as it has read it: always armed early.
 * `neutral` aims every press at the middle, at a comfortable depth (a tap of
 * the thumb that does not move); `open` aims at the widest gap of the other
 * side.
 */
class NetCamper implements Controller {
  private readonly input = new InputState();
  private readonly inner = new HumanController(this.input);
  private trajectory: Trajectory | null = null;
  private released = false;
  private thumbOffset: number | null = null;
  private serveAt = -1;
  private nextTap = 0;

  constructor(
    private readonly rng: Rng,
    private readonly skill: ScriptedSkill,
    private readonly press: Press,
    private readonly aim: Aim,
  ) {}

  onServeSetup(): void {
    this.trajectory = null;
    this.released = false;
    this.thumbOffset = null;
    this.serveAt = -1;
    this.nextTap = 0;
    this.input.clear();
  }

  update(match: Match, me: Player, intent: PlayerIntent): void {
    const rng = this.rng;
    const dir = me.team === 0 ? 1 : -1;
    if (match.phase === 'serve' && match.serverId === me.id) {
      if (this.serveAt < 0) this.serveAt = match.time + 0.5;
      if (match.time >= this.serveAt) this.input.pushSwing({ aim: rng.range(-0.8, 0.8), depth: 0.6, lob: false, power: 1 });
    }
    const rally = match.rally;
    const trajectory = match.trajectory;
    const incoming = rally.live && rally.hitter !== me.team && trajectory !== null;
    if (incoming && trajectory !== this.trajectory) {
      this.trajectory = trajectory;
      this.released = false;
      this.thumbOffset = null;
    }

    // Where it stands: at the net, on its side of the pair, slid with the ball.
    const mates = match.teams[me.team];
    const partner = mates.length > 1 ? (mates[0] === me ? mates[1]! : mates[0]!) : null;
    const slide = Math.max(-SLIDE_MAX, Math.min(SLIDE_MAX, match.ball.x * SLIDE));
    const side = partner ? Math.sign(me.x - partner.x) || (me.index === 0 ? dir : -dir) : 0;
    let targetX = partner ? side * LANE_NET + slide : Math.max(-1.2, Math.min(1.2, match.ball.x * 0.25));
    let targetY = -dir * CAMP;
    if (incoming && trajectory && match.time >= trajectory.t0 + this.skill.reaction) {
      const guide = me.guide;
      if (match.rallyHits === 1 && guide && match.assigned[me.team] === me.id) {
        // The serve has to bounce: it is returned like anybody returns it.
        targetX = guide.stanceX;
        targetY = guide.stanceY;
      } else {
        // A step to the side, to the line of a ball that comes to it. Not back: never back.
        const cross = crossing(trajectory, me, match);
        if (cross !== null && (!partner || Math.abs(cross - me.x) <= Math.abs(cross - partner.x))) {
          const off = cross - me.x;
          const sweet = match.config.player.sweetSpot;
          targetX = Math.abs(off) <= sweet ? me.x : cross - Math.sign(off) * sweet;
        }
      }
    }
    const dx = targetX - me.x;
    const dy = targetY - me.y;
    const distance = Math.hypot(dx, dy);
    const push = distance > 0.05 ? Math.min(1, distance / 0.6) : 0;
    this.input.setMove('stick', (dx / Math.max(distance, 1e-6)) * dir * push, (dy / Math.max(distance, 1e-6)) * dir * push);

    if (match.phase === 'rally') {
      if (this.press === 'spam') {
        // Without a stop: as often as the game takes a new swing.
        if (match.time >= this.nextTap) {
          this.nextTap = match.time + match.config.timing.reswipeGap;
          this.input.pushSwing(this.shot(match, me));
        }
      } else if (this.press === 'early') {
        if (incoming && trajectory && !this.released && match.time >= trajectory.t0 + this.skill.reaction) {
          this.released = true;
          this.input.pushSwing(this.shot(match, me));
        }
      } else if (incoming && !this.released && me.plan) {
        const contact = me.plan;
        if (this.thumbOffset === null) {
          const early = rng.chance(this.skill.armEarly) ? -rng.range(0.15, 0.45) : 0;
          this.thumbOffset = match.config.timing.latencyCompensation + early + rng.gauss() * this.skill.timing;
        }
        if (match.time >= contact.t + this.thumbOffset) {
          this.released = true;
          this.input.pushSwing(this.shot(match, me));
        }
      }
    }
    this.inner.update(match, me, intent);
  }

  /** What each press asks for. In screen terms, as the thumb asks: the controller turns it into the world. */
  private shot(match: Match, me: Player): ShotIntent {
    if (this.aim === 'neutral') return { aim: 0, depth: CONTROLS.restDepth, lob: false, power: 1 };
    const dir = me.team === 0 ? 1 : -1;
    const range = match.config.shots.specs.drive.aimRange;
    let best = 0;
    let bestGap = -Infinity;
    for (let aim = -1; aim <= 1.001; aim += 0.25) {
      let gap = Infinity;
      for (const rival of match.teams[me.team === 0 ? 1 : 0]) gap = Math.min(gap, Math.abs(rival.x - aim * range));
      gap += this.rng.range(0, 0.4);
      if (gap > bestGap) {
        bestGap = gap;
        best = aim;
      }
    }
    return { aim: best * dir, depth: this.rng.range(0.6, 0.95), lob: false, power: 1 };
  }
}

/** Where (world x) the ball crosses the depth `me` stands at, while it can still be hit there, or null. */
function crossing(trajectory: Trajectory, me: Player, match: Match): number | null {
  const depth = Math.abs(me.y);
  const highest = match.config.player.maxContactZ;
  for (const point of trajectory.points) {
    if (point.t < match.time || point.hittable !== me.team) continue;
    if (Math.abs(point.y) < depth || Math.sign(point.y) !== Math.sign(me.y)) continue;
    return point.z <= highest ? point.x : null;
  }
  return null;
}

/**
 * The positional player of the doubles report, who now and then (`chance` of
 * the balls the other side is about to strike, while it is at the net) also
 * presses a moment before the rival strikes: up to `lead` seconds before.
 * What a quick person at the net does, and what must not feel clumsy.
 */
class Anticipator implements Controller {
  private readonly inner: ScriptedHuman;
  private looked = -1;
  private pressAt = -1;
  /** How many times it pressed before the rival struck, for the report. */
  pressed = 0;

  private readonly rng: Rng;

  /** The same person as `normal` with the same `seed`, and its own dice for when it presses early. */
  constructor(
    seed: number,
    skill: ScriptedSkill,
    private readonly chance: number,
    private readonly lead: number,
  ) {
    this.inner = new ScriptedHuman(new Rng(seed), skill);
    this.rng = new Rng(seed ^ 0x5bd1e995);
  }

  onServeSetup(): void {
    this.inner.onServeSetup();
    this.looked = -1;
    this.pressAt = -1;
  }

  update(match: Match, me: Player, intent: PlayerIntent): void {
    this.inner.update(match, me, intent);
    const rally = match.rally;
    const trajectory = match.trajectory;
    if (match.phase !== 'rally' || !rally.live || rally.hitter !== me.team || !trajectory) return;
    // Once per ball, as soon as it can tell who of the other side is going for it and when it will strike.
    const other = match.players[match.assigned[me.team === 0 ? 1 : 0]];
    if (trajectory.id !== this.looked && other?.plan && other.plan.trajId === trajectory.id) {
      this.looked = trajectory.id;
      this.pressAt = -1;
      if (Math.abs(me.y) < NET_ZONE && this.rng.chance(this.chance)) this.pressAt = other.plan.t - this.rng.range(0, this.lead);
    }
    if (this.pressAt >= 0 && match.time >= this.pressAt && !intent.swing) {
      this.pressAt = -1;
      this.pressed++;
      intent.swing = { aim: 0, depth: CONTROLS.restDepth, lob: false, power: 1 };
    }
  }
}

type Variant = 'campSpam' | 'campOnce' | 'campEarly' | 'campSpamOpen' | 'campOnceOpen' | 'normal' | 'normalEarly' | 'anticipates';
const VARIANTS: Variant[] = ['campSpam', 'campOnce', 'campEarly', 'campSpamOpen', 'campOnceOpen', 'normal', 'normalEarly', 'anticipates'];
const VARIANT_NAME: Record<Variant, string> = {
  campSpam: 'plantado, apretando sin parar (al medio)',
  campOnce: 'plantado, una vez a tiempo (al medio)',
  campEarly: 'plantado, una vez y temprano (al medio)',
  campSpamOpen: 'plantado, apretando sin parar (al hueco)',
  campOnceOpen: 'plantado, una vez a tiempo (al hueco)',
  normal: 'normal: sube y baja con el compañero',
  normalEarly: 'normal, y siempre se prepara temprano',
  anticipates: 'normal que a veces aprieta antes del golpe rival',
};

const HANDS = SKILLS.average;

function person(variant: Variant, seed: number): PlayerEntry {
  const rng = new Rng(seed);
  switch (variant) {
    case 'campSpam':
      return humanEntry(seed, HANDS, { controller: new NetCamper(rng, HANDS, 'spam', 'neutral') });
    case 'campOnce':
      return humanEntry(seed, HANDS, { controller: new NetCamper(rng, HANDS, 'once', 'neutral') });
    case 'campEarly':
      return humanEntry(seed, HANDS, { controller: new NetCamper(rng, HANDS, 'early', 'neutral') });
    case 'campSpamOpen':
      return humanEntry(seed, HANDS, { controller: new NetCamper(rng, HANDS, 'spam', 'open') });
    case 'campOnceOpen':
      return humanEntry(seed, HANDS, { controller: new NetCamper(rng, HANDS, 'once', 'open') });
    case 'normal':
      return humanEntry(seed, withTactics(HANDS, 1));
    case 'normalEarly':
      return humanEntry(seed, { ...withTactics(HANDS, 1), armEarly: 1 });
    case 'anticipates':
      return humanEntry(seed, HANDS, { controller: new Anticipator(seed, withTactics(HANDS, 1), 0.35, 0.25) });
  }
}

interface Tally {
  matches: number;
  points: number;
  won: number;
  seconds: number;
  /** The person's hits, by quality. */
  hits: number;
  perfect: number;
  late: number;
  /** The person's swings at the air: because nothing was coming, or because it did not get there. */
  whiffNothing: number;
  whiffFar: number;
  /** Balls of the other side the person was at the net for, and of those the ones it let go by without a swing. */
  /** Lobs of the other side over the person at the net, on the person's half of the pair. */
  lobs: number;
  /** Of those: who played the next ball, how it came out, and who won the point. */
  lobByPerson: number;
  lobByPartner: number;
  lobNobody: number;
  lobNobodyLost: number;
  lobPartnerForced: number;
  lobPartnerPressure: number;
  lobPartnerHurried: number;
  lobPartnerLob: number;
  lobWon: number;
  /** The rally after the lob, while the person stays at the net and the partner is at the back: balls the other side played, and how many into the hole or at the person's feet. */
  splitBalls: number;
  splitHole: number;
  splitFeet: number;
  splitFeetPressure: number;
  splitWon: number;
  splitPoints: number;
  /** The person's volleys below the tape at the net: how many, how hard they were, how many won the point. */
  lowVolleys: number;
  lowVolleyPressure: number;
}

const emptyTally = (): Tally => ({
  matches: 0, points: 0, won: 0, seconds: 0, hits: 0, perfect: 0, late: 0, whiffNothing: 0, whiffFar: 0,
  lobs: 0, lobByPerson: 0, lobByPartner: 0, lobNobody: 0, lobNobodyLost: 0, lobPartnerForced: 0, lobPartnerPressure: 0, lobPartnerHurried: 0, lobPartnerLob: 0, lobWon: 0,
  splitBalls: 0, splitHole: 0, splitFeet: 0, splitFeetPressure: 0, splitWon: 0, splitPoints: 0, lowVolleys: 0, lowVolleyPressure: 0,
});

type Lineup = { name: string; doubles: boolean; teams: (config: GameConfig, me: PlayerEntry, seed: number) => [PlayerEntry[], PlayerEntry[]] };

const doublesWith = (mate: RivalId, rivals: [RivalId, RivalId]): Lineup => ({
  name: `dobles, con ${mate} contra ${rivals.join(' y ')}`,
  doubles: true,
  // The person on the left (revés), as the game has it by default.
  teams: (config, me, seed) => [[partnerEntry(config, mate, seed + 1), me], [pairEntry(config, rivals[0], seed + 2), pairEntry(config, rivals[1], seed + 3)]],
});
const singlesAgainst = (rival: RivalId): Lineup => ({
  name: `1 contra 1, contra ${rival}`,
  doubles: false,
  teams: (config, me, seed) => [[me], [aiEntry(config, rival, seed + 1)]],
});

const LINEUPS: Lineup[] = [
  ...(ONLY === 'singles' ? [] : [doublesWith('beto', ['romina', 'chela']), doublesWith('romina', ['beto', 'chela']), doublesWith('chela', ['beto', 'romina'])]),
  ...(ONLY === 'doubles' ? [] : [singlesAgainst('beto'), singlesAgainst('romina'), singlesAgainst('chela')]),
];

function play(lineup: Lineup, variant: Variant): Tally {
  const tally = emptyTally();
  for (let i = 0; i < MATCHES; i++) {
    const config = testConfig();
    const seed = 3000 + i * 11;
    const me = person(variant, seed);
    const [near, far] = lineup.teams(config, me, seed);
    const match = new Match({ config, seed: 700 + i, firstServer: i % 2 === 0 ? 0 : 1, teams: [{ name: 'A', players: near }, { name: 'B', players: far }] });
    const you = match.teams[0].find((player) => player.isHuman)!;
    const mate = match.teams[0].find((player) => player !== you) ?? null;
    // The lob being followed: set when a lob of the other side goes over the person at the net.
    let lobOpen = false;
    let afterLob = false;
    let splitPoint = false;
    const onEvent = (event: SimEvent): void => {
      if (event.type === 'whiff' && event.player === you.id) {
        if (event.reason === 'nothing') tally.whiffNothing++;
        else tally.whiffFar++;
      }
      if (event.type === 'hit') {
        if (event.player === you.id && event.kind !== 'serve') {
          tally.hits++;
          if (event.quality === 'perfect') tally.perfect++;
          if (event.quality === 'late') tally.late++;
          if (event.volley && Math.abs(event.y) < NET_ZONE && event.z < match.config.court.netCenter) {
            tally.lowVolleys++;
            tally.lowVolleyPressure += event.pressure;
          }
        }
        if (lobOpen && event.team === 0) {
          lobOpen = false;
          if (event.player === you.id) tally.lobByPerson++;
          else {
            tally.lobByPartner++;
            tally.lobPartnerPressure += event.pressure;
            if (event.pressure >= 0.45) tally.lobPartnerHurried++;
            if (event.kind === 'lob') tally.lobPartnerLob++;
            if (event.why === 'forced' || event.why === 'gamble') tally.lobPartnerForced++;
          }
        }
        // The other side strikes: is it a lob over the person at the net, on its half?
        if (event.team === 1 && event.kind === 'lob' && mate && Math.abs(you.y) < NET_ZONE && match.trajectory) {
          const bounce = match.trajectory.bounces[0];
          const mid = (you.x + mate.x) / 2;
          if (bounce && Math.abs(bounce.y) > DEEP && Math.sign(bounce.x - mid) === Math.sign(you.x - mid)) {
            tally.lobs++;
            lobOpen = true;
            afterLob = true;
          }
        }
        // While the pair is split with the person at the net, where the other side plays.
        if (event.team === 1 && event.kind !== 'serve' && mate && Math.abs(you.y) < NET_ZONE && Math.abs(mate.y) > 6.5 && match.trajectory) {
          tally.splitBalls++;
          splitPoint = true;
          const bounce = match.trajectory.bounces[0];
          const points = match.trajectory.points;
          // At the feet: it comes by the person low, under the tape, within a step and a half.
          const feet = points.some((p) => p.hittable === 0 && Math.abs(p.y) >= Math.abs(you.y) - 0.6 && Math.abs(p.y) <= Math.abs(you.y) + 0.6 && p.z < 0.8 && Math.abs(p.x - you.x) < 1.6);
          if (feet) tally.splitFeet++;
          else if (bounce && Math.abs(bounce.x - mate.x) > 2 && Math.abs(bounce.x - you.x) > 1.6) tally.splitHole++;
        }
      }
      if (event.type === 'point') {
        tally.points++;
        if (event.winner === 0) tally.won++;
        if (lobOpen) tally.lobNobody++;
        if (lobOpen && event.winner === 1) tally.lobNobodyLost++;
        if (afterLob && event.winner === 0) tally.lobWon++;
        if (splitPoint) {
          tally.splitPoints++;
          if (event.winner === 0) tally.splitWon++;
        }
        lobOpen = false;
        afterLob = false;
        splitPoint = false;
      }
      if (event.type === 'fault' || event.type === 'let') {
        lobOpen = false;
        afterLob = false;
        splitPoint = false;
      }
    };
    while (match.phase !== 'matchOver' && match.tick < 3600 * 120) {
      match.step();
      for (const event of match.events) onEvent(event);
      match.events.length = 0;
    }
    tally.matches++;
    tally.seconds += match.time;
  }
  return tally;
}

const pct = (part: number, whole: number): string => (whole > 0 ? `${((100 * part) / whole).toFixed(1)} %` : '—');
const per = (part: number, whole: number): string => (whole > 0 ? (part / whole).toFixed(2) : '—');

const collected: Record<string, unknown> = {};

describe('plantarse en la red', () => {
  it('cuánto gana quien se planta y aprieta sin parar, contra quien aprieta una vez y quien juega bien', () => {
    const out: string[] = [`\nPlantarse en la red (${MATCHES} partidos por casilla, manos de jugador promedio)`];
    for (const lineup of LINEUPS) {
      out.push(`\n${lineup.name}`);
      for (const variant of VARIANTS) {
        if (!lineup.doubles && variant === 'anticipates') continue;
        const t = play(lineup, variant);
        collected[`${lineup.name} · ${variant}`] = t;
        if (JSON_PATH) writeFileSync(JSON_PATH, JSON.stringify(collected, null, 1));
        out.push(
          `  ${VARIANT_NAME[variant].padEnd(46)} gana ${pct(t.won, t.points).padStart(7)} de los puntos; perfectos ${pct(t.perfect, t.hits)}, tarde ${pct(t.late, t.hits)}; al aire por partido ${per(t.whiffNothing, t.matches)} (nada) + ${per(t.whiffFar, t.matches)} (no llegó); ${(t.seconds / Math.max(1, t.points)).toFixed(1)} s por punto`,
        );
        if (lineup.doubles && t.lobs) {
          out.push(
            `      globos por su lado: ${per(t.lobs, t.matches)} por partido; los juega él ${pct(t.lobByPerson, t.lobs)}, el compañero ${pct(t.lobByPartner, t.lobs)} (presión media ${per(t.lobPartnerPressure, t.lobByPartner)}, apurado ${pct(t.lobPartnerHurried, t.lobByPartner)}, forzado ${pct(t.lobPartnerForced, t.lobByPartner)}, con globo ${pct(t.lobPartnerLob, t.lobByPartner)}), nadie ${pct(t.lobNobody, t.lobs)} (y se pierde ${pct(t.lobNobodyLost, t.lobs)}); esos puntos los gana ${pct(t.lobWon, t.lobs)}`,
          );
        }
        if (lineup.doubles && t.splitBalls) {
          out.push(
            `      partidos (él en la red, el compañero atrás): ${per(t.splitBalls, t.matches)} pelotas por partido, al hueco ${pct(t.splitHole, t.splitBalls)}, a los pies ${pct(t.splitFeet, t.splitBalls)}; esos puntos los gana ${pct(t.splitWon, t.splitPoints)}`,
          );
        }
        if (t.lowVolleys) out.push(`      voleas por debajo de la faja en la red: ${per(t.lowVolleys, t.matches)} por partido, presión media ${per(t.lowVolleyPressure, t.lowVolleys)}`);
      }
    }
    console.log(out.join('\n'));
  });
});
