import type { CharacterId } from '../characters/types';
import { SITUATIONS, type Group, type SituationId } from './situations';

/**
 * The controls of the studio: a review tool for a phone held upright. What to
 * look at and how goes on top, over the sky; play, pause and frame by frame
 * at the bottom, under the thumb. Short names, nothing more than that.
 */
export type CameraChoice = 'game' | 'close' | 'side';
export type Speed = 1 | 0.5 | 0.25;

export interface StudioHandlers {
  situation(id: SituationId): void;
  camera(camera: CameraChoice): void;
  side(near: boolean): void;
  character(character: CharacterId | null): void;
  look(look: '3d' | '2d'): void;
  play(): void;
  step(direction: 1 | -1): void;
  repeat(): void;
  speed(): void;
  exit(): void;
}

/** What the controls show; whatever is missing stays as it was. */
export interface StudioState {
  situation: SituationId;
  title: string;
  note: string;
  camera: CameraChoice;
  near: boolean;
  /** Who the player on show looks like, and which of the four can be shown. */
  character: CharacterId | null;
  look: '3d' | '2d';
  /** The cameras only move in 3D. */
  cameras: boolean;
  playing: boolean;
  speed: Speed;
  /** 0..1: how far into the loop, and where its key instant is. */
  progress: number;
  key: number;
}

const CSS = `
.studio{position:absolute;inset:0;pointer-events:none;color:#f5edd9;font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-tap-highlight-color:transparent;user-select:none}
.studio button{pointer-events:auto;font:inherit;color:inherit;border:0;margin:0;cursor:pointer;touch-action:manipulation}
.studio button:disabled{cursor:default}
.studio-top{position:absolute;left:8px;right:8px;top:calc(env(safe-area-inset-top,0px) + 8px);display:flex;flex-direction:column;gap:6px}
.studio-head{display:flex;gap:6px}
.studio-pick{flex:1;min-width:0;height:38px;padding:0 12px;border-radius:11px;background:rgba(24,22,30,.8);text-align:left;font-size:15px;display:flex;align-items:baseline;gap:8px;overflow:hidden;white-space:nowrap}
.studio-pick small{font-size:11px;font-weight:500;opacity:.72;overflow:hidden;text-overflow:ellipsis}
.studio-pick::after{content:"";margin-left:auto;align-self:center;border:5px solid transparent;border-top-color:currentColor;border-bottom:0;opacity:.7}
.studio-exit{width:38px;height:38px;border-radius:11px;background:rgba(24,22,30,.8);font-size:15px}
.studio-row{display:flex;gap:8px;justify-content:space-between}
.studio-seg{display:flex;padding:2px;border-radius:9px;background:rgba(24,22,30,.72)}
.studio-seg button{height:28px;padding:0 8px;border-radius:7px;background:none;opacity:.78}
.studio-seg button[aria-pressed=true]{background:#f5edd9;color:#291f34;opacity:1}
.studio-seg button:disabled{opacity:.3}
.studio-bottom{position:absolute;left:8px;right:8px;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);display:flex;flex-direction:column;gap:8px}
.studio-time{position:relative;height:5px;border-radius:3px;background:rgba(24,22,30,.65)}
.studio-bar{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:#e8f23a}
.studio-key{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;background:#f5edd9}
.studio-transport{display:flex;gap:6px;padding:6px;border-radius:15px;background:rgba(24,22,30,.8)}
.studio-transport button{flex:1;height:46px;border-radius:10px;background:rgba(245,237,217,.08);display:grid;place-items:center}
.studio-transport svg{width:22px;height:22px;fill:currentColor}
.studio-transport .studio-play{flex:1.5;background:#f5edd9;color:#291f34}
.studio-transport .studio-speed{font-size:15px}
.studio-sheet{position:absolute;left:0;right:0;bottom:0;max-height:80%;overflow:auto;padding:12px 12px calc(env(safe-area-inset-bottom,0px) + 14px);border-radius:16px 16px 0 0;background:rgba(24,22,30,.97);pointer-events:auto}
.studio-sheet[hidden],.studio-busy[hidden]{display:none}
.studio-sheet h4{margin:10px 4px 6px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.6}
.studio-list{display:flex;flex-wrap:wrap;gap:6px}
.studio-list button{height:38px;padding:0 12px;border-radius:9px;background:rgba(245,237,217,.09)}
.studio-list button[aria-pressed=true]{background:#f5edd9;color:#291f34}
.studio-list button:disabled{opacity:.32}
.studio-busy{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);padding:10px 14px;border-radius:12px;background:rgba(24,22,30,.86);font-size:13px;white-space:nowrap}
body.studio-on #hud,body.studio-on #overlay{display:none!important}
`;

const ICON = {
  repeat: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  back: 'M6 5h2v14H6zM20 5v14L9 12z',
  forward: 'M16 5h2v14h-2zM4 5l11 7-11 7z',
  play: 'M7 4v16l13-8z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
};

const svg = (path: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function button(label: string, onClick: () => void, className = '', title = ''): HTMLButtonElement {
  const element = el('button', className, label);
  element.type = 'button';
  if (title) element.setAttribute('aria-label', title);
  element.addEventListener('click', onClick);
  return element;
}

/** A row of choices of which one is on. */
function segment<T>(choices: Array<[T, string]>, pick: (value: T) => void): { root: HTMLElement; buttons: Map<T, HTMLButtonElement> } {
  const root = el('div', 'studio-seg');
  const buttons = new Map<T, HTMLButtonElement>();
  for (const [value, label] of choices) {
    const choice = button(label, () => pick(value));
    choice.setAttribute('aria-pressed', 'false');
    buttons.set(value, choice);
    root.append(choice);
  }
  return { root, buttons };
}

function press<T>(buttons: Map<T, HTMLButtonElement>, value: T): void {
  for (const [key, choice] of buttons) choice.setAttribute('aria-pressed', String(key === value));
}

const SPEED_LABEL: Record<Speed, string> = { 1: '1×', 0.5: '½×', 0.25: '¼×' };
const GROUPS: Group[] = ['Golpes', 'IA', 'Cuerpo', 'Correr'];

export class StudioUI {
  private readonly root = el('div', 'studio');
  private readonly title = el('span');
  private readonly note = el('small');
  private readonly sheet = el('div', 'studio-sheet');
  private readonly busy = el('div', 'studio-busy');
  private readonly bar = el('div', 'studio-bar');
  private readonly key = el('div', 'studio-key');
  private readonly play: HTMLButtonElement;
  private readonly speedButton: HTMLButtonElement;
  private readonly cameras;
  private readonly sides;
  private readonly characters;
  private readonly looks;
  private readonly entries = new Map<SituationId, HTMLButtonElement>();

  constructor(parent: HTMLElement, on: StudioHandlers) {
    const style = el('style');
    style.textContent = CSS;
    document.head.append(style);
    document.body.classList.add('studio-on');

    this.cameras = segment<CameraChoice>(
      [
        ['game', 'Juego'],
        ['close', 'Zoom'],
        ['side', 'Costado'],
      ],
      on.camera,
    );
    this.looks = segment<'3d' | '2d'>(
      [
        ['3d', '3D'],
        ['2d', '2D'],
      ],
      on.look,
    );
    this.sides = segment<boolean>(
      [
        [true, 'Cerca'],
        [false, 'Lejos'],
      ],
      on.side,
    );
    this.characters = segment<CharacterId | null>(
      [
        [null, 'Vos'],
        ['beto', 'Beto'],
        ['romina', 'Romina'],
        ['chela', 'Chela'],
      ],
      on.character,
    );

    const pick = button('', () => this.toggleSheet(), 'studio-pick', 'Elegir situación');
    pick.append(this.title, this.note);
    const head = el('div', 'studio-head');
    head.append(pick, button('✕', on.exit, 'studio-exit', 'Salir del estudio'));
    const one = el('div', 'studio-row');
    one.append(this.cameras.root, this.looks.root);
    const two = el('div', 'studio-row');
    two.append(this.sides.root, this.characters.root);
    const top = el('div', 'studio-top');
    top.append(head, one, two);

    const time = el('div', 'studio-time');
    time.append(this.bar, this.key);
    const transport = el('div', 'studio-transport');
    const icon = (path: string, action: () => void, title: string, className = ''): HTMLButtonElement => {
      const control = button('', action, className, title);
      control.innerHTML = svg(path);
      return control;
    };
    this.play = icon(ICON.pause, on.play, 'Pausa', 'studio-play');
    this.speedButton = button(SPEED_LABEL[1], on.speed, 'studio-speed', 'Velocidad');
    transport.append(
      icon(ICON.repeat, on.repeat, 'Repetir'),
      icon(ICON.back, () => on.step(-1), 'Cuadro anterior'),
      this.play,
      icon(ICON.forward, () => on.step(1), 'Cuadro siguiente'),
      this.speedButton,
    );
    const bottom = el('div', 'studio-bottom');
    bottom.append(time, transport);

    this.sheet.hidden = true;
    for (const group of GROUPS) {
      const list = el('div', 'studio-list');
      for (const situation of SITUATIONS.filter((item) => item.group === group)) {
        const entry = button(situation.label, () => {
          this.sheet.hidden = true;
          on.situation(situation.id);
        });
        entry.disabled = true;
        this.entries.set(situation.id, entry);
        list.append(entry);
      }
      this.sheet.append(el('h4', '', group), list);
    }

    this.root.append(top, bottom, this.sheet, this.busy);
    parent.append(this.root);
  }

  /** The situations that can be shown. */
  available(ids: ReadonlySet<SituationId>): void {
    for (const [id, entry] of this.entries) entry.disabled = !ids.has(id);
  }

  /** Says it is busy, and how far it got (0..1), or that it is done (null). */
  working(text: string | null): void {
    this.busy.hidden = text === null;
    if (text !== null) this.busy.textContent = text;
  }

  show(state: StudioState): void {
    this.title.textContent = state.title;
    this.note.textContent = state.note;
    for (const [id, entry] of this.entries) entry.setAttribute('aria-pressed', String(id === state.situation));
    press(this.cameras.buttons, state.camera);
    for (const choice of this.cameras.buttons.values()) choice.disabled = !state.cameras;
    press(this.looks.buttons, state.look);
    press(this.sides.buttons, state.near);
    press(this.characters.buttons, state.character);
    this.play.innerHTML = svg(state.playing ? ICON.pause : ICON.play);
    this.play.setAttribute('aria-label', state.playing ? 'Pausa' : 'Seguir');
    this.speedButton.textContent = SPEED_LABEL[state.speed];
    this.progress(state.progress, state.key);
  }

  progress(progress: number, key: number): void {
    this.bar.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 1000) / 10}%`;
    this.key.style.left = `${Math.round(Math.min(1, Math.max(0, key)) * 1000) / 10}%`;
  }

  private toggleSheet(): void {
    this.sheet.hidden = !this.sheet.hidden;
  }
}
