import { CONTROLS } from '../config';
import type { ShotIntent } from '../sim/types';
import { neutralIntent } from './gestures';
import type { InputState } from './state';

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];

/** Every hitting key and the shot it asks for. `side` is -1 left, 0 middle, 1 right. */
const SHOTS: Record<string, { side: number; depth: number; lob: boolean }> = {
  Space: { side: 0, depth: -1, lob: false },
  KeyJ: { side: -1, depth: 0.9, lob: false },
  KeyK: { side: 0, depth: 0.9, lob: false },
  KeyL: { side: 1, depth: 0.9, lob: false },
  KeyU: { side: -1, depth: 1, lob: true },
  KeyI: { side: 0, depth: 1, lob: true },
  KeyO: { side: 1, depth: 1, lob: true },
  KeyM: { side: 0, depth: 0.1, lob: false },
};

/**
 * Keyboard, for playing on a computer.
 *
 *   arrows / WASD   move
 *   J  K  L         hit to the left, the middle, the right
 *   U  I  O         lob to the left, the middle, the right
 *   M               chiquita           space   a comfortable ball to the middle
 *   P or Escape     pause
 *
 * A key press is the release of the swing: timing works as with a thumb.
 */
export class KeyboardInput {
  enabled = false;
  private readonly held = new Set<string>();

  constructor(
    private readonly input: InputState,
    private readonly onPause: () => void,
    private readonly onTouch: () => void,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.release());
  }

  release(): void {
    this.held.clear();
    this.input.setMove('keys', 0, 0);
  }

  private isHeld(codes: string[]): boolean {
    return codes.some((code) => this.held.has(code));
  }

  private updateMove(): void {
    const x = (this.isHeld(RIGHT) ? 1 : 0) - (this.isHeld(LEFT) ? 1 : 0);
    const y = (this.isHeld(UP) ? 1 : 0) - (this.isHeld(DOWN) ? 1 : 0);
    this.input.setMove('keys', x, y);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyP' || event.code === 'Escape') {
      if (!event.repeat) this.onPause();
      return;
    }
    // Buttons keep their own keyboard behaviour.
    if (event.target instanceof HTMLElement && event.target.closest('button, input, select')) return;

    const shot = SHOTS[event.code];
    if (shot) {
      if (!event.repeat) this.onTouch();
      if (!this.enabled) return;
      event.preventDefault();
      if (event.repeat) return;
      const intent: ShotIntent =
        shot.depth < 0
          ? neutralIntent()
          : { aim: shot.side * CONTROLS.keyAim, depth: shot.depth, lob: shot.lob, power: 1 };
      this.input.pushSwing(intent);
      return;
    }
    if (!this.enabled) return;
    if ([...LEFT, ...RIGHT, ...UP, ...DOWN].includes(event.code)) {
      event.preventDefault();
      this.held.add(event.code);
      this.updateMove();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.held.delete(event.code)) this.updateMove();
  };
}
