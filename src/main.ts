import './style.css';
import { Game } from './app/game';
import { loadData } from './app/persistence';
import type { Launch } from './platform/types';
import { createWebPlatform } from './platform/web';

declare global {
  interface Window {
    /** The running game, exposed for debugging and automated checks. */
    padel?: Game;
    /** The animation studio, once its script is here (`?estudio`). */
    PadelStudio?: Studio;
  }
}

interface Studio {
  open(game: Game, situation: string | null, launch: Launch): void;
}

/** Where this script came from: in the build, the studio is a file beside it. */
const here = (document.currentScript as HTMLScriptElement | null)?.src ?? '';

/**
 * The animation studio: every situation of the game, to look at without
 * playing. Its code is not part of the game: it comes down only now, as a
 * script of its own (the build is one classic script, so that it opens from
 * a file too, and a classic script cannot be split).
 */
async function loadStudio(): Promise<Studio> {
  if (import.meta.env.DEV) {
    // The development server gives each module on its own.
    const path = './studio/main.ts';
    return (await import(/* @vite-ignore */ path)) as Studio;
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(__STUDIO_FILE__, here || document.baseURI).href;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('The studio did not load'));
    document.head.append(script);
  });
  if (!window.PadelStudio) throw new Error('The studio did not start');
  return window.PadelStudio;
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
  //   ?2d     never use the 3D look: what a device without WebGL2 gets
  //   ?estudio   the animation studio (?estudio=bloqueo opens one situation)
  if (platform.launch.flag('fps')) game.settings.showFps = true;
  game.loopDemo = platform.launch.flag('loop');
  if (platform.launch.flag('estudio')) {
    const situation = platform.launch.value('estudio');
    // Without its file the game is still there: it opens as always.
    loadStudio().then(
      (studio) => studio.open(game, situation, platform.launch),
      () => game.begin(),
    );
  } else if (platform.launch.flag('demo')) game.start('demo');
  else game.begin();
}

void boot();
