import { describe, expect, it } from 'vitest';
import { COACH_SETUP, Drill, LESSONS, lessonIndex, type LessonId } from '../src/app/drill';
import { emptyProfile, exportData, importData, loadData, saveProfile } from '../src/app/persistence';
import { createConfig } from '../src/config';
import { autoMove } from '../src/control/autopilot';
import { Rng } from '../src/core/rng';
import { createMemoryStore } from '../src/platform/memory';
import { Match, type Controller, type SimEvent } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import type { PlayerIntent, ShotIntent } from '../src/sim/types';
import { TEXT } from '../src/ui/text';
import { HUMAN_HOLD_NET, HUMAN_REACH } from './helpers';

/** What the person asks of a ball: decided when it swings, with the court in front of it. */
type Ask = (match: Match, me: Player) => ShotIntent;

const plain: Ask = () => ({ aim: 0, depth: 0.8, lob: false, power: 1 });

/** A person with assisted movement: it runs to the ball by itself and swings on time, asking for `ask`. */
class Pupil implements Controller {
  constructor(private readonly ask: Ask) {}
  update(match: Match, me: Player, intent: PlayerIntent): void {
    autoMove(match, me, intent);
    const plan = me.plan;
    if (plan && !me.swing && match.time >= plan.t) intent.swing = this.ask(match, me);
  }
}

/** Plays a lesson on a practice court and says how it went. */
function play(id: LessonId, ask: Ask, seconds = 90) {
  const config = createConfig();
  const lesson = LESSONS[lessonIndex(id)]!;
  const drill = new Drill(lesson, config, new Rng(4));
  const match = new Match({
    config,
    seed: 11,
    practice: true,
    teams: [
      {
        name: 'Vos',
        players: [
          {
            name: 'Vos',
            isHuman: true,
            manual: false,
            speedFactor: 1,
            reaction: 0.12,
            // No scatter: what is being tested is the lesson, not the hands.
            errorScale: 0,
            reachScale: HUMAN_REACH,
            hand: 1,
            holdNet: HUMAN_HOLD_NET,
            controller: new Pupil(ask),
          },
        ],
      },
      { name: 'Profe', players: [{ name: 'Profe', isHuman: false, manual: false, ...COACH_SETUP, reachScale: 1, hand: 1, controller: drill.coach }] },
    ],
  });
  drill.begin(match);
  const events: SimEvent[] = [];
  /** Who hit, ball by ball: one text per ball fed, a digit per hit (1 the coach, 0 the person). */
  const rallies: string[] = [];
  let passes = 0;
  let steps = 0;
  for (; steps < seconds * 120 && !drill.done; steps++) {
    match.step();
    drill.step(match);
    for (const event of match.events) {
      drill.onEvent(event, match);
      events.push(event);
      if (event.type !== 'hit') continue;
      // The first hit of a rally on a practice court is the feed.
      if (match.rallyHits === 1) rallies.push('');
      rallies[rallies.length - 1] += String(event.team);
    }
    match.events.length = 0;
    if (drill.justPassed) passes++;
  }
  const mine = events.filter((event): event is Extract<SimEvent, { type: 'hit' }> => event.type === 'hit' && event.team === 0);
  return { drill, match, events, rallies, passes, seconds: steps / 120, mine, feeds: rallies.length };
}

/** Away from where the coach is standing. */
const awayFromCoach: Ask = (match) => ({ aim: match.players[1]!.x > 0 ? -0.9 : 0.9, depth: 0.8, lob: false, power: 1 });
const lob: Ask = () => ({ aim: 0.3, depth: 1, lob: true, power: 1 });
const drop: Ask = () => ({ aim: 0, depth: 0.1, lob: false, power: 1 });

describe('las lecciones del tutorial', () => {
  it('son ocho, en el orden en que se enseñan, cada una con su nombre y pocas palabras', () => {
    expect(LESSONS.map((lesson) => lesson.id)).toEqual(['move', 'aim', 'lob', 'drop', 'wall', 'bandeja', 'smash', 'read']);
    for (const lesson of LESSONS) {
      const text = TEXT.lesson[lesson.id];
      expect(text.name.length).toBeGreaterThan(0);
      // Read at a glance, if at all: a name and half a line.
      expect(text.name.length).toBeLessThanOrEqual(18);
      expect(text.cue.length).toBeLessThanOrEqual(36);
      expect(lesson.goal).toBeGreaterThanOrEqual(2);
      expect(lesson.goal).toBeLessThanOrEqual(4);
    }
  });

  const right: Record<LessonId, Ask> = {
    move: plain,
    aim: awayFromCoach,
    lob,
    drop,
    wall: plain,
    bandeja: plain,
    smash: plain,
    read: plain,
  };

  for (const lesson of LESSONS) {
    it(`${lesson.id}: haciendo lo que enseña, se completa en poco tiempo`, () => {
      const result = play(lesson.id, right[lesson.id]);
      expect(result.drill.done, `${result.drill.progress} de ${lesson.goal} en ${result.seconds.toFixed(0)} s`).toBe(true);
      expect(result.drill.progress).toBe(lesson.goal);
      expect(result.passes).toBe(lesson.goal);
      // A lesson is a couple of minutes at most, even missing a ball or two.
      expect(result.seconds).toBeLessThan(60);
    });
  }

  it('cada lección arma su situación: el profe en la red para el globo, vos en la red para la bandeja y el remate', () => {
    const config = createConfig();
    const at = (id: LessonId) => LESSONS[lessonIndex(id)]!.rep(0, config);
    expect(Math.abs(at('lob').coach.y)).toBeLessThan(4);
    expect(Math.abs(at('drop').coach.y)).toBeGreaterThan(7.5);
    expect(Math.abs(at('bandeja').me.y)).toBeLessThan(4);
    expect(Math.abs(at('smash').me.y)).toBeLessThan(4);
    // The lob to smash is short; the one for the bandeja goes over.
    expect(Math.abs(at('smash').feed.targetY)).toBeLessThan(Math.abs(at('bandeja').feed.targetY) - 1);
    // And the sides alternate, so nobody learns only one.
    const move = LESSONS[lessonIndex('move')]!;
    expect(Math.sign(move.rep(0, config).feed.targetX)).toBe(-Math.sign(move.rep(1, config).feed.targetX));
  });

  it('los golpes salen con su nombre: el globo es globo, la bandeja se pega sin dejarla picar', () => {
    expect(play('lob', lob).mine.every((hit) => hit.kind === 'lob')).toBe(true);
    expect(play('drop', drop).mine.every((hit) => hit.kind === 'drop')).toBe(true);
    expect(play('wall', plain).mine.filter((hit) => hit.kind === 'wallExit').length).toBeGreaterThanOrEqual(3);
    const bandeja = play('bandeja', plain).mine;
    expect(bandeja.filter((hit) => hit.volley && ['bandeja', 'vibora'].includes(hit.kind)).length).toBeGreaterThanOrEqual(3);
    expect(play('smash', plain).mine.filter((hit) => hit.kind === 'smash').length).toBeGreaterThanOrEqual(3);
  });

  it('otro golpe no cuenta: sin globo no hay lección de globo, y la pelota sigue viniendo', () => {
    const result = play('lob', plain, 30);
    expect(result.drill.done).toBe(false);
    expect(result.drill.progress).toBe(0);
    // It keeps feeding: nobody is stuck waiting.
    expect(result.feeds).toBeGreaterThan(4);
  });

  it('apuntar al lado donde está el profe tampoco cuenta', () => {
    const toCoach: Ask = (match) => ({ aim: match.players[1]!.x > 0 ? 0.9 : -0.9, depth: 0.8, lob: false, power: 1 });
    expect(play('aim', toCoach, 30).drill.progress).toBe(0);
  });

  it('leer el gesto: el profe devuelve una sola pelota, abierta, y la que vale es esa segunda', () => {
    const result = play('read', plain);
    expect(result.drill.done).toBe(true);
    // Feed, the person, the coach's reply, the person again.
    expect(result.rallies.filter((rally) => rally.startsWith('1010')).length).toBeGreaterThanOrEqual(3);
    // He never plays a second one back: the lesson is not a match.
    for (const rally of result.rallies) expect(rally.startsWith('10101')).toBe(false);
    // In the other lessons he does not play any back at all.
    for (const rally of play('move', plain).rallies) expect(rally).toMatch(/^10?$/);
  });
});

describe('la cancha de práctica', () => {
  it('no hay saque ni marcador: lo que pasa se cuenta, pero no suma', () => {
    const { match, events } = play('move', plain);
    expect(events.some((event) => event.type === 'serveReady' || event.type === 'toss')).toBe(false);
    expect(events.some((event) => event.type === 'game' || event.type === 'match')).toBe(false);
    expect(match.score.points).toEqual([0, 0]);
    expect(match.score.games).toEqual([0, 0]);
    expect(match.phase).not.toBe('matchOver');
    expect(match.practice).toBe(true);
  });

  it('entre pelota y pelota cada uno camina a su lugar, y el profe la tiene en la mano', () => {
    const config = createConfig();
    const drill = new Drill(LESSONS[lessonIndex('bandeja')]!, config, new Rng(1));
    const match = new Match({
      config,
      seed: 3,
      practice: true,
      teams: [
        { name: 'Vos', players: [{ name: 'Vos', isHuman: true, manual: true, speedFactor: 1, reaction: 0, errorScale: 1, reachScale: HUMAN_REACH, hand: 1, controller: new Pupil(plain) }] },
        { name: 'Profe', players: [{ name: 'Profe', isHuman: false, manual: false, ...COACH_SETUP, reachScale: 1, hand: 1, controller: drill.coach }] },
      ],
    });
    drill.begin(match);
    const [me, coach] = match.players as [Player, Player];
    // At the net, as the lesson asks, and the ball in the coach's hand.
    expect(Math.abs(me.y)).toBeLessThan(4);
    expect(match.ballHeld).toBe(true);
    expect(match.serverId).toBe(coach.id);
    match.step();
    expect(Math.hypot(match.ball.x - coach.x, match.ball.y - coach.y)).toBeLessThan(0.7);
    // Sent somewhere else, they walk there on their own before the next ball.
    match.rest([{ x: 2, y: -7 }, { x: -1, y: 7 }], coach.id);
    expect(match.settled).toBe(false);
    for (let i = 0; i < 120 * 3 && !match.settled; i++) match.step();
    expect(match.settled).toBe(true);
    expect(Math.hypot(me.x - 2, me.y + 7)).toBeLessThan(0.15);
    // A touch during that walk does not turn it into a serve.
    expect(match.skipPause()).toBe(false);
    expect(match.phase).toBe('pointOver');
  });
});

describe('lo que queda guardado del tutorial', () => {
  it('las lecciones hechas, los golpes encontrados y las pistas mostradas vuelven al abrir de nuevo', async () => {
    const store = createMemoryStore();
    const profile = emptyProfile();
    expect(profile.lessons).toEqual([]);
    expect(profile.shots).toEqual({ lob: 0, drop: 0, wall: 0 });
    profile.lessons.push('move', 'lob');
    profile.shots.lob = 4;
    profile.hints.drop = 2;
    saveProfile(store, profile);
    await Promise.resolve();
    const loaded = (await loadData(store, false)).profile;
    expect(loaded.lessons).toEqual(['move', 'lob']);
    expect(loaded.shots).toEqual({ lob: 4, drop: 0, wall: 0 });
    expect(loaded.hints).toEqual({ lob: 0, drop: 2, wall: 0 });
    // And they travel with the rest of the save.
    const other = createMemoryStore();
    expect(await importData(other, await exportData(store))).toBe(true);
    await Promise.resolve();
    expect((await loadData(other, false)).profile.lessons).toEqual(['move', 'lob']);
  });

  it('lo que no se entiende se descarta: nada inventa una lección hecha', async () => {
    const store = createMemoryStore();
    await store.set(
      'padel.profile.v1',
      JSON.stringify({ lessons: ['lob', 'volar', 7, 'lob'], shots: { lob: -3, drop: 'x' }, hints: null }),
    );
    const loaded = (await loadData(store, false)).profile;
    expect(loaded.lessons).toEqual(['lob']);
    expect(loaded.shots).toEqual({ lob: 0, drop: 0, wall: 0 });
    expect(loaded.hints).toEqual({ lob: 0, drop: 0, wall: 0 });
  });
});
