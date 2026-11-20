import type { Game } from '../app/game';
import type { Launch } from '../platform/types';
import type { Scene, StudioView } from '../render/scene';
import type { CallKind } from '../sim/pair';
import { Scan, SIGN, SITUATION, SITUATIONS, type Calm, type Moment, type SituationId } from './situations';
import { snapshot } from './snapshot';
import { stagedCall, stagedRun, stagedSteal, stagedTics, type Staged } from './stage';
import { StudioUI, type CameraChoice, type Speed, type StudioHandlers } from './ui';

/**
 * The animation studio (`?estudio`, `?estudio=bloqueo`): every situation of
 * the game, to look at without playing, in a loop, slowed down or frame by
 * frame. It is the game itself: the same match, rules, court and renderer.
 *
 * The computer plays a demo against itself that is always the same, and the
 * studio looks through it without drawing it, keeping a copy of the match a
 * moment before the best example of each situation. Showing one is playing
 * on from that copy with the game's own `advance`; looping is going back to
 * the copy. What the demo never shows is staged (see `stage.ts`).
 *
 * This file is its own script, apart from the game's: only `?estudio`
 * downloads it.
 */

/**
 * The demos it looks through, always the same ones, one after the other
 * until every situation has turned up: some are rare (a block, a smash, a
 * ball stolen from the partner).
 */
const SEEDS = [7, 1, 2, 3, 4, 5];
/** Seconds of each demo it looks through, at the most. */
const LOOK_THROUGH = 240;
/** Going frame by frame, a frame is a sixtieth of a second of play. */
const FRAME = 1 / 60;
const SPEEDS: Speed[] = [1, 0.5, 0.25];

/** What the studio is doing, for automated checks. */
export interface StudioStatus {
  ready: boolean;
  situation: SituationId | null;
  near: boolean;
  /** Position in `match.players` of the player on show. */
  player: number;
  playing: boolean;
  /** Frames shown so far, and seconds into the loop. */
  frames: number;
  time: number;
  /** How many situations it can show. */
  found: number;
  /** Goes to `seconds` into the loop and stays there, as frame by frame does; or to its key instant, without them. */
  at?(seconds?: number): void;
}

declare global {
  interface Window {
    padelStudio?: StudioStatus;
  }
}

export function open(game: Game, wanted: string | null, launch: Launch): void {
  const studio = new Studio(game, launch);
  window.padelStudio = studio.status;
  void studio.start(wanted);
}

/** A situation asked for by name, as anybody would type it: «no llegó», «perdon», «Split step». */
function situationFrom(name: string | null): SituationId | null {
  if (!name) return null;
  const plain = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
  const found = SITUATIONS.find((situation) => situation.id === plain || situation.label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '-') === plain);
  return found ? found.id : null;
}

/** Lets the page breathe (and say how far the search got) between two slices of it, without waiting for a frame. */
const breathe = (): Promise<void> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });

class Studio {
  readonly status: StudioStatus = { ready: false, situation: null, near: true, player: 0, playing: true, frames: 0, time: 0, found: 0 };
  private readonly ui: StudioUI;
  private moments = new Map<string, Moment>();
  private calm: Calm | null = null;
  private situation: SituationId = 'derecha';
  private near = true;
  private readonly view: StudioView = { focus: 0, camera: 'game', look: '3d' };
  private speed: Speed = 1;
  private playing = true;
  private ready = false;
  /** What is on show: a real moment, or something staged over a court waiting for a serve. */
  private moment: Moment | null = null;
  private staged: Staged | null = null;
  private stagedBase: Scene | null = null;
  private stagedScene: Scene | null = null;
  /** Seconds of play into the loop. */
  private t = 0;
  private last = 0;
  private shownNote = '';

  constructor(
    private readonly game: Game,
    private readonly launch: Launch,
  ) {
    const stage = document.querySelector<HTMLElement>('#stage') ?? document.body;
    const handlers: StudioHandlers = {
      situation: (id) => this.choose(id, this.near),
      camera: (camera) => this.setCamera(camera),
      side: (near) => this.choose(this.situation, near),
      character: (character) => {
        this.view.character = character;
        this.again();
      },
      look: (look) => {
        this.view.look = look;
        this.again();
      },
      play: () => {
        this.playing = !this.playing;
        this.refresh();
      },
      step: (direction) => this.step(direction),
      repeat: () => {
        this.restart();
        this.playing = true;
        this.refresh();
      },
      speed: () => {
        this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length]!;
        this.refresh();
      },
      exit: () => this.launch.reopen(''),
    };
    this.ui = new StudioUI(stage, handlers);
    window.addEventListener('keydown', (event) => {
      if (!this.ready) return;
      if (event.key === ' ') handlers.play();
      else if (event.key === 'ArrowRight') handlers.step(1);
      else if (event.key === 'ArrowLeft') handlers.step(-1);
      else if (event.key === 'r' || event.key === 'R') handlers.repeat();
      else return;
      event.preventDefault();
    });
  }

  async start(wanted: string | null): Promise<void> {
    this.status.at = (seconds) => this.at(seconds);
    const game = this.game;
    game.renderer.studio?.(this.view);
    this.ui.working('Buscando situaciones…');
    const real = SITUATIONS.filter((situation) => situation.source === 'real');
    for (let i = 0; i < SEEDS.length; i++) {
      game.startFixedDemo(SEEDS[i]!);
      game.stopLoop();
      const scan = new Scan(game.match, LOOK_THROUGH);
      while (!scan.done) {
        scan.run(12);
        this.ui.working(`Buscando situaciones… ${Math.round(((i + scan.progress) / SEEDS.length) * 100)} %`);
        await breathe();
      }
      // The best example of each, whichever demo it came from.
      for (const [key, moment] of scan.found) {
        const old = this.moments.get(key);
        if (!old || old.score < moment.score) this.moments.set(key, moment);
      }
      this.calm ??= scan.calm;
      if (real.every((situation) => this.has(situation.id))) break;
    }
    const available = new Set(SITUATIONS.filter((situation) => this.has(situation.id)).map((situation) => situation.id));
    this.ui.available(available);
    this.ui.working(null);
    this.status.found = available.size;

    // Whatever wants to draw the game now draws what the studio is showing.
    game.renderer.onChange = () => this.redraw();
    window.addEventListener('resize', () => this.redraw());
    const asked = situationFrom(wanted);
    const first = asked && available.has(asked) ? asked : available.has('derecha') ? 'derecha' : [...available][0];
    this.ready = true;
    this.status.ready = true;
    if (first) this.choose(first, true);
    requestAnimationFrame(this.frame);
  }

  /** Whether a situation can be shown: found in the demo, or staged over a court waiting for a serve. */
  private has(id: SituationId): boolean {
    const source = SITUATION[id].source;
    const found = this.moments.has(Scan.key(id, true)) || this.moments.has(Scan.key(id, false));
    if (source === 'real') return found;
    return found || this.calm !== null;
  }

  private choose(id: SituationId, near: boolean): void {
    const game = this.game;
    const situation = SITUATION[id];
    const real = situation.source === 'staged' ? undefined : (this.moments.get(Scan.key(id, near)) ?? this.moments.get(Scan.key(id, !near)));
    if (real) {
      this.moment = real;
      this.staged = null;
      this.stagedBase = null;
      this.near = real.near;
      this.view.focus = real.player;
    } else if (this.calm) {
      // Over a court waiting for a serve: the scene of that moment, to stage on.
      game.match = snapshot(this.calm.match);
      game.renderer.reset();
      game.advance(0);
      const base = structuredClone(game.scene);
      const index = Math.max(
        0,
        base.players.findIndex((player) => player.team === (near ? 0 : 1)),
      );
      this.moment = null;
      this.near = base.players[index]?.team === 0;
      this.view.focus = index;
      this.stagedBase = base;
      const call = (Object.keys(SIGN) as CallKind[]).find((kind) => SIGN[kind] === id);
      this.staged =
        id === 'estocada' ? stagedRun(base, index) : id === 'manias' ? stagedTics(base, index) : call ? stagedCall(base, index, call) : stagedSteal(base, index, id === 'robo');
    } else {
      return;
    }
    this.situation = id;
    // A new situation is shown as it is: whoever it is, as itself.
    this.view.character = undefined;
    this.status.situation = id;
    this.status.near = this.near;
    this.status.player = this.view.focus;
    this.launch.note(`estudio=${id}`);
    this.restart();
    this.refresh();
  }

  private setCamera(camera: CameraChoice): void {
    this.view.camera = camera;
    if (!this.playing) this.redraw();
    this.refresh();
  }

  /** From the start of the loop: back to the copy of the match, or to the start of what is staged. */
  private restart(): void {
    const game = this.game;
    game.renderer.reset();
    this.t = 0;
    if (this.moment) {
      game.match = snapshot(this.moment.from);
      game.advance(0);
    } else if (this.staged && this.stagedBase) {
      this.stagedScene = structuredClone(this.stagedBase);
      this.staged.at(this.stagedScene, 0, 0, this.react);
      game.renderer.render(this.stagedScene, 0);
    }
  }

  /** `d` seconds of play on: the game's own frame, or the next frame of what is staged. */
  private advance(d: number): void {
    const game = this.game;
    if (this.moment) {
      game.advance(d);
      this.t += d;
      if (game.match.time >= this.moment.end) this.restart();
    } else if (this.staged && this.stagedScene) {
      const from = this.t;
      this.t += d;
      if (this.t >= this.staged.length) {
        this.restart();
        return;
      }
      this.staged.at(this.stagedScene, this.t, from, this.react);
      this.stagedScene.time += d;
      game.renderer.render(this.stagedScene, d);
    }
    this.status.frames++;
    this.status.time = this.t;
  }

  /** The same moment again, from the start of the loop: what a body does depends on the frames before. */
  private again(): void {
    const at = this.t;
    this.restart();
    while (this.t < at - 1e-6) this.advance(Math.min(FRAME, at - this.t));
    this.refresh();
  }

  private at(seconds?: number): void {
    this.playing = false;
    const [, key] = this.position();
    const length = this.moment ? this.moment.end - this.moment.start : (this.staged?.length ?? 0);
    const target = Math.max(0, seconds ?? key * length);
    this.restart();
    while (this.t < target - 1e-6) this.advance(Math.min(FRAME, target - this.t));
    this.refresh();
  }

  private step(direction: 1 | -1): void {
    this.playing = false;
    if (direction > 0) {
      this.advance(FRAME);
    } else {
      const at = Math.max(0, this.t - FRAME);
      this.restart();
      while (this.t < at - 1e-6) this.advance(Math.min(FRAME, at - this.t));
    }
    this.refresh();
  }

  /** The frame on show, drawn again: after a change of camera, of size, or when the 3D look arrives. */
  private redraw(): void {
    if (!this.ready) return;
    if (this.moment) this.game.advance(0);
    else if (this.stagedScene) this.game.renderer.render(this.stagedScene, 0);
  }

  private readonly react = (player: number, well: boolean): void => {
    if (this.stagedScene) this.game.renderer.stealReaction?.(player, well, this.stagedScene);
  };

  private readonly frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    // Nothing else moves the game while the studio has it.
    this.game.stopLoop();
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0;
    this.last = now;
    if (this.playing && this.ready) this.advance(dt * this.speed);
    const [progress, key] = this.position();
    this.ui.progress(progress, key);
    if (this.staged && this.staged.note(this.t) !== this.shownNote) this.refresh();
  };

  /** How far into the loop, and where its key instant is, both 0..1. */
  private position(): [number, number] {
    if (this.moment) {
      const length = this.moment.end - this.moment.start;
      return [this.t / length, (this.moment.at - this.moment.start) / length];
    }
    if (this.staged) return [this.t / this.staged.length, this.staged.key / this.staged.length];
    return [0, 0];
  }

  private refresh(): void {
    const scene = this.moment ? this.game.scene : this.stagedScene;
    const shown = scene?.players[this.view.focus];
    const note = this.moment ? this.moment.note : this.staged ? `armada · ${this.staged.note(this.t)}` : '';
    this.shownNote = this.staged?.note(this.t) ?? '';
    const [progress, key] = this.position();
    this.status.playing = this.playing;
    this.ui.show({
      situation: this.situation,
      title: SITUATION[this.situation].label,
      note: [shown ? this.game.match.players[this.view.focus]?.name : '', note].filter(Boolean).join(' · '),
      camera: this.view.camera,
      near: this.near,
      character: this.view.character !== undefined ? this.view.character : (shown?.character ?? null),
      look: this.view.look,
      cameras: this.view.look === '3d',
      playing: this.playing,
      speed: this.speed,
      progress,
      key,
    });
  }
}
