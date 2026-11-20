import { CAST } from '../characters/cast';
import type { FormatName } from '../config';
import { ATTITUDES, type Attitude } from '../sim/pair';
import { partnerAttitude, RIVALS, SPEEDS, VOLUMES, type LineFrequency, type SideName, type Settings } from './settings';
import { LESSONS } from '../app/drill';
import { TEXT } from './text';

export type ScreenName = 'menu' | 'pause' | 'options' | 'over' | 'tutorial';

export interface ScreenHandlers {
  onPlay(format: FormatName): void;
  /** Continue the match that was saved. */
  onContinue(): void;
  onDemo(): void;
  onResume(): void;
  onRestart(): void;
  onMenu(): void;
  /** Start a lesson of the tutorial, by its place in the list. */
  onLesson(index: number): void;
  /** A setting changed: apply it and save it. */
  onSettings(settings: Settings): void;
  /** Open the animation studio: every situation of the game, to look at without playing. */
  onStudio(): void;
}

/** What the screens show that is not a setting. Asked for every time a screen is built. */
export interface ScreenInfo {
  /** Score of the match that can be continued, or null. */
  saved: string | null;
  /** About the rival that is selected: who it is, how it plays, and the history with it. */
  rival: { who: string; style: string; record: string };
  /** Lines for "data on this device". */
  stats: string[];
  canVibrate: boolean;
  canGoFullscreen: boolean;
  /** The tutorial: which lessons are done, which comes next, and the one that has just been completed, if any. */
  lessons: { done: boolean[]; next: number; justDone: number | null };
  /** A lesson is being played: the pause is the one of the tutorial. */
  inLesson: boolean;
}

export interface MatchResult {
  won: boolean;
  /** Games of the person and of the rival. */
  games: [number, number];
  /** What the rival has to say about a rematch, if anything. */
  quote: { who: string; text: string } | null;
}

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.append(...children);
  return element;
}

function button(label: string, className: string, onClick: () => void, note = ''): HTMLButtonElement {
  const element = el('button', className, label);
  element.type = 'button';
  if (note) element.append(el('small', '', note));
  element.addEventListener('click', onClick);
  return element;
}

/**
 * Where the partner stands with each attitude, on a court seen from behind
 * your own end, as the game is: you (the ring) on your side, the partner (the
 * dot) up at the net, level with you or back by the glass. A padel player
 * reads it without the word under it.
 */
const ATTITUDE_SPOTS: Record<Attitude, { you: number; mate: number }> = {
  aggressive: { you: 41, mate: 28 },
  balanced: { you: 40, mate: 40 },
  passive: { you: 36, mate: 44.5 },
};

/** A padel court from behind your own end, 10 × 20 m: the net in the middle and the service lines with their T. */
const COURT_ICON =
  '<rect x="4" y="2" width="24" height="48" rx="2" fill="currentColor" fill-opacity="0.12" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.2"/>' +
  '<path d="M4 9.3H28M4 42.7H28M16 9.3V42.7" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="0.9"/>' +
  '<line x1="2.5" y1="26" x2="29.5" y2="26" stroke="currentColor" stroke-width="2"/>';

function attitudeIcon(attitude: Attitude, side: SideName): HTMLElement {
  const spots = ATTITUDE_SPOTS[attitude];
  // Revés is the left of the pair, seen from behind it.
  const youX = side === 'reves' ? 10 : 22;
  const mateX = side === 'reves' ? 22 : 10;
  // Inline SVG through the HTML parser: static markup, nothing of the person's in it.
  const icon = el('span', 'icon');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML =
    '<svg viewBox="0 0 32 52" width="30" height="49" focusable="false">' +
    COURT_ICON +
    `<circle cx="${youX}" cy="${spots.you}" r="2.9" fill="none" stroke="currentColor" stroke-width="1.6"/>` +
    `<circle cx="${mateX}" cy="${spots.mate}" r="3.6" fill="currentColor"/>` +
    '</svg>';
  return icon;
}

/**
 * Menus, as DOM over the canvas: real buttons, keyboard focus and screen
 * reader support for free. Every screen is rebuilt when it is shown, which
 * keeps this file free of state to synchronise.
 */
export class Screens {
  current: ScreenName | null = null;
  private cameFrom: ScreenName = 'menu';
  private result: MatchResult = { won: false, games: [0, 0], quote: null };

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
    private readonly handlers: ScreenHandlers,
    private readonly info: () => ScreenInfo,
  ) {}

  show(name: ScreenName, result?: MatchResult): void {
    if (result) this.result = result;
    const leaf = name === 'options' || name === 'tutorial';
    if (leaf && this.current && this.current !== 'options' && this.current !== 'tutorial') this.cameFrom = this.current;
    // With nothing behind it (a lesson has just ended), the way back from the tutorial is the start screen.
    if (name === 'tutorial' && !this.current) this.cameFrom = 'menu';
    this.current = name;
    this.root.replaceChildren(this.build(name));
    this.root.classList.add('open');
    // The start screen sits low, where the thumb is.
    this.root.classList.toggle('low', name === 'menu');
    // Keyboard and switch users land on the main action.
    const main = this.root.querySelector<HTMLElement>('.btn.primary') ?? this.root.querySelector<HTMLElement>('.btn');
    main?.focus({ preventScroll: true });
  }

  hide(): void {
    this.current = null;
    this.root.classList.remove('open', 'low');
    this.root.replaceChildren();
  }

  private build(name: ScreenName): HTMLElement {
    switch (name) {
      case 'menu':
        return this.menu();
      case 'pause':
        return this.pause();
      case 'options':
        return this.options();
      case 'over':
        return this.over();
      case 'tutorial':
        return this.tutorial();
    }
  }

  /** One touch and you are playing: the quick match is always the main button. */
  private menu(): HTMLElement {
    const info = this.info();
    const panel = el('section', 'panel', el('h1', '', TEXT.title));
    if (info.saved) {
      panel.append(button(TEXT.resumeMatch, 'btn', this.handlers.onContinue, info.saved));
    }
    panel.append(
      button(TEXT.quickMatch, 'btn primary', () => this.handlers.onPlay('quick'), TEXT.quickMatchNote),
      button(TEXT.fullMatch, 'btn', () => this.handlers.onPlay('match'), TEXT.fullMatchNote),
      this.choice(
        TEXT.rival,
        'rival',
        RIVALS.map((id) => [id, CAST[id].name] as const),
        [`${info.rival.who} · ${info.rival.style}`, info.rival.record],
      ),
      el(
        'div',
        'row',
        button(TEXT.tutorial, 'btn quiet', () => this.show('tutorial')),
        button(TEXT.options, 'btn quiet', () => this.show('options')),
        button(TEXT.demo, 'btn quiet', this.handlers.onDemo),
      ),
    );
    return panel;
  }

  private pause(): HTMLElement {
    const inLesson = this.info().inLesson;
    return el(
      'section',
      'panel',
      el('h2', '', TEXT.paused),
      button(TEXT.resume, 'btn primary', this.handlers.onResume),
      button(TEXT.restart, 'btn', this.handlers.onRestart),
      // Never in the way, always at hand: the shots can be learnt at any time.
      button(inLesson ? TEXT.lessons : TEXT.tutorial, 'btn', () => this.show('tutorial')),
      button(TEXT.options, 'btn', () => this.show('options')),
      button(TEXT.menu, 'btn quiet', this.handlers.onMenu),
    );
  }

  /** The lessons: any of them, in any order, as many times as wanted. The next one to do is the main button. */
  private tutorial(): HTMLElement {
    const { done, next, justDone } = this.info().lessons;
    const panel = el('section', 'panel', el('h2', '', TEXT.tutorial));
    const just = justDone === null ? null : LESSONS[justDone];
    panel.append(el('p', just ? 'result' : '', just ? TEXT.lessonJustDone(TEXT.lesson[just.id].name) : TEXT.lessonsNote));
    const list = el('div', 'lessons');
    LESSONS.forEach((lesson, index) => {
      const name = `${index + 1}. ${TEXT.lesson[lesson.id].name}`;
      // Done is said with a mark and a word, not with a colour.
      const item = button(name, index === next ? 'btn primary' : 'btn', () => this.handlers.onLesson(index), done[index] ? `✓ ${TEXT.lessonDone}` : '');
      list.append(item);
    });
    panel.append(list, button(this.cameFrom === 'pause' ? TEXT.back : TEXT.menu, 'btn quiet', () => (this.cameFrom === 'pause' ? this.show('pause') : this.handlers.onMenu())));
    return panel;
  }

  private over(): HTMLElement {
    const { won, games, quote } = this.result;
    const panel = el(
      'section',
      'panel',
      el('h2', '', won ? TEXT.win : TEXT.lose),
      el('p', 'result', `${games[0]} – ${games[1]} ${TEXT.games}`),
    );
    // The rival asks for another one right where the button is. No extra screen.
    if (quote) panel.append(el('p', 'quote', el('b', '', `${quote.who}: `), `«${quote.text}»`));
    panel.append(
      button(TEXT.rematch, 'btn primary', this.handlers.onRestart),
      button(TEXT.menu, 'btn', this.handlers.onMenu),
    );
    return panel;
  }

  private options(): HTMLElement {
    const s = TEXT.settings;
    const info = this.info();
    const onOff: Array<[boolean, string]> = [
      [true, s.on],
      [false, s.off],
    ];
    const panel = el(
      'section',
      'panel',
      el('h2', '', TEXT.options),

      el('h3', '', s.controls),
      this.choice(
        s.scheme,
        'scheme',
        [
          ['two', s.two],
          ['one', s.one],
        ],
        this.settings.scheme === 'two' ? s.twoHint : s.oneHint,
      ),
    );
    if (this.settings.scheme === 'two') {
      panel.append(
        this.choice(s.stickSide, 'stickSide', [
          ['left', s.left],
          ['right', s.right],
        ]),
      );
    }
    panel.append(
      this.choice(
        s.speed,
        'speed',
        SPEEDS.map((value) => [value, TEXT.speedLabel(value)] as [number, string]),
        s.speedHint,
      ),

      el('h3', '', s.rivalGroup),
      this.choice<'lines'>(
        s.lines,
        'lines',
        [
          ['many', s.linesMany],
          ['few', s.linesFew],
          ['none', s.linesNone],
        ] satisfies Array<[LineFrequency, string]>,
        s.linesHint,
      ),

      el('h3', '', s.aids),
      this.choice<'aids'>(
        s.aidLevel,
        'aids',
        [
          ['full', s.aidsFull],
          ['minimal', s.aidsMinimal],
          ['none', s.aidsNone],
        ],
        s.aidsHint[this.settings.aids],
      ),
      this.choice(s.assisted, 'assistedMovement', onOff, s.assistedHint),
      this.choice(s.reduceMotion, 'reduceMotion', onOff),
    );
    if (info.canVibrate) panel.append(this.choice(s.vibration, 'vibration', onOff));

    panel.append(el('h3', '', s.sound), this.choice(s.soundOn, 'sound', onOff, s.soundHint));
    if (this.settings.sound) {
      const levels = VOLUMES.map((value) => [value, TEXT.volumeLabel(value)] as [number, string]);
      panel.append(this.choice(s.effects, 'effects', levels), this.choice(s.ambience, 'ambience', levels, s.ambienceHint));
    }

    panel.append(
      el('h3', '', s.video),
      this.choice<'camera'>(
        s.camera,
        'camera',
        [
          ['follow', s.cameraFollow],
          ['fixed', s.cameraFixed],
        ],
        this.settings.reduceMotion ? s.cameraStill : s.cameraHint[this.settings.camera],
      ),
      this.choice(s.quality, 'quality', [
        ['auto', s.qualityAuto],
        ['high', s.qualityHigh],
        ['medium', s.qualityMedium],
        ['low', s.qualityLow],
      ]),
    );
    if (info.canGoFullscreen) panel.append(this.choice(s.fullscreen, 'fullscreen', onOff));
    panel.append(this.choice(s.fps, 'showFps', onOff));

    panel.append(
      el('h3', '', s.experimental),
      el('p', 'note', s.experimentalNote),
      this.choice(s.doubles, 'doubles', onOff, s.doublesHint),
    );
    if (this.settings.doubles) {
      panel.append(
        this.choice<'side'>(
          s.side,
          'side',
          [
            ['drive', s.sideDrive],
            ['reves', s.sideReves],
          ],
          s.sideHint[this.settings.side],
        ),
        this.choice(
          s.partner,
          'partner',
          RIVALS.map((id) => [id, CAST[id].name] as const),
        ),
        this.attitudeChoice(),
      );
    }
    panel.append(
      this.choice<'reach'>(
        s.reach,
        'reach',
        [
          ['generous', s.reachGenerous],
          ['real', s.reachReal],
        ],
        s.reachHint[this.settings.reach],
      ),
      this.choice(s.zones, 'zones', onOff, s.zonesHint[this.settings.zones ? 'on' : 'off']),
      el('div', 'field', el('span', 'label', s.studio), button(s.studioOpen, 'btn quiet', this.handlers.onStudio), el('p', 'note', s.studioHint)),
    );

    const data = el('div', 'field');
    for (const line of info.stats) data.append(el('p', 'note', line));
    data.append(el('p', 'note', s.dataNote));
    panel.append(
      el('h3', '', s.data),
      data,
      // The list is longer than a phone screen: the way back stays in view.
      el('div', 'sticky', button(TEXT.back, 'btn primary', () => this.show(this.cameFrom))),
    );
    return panel;
  }

  /**
   * Doubles: how the partner plays with you. Three small courts show where
   * it stands with each attitude; the one pressed is the one it will play
   * with. Each partner remembers what it was asked for, and one that was
   * asked for nothing plays its own (asking for its own is asking for nothing).
   */
  private attitudeChoice(): HTMLElement {
    const s = TEXT.settings;
    const partner = this.settings.partner;
    const own = CAST[partner].attitude;
    const current = partnerAttitude(this.settings, partner);
    const group = el('div', 'seg icons');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', s.attitude);
    for (const attitude of ATTITUDES) {
      const option = el('button', '', attitudeIcon(attitude, this.settings.side), el('span', '', s.attitudes[attitude]));
      option.type = 'button';
      option.setAttribute('aria-pressed', String(attitude === current));
      option.addEventListener('click', () => {
        const attitudes = { ...this.settings.attitudes };
        if (attitude === own) delete attitudes[partner];
        else attitudes[partner] = attitude;
        this.settings.attitudes = attitudes;
        this.handlers.onSettings(this.settings);
        if (this.current) this.show(this.current);
        this.root.querySelector<HTMLElement>('[data-key="attitude"] [aria-pressed="true"]')?.focus({ preventScroll: true });
      });
      group.append(option);
    }
    const field = el('div', 'field', el('span', 'label', s.attitude), group, el('p', 'note', s.attitudeHint[current]));
    if (current === own) field.append(el('p', 'note', s.attitudeOwn(CAST[partner].name)));
    field.dataset.key = 'attitude';
    return field;
  }

  /** A labelled group of buttons that sets one setting to one of a few values. */
  private choice<K extends keyof Settings>(
    label: string,
    key: K,
    options: ReadonlyArray<readonly [Settings[K], string]>,
    note: string | string[] = '',
  ): HTMLElement {
    const group = el('div', options.length >= 5 ? 'seg dense' : 'seg');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const option = button(text, '', () => {
        this.settings[key] = value;
        this.handlers.onSettings(this.settings);
        // Rebuild: the pressed state, the notes and dependent rows may all change.
        if (this.current) this.show(this.current);
        this.root.querySelector<HTMLElement>(`[data-key="${key}"] [aria-pressed="true"]`)?.focus({ preventScroll: true });
      });
      option.setAttribute('aria-pressed', String(this.settings[key] === value));
      group.append(option);
    }
    const field = el('div', 'field', el('span', 'label', label), group);
    field.dataset.key = key;
    for (const line of typeof note === 'string' ? [note] : note) {
      if (line) field.append(el('p', 'note', line));
    }
    return field;
  }
}
