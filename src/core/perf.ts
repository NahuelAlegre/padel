/** Rolling frame statistics over roughly the last second. */
export class FrameStats {
  /** Frames per second, averaged over the window. */
  fps = 0;
  /** Average and worst time between frames in the window, in milliseconds. */
  frameMs = 0;
  worstMs = 0;
  /** Average time spent updating and drawing a frame, in milliseconds. */
  workMs = 0;
  /** True during the call of `push` that closed a window. */
  fresh = false;

  private frames = 0;
  private elapsed = 0;
  private worst = 0;
  private work = 0;

  constructor(private readonly windowSeconds = 1) {}

  push(frameSeconds: number, workMs: number): void {
    this.frames++;
    this.elapsed += frameSeconds;
    this.work += workMs;
    if (frameSeconds * 1000 > this.worst) this.worst = frameSeconds * 1000;
    this.fresh = false;
    if (this.elapsed < this.windowSeconds) return;

    this.fps = this.frames / this.elapsed;
    this.frameMs = (this.elapsed / this.frames) * 1000;
    this.worstMs = this.worst;
    this.workMs = this.work / this.frames;
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
    this.work = 0;
    this.fresh = true;
  }
}

/** Resolution scales the automatic mode moves between, from sharpest to cheapest. */
export const QUALITY_STEPS = [1, 0.85, 0.7, 0.55] as const;

/** Windows of low frame rate before trying a lower resolution. */
const SLOW_WINDOWS = 2;
/** Windows of full frame rate before trying a higher one. */
const FAST_WINDOWS = 8;
/** Windows a lower resolution gets to prove it helps. */
const PROBE_WINDOWS = 2;
/** A step down has to raise the frame rate by this factor to be kept. */
const PROBE_GAIN = 1.12;
/** Windows without further attempts after one that did not help. */
const BACK_OFF = 90;

/**
 * Lowers the internal resolution when the device cannot hold the frame rate,
 * and carefully raises it again when there is room.
 *
 * A low frame rate does not always mean too many pixels: battery savers and
 * background tabs cap it no matter what is drawn. So every step down is a
 * probe: if the frame rate does not improve, the step is undone and the
 * controller backs off instead of blurring the game for nothing.
 */
export class AutoQuality {
  private level = 0;
  private slow = 0;
  private fast = 0;
  private wait = 0;
  private probe: { from: number; fps: number; windows: number } | null = null;

  get scale(): number {
    return QUALITY_STEPS[this.level] ?? 1;
  }

  reset(): void {
    this.level = 0;
    this.slow = 0;
    this.fast = 0;
    this.wait = 0;
    this.probe = null;
  }

  /** Call once per statistics window. Returns true when the scale changed. */
  update(fps: number, refreshHz = 60): boolean {
    if (this.probe) {
      this.probe.windows++;
      if (this.probe.windows < PROBE_WINDOWS) return false;
      const helped = fps >= this.probe.fps * PROBE_GAIN;
      const from = this.probe.from;
      this.probe = null;
      this.slow = 0;
      this.fast = 0;
      if (helped) return false;
      this.level = from;
      this.wait = BACK_OFF;
      return true;
    }

    if (this.wait > 0) {
      this.wait--;
      return false;
    }

    const target = Math.min(refreshHz, 60);
    if (fps < target * 0.87) {
      this.slow++;
      this.fast = 0;
    } else if (fps > target * 0.97) {
      this.fast++;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.fast = 0;
    }

    if (this.slow >= SLOW_WINDOWS && this.level < QUALITY_STEPS.length - 1) {
      this.probe = { from: this.level, fps, windows: 0 };
      this.level++;
      this.slow = 0;
      return true;
    }
    if (this.fast >= FAST_WINDOWS && this.level > 0) {
      // If the higher resolution turns out too heavy, the slow path brings it back down.
      this.level--;
      this.fast = 0;
      this.wait = 4;
      return true;
    }
    return false;
  }
}
