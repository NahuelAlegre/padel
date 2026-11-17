import { SIM_DT, createConfig, type GameConfig } from '../config';
import { AIController } from '../control/ai';
import { HumanController } from '../control/human';
import { AutoQuality, FrameStats } from '../core/perf';
import { Rng } from '../core/rng';
import { KeyboardInput } from '../input/keyboard';
import { PointerInput } from '../input/pointer';
import { InputState } from '../input/state';
import { PrototypeRenderer } from '../render/prototype/renderer';
import type { Scene } from '../render/scene';
import { VIEW } from '../render/view';
import { Viewport } from '../render/viewport';
import { Match, type PlayerEntry, type SimEvent } from '../sim/match';
import { Hud } from '../ui/hud';
import { Screens } from '../ui/screens';
import { QUALITY_SCALE, loadSettings, saveSettings, type Settings } from '../ui/settings';
import { TEXT } from '../ui/text';
import { createScene, fillScene, type SceneOptions } from './scene';

export type AppState = 'menu' | 'playing' | 'paused' | 'over';
export type PlayMode = 'play' | 'demo';

/** Never simulate more than this per frame: after a long stall, time is dropped instead. */
const MAX_STEPS_PER_FRAME = 12;
/** The person's player is assisted, but not instantaneous. */
const HUMAN_REACTION = 0.12;

/**
 * Glue between the simulation and the browser: owns the match, feeds it the
 * input, runs it at a fixed step and asks the renderer for frames in between.
 */
export class Game {
  readonly settings: Settings;
  match: Match;
  state: AppState = 'menu';
  mode: PlayMode = 'play';
  /** When set, the demo starts over instead of showing the result (performance runs). */
  loopDemo = false;
  /** Called with everything that happens in the match: for tests, tools and, later, sound. */
  onSimEvent: ((event: SimEvent) => void) | null = null;
  readonly stats = new FrameStats();

  private config: GameConfig;
  private readonly viewport: Viewport;
  private readonly renderer: PrototypeRenderer;
  private readonly input = new InputState();
  private readonly pointer: PointerInput;
  private readonly keyboard: KeyboardInput;
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly scene: Scene;
  private readonly autoQuality = new AutoQuality();
  private readonly options: SceneOptions = { bounceMarker: true, timingAid: true, reduceMotion: false, debug: false };
  private ais: AIController[] = [];

  private running = false;
  private raf = 0;
  private last = 0;
  private accumulator = 0;
  private warmup = 0;
  /** Seconds left of the freeze that follows a strong hit. */
  private hitStop = 0;

  constructor(stage: HTMLElement) {
    const canvas = stage.querySelector<HTMLCanvasElement>('#court');
    const overlay = stage.querySelector<HTMLElement>('#overlay');
    if (!canvas || !overlay) throw new Error('The page is missing the game elements');

    this.settings = loadSettings();
    this.config = createConfig();
    this.viewport = new Viewport(canvas, VIEW.dprCap);
    this.renderer = new PrototypeRenderer(canvas, this.config.court);
    this.pointer = new PointerInput(canvas, this.input);
    this.keyboard = new KeyboardInput(this.input, () => this.togglePause());
    this.scene = createScene(this.pointer.feedback);
    this.hud = new Hud(stage, () => this.togglePause());
    this.screens = new Screens(overlay, this.settings, {
      onPlay: () => this.start('play'),
      onDemo: () => this.start('demo'),
      onResume: () => this.resume(),
      onRestart: () => this.start(this.mode),
      onMenu: () => this.toMenu(),
      onSettings: () => this.applySettings(),
    });

    this.match = this.createMatch('demo');
    this.applySettings();

    // Losing sight of the game pauses it: nobody should lose a point to a notification.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    new ResizeObserver(() => this.draw()).observe(stage);

    this.toMenu();
  }

  // ---------------------------------------------------------------- flow

  start(mode: PlayMode): void {
    this.mode = mode;
    this.match = this.createMatch(mode);
    this.renderer.reset();
    this.input.clear();
    this.pointer.release();
    this.hud.clear();
    this.hud.setVisible(true);
    this.hud.showScore(this.match);
    this.screens.hide();
    this.state = 'playing';
    this.accumulator = 0;
    this.hitStop = 0;
    this.warmup = 2;
    this.autoQuality.reset();
    this.setInputEnabled(true);
    this.drainEvents();
    this.startLoop();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.setInputEnabled(false);
    this.screens.show('pause');
    this.stopLoop();
    this.draw();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.screens.hide();
    this.setInputEnabled(true);
    this.startLoop();
  }

  togglePause(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused' && this.screens.current === 'pause') this.resume();
  }

  toMenu(): void {
    this.state = 'menu';
    this.setInputEnabled(false);
    this.stopLoop();
    this.hud.clear();
    this.hud.setVisible(false);
    this.screens.show('menu');
    this.draw();
  }

  private finish(): void {
    if (this.mode === 'demo' && this.loopDemo) {
      this.start('demo');
      return;
    }
    this.state = 'over';
    this.setInputEnabled(false);
    this.stopLoop();
    const games = this.match.score.games;
    this.screens.show('over', { won: this.match.score.winner === 0, games: [games[0], games[1]] });
    this.draw();
  }

  private setInputEnabled(enabled: boolean): void {
    // In the demo nobody plays: touches are ignored.
    const active = enabled && this.mode === 'play';
    this.pointer.options.enabled = active;
    this.keyboard.enabled = active;
    if (!active) {
      this.pointer.release();
      this.keyboard.release();
      this.input.clear();
    }
  }

  // ---------------------------------------------------------------- match

  private createMatch(mode: PlayMode): Match {
    const config = createConfig();
    config.rules.gamesToWin = this.settings.games;
    this.config = config;
    this.ais = [];

    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    const ai = (name: string, offset: number): PlayerEntry => {
      const level = config.ai[this.settings.difficulty];
      const controller = new AIController(level, new Rng(seed + offset));
      this.ais.push(controller);
      return {
        name,
        isHuman: false,
        manual: false,
        speedFactor: level.speedFactor,
        reaction: level.reaction,
        errorScale: level.errorScale,
        hand: 1,
        controller,
      };
    };
    const human: PlayerEntry = {
      name: TEXT.you,
      isHuman: true,
      manual: this.settings.controlMode === 'manual',
      speedFactor: 1,
      reaction: HUMAN_REACTION,
      errorScale: 1,
      hand: 1,
      controller: new HumanController(this.input),
    };

    return new Match({
      config,
      seed,
      teams:
        mode === 'demo'
          ? [
              { name: 'IA 1', players: [ai('IA 1', 1)] },
              { name: 'IA 2', players: [ai('IA 2', 2)] },
            ]
          : [
              { name: TEXT.you, players: [human] },
              { name: TEXT.rival, players: [ai(TEXT.rival, 1)] },
            ],
    });
  }

  /** Applies the settings that can change in the middle of a match, and saves them. */
  applySettings(): void {
    const settings = this.settings;
    saveSettings(settings);

    this.pointer.options.manual = settings.controlMode === 'manual';
    this.pointer.options.stickSide = settings.stickSide;
    this.renderer.setCamera(settings.camera);

    const level = this.config.ai[settings.difficulty];
    for (const controller of this.ais) controller.level = level;
    for (const player of this.match.players) {
      if (player.isHuman) {
        player.manual = settings.controlMode === 'manual';
      } else {
        player.speedFactor = level.speedFactor;
        player.reaction = level.reaction;
        player.errorScale = level.errorScale;
      }
    }
    if (!settings.showFps) this.hud.showFps(null);
    this.draw();
  }

  private drainEvents(): void {
    const events = this.match.events;
    if (events.length === 0) return;
    const humanTeam = this.mode === 'play' ? 0 : -1;
    for (const event of events) {
      this.renderer.onEvent(event, this.scene);
      this.hud.onEvent(event, this.match, humanTeam);
      if (event.type === 'hit') this.onHit(event);
      this.onSimEvent?.(event);
    }
    events.length = 0;
  }

  /** Weight for the good hits: a very short freeze and, on phones that have it, a buzz. */
  private onHit(event: Extract<SimEvent, { type: 'hit' }>): void {
    if (event.kind !== 'serve' && !this.settings.reduceMotion) {
      if (event.kind === 'smash') this.hitStop = VIEW.hitStopSmash;
      else if (event.quality === 'perfect') this.hitStop = VIEW.hitStopPerfect;
    }
    if (!this.settings.vibration || !this.match.players[event.player]?.isHuman) return;
    // Browsers only allow vibration after the person has touched the page.
    if (typeof navigator.vibrate !== 'function' || navigator.userActivation?.hasBeenActive === false) return;
    navigator.vibrate(event.quality === 'perfect' ? 22 : 12);
  }

  // ---------------------------------------------------------------- loop

  private startLoop(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stopLoop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private resolutionScale(): number {
    return this.settings.quality === 'auto' ? this.autoQuality.scale : QUALITY_SCALE[this.settings.quality];
  }

  /** Draws one frame without advancing the match: menus, pause, resize. */
  private draw(): void {
    if (this.running) return;
    if (this.viewport.update(this.resolutionScale())) {
      this.renderer.resize(this.viewport.width, this.viewport.height, this.viewport.pixelRatio);
    }
    fillScene(this.scene, this.match, 1, this.sceneOptions());
    this.renderer.render(this.scene, 0);
  }

  private sceneOptions(): SceneOptions {
    const playing = this.state === 'playing' || this.state === 'paused';
    const options = this.options;
    options.bounceMarker = this.settings.bounceMarker && playing;
    options.timingAid = this.settings.timingAid && playing && this.mode === 'play';
    options.reduceMotion = this.settings.reduceMotion;
    options.debug = this.settings.showFps;
    return options;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const workStart = performance.now();

    if (this.viewport.update(this.resolutionScale())) {
      this.renderer.resize(this.viewport.width, this.viewport.height, this.viewport.pixelRatio);
    }

    // Fixed-step simulation: run as many steps as real time asks for.
    if (this.hitStop > 0) this.hitStop -= dt;
    else this.accumulator += dt * this.settings.speed;
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      this.match.step();
      this.accumulator -= SIM_DT;
      steps++;
      this.drainEvents();
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    fillScene(this.scene, this.match, this.accumulator / SIM_DT, this.sceneOptions());
    this.renderer.render(this.scene, dt);

    this.stats.push(dt, performance.now() - workStart);
    if (this.stats.fresh) this.onStats();

    if (this.match.phase === 'matchOver') this.finish();
  };

  private onStats(): void {
    const stats = this.stats;
    if (this.settings.showFps) {
      const canvas = this.viewport;
      this.hud.showFps(
        `${stats.fps.toFixed(0)} fps\n` +
          `${stats.frameMs.toFixed(1)} ms (peor ${stats.worstMs.toFixed(0)})\n` +
          `cpu ${stats.workMs.toFixed(2)} ms\n` +
          `${Math.round(canvas.width * canvas.pixelRatio)}×${Math.round(canvas.height * canvas.pixelRatio)}`,
      );
    }
    // The first seconds include start-up work that says nothing about the device.
    if (this.warmup > 0) {
      this.warmup--;
      return;
    }
    if (this.settings.quality === 'auto') this.autoQuality.update(stats.fps);
  }
}
