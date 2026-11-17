import './style.css';
import { Game } from './app/game';

declare global {
  interface Window {
    /** The running game, exposed for debugging and automated checks. */
    padel?: Game;
  }
}

const stage = document.querySelector<HTMLElement>('#stage');
if (!stage) throw new Error('Missing #stage');

const game = new Game(stage);
window.padel = game;

// Shortcuts for testing:  ?demo  plays AI against AI,  ?fps  shows the frame counter.
const params = new URLSearchParams(location.search);
if (params.has('fps')) game.settings.showFps = true;
if (params.has('demo')) game.start('demo');
