import { GAME_COUNTS, SPEEDS, type Settings } from './settings';
import { TEXT } from './text';

export type ScreenName = 'menu' | 'pause' | 'options' | 'over';

export interface ScreenHandlers {
  onPlay(): void;
  onDemo(): void;
  onResume(): void;
  onRestart(): void;
  onMenu(): void;
  /** A setting changed: apply it and save it. */
  onSettings(settings: Settings): void;
}

export interface MatchResult {
  won: boolean;
  /** Games of the person and of the rival. */
  games: [number, number];
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

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = el('button', className, label);
  element.type = 'button';
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
  private result: MatchResult = { won: false, games: [0, 0] };

  constructor(
    private readonly root: HTMLElement,
    private readonly settings: Settings,
    private readonly handlers: ScreenHandlers,
  ) {}

  show(name: ScreenName, result?: MatchResult): void {
    if (result) this.result = result;
    if (name === 'options' && this.current && this.current !== 'options') this.cameFrom = this.current;
    this.current = name;
    this.root.replaceChildren(this.build(name));
    this.root.classList.add('open');
    // Keyboard and switch users land on the main action.
    this.root.querySelector<HTMLElement>('.btn.primary, .btn')?.focus({ preventScroll: true });
  }

  hide(): void {
    this.current = null;
    this.root.classList.remove('open');
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

  private menu(): HTMLElement {
    const list = el('dl', 'howto');
    for (const [gesture, effect] of TEXT.howTo) list.append(el('dt', '', gesture), el('dd', '', effect));
    return el(
      'section',
      'panel',
      el('h1', '', TEXT.title),
      el('p', '', TEXT.subtitle),
      list,
      el('p', '', TEXT.howToTiming),
      this.choice(TEXT.settings.difficulty, 'difficulty', [
        ['easy', TEXT.level.easy],
        ['normal', TEXT.level.normal],
        ['hard', TEXT.level.hard],
      ]),
      button(TEXT.play, 'btn primary', this.handlers.onPlay),
      button(TEXT.options, 'btn', () => this.show('options')),
      button(TEXT.demo, 'btn quiet', this.handlers.onDemo),
    );
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
    const { won, games } = this.result;
    return el(
      'section',
      'panel',
      el('h2', '', won ? TEXT.win : TEXT.lose),
      el('p', 'result', `${games[0]} – ${games[1]} ${TEXT.games}`),
      button(TEXT.rematch, 'btn primary', this.handlers.onRestart),
      button(TEXT.menu, 'btn', this.handlers.onMenu),
    );
  }

  private options(): HTMLElement {
    const s = TEXT.settings;
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
        s.controls,
        'controlMode',
        [
          ['assisted', s.assisted],
          ['manual', s.manual],
        ],
        this.settings.controlMode === 'assisted' ? s.assistedHint : s.manualHint,
      ),
    );
    if (this.settings.controlMode === 'manual') {
      panel.append(
        this.choice(s.stickSide, 'stickSide', [
          ['left', s.left],
          ['right', s.right],
        ]),
      );
    }
    panel.append(
      this.choice(s.difficulty, 'difficulty', [
        ['easy', TEXT.level.easy],
        ['normal', TEXT.level.normal],
        ['hard', TEXT.level.hard],
      ]),
      this.choice(
        s.speed,
        'speed',
        SPEEDS.map((value) => [value, TEXT.speedLabel(value)] as [number, string]),
      ),
      this.choice(
        s.matchLength,
        'games',
        GAME_COUNTS.map((value) => [value, `${value} ${value === 1 ? s.game : s.gamesPlural}`] as [number, string]),
      ),

      el('h3', '', s.accessibility),
      this.choice(s.bounceMarker, 'bounceMarker', onOff),
      this.choice(s.timingAid, 'timingAid', onOff),
      this.choice(s.reduceMotion, 'reduceMotion', onOff),
      this.choice(s.vibration, 'vibration', onOff),

      el('h3', '', s.video),
      this.choice(s.camera, 'camera', [
        ['low', s.cameraLow],
        ['mid', s.cameraMid],
        ['high', s.cameraHigh],
      ]),
      this.choice(s.quality, 'quality', [
        ['auto', s.qualityAuto],
        ['high', s.qualityHigh],
        ['medium', s.qualityMedium],
        ['low', s.qualityLow],
      ]),
      this.choice(s.fps, 'showFps', onOff),

      button(TEXT.back, 'btn primary', () => this.show(this.cameFrom)),
    );
    return panel;
  }

  /** A labelled group of buttons that sets one setting to one of a few values. */
  private choice<K extends keyof Settings>(
    label: string,
    key: K,
    options: ReadonlyArray<readonly [Settings[K], string]>,
    note = '',
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
    if (note) field.append(el('p', 'note', note));
    return field;
  }
}
