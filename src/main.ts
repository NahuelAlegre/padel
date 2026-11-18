import './style.css';
import { Game } from './app/game';
import { loadData } from './app/persistence';
import { createWebPlatform } from './platform/web';

declare global {
  interface Window {
    /** The running game, exposed for debugging and automated checks. */
    padel?: Game;
  }
}

/**
 * Entry point of the web build. Everything that is specific to running in a
 * browser is in `createWebPlatform`; a native shell would start the same
 * `Game` with another platform.
 */
async function boot(): Promise<void> {
  const stage = document.querySelector<HTMLElement>('#stage');
  if (!stage) throw new Error('Missing #stage');

  const platform = createWebPlatform();
  const data = await loadData(platform.storage, platform.display.prefersReducedMotion());
  const game = new Game(stage, platform, data);
  window.padel = game;

  // Developer switches. On the web they come from the query string:
  //   ?demo   the computer plays itself     ?loop   the demo starts over when it ends
  //   ?fps    frame counter and timing errors     ?record   keep the inputs for a replay
  if (platform.launch.flag('fps')) game.settings.showFps = true;
  game.loopDemo = platform.launch.flag('loop');
  if (platform.launch.flag('demo')) game.start('demo');
  else game.begin();
}

void boot();
