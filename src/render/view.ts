/**
 * Which camera the game is watched with. The player chooses: some like one,
 * some the other.
 *
 *   follow   goes with the play, a little: it pans sideways and zooms gently
 *   fixed    the whole court, still
 */
export type CameraName = 'follow' | 'fixed';

/** Everything about how the game is drawn that is worth tuning and is not the camera itself. */
export const VIEW = {
  /** The backing store never goes above this many device pixels per CSS pixel. */
  dprCap: 2,
  /** Seconds the game freezes on a perfect hit and on a smash, to give them weight. */
  hitStopPerfect: 0.03,
  hitStopSmash: 0.055,
};
