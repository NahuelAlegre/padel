import type { Match, SimEvent } from '../sim/match';
import { isGoldenPoint, pointLabel } from '../sim/score';
import { TEXT } from './text';

function need<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

/**
 * Scoreboard, messages and hints, as plain DOM over the canvas.
 * Text stays sharp at any resolution scale, and screen readers get the score
 * and the result of every point through the live regions.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly rows: HTMLElement[];
  private readonly tag: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly fps: HTMLElement;
  private bannerTimer = 0;
  private usesTouch = true;

  constructor(stage: HTMLElement, onPause: () => void) {
    this.root = need<HTMLElement>(stage, '#hud');
    this.rows = [need<HTMLElement>(this.root, '.row[data-team="0"]'), need<HTMLElement>(this.root, '.row[data-team="1"]')];
    this.tag = need<HTMLElement>(this.root, '.tag');
    this.banner = need<HTMLElement>(this.root, '#banner');
    this.hint = need<HTMLElement>(this.root, '#hint');
    this.fps = need<HTMLElement>(this.root, '#fps');
    need<HTMLButtonElement>(this.root, '#pause').addEventListener('click', onPause);
    // Hints mention the device actually in use.
    window.addEventListener('pointerdown', (event) => (this.usesTouch = event.pointerType !== 'mouse'), { passive: true });
    window.addEventListener('keydown', () => (this.usesTouch = false), { passive: true });
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
    const golden = isGoldenPoint(score, match.format) && score.winner === null;
    this.tag.hidden = !golden;
    this.tag.textContent = golden ? TEXT.goldenPoint : '';
  }

  /** Reacts to what happened in the match. `humanTeam` is -1 when nobody is playing (demo). */
  onEvent(event: SimEvent, match: Match, humanTeam: number): void {
    switch (event.type) {
      case 'serveReady': {
        this.showScore(match);
        const server = match.players[event.server];
        if (event.attempt > 1) this.say(TEXT.secondServe, '', 1400);
        if (server?.isHuman) this.hint.textContent = this.usesTouch ? TEXT.serveHint : TEXT.serveHintKeys;
        else this.hint.textContent = humanTeam >= 0 ? TEXT.rivalServes : '';
        break;
      }
      case 'toss':
        this.hint.textContent = '';
        break;
      case 'fault':
        this.say(TEXT.fault[event.reason], '', 1500);
        break;
      case 'let':
        this.say(TEXT.letServe, '', 1500);
        break;
      case 'point': {
        this.showScore(match);
        const title =
          humanTeam < 0
            ? match.teamNames[event.winner]
            : event.winner === humanTeam
              ? TEXT.pointYou
              : TEXT.pointRival;
        this.say(title, TEXT.reason[event.reason], 1500);
        break;
      }
      case 'game': {
        this.showScore(match);
        const title =
          humanTeam < 0
            ? match.teamNames[event.winner]
            : event.winner === humanTeam
              ? TEXT.gameYou
              : TEXT.gameRival;
        this.say(title, '', 2200);
        break;
      }
      default:
        break;
    }
  }

  /** Shows a message in the middle of the court for a moment. */
  say(title: string, detail: string, milliseconds: number): void {
    this.banner.textContent = title;
    if (detail) {
      const small = document.createElement('small');
      small.textContent = detail;
      this.banner.append(small);
    }
    this.banner.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), milliseconds);
  }

  clear(): void {
    window.clearTimeout(this.bannerTimer);
    this.banner.classList.remove('show');
    this.banner.textContent = '';
    this.hint.textContent = '';
  }

  showFps(text: string | null): void {
    this.fps.hidden = text === null;
    if (text !== null) this.fps.textContent = text;
  }
}
