import { writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { createScene, fillScene, type SceneOptions } from '../../src/app/scene';
import type { GameConfig, RivalId } from '../../src/config';
import { InputState } from '../../src/input/state';
import { Match, type PlayerEntry } from '../../src/sim/match';
import { HIT_ZONES, type HitZone } from '../../src/sim/zones';
import { aiEntry, humanEntry, pairEntry, partnerEntry, SKILLS, testConfig, withTactics, type ScriptedSkill, type SkillName } from '../helpers';

/**
 * Hit zones report: `npm run sim` (or `npx vitest run --config vitest.sim.config.ts zones`).
 *
 * Does standing well pay, with the hit zones on (docs/zonas.md)? Every cell
 * is played with the zones off and on, with the same seeds:
 *
 *   - standing well against not setting up: the same hands, the same head
 *     and the same legs, one ending up where the ball is comfortable to hit
 *     and the other anywhere within a stride of it (see `Who`), in 1 against
 *     1 (today's reach, the quick match) and in doubles (the real reach, at
 *     the revés), against Beto, Romina and Chela;
 *   - where the balls are met around the body, by zone, and how many behind
 *     the feet, for the person and for the computer;
 *   - whether the game gets harder or easier: the simulated person of the
 *     other reports (its hands, playing padel), its points, how long the
 *     points are, how they end, and the differences between rivals;
 *   - whether the body shows it before the contact: how often the stroke of a
 *     ball met at the body was drawn blocked, and of one met past it hurried.
 *
 * Nothing is asserted. What falls outside a target is printed as a warning.
 *
 *   SIM_MATCHES=10   quicker, noisier
 *   SIM_SKILL=expert other hands (beginner, average, expert)
 *   SIM_JSON=path    also writes the numbers to a file
 *   SIM_TWEAK='{"zones.weights.body":0.8}'  other numbers, without touching src/config.ts
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const MATCHES = Number(env?.SIM_MATCHES ?? 30);
const SKILL = (env?.SIM_SKILL ?? 'average') as SkillName;
const JSON_PATH = env?.SIM_JSON;
const TWEAK = JSON.parse(env?.SIM_TWEAK ?? '{}') as Record<string, number | boolean>;
/** The target: what standing well is worth over not setting up, in points won. */
const PAYS = 15;
const RIVALS: RivalId[] = ['beto', 'romina', 'chela'];
const WON_BY_HITTER = new Set(['doubleBounce', 'overNet', 'outAfterBounce']);

/**
 * Who plays the person, with the same hands, head and legs:
 *   careful   sets up for every ball: it ends up a few centimetres from where
 *             the ball is comfortable to hit (to its side, a little behind
 *             where it is met), easing the stick off on the way in
 *   anywhere  does not set up: getting to the ball is enough, so it ends up
 *             anywhere within a stride of where the ball is met (at the body,
 *             past it, to the side, at full stretch), easing off the same
 */
type Who = 'careful' | 'anywhere';
const WHO_NAME: Record<Who, string> = { careful: 'bien parado', anywhere: 'sin acomodarse' };
/** How far from where it meant to stand the careful one ends up, in metres, and from how far out both ease off the stick. */
const CAREFUL = 0.15;
const SETTLE = 0.6;

function skillOf(who: Who): ScriptedSkill {
  const hands = withTactics(SKILLS[SKILL], 1);
  return who === 'careful' ? { ...hands, position: CAREFUL, settle: SETTLE } : { ...hands, placement: 'anywhere', settle: SETTLE };
}

function trial(zones: boolean, real: boolean): GameConfig {
  const config = testConfig();
  config.zones.on = zones;
  config.player.realReach = real;
  for (const [path, value] of Object.entries(TWEAK)) {
    const keys = path.split('.');
    let at = config as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) at = at[key] as Record<string, unknown>;
    at[keys[keys.length - 1]!] = value;
  }
  return config;
}

interface Looks {
  /** Balls met at the body, and how many of those strokes the body drew blocked before the contact. */
  body: number;
  blocked: number;
  /** Balls met past the body, and how many drawn hurried. */
  behind: number;
  hurried: number;
  /** Balls met anywhere else, and how many of those were drawn blocked all the same. */
  other: number;
  blockedElse: number;
}

interface Stats {
  points: [number, number];
  wins: [number, number];
  seconds: number[];
  /** Points that ended in a mistake of whoever hit last, by side. */
  byError: [number, number];
  /** Hits by zone, for the person and for the computer players. */
  zones: [Record<HitZone, number>, Record<HitZone, number>];
  behindFeet: [number, number];
  hits: [number, number];
  /** Swings of the computer that met nothing («no llegó»). */
  whiffs: number;
  looks: Looks;
}

type Setup = (config: GameConfig, seed: number) => [PlayerEntry[], PlayerEntry[]];
const emptyZones = (): Record<HitZone, number> => ({ ideal: 0, body: 0, far: 0, behind: 0, high: 0, low: 0 });

function play(setup: Setup, zones: boolean, real: boolean, looks = false): Stats {
  const stats: Stats = {
    points: [0, 0],
    wins: [0, 0],
    seconds: [],
    byError: [0, 0],
    zones: [emptyZones(), emptyZones()],
    behindFeet: [0, 0],
    hits: [0, 0],
    whiffs: 0,
    looks: { body: 0, blocked: 0, behind: 0, hurried: 0, other: 0, blockedElse: 0 },
  };
  const options: SceneOptions = { aids: 'minimal', aidStrength: 1, reduceMotion: false, debug: false, cueLead: 0, tutorial: null, cast: [], acts: [] };
  for (let i = 0; i < MATCHES; i++) {
    const config = trial(zones, real);
    const [near, far] = setup(config, 1000 + i * 7);
    const match = new Match({ config, seed: 500 + i, firstServer: i % 2 === 0 ? 0 : 1, teams: [{ name: 'A', players: near }, { name: 'B', players: far }] });
    const scene = looks ? createScene() : null;
    const input = new InputState();
    // What each player's body was showing for its stroke, the last frame before its contact.
    const shown: Array<string | null> = match.players.map(() => null);
    let startedAt = -1;
    let lastTeam: 0 | 1 = 0;
    while (match.phase !== 'matchOver' && match.tick < 3600 * 120) {
      match.step();
      if (scene && match.tick % 2 === 0) {
        // Drawn at 60 frames a second, as the game does.
        fillScene(scene, match, 1, input, options);
        scene.players.forEach((player, k) => {
          if (player.anim === 'swing' && player.contactIn > 0) shown[k] = player.why;
        });
      }
      for (const event of match.events) {
        if (event.type === 'hit') {
          if (startedAt < 0) startedAt = match.time;
          lastTeam = event.team;
          if (event.kind === 'serve') continue;
          const who = match.players[event.player]!.isHuman ? 0 : 1;
          stats.hits[who]++;
          stats.zones[who][event.zone!]++;
          if (event.ahead! < 0) stats.behindFeet[who]++;
          if (scene) {
            const look = shown[event.player];
            const l = stats.looks;
            if (event.zone === 'body') {
              l.body++;
              if (look === 'block') l.blocked++;
            } else if (event.zone === 'behind') {
              l.behind++;
              if (look === 'hurried') l.hurried++;
            } else {
              l.other++;
              if (look === 'block') l.blockedElse++;
            }
            shown[event.player] = null;
          }
        } else if (event.type === 'whiff' && event.reason === 'far' && !match.players[event.player]!.isHuman) {
          stats.whiffs++;
        } else if (event.type === 'point') {
          stats.points[event.winner]++;
          if (startedAt >= 0) stats.seconds.push(match.time - startedAt);
          if (!WON_BY_HITTER.has(event.reason)) stats.byError[lastTeam]++;
          startedAt = -1;
        } else if (event.type === 'match') {
          stats.wins[event.winner]++;
        } else if (event.type === 'fault' || event.type === 'let') {
          startedAt = -1;
        }
      }
      match.events.length = 0;
    }
  }
  return stats;
}

const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : '-');
const share = (s: Stats): number => s.points[0] / Math.max(1, s.points[0] + s.points[1]);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const signed = (pp: number): string => `${pp >= 0 ? '+' : ''}${pp}`;

function zoneLine(s: Stats, who: 0 | 1): string {
  const n = s.hits[who];
  const all = who === 1 ? ` (todos los golpes de la cancha: ${pct(s.behindFeet[0] + s.behindFeet[1], s.hits[0] + s.hits[1])})` : '';
  return `${HIT_ZONES.map((zone) => `${zone} ${pct(s.zones[who][zone], n)}`).join(' ')} | detrás de los pies ${pct(s.behindFeet[who], n)}${all}`;
}

function summary(s: Stats): string {
  return `puntos ${pct(s.points[0], s.points[0] + s.points[1])}  partidos ${s.wins[0]}/${MATCHES}  ${mean(s.seconds).toFixed(1)} s/punto  errores ${(s.byError[0] / MATCHES).toFixed(1)} propios y ${(s.byError[1] / MATCHES).toFixed(1)} del rival por partido  la compu no llegó ${(s.whiffs / MATCHES).toFixed(1)} por partido`;
}

const collected: Record<string, Record<string, number>> = {};

function keep(name: string, s: Stats): void {
  collected[name] = {
    points: share(s),
    wins: s.wins[0],
    seconds: mean(s.seconds),
    ownErrors: s.byError[0] / MATCHES,
    rivalErrors: s.byError[1] / MATCHES,
    whiffs: s.whiffs / MATCHES,
    personBehindFeet: s.behindFeet[0] / Math.max(1, s.hits[0]),
    computerBehindFeet: s.behindFeet[1] / Math.max(1, s.hits[1]),
    behindFeet: (s.behindFeet[0] + s.behindFeet[1]) / Math.max(1, s.hits[0] + s.hits[1]),
    personHits: s.hits[0],
    computerHits: s.hits[1],
    ...Object.fromEntries(HIT_ZONES.map((zone) => [`person_${zone}`, s.zones[0][zone] / Math.max(1, s.hits[0])])),
    ...Object.fromEntries(HIT_ZONES.map((zone) => [`computer_${zone}`, s.zones[1][zone] / Math.max(1, s.hits[1])])),
  };
  if (JSON_PATH) writeFileSync(JSON_PATH, JSON.stringify(collected, null, 1));
}

/** The cells: 1 against 1 with today's reach (the quick match), and doubles with the real reach at the revés, each with one of the cast as the partner. */
interface Cell {
  name: string;
  real: boolean;
  setup: (skill: ScriptedSkill) => Setup;
}

const CELLS: Cell[] = [
  ...RIVALS.map(
    (rival): Cell => ({
      name: `1 contra 1 contra ${rival}`,
      real: false,
      setup: (skill) => (config, seed) => [[humanEntry(seed, skill)], [aiEntry(config, rival, seed + 1)]],
    }),
  ),
  ...RIVALS.map((mate): Cell => {
    const [a, b] = RIVALS.filter((id) => id !== mate) as [RivalId, RivalId];
    return {
      name: `dobles con ${mate} contra ${a} y ${b}`,
      real: true,
      setup: (skill) => (config, seed) => [
        [partnerEntry(config, mate, seed + 1), humanEntry(seed, skill)],
        [pairEntry(config, a, seed + 2), pairEntry(config, b, seed + 3)],
      ],
    };
  }),
];

describe('zonas', { timeout: 3_600_000 }, () => {
  it('¿paga estar bien parado?', () => {
    const out = [`\nZonas de golpe: ¿paga estar bien parado? Manos ${SKILL}, ${MATCHES} partidos por casilla. 1 contra 1 con el alcance de hoy; dobles al revés con el alcance real.`];
    const gaps: Array<{ name: string; off: number; on: number }> = [];
    for (const cell of CELLS) {
      const result: Record<string, Stats> = {};
      for (const zones of [false, true]) {
        for (const who of ['careful', 'anywhere'] as Who[]) {
          const stats = play(cell.setup(skillOf(who)), zones, cell.real);
          result[`${who} ${zones}`] = stats;
          keep(`${cell.name}, ${WHO_NAME[who]}, zonas ${zones ? 'sí' : 'no'}`, stats);
        }
      }
      const gap = (zones: boolean): number => Math.round((share(result[`careful ${zones}`]!) - share(result[`anywhere ${zones}`]!)) * 100);
      gaps.push({ name: cell.name, off: gap(false), on: gap(true) });
      out.push(`\n${cell.name}: bien parado paga ${signed(gap(false))} pp sin zonas, ${signed(gap(true))} pp con zonas${gap(true) < PAYS - 3 ? `   FUERA: la meta es +${PAYS}` : ''}`);
      for (const zones of [false, true]) {
        for (const who of ['careful', 'anywhere'] as Who[]) {
          const s = result[`${who} ${zones}`]!;
          out.push(`  zonas ${zones ? 'sí' : 'no'}, ${WHO_NAME[who].padEnd(15)} ${summary(s)}`, `      persona: ${zoneLine(s, 0)}`, `      compu:   ${zoneLine(s, 1)}`);
        }
      }
    }
    out.push('\nRESUMEN: lo que paga estar bien parado, sin zonas → con zonas');
    for (const gap of gaps) out.push(`  ${gap.name.padEnd(36)} ${signed(gap.off).padStart(4)} → ${signed(gap.on).padStart(4)} pp`);
    console.log(out.join('\n'));
  });

  it('¿se vuelve más difícil o más fácil?', () => {
    const out = [`\nZonas de golpe: la persona simulada de los otros informes (manos ${SKILL}, con táctica), sin zonas y con zonas:`];
    for (const cell of CELLS) {
      const off = play(cell.setup(withTactics(SKILLS[SKILL], 1)), false, cell.real);
      const on = play(cell.setup(withTactics(SKILLS[SKILL], 1)), true, cell.real);
      keep(`${cell.name}, persona de siempre, zonas no`, off);
      keep(`${cell.name}, persona de siempre, zonas sí`, on);
      const shift = Math.round((share(on) - share(off)) * 100);
      out.push(
        `\n${cell.name}: ${signed(shift)} pp${Math.abs(shift) > 5 ? '   FUERA: más de 5 pp' : ''}`,
        `  sin zonas ${summary(off)}`,
        `  con zonas ${summary(on)}`,
        `      persona sin zonas ${zoneLine(off, 0)}`,
        `      persona con zonas ${zoneLine(on, 0)}`,
        `      compu sin zonas   ${zoneLine(off, 1)}`,
        `      compu con zonas   ${zoneLine(on, 1)}`,
      );
    }
    console.log(out.join('\n'));
  });

  it('¿lo muestra el cuerpo antes de pegar?', () => {
    const out = ['\nZonas de golpe: lo que mostró el cuerpo antes del contacto (sin acomodarse, todos los jugadores de la cancha):'];
    for (const cell of [CELLS[0]!, CELLS[3]!]) {
      const l = play(cell.setup(skillOf('anywhere')), true, cell.real, true).looks;
      out.push(
        `  ${cell.name}: al cuerpo ${l.body}, bloqueó ${pct(l.blocked, l.body)}   atrás ${l.behind}, apurado ${pct(l.hurried, l.behind)}   en otra zona ${l.other}, bloqueó de más ${pct(l.blockedElse, l.other)}`,
      );
    }
    console.log(out.join('\n'));
  });
});
