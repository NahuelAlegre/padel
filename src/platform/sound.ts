/**
 * The game's sound in a browser.
 *
 *   - Nothing is downloaded: every sound is rendered from its recipe, a piece
 *     at a time in the gaps between frames, starting a moment after the game
 *     has drawn its first frame. Until a sound is ready, it is skipped.
 *   - The audio wakes up with the first touch or key, as browsers require.
 *     On iOS it respects the silent switch and does not stop the person's music.
 *   - Hidden page or pause: the audio is suspended as a whole.
 */
import { allTakes, CHOSEN, courtImpulse, CUES, loudness, nearestLevel, renderTake, SFX_RATE, takeKey, type Take } from '../audio/bank';
import type { Signal } from '../audio/synth/dsp';
import { Rng } from '../core/rng';
import { AudioEngine } from './audio';
import { ClubAmbience } from './club';
import type { Sound, SoundCue, SoundPlace, SoundStatus } from './types';

/** After the first frame, wait this long before rendering anything. */
const START_DELAY_MS = 500;
/** Rendering work per gap between frames, in milliseconds, at most. */
const SLICE_MS = 6;
/**
 * Full volume, for each bus. Set so that the default levels (half the effects,
 * a quarter of the club) sound quiet: the person turns it up if they want.
 */
const EFFECTS_FULL = 0.7;
const AMBIENCE_FULL = 1.4;
/** A far sound: this much quieter and duller, with more of the court's air. */
const FAR_GAIN = 0.55;
const FAR_LOWPASS = 3200;
const NEAR_SEND = 0.12;
const FAR_SEND = 0.3;

export function createWebSound(): Sound {
  const engine = new AudioEngine();
  const data = new Map<string, Signal>();
  const buffers = new Map<string, AudioBuffer>();
  const queue: Take[] = allTakes();
  const club = new ClubAmbience(engine, CHOSEN.ambience);
  const rng = new Rng(4242);
  let enabled = true;
  let paused = false;
  let hidden = false;
  let effects = 0.5;
  let ambience = 0.25;
  let unlocked = false;
  let rendering = false;
  let played = 0;
  let peak = 0;
  let rendered = 0;
  let renderStartedAt = -1;

  // ---- rendering, a little at a time

  const idle: (cb: (deadline?: { timeRemaining(): number }) => void) => void =
    typeof requestIdleCallback === 'function'
      ? (cb) => requestIdleCallback(cb, { timeout: 400 })
      : (cb) => setTimeout(() => cb(), 30);

  const renderSome = (deadline?: { timeRemaining(): number }): void => {
    const until = performance.now() + Math.min(SLICE_MS, deadline ? Math.max(2, deadline.timeRemaining()) : SLICE_MS);
    let more = true;
    while (performance.now() < until && more) {
      const take = queue.shift();
      if (take) {
        data.set(takeKey(take), renderTake(take));
        rendered++;
      } else more = club.prepare();
    }
    if (more || queue.length > 0) idle(renderSome);
    else rendering = false;
    sync();
  };

  let armed = false;
  const startRendering = (): void => {
    if (rendering || !armed || !enabled) return;
    rendering = true;
    if (renderStartedAt < 0) renderStartedAt = performance.now();
    idle(renderSome);
  };
  // The first frame comes first: nothing here may delay it. Two animation
  // frames means one has been drawn; then a moment more for the page to settle.
  const arm = (): void => {
    armed = true;
    startRendering();
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(arm, START_DELAY_MS)));
  } else {
    setTimeout(arm, START_DELAY_MS);
  }

  // ---- waking up

  const unlock = (): void => {
    if (!enabled || (unlocked && engine.ready)) return;
    engine.unlock('ambient');
    if (!engine.ctx || unlocked) return;
    unlocked = true;
    // Waking up and suspending are not immediate: whatever depends on it waits for the change.
    engine.ctx.addEventListener('statechange', sync);
    const [l, r] = courtImpulse(engine.sampleRate);
    engine.setAir(engine.buffer([l, r]), 1);
    applyLevels();
    sync();
  };
  for (const type of ['pointerdown', 'touchend', 'keydown'] as const) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }

  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    sync();
  });
  window.addEventListener('pagehide', () => {
    hidden = true;
    sync();
  });
  window.addEventListener('pageshow', () => {
    hidden = document.hidden;
    sync();
  });

  // ---- state

  function applyLevels(): void {
    engine.setLevel('sfx', effects * EFFECTS_FULL);
    engine.setLevel('ambience', ambience * AMBIENCE_FULL);
    engine.setMuted(!enabled);
  }

  /** Makes what plays match the state: suspended, the club on or off. */
  function sync(): void {
    if (!engine.ctx) return;
    const quiet = !enabled || paused || hidden;
    engine.setSuspended(quiet);
    const wantClub = !quiet && ambience > 0 && engine.ready;
    if (wantClub && !club.playing) club.start(1);
    if (!wantClub && club.playing && (ambience === 0 || !enabled)) club.stop();
  }

  function bufferFor(take: Take): AudioBuffer | null {
    const key = takeKey(take);
    let b = buffers.get(key);
    if (!b) {
      const signal = data.get(key);
      if (!signal) return null;
      b = engine.buffer([signal], SFX_RATE) ?? undefined;
      if (!b) return null;
      buffers.set(key, b);
      // The rendered data is not needed twice.
      data.delete(key);
    }
    return b;
  }

  return {
    play(cue: SoundCue, place: Partial<SoundPlace> = {}): void {
      if (!enabled || paused || hidden || effects <= 0 || !engine.ready) return;
      const intensity = place.intensity ?? 0.5;
      const spec = CUES[cue];
      const take: Take = { cue, level: nearestLevel(cue, intensity), take: Math.floor(rng.next() * spec.takes) };
      const buffer = bufferFor(take);
      if (!buffer) return;
      const depth = Math.min(1, Math.max(0, place.depth ?? 0));
      // Between the near end and the far one, a smooth change.
      const far = depth * depth;
      const source = engine.play(buffer, {
        gain: spec.gain * loudness(intensity) * (1 - (1 - FAR_GAIN) * far),
        pan: place.pan ?? 0,
        lowpass: far > 0.15 ? 20000 - (20000 - FAR_LOWPASS) * far : undefined,
        send: NEAR_SEND + (FAR_SEND - NEAR_SEND) * far,
        // Never twice exactly the same: a hair of pitch either way.
        rate: 1 + (rng.next() - 0.5) * 0.04,
        offset: place.offset ?? 0,
        priority: cue === 'hit' ? 3 : cue === 'bounce' || cue === 'glass' || cue === 'fence' || cue === 'net' || cue === 'netCord' ? 2 : 1,
      });
      if (source) played++;
      peak = Math.max(peak, engine.active);
    },
    setEnabled(on: boolean): void {
      enabled = on;
      if (on) startRendering();
      applyLevels();
      sync();
    },
    setVolumes(fx: number, amb: number): void {
      effects = Math.min(1, Math.max(0, fx));
      ambience = Math.min(1, Math.max(0, amb));
      applyLevels();
      sync();
    },
    setPaused(on: boolean): void {
      paused = on;
      sync();
    },
    hush(): void {
      engine.hush();
    },
    status(): SoundStatus {
      return {
        running: engine.ready,
        played,
        peak,
        rendered,
        pending: queue.length,
        renderStartedAt,
        club: club.playing && engine.ready,
      };
    },
  };
}
