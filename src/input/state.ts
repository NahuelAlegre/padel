import type { ShotIntent } from '../sim/types';

/**
 * What the player wants, independent of the device it came from.
 * Touch, mouse and keyboard all write here; the human controller reads it
 * once per simulation step.
 */
export class InputState {
  private readonly moves = new Map<string, { x: number; y: number }>();
  private pending: ShotIntent | null = null;

  /**
   * Movement of one source in screen space: x to the right, y up the screen,
   * each in [-1, 1]. Sources are added together so stick and keys can coexist.
   */
  setMove(source: string, x: number, y: number): void {
    if (x === 0 && y === 0) this.moves.delete(source);
    else this.moves.set(source, { x, y });
  }

  get moveX(): number {
    let sum = 0;
    for (const move of this.moves.values()) sum += move.x;
    return Math.max(-1, Math.min(1, sum));
  }

  get moveY(): number {
    let sum = 0;
    for (const move of this.moves.values()) sum += move.y;
    return Math.max(-1, Math.min(1, sum));
  }

  /** Requests a swing. Only the latest one before the next step counts. */
  pushSwing(intent: ShotIntent): void {
    this.pending = intent;
  }

  takeSwing(): ShotIntent | null {
    const swing = this.pending;
    this.pending = null;
    return swing;
  }

  clear(): void {
    this.moves.clear();
    this.pending = null;
  }
}
