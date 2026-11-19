import { CONTROLS, type CourtConfig } from '../../config';
import { clamp, easeOutCubic, lerp, TAU } from '../../core/math';
import type { Insets } from '../../core/layout';
import type { Scene } from '../scene';
import { NEAR_WALL_ALPHA, type CourtLayer, type CourtLayers } from '../stage/court-art';
import { LABEL_SECONDS, type LabelFrame } from '../stage/director';
import { ballBehind, type EffectFrame, type FigureFrame, type MarkFrame, type StageFrame } from '../stage/frame';
import type { Projected } from '../stage/view';
import { paintCourtBack, paintCourtFront, paintNet } from './court';
import { drawFigure } from './figure';
import { FONT, PAL } from './palette';

/** A piece of text painted once into its own small bitmap. Sizes are in CSS pixels. */
interface Label {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Seconds before the contact at which the timing ring starts closing (for those who ask for every aid). */
const RING_LEAD = 0.9;
/** Seconds one loop of the ghost hand lasts. */
const GHOST_LOOP = 2;
/** Where the ghost thumb goes when the gesture is no shot in particular: with two thumbs, and with a flick. */
const PLAIN_DRAG = { x: 16, y: -44 };
const PLAIN_FLICK = { x: 0, y: -78 };

/**
 * Everything drawn with Canvas 2D, on the canvas that sits on top.
 *
 * It does two jobs. When there is no 3D (no WebGL2, the context was lost, or
 * the character has not arrived yet) it draws the whole game: the court from
 * its baked pictures, or painted by hand until they arrive, and simple
 * figures. Nobody is left without playing. And always, in either look, it
 * draws what goes over the world: the thumbs, the first-time ghost hand, the
 * name of a special shot and the extra aids of those who ask for all of them.
 *
 * In 2D the camera does not move: the court is the baked pictures as they
 * were rendered.
 */
export class FlatPainter {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly background: HTMLCanvasElement;
  private backgroundKey = '';
  private court: CourtLayers | null = null;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private clock = 0;
  private dirty = true;
  private readonly labels = new Map<string, Label>();
  private readonly p: Projected = { x: 0, y: 0, scale: 0, squash: 1 };
  private readonly q: Projected = { x: 0, y: 0, scale: 0, squash: 1 };
  private readonly order: FigureFrame[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly config: CourtConfig,
    /** The main colour of a player, as CSS, for its simple figure. */
    private readonly tintFor: (figure: FigureFrame) => string,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.background = document.createElement('canvas');
  }

  resize(width: number, height: number, ratio: number, safe: Insets): void {
    this.width = width;
    this.height = height;
    this.ratio = ratio;
    this.safe = { ...safe };
    this.backgroundKey = '';
    // Labels were painted for the old pixel density.
    this.labels.clear();
    this.dirty = true;
  }

  /** The pictures of the court have arrived (or are gone). */
  setCourt(court: CourtLayers | null): void {
    this.court = court;
    this.backgroundKey = '';
  }

  // ---------------------------------------------------------------- the world, in 2D

  /** Draws a picture of the court where it goes. The context has to be in design pixels. */
  private layer(ctx: CanvasRenderingContext2D, layer: CourtLayer, alpha = 1): void {
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(layer.image, layer.dx, layer.dy, layer.dw, layer.dh);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  /** Puts a context in design pixels: the frame the court was composed for, wherever it falls on this screen. */
  private design(ctx: CanvasRenderingContext2D, frame: StageFrame): void {
    const lay = frame.view.lay;
    const k = lay.s * this.ratio;
    ctx.setTransform(k, 0, 0, k, lay.ox * this.ratio, lay.oy * this.ratio);
  }

  /** Everything behind the players. It never changes, so it is composed once and copied after that. */
  private drawBackground(frame: StageFrame): void {
    const key = `${this.width}x${this.height}@${this.ratio}:${this.court ? 'art' : 'plain'}`;
    const cache = this.background;
    if (key !== this.backgroundKey) {
      this.backgroundKey = key;
      cache.width = Math.max(1, Math.round(this.width * this.ratio));
      cache.height = Math.max(1, Math.round(this.height * this.ratio));
      const ctx = cache.getContext('2d', { alpha: false });
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = PAL.background;
      ctx.fillRect(0, 0, cache.width, cache.height);
      if (this.court) {
        this.design(ctx, frame);
        this.layer(ctx, this.court.cielo);
        this.layer(ctx, this.court.piso);
        this.layer(ctx, this.court.entorno);
        this.layer(ctx, this.court.paredes);
      } else {
        ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
        paintCourtBack(ctx, frame.view, this.config, this.width, this.height);
      }
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(cache, 0, 0);
  }

  /** A thin ring with a dot, lying on the floor. */
  private drawMark(mark: MarkFrame, frame: StageFrame): void {
    const ctx = this.ctx;
    const p = frame.view.project(mark.x, mark.y, 0, this.p);
    const colour = mark.tone === 'coral' ? PAL.coral : PAL.cream;
    const radius = Math.max(5, mark.radius * p.scale);
    if (mark.halo > 0) {
      const spread = radius * (1.5 + mark.halo * 1.7);
      ctx.globalAlpha = 0.14 * mark.alpha;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, spread, spread * p.squash, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = mark.alpha;
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = Math.max(1.25, radius * 0.14);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, radius, radius * p.squash, 0, 0, TAU);
    ctx.stroke();
    if (mark.double) {
      ctx.lineWidth = Math.max(1, radius * 0.09);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius * 1.5, radius * 1.5 * p.squash, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, radius * 0.2, radius * 0.2 * p.squash, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawEffect(effect: EffectFrame, frame: StageFrame): void {
    const ctx = this.ctx;
    const u = effect.age;
    ctx.strokeStyle = PAL.cream;
    ctx.fillStyle = PAL.cream;
    if (effect.kind === 'bounce') {
      const p = frame.view.project(effect.x, effect.y, 0, this.p);
      const radius = (0.14 + 0.3 * u) * p.scale;
      ctx.globalAlpha = 0.35 * (1 - u);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius, radius * p.squash, 0, 0, TAU);
      ctx.fill();
    } else if (effect.kind === 'glass') {
      const p = frame.view.project(effect.x, effect.y, effect.z, this.p);
      ctx.globalAlpha = 0.4 * (1 - u);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, (0.3 + 0.2 * u) * p.scale, (0.45 + 0.25 * u) * p.scale, 0, 0, TAU);
      ctx.fill();
    } else {
      // A four-pointed sparkle.
      const p = frame.view.project(effect.x, effect.y, effect.z, this.p);
      const reach = (0.3 + 0.22 * u) * p.scale * (effect.strong ? 1.35 : 1);
      ctx.globalAlpha = (1 - u) * (1 - u);
      ctx.lineWidth = Math.max(1.5, reach * 0.16);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x - reach, p.y);
      ctx.lineTo(p.x + reach, p.y);
      ctx.moveTo(p.x, p.y - reach);
      ctx.lineTo(p.x, p.y + reach);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawBall(frame: StageFrame): void {
    const ball = frame.ball;
    if (!ball.visible) return;
    const ctx = this.ctx;
    const p = frame.view.project(ball.x, ball.y, ball.z, this.p);
    const radius = Math.max(3.3, 0.085 * p.scale);
    if (ball.trailCount > 0) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = PAL.ball;
      let fromX = p.x;
      let fromY = p.y;
      for (let i = 0; i < ball.trailCount; i++) {
        const t = frame.view.project(ball.trail[i * 3]!, ball.trail[i * 3 + 1]!, ball.trail[i * 3 + 2]!, this.q);
        const k = 1 - (i + 1) / (ball.trailCount + 1);
        ctx.globalAlpha = k * 0.4;
        ctx.lineWidth = radius * 2 * (0.35 + k * 0.5);
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        fromX = t.x;
        fromY = t.y;
      }
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius + 1, 0, TAU);
    ctx.fillStyle = PAL.ballEdge;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.fillStyle = PAL.ball;
    ctx.fill();
  }

  private drawFigure(figure: FigureFrame, frame: StageFrame): void {
    const player = figure.player;
    const p = frame.view.project(figure.x, figure.y, 0, this.p);
    const scale = p.scale * figure.k;
    // Where the ball of this stroke is met, in the metres of the drawn figure.
    const ball = frame.view.project(player.x + player.reachX, player.y + player.reachY, player.reachZ, this.q);
    drawFigure(this.ctx, p.x, p.y, scale, player, (ball.x - p.x) / scale, (p.y - ball.y) / scale, player.reachZ / figure.k, this.tintFor(figure), PAL.ink);
  }

  /** One side of the net, from the far end toward the camera, with the ball in its place among the players. */
  private drawSide(frame: StageFrame, near: boolean): void {
    const ball = frame.ball;
    let ballDrawn = !(ball.visible && (near ? ball.y <= 0 : ball.y > 0));
    const order = this.order;
    order.length = 0;
    for (const figure of frame.figures) {
      if ((figure.y <= 0) !== near) continue;
      let at = order.length;
      while (at > 0 && order[at - 1]!.y < figure.y) at--;
      order.splice(at, 0, figure);
    }
    for (const figure of order) {
      if (!ballDrawn && ballBehind(ball.y, figure)) {
        this.drawBall(frame);
        ballDrawn = true;
      }
      this.drawFigure(figure, frame);
    }
    if (!ballDrawn) this.drawBall(frame);
  }

  /** The whole frame in 2D. The camera has to be the one the court was rendered from. */
  world(frame: StageFrame): void {
    const ctx = this.ctx;
    const view = frame.view;
    const court = this.court;
    this.drawBackground(frame);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);

    // On the floor: marks, dust and every shadow.
    if (frame.aim) this.drawMark(frame.aim, frame);
    if (frame.bounce) this.drawMark(frame.bounce, frame);
    for (const effect of frame.effects) if (effect.kind === 'bounce') this.drawEffect(effect, frame);
    this.drawExtras(frame);
    ctx.fillStyle = PAL.shadow;
    for (const figure of frame.figures) {
      const p = view.project(figure.x, figure.y, 0, this.p);
      const radius = 0.38 * p.scale * figure.k;
      ctx.beginPath();
      ctx.ellipse(p.x + radius * 0.5, p.y + radius * 0.25, radius * 1.3, radius * p.squash * 0.9, -0.5, 0, TAU);
      ctx.fill();
    }
    const ball = frame.ball;
    if (ball.visible) {
      // The shadow is what tells how high the ball is.
      const p = view.project(ball.x, ball.y, 0, this.p);
      const radius = Math.max(2.5, 0.14 * p.scale);
      ctx.globalAlpha = 1 - clamp(ball.z / 9, 0, 0.55);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius * 1.3, radius * p.squash, -0.5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    this.drawSide(frame, false);
    if (court) {
      this.design(ctx, frame);
      this.layer(ctx, court.red);
      ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    } else {
      paintNet(ctx, view, this.config);
    }
    this.drawSide(frame, true);
    for (const effect of frame.effects) if (effect.kind !== 'bounce') this.drawEffect(effect, frame);

    // The one timing signal: the ball lights up.
    if (ball.glow > 0 && ball.visible) {
      const p = view.project(ball.x, ball.y, ball.z, this.p);
      const radius = Math.max(3.3, 0.085 * p.scale) * (2 + 1.2 * ball.glow);
      ctx.globalAlpha = 0.5 * ball.glow;
      ctx.fillStyle = PAL.cream;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (court) {
      this.design(ctx, frame);
      this.layer(ctx, court.cerca, NEAR_WALL_ALPHA);
      this.layer(ctx, court.frente);
      ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    } else {
      paintCourtFront(ctx, view, this.config);
    }
    this.dirty = true;
  }

  /** For those who ask for every aid: the ring under their player and where it would be best to stand. */
  private drawExtras(frame: StageFrame): void {
    const ctx = this.ctx;
    const view = frame.view;
    if (frame.ring) {
      const p = view.project(frame.ring.x, frame.ring.y, 0, this.p);
      const radius = 0.58 * p.scale * frame.ring.k;
      ctx.strokeStyle = PAL.aidSoft;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius, radius * p.squash, 0, 0, TAU);
      ctx.stroke();
    }
    if (frame.guide) {
      const p = view.project(frame.guide.x, frame.guide.y, 0, this.p);
      const foot = Math.max(3, 0.13 * p.scale);
      ctx.fillStyle = PAL.aid;
      ctx.globalAlpha = 0.5;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(p.x + side * foot * 1.25, p.y, foot * 0.8, foot * 1.5 * p.squash, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- over the world

  /** Nothing to show yet: the dusk, and nothing else. */
  blank(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAL.background;
    ctx.fillRect(0, 0, Math.round(this.width * this.ratio) + 1, Math.round(this.height * this.ratio) + 1);
    this.dirty = true;
  }

  /** Wipes the canvas: it sits over the 3D and has to let it show. */
  clear(): void {
    if (!this.dirty) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, Math.round(this.width * this.ratio) + 1, Math.round(this.height * this.ratio) + 1);
    this.dirty = false;
  }

  /** What goes over the world in either look. */
  overlay(frame: StageFrame, scene: Scene, label: LabelFrame | null, dt: number): void {
    this.clock += dt;
    const ctx = this.ctx;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);

    // For those who ask for every aid: the ring that closes on the contact.
    if (frame.timing && frame.timing.eta <= RING_LEAD) this.drawTimingRing(frame);
    if (label) this.drawLabel(label, frame, scene);
    this.drawPointer(scene, scene.aids === 'full');
    this.drawTutorial(scene);
  }

  /** A ring closes on the spot where the ball will be hit, and meets the fixed ring at the ideal moment. */
  private drawTimingRing(frame: StageFrame): void {
    const timing = frame.timing;
    if (!timing) return;
    const ctx = this.ctx;
    const p = frame.view.project(timing.x, timing.y, timing.z, this.p);
    const base = Math.max(12, 0.44 * p.scale);
    const floor = frame.view.project(timing.x, timing.y, 0, this.q);
    ctx.strokeStyle = PAL.aidSoft;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + base);
    ctx.lineTo(floor.x, floor.y);
    ctx.stroke();

    // The band the closing ring has to be in for a good hit.
    const goodOuter = base * (1 + 2.3 * (timing.good / RING_LEAD));
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = PAL.aid;
    ctx.lineWidth = goodOuter - base * 0.8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (goodOuter + base * 0.8) / 2, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, base, 0, TAU);
    ctx.stroke();

    let radius: number;
    let alpha: number;
    if (timing.eta >= 0) {
      const k = timing.eta / RING_LEAD;
      radius = base * (1 + 2.3 * k);
      alpha = 1 - k * 0.7;
    } else {
      const k = clamp(-timing.eta / 0.22, 0, 1);
      radius = base * (1 - 0.45 * k);
      alpha = 1 - k * 0.8;
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
    this.dirty = true;
  }

  /** The bitmap of a name in its pill, painted the first time it is asked for. */
  private pill(text: string, strong: boolean): Label {
    const key = `${strong ? 's' : 'n'} ${text}`;
    const cached = this.labels.get(key);
    if (cached) return cached;
    // Numbers in debug labels would otherwise pile up without limit.
    if (this.labels.size > 48) this.labels.clear();

    const size = strong ? 15 : 13;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    const font = `800 ${size}px ${FONT}`;
    ctx.font = font;
    const padX = 10;
    const width = Math.ceil(ctx.measureText(text).width) + padX * 2;
    const height = size + 13;
    canvas.width = Math.ceil(width * this.ratio);
    canvas.height = Math.ceil((height + 3) * this.ratio);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    // A flat shadow under the pill, then the pill.
    ctx.fillStyle = 'rgba(42, 27, 46, 0.25)';
    ctx.beginPath();
    ctx.roundRect(0, 3, width, height, height / 2);
    ctx.fill();
    ctx.fillStyle = strong ? PAL.mustard : PAL.cream;
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, height / 2);
    ctx.fill();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PAL.ink;
    ctx.fillText(text, width / 2, height / 2 + 1);

    const label: Label = { canvas, width, height: height + 3 };
    this.labels.set(key, label);
    return label;
  }

  /** The name of a shot, over whoever played it, for a moment. */
  private drawLabel(label: LabelFrame, frame: StageFrame, scene: Scene): void {
    const figure = frame.figures[label.player];
    if (!figure) return;
    const text = label.title ? `${label.title} · ${label.text}` : label.text;
    const pill = this.pill(text, label.strong);
    const p = frame.view.project(figure.x, figure.y, 2.05 * figure.k, this.p);
    const t = label.age / LABEL_SECONDS;
    // In with a small pop, out with a fade. Still when motion is reduced.
    const pop = scene.reduceMotion ? 1 : t < 0.12 ? lerp(0.86, 1.04, t / 0.12) : t < 0.22 ? lerp(1.04, 1, (t - 0.12) / 0.1) : 1;
    const rise = scene.reduceMotion ? 0 : easeOutCubic(t) * 6;
    const ctx = this.ctx;
    ctx.globalAlpha = t < 0.12 ? t / 0.12 : t > 0.82 ? 1 - (t - 0.82) / 0.18 : 1;
    const width = pill.width * pop;
    const height = pill.height * pop;
    const left = clamp(p.x - width / 2, 4, this.width - width - 4);
    ctx.drawImage(pill.canvas, left, p.y - 6 - rise - height, width, height);
    ctx.globalAlpha = 1;
    this.dirty = true;
  }

  /**
   * The thumbs: the stroke of the one that aims or flicks, and the stick.
   * `pad` also draws how far the aiming thumb can go, for those who ask for every aid.
   */
  private drawPointer(scene: Scene, pad: boolean): void {
    const ctx = this.ctx;
    const { stroke, stick } = scene.pointer;

    const sinceRelease = stroke.releasedAt > 0 ? (performance.now() - stroke.releasedAt) / 220 : 0;
    if (stroke.active || (stroke.releasedAt > 0 && sinceRelease < 1)) {
      const dx = stroke.x1 - stroke.x0;
      const dy = stroke.y1 - stroke.y0;
      const length = Math.hypot(dx, dy);
      const alpha = stroke.active ? 0.5 : 0.5 * (1 - sinceRelease);
      ctx.strokeStyle = PAL.aid;
      ctx.fillStyle = PAL.aid;
      ctx.lineCap = 'round';
      if (stroke.active && pad) {
        // The pad the thumb is aiming on.
        ctx.globalAlpha = 0.16;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(stroke.x0, stroke.y0, CONTROLS.aimRadius, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(stroke.x0, stroke.y0, 7, 0, TAU);
      ctx.fill();
      if (length > 6) {
        ctx.beginPath();
        ctx.moveTo(stroke.x0, stroke.y0);
        ctx.lineTo(stroke.x1, stroke.y1);
        ctx.stroke();
        const ux = dx / length;
        const uy = dy / length;
        ctx.beginPath();
        ctx.moveTo(stroke.x1 + ux * 12, stroke.y1 + uy * 12);
        ctx.lineTo(stroke.x1 - uy * 9, stroke.y1 + ux * 9);
        ctx.lineTo(stroke.x1 + uy * 9, stroke.y1 - ux * 9);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.dirty = true;
    }

    if (stick.active) {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = PAL.aid;
      ctx.beginPath();
      ctx.arc(stick.cx, stick.cy, stick.radius, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(stick.cx + stick.dx, stick.cy + stick.dy, stick.radius * 0.45, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      this.dirty = true;
    }
  }

  /**
   * Ghost thumbs show a gesture, with no words: the first visit (until the
   * first hit that comes off), a lesson, or a shot worth trying.
   */
  private drawTutorial(scene: Scene): void {
    const tutorial = scene.tutorial;
    if (!tutorial) return;
    this.dirty = true;
    const { stroke, stick } = scene.pointer;
    const y = this.height - this.safe.bottom - this.height * 0.13;
    const t = scene.reduceMotion ? 0.55 : (this.clock % GHOST_LOOP) / GHOST_LOOP;
    const stickX = this.width * (tutorial.stickSide === 'left' ? 0.26 : 0.74);
    const aimX = this.width * (tutorial.stickSide === 'left' ? 0.74 : 0.26);

    const push = tutorial.push;
    if (tutorial.scheme === 'two') {
      if (!stick.active && push) {
        // The stick thumb, pushing one way and easing off.
        const lean = 14 + 10 * Math.sin(t * Math.PI);
        this.ghostStick(stickX, y, push.x * lean, push.y * lean);
      } else if (!stick.active && tutorial.step === 'play') {
        // The stick thumb: pressed, circling around its centre.
        const angle = t * TAU;
        this.ghostStick(stickX, y, Math.cos(angle) * 20, Math.sin(angle) * 20);
      }
      if (!stroke.active) {
        // The aiming thumb: press, drag, hold, let go. How far and which way it drags is the shot.
        const to = tutorial.drag ?? PLAIN_DRAG;
        const drag = easeOutCubic(clamp((t - 0.15) / 0.3, 0, 1));
        const pressed = t > 0.08 && t < 0.72;
        const x = aimX + drag * to.x;
        const fingerY = y + drag * to.y;
        this.ghostPath(aimX, y, x, fingerY);
        this.ghostFinger(x, fingerY, pressed, t >= 0.72 ? (t - 0.72) / 0.28 : -1);
      }
      return;
    }

    // One hand.
    if (stroke.active || stick.active) return;
    const x = this.width * 0.5;
    if (tutorial.step === 'play' && t < 0.5) {
      // A slow drag is the stick...
      const k = t / 0.5;
      if (push) this.ghostStick(x, y, push.x * 26 * k, push.y * 26 * k);
      else this.ghostStick(x, y, Math.sin(k * Math.PI) * 26, -k * 18);
      return;
    }
    // ...and a quick stroke is the shot: its length and its direction say which.
    const to = tutorial.drag ?? PLAIN_FLICK;
    const start = tutorial.step === 'play' ? 0.6 : 0.2;
    const k = clamp((t - start) / 0.12, 0, 1);
    const reach = easeOutCubic(k);
    const fingerX = x + reach * to.x;
    const fingerY = y + reach * to.y;
    if (t >= start - 0.1) {
      this.ghostPath(x, y, fingerX, fingerY);
      this.ghostFinger(fingerX, fingerY, k < 1, k >= 1 ? clamp((t - start - 0.12) / 0.2, 0, 1) : -1);
    }
  }

  private ghostFinger(x: number, y: number, pressed: boolean, released: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.aid;
    ctx.strokeStyle = PAL.aid;
    if (released >= 0) {
      // Letting go: a ring opens up where the thumb was.
      if (released >= 1) return;
      ctx.globalAlpha = (1 - released) * 0.7;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, lerp(16, 34, released), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.globalAlpha = pressed ? 0.42 : 0.2;
    ctx.beginPath();
    ctx.arc(x, y, pressed ? 15 : 19, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, pressed ? 15 : 19, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private ghostPath(x0: number, y0: number, x1: number, y1: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = PAL.aid;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private ghostStick(x: number, y: number, dx: number, dy: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.aid;
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.arc(x, y, CONTROLS.stickRadius, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    this.ghostFinger(x + dx, y + dy, true, -1);
  }
}
