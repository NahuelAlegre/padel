import { describe, expect, it } from 'vitest';
import { createConfig } from '../src/config';
import { Camera, type Projected } from '../src/render/camera';
import { VIEW } from '../src/render/view';

const { court } = createConfig();

function fit(width: number, height: number, name: keyof typeof VIEW.cameras = 'mid'): Camera {
  const camera = new Camera();
  camera.fit(VIEW.cameras[name], court, width, height, {
    top: VIEW.insetTop,
    bottom: height * VIEW.insetBottomFraction,
    side: VIEW.insetSide,
    align: VIEW.align,
  });
  return camera;
}

const p: Projected = { x: 0, y: 0, scale: 0 };

describe('cámara', () => {
  const screens: Array<[string, number, number]> = [
    ['celular alto', 360, 800],
    ['celular 16:9', 360, 640],
    ['celular grande', 430, 932],
    ['columna de escritorio', 506, 900],
    ['tablet', 768, 1024],
  ];

  for (const [name, width, height] of screens) {
    for (const preset of ['low', 'mid', 'high'] as const) {
      it(`la cancha entra completa en ${name} con la cámara ${preset}`, () => {
        const camera = fit(width, height, preset);
        const hw = court.halfWidth;
        const hl = court.halfLength;
        const corners: Array<[number, number, number]> = [
          [-hw, -hl, 0],
          [hw, -hl, 0],
          [-hw, hl, 0],
          [hw, hl, 0],
          [-hw, hl, court.backFence],
          [hw, hl, court.backFence],
          [-hw, -hl, court.backGlass],
          [hw, -hl, court.backGlass],
        ];
        for (const [x, y, z] of corners) {
          camera.project(x, y, z, p);
          expect(p.x).toBeGreaterThanOrEqual(-0.5);
          expect(p.x).toBeLessThanOrEqual(width + 0.5);
          expect(p.y).toBeGreaterThanOrEqual(VIEW.insetTop - 0.5);
          expect(p.y).toBeLessThanOrEqual(height * (1 - VIEW.insetBottomFraction) + 0.5);
        }
      });
    }
  }

  it('lo que está más lejos se ve más chico y más arriba', () => {
    const camera = fit(390, 844);
    const near = camera.project(0, -9, 0, { x: 0, y: 0, scale: 0 });
    const far = camera.project(0, 9, 0, { x: 0, y: 0, scale: 0 });
    expect(far.scale).toBeLessThan(near.scale);
    expect(far.y).toBeLessThan(near.y);
  });

  it('la altura de la pelota se lee como distancia a su sombra', () => {
    const camera = fit(390, 844);
    const shadow = camera.project(1, -4, 0, { x: 0, y: 0, scale: 0 });
    const low = camera.project(1, -4, 1, { x: 0, y: 0, scale: 0 });
    const high = camera.project(1, -4, 3, { x: 0, y: 0, scale: 0 });
    expect(low.y).toBeLessThan(shadow.y);
    expect(high.y).toBeLessThan(low.y);
    // Straight above, give or take the perspective: a higher ball is closer to the camera.
    expect(Math.abs(low.x - shadow.x)).toBeLessThan(2);
    expect(shadow.y - high.y).toBeGreaterThan((shadow.y - low.y) * 2.5);
  });

  it('el centro de la cancha queda centrado en la pantalla', () => {
    const camera = fit(390, 844);
    expect(camera.project(0, 0, 0, p).x).toBeCloseTo(195, 6);
    const left = camera.project(-3, 2, 0, { x: 0, y: 0, scale: 0 });
    const right = camera.project(3, 2, 0, { x: 0, y: 0, scale: 0 });
    expect(left.x + right.x).toBeCloseTo(390, 6);
    expect(left.y).toBeCloseTo(right.y, 6);
  });

  it('en vertical la cancha ocupa más alto que ancho', () => {
    const camera = fit(390, 844);
    const { bounds } = camera;
    expect(bounds.bottom - bounds.top).toBeGreaterThan(bounds.right - bounds.left);
  });
});
