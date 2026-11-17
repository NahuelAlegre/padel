import type { CameraPreset } from './camera';

export type CameraName = 'low' | 'mid' | 'high';

/** Everything about how the game is framed and drawn that is worth tuning. */
export const VIEW = {
  /** The backing store never goes above this many device pixels per CSS pixel. */
  dprCap: 2,
  /** Widest the game column gets on a desktop, as width / height. */
  maxAspect: 9 / 16,
  cameras: {
    low: { pitch: 38, distance: 30 },
    mid: { pitch: 45, distance: 40 },
    high: { pitch: 52, distance: 46 },
  } satisfies Record<CameraName, CameraPreset>,
  /** Room kept free of the court: the scoreboard on top, the thumb at the bottom. */
  insetTop: 78,
  insetBottomFraction: 0.12,
  insetSide: 8,
  /** Where the court sits in the remaining free height (0 = top, 1 = bottom). */
  align: 0.3,
  /** The ball is drawn bigger than it is: at its real size it would be a dot. */
  ballRadius: 0.115,
  ballMinPixels: 2.8,
};
