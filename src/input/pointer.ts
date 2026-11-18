import { CONTROLS } from '../config';
import { createPointerFeedback, type PointerFeedback } from '../render/scene';
import { aimFromDrag, classifyTouch, intentFromFlick, neutralIntent } from './gestures';
import type { InputState } from './state';

export type ControlScheme = 'two' | 'one';

export interface PointerOptions {
  /** False while a menu is open: touches on the court do nothing. */
  enabled: boolean;
  /**
   * 'two': one thumb on a floating stick, the other holds, aims and releases.
   * 'one': a single thumb; a drag moves and a flick hits.
   */
  scheme: ControlScheme;
  /** Side of the screen the stick lives on in the two-thumb scheme. */
  stickSide: 'left' | 'right';
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

/** A flick is read as if it had lasted this long, to turn the speed of a fling into a length. */
const FLING_AS_FLICK_MS = 110;

/**
 * Touch and mouse, through Pointer Events so both behave the same.
 *
 * Two-thumb scheme: a pointer that goes down on the stick side becomes a
 * floating stick. Any other pointer aims: while it is down, where it is
 * relative to where it landed is where the ball will go, and lifting it is the
 * swing. The mouse always aims, since on a computer the keys do the moving.
 *
 * One-hand scheme: there is a single pointer. If it is still down after a
 * moment it is the stick; if it leaves quickly, or leaves the stick at speed,
 * it was a flick, and a flick is a shot.
 */
export class PointerInput {
  readonly feedback: PointerFeedback = createPointerFeedback();
  readonly options: PointerOptions = { enabled: false, scheme: 'two', stickSide: 'left' };
  /** Called for every touch on the court, enabled or not (used to skip the pause between points). */
  onTouch: (() => void) | null = null;

  private stickId = -1;
  private strokeId = -1;
  /** One-hand scheme: the stroke has turned into the stick. */
  private moving = false;
  private downAt = 0;
  private samples: Sample[] = [];
  private left = 0;
  private top = 0;

  constructor(
    private readonly target: HTMLElement,
    private readonly input: InputState,
  ) {
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('pointercancel', this.onCancel);
    // Long presses and right clicks must not open a menu over the game.
    target.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  /** Forgets every pointer in progress (pause, menu, new point, lost focus). */
  release(): void {
    this.stickId = -1;
    this.strokeId = -1;
    this.moving = false;
    this.samples.length = 0;
    this.feedback.stroke.active = false;
    this.feedback.stroke.releasedAt = 0;
    this.feedback.stick.active = false;
    this.input.aim.active = false;
    this.input.setMove('stick', 0, 0);
  }

  /**
   * Call once per frame. In the one-hand scheme a touch that is still down
   * after a moment becomes the stick, even if the thumb has not moved.
   */
  update(now: number): void {
    if (this.options.scheme !== 'one' || this.strokeId < 0 || this.moving) return;
    if (now - this.downAt < CONTROLS.moveDelay) return;
    this.moving = true;
    const stroke = this.feedback.stroke;
    stroke.active = false;
    stroke.releasedAt = 0;
    const stick = this.feedback.stick;
    stick.active = true;
    stick.cx = stroke.x0;
    stick.cy = stroke.y0;
    stick.radius = CONTROLS.stickRadius;
    this.moveStick(stroke.x1, stroke.y1);
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.onTouch?.();
    if (!this.options.enabled) return;
    event.preventDefault();

    const rect = this.target.getBoundingClientRect();
    this.left = rect.left;
    this.top = rect.top;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (y < rect.height * CONTROLS.zoneTop) return;

    const onStickSide = this.options.stickSide === 'left' ? x < rect.width / 2 : x >= rect.width / 2;
    const wantsStick = this.options.scheme === 'two' && event.pointerType !== 'mouse' && onStickSide;
    if (wantsStick && this.stickId < 0) {
      this.stickId = event.pointerId;
      const stick = this.feedback.stick;
      stick.active = true;
      stick.cx = x;
      stick.cy = y;
      stick.dx = 0;
      stick.dy = 0;
      stick.radius = CONTROLS.stickRadius;
    } else if (!wantsStick && this.strokeId < 0) {
      this.strokeId = event.pointerId;
      this.moving = false;
      this.downAt = event.timeStamp;
      this.samples.length = 0;
      this.samples.push({ t: event.timeStamp, x, y });
      const stroke = this.feedback.stroke;
      stroke.active = true;
      stroke.releasedAt = 0;
      stroke.x0 = x;
      stroke.y0 = y;
      stroke.x1 = x;
      stroke.y1 = y;
      if (this.options.scheme === 'two') this.preview(0, 0);
    } else {
      return;
    }
    try {
      this.target.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured; not needed to work.
    }
  };

  private readonly onMove = (event: PointerEvent): void => {
    const x = event.clientX - this.left;
    const y = event.clientY - this.top;
    if (event.pointerId === this.stickId) {
      this.moveStick(x, y);
    } else if (event.pointerId === this.strokeId) {
      const stroke = this.feedback.stroke;
      stroke.x1 = x;
      stroke.y1 = y;
      if (this.options.scheme === 'two') {
        this.preview(x - stroke.x0, y - stroke.y0);
        return;
      }
      this.samples.push({ t: event.timeStamp, x, y });
      if (this.samples.length > 16) this.samples.shift();
      if (this.moving) this.moveStick(x, y);
    }
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (event.pointerId === this.stickId) {
      this.stickId = -1;
      this.feedback.stick.active = false;
      this.input.setMove('stick', 0, 0);
      return;
    }
    if (event.pointerId !== this.strokeId) return;

    const stroke = this.feedback.stroke;
    const x = event.clientX - this.left;
    const y = event.clientY - this.top;
    stroke.x1 = x;
    stroke.y1 = y;
    this.strokeId = -1;
    const dx = x - stroke.x0;
    const dy = y - stroke.y0;

    if (this.options.scheme === 'two') {
      stroke.active = false;
      stroke.releasedAt = performance.now();
      this.input.aim.active = false;
      if (this.options.enabled) this.input.pushSwing(aimFromDrag(dx, dy));
      return;
    }

    // One hand: was that a shot, or just the end of a run?
    const cut = event.timeStamp - CONTROLS.flingWindow;
    let from = this.samples[0] ?? { t: this.downAt, x: stroke.x0, y: stroke.y0 };
    for (const sample of this.samples) {
      if (sample.t >= cut) break;
      from = sample;
    }
    const flingX = x - from.x;
    const flingY = y - from.y;
    const flingMs = event.timeStamp - from.t;
    const kind = classifyTouch({
      duration: event.timeStamp - this.downAt,
      distance: Math.hypot(dx, dy),
      moving: this.moving,
      flingDistance: Math.hypot(flingX, flingY),
      flingMs,
    });

    if (this.moving) {
      this.moving = false;
      this.feedback.stick.active = false;
      this.input.setMove('stick', 0, 0);
    }
    stroke.active = false;
    stroke.releasedAt = kind === 'none' ? 0 : performance.now();
    this.samples.length = 0;
    if (!this.options.enabled) return;

    if (kind === 'flick') {
      this.input.pushSwing(intentFromFlick(dx, dy));
    } else if (kind === 'fling') {
      // Show and read the fling as the flick it would have been.
      const scale = FLING_AS_FLICK_MS / Math.max(flingMs, 1);
      stroke.x0 = x - flingX * scale;
      stroke.y0 = y - flingY * scale;
      this.input.pushSwing(intentFromFlick(flingX * scale, flingY * scale));
    } else if (kind === 'tap') {
      this.input.pushSwing(neutralIntent());
    }
  };

  private readonly onCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.stickId) {
      this.stickId = -1;
      this.feedback.stick.active = false;
      this.input.setMove('stick', 0, 0);
    } else if (event.pointerId === this.strokeId) {
      this.strokeId = -1;
      this.feedback.stroke.active = false;
      this.feedback.stroke.releasedAt = 0;
      this.input.aim.active = false;
      if (this.moving) {
        this.moving = false;
        this.feedback.stick.active = false;
        this.input.setMove('stick', 0, 0);
      }
    }
  };

  /** Two-thumb scheme: what the aiming thumb asks for right now, for the mark on the court. */
  private preview(dx: number, dy: number): void {
    const intent = aimFromDrag(dx, dy);
    const aim = this.input.aim;
    aim.active = true;
    aim.aim = intent.aim;
    aim.depth = intent.depth;
    aim.lob = intent.lob;
  }

  private moveStick(x: number, y: number): void {
    const stick = this.feedback.stick;
    const rawX = x - stick.cx;
    const rawY = y - stick.cy;
    const length = Math.hypot(rawX, rawY);
    const limited = Math.min(length, stick.radius);
    stick.dx = length > 0 ? (rawX / length) * limited : 0;
    stick.dy = length > 0 ? (rawY / length) * limited : 0;
    const amount = limited / stick.radius;
    if (length === 0 || amount < CONTROLS.stickDeadzone) {
      this.input.setMove('stick', 0, 0);
      return;
    }
    // Screen y grows downward; "up" has to mean toward the net.
    const scaled = (amount - CONTROLS.stickDeadzone) / (1 - CONTROLS.stickDeadzone);
    this.input.setMove('stick', (rawX / length) * scaled, (-rawY / length) * scaled);
  }
}
