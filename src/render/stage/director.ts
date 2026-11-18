import { clamp, smoothstep } from '../../core/math';
import type { Insets } from '../../core/layout';
import type { SimEvent } from '../../sim/match';
import type { ShotKind } from '../../sim/types';
import type { Scene, ScenePlayer } from '../scene';
import type { CameraName } from '../view';
import { figureScale, Follow, makeCamera, REFERENCE, type FollowContext, type Framed } from './camera';
import { EFFECT_SECONDS, type EffectFrame, type FigureFrame, type MarkFrame, type StageFrame } from './frame';
import type { StageView } from './view';

/**
 * Decides what a frame shows, for whoever draws it.
 *
 * It reads the scene and works out the camera, how big each player is drawn,
 * the few marks on the floor, the short effects of the impacts and the name
 * of a special shot. All the judgement about keeping the screen clean that
 * depends on how things look is here; what exists at all is decided earlier,
 * when the scene is filled.
 */

/** Shots that get their name on screen even with the minimal help: the ones worth learning. */
const SPECIAL: ReadonlySet<ShotKind> = new Set<ShotKind>(['bandeja', 'vibora', 'wallExit', 'smash', 'backWall']);
/** Seconds a name stays up. */
export const LABEL_SECONDS = 0.85;
/** The ball leaves a short trail above this speed, in metres per second. */
const TRAIL_SPEED = 5;
const TRAIL_POINTS = 5;
const TRAIL_STEP = 0.014;
/** The timing signal lights up this long before the contact. */
const GLOW_LEAD = 0.18;
const GLOW_TAIL = 0.07;
/** Seconds the ball of a serve takes to get from where it was shown in the hand to where it really is. */
const SERVE_BLEND = 0.12;

/** A name over a player for a moment. */
export interface LabelFrame {
  /** Position in `scene.players` of whoever it is about. */
  player: number;
  /** The word about how it was timed, for those who ask for every aid; empty otherwise. */
  title: string;
  /** The name of the shot. */
  text: string;
  /** Seconds it has been up. */
  age: number;
  strong: boolean;
}

interface Effect {
  kind: EffectFrame['kind'];
  x: number;
  y: number;
  z: number;
  age: number;
  strong: boolean;
}

export interface DirectorTexts {
  shotName(kind: ShotKind, forehand: boolean, volley: boolean): string;
  quality: Record<'perfect' | 'good' | 'early' | 'late', string>;
  tooFar: string;
}

export class Director {
  cameraName: CameraName = 'follow';
  readonly follow = new Follow();
  readonly frame: StageFrame;
  /** The name on screen, if there is one. One at a time. */
  label: LabelFrame | null = null;

  private readonly effects: Effect[] = [];
  private readonly effectFrames: EffectFrame[] = [];
  private readonly figures: FigureFrame[] = [];
  private readonly bounce: MarkFrame = mark('cream');
  private readonly aim: MarkFrame = mark('coral');
  private readonly guide = { x: 0, y: 0, alpha: 1 };
  private readonly ring = { x: 0, y: 0, k: 1 };
  private readonly timing = { x: 0, y: 0, z: 0, eta: 0, perfect: 0, good: 0 };
  private bounceAge = 0;
  private aimAge = 0;
  private jump = true;
  /** How far from where it really is the ball of a serve is shown, and for how much longer. */
  private readonly inHand = { x: 0, y: 0, z: 0, left: 0 };
  private readonly context: FollowContext;
  private readonly mates: Framed[] = [];
  private readonly rivals: Framed[] = [];
  private readonly seen = { x: 0, y: 0, d: 0 };
  private readonly labelSlot: LabelFrame = { player: 0, title: '', text: '', age: 0, strong: false };

  constructor(
    view: StageView,
    private readonly texts: DirectorTexts,
    /** The colours of each player, by position in the scene. */
    private readonly paletteFor: (player: ScenePlayer) => Float32Array,
  ) {
    this.frame = {
      view,
      skyShift: 0,
      figures: this.figures,
      ball: { x: 0, y: 0, z: 0, visible: true, glow: 0, trail: new Float32Array(TRAIL_POINTS * 3), trailCount: 0 },
      bounce: null,
      aim: null,
      guide: null,
      ring: null,
      timing: null,
      effects: this.effectFrames,
    };
    this.context = {
      player: { x: 0, y: -7, k: 1.2 },
      mates: this.mates,
      rivals: this.rivals,
      ball: { x: 0, y: 0, z: 0, vy: 0, visible: true, held: false },
      mark: null,
      lay: view.lay,
      top: 0,
      bottom: 0,
    };
  }

  /** A new match or a new point: nothing left over, and the camera goes straight to its place. */
  reset(): void {
    this.effects.length = 0;
    this.label = null;
    this.bounceAge = 0;
    this.aimAge = 0;
    this.jump = true;
  }

  onEvent(event: SimEvent, scene: Scene): void {
    const quiet = scene.reduceMotion;
    switch (event.type) {
      case 'serveReady':
        // Everybody has just been put in place for the serve.
        this.jump = true;
        break;
      case 'bounce':
        if (!quiet) this.spawn('bounce', event.x, event.y, 0, false);
        break;
      case 'wall':
        if (!quiet && event.surface === 'glass') this.spawn('glass', event.x, event.y, event.z, false);
        break;
      case 'hit': {
        if (!quiet) this.spawn('hit', event.x, event.y, event.z, event.quality === 'perfect' || event.kind === 'smash');
        const player = scene.players[event.player];
        if (!player?.isHuman || event.kind === 'serve' || scene.aids === 'none') break;
        // With all the help: how it was timed and what it was, always. Otherwise only the shots worth a name.
        const full = scene.aids === 'full';
        if (!full && !SPECIAL.has(event.kind)) break;
        let text = this.texts.shotName(event.kind, event.forehand, event.volley);
        if (event.kind === 'smash' && !full) text = `¡${text}!`;
        if (scene.debug) {
          const ms = Math.round(event.error * 1000);
          text += ` · ${ms > 0 ? '+' : ''}${ms} ms`;
        }
        this.say(event.player, full ? this.texts.quality[event.quality] : '', text, event.kind === 'smash' || event.quality === 'perfect');
        break;
      }
      case 'whiff': {
        const player = scene.players[event.player];
        if (player?.isHuman && event.reason === 'far' && scene.aids === 'full') this.say(event.player, '', this.texts.tooFar, false);
        break;
      }
      default:
        break;
    }
  }

  private spawn(kind: Effect['kind'], x: number, y: number, z: number, strong: boolean): void {
    this.effects.push({ kind, x, y, z, age: 0, strong });
  }

  private say(player: number, title: string, text: string, strong: boolean): void {
    const label = this.labelSlot;
    label.player = player;
    label.title = title;
    label.text = text;
    label.age = 0;
    label.strong = strong;
    this.label = label;
  }

  /**
   * Works out the frame. `canFollow` is whether whoever draws can move the
   * camera at all; `safe` is what the device keeps for itself around the screen.
   */
  update(scene: Scene, dt: number, canFollow: boolean, safe: Insets): StageFrame {
    const frame = this.frame;
    const view = frame.view;

    // ------------------------------------------------------------ who is where
    const figures = this.figures;
    let own: ScenePlayer | null = null;
    for (let i = 0; i < scene.players.length; i++) {
      const player = scene.players[i]!;
      let figure = figures[i];
      if (!figure) {
        figure = { player, x: 0, y: 0, k: 1, facing: 1, depth: 30, palette: this.paletteFor(player), bones: null };
        figures[i] = figure;
      }
      figure.player = player;
      figure.x = player.x;
      figure.y = player.y;
      figure.k = figureScale(player.y);
      figure.facing = player.team === 0 ? 1 : -1;
      figure.palette = this.paletteFor(player);
      if (player.isHuman && !own) own = player;
    }
    figures.length = scene.players.length;
    // With nobody playing (the demo) the camera goes with whoever is on the near side.
    const lead = own ?? scene.players.find((player) => player.team === 0) ?? scene.players[0] ?? null;

    // ------------------------------------------------------------ the camera
    const ball = scene.ball;
    const context = this.context;
    context.lay = view.lay;
    context.top = safe.top / view.lay.s;
    context.bottom = safe.bottom / view.lay.s;
    this.mates.length = 0;
    this.rivals.length = 0;
    if (lead) {
      context.player.x = lead.x;
      context.player.y = lead.y;
      context.player.k = figureScale(lead.y);
      for (const player of scene.players) {
        if (player === lead) continue;
        const framed = { x: player.x, y: player.y, k: figureScale(player.y) };
        if (player.team === lead.team) this.mates.push(framed);
        else this.rivals.push(framed);
      }
    }
    context.ball.x = ball.x;
    context.ball.y = ball.y;
    context.ball.z = ball.z;
    context.ball.vy = ball.vy;
    // A ball that is no longer in play is not worth a move of the camera.
    context.ball.visible = ball.visible && ball.live;
    context.ball.held = ball.held;
    const landing = scene.bounce;
    context.mark = landing && landing.y < 0 ? landing : null;
    // A camera that does not follow does not move at all: not even on its way back to the middle.
    const following = canFollow && this.cameraName === 'follow' && !scene.reduceMotion;
    if (this.jump || !following) {
      this.follow.jump(context, following);
      this.jump = false;
    } else {
      this.follow.update(context, dt);
    }
    // Without any movement left it is exactly the camera the court was rendered from.
    const still = Math.abs(this.follow.pan) < 1e-4 && Math.abs(this.follow.zoom - 1) < 1e-4;
    view.cam = still ? this.reference : this.follow.camera();
    frame.skyShift = still ? 0 : this.follow.skyShift;
    for (const figure of figures) {
      view.cam.project(figure.x, figure.y, 1, this.seen);
      figure.depth = this.seen.d;
    }

    // ------------------------------------------------------------ the ball
    const out = frame.ball;
    out.x = ball.x;
    out.y = ball.y;
    out.z = Math.max(0.033, ball.z);
    out.visible = ball.visible;
    // Before a serve the ball is in the server's hand and then drops from it.
    // The server is drawn bigger than life, so its hand is further out and
    // higher than the simulation has the ball: the ball is shown where the
    // hand is, and slides to its real place right after it is hit.
    const hand = this.inHand;
    const server = scene.serving >= 0 && !ball.live ? scene.players[scene.serving] : undefined;
    if (server) {
      const more = figureScale(server.y) - 1;
      hand.x = (ball.x - server.x) * more;
      hand.y = (ball.y - server.y) * more;
      hand.z = ball.z * more;
      hand.left = SERVE_BLEND;
    } else if (hand.left > 0) {
      hand.left = Math.max(0, hand.left - dt);
    }
    if (hand.left > 0) {
      const w = hand.left / SERVE_BLEND;
      out.x += hand.x * w;
      out.y += hand.y * w;
      out.z += hand.z * w;
    }
    out.trailCount = 0;
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    if (ball.visible && !ball.held && speed > TRAIL_SPEED && !scene.reduceMotion) {
      for (let k = 1; k <= TRAIL_POINTS; k++) {
        const back = k * TRAIL_STEP;
        const o = (k - 1) * 3;
        out.trail[o] = ball.x - ball.vx * back;
        out.trail[o + 1] = ball.y - ball.vy * back;
        out.trail[o + 2] = Math.max(0.033, ball.z - ball.vz * back);
      }
      out.trailCount = TRAIL_POINTS;
    }
    // The one timing signal: the ball lights up in the last instant before the person has to hit it.
    const contact = scene.contact;
    out.glow = 0;
    if (contact && scene.aids === 'minimal' && !ball.held) {
      const eta = contact.eta;
      const lit = eta >= 0 ? (eta < GLOW_LEAD ? smoothstep(0, 1, 1 - eta / GLOW_LEAD) : 0) : eta > -GLOW_TAIL ? 1 + eta / GLOW_TAIL : 0;
      out.glow = lit * scene.aidStrength;
    }

    // ------------------------------------------------------------ marks on the floor
    const full = scene.aids === 'full';
    frame.bounce = null;
    if (landing) {
      this.bounceAge += dt;
      const m = this.bounce;
      m.x = landing.x;
      m.y = landing.y;
      const appear = smoothstep(0, 0.12, this.bounceAge);
      if (full) {
        m.radius = landing.first ? 0.4 : 0.3;
        m.alpha = (landing.first ? 0.95 : 0.6) * appear;
      } else {
        // Small and thin, and smaller still as the ball gets there.
        m.radius = 0.21 + 0.05 * clamp(landing.eta / 0.6, 0, 1);
        m.alpha = 0.8 * appear * scene.aidStrength;
      }
      m.progress = 1 - clamp(landing.eta / 1.2, 0, 1);
      m.double = false;
      m.halo = 0;
      if (m.alpha > 0.01) frame.bounce = m;
    } else {
      this.bounceAge = 0;
    }

    frame.aim = null;
    const target = scene.aim;
    if (target) {
      this.aimAge += dt;
      const m = this.aim;
      m.x = target.x;
      m.y = target.y;
      const small = target.kind === 'drop';
      m.radius = full ? (small ? 0.38 : 0.55) : small ? 0.24 : 0.34;
      m.alpha = (target.armed ? 1 : 0.9) * smoothstep(0, 0.08, this.aimAge);
      m.progress = 0;
      // A lob comes down from above: a second ring. It is how the mark says
      // the thumb has gone far enough, without a word.
      m.double = target.kind === 'lob';
      m.halo = full ? target.risk : 0;
      frame.aim = m;
    } else {
      this.aimAge = 0;
    }

    frame.guide = null;
    if (scene.guide) {
      this.guide.x = scene.guide.x;
      this.guide.y = scene.guide.y;
      frame.guide = this.guide;
    }
    frame.ring = null;
    if (full && own) {
      this.ring.x = own.x;
      this.ring.y = own.y;
      this.ring.k = figureScale(own.y);
      frame.ring = this.ring;
    }
    frame.timing = null;
    if (full && contact) {
      const t = this.timing;
      t.x = contact.x;
      t.y = contact.y;
      t.z = contact.z;
      t.eta = contact.eta;
      t.perfect = contact.perfect;
      t.good = contact.good;
      frame.timing = t;
    }

    // ------------------------------------------------------------ what just happened
    const effects = this.effects;
    const frames = this.effectFrames;
    let count = 0;
    for (let i = effects.length - 1; i >= 0; i--) {
      const effect = effects[i]!;
      effect.age += dt;
      if (effect.age >= EFFECT_SECONDS[effect.kind]) effects.splice(i, 1);
    }
    for (const effect of effects) {
      let slot = frames[count];
      if (!slot) {
        slot = { kind: effect.kind, x: 0, y: 0, z: 0, age: 0, strong: false };
        frames[count] = slot;
      }
      slot.kind = effect.kind;
      slot.x = effect.x;
      slot.y = effect.y;
      slot.z = effect.z;
      slot.age = effect.age / EFFECT_SECONDS[effect.kind];
      slot.strong = effect.strong;
      count++;
    }
    frames.length = count;

    if (this.label) {
      this.label.age += dt;
      if (this.label.age >= LABEL_SECONDS) this.label = null;
    }
    return frame;
  }

  private readonly reference = makeCamera(REFERENCE);
}

function mark(tone: MarkFrame['tone']): MarkFrame {
  return { x: 0, y: 0, radius: 0.3, alpha: 0, progress: 0, tone, double: false, halo: 0 };
}
