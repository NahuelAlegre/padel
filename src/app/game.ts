import { CAST } from '../characters/cast';
import { CHARACTER_TEXT } from '../characters/lines.es';
import { toAILevel } from '../characters/style';
import {
  CONTROLS,
  FORMATS,
  PHYSICS_VERSION,
  SIM_DT,
  createConfig,
  type FormatName,
  type GameConfig,
  type RivalId,
} from '../config';
import { AIController } from '../control/ai';
import { HumanController } from '../control/human';
import { NO_INSETS, type Insets } from '../core/layout';
import { AutoQuality, FrameStats } from '../core/perf';
import { Rng } from '../core/rng';
import { KeyboardInput } from '../input/keyboard';
import { PointerInput } from '../input/pointer';
import { InputState } from '../input/state';
import type { Platform } from '../platform/types';
import { PrototypeRenderer } from '../render/prototype/renderer';
import type { Renderer, Scene } from '../render/scene';
import { VIEW } from '../render/view';
import { Viewport } from '../render/viewport';
import { Match, type PlayerEntry, type SimEvent } from '../sim/match';
import { isGoldenPoint, pointLabel } from '../sim/score';
import { Hud } from '../ui/hud';
import { Screens, type ScreenInfo } from '../ui/screens';
import { QUALITY_SCALE, RIVALS, type Settings } from '../ui/settings';
import { TEXT } from '../ui/text';
import {
  newRivalRecord,
  saveMatch,
  saveProfile,
  saveSettings,
  type Profile,
  type SavedData,
  type SavedMatch,
} from './persistence';
import { isClassic, noteMatch, Personality } from './personality';
import { createScene, fillScene, type SceneOptions } from './scene';

export type AppState = 'menu' | 'playing' | 'paused' | 'over';
/** A match in one of the formats, or the computer playing itself. */
export type PlayMode = FormatName | 'demo';

/** Never simulate more than this per frame: after a long stall, time is dropped instead. */
const MAX_STEPS_PER_FRAME = 12;
/** A person reaches further than the computer: getting close to the ball is enough. */
const HUMAN_REACH = 1.3;
/** With assisted movement on, the player is helped but not instantaneous. */
const ASSISTED_REACTION = 0.12;
/** How far above the feet a speech bubble points, in metres of the court. */
const BUBBLE_HEIGHT = 2.05;

/** Today as yyyy-mm-dd on the person's own calendar, for the history with each rival. */
function today(): string {
  const now = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/**
 * Glue between the simulation and the device: owns the match, feeds it the
 * input, runs it at a fixed step and asks the renderer for frames in between.
 * Everything that depends on where the game runs comes in through `platform`.
 */
export class Game {
  readonly settings: Settings;
  readonly profile: Profile;
  match: Match;
  state: AppState = 'menu';
  mode: PlayMode = 'quick';
  /** When set, the demo starts over instead of showing the result (performance runs). */
  loopDemo = false;
  /** Called with everything that happens in the match: for tests and tools. */
  onSimEvent: ((event: SimEvent) => void) | null = null;
  readonly stats = new FrameStats();

  private config: GameConfig;
  private saved: SavedMatch | null;
  private rival: RivalId;
  private readonly viewport: Viewport;
  /** Whatever draws the game. Nothing here knows which renderer it is. */
  private readonly renderer: Renderer;
  /** What the rival says and the tics it has. It listens to the match and never touches it. */
  private readonly personality: Personality;
  /** Place in `match.players` of the rival with a personality, or -1 when there is none. */
  private rivalIndex = -1;
  /** The point being played is a golden point. */
  private golden = false;
  private readonly anchor = { x: 0, y: 0 };
  private readonly input = new InputState();
  private readonly pointer: PointerInput;
  private readonly keyboard: KeyboardInput;
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly scene: Scene;
  private readonly autoQuality = new AutoQuality();
  private readonly options: SceneOptions = {
    bounceMarker: true,
    timingAid: true,
    positionGuide: true,
    reduceMotion: false,
    debug: false,
    cueLead: 0,
    tutorial: null,
    cast: [],
    acts: [],
  };
  private ais: AIController[] = [];
  private safeArea: Insets = NO_INSETS;
  private safeAreaStale = true;
  private immersive = false;

  private running = false;
  private raf = 0;
  private last = 0;
  private accumulator = 0;
  private warmup = 0;
  /** Seconds left of the freeze that follows a strong hit. */
  private hitStop = 0;

  constructor(
    stage: HTMLElement,
    private readonly platform: Platform,
    data: SavedData,
  ) {
    const canvas = stage.querySelector<HTMLCanvasElement>('#court');
    const overlay = stage.querySelector<HTMLElement>('#overlay');
    if (!canvas || !overlay) throw new Error('The page is missing the game elements');

    this.settings = data.settings;
    this.profile = data.profile;
    this.saved = data.match;
    this.rival = this.settings.rival;
    // Its own dice: what is said and when never shares a generator with the simulation.
    this.personality = new Personality(new Rng((Date.now() ^ 0x9e3779b9) >>> 0));
    this.config = createConfig();
    this.viewport = new Viewport(canvas, VIEW.dprCap);
    this.renderer = new PrototypeRenderer(canvas, this.config.court);
    this.pointer = new PointerInput(canvas, this.input);
    this.pointer.onTouch = () => this.skipPause();
    this.keyboard = new KeyboardInput(
      this.input,
      () => this.togglePause(),
      () => this.skipPause(),
    );
    this.scene = createScene(this.pointer.feedback);
    this.hud = new Hud(stage, () => this.togglePause());
    this.screens = new Screens(
      overlay,
      this.settings,
      {
        onPlay: (format) => this.start(format),
        onContinue: () => this.continueSaved(),
        onDemo: () => this.start('demo'),
        onResume: () => this.resume(),
        onRestart: () => this.rematch(),
        onMenu: () => this.toMenu(),
        onSettings: () => this.applySettings(),
      },
      () => this.screenInfo(),
    );

    this.match = this.createMatch('demo', null);
    this.applySettings();

    // Losing sight of the game pauses it: nobody should lose a point to a notification.
    platform.lifecycle.onBackground(() => this.pause());
    platform.lifecycle.onBack(() => {
      if (this.state !== 'playing' && this.state !== 'paused') return false;
      this.togglePause();
      return true;
    });
    new ResizeObserver(() => {
      this.safeAreaStale = true;
      this.draw();
    }).observe(stage);
  }

  // ---------------------------------------------------------------- flow

  /**
   * Opens the game. The first time there is no start screen: it goes straight
   * to the court with the serve ready. After that, the start screen has the
   * quick match one touch away.
   */
  begin(): void {
    this.profile.opens++;
    saveProfile(this.platform.storage, this.profile);
    this.platform.analytics.track('open', { visit: this.profile.opens });
    if (this.profile.introDone) this.toMenu();
    else this.start('quick');
  }

  start(mode: PlayMode, saved: SavedMatch | null = null, greet = true): void {
    this.mode = mode;
    this.rival = saved?.rival ?? this.settings.rival;
    this.match = this.createMatch(mode, saved);
    // A match that is picked up again was already opened: nobody says hello twice.
    const opening = this.meetRival(greet && !saved);
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
    if (mode !== 'demo' && !saved) {
      this.profile.matchesStarted++;
      saveProfile(this.platform.storage, this.profile);
      this.platform.analytics.track('match_start', { format: mode, rival: this.rival });
    }
    if (this.settings.fullscreen) this.setImmersive(true);
    this.drainEvents();
    if (opening) this.say(opening);
    this.startLoop();
  }

  /**
   * Works out who is on court. For a rival, that is also the history with it
   * and what it says to open the match, which is what this returns.
   */
  private meetRival(greet: boolean): string | null {
    const players = this.match.players;
    const { cast, acts } = this.options;
    cast.length = 0;
    acts.length = 0;
    for (let i = 0; i < players.length; i++) {
      cast.push(null);
      acts.push(null);
    }
    this.golden = false;
    if (this.mode === 'demo') {
      // Two of the cast play each other, and nobody talks.
      cast[0] = CAST[this.demoRival()];
      cast[1] = CAST[this.rival];
      this.rivalIndex = -1;
      this.personality.clear();
      return null;
    }
    this.rivalIndex = players.findIndex((player) => !player.isHuman);
    const rival = players[this.rivalIndex];
    if (!rival) return null;
    cast[this.rivalIndex] = CAST[this.rival];
    const record = (this.profile.rivals[this.rival] ??= newRivalRecord(today()));
    const opening = this.personality.begin(this.rival, rival.team, record, today(), greet);
    // It gives its tell away once, to somebody it keeps beating.
    if (opening.hint) record.hintShown = true;
    return opening.line;
  }

  /** In the demo, who plays against the selected rival: the next one of the cast. */
  private demoRival(): RivalId {
    return RIVALS[(RIVALS.indexOf(this.rival) + 1) % RIVALS.length]!;
  }

  /** Puts a line in the rival's speech bubble, over its head. */
  private say(text: string): void {
    this.hud.speak(text);
    this.placeBubble();
  }

  private placeBubble(): void {
    const who = this.match.players[this.rivalIndex];
    if (!who) return;
    this.renderer.project(who.x, who.y, BUBBLE_HEIGHT * VIEW.figureScale, this.anchor);
    this.hud.placeBubble(this.anchor.x, this.anchor.y, this.viewport.width);
  }

  private continueSaved(): void {
    if (this.saved) this.start(this.saved.format, this.saved);
  }

  private rematch(): void {
    if (this.state === 'over' && this.mode !== 'demo') {
      this.profile.rematches++;
      this.platform.analytics.track('rematch');
    }
    // The rival has just said its piece next to the button.
    this.start(this.mode, null, false);
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

  /** A touch during the pause between points moves on to the next one. */
  private skipPause(): void {
    if (this.state === 'playing' && this.match.skipPause()) this.hud.dismiss();
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
    const won = this.match.score.winner === 0;
    const line = this.mode === 'demo' ? null : this.personality.rematchLine(won);
    this.screens.show('over', {
      won,
      games: [games[0], games[1]],
      quote: line ? { who: CAST[this.rival].name, text: line } : null,
    });
    this.draw();
  }

  private setInputEnabled(enabled: boolean): void {
    // In the demo nobody plays: touches are ignored.
    const active = enabled && this.mode !== 'demo';
    this.pointer.options.enabled = active;
    this.keyboard.enabled = active;
    if (!active) {
      this.pointer.release();
      this.keyboard.release();
      this.input.clear();
    }
  }

  private setImmersive(on: boolean): void {
    if (on === this.immersive || !this.platform.display.canGoImmersive) return;
    this.immersive = on;
    void this.platform.display.setImmersive(on).then((done) => {
      if (on && !done) this.immersive = false;
    });
  }

  // ---------------------------------------------------------------- match

  private createMatch(mode: PlayMode, saved: SavedMatch | null): Match {
    const config = createConfig();
    config.rules.format = { ...FORMATS[mode === 'demo' ? 'quick' : mode] };
    this.config = config;
    this.ais = [];

    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    const ai = (id: RivalId, offset: number, firstMatch = false): PlayerEntry => {
      const who = CAST[id];
      const level = config.rivals[id];
      // A coach feeds more balls to somebody he has just met.
      if (firstMatch) level.feed = toAILevel(who, true).feed;
      const controller = new AIController(level, new Rng(seed + offset));
      this.ais.push(controller);
      return {
        name: who.name,
        isHuman: false,
        manual: false,
        speedFactor: level.speedFactor,
        reaction: level.reaction,
        errorScale: level.errorScale,
        reachScale: 1,
        hand: who.hand,
        wallBias: level.wallBias,
        controller,
      };
    };

    if (mode === 'demo') {
      const other = this.demoRival();
      return new Match({
        config,
        seed,
        teams: [
          { name: CAST[other].name, players: [ai(other, 1)] },
          { name: CAST[this.rival].name, players: [ai(this.rival, 2)] },
        ],
      });
    }

    const assisted = this.settings.assistedMovement;
    const human: PlayerEntry = {
      name: TEXT.you,
      isHuman: true,
      manual: !assisted,
      speedFactor: 1,
      reaction: assisted ? ASSISTED_REACTION : 0,
      errorScale: 1,
      reachScale: HUMAN_REACH,
      hand: 1,
      controller: new HumanController(this.input),
    };
    return new Match({
      config,
      seed,
      teams: [
        { name: TEXT.you, players: [human] },
        { name: CAST[this.rival].name, players: [ai(this.rival, 1, !this.profile.rivals[this.rival]?.played)] },
      ],
      resume: saved?.snapshot,
      // The first rally ever is the tutorial: the rival goes easy until a point is won.
      tutorial: !this.profile.introDone && !saved,
      record: this.platform.launch.flag('record'),
    });
  }

  /** Applies the settings that can change in the middle of a match, and saves them. */
  applySettings(): void {
    const settings = this.settings;
    saveSettings(this.platform.storage, settings);

    this.pointer.options.scheme = settings.scheme;
    this.pointer.options.stickSide = settings.stickSide;
    this.hud.scheme = settings.scheme;
    this.renderer.setCamera(settings.camera);
    this.platform.sound.setEnabled(true);
    this.personality.frequency = settings.lines;
    this.hud.calm = settings.reduceMotion;
    if (settings.lines === 'none') this.hud.hush();

    // A new rival takes over the match in progress, unless it is a continued one against somebody else.
    if (this.mode !== 'demo' && this.state !== 'paused') this.rival = settings.rival;
    if (this.mode !== 'demo' && this.state === 'paused' && settings.rival !== this.rival) {
      this.rival = settings.rival;
      this.match.teamNames[1] = CAST[this.rival].name;
      this.hud.showScore(this.match);
      // Somebody else walks on in the middle of the match, without a word.
      this.meetRival(false);
    }
    const level = this.config.rivals[this.rival];
    for (const player of this.match.players) {
      if (player.isHuman) {
        player.manual = !settings.assistedMovement;
        player.reaction = settings.assistedMovement ? ASSISTED_REACTION : 0;
      } else if (this.mode !== 'demo') {
        player.speedFactor = level.speedFactor;
        player.reaction = level.reaction;
        player.errorScale = level.errorScale;
        player.wallBias = level.wallBias;
      }
    }
    if (this.mode !== 'demo') for (const controller of this.ais) controller.level = level;

    if (!settings.showFps) this.hud.showFps(null);
    if (this.state !== 'menu' || !settings.fullscreen) this.setImmersive(settings.fullscreen);
    this.draw();
  }

  private drainEvents(): void {
    const events = this.match.events;
    if (events.length === 0) return;
    const humanTeam = this.mode === 'demo' ? -1 : 0;
    for (const event of events) {
      this.renderer.onEvent(event, this.scene);
      this.hud.onEvent(event, this.match, humanTeam);
      this.react(event);
      this.onSimEvent?.(event);
    }
    events.length = 0;
  }

  /** Everything around the match that follows from what just happened: feel, saving, counting. */
  private react(event: SimEvent): void {
    const { sound, storage, analytics } = this.platform;
    const playing = this.mode !== 'demo';
    const record = playing ? this.profile.rivals[this.rival] : undefined;
    if (playing) {
      // The rival has its say. The serve closes its bubble: nothing waits for it.
      const reaction = this.personality.onEvent(event, this.match);
      if (reaction?.hush) this.hud.hush();
      if (reaction?.say) this.say(reaction.say);
    }
    switch (event.type) {
      case 'serveReady':
        this.golden = isGoldenPoint(this.match.score, this.match.format);
        // A touch that began during the pause must not turn into the serve.
        this.pointer.release();
        this.input.takeSwing();
        if (playing) {
          // Saved at every point: closing the game loses nothing.
          this.saved = {
            version: PHYSICS_VERSION,
            format: this.mode as FormatName,
            rival: this.rival,
            snapshot: this.match.snapshot(),
          };
          saveMatch(storage, this.saved);
        }
        break;
      case 'hit':
        this.onHit(event);
        break;
      case 'bounce':
        sound.play('bounce', Math.min(1, event.speed / 12));
        break;
      case 'wall':
        sound.play(event.surface === 'glass' ? 'glass' : 'fence', Math.min(1, event.speed / 16));
        break;
      case 'net':
        sound.play('net');
        break;
      case 'point':
        if (!playing) break;
        if (event.winner === 0) this.profile.pointsWon++;
        else this.profile.pointsLost++;
        if (record) {
          record.longestRally = Math.max(record.longestRally, this.match.rallyHits);
          if (this.golden && event.winner === 0) record.goldenWon++;
          else if (this.golden) record.goldenLost++;
        }
        sound.play(event.winner === 0 ? 'pointWon' : 'pointLost');
        if (event.winner === 0 && this.profile.pointsWon === 1) analytics.track('first_point_won');
        saveProfile(storage, this.profile);
        break;
      case 'match':
        if (!playing) break;
        this.profile.matchesFinished++;
        this.profile.introDone = true;
        if (event.winner === 0) this.profile.matchesWon++;
        if (record) noteMatch(record, event.winner === 0, today());
        this.saved = null;
        saveMatch(storage, null);
        saveProfile(storage, this.profile);
        analytics.track('match_end', { won: event.winner === 0, rival: this.rival, format: this.mode });
        break;
      default:
        break;
    }
  }

  /** Weight for the good hits, and the counting that goes with a hit by the person. */
  private onHit(event: Extract<SimEvent, { type: 'hit' }>): void {
    const { haptics, sound, analytics, launch } = this.platform;
    sound.play('hit', Math.min(1, event.speed / 24));
    if (event.kind !== 'serve' && !this.settings.reduceMotion) {
      if (event.kind === 'smash') this.hitStop = VIEW.hitStopSmash;
      else if (event.quality === 'perfect') this.hitStop = VIEW.hitStopPerfect;
    }
    if (this.mode === 'demo' || !this.match.players[event.player]?.isHuman) return;

    if (this.settings.vibration) {
      haptics.impact(event.kind === 'smash' ? 'heavy' : event.quality === 'perfect' ? 'medium' : 'light');
    }
    if (this.profile.firstHitSeconds === null) {
      this.profile.firstHitSeconds = launch.elapsed() / 1000;
      analytics.track('first_hit', { seconds: this.profile.firstHitSeconds });
    }
    if (event.kind === 'serve') return;
    this.profile.hits[event.quality]++;
    // The first rally hit that comes off ends the first-time help.
    if (!this.profile.introDone && event.quality !== 'late') {
      this.profile.introDone = true;
      saveProfile(this.platform.storage, this.profile);
      analytics.track('intro_done');
    }
  }

  private screenInfo(): ScreenInfo {
    const { profile, saved } = this;
    let savedLabel: string | null = null;
    // A match with nothing played yet is not worth offering back.
    const begun = saved !== null && saved.snapshot.score.points.concat(saved.snapshot.score.games).some((n) => n > 0);
    if (saved && begun) {
      const score = saved.snapshot.score;
      savedLabel =
        `${CAST[saved.rival].name} · ${score.games[0]}–${score.games[1]} · ` +
        `${pointLabel(score, 0)}–${pointLabel(score, 1)}`;
    }
    const stats: string[] = [];
    if (profile.matchesStarted === 0) {
      stats.push(TEXT.stats.none);
    } else {
      stats.push(TEXT.stats.matches(profile.matchesStarted, profile.matchesWon));
      const hits = profile.hits.perfect + profile.hits.good + profile.hits.early + profile.hits.late;
      if (hits > 0) stats.push(TEXT.stats.perfect(Math.round((profile.hits.perfect / hits) * 100)));
      if (profile.firstHitSeconds !== null) stats.push(TEXT.stats.firstHit(profile.firstHitSeconds));
    }
    // Who the selected rival is, and how things stand with it.
    const who = CAST[this.settings.rival];
    const history = profile.rivals[who.id];
    let standing: string = TEXT.record.never;
    if (history && history.played > 0) {
      const { wins, losses } = history;
      standing = wins === losses ? TEXT.record.even(wins) : wins > losses ? TEXT.record.ahead(wins, losses) : TEXT.record.behind(wins, losses);
      if (isClassic(history)) standing += ` ${TEXT.record.classic}`;
    }
    return {
      saved: savedLabel,
      rival: {
        who: `«${who.nickname}» ${'★'.repeat(who.stars)}`,
        style: CHARACTER_TEXT[who.id].style,
        record: standing,
      },
      stats,
      canVibrate: this.platform.haptics.available,
      canGoFullscreen: this.platform.display.canGoImmersive,
    };
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

  /** Follows the size of the canvas, its pixel density and the safe area of the device. */
  private syncViewport(): void {
    const resized = this.viewport.update(this.resolutionScale());
    if (this.safeAreaStale) {
      this.safeArea = this.platform.display.safeArea();
      this.safeAreaStale = false;
    }
    if (resized || this.safeArea !== this.lastSafeArea) {
      this.lastSafeArea = this.safeArea;
      this.renderer.resize(this.viewport.width, this.viewport.height, this.viewport.pixelRatio, this.safeArea);
    }
  }

  private lastSafeArea: Insets | null = null;

  /** Draws one frame without advancing the match: menus, pause, resize. */
  private draw(): void {
    if (this.running) return;
    this.syncViewport();
    fillScene(this.scene, this.match, 1, this.input, this.sceneOptions());
    this.renderer.render(this.scene, 0);
  }

  private sceneOptions(): SceneOptions {
    const settings = this.settings;
    const playing = (this.state === 'playing' || this.state === 'paused') && this.mode !== 'demo';
    const options = this.options;
    options.bounceMarker = settings.bounceMarker && this.state !== 'menu';
    options.timingAid = settings.timingAid && playing;
    options.positionGuide = settings.positionGuide && playing;
    options.reduceMotion = settings.reduceMotion;
    options.debug = settings.showFps;
    options.cueLead = CONTROLS.cueLead[settings.scheme];
    // First visit: ghost thumbs show the gestures until a hit comes off.
    if (playing && !this.profile.introDone) {
      const match = this.match;
      const serving = (match.phase === 'serve' || match.phase === 'windup') && match.server.isHuman;
      options.tutorial = {
        scheme: settings.scheme,
        stickSide: settings.stickSide,
        step: serving ? 'serve' : 'play',
      };
    } else {
      options.tutorial = null;
    }
    return options;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const workStart = performance.now();

    this.syncViewport();
    this.pointer.update(now);

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

    // The rival's tic, if it is in the middle of one, and its bubble over its head.
    if (this.rivalIndex >= 0) this.options.acts[this.rivalIndex] = this.personality.actAt(this.match.time);
    fillScene(this.scene, this.match, this.accumulator / SIM_DT, this.input, this.sceneOptions());
    this.renderer.render(this.scene, dt);
    if (this.hud.speaking) this.placeBubble();

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
