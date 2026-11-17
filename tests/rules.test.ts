import { describe, expect, it } from 'vitest';
import { createConfig } from '../src/config';
import type { BallEvent } from '../src/sim/ball';
import { applyBallEvent, canHit, createRally, registerHit, type RallyResult, type RallyState } from '../src/sim/rules';

const { court } = createConfig();

// Team 0 plays on y < 0, team 1 on y > 0. In these tests team 0 hits.
const floor = (x: number, y: number, rolling = false): BallEvent => ({ type: 'floor', x, y, speed: 5, rolling });
const wall = (y: number, surface: 'glass' | 'fence'): BallEvent => ({
  type: 'wall',
  wall: y > 0 ? 'backFar' : 'backNear',
  surface,
  x: 0,
  y,
  z: 1,
  speed: 8,
});
const cross = (toSide: 0 | 1): BallEvent => ({ type: 'cross', x: 0, z: 1.5, toSide });
const net = (cord: boolean): BallEvent => ({ type: 'net', x: 0, z: 0.8, cord });
const out: BallEvent = { type: 'out', wall: 'backFar', x: 0, y: 10, z: 5 };

function rallyAfterHit(): RallyState {
  const rally = createRally();
  registerHit(rally, 0, false, 1);
  return rally;
}

function serveFrom0(box: 1 | -1 = -1): RallyState {
  const rally = createRally();
  registerHit(rally, 0, true, box);
  return rally;
}

/** Feeds the events in order and returns the first outcome. */
function play(rally: RallyState, ...events: BallEvent[]): RallyResult | null {
  for (const event of events) {
    const result = applyBallEvent(rally, event, court);
    if (result) return result;
  }
  return null;
}

describe('peloteo', () => {
  it('un pique en campo rival deja el punto en juego', () => {
    expect(play(rallyAfterHit(), cross(1), floor(1, 6))).toBeNull();
  });

  it('el doble pique es punto para quien pegó', () => {
    expect(play(rallyAfterHit(), cross(1), floor(1, 6), floor(1, 8))).toEqual({
      kind: 'point',
      winner: 0,
      reason: 'doubleBounce',
    });
  });

  it('después del pique la pelota puede tocar vidrio y reja', () => {
    const rally = rallyAfterHit();
    expect(play(rally, cross(1), floor(1, 7), wall(10, 'glass'), wall(10, 'fence'))).toBeNull();
    expect(play(rally, floor(1, 6))).toMatchObject({ winner: 0, reason: 'doubleBounce' });
  });

  it('tocar la pared rival antes de picar es punto en contra', () => {
    expect(play(rallyAfterHit(), cross(1), wall(10, 'glass'))).toEqual({ kind: 'point', winner: 1, reason: 'wall' });
    expect(play(rallyAfterHit(), cross(1), wall(10, 'fence'))).toEqual({ kind: 'point', winner: 1, reason: 'fence' });
  });

  it('picar en campo propio es punto en contra', () => {
    expect(play(rallyAfterHit(), floor(0, -3))).toEqual({ kind: 'point', winner: 1, reason: 'ownSide' });
  });

  it('si la red la frena, el punto se pierde por red', () => {
    expect(play(rallyAfterHit(), net(false), floor(0, -0.5))).toEqual({ kind: 'point', winner: 1, reason: 'net' });
  });

  it('se puede jugar contra el vidrio propio, pero no contra la reja propia', () => {
    expect(play(rallyAfterHit(), wall(-10, 'glass'), cross(1), floor(0, 5))).toBeNull();
    expect(play(rallyAfterHit(), wall(-10, 'fence'))).toEqual({ kind: 'point', winner: 1, reason: 'fence' });
  });

  it('irse de la cancha sin picar es punto en contra; después de picar, a favor', () => {
    expect(play(rallyAfterHit(), cross(1), out)).toEqual({ kind: 'point', winner: 1, reason: 'out' });
    expect(play(rallyAfterHit(), cross(1), floor(0, 6), out)).toEqual({
      kind: 'point',
      winner: 0,
      reason: 'outAfterBounce',
    });
  });

  it('si la pelota pica y vuelve sola por encima de la red, es punto para quien pegó', () => {
    expect(play(rallyAfterHit(), cross(1), floor(0, 6), wall(10, 'glass'), cross(0))).toEqual({
      kind: 'point',
      winner: 0,
      reason: 'overNet',
    });
  });

  it('una pelota que queda rodando ya no se puede jugar', () => {
    expect(play(rallyAfterHit(), cross(1), floor(0, 1, true))).toMatchObject({ winner: 0, reason: 'doubleBounce' });
  });
});

describe('quién puede pegar', () => {
  it('solo el equipo que recibe, y solo en su campo', () => {
    const rally = rallyAfterHit();
    expect(canHit(rally, 0, -5)).toBe(false); // the hitter cannot hit twice
    expect(canHit(rally, 1, -1)).toBe(false); // not over the net
    expect(canHit(rally, 1, 4)).toBe(true); // volley
    play(rally, floor(0, 6));
    expect(canHit(rally, 1, 7)).toBe(true); // after the bounce
  });

  it('el saque no se puede volear', () => {
    const rally = serveFrom0();
    expect(canHit(rally, 1, 4)).toBe(false);
    play(rally, cross(1), floor(-2, 5));
    expect(canHit(rally, 1, 6)).toBe(true);
  });

  it('nadie pega cuando no hay punto en juego', () => {
    const rally = createRally();
    expect(canHit(rally, 0, -5)).toBe(false);
    expect(canHit(rally, 1, 5)).toBe(false);
  });
});

describe('saque', () => {
  it('tiene que picar en el cuadro cruzado', () => {
    // Box with x < 0 on the far half, up to the service line at 6.95 m.
    expect(play(serveFrom0(-1), cross(1), floor(-2, 5))).toBeNull();
    expect(play(serveFrom0(-1), cross(1), floor(2, 5))).toEqual({ kind: 'fault', reason: 'box' });
    expect(play(serveFrom0(-1), cross(1), floor(-2, 7.5))).toEqual({ kind: 'fault', reason: 'box' });
    expect(play(serveFrom0(1), cross(1), floor(2, 5))).toBeNull();
  });

  it('las líneas son buenas', () => {
    expect(play(serveFrom0(-1), cross(1), floor(0, 6.95))).toBeNull();
  });

  it('es falta si toca una pared antes de picar o si no pasa la red', () => {
    expect(play(serveFrom0(), cross(1), wall(10, 'glass'))).toEqual({ kind: 'fault', reason: 'wall' });
    expect(play(serveFrom0(), net(false), floor(0, -0.5))).toEqual({ kind: 'fault', reason: 'net' });
    expect(play(serveFrom0(), cross(1), out)).toEqual({ kind: 'fault', reason: 'out' });
  });

  it('después de picar puede tocar el vidrio pero no la reja', () => {
    expect(play(serveFrom0(), cross(1), floor(-2, 5), wall(10, 'glass'))).toBeNull();
    expect(play(serveFrom0(), cross(1), floor(-2, 5), wall(10, 'fence'))).toEqual({ kind: 'fault', reason: 'fence' });
  });

  it('si toca la red y entra, se repite', () => {
    expect(play(serveFrom0(), net(true), cross(1), floor(-2, 3))).toEqual({ kind: 'let' });
    // Touching the net and landing out is still a fault.
    expect(play(serveFrom0(), net(true), cross(1), floor(2, 3))).toEqual({ kind: 'fault', reason: 'box' });
  });

  it('un saque bueno sin devolver es punto por doble pique', () => {
    expect(play(serveFrom0(), cross(1), floor(-2, 5), floor(-3, 8))).toEqual({
      kind: 'point',
      winner: 0,
      reason: 'doubleBounce',
    });
  });
});
