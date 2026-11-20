import { describe, expect, it } from 'vitest';
import { createScene, fillScene, type SceneOptions } from '../src/app/scene';
import { createConfig, type GameConfig } from '../src/config';
import { aimAtBody } from '../src/control/ai';
import { InputState } from '../src/input/state';
import { Match, type Controller, type SimEvent } from '../src/sim/match';
import type { Player } from '../src/sim/player';
import { ballPressure, type BallAsk } from '../src/sim/pressure';
import { resolveShot, solveShot } from '../src/sim/shots';
import type { PlayerIntent } from '../src/sim/types';
import { createZoneReading, outOfZone, readZone, zoneFacing } from '../src/sim/zones';
import { defaultSettings, readSettings } from '../src/ui/settings';
import { aiEntry, humanEntry, playMatch, SKILLS, withTactics } from './helpers';

/** A configuration with the hit zones on. */
function zonesOn(): GameConfig {
  const config = createConfig();
  config.zones.on = true;
  return config;
}

/** The near player (team 0, facing +y) at (0, -7), a ball coming straight from the net. */
function zoneOf(config: GameConfig, dx: number, ahead: number, z: number, vx = 0, vy = -10) {
  return readZone(0, 0, -7, dx, -7 + ahead, z, vx, vy, 1.6, config, createZoneReading());
}

describe('zonas de golpe: dónde está la pelota alrededor del cuerpo', () => {
  const config = zonesOn();
  const zones = config.zones;
  const pc = config.player;

  it('al costado, un poco adelante y a media altura es la ideal', () => {
    const reading = zoneOf(config, pc.sweetSpot, pc.contactAhead, 1);
    expect(reading.zone).toBe('ideal');
    expect(reading.body).toBe(0);
    expect(reading.behind).toBe(0);
    expect(reading.far).toBe(0);
    expect(reading.side).toBeCloseTo(pc.sweetSpot, 6);
    expect(reading.ahead).toBeCloseTo(pc.contactAhead, 6);
  });

  it('pegada al pecho es al cuerpo, y de a poco: a medio camino del costado ya no del todo', () => {
    const chest = zoneOf(config, 0.05, 0.3, 1.1);
    expect(chest.zone).toBe('body');
    expect(chest.body).toBe(1);
    const between = zoneOf(config, (zones.bodyFull + zones.bodyFree) / 2, 0.3, 1.1);
    expect(between.body).toBeGreaterThan(0.3);
    expect(between.body).toBeLessThan(0.7);
    // Right in front of the body, at arm's length, it is still at the body: there is no room for a stroke.
    expect(zoneOf(config, 0.05, zones.bodyAhead, 1.1).body).toBeCloseTo(1, 6);
    expect(zoneOf(config, 0.05, zones.bodyAheadFree + 0.1, 1.1).body).toBe(0);
  });

  it('por arriba de la cabeza no es al cuerpo: es un remate o una bandeja', () => {
    const high = zoneOf(config, 0.1, 0.3, pc.overheadZ + 0.3);
    expect(high.body).toBe(0);
    expect(high.zone).toBe('high');
  });

  it('al ras del piso es baja, como siempre', () => {
    expect(zoneOf(config, pc.sweetSpot, pc.contactAhead, 0.25).zone).toBe('low');
  });

  it('pasada la línea del cuerpo es atrás, de a poco, y muy atrás ya no se llega', () => {
    const justPast = zoneOf(config, pc.sweetSpot, -zones.behindFrom + 0.01, 1);
    expect(justPast.behind).toBe(0);
    const late = zoneOf(config, pc.sweetSpot, -(zones.behindFrom + zones.behindFull) / 2, 1);
    expect(late.behind).toBeGreaterThan(0.3);
    expect(late.behind).toBeLessThan(0.7);
    const gone = zoneOf(config, pc.sweetSpot, -zones.behindFull - 0.05, 1);
    expect(gone.zone).toBe('behind');
    expect(outOfZone(gone, config)).toBe(zones.behindFull + 0.05 > zones.behindOut);
    expect(outOfZone(zoneOf(config, pc.sweetSpot, -zones.behindOut - 0.05, 1), config)).toBe(true);
    expect(outOfZone(late, config)).toBe(false);
  });

  it('lejos es la estirada de siempre', () => {
    const far = zoneOf(config, 1.5, 0.2, 1);
    expect(far.zone).toBe('far');
    expect(far.far).toBeGreaterThan(0.5);
  });

  it('contra el propio vidrio el cuerpo se da vuelta: lo de atrás le queda adelante', () => {
    const reading = readZone(0, 0, -7, pc.sweetSpot, -7.4, 1, 0, -6, 1.6, config, createZoneReading(), true);
    expect(reading.ahead).toBeCloseTo(0.4, 6);
    expect(reading.behind).toBe(0);
  });

  it('mira a la red y gira hacia la pelota que viene, hasta un tope', () => {
    const facing = { x: 0, y: 0 };
    // Straight from the net: facing the net.
    zoneFacing(0, 0, -10, config, facing);
    expect(facing.x).toBeCloseTo(0, 6);
    expect(facing.y).toBeCloseTo(1, 6);
    // Coming from far to its left, at 60 degrees: it turns toward it, as far as the cap.
    zoneFacing(0, 10 * Math.sin(Math.PI / 3), -10 * Math.cos(Math.PI / 3), config, facing);
    const turned = (Math.atan2(-facing.x, facing.y) * 180) / Math.PI;
    expect(turned).toBeCloseTo(Math.min(60, zones.turn), 4);
    expect(Math.hypot(facing.x, facing.y)).toBeCloseTo(1, 6);
    // Off the back glass, coming toward the net: it waits for it facing the net.
    zoneFacing(0, 2, 6, config, facing);
    expect(facing.y).toBeCloseTo(1, 6);
    // The far team faces the other way.
    zoneFacing(1, 0, 10, config, facing);
    expect(facing.y).toBeCloseTo(-1, 6);
  });
});

describe('zonas de golpe: lo que le hacen a la pelota', () => {
  const ask: BallAsk = { ballX: 0, ballY: -7, ballZ: 1, speed: 10, gap: 0.62, reach: 1.6, retreat: 0, risk: 0 };

  it('apagadas, la presión es la de siempre aunque la pelota esté al cuerpo', () => {
    const config = createConfig();
    expect(ballPressure({ ...ask, body: 1, behind: 1 }, config)).toBe(ballPressure(ask, config));
  });

  it('prendidas, una pelota al cuerpo o pasada es más difícil, y de a poco', () => {
    const config = zonesOn();
    const clean = ballPressure(ask, config);
    const half = ballPressure({ ...ask, body: 0.5 }, config);
    const full = ballPressure({ ...ask, body: 1 }, config);
    expect(half).toBeGreaterThan(clean);
    expect(full).toBeGreaterThan(half);
    expect(ballPressure({ ...ask, behind: 0.5 }, config)).toBeGreaterThan(clean);
  });
});

describe('zonas de golpe: apagadas, el juego es el de siempre', () => {
  /** Every hit of a whole match: who, what, where and how fast. */
  function hitsOf(configure: (config: GameConfig) => void): string[] {
    const config = createConfig();
    configure(config);
    const match = new Match({
      config,
      seed: 41,
      teams: [
        { name: 'A', players: [humanEntry(7, withTactics(SKILLS.average, 1))] },
        { name: 'B', players: [aiEntry(config, 'romina', 8)] },
      ],
    });
    const hits: string[] = [];
    playMatch(match, 600, (event: SimEvent) => {
      if (event.type === 'hit') hits.push(`${event.player} ${event.kind} ${event.x.toFixed(6)} ${event.y.toFixed(6)} ${event.speed.toFixed(6)}`);
    });
    return hits;
  }

  it('cambiar los números de las zonas no cambia nada si están apagadas', () => {
    const plain = hitsOf(() => {});
    const tweaked = hitsOf((config) => {
      config.zones.weights.body = 3;
      config.zones.behindOut = 0.1;
      config.zones.place = 9;
      config.zones.dodge = 9;
      config.zones.turn = 80;
    });
    expect(plain.length).toBeGreaterThan(20);
    expect(tweaked).toEqual(plain);
  });

  it('prendidas, el mismo partido se juega distinto', () => {
    expect(hitsOf((config) => (config.zones.on = true))).not.toEqual(hitsOf(() => {}));
  });
});

type Hit = Extract<SimEvent, { type: 'hit' }>;

/** A person moved by hand that stands still and swings: early, as soon as it has a ball within reach (armed), or when the test says. */
class StandStill implements Controller {
  private swung = false;
  constructor(private readonly when: (match: Match, me: Player) => boolean = (_match, me) => me.plan !== null) {}
  update(match: Match, me: Player, intent: PlayerIntent): void {
    if (!this.swung && match.phase === 'rally' && match.rally.hitter !== me.team && this.when(match, me)) {
      this.swung = true;
      intent.swing = { aim: 0.9, depth: 0.8, lob: false, power: 1 };
    }
  }
}

/** Does nothing: it only feeds. */
const idle: Controller = { update: () => {} };

/**
 * A ball fed from the other side straight down the middle, to a person
 * standing still at (`x`, `y`). Returns the person's hit (if any), where its
 * ball landed, and what its body showed before the contact.
 */
function receive(zones: boolean, x: number, y: number, when?: (match: Match, me: Player) => boolean) {
  const config = createConfig();
  config.zones.on = zones;
  const match = new Match({
    config,
    seed: 3,
    practice: true,
    teams: [
      // No scatter: what is tested is where the ball is met, not the hands.
      { name: 'Vos', players: [{ name: 'Vos', isHuman: true, manual: true, speedFactor: 1, reaction: 0, errorScale: 0, reachScale: 1, hand: 1, controller: new StandStill(when) }] },
      { name: 'Profe', players: [{ name: 'Profe', isHuman: false, manual: false, speedFactor: 1, reaction: 0.2, errorScale: 0, reachScale: 1, hand: 1, controller: idle }] },
    ],
  });
  match.rest([{ x, y }, { x: 0, y: 7 }], 1, true);
  match.feed({ targetX: 0, targetY: -5, kind: 'drive', params: { clearance: 0.6, apex: 0, speed: 12 } });
  const scene = createScene();
  const input = new InputState();
  const options: SceneOptions = { aids: 'minimal', aidStrength: 1, reduceMotion: false, debug: false, cueLead: 0, tutorial: null, cast: [], acts: [] };
  const looks = new Set<string>();
  let hit: Hit | undefined;
  let landing: { x: number; y: number } | undefined;
  let over = false;
  for (let i = 0; i < 6 * 120 && !landing && !over; i++) {
    match.step();
    fillScene(scene, match, 1, input, options);
    const why = scene.players[0]!.why;
    if (!hit && why) looks.add(why);
    for (const event of match.events) {
      if (event.type === 'hit' && event.team === 0) hit = event;
      else if (event.type === 'bounce' && hit && event.y > 0) landing = { x: event.x, y: event.y };
      else if (event.type === 'point' && !hit) over = true;
    }
    match.events.length = 0;
  }
  return { hit, landing, looks, config };
}

describe('zonas de golpe: en la cancha', () => {
  it('al costado sale como se pidió; al cuerpo es un bloqueo: más lento y al medio', () => {
    const side = receive(true, -0.62, -7.3);
    const body = receive(true, 0, -7.3);
    expect(side.hit?.zone).toBe('ideal');
    expect(body.hit?.zone).toBe('body');
    expect(body.hit!.speed).toBeLessThan(side.hit!.speed * 0.85);
    expect(Math.abs(body.landing!.x)).toBeLessThan(Math.abs(side.landing!.x) / 2);
    expect(body.hit!.pressure).toBeGreaterThan(side.hit!.pressure + 0.5);
  });

  it('apagadas, la misma pelota al cuerpo sale igual que al costado', () => {
    const side = receive(false, -0.62, -7.3);
    const body = receive(false, 0, -7.3);
    expect(body.hit?.zone).toBe('body');
    expect(body.hit!.speed).toBeCloseTo(side.hit!.speed, 0);
    expect(body.hit!.pressure).toBeCloseTo(side.hit!.pressure, 1);
  });

  it('el cuerpo lo muestra antes del contacto: bloquea la que le viene al pecho, y solo con las zonas', () => {
    expect(receive(true, 0, -7.3).looks.has('block')).toBe(true);
    expect(receive(true, -0.62, -7.3).looks.has('block')).toBe(false);
    expect(receive(false, 0, -7.3).looks.size).toBe(0);
  });

  it('a una pelota que ya pasó la línea del cuerpo por más de lo que alcanza, no se le pega', () => {
    // It swings when the ball is well past it: today's generous lunge still gets it, behind the back.
    const past = (match: Match, me: Player): boolean => match.ball.y < me.y - 1.2 && match.ball.vy < 0;
    const today = receive(false, -0.62, -6.2, past);
    expect(today.hit).toBeDefined();
    expect(today.hit!.ahead!).toBeLessThan(-1);
    const zones = receive(true, -0.62, -6.2, past);
    if (zones.hit) expect(zones.hit.ahead!).toBeGreaterThanOrEqual(-zones.config.zones.behindOut);
  });

  it('al cuerpo de quien está en la red: la pelota pasa por donde está parado, a media altura', () => {
    const config = createConfig();
    config.zones.on = true;
    for (const [fromX, fromY, atX, atY] of [
      [0, 7.5, 1.5, -3.2],
      [-2, 6, -1.8, -3],
      [2.5, 7, -1, -3.5],
    ] as const) {
      const [aim, depth] = aimAtBody(fromX, fromY, atX, atY, config);
      // Struck by the far team (1): its aim is in world space too, as everybody's.
      const shot = resolveShot(
        { team: 1, hand: 1, playerX: fromX, playerY: fromY + 0.2, ballX: fromX, ballY: fromY, ballZ: 1, bounces: 1, walls: 0, pressure: 0 },
        { aim, depth, lob: false, power: 1 },
        config,
      );
      const launch = solveShot(fromX, fromY, 1, shot.targetX, shot.targetY, shot.params, config.physics, config.court);
      // Where it is when it crosses the line of the player at the net.
      const t = (atY - fromY) / launch.vy;
      const crossX = fromX + launch.vx * t;
      const crossZ = 1 + launch.vz * t - 0.5 * config.physics.gravity * t * t;
      expect(Math.abs(crossX - atX)).toBeLessThan(0.3);
      expect(crossZ).toBeGreaterThan(0.4);
      expect(crossZ).toBeLessThan(1.8);
    }
  });

  it('es una opción experimental: apagada por defecto, y se recuerda', () => {
    expect(defaultSettings(false).zones).toBe(false);
    expect(createConfig().zones.on).toBe(false);
    expect(readSettings({ zones: true }, false).zones).toBe(true);
    expect(readSettings({ zones: 'sí' }, false).zones).toBe(false);
  });
});
