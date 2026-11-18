import { describe, expect, it } from 'vitest';
import { createScene, fillScene, type SceneOptions } from '../src/app/scene';
import { CAST } from '../src/characters/cast';
import { createConfig, type RivalId } from '../src/config';
import { NO_INSETS } from '../src/core/layout';
import { InputState } from '../src/input/state';
import type { AidLevel, Scene } from '../src/render/scene';
import {
  figureScale,
  FOLLOW,
  Follow,
  followCamera,
  layout,
  makeCamera,
  REFERENCE,
  type FollowContext,
} from '../src/render/stage/camera';
import { Director, LABEL_SECONDS } from '../src/render/stage/director';
import { EFFECT_SECONDS } from '../src/render/stage/frame';
import { StageView, type Projected } from '../src/render/stage/view';
import { Match, type SimEvent } from '../src/sim/match';
import { aiEntry, humanEntry, SKILLS } from './helpers';

const texts = {
  shotName: (kind: string) => kind,
  quality: { perfect: 'perfecto', good: 'bien', early: 'temprano', late: 'tarde' },
  tooFar: 'lejos',
};
const noPalette = new Float32Array(26 * 4);

function options(aids: AidLevel, more: Partial<SceneOptions> = {}): SceneOptions {
  return { aids, aidStrength: 1, reduceMotion: false, debug: false, cueLead: 0, tutorial: null, cast: [], acts: [], ...more };
}

/** A phone held upright: the frame the court was composed for. */
const PHONE: [number, number] = [390, 844];

describe('la cámara de referencia y el encuadre', () => {
  const cam = makeCamera(REFERENCE);
  const seen = { x: 0, y: 0, d: 0 };

  it('mira la cancha desde atrás y de arriba: el fondo queda arriba, el vidrio propio abajo', () => {
    const far = cam.project(0, 10, 0, { x: 0, y: 0, d: 0 });
    const net = cam.project(0, 0, 0, { x: 0, y: 0, d: 0 });
    const near = cam.project(0, -10, 0, { x: 0, y: 0, d: 0 });
    expect(far.x).toBeCloseTo(0, 6);
    expect(far.y).toBeLessThan(net.y);
    expect(net.y).toBeLessThan(near.y);
    expect(far.d).toBeGreaterThan(near.d);
    // The whole court fits across the frame, with room to spare on both sides.
    for (const y of [-10, 10]) {
      for (const x of [-5, 5]) expect(Math.abs(cam.project(x, y, 0, seen).x)).toBeLessThan(REFERENCE.design[0] / 2 - 4);
    }
  });

  it('sin paneo ni zoom, la cámara que acompaña es exactamente la de referencia', () => {
    const same = followCamera(0, 1);
    for (const [x, y, z] of [[3, -7, 0], [-5, 10, 3], [0, 0, 1]] as const) {
      const a = cam.project(x, y, z, { x: 0, y: 0, d: 0 });
      const b = same.project(x, y, z, { x: 0, y: 0, d: 0 });
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
    }
  });

  it('el cuadro ocupa el ancho de la columna en cualquier pantalla', () => {
    const phone = layout(...PHONE);
    expect(phone.s).toBeCloseTo(1, 9);
    expect(phone.ox).toBeCloseTo(195, 9);
    // A long phone shows more sky and more ground; a short one, less. Never bars.
    const long = layout(360, 880);
    const short = layout(360, 600);
    expect(long.s).toBeCloseTo(360 / 390, 9);
    expect(long.visH).toBeGreaterThan(short.visH);
    expect(short.colW).toBeLessThanOrEqual(360);
    // The court itself is inside the screen from top to bottom on all of them.
    for (const lay of [phone, long, short]) {
      const view = new StageView();
      view.resize(lay.vw, lay.vh);
      const p: Projected = { x: 0, y: 0, scale: 0, squash: 0 };
      expect(view.project(0, 10, 4, p).y).toBeGreaterThan(0);
      expect(view.project(0, -10, 0, p).y).toBeLessThan(lay.vh);
    }
  });

  it('los personajes se dibujan más grandes de lo real: un poco el cercano, más el del fondo', () => {
    expect(figureScale(-10)).toBeCloseTo(1.2, 9);
    expect(figureScale(-8)).toBeCloseTo(1.2, 9);
    expect(figureScale(8)).toBeCloseTo(1.5, 9);
    expect(figureScale(10)).toBeCloseTo(1.5, 9);
    expect(figureScale(0)).toBeCloseTo(1.35, 9);
    let last = 0;
    for (let y = -10; y <= 10; y += 0.5) {
      expect(figureScale(y)).toBeGreaterThanOrEqual(last);
      last = figureScale(y);
    }
  });
});

describe('la cámara que acompaña, pieza por pieza', () => {
  function context(more: Partial<FollowContext> = {}): FollowContext {
    return {
      player: { x: 0, y: -7, k: 1.2 },
      mates: [],
      rivals: [{ x: 0, y: 7, k: 1.5 }],
      ball: { x: 0, y: 0, z: 1, vy: 0, visible: true, held: false },
      mark: null,
      lay: layout(...PHONE),
      top: 0,
      bottom: 0,
      ...more,
    };
  }
  const settle = (follow: Follow, ctx: FollowContext, seconds = 4): void => {
    for (let i = 0; i < seconds * 60; i++) follow.update(ctx, 1 / 60);
  };

  it('tiene zona muerta: un paso al costado no la mueve', () => {
    const follow = new Follow();
    const ctx = context();
    follow.jump(ctx, true);
    const before = follow.pan;
    // The framing it would like moves 0.62 m for every metre of the player.
    ctx.player.x = 0.6;
    settle(follow, ctx, 2);
    expect(follow.pan).toBeCloseTo(before, 3);
    ctx.player.x = 3;
    settle(follow, ctx);
    expect(follow.pan).toBeGreaterThan(before + 0.5);
  });

  it('va de a poco: nunca más rápido que su velocidad de paneo, y sin saltos', () => {
    const follow = new Follow();
    const ctx = context();
    follow.jump(ctx, true);
    ctx.player.x = 4;
    ctx.ball.x = 3;
    let worst = 0;
    let last = follow.pan;
    for (let i = 0; i < 240; i++) {
      follow.update(ctx, 1 / 60);
      worst = Math.max(worst, Math.abs(follow.pan - last));
      last = follow.pan;
    }
    // Its speed limit plus what the spring adds while it catches up.
    expect(worst).toBeLessThan((FOLLOW.panSpeed * 1.6) / 60);
    expect(follow.pan).toBeGreaterThan(0.5);
  });

  it('se abre con un globo y con una pelota al fondo, y se cierra en la red', () => {
    const follow = new Follow();
    const ctx = context();
    follow.jump(ctx, true);
    settle(follow, ctx);
    const middle = follow.zoom;

    ctx.ball.z = 5;
    settle(follow, ctx);
    const lob = follow.zoom;
    expect(lob).toBeLessThan(middle);

    ctx.ball.z = 1;
    ctx.mark = { x: 2, y: -8.5 };
    settle(follow, ctx);
    expect(follow.zoom).toBeLessThan(middle);

    ctx.mark = null;
    ctx.player.y = -3;
    settle(follow, ctx);
    expect(follow.zoom).toBeGreaterThan(middle);
  });

  it('el zoom siempre queda entre sus límites', () => {
    const follow = new Follow();
    const ctx = context();
    for (const y of [-9.5, -7, -4, -1.5]) {
      ctx.player.y = y;
      for (const z of [0.5, 3, 7]) {
        ctx.ball.z = z;
        settle(follow, ctx, 2);
        expect(follow.zoom).toBeGreaterThanOrEqual(FOLLOW.zoomMin);
        expect(follow.zoom).toBeLessThanOrEqual(FOLLOW.zoomMax);
      }
    }
  });

  it('apagada vuelve al centro, y con un salto queda quieta en el acto', () => {
    const follow = new Follow();
    const ctx = context({ player: { x: 4, y: -4, k: 1.2 } });
    follow.jump(ctx, true);
    expect(Math.abs(follow.pan)).toBeGreaterThan(0.3);
    follow.jump(ctx, false);
    expect(follow.pan).toBe(0);
    expect(follow.zoom).toBe(1);
  });
});

/** Runs real matches and looks at every frame the way the renderer would. */
function watchPlay(
  rival: RivalId,
  seed: number,
  seconds: number,
  setup: { camera?: 'follow' | 'fixed'; reduceMotion?: boolean; canFollow?: boolean; screen?: [number, number] } = {},
  each: (scene: Scene, director: Director, view: StageView, events: SimEvent[], jumped: boolean) => void,
): void {
  const config = createConfig();
  const match = new Match({
    config,
    seed,
    teams: [
      { name: 'Vos', players: [humanEntry(seed + 1, SKILLS.average)] },
      { name: CAST[rival].name, players: [aiEntry(config, rival, seed + 2)] },
    ],
  });
  const view = new StageView();
  const [vw, vh] = setup.screen ?? PHONE;
  view.resize(vw, vh);
  const director = new Director(view, texts, () => noPalette);
  director.cameraName = setup.camera ?? 'follow';
  const scene = createScene();
  const input = new InputState();
  const opts = options('minimal', { reduceMotion: setup.reduceMotion ?? false, cast: [null, CAST[rival]] });
  const events: SimEvent[] = [];
  for (let frame = 0; frame < seconds * 60 && match.phase !== 'matchOver'; frame++) {
    events.length = 0;
    for (let step = 0; step < 2; step++) {
      match.step();
      for (const event of match.events) {
        events.push(event);
        director.onEvent(event, scene);
      }
      match.events.length = 0;
    }
    fillScene(scene, match, 1, input, opts);
    const jumped = events.some((event) => event.type === 'serveReady');
    director.update(scene, 1 / 60, setup.canFollow ?? true, NO_INSETS);
    each(scene, director, view, events, jumped || frame === 0);
  }
}

describe('la cámara que acompaña, jugando de verdad contra las paredes', () => {
  const p: Projected = { x: 0, y: 0, scale: 0, squash: 0 };

  // Romina hits hard and uses the walls; Chela lobs and plays the angles; Beto feeds.
  for (const rival of ['romina', 'chela', 'beto'] as const) {
    it(`contra ${CAST[rival].name}: nada de lo que importa se va de la pantalla`, () => {
      const [vw, vh] = PHONE;
      let frames = 0;
      let live = 0;
      let lowGlass = 0;
      let worstPan = 0;
      let worstZoom = 0;
      let moved = 0;
      let lastPan = 0;
      let lastZoom = 1;
      let ballOut = 0;
      let tight = 0;
      let wallBalls = 0;
      let highBalls = 0;
      watchPlay(rival, rival.length * 7, 150, {}, (scene, director, view, events, jumped) => {
        frames++;
        const follow = director.follow;
        // Within its limits, always.
        expect(follow.zoom).toBeGreaterThanOrEqual(FOLLOW.zoomMin - 1e-9);
        expect(follow.zoom).toBeLessThanOrEqual(FOLLOW.zoomMax + 1e-9);
        expect(Math.abs(follow.pan)).toBeLessThan(3.2);
        if (!jumped) {
          worstPan = Math.max(worstPan, Math.abs(follow.pan - lastPan));
          worstZoom = Math.max(worstZoom, Math.abs(follow.zoom - lastZoom));
        }
        if (Math.abs(follow.pan - lastPan) > 1e-4) moved++;
        lastPan = follow.pan;
        lastZoom = follow.zoom;

        // The person's own player, whole, with room at the sides.
        const me = scene.players[0]!;
        const k = figureScale(me.y);
        const feet = view.project(me.x, me.y, 0, p);
        expect(feet.x).toBeGreaterThan(0);
        expect(feet.x).toBeLessThan(vw);
        if (feet.x < FOLLOW.hard || feet.x > vw - FOLLOW.hard) tight++;
        expect(feet.y).toBeLessThan(vh);
        expect(view.project(me.x, me.y, 1.9 * k, p).y).toBeGreaterThan(0);

        // The rival, whole.
        const other = scene.players[1]!;
        const head = view.project(other.x, other.y, 1.9 * figureScale(other.y), p);
        expect(head.y).toBeGreaterThan(0);
        expect(head.x).toBeGreaterThan(0);
        expect(head.x).toBeLessThan(vw);

        // The person's own back glass: its foot is on screen, above the thumbs almost always.
        const glass = view.project(0, -10, 0, p);
        expect(glass.y).toBeLessThan(vh);
        if (glass.y > vh - FOLLOW.bottom + 12) lowGlass++;
        // And two metres of floor behind the player, or as much as there is.
        expect(view.project(me.x, Math.max(-10, me.y - 2), 0, p).y).toBeLessThan(vh);

        // The ball, wherever it goes: off the glass, over the fence, up in a lob.
        const ball = scene.ball;
        if (ball.live) {
          live++;
          const at = view.project(ball.x, ball.y, ball.z, p);
          const inCourt = Math.abs(ball.x) <= 5.2 && Math.abs(ball.y) <= 10.2;
          if (inCourt && (at.x < 0 || at.x > vw || at.y < 0 || at.y > vh)) ballOut++;
          if (ball.z > 3) highBalls++;
        }
        for (const event of events) if (event.type === 'wall') wallBalls++;
      });
      expect(frames).toBeGreaterThan(3000);
      expect(live).toBeGreaterThan(1000);
      // It was a real test: balls came off the walls and went up.
      expect(wallBalls).toBeGreaterThan(10);
      expect(highBalls).toBeGreaterThan(0);
      // A ball in play inside the court is on screen.
      expect(ballOut).toBe(0);
      // The glass dips under the thumbs only for moments, while the zoom catches up.
      expect(lowGlass / frames).toBeLessThan(0.02);
      // The player is against the very edge only for an instant, while the camera catches up.
      expect(tight / frames).toBeLessThan(0.005);
      // Smooth: it never jumps from one frame to the next, and it does move.
      expect(worstPan).toBeLessThanOrEqual(FOLLOW.rescueSpeed / 60 + 0.03);
      expect(worstZoom).toBeLessThan(0.012);
      expect(moved / frames).toBeGreaterThan(0.2);
    });
  }

  it('en una pantalla corta y en una larga también entra todo', () => {
    for (const screen of [[360, 600], [412, 915]] as Array<[number, number]>) {
      const [vw, vh] = screen;
      let frames = 0;
      watchPlay('romina', 5, 60, { screen }, (scene, _director, view) => {
        frames++;
        const me = scene.players[0]!;
        const feet = view.project(me.x, me.y, 0, p);
        expect(feet.x).toBeGreaterThan(0);
        expect(feet.x).toBeLessThan(vw);
        expect(feet.y).toBeLessThan(vh);
        expect(view.project(0, -10, 0, p).y).toBeLessThan(vh);
        const other = scene.players[1]!;
        expect(view.project(other.x, other.y, 1.9 * figureScale(other.y), p).y).toBeGreaterThan(0);
      });
      expect(frames).toBeGreaterThan(1000);
    }
  });

  it('en dobles encuadra a los cuatro', () => {
    const config = createConfig();
    const match = new Match({
      config,
      seed: 31,
      teams: [
        { name: 'A', players: [aiEntry(config, 'medium', 1), aiEntry(config, 'hard', 2)] },
        { name: 'B', players: [aiEntry(config, 'medium', 3), aiEntry(config, 'easy', 4)] },
      ],
    });
    const view = new StageView();
    const [vw, vh] = PHONE;
    view.resize(vw, vh);
    const director = new Director(view, texts, () => noPalette);
    const scene = createScene();
    const input = new InputState();
    const opts = options('minimal', { cast: [null, null, null, null], acts: [null, null, null, null] });
    let frames = 0;
    let lastPan = 0;
    let worst = 0;
    let moved = 0;
    for (let frame = 0; frame < 120 * 60 && match.phase !== 'matchOver'; frame++) {
      let jumped = frame === 0;
      for (let step = 0; step < 2; step++) {
        match.step();
        for (const event of match.events) {
          if (event.type === 'serveReady') jumped = true;
          director.onEvent(event, scene);
        }
        match.events.length = 0;
      }
      fillScene(scene, match, 1, input, opts);
      director.update(scene, 1 / 60, true, NO_INSETS);
      frames++;
      expect(scene.players.length).toBe(4);
      const follow = director.follow;
      expect(follow.zoom).toBeGreaterThanOrEqual(FOLLOW.zoomMin - 1e-9);
      expect(follow.zoom).toBeLessThanOrEqual(FOLLOW.zoomMax + 1e-9);
      if (!jumped) worst = Math.max(worst, Math.abs(follow.pan - lastPan));
      if (Math.abs(follow.pan - lastPan) > 1e-4) moved++;
      lastPan = follow.pan;
      // Everybody on court is on screen, feet and head.
      for (const who of scene.players) {
        const feet = view.project(who.x, who.y, 0, p);
        expect(feet.x).toBeGreaterThan(0);
        expect(feet.x).toBeLessThan(vw);
        expect(feet.y).toBeLessThan(vh);
        expect(view.project(who.x, who.y, 1.9 * figureScale(who.y), p).y).toBeGreaterThan(0);
      }
      expect(view.project(0, -10, 0, p).y).toBeLessThan(vh);
    }
    expect(frames).toBeGreaterThan(3000);
    expect(worst).toBeLessThanOrEqual(FOLLOW.rescueSpeed / 60 + 0.03);
    expect(moved).toBeGreaterThan(0);
  });

  it('"Fija", "reducir movimiento" y el respaldo 2D: la cámara no se mueve nunca', () => {
    const reference = makeCamera(REFERENCE);
    for (const setup of [{ camera: 'fixed' as const }, { reduceMotion: true }, { canFollow: false }]) {
      let frames = 0;
      watchPlay('chela', 3, 40, setup, (_scene, director, view) => {
        frames++;
        expect(director.follow.pan).toBe(0);
        expect(director.follow.zoom).toBe(1);
        expect(view.cam.f).toBe(reference.f);
        expect(view.cam.pos).toEqual(reference.pos);
        expect(view.cam.fwd).toEqual(reference.fwd);
        expect(director.frame.skyShift).toBe(0);
      });
      expect(frames).toBeGreaterThan(1000);
    }
  });
});

describe('pantalla limpia: qué hay en cada nivel de ayuda', () => {
  /** Plays a while at a level and reports what was on screen. */
  function screenAt(level: AidLevel, more: Partial<SceneOptions> = {}, thumb: 'down' | 'up' = 'up') {
    const config = createConfig();
    const match = new Match({
      config,
      seed: 21,
      teams: [
        { name: 'Vos', players: [humanEntry(4, SKILLS.average)] },
        { name: 'Romina', players: [aiEntry(config, 'romina', 8)] },
      ],
    });
    const view = new StageView();
    view.resize(...PHONE);
    const director = new Director(view, texts, () => noPalette);
    const scene = createScene();
    const input = new InputState();
    const opts = options(level, more);
    const seen = {
      frames: 0,
      bounce: 0,
      otherBounce: 0,
      rings: 0,
      guides: 0,
      timing: 0,
      aims: 0,
      armedAims: 0,
      glow: 0,
      glowFar: 0,
      maxGlow: 0,
      maxBounceRadius: 0,
      labels: new Set<string>(),
      effects: 0,
      trail: 0,
    };
    for (let frame = 0; frame < 120 * 60 && match.phase !== 'matchOver'; frame++) {
      for (let step = 0; step < 2; step++) {
        match.step();
        for (const event of match.events) director.onEvent(event, scene);
        match.events.length = 0;
      }
      // A thumb that goes down to aim while a ball is coming, for the levels that show where.
      const me = match.players[0]!;
      const coming = match.phase === 'rally' && match.rally.live && match.rally.hitter !== me.team;
      input.aim.active = thumb === 'down' && coming;
      input.aim.aim = 0.4;
      input.aim.depth = 0.7;
      fillScene(scene, match, 1, input, opts);
      const out = director.update(scene, 1 / 60, true, NO_INSETS);
      seen.frames++;
      if (out.bounce) {
        seen.bounce++;
        seen.maxBounceRadius = Math.max(seen.maxBounceRadius, out.bounce.radius);
        if (!scene.bounce!.first || out.bounce.y > 0 || match.rally.hitter === me.team) seen.otherBounce++;
      }
      if (out.ring) seen.rings++;
      if (out.guide) seen.guides++;
      if (out.timing) seen.timing++;
      if (out.aim) {
        seen.aims++;
        if (!input.aim.active) seen.armedAims++;
      }
      if (out.ball.glow > 0) {
        seen.glow++;
        seen.maxGlow = Math.max(seen.maxGlow, out.ball.glow);
        const eta = scene.contact ? scene.contact.eta : Infinity;
        if (eta > 0.18 + 1e-6 || eta < -0.07 - 1e-6) seen.glowFar++;
      }
      if (director.label) seen.labels.add(director.label.text);
      seen.effects += out.effects.length;
      seen.trail += out.ball.trailCount;
    }
    return seen;
  }

  it('mínimas (por defecto): una sola señal de timing y el primer pique en tu lado', () => {
    const seen = screenAt('minimal');
    expect(seen.frames).toBeGreaterThan(3000);
    // No ring under the player, no footprints, no ring that closes.
    expect(seen.rings).toBe(0);
    expect(seen.guides).toBe(0);
    expect(seen.timing).toBe(0);
    // The ball lights up, and only in the last instant.
    expect(seen.glow).toBeGreaterThan(20);
    expect(seen.glowFar).toBe(0);
    expect(seen.glow / seen.frames).toBeLessThan(0.12);
    // Where it bounces: only the first bounce of a ball that comes to the person's side, and small.
    expect(seen.bounce).toBeGreaterThan(50);
    expect(seen.otherBounce).toBe(0);
    expect(seen.maxBounceRadius).toBeLessThanOrEqual(0.26 + 1e-9);
    // With the thumb up there is no aim mark, not even with a shot armed.
    expect(seen.aims).toBe(0);
  });

  it('mínimas: la marca de objetivo solo mientras el pulgar apunta', () => {
    const seen = screenAt('minimal', {}, 'down');
    expect(seen.aims).toBeGreaterThan(100);
    expect(seen.armedAims).toBe(0);
  });

  it('mínimas: solo se nombran los golpes especiales', () => {
    const seen = screenAt('minimal');
    const special = new Set(['bandeja', 'vibora', 'wallExit', '¡smash!', 'backWall']);
    for (const label of seen.labels) expect(special.has(label), label).toBe(true);
  });

  it('las ayudas mínimas se apagan a medida que la persona acierta', () => {
    const strong = screenAt('minimal', { aidStrength: 1 });
    const faint = screenAt('minimal', { aidStrength: 0.25 });
    expect(strong.maxGlow).toBeGreaterThan(0.9);
    expect(faint.maxGlow).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(faint.maxGlow).toBeGreaterThan(0.1);
  });

  it('completas: todo sigue ahí para quien lo quiera o lo necesite', () => {
    const seen = screenAt('full');
    expect(seen.rings).toBe(seen.frames);
    expect(seen.guides).toBeGreaterThan(50);
    expect(seen.timing).toBeGreaterThan(200);
    // Every bounce is marked, also after the first one and on the other side.
    expect(seen.otherBounce).toBeGreaterThan(50);
    // Every hit gets its name.
    expect(seen.labels.size).toBeGreaterThan(2);
    // The timing is the ring, not the glow: one signal at a time.
    expect(seen.glow).toBe(0);
  });

  it('ninguna: nada', () => {
    const seen = screenAt('none', {}, 'down');
    expect(seen.bounce + seen.rings + seen.guides + seen.timing + seen.aims + seen.glow).toBe(0);
    expect(seen.labels.size).toBe(0);
    // What happens in the world is still there: the sparkle of a hit, the trail of a fast ball.
    expect(seen.effects).toBeGreaterThan(0);
    expect(seen.trail).toBeGreaterThan(0);
  });

  it('con "reducir movimiento" no hay destellos ni estela', () => {
    const seen = screenAt('minimal', { reduceMotion: true });
    expect(seen.effects).toBe(0);
    expect(seen.trail).toBe(0);
  });

  it('los efectos y los nombres duran poco: no ensucian la pantalla', () => {
    expect(Math.max(...Object.values(EFFECT_SECONDS))).toBeLessThanOrEqual(0.25);
    expect(LABEL_SECONDS).toBeLessThanOrEqual(1);
  });
});
