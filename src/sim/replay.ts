import { PHYSICS_VERSION } from '../config';
import type { Controller, Match } from './match';
import type { Player } from './player';
import type { PlayerIntent, ShotIntent } from './types';

/** What one player asked for, from this step until its next frame. */
export interface InputFrame {
  /** Simulation step the frame applies from. */
  tick: number;
  /** Index of the player in the match. */
  player: number;
  moveX: number;
  moveY: number;
  hasTarget: boolean;
  targetX: number;
  targetY: number;
  home: 'back' | 'net' | null;
  /** A swing requested on exactly this step. */
  swing: ShotIntent | null;
}

/**
 * Everything needed to play a match again: the simulation is deterministic,
 * so the seed plus what the people did, step by step, reproduces it exactly.
 * A few kilobytes instead of a video: enough for replays, ghosts and daily
 * challenges that are the same for everybody.
 */
export interface Recording {
  /** Physics version it was played with. A different one will not replay the same. */
  version: number;
  seed: number;
  frames: InputFrame[];
}

/** Stores the intents of the players it is given, only when they change. */
export class InputRecorder {
  readonly frames: InputFrame[] = [];
  private readonly last = new Map<number, InputFrame>();

  capture(tick: number, player: number, intent: PlayerIntent): void {
    const previous = this.last.get(player);
    if (
      previous &&
      intent.swing === null &&
      previous.moveX === intent.moveX &&
      previous.moveY === intent.moveY &&
      previous.hasTarget === intent.hasTarget &&
      previous.home === intent.home &&
      (!intent.hasTarget || (previous.targetX === intent.targetX && previous.targetY === intent.targetY))
    ) {
      return;
    }
    const frame: InputFrame = {
      tick,
      player,
      moveX: intent.moveX,
      moveY: intent.moveY,
      hasTarget: intent.hasTarget,
      targetX: intent.targetX,
      targetY: intent.targetY,
      home: intent.home,
      swing: intent.swing ? { ...intent.swing } : null,
    };
    this.frames.push(frame);
    this.last.set(player, frame);
  }

  recording(seed: number): Recording {
    return { version: PHYSICS_VERSION, seed, frames: this.frames };
  }
}

/** True when a recording was made with the physics this build runs. */
export function canReplay(recording: Recording): boolean {
  return recording.version === PHYSICS_VERSION;
}

/** Plays back the recorded intents of one player. */
export class ReplayController implements Controller {
  private readonly frames: InputFrame[];
  private next = 0;
  private current: InputFrame | null = null;

  constructor(recording: Recording, player: number) {
    this.frames = recording.frames.filter((frame) => frame.player === player);
  }

  update(match: Match, _me: Player, intent: PlayerIntent): void {
    let swing: ShotIntent | null = null;
    while (this.next < this.frames.length && this.frames[this.next]!.tick <= match.tick) {
      this.current = this.frames[this.next]!;
      // A swing belongs to the step it was asked on, not to the ones after.
      if (this.current.tick === match.tick) swing = this.current.swing;
      this.next++;
    }
    const frame = this.current;
    if (!frame) return;
    intent.moveX = frame.moveX;
    intent.moveY = frame.moveY;
    intent.hasTarget = frame.hasTarget;
    intent.targetX = frame.targetX;
    intent.targetY = frame.targetY;
    intent.home = frame.home;
    intent.swing = swing ? { ...swing } : null;
  }
}
