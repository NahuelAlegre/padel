import type { CourtConfig } from '../config';

export interface CameraPreset {
  /** Degrees the camera looks down. Steeper makes the court taller on screen. */
  pitch: number;
  /** Metres from the centre of the court. Farther flattens the perspective. */
  distance: number;
}

export interface Projected {
  /** Screen position in CSS pixels. */
  x: number;
  y: number;
  /** Pixels per metre at that depth. */
  scale: number;
}

export interface ViewInsets {
  top: number;
  bottom: number;
  side: number;
  /** 0..1: where the court sits in the free vertical space (0 = top). */
  align: number;
}

/**
 * Pseudo-3D camera placed behind the near back wall, looking down the court.
 *
 * World (x across, y along, z up) is projected with a pinhole model:
 *   depth    =  dy * cos(pitch) - dz * sin(pitch)
 *   vertical =  dy * sin(pitch) + dz * cos(pitch)
 * and the screen position is the centre plus (x, -vertical) * focal / depth.
 *
 * The focal length is not chosen by hand: `fit` computes it so the whole
 * court, walls included, fits the viewport whatever its aspect ratio.
 */
export class Camera {
  private sin = 0;
  private cos = 1;
  private camY = 0;
  private camZ = 0;
  private focal = 1;
  private centerX = 0;
  private centerY = 0;

  /** How much a circle on the floor is squashed vertically on screen. */
  floorSquash = 0.6;
  /** Bounding box of the court on screen, for layout and effects. */
  readonly bounds = { left: 0, right: 0, top: 0, bottom: 0 };

  fit(preset: CameraPreset, court: CourtConfig, width: number, height: number, insets: ViewInsets): void {
    const pitch = (preset.pitch * Math.PI) / 180;
    this.sin = Math.sin(pitch);
    this.cos = Math.cos(pitch);
    this.camY = -preset.distance * this.cos;
    this.camZ = preset.distance * this.sin;
    this.focal = 1;
    this.centerX = 0;
    this.centerY = 0;

    // Points that have to stay on screen: the floor, the far wall up to the
    // top of its fence and the near side walls up to the glass.
    const hw = court.halfWidth;
    const hl = court.halfLength;
    const p: Projected = { x: 0, y: 0, scale: 0 };
    let maxX = 0;
    let top = Infinity;
    let bottom = -Infinity;
    const include = (x: number, y: number, z: number): void => {
      this.project(x, y, z, p);
      maxX = Math.max(maxX, Math.abs(p.x));
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    };
    include(hw, -hl, 0);
    include(hw, -hl, court.backGlass);
    include(hw, hl, 0);
    include(hw, hl, court.backFence);
    include(0, hl, court.backFence);

    const availW = Math.max(1, width - insets.side * 2);
    const availH = Math.max(1, height - insets.top - insets.bottom);
    this.focal = Math.min(availW / (maxX * 2), availH / (bottom - top));
    this.centerX = width / 2;
    const free = availH - (bottom - top) * this.focal;
    this.centerY = insets.top + free * insets.align - top * this.focal;

    this.floorSquash = this.sin;
    this.project(hw, -hl, court.backGlass, p);
    this.bounds.right = p.x;
    this.bounds.left = width - p.x;
    this.project(0, hl, court.backFence, p);
    this.bounds.top = p.y;
    this.project(0, -hl, 0, p);
    this.bounds.bottom = p.y;
  }

  project(x: number, y: number, z: number, out: Projected): Projected {
    const dy = y - this.camY;
    const dz = z - this.camZ;
    const depth = dy * this.cos - dz * this.sin;
    const vertical = dy * this.sin + dz * this.cos;
    const scale = this.focal / depth;
    out.x = this.centerX + x * scale;
    out.y = this.centerY - vertical * scale;
    out.scale = scale;
    return out;
  }
}
