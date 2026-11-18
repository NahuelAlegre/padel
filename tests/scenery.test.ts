import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScene } from '../src/app/scene';
import { createConfig } from '../src/config';
import { PrototypeRenderer } from '../src/render/prototype/renderer';
import type { Renderer } from '../src/render/scene';
import type { Scenery, SceneryView } from '../src/render/scenery';

/**
 * The scenery is made once and copied every frame, in three pieces. These
 * tests hold the renderer to what makes a baked scenery possible later: it
 * never waits for one, it swaps it in when it arrives, and it drops one that
 * arrives for a screen that is no longer there.
 *
 * There is no canvas here: a stand-in records what is copied onto the screen.
 */
type Copy = { image: unknown; x: number; y: number; width: number; height: number };

function fakeContext(copies: Copy[] | null): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {};
  return new Proxy(target, {
    get(_, name: string) {
      if (name in target) return target[name];
      if (name === 'measureText') return () => ({ width: 40 });
      if (name === 'drawImage') {
        return (image: unknown, x: number, y: number, width: number, height: number) => {
          copies?.push({ image, x, y, width, height });
        };
      }
      return () => undefined;
    },
    set(_, name: string, value: unknown) {
      target[name] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function fakeCanvas(copies: Copy[] | null = null): HTMLCanvasElement {
  const context = fakeContext(copies);
  return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
}

const SAFE = { top: 0, right: 0, bottom: 0, left: 0 };

describe('escenario en tres capas', () => {
  const globals = globalThis as { document?: unknown };
  const before = globals.document;
  beforeAll(() => {
    globals.document = { createElement: () => fakeCanvas() };
  });
  afterAll(() => {
    globals.document = before;
  });

  /** A renderer drawing on a stand-in screen, with what it copies onto it in every frame. */
  function setup(bake?: (view: SceneryView) => Promise<Scenery | null>) {
    const copies: Copy[] = [];
    const renderer: Renderer = new PrototypeRenderer(fakeCanvas(copies), createConfig().court, bake ?? null);
    const scene = createScene();
    const frame = (): Copy[] => {
      copies.length = 0;
      renderer.render(scene, 1 / 60);
      return [...copies];
    };
    return { renderer, frame };
  }

  /** A baked scenery: three images that are not the painted ones. */
  function baked(tag: string): Scenery {
    return {
      back: { tag: `${tag}-back` } as unknown as CanvasImageSource,
      net: { image: { tag: `${tag}-net` } as unknown as CanvasImageSource, x: 10, y: 300, width: 340, height: 40 },
      front: { image: { tag: `${tag}-front` } as unknown as CanvasImageSource, x: 5, y: 520, width: 350, height: 90 },
    };
  }

  it('cada cuadro copia el fondo, la red y la pared cercana, en ese orden', () => {
    const { renderer, frame } = setup();
    renderer.resize(360, 800, 2, SAFE);
    const copies = frame();
    expect(copies).toHaveLength(3);
    const [back, net, front] = copies as [Copy, Copy, Copy];
    // The back covers the whole screen.
    expect(back).toMatchObject({ x: 0, y: 0, width: 360, height: 800 });
    // The net is a strip across the middle of the court; the near wall, a strip below it.
    expect(net.width).toBeGreaterThan(200);
    expect(net.height).toBeLessThan(120);
    expect(front.y).toBeGreaterThan(net.y);
    expect(front.width).toBeGreaterThan(net.width);
    // Each piece is only as big as what it holds, give or take the width of a stroke.
    for (const piece of [net, front]) {
      expect(piece.x).toBeGreaterThanOrEqual(-6);
      expect(piece.x + piece.width).toBeLessThanOrEqual(366);
      expect(piece.y + piece.height).toBeLessThanOrEqual(800);
      expect(piece.height).toBeLessThan(400);
    }
  });

  it('las capas siguen a la cámara y a la zona segura', () => {
    const { renderer, frame } = setup();
    renderer.resize(360, 800, 2, SAFE);
    const plain = frame();
    renderer.resize(360, 800, 2, { top: 47, right: 0, bottom: 34, left: 0 });
    const notched = frame();
    expect(notched[1]!.y).not.toBe(plain[1]!.y);
    renderer.setCamera('high');
    const high = frame();
    expect(high[1]!.y).not.toBe(notched[1]!.y);
  });

  it('nunca espera al horneado: hay cancha en el primer cuadro y el horneado entra cuando llega', async () => {
    let finish: (scenery: Scenery | null) => void = () => {};
    const { renderer, frame } = setup(() => new Promise((resolve) => (finish = resolve)));
    renderer.resize(360, 800, 2, SAFE);

    // The bake has not finished and there is already something to play on.
    const first = frame();
    expect(first).toHaveLength(3);
    const painted = first[0]!.image;

    const ready = baked('a');
    finish(ready);
    await Promise.resolve();
    await Promise.resolve();
    const after = frame();
    expect(after.map((copy) => copy.image)).toEqual([ready.back, ready.net.image, ready.front.image]);
    expect(after[0]!.image).not.toBe(painted);
    // The pieces go where the baker said.
    expect(after[1]).toMatchObject({ x: 10, y: 300, width: 340, height: 40 });
  });

  it('si no se puede hornear (sin WebGL2, o el shader falla), queda el pintado', async () => {
    for (const bake of [
      () => Promise.resolve(null),
      () => Promise.reject(new Error('shader did not compile')),
    ]) {
      const { renderer, frame } = setup(bake);
      renderer.resize(360, 800, 2, SAFE);
      const painted = frame()[0]!.image;
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      const after = frame();
      expect(after).toHaveLength(3);
      expect(after[0]!.image).toBe(painted);
    }
  });

  it('un horneado que llega tarde, para una pantalla que ya cambió, se descarta', async () => {
    const pending: Array<(scenery: Scenery | null) => void> = [];
    const { renderer, frame } = setup(() => new Promise((resolve) => pending.push(resolve)));
    renderer.resize(360, 800, 2, SAFE);
    renderer.resize(412, 915, 2, SAFE);
    expect(pending).toHaveLength(2);

    // The first one answers after the screen changed: nothing happens.
    pending[0]!(baked('viejo'));
    await Promise.resolve();
    await Promise.resolve();
    expect(frame()[0]).toMatchObject({ width: 412, height: 915 });
    expect((frame()[0]!.image as { tag?: string }).tag).toBeUndefined();

    // The one for the current screen is taken.
    const current = baked('nuevo');
    pending[1]!(current);
    await Promise.resolve();
    await Promise.resolve();
    expect(frame()[0]!.image).toBe(current.back);
  });

  it('el juego solo conoce la interfaz: cámara y proyección también pasan por ella', () => {
    const { renderer } = setup();
    renderer.resize(360, 800, 2, SAFE);
    const net = { x: 0, y: 0 };
    const far = { x: 0, y: 0 };
    renderer.project(0, 0, 0, net);
    renderer.project(0, 10, 0, far);
    // The middle of the court is the middle of the screen, and the far wall is higher up.
    expect(net.x).toBeCloseTo(180, 0);
    expect(far.y).toBeLessThan(net.y);
    renderer.setCamera('low');
    const lower = { x: 0, y: 0 };
    renderer.project(0, 10, 0, lower);
    expect(lower.y).not.toBeCloseTo(far.y, 0);
  });
});
