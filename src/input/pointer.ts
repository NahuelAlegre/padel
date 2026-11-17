import { CONTROLS } from '../config';
import { createPointerFeedback, type PointerFeedback } from '../render/scene';
import { interpretGesture } from './gestures';
import type { InputState } from './state';

export interface PointerOptions {
  /** False while a menu is open: touches on the court do nothing. */
  enabled: boolean;
  /** Stick mode: one side of the screen moves the player, the other one hits. */
  manual: boolean;
  stickSide: 'left' | 'right';
}

/**
 * Touch and mouse, through Pointer Events so both behave the same.
 *
 * A pointer that goes down in the gesture zone becomes a swipe: when it is
 * released, its direction and length are turned into a shot. In stick mode a
 * pointer that goes down on the stick side becomes a floating stick instead,
 * so two thumbs can move and hit at the same time.
 */
export class PointerInput {
  readonly feedback: PointerFeedback = createPointerFeedback();
  readonly options: PointerOptions = { enabled: false, manual: false, stickSide: 'left' };

  private swipeId = -1;
  private stickId = -1;
  private downAt = 0;
  private left = 0;
  private top = 0;
  private height = 1;

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

  /** Forgets every pointer in progress (pause, menu, lost focus). */
  release(): void {
    this.swipeId = -1;
    this.stickId = -1;
    this.feedback.swipe.active = false;
    this.feedback.swipe.releasedAt = 0;
    this.feedback.stick.active = false;
    this.input.setMove('stick', 0, 0);
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (!this.options.enabled) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();

    const rect = this.target.getBoundingClientRect();
    this.left = rect.left;
    this.top = rect.top;
    this.height = rect.height;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (y < rect.height * CONTROLS.gestureZoneTop) return;

    const onStickSide = this.options.stickSide === 'left' ? x < rect.width / 2 : x >= rect.width / 2;
    if (this.options.manual && onStickSide && this.stickId < 0) {
      this.stickId = event.pointerId;
      const stick = this.feedback.stick;
      stick.active = true;
      stick.cx = x;
      stick.cy = y;
      stick.dx = 0;
      stick.dy = 0;
      stick.radius = CONTROLS.stickRadius;
    } else if (this.swipeId < 0) {
      this.swipeId = event.pointerId;
      this.downAt = event.timeStamp;
      const swipe = this.feedback.swipe;
      swipe.active = true;
      swipe.releasedAt = 0;
      swipe.x0 = x;
      swipe.y0 = y;
      swipe.x1 = x;
      swipe.y1 = y;
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
    if (event.pointerId === this.swipeId) {
      this.feedback.swipe.x1 = x;
      this.feedback.swipe.y1 = y;
    } else if (event.pointerId === this.stickId) {
      const stick = this.feedback.stick;
      let dx = x - stick.cx;
      let dy = y - stick.cy;
      const length = Math.hypot(dx, dy);
      if (length > stick.radius) {
        dx = (dx / length) * stick.radius;
        dy = (dy / length) * stick.radius;
      }
      stick.dx = dx;
      stick.dy = dy;
      const amount = Math.min(1, length / stick.radius);
      if (amount < CONTROLS.stickDeadzone || length === 0) {
        this.input.setMove('stick', 0, 0);
      } else {
        // Screen y grows downward; "up" has to mean toward the net.
        const scaled = (amount - CONTROLS.stickDeadzone) / (1 - CONTROLS.stickDeadzone);
        this.input.setMove('stick', ((x - stick.cx) / length) * scaled, (-(y - stick.cy) / length) * scaled);
      }
    }
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (event.pointerId === this.swipeId) {
      const swipe = this.feedback.swipe;
      swipe.x1 = event.clientX - this.left;
      swipe.y1 = event.clientY - this.top;
      swipe.active = false;
      swipe.releasedAt = performance.now();
      this.swipeId = -1;
      const intent = interpretGesture(
        swipe.x1 - swipe.x0,
        swipe.y1 - swipe.y0,
        event.timeStamp - this.downAt,
        this.height,
      );
      if (intent && this.options.enabled) this.input.pushSwing(intent);
    } else if (event.pointerId === this.stickId) {
      this.stickId = -1;
      this.feedback.stick.active = false;
      this.input.setMove('stick', 0, 0);
    }
  };

  private readonly onCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.swipeId) {
      this.swipeId = -1;
      this.feedback.swipe.active = false;
      this.feedback.swipe.releasedAt = 0;
    } else if (event.pointerId === this.stickId) {
      this.stickId = -1;
      this.feedback.stick.active = false;
      this.input.setMove('stick', 0, 0);
    }
  };
}
