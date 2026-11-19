import { CAST } from '../characters/cast';
import { CHARACTER_TEXT } from '../characters/lines.es';
import { asPartner, toAILevel, withAttitude } from '../characters/style';
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
import { clamp } from '../core/math';
import { AutoQuality, FrameStats } from '../core/perf';
import { Rng } from '../core/rng';
import { KeyboardInput } from '../input/keyboard';
import { PointerInput } from '../input/pointer';
import { InputState } from '../input/state';
import type { Launch, Platform } from '../platform/types';
import type { Renderer, Scene, SceneTutorial } from '../render/scene';
import { figureScale } from '../render/stage/camera';
import { StageRenderer } from '../render/stage/renderer';
import { VIEW } from '../render/view';
import { Viewport } from '../render/viewport';
import { Match, type PlayerEntry, type SimEvent } from '../sim/match';
import { attitudeFrom, type Attitude } from '../sim/pair';
import { SoundDirector } from '../audio/director';
import { isGoldenPoint, pointLabel } from '../sim/score';
import { Hud } from '../ui/hud';
import { Screens, type ScreenInfo } from '../ui/screens';
import { partnerAttitude, QUALITY_SCALE, RIVALS, type ReachName, type Settings, type SideName } from '../ui/settings';
import { shotName, TEXT } from '../ui/text';
import {
  newRivalRecord,
  saveMatch,
  saveProfile,
  saveSettings,
  type HintId,
  type Profile,
  type SavedData,
  type SavedMatch,
} from './persistence';
import { isClassic, noteMatch, Personality } from './personality';
import { createScene, fillScene, type SceneOptions } from './scene';
import { COACH_SETUP, Drill, LESSONS, type Gesture } from './drill';

export type AppState = 'menu' | 'playing' | 'paused' | 'over';
/** A match in one of the formats, the computer playing itself, or a lesson of the tutorial. */
export type PlayMode = FormatName | 'demo' | 'tutorial';

/** Never simulate more than this per frame: after a long stall, time is dropped instead. */
const MAX_STEPS_PER_FRAME = 12;
/** A person reaches further than the computer: getting close to the ball is enough. */
const HUMAN_REACH = 1.3;
/**
 * How much the advice on where to stand (and the assisted movement) leans
 * toward holding the net against a lob. A person moving by hand decides with
 * the stick.
 */
const HUMAN_HOLD_NET = 0.6;
/** With assisted movement on, the player is helped but not instantaneous. */
const ASSISTED_REACTION = 0.12;
/** How far above the feet a speech bubble points, in metres of a player at life size. */
const BUBBLE_HEIGHT = 2.05;
/**
 * The minimal aids fade as the person gets it right: this much less of them
 * after every hit that comes off, this much more after one that does not.
 * With these two, they fade for somebody who gets four out of five right.
 * They never go below the floor: "none" is there for whoever wants nothing.
 */
const ASSIST_FADE = 0.03;
const ASSIST_RETURN = 0.12;
const ASSIST_FLOOR = 0.25;
/**
 * A hint in the middle of a match: the ghost thumb shows a shot worth trying
 * (a lob over somebody at the net, a chiquita to somebody far back) or the
 * court shows where to wait for a ball coming off the glass. Each one shows
 * this many times at most, and never again once the person has played that
 * shot: it is a nudge, not a lesson.
 */
const HINT_TIMES = 2;
/** A hint shows from this long before the ball arrives. */
const HINT_LEAD = 1.8;
/** Where the rival has to be for a lob or a chiquita to be the shot worth trying, in metres from the net. */
const HINT_RIVAL_NET = 4.8;
const HINT_RIVAL_BACK = 7.5;

/** The stick pushed away from the net: down the screen. */
const BACK_PUSH = { x: 0, y: 1 };

/** Today as yyyy-mm-dd on the person's own calendar, for the history with each rival. */
function today(): string {
  const now = new Date();
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/**
 * Experimental switches of one launch, on the web from the query string:
 *   ?dobles            a quick match in doubles
 *   ?alcance=real      the reach of a real person, for everybody (?alcance=actual, today's)
 *   ?lado=reves        in doubles, play the left side (?lado=drive, the right one)
 *   ?companero=chela   in doubles, who plays with you (beto, romina or chela)
 *   ?actitud=agresiva  in doubles, how your partner plays with you (agresiva, equilibrada or pasiva)
 *   ?rivales=pasiva    in doubles, the same for both of the other pair (each one's own, otherwise)
 * They win over the options while the page is open and are never saved.
 */
interface Trial {
  doubles?: boolean;
  reach?: ReachName;
  side?: SideName;
  partner?: RivalId;
  attitude?: Attitude;
  rivals?: Attitude;
}

function readTrial(launch: Launch): Trial {
  const trial: Trial = {};
  if (launch.flag('dobles')) trial.doubles = launch.value('dobles') !== 'no';
  const reach = launch.value('alcance');
  if (reach === 'real') trial.reach = 'real';
  else if (reach === 'actual') trial.reach = 'generous';
  const side = launch.value('lado');
  if (side === 'reves' || side === 'revés') trial.side = 'reves';
  else if (side === 'drive') trial.side = 'drive';
  const partner = launch.value('companero') ?? launch.value('compañero');
  if (partner && (RIVALS as readonly string[]).includes(partner)) trial.partner = partner as RivalId;
  const attitude = attitudeFrom(launch.value('actitud'));
  if (attitude) trial.attitude = attitude;
  const rivals = attitudeFrom(launch.value('rivales'));
  if (rivals) trial.rivals = rivals;
  return trial;
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
  /** What should sound, from what happens in the match. Reads it, never changes it. */
  private readonly director: SoundDirector;
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
    aids: 'minimal',
    aidStrength: 1,
    reduceMotion: false,
    debug: false,
    cueLead: 0,
    tutorial: null,
    guide: false,
    follow: false,
    cast: [],
    acts: [],
  };
  private ais: AIController[] = [];
  /** Experimental switches of this launch. They are not saved (see `readTrial`). */
  private readonly trial: Trial;
  /** The match being played is one of doubles. */
  private doubles = false;
  /** Doubles: who each player of the match is, by position in `match.players` (null for the person). */
  private lineup: Array<RivalId | null> = [];
  /** The lesson being played, when the mode is the tutorial. */
  private drill: Drill | null = null;
  private lessonAt = 0;
  /** The lesson that has just been completed, for the list to say so once. */
  private lessonJustDone: number | null = null;
  /** The ball each hint was last counted for, so a ball counts once. */
  private readonly hintBalls: Record<HintId, number> = { lob: -1, drop: -1, wall: -1 };
  private readonly ghost: SceneTutorial = { scheme: 'two', stickSide: 'left', step: 'play', drag: null, push: null };
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
    this.trial = readTrial(platform.launch);
    this.director = new SoundDirector(platform.sound);
    this.viewport = new Viewport(canvas, VIEW.dprCap);
    this.renderer = new StageRenderer(
      canvas,
      this.config.court,
      platform.assets,
      { shotName, quality: TEXT.quality, tooFar: TEXT.whiffFar },
      { allow3d: !platform.launch.flag('2d') },
    );
    // Behind a menu the game is a still picture: it is drawn again when the renderer has something new to show.
    this.renderer.onChange = () => this.draw();
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
        onLesson: (index) => this.startLesson(index),
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

  start(mode: Exclude<PlayMode, 'tutorial'>, saved: SavedMatch | null = null, greet = true): void {
    this.mode = mode;
    this.drill = null;
    this.hud.lesson(null);
    this.rival = saved?.rival ?? this.settings.rival;
    this.match = this.createMatch(mode, saved);
    this.quietStart();
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
      this.platform.analytics.track('match_start', { format: mode, rival: this.rival, doubles: this.doubles });
    }
    if (this.settings.fullscreen) this.setImmersive(true);
    this.drainEvents();
    if (opening) this.say(opening);
    this.startLoop();
  }

  /**
   * A lesson of the tutorial: a practice court with the coach on the other
   * side. It can be started from the start screen or from the pause of a
   * match, which stays saved at its last point.
   */
  startLesson(index: number): void {
    const lesson = LESSONS[index];
    if (!lesson) return;
    this.mode = 'tutorial';
    this.doubles = false;
    this.lessonAt = index;
    this.lessonJustDone = null;
    const config = createConfig();
    this.config = config;
    this.ais = [];
    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    const drill = new Drill(lesson, config, new Rng(seed + 1));
    const assisted = this.settings.assistedMovement;
    this.quietStart();
    this.match = new Match({
      config,
      seed,
      practice: true,
      teams: [
        {
          name: TEXT.you,
          players: [
            {
              name: TEXT.you,
              isHuman: true,
              manual: !assisted,
              speedFactor: 1,
              reaction: assisted ? ASSISTED_REACTION : 0,
              errorScale: 1,
              reachScale: HUMAN_REACH,
              hand: 1,
              holdNet: HUMAN_HOLD_NET,
              controller: new HumanController(this.input),
            },
          ],
        },
        {
          name: TEXT.coach,
          players: [{ name: TEXT.coach, isHuman: false, manual: false, ...COACH_SETUP, reachScale: 1, hand: CAST.beto.hand, controller: drill.coach }],
        },
      ],
    });
    drill.begin(this.match);
    this.drill = drill;

    // The coach is Beto, and he has nothing to say: the lesson is the ball.
    const { cast, acts } = this.options;
    cast.length = 0;
    acts.length = 0;
    for (const player of this.match.players) {
      cast.push(player.isHuman ? null : CAST.beto);
      acts.push(null);
    }
    this.rivalIndex = -1;
    this.personality.clear();
    this.golden = false;

    this.renderer.reset();
    this.input.clear();
    this.pointer.release();
    this.hud.clear();
    this.hud.setVisible(true);
    this.showLesson();
    this.screens.hide();
    this.state = 'playing';
    this.accumulator = 0;
    this.hitStop = 0;
    this.warmup = 2;
    this.autoQuality.reset();
    this.setInputEnabled(true);
    this.platform.analytics.track('lesson_start', { lesson: lesson.id });
    if (this.settings.fullscreen) this.setImmersive(true);
    this.drainEvents();
    this.startLoop();
  }

  private showLesson(): void {
    const drill = this.drill;
    if (!drill) return;
    const text = TEXT.lesson[drill.lesson.id];
    this.hud.lesson({ name: `${this.lessonAt + 1}. ${text.name}`, cue: text.cue, done: drill.progress, goal: drill.lesson.goal });
  }

  /** The lesson is done: it is marked, and the list comes back with the next one ready. */
  private finishLesson(): void {
    const drill = this.drill;
    if (!drill) return;
    const id = drill.lesson.id;
    if (!this.profile.lessons.includes(id)) this.profile.lessons.push(id);
    // Whoever has done a lesson is no longer a first visit: next time the game opens on the start screen.
    this.profile.introDone = true;
    saveProfile(this.platform.storage, this.profile);
    this.platform.analytics.track('lesson_done', { lesson: id });
    this.lessonJustDone = this.lessonAt;
    this.state = 'menu';
    this.setInputEnabled(false);
    this.stopLoop();
    this.hud.clear();
    this.hud.setVisible(false);
    this.screens.hide();
    this.screens.show('tutorial');
    this.draw();
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
    if (this.doubles) {
      // Doubles, for now without words: everybody is who it is, and nobody talks.
      for (let i = 0; i < players.length; i++) {
        const id = this.lineup[i];
        cast[i] = id ? CAST[id] : null;
      }
      this.rivalIndex = -1;
      this.personality.clear();
      return null;
    }
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
    this.renderer.project(who.x, who.y, BUBBLE_HEIGHT * figureScale(who.y), this.anchor);
    this.hud.placeBubble(this.anchor.x, this.anchor.y, this.viewport.width);
  }

  private continueSaved(): void {
    if (this.saved) this.start(this.saved.format, this.saved);
  }

  private rematch(): void {
    if (this.mode === 'tutorial') {
      this.startLesson(this.lessonAt);
      return;
    }
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
    this.platform.sound.setPaused(true);
    this.setInputEnabled(false);
    this.screens.show('pause');
    this.stopLoop();
    this.draw();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.platform.sound.setPaused(false);
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
    this.platform.sound.hush();
    this.platform.sound.setPaused(false);
    this.drill = null;
    this.lessonJustDone = null;
    this.hud.lesson(null);
    this.setInputEnabled(false);
    this.stopLoop();
    this.hud.clear();
    this.hud.setVisible(false);
    this.screens.show('menu');
    this.draw();
  }

  /** A new match or lesson starts in silence: nothing of the last one is still ringing. */
  private quietStart(): void {
    this.director.reset();
    this.platform.sound.hush();
    this.platform.sound.setPaused(false);
  }

  /** A touch during the pause between points moves on to the next one. */
  private skipPause(): void {
    if (this.state === 'playing' && this.match.skipPause()) this.hud.dismiss();
  }

  private finish(): void {
    if (this.mode === 'tutorial') return;
    if (this.mode === 'demo' && this.loopDemo) {
      this.start('demo');
      return;
    }
    this.state = 'over';
    this.setInputEnabled(false);
    this.stopLoop();
    const games = this.match.score.games;
    const won = this.match.score.winner === 0;
    const line = this.mode === 'demo' || this.doubles ? null : this.personality.rematchLine(won);
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

  private createMatch(mode: Exclude<PlayMode, 'tutorial'>, saved: SavedMatch | null): Match {
    const config = createConfig();
    config.rules.format = { ...FORMATS[mode === 'demo' ? 'quick' : mode] };
    // Experimental: the reach of a real person, the same for everybody.
    const real = (this.trial.reach ?? this.settings.reach) === 'real';
    config.player.realReach = real;
    this.config = config;
    this.ais = [];
    // A match picked up again is the one it was: one against one.
    this.doubles = (this.trial.doubles ?? this.settings.doubles) && !saved;
    this.lineup = [];

    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    const ai = (id: RivalId, offset: number, firstMatch = false, partner = false, attitude?: Attitude): PlayerEntry => {
      const who = CAST[id];
      let level = config.rivals[id];
      // A coach feeds more balls to somebody he has just met.
      if (firstMatch) level.feed = toAILevel(who, true).feed;
      // On your side, the same character plays to win and with steadier hands.
      if (partner) level = asPartner(level);
      // In doubles, how it shares the court.
      if (attitude) level = withAttitude(level, attitude);
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
        holdNet: level.holdNet,
        composure: level.composure,
        reading: level.smart,
        attitude,
        controller,
      };
    };

    if (this.doubles) return this.createDoubles(mode, config, seed, ai);

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

    return new Match({
      config,
      seed,
      teams: [
        { name: TEXT.you, players: [this.humanEntry(real)] },
        { name: CAST[this.rival].name, players: [ai(this.rival, 1, !this.profile.rivals[this.rival]?.played)] },
      ],
      resume: saved?.snapshot,
      // The first rally ever is the tutorial: the rival goes easy until a point is won.
      tutorial: !this.profile.introDone && !saved,
      record: this.platform.launch.flag('record'),
    });
  }

  /** The person's player. With the real reach it gets exactly what everybody gets. */
  private humanEntry(real: boolean): PlayerEntry {
    const assisted = this.settings.assistedMovement;
    return {
      name: TEXT.you,
      isHuman: true,
      manual: !assisted,
      speedFactor: 1,
      reaction: assisted ? ASSISTED_REACTION : 0,
      errorScale: 1,
      reachScale: real ? 1 : HUMAN_REACH,
      hand: 1,
      holdNet: HUMAN_HOLD_NET,
      controller: new HumanController(this.input),
    };
  }

  /**
   * Doubles (experimental): the person and a partner of the cast against the
   * other two. The person plays the side it chose: drive, on the right, or
   * revés, on the left. In the demo a plain player takes the person's place.
   */
  private createDoubles(
    mode: Exclude<PlayMode, 'tutorial'>,
    config: GameConfig,
    seed: number,
    ai: (id: RivalId, offset: number, firstMatch?: boolean, partner?: boolean, attitude?: Attitude) => PlayerEntry,
  ): Match {
    const partnerId = this.trial.partner ?? this.settings.partner;
    const [rivalA, rivalB] = RIVALS.filter((id) => id !== partnerId) as [RivalId, RivalId];
    // Your partner plays with the attitude you asked it for; everybody else with its own.
    const mate = ai(partnerId, 3, false, true, this.trial.attitude ?? partnerAttitude(this.settings, partnerId));
    const rival = (id: RivalId, offset: number): PlayerEntry => ai(id, offset, false, false, this.trial.rivals ?? CAST[id].attitude);
    const reves = (this.trial.side ?? this.settings.side) === 'reves';
    const demo = mode === 'demo';
    const me: PlayerEntry = demo ? { ...rival(this.rival, 4), name: TEXT.you } : this.humanEntry(config.player.realReach);
    const near = reves ? [mate, me] : [me, mate];
    this.lineup = reves ? [partnerId, null, rivalA, rivalB] : [null, partnerId, rivalA, rivalB];
    return new Match({
      config,
      seed,
      teams: [
        { name: TEXT.pair(TEXT.you, CAST[partnerId].name), players: near },
        { name: TEXT.pair(CAST[rivalA].name, CAST[rivalB].name), players: [rival(rivalA, 1), rival(rivalB, 2)] },
      ],
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
    this.hud.hints = settings.aids === 'full';
    this.renderer.setCamera(settings.reduceMotion ? 'fixed' : settings.camera);
    this.platform.sound.setEnabled(settings.sound);
    this.platform.sound.setVolumes(settings.effects, settings.ambience);
    this.personality.frequency = settings.lines;
    this.hud.calm = settings.reduceMotion;
    if (settings.lines === 'none') this.hud.hush();

    // A new rival takes over the match in progress, unless it is a continued one against somebody else.
    // A doubles lineup stays as it is until the next match.
    const match = this.mode !== 'demo' && this.mode !== 'tutorial' && !this.doubles;
    if (match && this.state !== 'paused') this.rival = settings.rival;
    if (match && this.state === 'paused' && settings.rival !== this.rival) {
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
      } else if (match) {
        player.speedFactor = level.speedFactor;
        player.reaction = level.reaction;
        player.errorScale = level.errorScale;
        player.wallBias = level.wallBias;
        player.holdNet = level.holdNet;
        player.composure = level.composure;
        player.reading = level.smart;
      }
    }
    if (match) for (const controller of this.ais) controller.level = level;

    if (!settings.showFps) this.hud.showFps(null);
    if (this.state !== 'menu' || !settings.fullscreen) this.setImmersive(settings.fullscreen);
    this.draw();
  }

  private drainEvents(): void {
    const events = this.match.events;
    if (events.length === 0) return;
    const humanTeam = this.mode === 'demo' ? -1 : 0;
    const drill = this.drill;
    for (const event of events) {
      this.renderer.onEvent(event, this.scene);
      // In a lesson there is no score to tell: the board is the lesson itself.
      if (drill) drill.onEvent(event, this.match);
      else this.hud.onEvent(event, this.match, humanTeam);
      this.react(event);
      this.director.onEvent(event, this.match);
      this.onSimEvent?.(event);
    }
    events.length = 0;
    if (drill?.justPassed) this.showLesson();
  }

  /** Everything around the match that follows from what just happened: feel, saving, counting. */
  private react(event: SimEvent): void {
    const { storage, analytics } = this.platform;
    // A lesson is played by the person, but nothing in it is a match: no rival, no score, nothing to save.
    const playing = this.mode !== 'demo' && this.mode !== 'tutorial';
    // Doubles is a trial for now: it counts as a match, but not in the history with a rival, and it is not saved.
    const record = playing && !this.doubles ? this.profile.rivals[this.rival] : undefined;
    if (playing && !this.doubles) {
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
        if (playing && !this.doubles) {
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
      case 'whiff':
        // Not getting there is a miss too.
        if (playing && event.reason === 'far' && this.match.players[event.player]?.isHuman) this.learn(false);
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
        analytics.track('match_end', { won: event.winner === 0, rival: this.rival, format: this.mode, doubles: this.doubles });
        break;
      default:
        break;
    }
  }

  /** Weight for the good hits, and the counting that goes with a hit by the person. */
  private onHit(event: Extract<SimEvent, { type: 'hit' }>): void {
    const { haptics, analytics, launch } = this.platform;
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
    // The shots that have to be found: once the person has played one, nobody points at it again.
    if (event.kind === 'lob') this.profile.shots.lob++;
    else if (event.kind === 'drop') this.profile.shots.drop++;
    else if (event.kind === 'wallExit') this.profile.shots.wall++;
    if (this.mode === 'tutorial') return;
    this.profile.hits[event.quality]++;
    // A shot armed early came off too: whoever plays like that is not waiting for a signal.
    this.learn(event.quality !== 'late');
    // The first rally hit that comes off ends the first-time help.
    if (!this.profile.introDone && event.quality !== 'late') {
      this.profile.introDone = true;
      saveProfile(this.platform.storage, this.profile);
      analytics.track('intro_done');
    }
  }

  /** The minimal aids fade as the person gets it right, and come back when they do not. */
  private learn(good: boolean): void {
    const profile = this.profile;
    profile.assist = clamp(profile.assist + (good ? -ASSIST_FADE : ASSIST_RETURN), 0, 1);
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
    const done = LESSONS.map((lesson) => profile.lessons.includes(lesson.id));
    const pending = done.indexOf(false);
    const justDone = this.lessonJustDone;
    // After a lesson, the next one that is not done; otherwise the first that is not.
    const after = justDone === null ? -1 : done.indexOf(false, justDone + 1);
    return {
      lessons: { done, next: after >= 0 ? after : pending, justDone },
      inLesson: this.mode === 'tutorial',
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
    const drill = this.drill;
    // Behind the start screen the court is only scenery. A lesson always shows what it teaches with.
    options.aids = this.state === 'menu' ? 'none' : drill && settings.aids === 'none' ? 'minimal' : settings.aids;
    options.aidStrength = drill ? 1 : ASSIST_FLOOR + (1 - ASSIST_FLOOR) * this.profile.assist;
    options.reduceMotion = settings.reduceMotion;
    options.debug = settings.showFps;
    options.cueLead = CONTROLS.cueLead[settings.scheme];
    options.tutorial = null;
    options.guide = false;
    options.follow = false;
    if (!playing) return options;

    const match = this.match;
    if (drill) {
      // A lesson: the ghost thumb shows its gesture while the ball is coming.
      const shown = drill.gesture;
      options.guide = drill.lesson.guide;
      options.follow = drill.lesson.follow;
      if (shown && match.phase === 'rally' && match.rally.live && match.rally.hitter !== 0) {
        options.tutorial = this.gesture(shown.gesture, shown.side);
      }
    } else if (!this.profile.introDone) {
      // First visit: ghost thumbs show the gestures until a hit comes off.
      const serving = (match.phase === 'serve' || match.phase === 'windup') && match.server.isHuman;
      options.tutorial = this.gesture(serving ? 'serve' : 'play', 1);
    } else if (settings.aids !== 'none') {
      const hint = this.hint();
      if (hint === 'wall') {
        options.guide = true;
        options.follow = true;
      } else if (hint) {
        options.tutorial = this.gesture(hint, 1);
      }
    }
    return options;
  }

  /**
   * A shot the person has not found yet and that is the one to play right
   * now, or null. It only says something a moment before the ball arrives,
   * and only until the person has done it once.
   */
  private hint(): HintId | null {
    const match = this.match;
    const { shots, hints } = this.profile;
    const me = match.players.find((player) => player.isHuman);
    const rival = match.players[this.rivalIndex];
    const plan = me?.plan;
    if (!me || !rival || !plan || me.swing || !match.rally.live || match.rally.hitter === me.team) return null;
    if (plan.t - match.time > HINT_LEAD) return null;

    let hint: HintId | null = null;
    const high = plan.z >= this.config.player.overheadZ;
    const rivalNet = Math.abs(rival.y);
    const open = (id: HintId): boolean => shots[id] === 0 && (hints[id] < HINT_TIMES || this.hintBalls[id] === plan.trajId);
    if (me.guide?.kind === 'wall' && open('wall')) hint = 'wall';
    else if (!high && rivalNet < HINT_RIVAL_NET && Math.abs(plan.y) >= 5 && open('lob')) hint = 'lob';
    else if (!high && rivalNet > HINT_RIVAL_BACK && Math.abs(plan.y) < 6.5 && open('drop')) hint = 'drop';
    // Counted once per ball, the first time it shows.
    if (hint && this.hintBalls[hint] !== plan.trajId) {
      this.hintBalls[hint] = plan.trajId;
      hints[hint]++;
      saveProfile(this.platform.storage, this.profile);
    }
    return hint;
  }

  /** The ghost hand for a gesture, in the pixels of the control scheme in use. */
  private gesture(gesture: Gesture | 'serve' | HintId, side: 1 | -1): SceneTutorial {
    const settings = this.settings;
    const ghost = this.ghost;
    const two = settings.scheme === 'two';
    ghost.scheme = settings.scheme;
    ghost.stickSide = settings.stickSide;
    ghost.step = 'aim';
    ghost.drag = null;
    ghost.push = null;
    switch (gesture) {
      case 'serve':
        ghost.step = 'serve';
        break;
      case 'play':
        ghost.step = 'play';
        break;
      case 'back':
        // Screen-down is away from the net.
        ghost.step = 'play';
        ghost.push = BACK_PUSH;
        break;
      case 'side':
        ghost.drag = two ? { x: side * CONTROLS.aimRadius * 0.85, y: -42 } : { x: side * 57, y: -82 };
        break;
      case 'lob':
        ghost.drag = two ? { x: 0, y: -(CONTROLS.lobAt + 16) } : { x: 0, y: -(CONTROLS.flickLobLength + 20) };
        break;
      case 'drop':
        ghost.drag = two ? { x: 0, y: CONTROLS.dropAt + 14 } : { x: 0, y: 62 };
        break;
      default:
        break;
    }
    return ghost;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.pointer.update(now);
    this.advance(dt);
  };

  /**
   * One frame of the game: `dt` seconds of match, and the picture of where
   * that leaves it. The loop calls it with the time that really went by; a
   * tool can stop the loop and call it itself, to look at the game frame by
   * frame.
   */
  advance(dt: number): void {
    const workStart = performance.now();
    this.syncViewport();

    // Fixed-step simulation: run as many steps as real time asks for.
    if (this.hitStop > 0) this.hitStop -= dt;
    else this.accumulator += dt * this.settings.speed;
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      this.match.step();
      this.drill?.step(this.match);
      this.accumulator -= SIM_DT;
      steps++;
      this.drainEvents();
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    // Footsteps and the swing of a smash come from how the players move.
    this.director.update(this.match, this.settings.speed);
    if (this.drill?.done) {
      this.finishLesson();
      return;
    }

    // The rival's tic, if it is in the middle of one, and its bubble over its head.
    if (this.rivalIndex >= 0) this.options.acts[this.rivalIndex] = this.personality.actAt(this.match.time);
    fillScene(this.scene, this.match, this.accumulator / SIM_DT, this.input, this.sceneOptions());
    this.renderer.render(this.scene, dt);
    if (this.hud.speaking) this.placeBubble();

    this.stats.push(dt, performance.now() - workStart);
    if (this.stats.fresh) this.onStats();

    if (this.match.phase === 'matchOver') this.finish();
  }

  private onStats(): void {
    const stats = this.stats;
    if (this.settings.showFps) {
      const canvas = this.viewport;
      this.hud.showFps(
        `${stats.fps.toFixed(0)} fps\n` +
          `${stats.frameMs.toFixed(1)} ms (peor ${stats.worstMs.toFixed(0)})\n` +
          `cpu ${stats.workMs.toFixed(2)} ms\n` +
          `${this.renderer.look} ${Math.round(canvas.width * canvas.pixelRatio)}×${Math.round(canvas.height * canvas.pixelRatio)}`,
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
