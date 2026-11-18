import { describe, expect, it } from 'vitest';
import { CONTROLS, createConfig } from '../src/config';
import { aimFromDrag, classifyTouch, intentFromFlick, neutralIntent } from '../src/input/gestures';

const { shots } = createConfig();
const C = CONTROLS;

describe('dos pulgares: el pulgar que apunta', () => {
  it('sin arrastrar apunta al medio, a una profundidad cómoda', () => {
    expect(aimFromDrag(0, 0)).toEqual({ aim: 0, depth: C.restDepth, lob: false, power: 1 });
    // That is a normal shot, not a chiquita.
    expect(C.restDepth).toBeGreaterThan(shots.dropAt);
  });

  it('arrastrar a los costados elige el lado', () => {
    expect(aimFromDrag(C.aimRadius / 2, 0).aim).toBeCloseTo(0.5, 6);
    expect(aimFromDrag(-C.aimRadius / 2, 0).aim).toBeCloseTo(-0.5, 6);
    // Never beyond the edge of the court.
    expect(aimFromDrag(C.aimRadius * 3, 0).aim).toBe(1);
    expect(aimFromDrag(-C.aimRadius * 3, 0).aim).toBe(-1);
  });

  it('arrastrar hacia arriba pide más profundidad', () => {
    // Screen y grows downward: up is negative.
    const little = aimFromDrag(0, -C.deepAt / 2);
    const full = aimFromDrag(0, -C.deepAt);
    expect(little.depth).toBeGreaterThan(C.restDepth);
    expect(full.depth).toBeCloseTo(1, 6);
    expect(full.lob).toBe(false);
    expect(little.depth).toBeLessThan(full.depth);
  });

  it('arrastrar mucho hacia arriba es un globo', () => {
    expect(aimFromDrag(0, -C.lobAt)).toMatchObject({ lob: true, aim: 0 });
    expect(aimFromDrag(0, -(C.lobAt - 4)).lob).toBe(false);
    // It can still be aimed to a side.
    const aimed = aimFromDrag(C.aimRadius, -C.lobAt - 10);
    expect(aimed.lob).toBe(true);
    expect(aimed.aim).toBe(1);
  });

  it('arrastrar hacia abajo es una chiquita', () => {
    const drop = aimFromDrag(0, C.dropAt);
    expect(drop.lob).toBe(false);
    expect(drop.depth).toBeLessThanOrEqual(shots.dropAt);
    // A little down is just a shorter ball, still a normal shot.
    const shorter = aimFromDrag(0, C.dropAt / 2);
    expect(shorter.depth).toBeLessThan(C.restDepth);
    expect(shorter.depth).toBeGreaterThan(shots.dropAt);
  });
});

describe('una mano: el deslizamiento rápido', () => {
  it('la dirección apunta el golpe', () => {
    expect(intentFromFlick(0, -80).aim).toBe(0);
    const right = intentFromFlick(40, -80);
    const left = intentFromFlick(-40, -80);
    expect(right.aim).toBeGreaterThan(0.4);
    expect(left.aim).toBeCloseTo(-right.aim, 6);
    expect(intentFromFlick(90, -10).aim).toBe(1);
  });

  it('el largo da la profundidad', () => {
    const short = intentFromFlick(0, -C.flickShortLength);
    const long = intentFromFlick(0, -C.flickDeepLength);
    expect(short.depth).toBeLessThan(long.depth);
    expect(long.depth).toBeCloseTo(1, 6);
    // Even the shortest flick is a normal shot.
    expect(short.depth).toBeGreaterThan(shots.dropAt);
    expect(short.lob).toBe(false);
  });

  it('largo hacia arriba es un globo; largo hacia el costado no', () => {
    expect(intentFromFlick(0, -C.flickLobLength).lob).toBe(true);
    expect(intentFromFlick(0, -(C.flickLobLength - 5)).lob).toBe(false);
    expect(intentFromFlick(260, -60).lob).toBe(false);
  });

  it('hacia abajo es una chiquita', () => {
    const drop = intentFromFlick(0, 70);
    expect(drop.depth).toBeLessThanOrEqual(shots.dropAt);
    expect(drop.lob).toBe(false);
    expect(intentFromFlick(40, 70).aim).toBeGreaterThan(0);
    expect(intentFromFlick(-40, 70).aim).toBeLessThan(0);
  });

  it('un toque es un golpe cómodo al medio', () => {
    expect(neutralIntent()).toEqual({ aim: 0, depth: C.restDepth, lob: false, power: 1 });
  });
});

describe('una mano: mover o pegar', () => {
  const touch = (more: Partial<Parameters<typeof classifyTouch>[0]>) =>
    classifyTouch({ duration: 80, distance: 0, moving: false, flingDistance: 0, flingMs: 0, ...more });

  it('un gesto rápido que recorrió distancia es un golpe', () => {
    expect(touch({ duration: 90, distance: 60 })).toBe('flick');
    expect(touch({ duration: 60, distance: C.flickMinDistance })).toBe('flick');
  });

  it('un toque sin moverse también pega', () => {
    expect(touch({ duration: 60, distance: 3 })).toBe('tap');
  });

  it('un movimiento corto y dudoso no hace nada', () => {
    expect(touch({ duration: 60, distance: (C.tapMaxDistance + C.flickMinDistance) / 2 })).toBe('none');
  });

  it('un arrastre lento es solo movimiento: soltar no pega', () => {
    // The touch had become the stick, and the thumb lifted gently.
    expect(touch({ duration: 900, distance: 80, moving: true, flingDistance: 6, flingMs: 70 })).toBe('none');
    // Even after a long run.
    expect(touch({ duration: 3000, distance: 200, moving: true, flingDistance: 20, flingMs: 70 })).toBe('none');
  });

  it('salir del joystick a toda velocidad es un golpe', () => {
    const fast = C.flingSpeed * 70 + 10;
    expect(touch({ duration: 900, distance: 120, moving: true, flingDistance: fast, flingMs: 70 })).toBe('fling');
    // Fast but tiny is a twitch, not a shot.
    expect(touch({ duration: 900, distance: 120, moving: true, flingDistance: C.flingMinDistance - 5, flingMs: 10 })).toBe('none');
  });
});
