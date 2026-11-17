import { describe, expect, it } from 'vitest';
import { CONTROLS } from '../src/config';
import { interpretGesture, lobLength } from '../src/input/gestures';

const HEIGHT = 812;

describe('gestos', () => {
  it('tocar es un golpe seguro al centro', () => {
    expect(interpretGesture(0, 0, 80, HEIGHT)).toEqual({ kind: 'safe', aim: 0 });
    expect(interpretGesture(5, -8, 120, HEIGHT)).toEqual({ kind: 'safe', aim: 0 });
  });

  it('mantener apretado sin mover no hace nada', () => {
    expect(interpretGesture(2, 1, CONTROLS.tapMaxDuration + 200, HEIGHT)).toBeNull();
  });

  it('deslizar hacia arriba es un drive al centro', () => {
    expect(interpretGesture(0, -70, 100, HEIGHT)).toEqual({ kind: 'drive', aim: 0 });
  });

  it('la dirección del deslizamiento apunta el golpe', () => {
    const right = interpretGesture(30, -70, 100, HEIGHT)!;
    const left = interpretGesture(-30, -70, 100, HEIGHT)!;
    expect(right.kind).toBe('drive');
    expect(right.aim).toBeGreaterThan(0.4);
    expect(left.aim).toBeCloseTo(-right.aim, 6);

    // More tilt, more to the side, and never beyond the edge.
    const wider = interpretGesture(60, -70, 100, HEIGHT)!;
    expect(wider.aim).toBeGreaterThan(right.aim);
    expect(interpretGesture(90, -10, 100, HEIGHT)!.aim).toBe(1);
    expect(interpretGesture(-90, -10, 100, HEIGHT)!.aim).toBe(-1);
  });

  it('deslizar largo hacia arriba es un globo', () => {
    const length = lobLength(HEIGHT);
    expect(interpretGesture(0, -(length + 5), 180, HEIGHT)).toEqual({ kind: 'lob', aim: 0 });
    expect(interpretGesture(0, -(length - 5), 180, HEIGHT)!.kind).toBe('drive');
    // It can still be aimed.
    const aimed = interpretGesture(60, -length, 180, HEIGHT)!;
    expect(aimed.kind).toBe('lob');
    expect(aimed.aim).toBeGreaterThan(0);
  });

  it('un deslizamiento largo hacia el costado sigue siendo un drive', () => {
    expect(interpretGesture(260, -60, 180, HEIGHT)!.kind).toBe('drive');
  });

  it('deslizar hacia abajo es una dejada', () => {
    expect(interpretGesture(0, 70, 100, HEIGHT)).toEqual({ kind: 'drop', aim: 0 });
    expect(interpretGesture(40, 70, 100, HEIGHT)!.aim).toBeGreaterThan(0);
    expect(interpretGesture(-40, 70, 100, HEIGHT)!.aim).toBeLessThan(0);
  });

  it('el largo del globo se adapta a la pantalla dentro de un rango', () => {
    expect(lobLength(400)).toBe(CONTROLS.lobLengthMin);
    expect(lobLength(2000)).toBe(CONTROLS.lobLengthMax);
    expect(lobLength(800)).toBeCloseTo(800 * CONTROLS.lobLengthFraction, 6);
  });
});
