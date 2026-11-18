import type { CourtConfig } from '../../config';
import { NO_INSETS, type Insets } from '../../core/layout';
import type { Assets } from '../../platform/types';
import type { SimEvent } from '../../sim/match';
import { FlatPainter } from '../flat/painter';
import type { Renderer, Scene, ScenePlayer } from '../scene';
import { smoothstep } from '../../core/math';
import { FigureAnimator, type Moment } from '../toon/animator';
import { parseCharacter, styleOf, type Character, type Style } from '../toon/character';
import { ToonGL } from '../toon/gl';
import type { CameraName } from '../view';
import { loadCourt, type CourtLayers } from './court-art';
import { Director, type DirectorTexts } from './director';
import type { FigureFrame } from './frame';
import { castName, paletteOf, shirtOf } from './looks';
import { StageView, type Projected } from './view';

const CHARACTER_FILE = 'art/character.bin';
/**
 * Milliseconds the very first frames wait for the court to arrive. A dark
 * screen for an instant is better than a court that changes its looks twice
 * in front of the person; after this, the game is shown with whatever is there.
 */
const GRACE_MS = 1200;
/** Seconds the ball of a serve takes to get from the hand that let it go to where it is falling. */
const HAND_BLEND = 0.18;

export interface StageOptions {
  /** False to never use the 3D look: a developer switch, and the way to measure the plain one. */
  allow3d: boolean;
}

/**
 * The renderer of the game. It draws in 3D when it can and in plain 2D when
 * it cannot, and the game never has to know which.
 *
 * It starts in 2D, because that needs nothing: a court painted by hand and
 * simple figures. The pictures of the court and the character arrive on
 * their own; when they are here and the device has WebGL2, it changes to the
 * 3D look. If the graphics context is lost (the system took the memory, the
 * tab was in the background for long) it goes back to 2D at once, and to 3D
 * again when the context comes back. Nobody is left without playing.
 *
 * Two canvases, one over the other. The one below is the 3D world. The one
 * above is the 2D one the game was given: the whole picture when there is no
 * 3D, and otherwise only what goes over the world (the thumbs, a name).
 */
export class StageRenderer implements Renderer {
  /** Milliseconds from its creation to the first frame on screen, and to the first one in 3D. For measuring. */
  readonly timings = { firstFrame: -1, first3d: -1 };
  /** Times the graphics context was lost so far. */
  losses = 0;
  onChange: (() => void) | null = null;

  private readonly view = new StageView();
  private readonly director: Director;
  private readonly painter: FlatPainter;
  /** The canvas of the 3D world, under the one the game was given. */
  private readonly world: HTMLCanvasElement;
  private toon: ToonGL | null = null;
  private court: CourtLayers | null = null;
  private character: Character | null = null;
  /** Files still on their way. */
  private pending = 2;
  private readonly animators: FigureAnimator[] = [];
  /** Who each of those animators was made for: somebody else in that place gets a new one. */
  private readonly animated: string[] = [];
  private readonly styles = new Map<string, Style>();
  private readonly moment: Moment = { rivalHitIn: Infinity, holding: false, resting: false };
  /** The ball of a serve while a hand has it, and how far from its real place it is still shown after. */
  private readonly hand = { x: 0, y: 0, z: 0, left: 0 };
  private readonly held: [number, number, number] = [0, 0, 0];
  private readonly palettes = new Map<string, Float32Array>();
  private readonly tints = new Map<string, string>();
  private readonly noPalette = new Float32Array(26 * 4);
  private width = 1;
  private height = 1;
  private ratio = 1;
  private safe: Insets = NO_INSETS;
  private readonly born = performance.now();
  private readonly p: Projected = { x: 0, y: 0, scale: 0, squash: 1 };

  constructor(
    canvas: HTMLCanvasElement,
    config: CourtConfig,
    assets: Assets,
    texts: DirectorTexts,
    private readonly options: StageOptions = { allow3d: true },
  ) {
    this.director = new Director(this.view, texts, (player) => this.paletteFor(player));
    this.painter = new FlatPainter(canvas, config, (figure) => this.tintFor(figure));

    this.world = document.createElement('canvas');
    this.world.id = 'world';
    this.world.setAttribute('aria-hidden', 'true');
    this.world.hidden = true;
    canvas.before(this.world);
    this.world.addEventListener('webglcontextlost', (event) => {
      // Saying "I will handle it" is what lets the context come back later.
      event.preventDefault();
      this.losses++;
      this.lower();
      this.onChange?.();
    });
    this.world.addEventListener('webglcontextrestored', () => {
      this.raise();
      this.onChange?.();
    });

    const settle = (): void => {
      this.pending--;
      this.raise();
      this.onChange?.();
    };
    // If the files take longer than the wait is worth, a still picture gets drawn with what there is.
    window.setTimeout(() => {
      if (this.pending > 0) this.onChange?.();
    }, GRACE_MS + 20);
    loadCourt(assets)
      .then((court) => {
        this.court = court;
        this.painter.setCourt(court);
      })
      // Without its pictures the court stays the one painted by hand.
      .catch(() => undefined)
      .then(settle);
    assets
      .bytes(CHARACTER_FILE)
      .then((buffer) => {
        this.character = parseCharacter(buffer);
        this.palettes.clear();
        this.styles.clear();
        this.tints.clear();
      })
      // Without the character the figures stay the simple ones.
      .catch(() => undefined)
      .then(settle);
  }

  /** Which look is on screen. */
  get look(): '3d' | '2d' {
    return this.toon && !this.toon.lost ? '3d' : '2d';
  }

  /** Goes up to the 3D look, if everything it needs is here. */
  private raise(): void {
    if (this.toon || !this.options.allow3d || !this.court || !this.character) return;
    try {
      this.toon = new ToonGL(this.world, this.court, this.character);
    } catch {
      // No WebGL2 on this device, a shader it cannot compile, or the context
      // went away half way: the game goes on in 2D.
      this.toon = null;
      return;
    }
    this.toon.resize(Math.max(1, Math.round(this.width * this.ratio)), Math.max(1, Math.round(this.height * this.ratio)));
    this.world.hidden = false;
    for (const animator of this.animators) animator.reset();
  }

  /** Back down to 2D. Everything the lost context held is gone with it. */
  private lower(): void {
    this.toon = null;
    this.world.hidden = true;
  }

  /** What is one of the cast's own, from the character file. */
  private styleFor(character: Character, name: string): Style {
    let style = this.styles.get(name);
    if (!style) {
      style = styleOf(character, name);
      this.styles.set(name, style);
    }
    return style;
  }

  private paletteFor(player: ScenePlayer): Float32Array {
    const character = this.character;
    if (!character) return this.noPalette;
    const name = castName(player.character);
    let palette = this.palettes.get(name);
    if (!palette) {
      palette = paletteOf(character, this.styleFor(character, name));
      this.palettes.set(name, palette);
    }
    return palette;
  }

  /** The colour of the simple figure of a player: its shirt. */
  private tintFor(figure: FigureFrame): string {
    const name = castName(figure.player.character);
    let tint = this.tints.get(name);
    if (!tint) {
      const [r, g, b] = shirtOf(this.character, name);
      tint = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
      this.tints.set(name, tint);
    }
    return tint;
  }

  // ---------------------------------------------------------------- Renderer

  resize(width: number, height: number, pixelRatio: number, safeArea: Insets): void {
    this.width = width;
    this.height = height;
    this.ratio = pixelRatio;
    this.safe = safeArea;
    this.view.resize(width, height);
    this.painter.resize(width, height, pixelRatio, safeArea);
    this.toon?.resize(Math.max(1, Math.round(width * pixelRatio)), Math.max(1, Math.round(height * pixelRatio)));
  }

  setCamera(name: CameraName): void {
    this.director.cameraName = name;
  }

  project(x: number, y: number, z: number, out: { x: number; y: number }): void {
    const p = this.view.project(x, y, z, this.p);
    out.x = p.x;
    out.y = p.y;
  }

  onEvent(event: SimEvent, scene: Scene): void {
    this.director.onEvent(event, scene);
    // Whoever won the point is glad and whoever lost it is not, for the moment the pause lasts.
    if (event.type === 'point') {
      for (let i = 0; i < scene.players.length; i++) {
        if (scene.players[i]!.team === event.winner) this.animators[i]?.cheer();
        else this.animators[i]?.lament();
      }
    }
  }

  reset(): void {
    this.director.reset();
    for (const animator of this.animators) animator.reset();
  }

  render(scene: Scene, dt: number): void {
    // A context can be lost a moment before the event that says so arrives.
    const toon = this.toon && !this.toon.lost ? this.toon : null;
    const character = this.character;
    const frame = this.director.update(scene, dt, toon !== null, this.safe);
    const now = performance.now() - this.born;

    if (this.pending > 0 && now < GRACE_MS) {
      this.painter.blank();
      return;
    }

    if (toon && character) {
      const figures = frame.figures;
      const moment = this.moment;
      const serving = scene.ball.held ? scene.serving : -1;
      moment.resting = !scene.ball.live && scene.serving < 0;
      for (let i = 0; i < figures.length; i++) {
        const figure = figures[i]!;
        const who = figure.player;
        const name = castName(who.character);
        let animator = this.animators[i];
        if (!animator || this.animated[i] !== name) {
          animator = new FigureAnimator(character, this.styleFor(character, name));
          this.animators[i] = animator;
          this.animated[i] = name;
        }
        const style = animator.style;
        // Some of the cast are smaller than the rest.
        figure.k *= style?.size ?? 1;
        figure.parts = style?.parts ?? null;
        // When the other side is about to hit: whoever is waiting takes its little hop.
        moment.rivalHitIn = Infinity;
        for (const other of scene.players) {
          if (other.team !== who.team && other.anim !== 'idle' && other.contactIn > 0) moment.rivalHitIn = Math.min(moment.rivalHitIn, other.contactIn);
        }
        moment.holding = serving === i;
        animator.update(who, figure.k, figure.facing, frame.ball, dt, moment);
        figure.x = animator.x;
        figure.y = animator.y;
        figure.bones = animator.bones;
      }
      // Before a serve the ball is in the server's hand; let go, it slides to where it really is.
      const hand = this.hand;
      const ball = frame.ball;
      const server = figures[serving];
      if (server && this.animators[serving]!.ballInHand(server.k, server.facing, this.held)) {
        hand.x = this.held[0] - ball.x;
        hand.y = this.held[1] - ball.y;
        hand.z = this.held[2] - ball.z;
        hand.left = HAND_BLEND;
      } else if (hand.left > 0) {
        hand.left = Math.max(0, hand.left - dt);
      }
      if (hand.left > 0) {
        const w = smoothstep(0, 1, hand.left / HAND_BLEND);
        ball.x += hand.x * w;
        ball.y += hand.y * w;
        ball.z += hand.z * w;
      }
      this.painter.clear();
      toon.draw(frame);
      if (this.timings.first3d < 0) this.timings.first3d = now;
    } else {
      for (const figure of frame.figures) {
        figure.bones = null;
        figure.parts = null;
      }
      this.painter.world(frame);
    }
    this.painter.overlay(frame, scene, this.director.label, dt);
    if (this.timings.firstFrame < 0) this.timings.firstFrame = now;
  }
}
