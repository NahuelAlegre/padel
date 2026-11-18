import type { CourtConfig } from '../../config';
import { netHeightAt } from '../../sim/court';
import type { Projected } from '../stage/view';
import { PAL } from './palette';

/**
 * The court drawn by hand, with lines and flat colours. It is what there is
 * to play on until the pictures of the real court arrive, and what stays if
 * they never do.
 */
type Ctx = CanvasRenderingContext2D;

/** Whatever says where a point of the court falls on screen. */
export interface Camera {
  project(x: number, y: number, z: number, out: Projected): Projected;
}

const p: Projected = { x: 0, y: 0, scale: 0, squash: 1 };

/** Closed path through world points given as a flat [x, y, z, x, y, z, ...] list. */
function path(ctx: Ctx, camera: Camera, points: readonly number[]): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 3) {
    camera.project(points[i]!, points[i + 1]!, points[i + 2]!, p);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

function segment(
  ctx: Ctx,
  camera: Camera,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  camera.project(x0, y0, z0, p);
  ctx.moveTo(p.x, p.y);
  camera.project(x1, y1, z1, p);
  ctx.lineTo(p.x, p.y);
}

/** A wall panel between two heights: glass is a clear sheet, fence a wire mesh. */
function panel(
  ctx: Ctx,
  camera: Camera,
  kind: 'glass' | 'fence',
  ax: number,
  ay: number,
  bx: number,
  by: number,
  z0: number,
  z1: number,
): void {
  if (z1 <= z0) return;
  path(ctx, camera, [ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1]);
  ctx.fillStyle = kind === 'glass' ? PAL.glassFill : PAL.fenceFill;
  ctx.fill();

  const length = Math.hypot(bx - ax, by - ay);
  ctx.beginPath();
  if (kind === 'glass') {
    // Joints between the glass sheets, every two metres.
    for (let d = 2; d < length - 0.01; d += 2) {
      const t = d / length;
      segment(ctx, camera, ax + (bx - ax) * t, ay + (by - ay) * t, z0, ax + (bx - ax) * t, ay + (by - ay) * t, z1);
    }
    ctx.strokeStyle = PAL.glassJoint;
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    for (let d = 0.5; d < length - 0.01; d += 0.5) {
      const t = d / length;
      segment(ctx, camera, ax + (bx - ax) * t, ay + (by - ay) * t, z0, ax + (bx - ax) * t, ay + (by - ay) * t, z1);
    }
    for (let z = z0 + 0.5; z < z1 - 0.01; z += 0.5) {
      segment(ctx, camera, ax, ay, z, bx, by, z);
    }
    ctx.strokeStyle = PAL.fenceLine;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  path(ctx, camera, [ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1]);
  ctx.strokeStyle = PAL.glassEdge;
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

/** A line painted on the floor, as a strip so it narrows with the distance. */
function floorLine(ctx: Ctx, camera: Camera, x0: number, y0: number, x1: number, y1: number): void {
  const half = 0.045;
  if (x0 === x1) {
    path(ctx, camera, [x0 - half, y0, 0, x0 + half, y0, 0, x1 + half, y1, 0, x1 - half, y1, 0]);
  } else {
    path(ctx, camera, [x0, y0 - half, 0, x1, y1 - half, 0, x1, y1 + half, 0, x0, y0 + half, 0]);
  }
  ctx.fill();
}

/**
 * Everything that never moves and sits behind the players: floor, lines, the
 * far wall and both side walls.
 */
export function paintCourtBack(ctx: Ctx, camera: Camera, court: CourtConfig, width: number, height: number): void {
  const hw = court.halfWidth;
  const hl = court.halfLength;

  ctx.fillStyle = PAL.background;
  ctx.fillRect(0, 0, width, height);

  // Far back wall.
  panel(ctx, camera, 'glass', -hw, hl, hw, hl, 0, court.backGlass);
  panel(ctx, camera, 'fence', -hw, hl, hw, hl, court.backGlass, court.backFence);

  // Side walls, segment by segment from each back corner toward the net.
  for (const end of [1, -1]) {
    for (const wall of [-1, 1]) {
      let from = 0;
      for (const seg of court.side) {
        const ya = end * (hl - from);
        const yb = end * (hl - seg.upTo);
        panel(ctx, camera, 'glass', wall * hw, ya, wall * hw, yb, 0, seg.glass);
        panel(ctx, camera, 'fence', wall * hw, ya, wall * hw, yb, seg.glass, seg.fence);
        from = seg.upTo;
      }
    }
  }

  // Floor: the two halves in slightly different tones, so the net line reads.
  path(ctx, camera, [-hw, 0, 0, hw, 0, 0, hw, hl, 0, -hw, hl, 0]);
  ctx.fillStyle = PAL.floorFar;
  ctx.fill();
  path(ctx, camera, [-hw, -hl, 0, hw, -hl, 0, hw, 0, 0, -hw, 0, 0]);
  ctx.fillStyle = PAL.floorNear;
  ctx.fill();

  ctx.fillStyle = PAL.line;
  floorLine(ctx, camera, -hw, court.serviceLine, hw, court.serviceLine);
  floorLine(ctx, camera, -hw, -court.serviceLine, hw, -court.serviceLine);
  floorLine(ctx, camera, 0, -court.serviceLine, 0, court.serviceLine);

  // Outline of the floor: where the walls stand.
  path(ctx, camera, [-hw, -hl, 0, hw, -hl, 0, hw, hl, 0, -hw, hl, 0]);
  ctx.strokeStyle = PAL.glassEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** The net, which goes between the far and the near players. */
export function paintNet(ctx: Ctx, camera: Camera, court: CourtConfig): void {
  const hw = court.halfWidth;
  path(ctx, camera, [-hw, 0, 0, hw, 0, 0, hw, 0, court.netPost, 0, 0, court.netCenter, -hw, 0, court.netPost]);
  ctx.fillStyle = PAL.netFill;
  ctx.fill();

  ctx.beginPath();
  for (let x = -hw + 1; x < hw - 0.01; x += 1) {
    segment(ctx, camera, x, 0, 0, x, 0, netHeightAt(court, x));
  }
  segment(ctx, camera, -hw, 0, 0.45, hw, 0, 0.45);
  ctx.strokeStyle = PAL.netMesh;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  segment(ctx, camera, -hw, 0, court.netPost, 0, 0, court.netCenter);
  camera.project(hw, 0, court.netPost, p);
  ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = PAL.netTape;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.beginPath();
  segment(ctx, camera, -hw, 0, 0, -hw, 0, court.netPost);
  segment(ctx, camera, hw, 0, 0, hw, 0, court.netPost);
  ctx.lineWidth = 3;
  ctx.stroke();
}

/**
 * The near back wall stands between the camera and the player, so only its
 * edges are drawn: enough to know where it is without hiding the action.
 */
export function paintCourtFront(ctx: Ctx, camera: Camera, court: CourtConfig): void {
  const hw = court.halfWidth;
  const y = -court.halfLength;

  ctx.beginPath();
  for (let x = -hw + 2; x < hw - 0.01; x += 2) {
    segment(ctx, camera, x, y, 0, x, y, court.backGlass);
  }
  ctx.strokeStyle = PAL.frontJoint;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  segment(ctx, camera, -hw, y, court.backGlass, hw, y, court.backGlass);
  segment(ctx, camera, -hw, y, court.backFence, hw, y, court.backFence);
  segment(ctx, camera, -hw, y, 0, -hw, y, court.backFence);
  segment(ctx, camera, hw, y, 0, hw, y, court.backFence);
  ctx.strokeStyle = PAL.frontEdge;
  ctx.lineWidth = 1.25;
  ctx.stroke();
}
