import { CONTROLS, type CourtConfig } from '../../config';
import { clamp, easeOutCubic, lerp, TAU } from '../../core/math';
import type { SimEvent } from '../../sim/match';
import { shotName, TEXT } from '../../ui/text';
import { Camera, type Projected } from '../camera';
import type { Insets } from '../../core/layout';
import type { Renderer, Scene, ScenePlayer } from '../scene';
import { VIEW, type CameraName } from '../view';
import { drawCourtBack, drawCourtFront, drawNet } from './court';
import { drawFigure } from './figure';
import { FONT, PAL } from './palette';

interface Effect {
  kind: 'floorRing' | 'airRing' | 'burst';
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  size: number;
}

interface DrawItem {
  /** 0 = player, 1 = ball, 2 = net. */
  kind: number;
  index: number;
  y: number;
}

/** A piece of text painted once into its own small bitmap. Sizes are in CSS pixels. */
interface Label {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

const TRAIL_LENGTH = 7;
/** Seconds before the contact at which the timing ring starts closing. */
const RING_LEAD = 0.9;
/** Seconds one loop of the first-time ghost hand lasts. */
const GHOST_LOOP = 2;

/**
 * Grey-box renderer: simple shapes, readable at phone size, cheap to draw.
 *
 * The court never changes, so it is painted once into an offscreen layer and
 * each frame starts by copying it. On top go, back to front: marks on the
 * floor, shadows, the far players, the net, the near players, the edges of the
 * near wall and finally the aids and messages.
 *
 * Text is slow to draw on a canvas, so every label is painted once into a
 * small bitmap and copied from there.
 */
export class PrototypeRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly camera = new Camera();
  private readonly back: HTMLCanvasElement;
  private readonly backCtx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private safe: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private cameraName: CameraName = 'mid';
  private clock = 0;

  private readonly effects: Effect[] = [];
  private readonly items: DrawItem[] = [];
  private readonly trail = new Float32Array(TRAIL_LENGTH * 2);
  private trailCount = 0;
  private readonly p: Projected = { x: 0, y: 0, scale: 0 };
  private readonly q: Projected = { x: 0, y: 0, scale: 0 };

  private readonly labels = new Map<string, Label>();
  /** The message over the player: how the shot was timed, and its name. */
  private readonly message = {
    active: false,
    x: 0,
    y: 0,
    age: 0,
    life: 0.9,
    title: null as Label | null,
    detail: null as Label | null,
  };

  constructor(
    canvas: HTMLCanvasElement,
    private readonly court: CourtConfig,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    this.back = document.createElement('canvas');
    const backCtx = this.back.getContext('2d', { alpha: false });
    if (!ctx || !backCtx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.backCtx = backCtx;
  }

  setCamera(name: CameraName): void {
    if (name === this.cameraName) return;
    this.cameraName = name;
    this.rebuild();
  }

  resize(width: number, height: number, pixelRatio: number, safeArea: Insets): void {
    this.width = width;
    this.height = height;
    this.ratio = pixelRatio;
    this.safe = { ...safeArea };
    this.rebuild();
  }

  reset(): void {
    this.effects.length = 0;
    this.trailCount = 0;
    this.message.active = false;
  }

  /** Fits the camera to the viewport and repaints the cached court. */
  private rebuild(): void {
    // The court keeps clear of the scoreboard on top, of the thumbs at the
    // bottom and of whatever the device reserves around the screen.
    this.camera.fit(VIEW.cameras[this.cameraName], this.court, this.width, this.height, {
      top: VIEW.insetTop + this.safe.top,
      bottom: this.height * VIEW.insetBottomFraction + this.safe.bottom,
      side: VIEW.insetSide + Math.max(this.safe.left, this.safe.right),
      align: VIEW.align,
    });
    this.back.width = Math.max(1, Math.round(this.width * this.ratio));
    this.back.height = Math.max(1, Math.round(this.height * this.ratio));
    this.backCtx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    drawCourtBack(this.backCtx, this.camera, this.court, this.width, this.height);
    this.trailCount = 0;
    // Labels were painted for the old pixel density.
    this.labels.clear();
    this.message.active = false;
  }

  // ---------------------------------------------------------------- events

  onEvent(event: SimEvent, scene: Scene): void {
    switch (event.type) {
      case 'bounce':
        this.spawn('floorRing', event.x, event.y, 0, 0.36, 0.35 + clamp(event.speed / 14, 0, 1) * 0.5);
        break;
      case 'wall':
        this.spawn('airRing', event.x, event.y, event.z, 0.34, event.surface === 'glass' ? 0.5 : 0.3);
        break;
      case 'net':
        this.spawn('airRing', event.x, 0, event.z, 0.3, 0.35);
        break;
      case 'hit': {
        this.spawn('burst', event.x, event.y, event.z, 0.2, event.quality === 'perfect' ? 0.7 : 0.4);
        const player = scene.players[event.player];
        if (player?.isHuman && event.kind !== 'serve') {
          // How well it was timed, and which shot came out of it. With the
          // debug display on, also by how many milliseconds it was off.
          let detail = shotName(event.kind, event.forehand, event.volley);
          if (scene.debug) {
            const ms = Math.round(event.error * 1000);
            detail += ` · ${ms > 0 ? '+' : ''}${ms} ms`;
          }
          this.say(TEXT.quality[event.quality], detail, player.x, player.y, event.quality === 'perfect');
        }
        break;
      }
      case 'whiff': {
        const player = scene.players[event.player];
        if (player?.isHuman && event.reason === 'far') this.say(TEXT.whiffFar, '', player.x, player.y, false);
        break;
      }
      default:
        break;
    }
  }

  private spawn(kind: Effect['kind'], x: number, y: number, z: number, life: number, size: number): void {
    this.effects.push({ kind, x, y, z, age: 0, life, size });
  }

  /** Shows a message over a player. One at a time: a new one replaces the old. */
  private say(title: string, detail: string, x: number, y: number, strong: boolean): void {
    const message = this.message;
    message.active = true;
    message.x = x;
    message.y = y;
    message.age = 0;
    message.title = this.label(title, strong ? 22 : 18, 800);
    message.detail = detail ? this.label(detail, 13, 700) : null;
  }

  /** The bitmap of a piece of text, painted the first time it is asked for. */
  private label(text: string, size: number, weight: number): Label {
    const key = `${weight} ${size} ${text}`;
    const cached = this.labels.get(key);
    if (cached) return cached;
    // Numbers in debug labels would otherwise pile up without limit.
    if (this.labels.size > 48) this.labels.clear();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    const font = `${weight} ${size}px ${FONT}`;
    ctx.font = font;
    const pad = 5;
    const width = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const height = Math.ceil(size * 1.3) + pad * 2;
    canvas.width = Math.ceil(width * this.ratio);
    canvas.height = Math.ceil(height * this.ratio);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size * 0.24);
    ctx.strokeStyle = PAL.textEdge;
    ctx.strokeText(text, width / 2, height / 2);
    ctx.fillStyle = PAL.text;
    ctx.fillText(text, width / 2, height / 2);

    const label: Label = { canvas, width, height };
    this.labels.set(key, label);
    return label;
  }

  /** Copies a label centred on (x, y), kept inside the screen. */
  private stamp(label: Label, x: number, y: number): void {
    const left = clamp(x - label.width / 2, 2, this.width - label.width - 2);
    this.ctx.drawImage(label.canvas, left, y - label.height / 2, label.width, label.height);
  }

  // ---------------------------------------------------------------- frame

  render(scene: Scene, dt: number): void {
    this.clock += dt;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.back, 0, 0);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]!;
      effect.age += dt;
      if (effect.age >= effect.life) this.effects.splice(i, 1);
    }
    if (this.message.active) {
      this.message.age += dt;
      if (this.message.age >= this.message.life) this.message.active = false;
    }

    this.drawFloor(scene);
    this.drawEntities(scene);
    drawCourtFront(ctx, this.camera, this.court);
    this.drawContact(scene);
    this.drawOverlays(scene);
    this.drawPointer(scene);
    this.drawTutorial(scene);
  }

  /** Marks painted on the floor: aids, bounce rings and every shadow. */
  private drawFloor(scene: Scene): void {
    const ctx = this.ctx;
    const camera = this.camera;
    const p = this.p;
    const squash = camera.floorSquash;

    const bounce = scene.bounce;
    if (bounce) {
      // The first landing is a dashed ring with a cross. Once the ball has
      // bounced, the mark follows it (off the walls too) as a smaller, plain
      // ring: where it must not be allowed to land again.
      camera.project(bounce.x, bounce.y, 0, p);
      const radius = Math.max(7, (bounce.first ? 0.4 : 0.3) * p.scale);
      ctx.strokeStyle = PAL.aid;
      ctx.globalAlpha = bounce.first ? 1 : 0.6;
      ctx.lineWidth = 2;
      ctx.setLineDash([radius * 0.5, radius * 0.32]);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius, radius * squash, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      if (bounce.first) {
        ctx.beginPath();
        ctx.moveTo(p.x - radius * 0.3, p.y);
        ctx.lineTo(p.x + radius * 0.3, p.y);
        ctx.moveTo(p.x, p.y - radius * 0.3 * squash);
        ctx.lineTo(p.x, p.y + radius * 0.3 * squash);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Where to stand: a pair of footprints.
    const guide = scene.guide;
    if (guide) {
      camera.project(guide.x, guide.y, 0, p);
      const foot = Math.max(3, 0.13 * p.scale);
      ctx.fillStyle = PAL.aid;
      ctx.globalAlpha = 0.5;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(p.x + side * foot * 1.25, p.y, foot * 0.8, foot * 1.5 * squash, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Where the ball is being sent: a ring, and around it the room it may scatter in.
    const aim = scene.aim;
    if (aim) {
      camera.project(aim.x, aim.y, 0, p);
      const small = aim.kind === 'drop';
      const radius = Math.max(8, (small ? 0.38 : 0.55) * p.scale);
      const spread = radius * (1.5 + aim.risk * 1.7);
      ctx.fillStyle = PAL.aid;
      ctx.globalAlpha = 0.13;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, spread, spread * squash, 0, 0, TAU);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.strokeStyle = PAL.aid;
      ctx.lineWidth = aim.armed ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius, radius * squash, 0, 0, TAU);
      ctx.stroke();
      if (aim.kind === 'lob') {
        // A lob comes down from above: a second ring.
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, radius * 1.45, radius * 1.45 * squash, 0, 0, TAU);
        ctx.stroke();
      }
      // Armed: the shot is committed, the centre is filled.
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius * 0.3, radius * 0.3 * squash, 0, 0, TAU);
      if (aim.armed) ctx.fill();
      else ctx.stroke();
    }

    for (const effect of this.effects) {
      if (effect.kind !== 'floorRing') continue;
      const t = effect.age / effect.life;
      camera.project(effect.x, effect.y, 0, p);
      const radius = (0.15 + easeOutCubic(t) * effect.size) * p.scale;
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = PAL.aid;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius, radius * squash, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = PAL.shadow;
    for (const player of scene.players) {
      camera.project(player.x, player.y, 0, p);
      const radius = 0.38 * p.scale * VIEW.figureScale;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius, radius * squash, 0, 0, TAU);
      ctx.fill();
      if (player.isHuman) {
        // Not colour alone: the person's player always stands on a ring.
        const ring = radius * 1.5;
        ctx.strokeStyle = PAL.aidSoft;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, ring, ring * squash, 0, 0, TAU);
        ctx.stroke();
      }
    }

    const ball = scene.ball;
    if (ball.visible) {
      // The shadow is what tells how high the ball is.
      camera.project(ball.x, ball.y, 0, p);
      const radius = Math.max(2.5, VIEW.ballRadius * 1.15 * p.scale);
      ctx.globalAlpha = 1 - clamp(ball.z / 9, 0, 0.55);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius, radius * squash, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** Players, ball and net, sorted from the far wall toward the camera. */
  private drawEntities(scene: Scene): void {
    const items = this.items;
    let count = 0;
    const add = (kind: number, index: number, y: number): void => {
      let item = items[count];
      if (!item) {
        item = { kind: 0, index: 0, y: 0 };
        items.push(item);
      }
      item.kind = kind;
      item.index = index;
      item.y = y;
      count++;
    };
    for (let i = 0; i < scene.players.length; i++) add(0, i, scene.players[i]!.y);
    if (scene.ball.visible) add(1, 0, scene.ball.y);
    add(2, 0, 0);

    // Insertion sort, far to near: half a dozen items at most.
    for (let i = 1; i < count; i++) {
      const item = items[i]!;
      let j = i - 1;
      while (j >= 0 && items[j]!.y < item.y) {
        items[j + 1] = items[j]!;
        j--;
      }
      items[j + 1] = item;
    }

    for (let i = 0; i < count; i++) {
      const item = items[i]!;
      if (item.kind === 0) this.drawPlayer(scene.players[item.index]!);
      else if (item.kind === 1) this.drawBall(scene);
      else drawNet(this.ctx, this.camera, this.court);
    }
    if (!scene.ball.visible) this.trailCount = 0;
  }

  private drawPlayer(player: ScenePlayer): void {
    const p = this.camera.project(player.x, player.y, 0, this.p);
    const scale = p.scale * VIEW.figureScale;
    // Where the ball of this stroke is met, in the metres of the drawn figure.
    const ball = this.camera.project(
      player.x + player.reachX,
      player.y + player.reachY,
      player.reachZ,
      this.q,
    );
    const colors = player.team === 0 ? PAL.near : PAL.far;
    drawFigure(
      this.ctx,
      p.x,
      p.y,
      scale,
      player,
      (ball.x - p.x) / scale,
      (p.y - ball.y) / scale,
      colors.body,
      colors.edge,
    );
  }

  private drawBall(scene: Scene): void {
    const ctx = this.ctx;
    const ball = scene.ball;
    const p = this.camera.project(ball.x, ball.y, ball.z, this.p);
    const radius = Math.max(VIEW.ballMinPixels, VIEW.ballRadius * p.scale);

    // Short trail behind the ball: it makes fast shots readable.
    const trail = this.trail;
    if (this.trailCount > 0) {
      const lastX = trail[0]!;
      const lastY = trail[1]!;
      if (Math.hypot(p.x - lastX, p.y - lastY) > this.height * 0.2) this.trailCount = 0;
    }
    if (!scene.reduceMotion && this.trailCount > 1) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = PAL.ball;
      let fromX = p.x;
      let fromY = p.y;
      for (let i = 0; i < this.trailCount; i++) {
        const tx = trail[i * 2]!;
        const ty = trail[i * 2 + 1]!;
        const k = 1 - (i + 1) / (this.trailCount + 1);
        ctx.globalAlpha = k * 0.4;
        ctx.lineWidth = radius * 2 * (0.35 + k * 0.5);
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        fromX = tx;
        fromY = ty;
      }
      ctx.globalAlpha = 1;
    }
    trail.copyWithin(2, 0, (TRAIL_LENGTH - 1) * 2);
    trail[0] = p.x;
    trail[1] = p.y;
    if (this.trailCount < TRAIL_LENGTH) this.trailCount++;

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius + 1.25, 0, TAU);
    ctx.fillStyle = PAL.ballEdge;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.fillStyle = PAL.ball;
    ctx.fill();
  }

  /**
   * Timing aid: a ring closes on the spot where the ball will be hit, and
   * meets the fixed ring at the ideal moment. Shape, not colour.
   */
  private drawContact(scene: Scene): void {
    const contact = scene.contact;
    if (!contact || contact.eta > RING_LEAD) return;
    const ctx = this.ctx;
    const camera = this.camera;
    const p = camera.project(contact.x, contact.y, contact.z, this.p);
    const base = Math.max(14, 0.44 * p.scale);

    // Stem down to the floor, so the height of the contact reads too.
    const floor = camera.project(contact.x, contact.y, 0, this.q);
    ctx.strokeStyle = PAL.aidSoft;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y + base);
    ctx.lineTo(floor.x, floor.y);
    ctx.stroke();

    // The band the closing ring has to be in for a good hit.
    const goodOuter = base * (1 + 2.3 * (contact.good / RING_LEAD));
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
    if (contact.eta >= 0) {
      const k = contact.eta / RING_LEAD;
      radius = base * (1 + 2.3 * k);
      alpha = 1 - k * 0.7;
    } else {
      const k = clamp(-contact.eta / 0.22, 0, 1);
      radius = base * (1 - 0.45 * k);
      alpha = 1 - k * 0.8;
    }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Everything drawn over the players: impacts, the name on the aim mark, the message. */
  private drawOverlays(scene: Scene): void {
    const ctx = this.ctx;
    const camera = this.camera;
    const p = this.p;
    for (const effect of this.effects) {
      const t = effect.age / effect.life;
      if (effect.kind === 'airRing') {
        camera.project(effect.x, effect.y, effect.z, p);
        ctx.globalAlpha = (1 - t) * 0.85;
        ctx.strokeStyle = PAL.aid;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (0.12 + easeOutCubic(t) * effect.size) * p.scale, 0, TAU);
        ctx.stroke();
      } else if (effect.kind === 'burst') {
        camera.project(effect.x, effect.y, effect.z, p);
        const inner = (0.12 + t * effect.size * 0.6) * p.scale;
        const outer = inner + (1 - t) * effect.size * 0.5 * p.scale;
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = PAL.aid;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * TAU + 0.4;
          ctx.moveTo(p.x + Math.cos(angle) * inner, p.y + Math.sin(angle) * inner);
          ctx.lineTo(p.x + Math.cos(angle) * outer, p.y + Math.sin(angle) * outer);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // The shot that would come out, named on the mark it is aimed at.
    const aim = scene.aim;
    if (aim && aim.kind !== 'serve') {
      camera.project(aim.x, aim.y, 0, p);
      const radius = Math.max(8, 0.55 * p.scale);
      ctx.globalAlpha = 0.95;
      this.stamp(this.label(shotName(aim.kind, aim.forehand), 13, 700), p.x, p.y - radius - 12);
      ctx.globalAlpha = 1;
    }

    const message = this.message;
    if (message.active && message.title) {
      const t = message.age / message.life;
      camera.project(message.x, message.y, 2.3 * VIEW.figureScale, p);
      const rise = scene.reduceMotion ? 0 : easeOutCubic(t) * 14;
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      const y = p.y - rise - (message.detail ? 34 : 14);
      this.stamp(message.title, p.x, y);
      if (message.detail) this.stamp(message.detail, p.x, y + 21);
      ctx.globalAlpha = 1;
    }
  }

  /** The thumbs: the stroke of the one that aims or flicks, and the stick. */
  private drawPointer(scene: Scene): void {
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
      if (stroke.active) {
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
    }
  }

  /**
   * First visit: ghost thumbs show the gestures, with no words. They go away
   * for good after the first hit that comes off.
   */
  private drawTutorial(scene: Scene): void {
    const tutorial = scene.tutorial;
    if (!tutorial) return;
    const { stroke, stick } = scene.pointer;
    // A real thumb is already there: do not draw over it.
    const y = this.height - this.safe.bottom - this.height * 0.13;
    const t = scene.reduceMotion ? 0.55 : (this.clock % GHOST_LOOP) / GHOST_LOOP;
    const stickX = this.width * (tutorial.stickSide === 'left' ? 0.26 : 0.74);
    const aimX = this.width * (tutorial.stickSide === 'left' ? 0.74 : 0.26);

    if (tutorial.scheme === 'two') {
      if (tutorial.step === 'play' && !stick.active) {
        // The stick thumb: pressed, circling around its centre.
        const angle = t * TAU;
        this.ghostStick(stickX, y, Math.cos(angle) * 20, Math.sin(angle) * 20);
      }
      if (!stroke.active) {
        // The aiming thumb: press, drag, hold, let go.
        const drag = easeOutCubic(clamp((t - 0.15) / 0.3, 0, 1));
        const pressed = t > 0.08 && t < 0.72;
        const x = aimX + drag * 16;
        const fingerY = y - drag * 44;
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
      const dx = Math.sin(k * Math.PI) * 26;
      const dy = -k * 18;
      this.ghostStick(x, y, dx, dy);
      return;
    }
    // ...and a quick stroke is the shot.
    const start = tutorial.step === 'play' ? 0.6 : 0.2;
    const k = clamp((t - start) / 0.12, 0, 1);
    const fingerY = y - easeOutCubic(k) * 78;
    if (t >= start - 0.1) {
      this.ghostPath(x, y, x, fingerY);
      this.ghostFinger(x, fingerY, k < 1, k >= 1 ? clamp((t - start - 0.12) / 0.2, 0, 1) : -1);
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
    ctx.strokeStyle = PAL.aid;
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.arc(x, y, CONTROLS.stickRadius, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    this.ghostFinger(x + dx, y + dy, true, -1);
  }
}
