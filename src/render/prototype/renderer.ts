import type { CourtConfig } from '../../config';
import { clamp, easeOutCubic, TAU } from '../../core/math';
import type { SimEvent } from '../../sim/match';
import { TEXT } from '../../ui/text';
import { Camera, type Projected } from '../camera';
import type { Renderer, Scene, ScenePlayer } from '../scene';
import { VIEW, type CameraName } from '../view';
import { drawCourtBack, drawCourtFront, drawNet } from './court';
import { drawFigure } from './figure';
import { FONT, PAL } from './palette';

interface Effect {
  kind: 'floorRing' | 'airRing' | 'burst' | 'text';
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  size: number;
  text: string;
}

interface DrawItem {
  /** 0 = player, 1 = ball, 2 = net. */
  kind: number;
  index: number;
  y: number;
}

const TRAIL_LENGTH = 7;
/** Seconds before the contact at which the timing ring starts closing. */
const RING_LEAD = 0.9;

/**
 * Grey-box renderer: simple shapes, readable at phone size, cheap to draw.
 *
 * The court never changes, so it is painted once into an offscreen layer and
 * each frame starts by copying it. On top go, back to front: marks on the
 * floor, shadows, the far players, the net, the near players, the edges of the
 * near wall and finally the aids and messages.
 */
export class PrototypeRenderer implements Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly camera = new Camera();
  private readonly back: HTMLCanvasElement;
  private readonly backCtx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private cameraName: CameraName = 'mid';

  private readonly effects: Effect[] = [];
  private readonly items: DrawItem[] = [];
  private readonly trail = new Float32Array(TRAIL_LENGTH * 2);
  private trailCount = 0;
  private readonly p: Projected = { x: 0, y: 0, scale: 0 };
  private readonly q: Projected = { x: 0, y: 0, scale: 0 };

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

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.ratio = pixelRatio;
    this.rebuild();
  }

  reset(): void {
    this.effects.length = 0;
    this.trailCount = 0;
  }

  /** Fits the camera to the viewport and repaints the cached court. */
  private rebuild(): void {
    this.camera.fit(VIEW.cameras[this.cameraName], this.court, this.width, this.height, {
      top: VIEW.insetTop,
      bottom: this.height * VIEW.insetBottomFraction,
      side: VIEW.insetSide,
      align: VIEW.align,
    });
    this.back.width = Math.max(1, Math.round(this.width * this.ratio));
    this.back.height = Math.max(1, Math.round(this.height * this.ratio));
    this.backCtx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    drawCourtBack(this.backCtx, this.camera, this.court, this.width, this.height);
    this.trailCount = 0;
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
          const label = event.kind === 'smash' && event.quality !== 'early' && event.quality !== 'late'
            ? TEXT.smash
            : TEXT.quality[event.quality];
          this.say(label, player.x, player.y, event.quality === 'perfect' ? 1.25 : 1);
        }
        break;
      }
      case 'whiff': {
        const player = scene.players[event.player];
        if (player?.isHuman && event.reason === 'far') this.say(TEXT.whiffFar, player.x, player.y, 1);
        break;
      }
      default:
        break;
    }
  }

  private spawn(kind: Effect['kind'], x: number, y: number, z: number, life: number, size: number): void {
    this.effects.push({ kind, x, y, z, age: 0, life, size, text: '' });
  }

  private say(text: string, x: number, y: number, size: number): void {
    // One message at a time over the player: a new one replaces the old.
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i]!.kind === 'text') this.effects.splice(i, 1);
    }
    this.effects.push({ kind: 'text', x, y, z: 2.15, age: 0, life: 0.85, size, text });
  }

  // ---------------------------------------------------------------- frame

  render(scene: Scene, dt: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.back, 0, 0);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const effect = this.effects[i]!;
      effect.age += dt;
      if (effect.age >= effect.life) this.effects.splice(i, 1);
    }

    this.drawFloor(scene);
    this.drawEntities(scene);
    drawCourtFront(ctx, this.camera, this.court);
    this.drawContact(scene);
    this.drawAirEffects(scene);
    this.drawPointer(scene);
  }

  /** Marks painted on the floor: aids, bounce rings and every shadow. */
  private drawFloor(scene: Scene): void {
    const ctx = this.ctx;
    const camera = this.camera;
    const p = this.p;
    const squash = camera.floorSquash;

    const bounce = scene.bounce;
    if (bounce) {
      camera.project(bounce.x, bounce.y, 0, p);
      const radius = Math.max(7, 0.4 * p.scale);
      ctx.strokeStyle = PAL.aid;
      ctx.lineWidth = 2;
      ctx.setLineDash([radius * 0.5, radius * 0.32]);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius, radius * squash, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p.x - radius * 0.3, p.y);
      ctx.lineTo(p.x + radius * 0.3, p.y);
      ctx.moveTo(p.x, p.y - radius * 0.3 * squash);
      ctx.lineTo(p.x, p.y + radius * 0.3 * squash);
      ctx.stroke();
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
      const radius = 0.38 * p.scale;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius, radius * squash, 0, 0, TAU);
      ctx.fill();
      if (player.isHuman) {
        // Not colour alone: the person's player always stands on a ring.
        ctx.strokeStyle = PAL.aidSoft;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 0.56 * p.scale, 0.56 * p.scale * squash, 0, 0, TAU);
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
    const colors = player.team === 0 ? PAL.near : PAL.far;
    drawFigure(this.ctx, p.x, p.y, p.scale, player, colors.body, colors.edge);
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

  private drawAirEffects(scene: Scene): void {
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
      } else if (effect.kind === 'text') {
        camera.project(effect.x, effect.y, effect.z, p);
        const rise = scene.reduceMotion ? 0 : easeOutCubic(t) * 16;
        const size = Math.round(17 * effect.size);
        ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
        ctx.font = `800 ${size}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const x = clamp(p.x, 60, this.width - 60);
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = PAL.textEdge;
        ctx.strokeText(effect.text, x, p.y - rise);
        ctx.fillStyle = PAL.text;
        ctx.fillText(effect.text, x, p.y - rise);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** The swipe being drawn by the thumb, and the stick when it is in use. */
  private drawPointer(scene: Scene): void {
    const ctx = this.ctx;
    const { swipe, stick } = scene.pointer;

    const sinceRelease = swipe.releasedAt > 0 ? (performance.now() - swipe.releasedAt) / 220 : 0;
    if (swipe.active || (swipe.releasedAt > 0 && sinceRelease < 1)) {
      const dx = swipe.x1 - swipe.x0;
      const dy = swipe.y1 - swipe.y0;
      const length = Math.hypot(dx, dy);
      ctx.globalAlpha = swipe.active ? 0.5 : 0.5 * (1 - sinceRelease);
      ctx.strokeStyle = PAL.aid;
      ctx.fillStyle = PAL.aid;
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(swipe.x0, swipe.y0, 7, 0, TAU);
      ctx.fill();
      if (length > 6) {
        ctx.beginPath();
        ctx.moveTo(swipe.x0, swipe.y0);
        ctx.lineTo(swipe.x1, swipe.y1);
        ctx.stroke();
        const ux = dx / length;
        const uy = dy / length;
        ctx.beginPath();
        ctx.moveTo(swipe.x1 + ux * 12, swipe.y1 + uy * 12);
        ctx.lineTo(swipe.x1 - uy * 9, swipe.y1 + ux * 9);
        ctx.lineTo(swipe.x1 + uy * 9, swipe.y1 - ux * 9);
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
}
