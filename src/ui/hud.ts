import type { ControlScheme } from '../input/pointer';
import type { Match, SimEvent } from '../sim/match';
import { isGoldenPoint, pointLabel } from '../sim/score';
import { TEXT } from './text';

function need<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

/** How long a message stays up. Shorter than the pause between points, which can also be skipped. */
const MESSAGE_MS = 950;
/** How long a speech bubble stays up, unless the serve closes it first. */
const BUBBLE_MS = 1200;

/**
 * Scoreboard, messages and hints, as plain DOM over the canvas.
 * Text stays sharp at any resolution scale, and screen readers get the score
 * and the result of every point through the live regions.
 */
export class Hud {
  /** Which gestures the hints talk about. */
  scheme: ControlScheme = 'two';
  /**
   * Whether to say in words what to do. Off unless every aid was asked for:
   * the first time, ghost thumbs show the gestures, and nobody has to read.
   */
  hints = false;

  private readonly root: HTMLElement;
  private readonly rows: HTMLElement[];
  private readonly tag: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bubble: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly fps: HTMLElement;
  private bannerTimer = 0;
  private bubbleTimer = 0;
  private bubbleWidth = 0;
  private usesKeys = false;

  constructor(stage: HTMLElement, onPause: () => void) {
    this.root = need<HTMLElement>(stage, '#hud');
    this.rows = [need<HTMLElement>(this.root, '.row[data-team="0"]'), need<HTMLElement>(this.root, '.row[data-team="1"]')];
    this.tag = need<HTMLElement>(this.root, '.tag');
    this.banner = need<HTMLElement>(this.root, '#banner');
    this.bubble = need<HTMLElement>(this.root, '#bubble');
    this.hint = need<HTMLElement>(this.root, '#hint');
    this.fps = need<HTMLElement>(this.root, '#fps');
    need<HTMLButtonElement>(this.root, '#pause').addEventListener('click', onPause);
    // Hints mention the device actually in use.
    window.addEventListener('pointerdown', () => (this.usesKeys = false), { passive: true });
    window.addEventListener('keydown', () => (this.usesKeys = true), { passive: true });
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** Writes the score of the match into the scoreboard. */
  showScore(match: Match): void {
    const score = match.score;
    for (const team of [0, 1] as const) {
      const row = this.rows[team]!;
      need<HTMLElement>(row, '.name').textContent = match.teamNames[team];
      need<HTMLElement>(row, '.games').textContent = String(score.games[team]);
      need<HTMLElement>(row, '.points').textContent = pointLabel(score, team);
      const serving = score.servingTeam === team && score.winner === null;
      row.classList.toggle('serving', serving);
      row.setAttribute('aria-label', serving ? `${match.teamNames[team]}, ${TEXT.serves}` : match.teamNames[team]);
    }
    const open = score.winner === null;
    const label = !open ? '' : isGoldenPoint(score, match.format) ? TEXT.goldenPoint : score.tieBreak ? TEXT.tieBreak : '';
    this.tag.hidden = label === '';
    this.tag.textContent = label;
  }

  /** Reacts to what happened in the match. `humanTeam` is -1 when nobody is playing (demo). */
  onEvent(event: SimEvent, match: Match, humanTeam: number): void {
    const rival = humanTeam < 0 ? '' : match.teamNames[humanTeam === 0 ? 1 : 0];
    switch (event.type) {
      case 'serveReady': {
        this.showScore(match);
        const server = match.players[event.server];
        if (event.attempt > 1) this.say(TEXT.secondServe, '');
        // Keys cannot be shown with a ghost thumb: whoever is on a keyboard is told which ones.
        if (server?.isHuman && this.usesKeys) this.hint.textContent = TEXT.serveHint.keys;
        else if (!this.hints) this.hint.textContent = '';
        else if (server?.isHuman) this.hint.textContent = TEXT.serveHint[this.scheme];
        else this.hint.textContent = humanTeam >= 0 ? TEXT.rivalServes(rival) : '';
        break;
      }
      case 'toss':
        this.hint.textContent = '';
        break;
      case 'fault':
        this.say(TEXT.fault[event.reason], '');
        break;
      case 'let':
        this.say(TEXT.letServe, '');
        break;
      case 'point': {
        this.showScore(match);
        const title =
          humanTeam < 0
            ? match.teamNames[event.winner]
            : event.winner === humanTeam
              ? TEXT.pointYou
              : TEXT.pointRival(rival);
        this.say(title, TEXT.reason[event.reason]);
        break;
      }
      case 'game': {
        this.showScore(match);
        const title =
          humanTeam < 0
            ? match.teamNames[event.winner]
            : event.winner === humanTeam
              ? TEXT.gameYou
              : TEXT.gameRival(rival);
        this.say(title, '');
        break;
      }
      case 'tieBreak':
        this.showScore(match);
        this.say(TEXT.tieBreak, '');
        break;
      default:
        break;
    }
  }

  /** Shows a message in the middle of the court for a moment. */
  say(title: string, detail: string): void {
    this.banner.textContent = title;
    if (detail) {
      const small = document.createElement('small');
      small.textContent = detail;
      this.banner.append(small);
    }
    this.banner.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), MESSAGE_MS);
  }

  /** Takes the message away at once (the pause it belonged to was skipped). */
  dismiss(): void {
    window.clearTimeout(this.bannerTimer);
    this.banner.classList.remove('show');
  }

  clear(): void {
    this.dismiss();
    this.hush();
    this.banner.textContent = '';
    this.hint.textContent = '';
  }

  /** With reduced motion nothing pops: things fade in where they are. */
  set calm(calm: boolean) {
    this.root.classList.toggle('calm', calm);
  }

  /** True while somebody's speech bubble is up. */
  get speaking(): boolean {
    return this.bubbleTimer !== 0;
  }

  /**
   * Puts a line in the speech bubble for a moment. One bubble at a time: a
   * new line takes the place of the old one. `placeBubble` says where it goes.
   */
  speak(text: string): void {
    this.bubble.textContent = text;
    this.bubble.classList.add('show');
    this.bubbleWidth = this.bubble.offsetWidth;
    window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.hush(), BUBBLE_MS);
  }

  /** Keeps the bubble over the head of whoever is speaking: (x, y) in pixels of the stage. */
  placeBubble(x: number, y: number, stageWidth: number): void {
    const half = this.bubbleWidth / 2 + 6;
    const inside = Math.min(Math.max(x, half), Math.max(half, stageWidth - half));
    this.bubble.style.setProperty('--x', `${inside.toFixed(1)}px`);
    this.bubble.style.setProperty('--y', `${y.toFixed(1)}px`);
  }

  /** Closes the speech bubble at once. */
  hush(): void {
    window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = 0;
    this.bubble.classList.remove('show');
  }

  showFps(text: string | null): void {
    this.fps.hidden = text === null;
    if (text !== null) this.fps.textContent = text;
  }
}
