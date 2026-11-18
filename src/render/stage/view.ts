import { layout, makeCamera, REFERENCE, type Layout, type Seen, type StageCamera } from './camera';

/** A point of the court on screen. */
export interface Projected {
  /** CSS pixels. */
  x: number;
  y: number;
  /** CSS pixels per metre at that depth. */
  scale: number;
  /** How much a circle lying on the floor there is squashed vertically. */
  squash: number;
}

/**
 * The camera of the moment and the screen it is shown on, together: where a
 * point of the court falls in CSS pixels, and the matrix that does the same
 * for the graphics card.
 */
export class StageView {
  cam: StageCamera = makeCamera(REFERENCE);
  lay: Layout = layout(REFERENCE.design[0], REFERENCE.design[1]);

  private readonly seen: Seen = { x: 0, y: 0, d: 0 };

  resize(width: number, height: number): void {
    this.lay = layout(width, height);
  }

  project(x: number, y: number, z: number, out: Projected): Projected {
    const { cam, lay } = this;
    const seen = cam.project(x, y, z, this.seen);
    out.x = lay.ox + seen.x * lay.s;
    out.y = lay.oy + seen.y * lay.s;
    out.scale = (cam.f * lay.s) / seen.d;
    // Seen from above a circle on the floor is round; seen from the side, a line.
    const dx = x - cam.pos[0];
    const dy = y - cam.pos[1];
    const dz = cam.pos[2] - z;
    out.squash = dz / Math.hypot(dx, dy, dz);
    return out;
  }

  /** View-projection matrix, by columns, that takes world metres to the clip space of the whole screen. */
  viewProjection(out: Float32Array): Float32Array {
    const { cam, lay } = this;
    const R = cam.right;
    const U = cam.up;
    const F = cam.fwd;
    const C = cam.pos;
    const near = 1;
    const far = 400;
    const kx = (2 * cam.f * lay.s) / lay.vw;
    const ky = (2 * cam.f * lay.s) / lay.vh;
    const shift = 1 - (2 * lay.oy) / lay.vh;
    const A = (far + near) / (far - near);
    const B = (-2 * far * near) / (far - near);
    const tr = -(R[0] * C[0] + R[1] * C[1] + R[2] * C[2]);
    const tu = -(U[0] * C[0] + U[1] * C[1] + U[2] * C[2]);
    const tf = -(F[0] * C[0] + F[1] * C[1] + F[2] * C[2]);
    for (let c = 0; c < 3; c++) {
      out[c * 4] = kx * R[c]!;
      out[c * 4 + 1] = ky * U[c]! + shift * F[c]!;
      out[c * 4 + 2] = A * F[c]!;
      out[c * 4 + 3] = F[c]!;
    }
    out[12] = kx * tr;
    out[13] = ky * tu + shift * tf;
    out[14] = A * tf + B;
    out[15] = tf;
    return out;
  }
}
