import { describe, expect, it } from 'vitest';
import { newRivalRecord, type RivalRecord } from '../src/app/persistence';
import { daysBetween, isClassic, noteMatch, Personality } from '../src/app/personality';
import { createScene, fillScene, type SceneOptions } from '../src/app/scene';
import { CAST, CHARACTER_IDS } from '../src/characters/cast';
import { CHARACTER_TEXT } from '../src/characters/lines.es';
import { toAILevel } from '../src/characters/style';
import type { Line } from '../src/characters/types';
import { createConfig, type AILevel, type GameConfig } from '../src/config';
import { AIController } from '../src/control/ai';
import { autoMove } from '../src/control/autopilot';
import { Rng } from '../src/core/rng';
import { InputState } from '../src/input/state';
import { Match, type Controller, type PlayerEntry, type SimEvent } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { resolveShot, type ShotContext } from '../src/sim/shots';
import type { PlayerIntent, ShotIntent } from '../src/sim/types';
import { aiEntry, LEVELS, playMatch } from './helpers';

type Hit = Extract<SimEvent, { type: 'hit' }>;

const textOf = (line: Line): string => (typeof line === 'string' ? line : line.text);

/** A player that serves, runs to every ball and returns it down the middle, exactly on time. */
class Wall implements Controller {
  update(match: Match, me: Player, intent: PlayerIntent): void {
    autoMove(match, me, intent);
    if (match.phase === 'serve' && match.serverId === me.id) intent.swing = shot();
    const plan = me.plan;
    if (plan && !me.swing && match.time >= plan.t) intent.swing = shot();
  }
}

const shot = (more: Partial<ShotIntent> = {}): ShotIntent => ({ aim: 0, depth: 0.7, lob: false, power: 1, ...more });

function entry(controller: Controller, more: Partial<PlayerEntry> = {}): PlayerEntry {
  return {
    name: 'Test',
    isHuman: false,
    manual: false,
    speedFactor: 1,
    reaction: 0,
    errorScale: 0,
    reachScale: 1,
    hand: 1,
    controller,
    ...more,
  };
}

/** A computer player with the given level against a wall that returns everything. */
function against(level: AILevel, seed = 5, configure?: (config: GameConfig) => void) {
  const config = createConfig();
  configure?.(config);
  const match = new Match({
    config,
    seed,
    teams: [
      { name: 'Pared', players: [entry(new Wall())] },
      { name: 'IA', players: [entry(new AIController(level, new Rng(seed + 1)), { errorScale: 0, wallBias: level.wallBias })] },
    ],
  });
  return { match, config, rival: match.players[1]!, wall: match.players[0]! };
}

describe('el elenco', () => {
  it('son tres, de menor a mayor dificultad, y las estrellas lo dicen', () => {
    expect(CHARACTER_IDS).toEqual(['beto', 'romina', 'chela']);
    expect(CHARACTER_IDS.map((id) => CAST[id].stars)).toEqual([1, 2, 3]);
  });

  it('cada uno tiene gesto delator, manías cortas y frases para todas las situaciones', () => {
    for (const id of CHARACTER_IDS) {
      const who = CAST[id];
      expect(Object.keys(who.tell.cues).length, id).toBeGreaterThan(0);
      // Readable in time: between a quarter and a bit over half a second before the contact.
      expect(who.tell.lead, id).toBeGreaterThanOrEqual(0.25);
      expect(who.tell.lead, id).toBeLessThanOrEqual(0.55);
      expect(who.mannerisms.length, id).toBeGreaterThan(0);
      for (const mannerism of who.mannerisms) expect(mannerism.duration, `${id} ${mannerism.clip}`).toBeLessThanOrEqual(0.9);
      for (const pool of Object.values(CHARACTER_TEXT[id].lines)) expect(pool.length, id).toBeGreaterThan(0);
    }
  });

  it('las frases se leen de un vistazo: 32 caracteres como mucho', () => {
    for (const id of CHARACTER_IDS) {
      for (const pool of Object.values(CHARACTER_TEXT[id].lines)) {
        for (const line of pool) expect(textOf(line).length, textOf(line)).toBeLessThanOrEqual(32);
      }
    }
  });

  it('el estilo se traduce a cómo juega: cada uno queda distinto', () => {
    const beto = toAILevel(CAST.beto);
    const romina = toAILevel(CAST.romina);
    const chela = toAILevel(CAST.chela);
    // Romina hits harder than anybody and goes to the net; Chela lobs and waits for the glass.
    expect(romina.power).toBeGreaterThan(beto.power);
    expect(beto.power).toBeGreaterThan(chela.power);
    expect(romina.netRush).toBeGreaterThan(chela.netRush);
    expect(chela.lobChance).toBeGreaterThan(beto.lobChance * 2);
    expect(chela.wallBias).toBeGreaterThan(0);
    expect(romina.wallBias).toBeLessThan(0);
    // Beto plays through the middle and is the one who makes mistakes.
    expect(beto.angle).toBeLessThan(romina.angle);
    expect(beto.mishit).toBeGreaterThan(romina.mishit);
    expect(chela.errorScale).toBeLessThan(beto.errorScale);
  });

  it('los rasgos son ganchos concretos en la IA', () => {
    expect(toAILevel(CAST.beto).feed).toBeCloseTo(0.4);
    // The first time he meets somebody the coach feeds more.
    expect(toAILevel(CAST.beto, true).feed).toBeCloseTo(0.7);
    expect(toAILevel(CAST.romina)).toMatchObject({ impatientAfter: 4, impatience: 0.08, wallScatter: 2 });
    expect(toAILevel(CAST.chela).lobUnderPressure).toBe(true);
    expect(toAILevel(CAST.chela).feed).toBe(0);
  });

  it('la configuración del juego usa a estos tres como rivales', () => {
    const config = createConfig();
    expect(Object.keys(config.rivals)).toEqual(['beto', 'romina', 'chela']);
    expect(config.rivals.romina).toEqual(toAILevel(CAST.romina));
  });
});

describe('gesto delator: la IA decide antes y lo muestra', () => {
  /** Plays a while and returns, for every rally hit of the rival, what it was showing and for how long. */
  function watch(level: AILevel, seconds = 40) {
    const { match, rival } = against(level);
    const seen: Array<{ lead: number; cue: ShotIntent; hit: Hit; at: number; contactAt: number }> = [];
    let cue: ShotIntent | null = null;
    let since = 0;
    let planned = 0;
    let armedWithCue = 0;
    let stepsWithCue = 0;
    for (let i = 0; i < seconds * 120; i++) {
      match.step();
      if (rival.cue !== cue) {
        if (rival.cue && !cue) since = match.time;
        if (rival.cue) cue = rival.cue;
      }
      if (rival.cue) {
        stepsWithCue++;
        if (rival.plan) planned = rival.plan.t;
        if (rival.anim.kind === 'swing' && match.time < rival.anim.t0) armedWithCue++;
      }
      for (const event of match.events) {
        if (event.type === 'hit' && event.team === 1 && event.kind !== 'serve' && cue) {
          seen.push({ lead: match.time - since, cue, hit: event, at: match.time, contactAt: planned });
        }
        if (event.type === 'hit' || event.type === 'point') cue = rival.cue;
      }
      match.events.length = 0;
    }
    return { seen, armedWithCue, stepsWithCue };
  }

  it('tiene decidido el golpe un rato antes del contacto', () => {
    const level = { ...LEVELS.hard, tellLead: 0.5, timingSigma: 0 };
    const { seen } = watch(level);
    expect(seen.length).toBeGreaterThan(10);
    const leads = seen.map((entry) => entry.lead).sort((a, b) => a - b);
    // Most of the time the whole lead is there; never more than what it asks for.
    expect(leads[Math.floor(leads.length / 2)]!).toBeGreaterThan(0.4);
    expect(leads[leads.length - 1]!).toBeLessThanOrEqual(0.5 + 0.02);
  });

  it('no miente: lo que mostró es lo que juega', () => {
    const { seen } = watch({ ...LEVELS.hard, lobChance: 0.6, dropChance: 0.3, tellLead: 0.45 }, 80);
    const lobs = seen.filter((entry) => entry.cue.lob);
    expect(lobs.length).toBeGreaterThan(3);
    // The situation can still name it differently when the ball got past (contrapared).
    for (const entry of lobs) expect(['lob', 'backWall']).toContain(entry.hit.kind);
    for (const entry of seen.filter((e) => !e.cue.lob)) expect(entry.hit.kind).not.toBe('lob');
  });

  it('mientras lo tiene decidido, la raqueta ya está atrás', () => {
    const { armedWithCue, stepsWithCue } = watch({ ...LEVELS.hard, tellLead: 0.5 });
    expect(stepsWithCue).toBeGreaterThan(100);
    // Except for the instants in which the previous stroke is still finishing.
    expect(armedWithCue / stepsWithCue).toBeGreaterThan(0.85);
  });

  it('con menos anticipación, se lee más tarde', () => {
    const short = watch({ ...LEVELS.hard, tellLead: 0.25, timingSigma: 0 }).seen.map((entry) => entry.lead);
    expect(Math.max(...short)).toBeLessThanOrEqual(0.25 + 0.02);
  });

  it('el gesto llega a la escena con la pose del personaje', () => {
    const config = createConfig();
    const match = new Match({
      config,
      seed: 3,
      teams: [
        { name: 'Pared', players: [entry(new Wall())] },
        { name: 'Beto', players: [aiEntry(config, 'beto', 9)] },
      ],
    });
    const scene = createScene();
    const options: SceneOptions = {
      bounceMarker: true,
      timingAid: true,
      positionGuide: true,
      reduceMotion: false,
      debug: false,
      cueLead: 0,
      tutorial: null,
      cast: [null, CAST.beto],
      acts: [null, null],
    };
    const input = new InputState();
    let told = 0;
    for (let i = 0; i < 120 * 30 && told < 3; i++) {
      match.step();
      match.events.length = 0;
      fillScene(scene, match, 1, input, options);
      const beto = scene.players[1]!;
      expect(beto.character).toBe('beto');
      expect(scene.players[0]!.character).toBeNull();
      if (!beto.tell) continue;
      told++;
      // Beto points with his free hand, whatever he is about to play.
      expect(beto.tell.pose).toBe('pointAim');
      expect(beto.tell.t).toBeGreaterThanOrEqual(0);
      expect(Math.abs(beto.tell.aimX)).toBeLessThan(10);
      expect(beto.animPhase).toBeLessThan(0);
    }
    expect(told).toBe(3);
  });
});

describe('estilo y rasgos en la cancha', () => {
  /**
   * Rally hits of the rival over a while, with where each ball was going to
   * land. That is known the moment it is hit, whether or not the other side
   * volleys it away.
   */
  function hitsOf(
    level: AILevel,
    seconds = 60,
    more: Partial<PlayerEntry> = {},
    configure?: (config: GameConfig) => void,
  ) {
    const { match, wall, rival } = against(level, 11, configure);
    Object.assign(rival, more);
    const hits: Array<{ hit: Hit; landedX: number | null; wallX: number; rally: number }> = [];
    for (let i = 0; i < seconds * 120; i++) {
      match.step();
      for (const event of match.events) {
        if (event.type !== 'hit' || event.team !== 1 || event.kind === 'serve') continue;
        const landing = match.trajectory?.bounces[0];
        hits.push({ hit: event, landedX: landing ? landing.x : null, wallX: wall.x, rally: match.rallyHits });
      }
      match.events.length = 0;
    }
    return hits;
  }

  it('más potencia es una pelota más rápida', () => {
    // What the shot is asked to be: its pace follows the power, up to a limit, and less for a smash.
    const config = createConfig();
    const at = (ballZ: number, ballY: number): ShotContext => ({ team: 0, hand: 1, playerX: 0, playerY: ballY - 0.2, ballX: 0.6, ballY, ballZ, bounces: 1, walls: 0 });
    const pace = (context: ShotContext, power: number): number => resolveShot(context, shot({ power }), config).params.speed;
    const drive = at(0.9, -7);
    expect(pace(drive, 1.14) / pace(drive, 1)).toBeCloseTo(1.14);
    expect(pace(drive, 0.85) / pace(drive, 1)).toBeCloseTo(0.85);
    expect(pace(drive, 3)).toBeCloseTo(pace(drive, 1.2));
    const smash = at(2.2, -3);
    expect(resolveShot(smash, shot(), config).kind).toBe('smash');
    expect(pace(smash, 1.14) / pace(smash, 1)).toBeCloseTo(1.05);

    // And in a rally: the same shots from the same places, only harder. The
    // rally is kept from heating up, which would hide the difference.
    const mean = (level: AILevel): number => {
      const volleys = hitsOf({ ...level, lobChance: 0, dropChance: 0, smart: 1, aggression: 1 }, 60, {}, (cfg) => {
        cfg.rules.heatMax = 0;
      }).filter((entry) => entry.hit.kind === 'volley');
      expect(volleys.length).toBeGreaterThan(10);
      return volleys.reduce((sum, entry) => sum + entry.hit.speed, 0) / volleys.length;
    };
    const soft = mean({ ...LEVELS.hard, power: 0.85 });
    const hard = mean({ ...LEVELS.hard, power: 1.14 });
    expect(hard).toBeGreaterThan(soft * 1.15);
  });

  it('el que alimenta juega hacia donde está el otro; el que no, lejos', () => {
    const offCentre = (level: AILevel): number => {
      const landed = hitsOf({ ...level, lobChance: 0, dropChance: 0, smart: 1 }).filter((entry) => entry.landedX !== null);
      expect(landed.length).toBeGreaterThan(10);
      return landed.reduce((sum, entry) => sum + Math.abs(entry.landedX! - entry.wallX), 0) / landed.length;
    };
    const feeder = offCentre({ ...LEVELS.hard, feed: 1 });
    const hunter = offCentre({ ...LEVELS.hard, feed: 0, angle: 1 });
    expect(feeder).toBeLessThan(1);
    expect(hunter).toBeGreaterThan(feeder + 1);
  });

  it('con poco ángulo juega por el medio', () => {
    const spread = (angle: number): number => {
      const landed = hitsOf({ ...LEVELS.hard, lobChance: 0, dropChance: 0, smart: 1, angle }).filter((e) => e.landedX !== null);
      return landed.reduce((sum, entry) => sum + Math.abs(entry.landedX!), 0) / landed.length;
    };
    expect(spread(0)).toBeLessThan(spread(1) * 0.75);
  });

  it('al que le gusta la pared la espera; al que no, le pega antes', () => {
    const share = (wallBias: number): number => {
      const hits = hitsOf({ ...LEVELS.hard, lobChance: 0, dropChance: 0, netRush: 0 }, 60, { wallBias });
      return hits.filter((entry) => entry.hit.kind === 'wallExit').length / hits.length;
    };
    expect(share(0.6)).toBeGreaterThan(share(-0.6) + 0.1);
  });

  it('la impaciente se desordena cuando el punto se alarga', () => {
    // Scatter is the only thing that moves the ball off its target here.
    // It aims at where the other player is; how far off the ball goes is its scatter.
    const miss = (impatience: number): { early: number; late: number } => {
      const level = { ...LEVELS.hard, lobChance: 0, dropChance: 0, smart: 1, feed: 1, impatientAfter: 4, impatience };
      // A match long enough to see many rallies, and many long ones.
      const hits = hitsOf(level, 900, { errorScale: 1 }, (cfg) => {
        cfg.rules.format.gamesToWin = 60;
      }).filter((entry) => entry.landedX !== null);
      const off = (from: number, to: number): number => {
        const some = hits.filter((entry) => entry.rally >= from && entry.rally < to);
        expect(some.length).toBeGreaterThan(12);
        return some.reduce((sum, entry) => sum + Math.abs(entry.landedX! - entry.wallX), 0) / some.length;
      };
      return { early: off(2, 5), late: off(9, 40) };
    };
    const calm = miss(0);
    const impatient = miss(0.3);
    // The first shots of a rally are the same for both; the late ones are not.
    expect(impatient.late).toBeGreaterThan(calm.late * 1.4);
    expect(impatient.early).toBeLessThan(calm.early * 1.3);
  });

  it('exigida, la que siempre tira globo, tira globo', () => {
    const controller = new AIController({ ...LEVELS.hard, lobUnderPressure: true }, new Rng(8));
    const pick = (controller as unknown as { chooseShot: (m: Match, p: Player, plan: unknown) => ShotIntent }).chooseShot.bind(controller);
    const { match, rival } = against(LEVELS.hard);
    // Reached late and low, after the bounce: under pressure.
    const plan = { trajId: 1, t: 1, x: 0, y: 8, z: 0.3, stanceX: 0, stanceY: 8, kind: 'bounce', reachable: false, slack: -0.1 };
    for (let i = 0; i < 30; i++) expect(pick(match, rival, plan).lob).toBe(true);
  });

  it('los tres rivales terminan un partido, cada uno a su manera', () => {
    const kinds = (id: 'beto' | 'romina' | 'chela'): Record<string, number> => {
      const config = createConfig();
      const match = new Match({
        config,
        seed: 41,
        teams: [
          { name: 'A', players: [aiEntry(config, 'medium', 3)] },
          { name: id, players: [aiEntry(config, id, 4)] },
        ],
      });
      const mine: Record<string, number> = {};
      let total = 0;
      const summary = playMatch(match, 3600, (event) => {
        if (event.type === 'hit' && event.team === 1 && event.kind !== 'serve') {
          mine[event.kind] = (mine[event.kind] ?? 0) + 1;
          total++;
        }
      });
      expect(summary.stalled, id).toBe(false);
      expect(summary.winner, id).toBeGreaterThanOrEqual(0);
      for (const key of Object.keys(mine)) mine[key] = mine[key]! / total;
      return mine;
    };
    const chela = kinds('chela');
    const romina = kinds('romina');
    // Chela is the one who lobs; Romina hardly ever does.
    expect(chela.lob ?? 0).toBeGreaterThan((romina.lob ?? 0) + 0.1);
  });
});

describe('frases y manías: no tocan el partido', () => {
  const today = '2026-11-17';
  const record = (more: Partial<RivalRecord> = {}): RivalRecord => ({ ...newRivalRecord('2026-11-01'), ...more });
  const all = (id: 'beto' | 'romina' | 'chela', pool: keyof (typeof CHARACTER_TEXT)['beto']['lines']): string[] =>
    CHARACTER_TEXT[id].lines[pool].map(textOf);

  it('saluda según la historia: primera vez, otra vez, después de mucho', () => {
    const who = new Personality(new Rng(1));
    expect(who.begin('beto', 1, undefined, today, true).line).toBe('¡Hola! Soy Beto, el profe.');
    expect(who.begin('beto', 1, record({ played: 0 }), today, true).line).toBe('¡Hola! Soy Beto, el profe.');
    expect(who.begin('beto', 1, record({ played: 2, wins: 1, losses: 1, lastPlayed: '2026-11-16' }), today, true).line).toBe(
      '¡Volviste! Me alegra.',
    );
    expect(who.begin('beto', 1, record({ played: 2, wins: 1, losses: 1, lastPlayed: '2026-10-20' }), today, true).line).toBe(
      '¡Tanto tiempo! ¿Entrenaste?',
    );
  });

  it('en una revancha al toque no saluda, y con las frases apagadas tampoco', () => {
    const who = new Personality(new Rng(1));
    expect(who.begin('romina', 1, undefined, today, false).line).toBeNull();
    who.frequency = 'none';
    expect(who.begin('romina', 1, undefined, today, true).line).toBeNull();
    expect(who.rematchLine(true)).toBeNull();
  });

  it('al que le ganó tres seguidos le cuenta su gesto delator, una sola vez', () => {
    const who = new Personality(new Rng(1));
    const losing = record({ played: 3, losses: 3, streak: -3, lastPlayed: today });
    const opening = who.begin('romina', 1, losing, today, true);
    expect(opening).toEqual({ line: 'Si me planto, retrocedé.', hint: true });
    // The game marks it as shown, and from then on it is an ordinary hello.
    losing.hintShown = true;
    expect(who.begin('romina', 1, losing, today, true)).toEqual({ line: '¡Volviste! Traé casco.', hint: false });
    // Somebody who is winning gets no hint.
    expect(who.begin('romina', 1, record({ played: 3, wins: 3, streak: 3 }), today, true).hint).toBe(false);
  });

  it('junto al botón de revancha dice lo suyo, según quién ganó', () => {
    const who = new Personality(new Rng(3));
    who.begin('chela', 1, undefined, today, true);
    expect(all('chela', 'rematchTheyLost')).toContain(who.rematchLine(true));
    expect(all('chela', 'rematchTheyWon')).toContain(who.rematchLine(false));
  });

  /** Plays a whole match between two computer players with `who` listening on team 1. */
  function listen(who: Personality, seed: number, onSay?: (text: string, match: Match) => void) {
    const config = createConfig();
    config.rules.format.gamesToWin = 4;
    const match = new Match({
      config,
      seed,
      teams: [
        { name: 'A', players: [aiEntry(config, 'medium', seed + 1)] },
        { name: 'B', players: [aiEntry(config, 'medium', seed + 2)] },
      ],
    });
    const said: string[] = [];
    let points = 0;
    let spoke = 0;
    let run = 0;
    let longestRun = 0;
    playMatch(match, 3600, (event) => {
      const reaction = who.onEvent(event, match);
      if (event.type === 'point') {
        points++;
        if (reaction?.say) {
          spoke++;
          run++;
          longestRun = Math.max(longestRun, run);
        } else {
          run = 0;
        }
      }
      if (reaction?.say) {
        said.push(reaction.say);
        onSay?.(reaction.say, match);
      }
    });
    return { said, points, spoke, longestRun, match };
  }

  it('habla en una parte de los puntos, nunca tres seguidos y sin repetirse enseguida', () => {
    let points = 0;
    let spoke = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const who = new Personality(new Rng(seed));
      who.begin('romina', 1, undefined, today, true);
      const heard = listen(who, 100 + seed);
      points += heard.points;
      spoke += heard.spoke;
      expect(heard.longestRun).toBeLessThanOrEqual(2);
      // The same line never comes back within the next eight.
      for (let i = 0; i < heard.said.length; i++) {
        expect(heard.said.slice(i + 1, i + 8)).not.toContain(heard.said[i]);
      }
      const known = [...all('romina', 'winPoint'), ...all('romina', 'losePoint'), ...all('romina', 'goldenPoint')];
      for (const line of heard.said) expect(known).toContain(line);
    }
    expect(points).toBeGreaterThan(80);
    // About a third of the points, give or take.
    expect(spoke / points).toBeGreaterThan(0.15);
    expect(spoke / points).toBeLessThan(0.6);
  });

  it('con "pocas" habla menos, y con "ninguna" no dice nada', () => {
    const count = (frequency: 'many' | 'few' | 'none'): number => {
      let spoke = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const who = new Personality(new Rng(seed));
        who.frequency = frequency;
        who.begin('beto', 1, undefined, today, true);
        spoke += listen(who, 200 + seed).said.length;
      }
      return spoke;
    };
    const many = count('many');
    expect(count('few')).toBeLessThan(many * 0.75);
    expect(count('none')).toBe(0);
  });

  it('en el punto de oro siempre dice algo, una vez', () => {
    const who = new Personality(new Rng(2));
    who.begin('chela', 1, undefined, today, true);
    const golden: string[] = [];
    const pool = all('chela', 'goldenPoint');
    // Look for a match that gets to 40-40.
    for (let seed = 300; seed < 330 && golden.length === 0; seed++) {
      who.begin('chela', 1, undefined, today, true);
      listen(who, seed, (text, match) => {
        if (pool.includes(text)) {
          golden.push(text);
          expect(match.score.points).toEqual([3, 3]);
          expect(match.phase).toBe('serve');
        }
      });
    }
    expect(golden.length).toBeGreaterThan(0);
  });

  it('una frase escrita para un globo solo sale después de un globo', () => {
    const lobOnly = CHARACTER_TEXT.chela.lines.winPoint.filter((line) => typeof line !== 'string').map(textOf);
    expect(lobOnly.length).toBeGreaterThan(0);
    for (let seed = 1; seed <= 8; seed++) {
      const who = new Personality(new Rng(seed));
      who.begin('chela', 1, undefined, today, true);
      let lastKind = '';
      const config = createConfig();
      const match = new Match({
        config,
        seed: 400 + seed,
        teams: [
          { name: 'A', players: [aiEntry(config, 'medium', seed)] },
          { name: 'B', players: [aiEntry(config, 'chela', seed + 1)] },
        ],
      });
      playMatch(match, 3600, (event) => {
        if (event.type === 'hit') lastKind = event.kind;
        const reaction = who.onEvent(event, match);
        if (reaction?.say && lobOnly.includes(reaction.say)) expect(lastKind).toBe('lob');
      });
    }
  });

  it('el saque cierra el globito y corta la manía: nada demora el juego', () => {
    const who = new Personality(new Rng(5));
    who.begin('beto', 1, undefined, today, true);
    const config = createConfig();
    const match = new Match({
      config,
      seed: 12,
      teams: [
        { name: 'A', players: [aiEntry(config, 'medium', 1)] },
        { name: 'B', players: [aiEntry(config, 'medium', 2)] },
      ],
    });
    let acts = 0;
    let tosses = 0;
    for (let i = 0; i < 120 * 120; i++) {
      match.step();
      for (const event of match.events) {
        const reaction = who.onEvent(event, match);
        if (event.type === 'toss') {
          tosses++;
          expect(reaction).toEqual({ hush: true });
          expect(who.actAt(match.time)).toBeNull();
        }
      }
      match.events.length = 0;
      const act = who.actAt(match.time);
      if (act) {
        acts++;
        // A tic only happens between points, and it is short.
        expect(match.phase === 'pointOver' || match.phase === 'serve').toBe(true);
        expect(act.duration).toBeLessThanOrEqual(0.9);
        expect(act.t).toBeLessThan(act.duration);
        expect(CAST.beto.mannerisms.map((m) => m.clip)).toContain(act.clip);
      }
    }
    expect(tosses).toBeGreaterThan(5);
    expect(acts).toBeGreaterThan(0);
  });

  it('con o sin frases el partido es idéntico: tienen sus propios dados', () => {
    const play = (who: Personality | null): string => {
      const config = createConfig();
      const match = new Match({
        config,
        seed: 77,
        teams: [
          { name: 'A', players: [aiEntry(config, 'beto', 1)] },
          { name: 'B', players: [aiEntry(config, 'romina', 2)] },
        ],
      });
      who?.begin('romina', 1, undefined, today, true);
      const log: string[] = [];
      playMatch(match, 3600, (event) => {
        who?.onEvent(event, match);
        who?.actAt(match.time);
        if (event.type === 'hit') log.push(`${event.kind}:${event.x.toFixed(4)}:${event.speed.toFixed(4)}`);
      });
      return log.join('|');
    };
    const silent = play(null);
    expect(play(new Personality(new Rng(1)))).toBe(silent);
    expect(play(new Personality(new Rng(999)))).toBe(silent);
  });
});

describe('memoria de rivalidad', () => {
  it('cuenta partidos y rachas', () => {
    const record = newRivalRecord('2026-11-01');
    noteMatch(record, false, '2026-11-02');
    noteMatch(record, false, '2026-11-03');
    expect(record).toMatchObject({ played: 2, wins: 0, losses: 2, streak: -2, lastPlayed: '2026-11-03', firstMet: '2026-11-01' });
    noteMatch(record, true, '2026-11-04');
    expect(record).toMatchObject({ played: 3, wins: 1, losses: 2, streak: 1 });
    noteMatch(record, true, '2026-11-04');
    expect(record.streak).toBe(2);
  });

  it('con seis partidos o más y parejos, es un clásico', () => {
    expect(isClassic(undefined)).toBe(false);
    expect(isClassic({ ...newRivalRecord('2026-11-01'), played: 6, wins: 3, losses: 3 })).toBe(true);
    expect(isClassic({ ...newRivalRecord('2026-11-01'), played: 7, wins: 4, losses: 3 })).toBe(true);
    expect(isClassic({ ...newRivalRecord('2026-11-01'), played: 6, wins: 5, losses: 1 })).toBe(false);
    expect(isClassic({ ...newRivalRecord('2026-11-01'), played: 4, wins: 2, losses: 2 })).toBe(false);
  });

  it('cuenta los días entre dos fechas', () => {
    expect(daysBetween('2026-11-17', '2026-11-17')).toBe(0);
    expect(daysBetween('2026-11-03', '2026-11-17')).toBe(14);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('no es una fecha', '2026-11-17')).toBe(0);
  });
});
