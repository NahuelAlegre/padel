import { describe, expect, it } from 'vitest';
import { createConfig } from '../src/config';
import { Match, type PlayerEntry, type SimEvent } from '../src/sim/match';
import { Scan, SITUATIONS, type Moment } from '../src/studio/situations';
import { snapshot } from '../src/studio/snapshot';
import { aiEntry, partnerEntry } from './helpers';

/** A match of doubles of the computer against itself, with the reach of a real person: what the studio looks through. */
function demo(seed: number): Match {
  const config = createConfig();
  config.player.realReach = true;
  const near: PlayerEntry[] = [aiEntry(config, 'beto', seed + 4), partnerEntry(config, 'beto', seed + 1)];
  const far: PlayerEntry[] = [aiEntry(config, 'romina', seed + 2), aiEntry(config, 'chela', seed + 3)];
  return new Match({ config, seed, teams: [{ name: 'A', players: near }, { name: 'B', players: far }] });
}

function scanAll(match: Match, seconds: number): Scan {
  const scan = new Scan(match, seconds);
  while (!scan.done) scan.run(50);
  return scan;
}

describe('el estudio de animaciones', () => {
  it('una copia del partido sigue exactamente como el original, y el original no se entera', () => {
    const match = demo(11);
    for (let i = 0; i < 2400; i++) {
      match.step();
      match.events.length = 0;
    }
    const copy = snapshot(match);
    const time = match.time;
    for (let i = 0; i < 3600; i++) {
      copy.step();
      copy.events.length = 0;
    }
    // The copy moved on; the original is where it was.
    expect(match.time).toBe(time);
    for (let i = 0; i < 3600; i++) {
      match.step();
      match.events.length = 0;
    }
    expect(copy.time).toBe(match.time);
    expect(copy.ball.x).toBe(match.ball.x);
    expect(copy.ball.y).toBe(match.ball.y);
    for (let i = 0; i < match.players.length; i++) {
      expect(copy.players[i]!.x).toBe(match.players[i]!.x);
      expect(copy.players[i]!.y).toBe(match.players[i]!.y);
    }
  });

  it('encuentra los golpes de todos los días, y siempre los mismos', () => {
    const first = scanAll(demo(7), 120);
    const again = scanAll(demo(7), 120);
    for (const id of ['saque', 'derecha', 'split', 'festejo'] as const) {
      expect(first.found.has(Scan.key(id, true)) || first.found.has(Scan.key(id, false)), id).toBe(true);
    }
    expect([...again.found.keys()].sort()).toEqual([...first.found.keys()].sort());
    for (const [key, moment] of first.found) expect(again.found.get(key)!.at, key).toBe(moment.at);
    // A court waiting for a serve, to stage what the demo never shows.
    expect(first.calm?.match.phase).toBe('serve');
  });

  it('cada momento, jugado desde su copia, pasa de verdad: y el loop lo muestra entero', () => {
    const scan = scanAll(demo(7), 120);
    const strokes: Array<[Moment['id'], (event: SimEvent, moment: Moment) => boolean]> = [
      ['saque', (event, moment) => event.type === 'hit' && event.kind === 'serve' && event.player === moment.player],
      ['derecha', (event, moment) => event.type === 'hit' && event.forehand && event.player === moment.player],
    ];
    for (const [id, happens] of strokes) {
      const moment = scan.found.get(Scan.key(id, true)) ?? scan.found.get(Scan.key(id, false));
      expect(moment, id).toBeDefined();
      if (!moment) continue;
      expect(moment.start).toBeLessThan(moment.at);
      expect(moment.at).toBeLessThan(moment.end);
      // The stored copy is never played on: a copy of it is.
      const match = snapshot(moment.from);
      let seen = -1;
      while (match.time < moment.end) {
        match.step();
        for (const event of match.events) if (seen < 0 && happens(event, moment)) seen = match.time;
        match.events.length = 0;
      }
      expect(seen, id).toBeGreaterThan(0);
      expect(Math.abs(seen - moment.at), id).toBeLessThan(0.02);
      expect(moment.from.time).toBe(moment.start);
    }
  });

  it('cada situación tiene un nombre corto y se encuentra, se arma, o las dos cosas', () => {
    const ids = new Set(SITUATIONS.map((situation) => situation.id));
    expect(ids.size).toBe(SITUATIONS.length);
    for (const situation of SITUATIONS) {
      expect(situation.label.length, situation.id).toBeLessThanOrEqual(14);
      if (situation.source !== 'staged') expect(situation.lead + situation.tail, situation.id).toBeGreaterThan(1.5);
    }
  });
});
