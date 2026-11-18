import { CAST } from '../characters/cast';
import type { FormatName } from '../config';
import { RIVALS, SPEEDS, type LineFrequency, type Settings } from './settings';
import { TEXT } from './text';

export type ScreenName = 'menu' | 'pause' | 'options' | 'over';

export interface ScreenHandlers {
  onPlay(format: FormatName): void;
  /** Continue the match that was saved. */
  onContinue(): void;
  onDemo(): void;
  onResume(): void;
  onRestart(): void;
  onMenu(): void;
  /** A setting changed: apply it and save it. */
  onSettings(settings: Settings): void;
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
    if (name === 'options' && this.current && this.current !== 'options') this.cameFrom = this.current;
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
        button(TEXT.options, 'btn quiet', () => this.show('options')),
        button(TEXT.demo, 'btn quiet', this.handlers.onDemo),
      ),
    );
    return panel;
  }

  private pause(): HTMLElement {
    return el(
      'section',
      'panel',
      el('h2', '', TEXT.paused),
      button(TEXT.resume, 'btn primary', this.handlers.onResume),
      button(TEXT.restart, 'btn', this.handlers.onRestart),
      button(TEXT.options, 'btn', () => this.show('options')),
      button(TEXT.menu, 'btn quiet', this.handlers.onMenu),
    );
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

  /** A labelled group of buttons that sets one setting to one of a few values. */
  private choice<K extends keyof Settings>(
    label: string,
    key: K,
    options: ReadonlyArray<readonly [Settings[K], string]>,
    note: string | string[] = '',
  ): HTMLElement {
    const group = el('div', 'seg');
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
