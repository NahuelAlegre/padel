import { describe, expect, it } from 'vitest';
import { PHYSICS_VERSION, createConfig } from '../src/config';
import { Match, type PlayerEntry, type SimEvent } from '../src/sim/match';
import { canReplay, ReplayController, type Recording } from '../src/sim/replay';
import { aiEntry, humanEntry, playMatch, SKILLS } from './helpers';

/** Everything that makes two matches "the same match", as text. */
function trace(match: Match, maxSimSeconds = 3600): string[] {
  const log: string[] = [];
  const f = (n: number): string => n.toFixed(6);
  playMatch(match, maxSimSeconds, (event: SimEvent) => {
    if (event.type === 'hit') {
      log.push(`hit ${match.tick} ${event.player} ${event.kind} ${event.quality} ${f(event.x)} ${f(event.y)} ${f(event.z)} ${f(event.speed)}`);
    } else if (event.type === 'bounce') {
      log.push(`bounce ${match.tick} ${f(event.x)} ${f(event.y)}`);
    } else if (event.type === 'point') {
      log.push(`point ${match.tick} ${event.winner} ${event.reason}`);
    }
  });
  log.push(`final ${match.score.games.join('-')} ${match.score.winner}`);
  return log;
}

const SEED = 2024;

/** A match of a simulated person (moved by hand) against a rival, with the inputs recorded. */
function recorded(person: PlayerEntry) {
  const config = createConfig();
  return new Match({
    config,
    seed: SEED,
    record: true,
    teams: [
      { name: 'Vos', players: [person] },
      { name: 'Mora', players: [aiEntry(config, 'mora', 77)] },
    ],
  });
}

/** The same match again, with the person replaced by what it did the first time. */
function replayed(recording: Recording, person: PlayerEntry) {
  const config = createConfig();
  return new Match({
    config,
    seed: recording.seed,
    teams: [
      { name: 'Vos', players: [{ ...person, controller: new ReplayController(recording, 0) }] },
      { name: 'Mora', players: [aiEntry(config, 'mora', 77)] },
    ],
  });
}

describe('repetición determinista', () => {
  it('con la semilla y las entradas grabadas, el partido se repite idéntico', () => {
    const first = recorded(humanEntry(31, SKILLS.average));
    const original = trace(first);
    const recording = first.recording()!;
    expect(recording.frames.length).toBeGreaterThan(50);
    expect(original.length).toBeGreaterThan(30);

    const again = trace(replayed(recording, humanEntry(31, SKILLS.average)));
    expect(again).toEqual(original);
  });

  it('la grabación sobrevive a guardarse como texto', () => {
    const first = recorded(humanEntry(8, SKILLS.beginner));
    const original = trace(first);
    const text = JSON.stringify(first.recording());
    const again = trace(replayed(JSON.parse(text) as Recording, humanEntry(8, SKILLS.beginner)));
    expect(again).toEqual(original);
    // A whole match in a few kilobytes per minute of play.
    expect(text.length / 1024).toBeLessThan(first.time * 4);
  });

  it('otras entradas dan otro partido', () => {
    const first = recorded(humanEntry(31, SKILLS.average));
    const original = trace(first);
    const other = trace(recorded(humanEntry(32, SKILLS.average)));
    expect(other).not.toEqual(original);
  });

  it('solo se graba lo que hacen las personas, y solo cuando cambia', () => {
    const match = recorded(humanEntry(31, SKILLS.average));
    playMatch(match);
    const recording = match.recording()!;
    expect(recording.frames.every((frame) => frame.player === 0)).toBe(true);
    // Far fewer frames than steps: a held stick is one frame, not 120 a second.
    expect(recording.frames.length).toBeLessThan(match.tick / 4);
    expect(recording.seed).toBe(SEED);
  });

  it('una grabación de otra versión de la física no se da por buena', () => {
    const match = recorded(humanEntry(31, SKILLS.average));
    for (let i = 0; i < 600; i++) match.step();
    const recording = match.recording()!;
    expect(recording.version).toBe(PHYSICS_VERSION);
    expect(canReplay(recording)).toBe(true);
    expect(canReplay({ ...recording, version: PHYSICS_VERSION + 1 })).toBe(false);
  });

  it('sin pedirlo, no se graba nada', () => {
    const config = createConfig();
    const match = new Match({
      config,
      seed: 1,
      teams: [
        { name: 'A', players: [humanEntry(1, SKILLS.average)] },
        { name: 'B', players: [aiEntry(config, 'lola', 2)] },
      ],
    });
    for (let i = 0; i < 300; i++) match.step();
    expect(match.recording()).toBeNull();
  });
});
