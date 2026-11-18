import type { CourtConfig } from '../config';
import type { Camera } from './camera';

/**
 * The part of the picture that never moves: the court and its walls.
 *
 * It only depends on the size of the screen and on the camera, so it is made
 * once and copied every frame. It comes in three pieces because the players
 * go in between them:
 *
 *   back    everything behind the players, opaque, the whole screen
 *   net     over the far players and under the near ones
 *   front   the near wall, over everything on court
 *
 * Who makes the pieces is not the renderer's business. Today a painter draws
 * them with Canvas 2D. A baker can make better ones (a shader that lights the
 * court, say) and take its time: the renderer starts with the painted ones
 * and swaps the baked ones in when they arrive. Nobody waits for a baker, and
 * a baker that cannot do its job (no WebGL2, a shader that does not compile)
 * just answers null.
 */
export interface Scenery {
  back: CanvasImageSource;
  net: SceneryPatch;
  front: SceneryPatch;
}

/** A piece that covers only part of the screen. Position and size in CSS pixels. */
export interface SceneryPatch {
  image: CanvasImageSource;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything the scenery depends on. */
export interface SceneryView {
  /** Already fitted to the screen: `project` gives the place of any point of the court. */
  camera: Camera;
  court: CourtConfig;
  /** Size of the screen in CSS pixels, and backing-store pixels per CSS pixel. */
  width: number;
  height: number;
  pixelRatio: number;
}

/** Makes the scenery right away. */
export type SceneryPainter = (view: SceneryView) => Scenery;

/** Makes a better scenery, whenever it is ready, or null if it cannot. */
export type SceneryBaker = (view: SceneryView) => Promise<Scenery | null>;
