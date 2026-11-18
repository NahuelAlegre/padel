import { clamp } from '../../core/math';

/**
 * The camera of the game, and the frame it is shown in.
 *
 * The court is not drawn every frame: its light was baked into pictures
 * rendered from one camera, the reference camera. The camera of the game is
 * that one, or something very close to it (a little to one side, a little
 * turned, a little closer), so the baked pictures still hold.
 *
 * World axes, in metres: x across the court (-5..5), y along it (-10 the
 * near back wall, +10 the far one, the net at 0), z up.
 *
 * Positions on screen are in "design pixels": the 390 x 844 frame the court
 * was composed for, measured from its centre. `Layout` says where that frame
 * falls on the real screen.
 */
export type Vec3 = [number, number, number];

export interface CameraSetup {
  pos: Vec3;
  /** Degrees it looks down, and degrees it is turned to the side. */
  pitch: number;
  yaw?: number;
  /** Focal length in design pixels. */
  f: number;
}

/** The camera the court was rendered from. */
export const REFERENCE = {
  pos: [0, -25.91, 16.52] as Vec3,
  pitch: 30,
  yaw: 0,
  f: 790.9,
  /** The frame the court was composed for. */
  design: [390, 844] as [number, number],
};

/** A point seen by a camera: design pixels from the centre of the frame, and depth along the view axis. */
export interface Seen {
  x: number;
  y: number;
  d: number;
}

export interface StageCamera {
  readonly pos: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly fwd: Vec3;
  readonly f: number;
  project(x: number, y: number, z: number, out: Seen): Seen;
}

export function makeCamera(setup: CameraSetup): StageCamera {
  const pitch = (setup.pitch * Math.PI) / 180;
  const yaw = ((setup.yaw ?? 0) * Math.PI) / 180;
  const pos: Vec3 = [setup.pos[0], setup.pos[1], setup.pos[2]];
  const right: Vec3 = [Math.cos(yaw), -Math.sin(yaw), 0];
  const fwd: Vec3 = [Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), -Math.sin(pitch)];
  const up: Vec3 = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const f = setup.f;
  return {
    pos,
    right,
    up,
    fwd,
    f,
    project(x, y, z, out) {
      const dx = x - pos[0];
      const dy = y - pos[1];
      const dz = z - pos[2];
      const d = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
      out.x = (f * (dx * right[0] + dy * right[1] + dz * right[2])) / d;
      out.y = (-f * (dx * up[0] + dy * up[1] + dz * up[2])) / d;
      out.d = d;
      return out;
    },
  };
}

/**
 * Where the design frame falls on a screen of `vw` x `vh` CSS pixels. The
 * frame always spans the width of the column; a taller screen shows more sky
 * and more of the ground in front.
 */
export interface Layout {
  vw: number;
  vh: number;
  /** CSS pixels per design pixel. */
  s: number;
  /** Width of the column the game is shown in, and where it starts. */
  colW: number;
  colX: number;
  /** Height that is visible, in design pixels, and the design row at its centre. */
  visH: number;
  cy: number;
  /** CSS position of the centre of the design frame. */
  ox: number;
  oy: number;
}

export function layout(vw: number, vh: number): Layout {
  const [dw, dh] = REFERENCE.design;
  const colW = Math.min(vw, vh * (dw / 700));
  const s = colW / dw;
  const visH = vh / s;
  const cy = clamp(dh / 2 + 6, visH / 2 - dh * 0.1, dh * 1.1 - visH / 2);
  return { vw, vh, s, colW, colX: (vw - colW) / 2, visH, cy, ox: vw / 2, oy: vh / 2 - (cy - dh / 2) * s };
}

/**
 * Limits of the camera that follows the play. In padel a ball that gets past
 * the player is still alive, because it comes back off the glass, so the
 * camera never sticks to the player: it stays half way between showing the
 * whole court and getting close, and what it gains by moving is that the
 * court feels bigger.
 *
 *   1. Always in view, with room to spare: the person's player, the ball,
 *      where it is going to bounce, and the person's own back glass.
 *   2. The rival and the net, always in view.
 *   3. It pans sideways and zooms a little, within strict limits. Nothing else.
 *   4. It opens up for a lob or a ball going deep, and closes in at the net.
 *   5. A dead zone and smoothing: it does not follow every step and never jumps.
 *   6. With reduced motion it does not move at all.
 */
export const FOLLOW = {
  zoomMin: 1.0,
  zoomMax: 1.3,
  /** Open, middle, and with the play at the net. */
  zoomOpen: 1.04,
  zoomMid: 1.16,
  zoomNet: 1.28,
  /** Share of the pan that is the camera sliding sideways (which gives parallax); the rest is turning. */
  panShare: 0.55,
  /** Room each thing keeps to the side edges, in design pixels. */
  margin: { player: 52, ball: 26, mark: 30, rival: 24 },
  /** The least room nothing ever loses, not even half way through a move. */
  hard: 10,
  /** Bands kept free at the bottom (the thumbs) and at the top (the score), in design pixels. */
  bottom: 78,
  top: 34,
  /** Metres the ideal framing has to change before the camera starts to move. */
  deadZone: 0.5,
  /** Metres per second at which the pan goes after the ideal framing. */
  panSpeed: 1.7,
  /**
   * Metres per second at which it catches up when the play got ahead of it and
   * something is about to leave the frame: fast, but still a movement.
   */
  rescueSpeed: 6,
  /** Seconds it waits before closing in; it opens up at once. */
  closeDelay: 0.35,
};

/** How far along the court a point of the camera's turn is taken to be, in metres. */
const TURN_REACH = 28;
const HALF_LENGTH = 10;

/** The camera of the game for a pan (metres) and a zoom. With no pan and zoom 1 it is the reference camera. */
export function followCamera(pan: number, zoom: number): StageCamera {
  const slide = pan * FOLLOW.panShare;
  return makeCamera({
    pos: [REFERENCE.pos[0] + slide, REFERENCE.pos[1], REFERENCE.pos[2]],
    pitch: REFERENCE.pitch,
    yaw: (Math.atan2(pan - slide, TURN_REACH) * 180) / Math.PI,
    f: REFERENCE.f * zoom,
  });
}

/** Somebody on court, as the camera needs to know it. `k` is how much bigger than life it is drawn. */
export interface Framed {
  x: number;
  y: number;
  k: number;
}

/** What the camera looks at in one frame. */
export interface FollowContext {
  /** The person's player, and anybody else on that side. */
  player: Framed;
  mates: readonly Framed[];
  rivals: readonly Framed[];
  ball: { x: number; y: number; z: number; vy: number; visible: boolean; held: boolean };
  /** Where the ball is going to bounce on the person's side, when it is known. */
  mark: { x: number; y: number } | null;
  lay: Layout;
  /** Extra room to keep free at the top and at the bottom, in design pixels (the notch, the home bar). */
  top: number;
  bottom: number;
}

type Shot = 'open' | 'mid' | 'net';

interface Item {
  x0: number;
  y0: number;
  /** Design pixels the point moves for every metre of pan. */
  g: number;
  /** How far from the centre it may get. */
  limit: number;
}

function spring(current: number, velocity: number, target: number, k: number, dt: number): [number, number] {
  const next = velocity + ((target - current) * k * k - 2 * k * velocity) * dt;
  return [current + next * dt, next];
}

/**
 * The camera that goes with the play. `update` moves it a frame; `jump` puts
 * it where it wants to be at once (a new point, a new match), or back to the
 * still camera when it is not to follow.
 */
export class Follow {
  pan = 0;
  zoom = 1;
  /** True while the pan is on its way somewhere. */
  moving = false;
  shot: Shot = 'mid';

  private panSpeed = 0;
  private zoomSpeed = 0;
  private target = 0;
  private timer = 0;
  private readonly ref = makeCamera(REFERENCE);
  private readonly shifted = followCamera(1, 1);
  private readonly a: Seen = { x: 0, y: 0, d: 0 };
  private readonly b: Seen = { x: 0, y: 0, d: 0 };
  private readonly half = REFERENCE.design[0] / 2;
  private readonly nearShift: number;
  private readonly items: Item[] = [];
  private used = 0;

  constructor() {
    this.nearShift = this.measure(0, -HALF_LENGTH, 0, 0).g;
    this.used = 0;
  }

  /** How much of the pan is the camera turning, as a shift of the sky in design pixels. */
  get skyShift(): number {
    return (-REFERENCE.f * (this.pan - this.pan * FOLLOW.panShare)) / TURN_REACH;
  }

  camera(): StageCamera {
    return followCamera(this.pan, this.zoom);
  }

  update(ctx: FollowContext, dt: number): void {
    const step = Math.min(dt, 0.05);
    const plan = this.plan(ctx);
    // It opens up at once and waits a moment before closing in.
    if (plan.want !== this.shot) {
      this.timer += step;
      if (this.timer >= (plan.want === 'open' ? 0 : FOLLOW.closeDelay)) {
        this.shot = plan.want;
        this.timer = 0;
      }
    } else {
      this.timer = 0;
    }
    const wanted = clamp(Math.min(zoomOf(this.shot), plan.cap), FOLLOW.zoomMin, FOLLOW.zoomMax);
    const [zoomTarget, lo, hi] = this.fit(wanted);
    // Dead zone: the target only moves if something touches its margin or the ideal framing got far.
    const preferred = clamp(plan.preferred, lo, hi);
    if (this.target < lo) this.target = lo;
    else if (this.target > hi) this.target = hi;
    if (!this.moving && Math.abs(preferred - this.target) > FOLLOW.deadZone) this.moving = true;
    if (this.moving) {
      this.target += clamp(preferred - this.target, -FOLLOW.panSpeed * step, FOLLOW.panSpeed * step);
      if (Math.abs(preferred - this.target) < 0.06) this.moving = false;
    }
    [this.pan, this.panSpeed] = spring(this.pan, this.panSpeed, this.target, 3.0, step);
    // Opens fast, closes more slowly.
    [this.zoom, this.zoomSpeed] = spring(this.zoom, this.zoomSpeed, zoomTarget, zoomTarget < this.zoom ? 2.8 : 1.9, step);
    this.zoom = clamp(this.zoom, FOLLOW.zoomMin, FOLLOW.zoomMax);
    // A guarantee: nothing that matters is left at the edge. When the play got
    // ahead of the camera (a fast ball to a corner while it was closed in) it
    // catches up quickly, but it goes there: it never jumps.
    const [hardLo, hardHi] = this.interval(this.zoom, true);
    if (hardLo <= hardHi) {
      const inside = clamp(this.pan, hardLo, hardHi);
      if (inside !== this.pan) {
        const most = FOLLOW.rescueSpeed * step;
        const move = clamp(inside - this.pan, -most, most);
        this.pan += move;
        // The spring does not pull against the rescue.
        this.panSpeed = move > 0 ? Math.max(0, this.panSpeed) : Math.min(0, this.panSpeed);
      }
    }
  }

  jump(ctx: FollowContext, enabled: boolean): void {
    this.panSpeed = 0;
    this.zoomSpeed = 0;
    this.timer = 0;
    this.moving = false;
    if (!enabled) {
      this.pan = 0;
      this.target = 0;
      this.zoom = 1;
      return;
    }
    const plan = this.plan(ctx);
    this.shot = plan.want;
    const wanted = clamp(Math.min(zoomOf(this.shot), plan.cap), FOLLOW.zoomMin, FOLLOW.zoomMax);
    const [zoomTarget, lo, hi] = this.fit(wanted);
    this.zoom = zoomTarget;
    this.pan = clamp(plan.preferred, lo, hi);
    this.target = this.pan;
  }

  /** Where a point falls with the reference camera, and how much it moves per metre of pan. */
  private measure(x: number, y: number, z: number, margin: number): Item {
    this.ref.project(x, y, z, this.a);
    this.shifted.project(x, y, z, this.b);
    let item = this.items[this.used];
    if (!item) {
      item = { x0: 0, y0: 0, g: 0, limit: 0 };
      this.items.push(item);
    }
    this.used++;
    item.x0 = this.a.x;
    item.y0 = this.a.y;
    item.g = this.a.x - this.b.x;
    item.limit = this.half - margin;
    return item;
  }

  private sideFrom = 0;
  private sideTo = 0;

  /** What the play asks for: which shot, the most zoom everything fits in, and where the pan would like to be. */
  private plan(ctx: FollowContext): { want: Shot; cap: number; preferred: number } {
    const { player, ball, mark, lay } = ctx;
    const live = ball.visible && !ball.held;
    let want: Shot = 'mid';
    if (live && (ball.z > 2.6 || (mark !== null && mark.y < -5) || (ball.y < -6.8 && ball.vy < 0.5))) want = 'open';
    else if (player.y > -5.6) want = 'net';

    // From top to bottom: the rival, the ball and the person's own glass have to fit.
    const half = REFERENCE.design[1] / 2;
    const visTop = lay.cy - half - lay.visH / 2 + FOLLOW.top + ctx.top;
    const visBottom = lay.cy - half + lay.visH / 2 - FOLLOW.bottom - ctx.bottom;
    let cap = FOLLOW.zoomMax;
    this.used = 0;
    const down = [
      this.measure(0, -HALF_LENGTH, 0, 0).y0,
      this.measure(player.x, Math.max(-HALF_LENGTH, player.y - 2.5), 0, 0).y0,
    ];
    for (const y0 of down) if (y0 > 1) cap = Math.min(cap, visBottom / y0);
    const up = [this.measure(0, 0, 1.0, 0).y0];
    for (const rival of ctx.rivals) up.push(this.measure(rival.x, rival.y, 1.95 * rival.k, 0).y0);
    if (live) up.push(this.measure(ball.x, ball.y, ball.z + 0.2, 0).y0);
    for (const y0 of up) if (y0 < -1) cap = Math.min(cap, visTop / y0);

    // From side to side: everybody on court, the ball and its mark.
    this.used = 0;
    this.sideFrom = 0;
    this.measure(player.x, player.y, 0.9 * player.k, FOLLOW.margin.player);
    for (const mate of ctx.mates) this.measure(mate.x, mate.y, 0.9 * mate.k, FOLLOW.margin.player);
    for (const rival of ctx.rivals) this.measure(rival.x, rival.y, 0.9 * rival.k, FOLLOW.margin.rival);
    if (live) this.measure(ball.x, ball.y, ball.z, FOLLOW.margin.ball);
    if (mark) this.measure(mark.x, mark.y, 0, FOLLOW.margin.mark);
    this.sideTo = this.used;
    return { want, cap, preferred: 0.62 * player.x };
  }

  /** The pans that keep every point inside its margin at a given zoom: [from, to, whether there is any]. */
  private interval(zoom: number, hard: boolean): [number, number, boolean] {
    let lo = -Infinity;
    let hi = Infinity;
    for (let i = this.sideFrom; i < this.sideTo; i++) {
      const item = this.items[i]!;
      const limit = hard ? this.half - FOLLOW.hard : item.limit;
      lo = Math.max(lo, (item.x0 - limit / zoom) / item.g);
      hi = Math.min(hi, (item.x0 + limit / zoom) / item.g);
    }
    // Not much further than the side walls.
    const most = Math.max(0.35, (zoom * 189 - this.half + 30) / this.nearShift);
    return [Math.max(lo, -most), Math.min(hi, most), lo <= hi];
  }

  /** If not everything fits at that zoom, it opens up until it does. */
  private fit(zoom: number): [number, number, number] {
    let z = zoom;
    let [lo, hi, fits] = this.interval(z, false);
    for (let n = 0; n < 8 && !fits && z > FOLLOW.zoomMin; n++) {
      z = Math.max(FOLLOW.zoomMin, z - 0.035);
      [lo, hi, fits] = this.interval(z, false);
    }
    return [z, lo, hi];
  }
}

function zoomOf(shot: Shot): number {
  return shot === 'open' ? FOLLOW.zoomOpen : shot === 'net' ? FOLLOW.zoomNet : FOLLOW.zoomMid;
}

/** How much bigger than life somebody is drawn: a little near the camera, more at the far end. */
export const FIGURE_SCALE = { near: 1.2, far: 1.5 };

export function figureScale(y: number): number {
  return FIGURE_SCALE.near + (FIGURE_SCALE.far - FIGURE_SCALE.near) * clamp((y + 8) / 16, 0, 1);
}
