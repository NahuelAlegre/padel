import { CONTROLS } from '../config';
import type { ShotRequest } from '../sim/types';
import type { InputState } from './state';

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];

const SHOTS: Record<string, ShotRequest> = {
  Space: 'drive',
  KeyJ: 'drive',
  KeyK: 'lob',
  KeyL: 'drop',
};

/**
 * Keyboard, for playing on a computer.
 *
 *   arrows / WASD   move (stick mode) and aim
 *   space or J      hit: to the held side, or a safe shot to the middle
 *   K               lob          L   drop shot
 *   P or Escape     pause
 */
export class KeyboardInput {
  enabled = false;
  private readonly held = new Set<string>();

  constructor(
    private readonly input: InputState,
    private readonly onPause: () => void,
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
    if (!this.enabled) return;
    // Buttons keep their own keyboard behaviour.
    if (event.target instanceof HTMLElement && event.target.closest('button, input, select')) return;

    const shot = SHOTS[event.code];
    if (shot) {
      event.preventDefault();
      if (event.repeat) return;
      const side = (this.isHeld(RIGHT) ? 1 : 0) - (this.isHeld(LEFT) ? 1 : 0);
      if (shot === 'drive' && side === 0) this.input.pushSwing({ kind: 'safe', aim: 0 });
      else this.input.pushSwing({ kind: shot, aim: side * CONTROLS.keyAim });
      return;
    }
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
