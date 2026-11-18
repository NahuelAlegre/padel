import { describe, expect, it } from 'vitest';
import { allTakes, CHOSEN, CUES, loudness, nearestLevel, renderTake, SFX_RATE } from '../src/audio/bank';
import { catalogue } from '../src/audio/catalogue';
import { hitIntensity, SoundDirector } from '../src/audio/director';
import { AMBIENCE_STYLES, bed } from '../src/audio/synth/ambience';
import { filter, peak, rms, type Signal } from '../src/audio/synth/dsp';
import { racketHit, RACKET_STYLES } from '../src/audio/synth/impacts';
import { Rng } from '../src/core/rng';
import { AudioEngine, MAX_VOICES } from '../src/platform/audio';
import { AMBIENCE_RATE, ClubAmbience, clubEvent, EVENT_LEVEL, type ClubEvent } from '../src/platform/club';
import { silentSound } from '../src/platform/memory';
import { AMBIENCE_FULL, EFFECTS_FULL } from '../src/platform/sound';
import type { Sound, SoundCue, SoundPlace } from '../src/platform/types';
import { Match, type SimEvent } from '../src/sim/match';
import { defaultSettings, readSettings } from '../src/ui/settings';
import { aiEntry, testConfig } from './helpers';

/** Where the energy of a sound is, in Hz: a rough measure of how bright it is. */
function centroid(x: Signal, sr: number): number {
  // A plain DFT over a few hundred bins is enough for a short sound.
  const n = Math.min(x.length, 4096);
  let num = 0;
  let den = 0;
  for (let k = 1; k < n / 2; k += 4) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * k * i) / n;
      re += x[i]! * Math.cos(a);
      im -= x[i]! * Math.sin(a);
    }
    const mag = Math.hypot(re, im);
    num += mag * ((k * sr) / n);
    den += mag;
  }
  return num / den;
}

describe('los sonidos', () => {
  it('todos se generan sin errores: finitos, audibles y sin saturar', () => {
    for (const item of catalogue(22050)) {
      const out = item.render();
      const channels = Array.isArray(out) ? out : [out];
      for (const c of channels) {
        expect(c.every(Number.isFinite), item.name).toBe(true);
        expect(peak(c), item.name).toBeGreaterThan(0.005);
        expect(peak(c), item.name).toBeLessThanOrEqual(1.05);
        expect(c.length / item.sr, item.name).toBeLessThan(20);
      }
    }
  });

  it('no queda ninguna voz: ni los rivales ni el ambiente hablan', () => {
    const names = catalogue(22050).map((item) => item.name);
    expect(names.some((name) => /voice|voz|laugh|risa|murmur/.test(name))).toBe(false);
  });

  it('cada toma del juego queda normalizada y corta', () => {
    for (const take of allTakes()) {
      const x = renderTake(take);
      expect(peak(x)).toBeCloseTo(0.9, 2);
      // A footstep or a bounce is a fraction of a second; the fence rattles for about one.
      expect(x.length / SFX_RATE).toBeLessThan(take.cue === 'fence' ? 1.6 : 0.8);
    }
  });

  it('un golpe más fuerte suena más brillante, no solo más fuerte', () => {
    const soft = racketHit(SFX_RATE, new Rng(1), 0.15, RACKET_STYLES.carbon);
    const hard = racketHit(SFX_RATE, new Rng(1), 1, RACKET_STYLES.carbon);
    expect(centroid(hard, SFX_RATE)).toBeGreaterThan(centroid(soft, SFX_RATE));
    expect(peak(hard)).toBeGreaterThan(peak(soft));
  });

  it('la mezcla es pareja: entre lo más suave y lo más fuerte hay unos 5 dB', () => {
    const range = 20 * Math.log10(loudness(1) / loudness(0));
    expect(range).toBeGreaterThan(3);
    expect(range).toBeLessThan(6.5);
  });

  it('cada intensidad toma la toma más cercana', () => {
    expect(CUES.hit.levels[nearestLevel('hit', 0)]).toBe(0.15);
    expect(CUES.hit.levels[nearestLevel('hit', 0.95)]).toBe(1);
    expect(CUES.bounce.levels[nearestLevel('bounce', 0.55)]).toBe(0.6);
  });

  it('el ambiente da la vuelta sin que se note el corte', () => {
    const sr = 11025;
    const [left] = bed(sr, 7, 6, AMBIENCE_STYLES.club);
    // The jump across the seam is no bigger than the usual jump between neighbouring samples.
    let steps = 0;
    for (let i = 1; i < left.length; i++) steps += Math.abs(left[i]! - left[i - 1]!);
    const usual = steps / (left.length - 1);
    const seam = Math.abs(left[0]! - left[left.length - 1]!);
    expect(seam).toBeLessThan(usual * 4);
    // And it does not get louder or quieter around it.
    const head = rms(left, 0, sr);
    const tail = rms(left, left.length - sr, left.length);
    expect(Math.abs(20 * Math.log10(head / tail))).toBeLessThan(4);
  });
});

describe('qué suena en un partido', () => {
  it('la chiquita y el globo son toques; el remate siempre es un golpe', () => {
    expect(hitIntensity('drop', 25)).toBeLessThanOrEqual(0.2);
    expect(hitIntensity('lob', 25)).toBeLessThanOrEqual(0.2);
    expect(hitIntensity('smash', 10)).toBeGreaterThanOrEqual(0.85);
    expect(hitIntensity('serve', 30)).toBeLessThanOrEqual(0.4);
    expect(hitIntensity('drive', 20)).toBeGreaterThan(hitIntensity('drive', 12));
  });

  function recorder(): Sound & { calls: Array<{ cue: SoundCue; place: Partial<SoundPlace> }> } {
    const calls: Array<{ cue: SoundCue; place: Partial<SoundPlace> }> = [];
    return { ...silentSound, calls, play: (cue, place = {}) => calls.push({ cue, place }) };
  }

  function newMatch(seed: number): Match {
    const config = testConfig();
    return new Match({
      config,
      seed,
      teams: [
        { name: 'A', players: [aiEntry(config, 'medium', seed + 1)] },
        { name: 'B', players: [aiEntry(config, 'medium', seed + 2)] },
      ],
    });
  }

  function play(match: Match, director: SoundDirector | null, seconds: number): SimEvent[] {
    const all: SimEvent[] = [];
    while (match.phase !== 'matchOver' && match.time < seconds) {
      match.step();
      for (const event of match.events) {
        all.push({ ...event });
        director?.onEvent(event, match);
      }
      match.events.length = 0;
      director?.update(match);
    }
    return all;
  }

  it('cada golpe, pique, pared y red de la simulación suena', () => {
    const sound = recorder();
    const events = play(newMatch(3), new SoundDirector(sound), 90);
    const count = (cue: SoundCue) => sound.calls.filter((c) => c.cue === cue).length;
    expect(count('hit')).toBe(events.filter((e) => e.type === 'hit').length);
    expect(count('glass') + count('fence')).toBe(events.filter((e) => e.type === 'wall' && e.speed >= 1.5).length);
    expect(count('net') + count('netCord')).toBe(events.filter((e) => e.type === 'net').length);
    expect(count('bounce')).toBeGreaterThan(0);
    // The pre-serve bounce is a bounce like any other: the serve is heard as bounce and hit.
    expect(count('step')).toBeGreaterThan(10);
    expect(count('split')).toBeGreaterThan(0);
    for (const call of sound.calls) {
      expect(call.place.pan).toBeGreaterThanOrEqual(-1);
      expect(call.place.pan).toBeLessThanOrEqual(1);
      expect(call.place.depth).toBeGreaterThanOrEqual(0);
      expect(call.place.depth).toBeLessThanOrEqual(1);
    }
  });

  it('lo de tu lado suena cerca y lo del rival, lejos', () => {
    const sound = recorder();
    const match = newMatch(5);
    const director = new SoundDirector(sound);
    const hits: Array<{ team: number; depth: number }> = [];
    while (match.time < 60) {
      match.step();
      for (const event of match.events) {
        const before = sound.calls.length;
        director.onEvent(event, match);
        if (event.type === 'hit') hits.push({ team: event.team, depth: sound.calls[before]!.place.depth! });
      }
      match.events.length = 0;
    }
    const mine = hits.filter((h) => h.team === 0);
    const theirs = hits.filter((h) => h.team === 1);
    expect(mine.length).toBeGreaterThan(3);
    expect(Math.max(...mine.map((h) => h.depth))).toBeLessThan(0.5);
    expect(Math.min(...theirs.map((h) => h.depth))).toBeGreaterThan(0.5);
  });

  it('escuchar no cambia el partido: con o sin sonido, el mismo partido', () => {
    const quiet = play(newMatch(9), null, 120);
    const heard = play(newMatch(9), new SoundDirector(recorder()), 120);
    expect(heard.length).toBe(quiet.length);
    expect(JSON.stringify(heard)).toBe(JSON.stringify(quiet));
  });
});

describe('el motor de audio', () => {
  /** A stand-in for the browser's AudioContext: enough to count what plays. */
  function fakeAudio(): { started: number; stopped: number } {
    const counts = { started: 0, stopped: 0 };
    const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
    const node = () => ({ connect: (next: unknown) => next, gain: param(), pan: param(), frequency: param(), Q: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() });
    class FakeContext {
      state = 'running';
      currentTime = 0;
      sampleRate = 44100;
      destination = node();
      createGain = node;
      createStereoPanner = node;
      createBiquadFilter = node;
      createDynamicsCompressor = node;
      createConvolver = node;
      createAnalyser = node;
      createBuffer(channels: number, length: number, rate: number) {
        return { duration: length / rate, numberOfChannels: channels, copyToChannel() {} };
      }
      createBufferSource() {
        return {
          ...node(),
          playbackRate: param(),
          buffer: null,
          start: () => counts.started++,
          stop: () => counts.stopped++,
        };
      }
      resume() {
        return Promise.resolve();
      }
      suspend() {
        return Promise.resolve();
      }
    }
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
    return counts;
  }

  it('nunca suenan más de MAX_VOICES a la vez: los menos importantes se cortan', () => {
    const counts = fakeAudio();
    const engine = new AudioEngine();
    engine.unlock();
    const buffer = engine.buffer([new Float32Array(44100)]);
    for (let i = 0; i < 40; i++) engine.play(buffer, { priority: i % 3 });
    expect(engine.active).toBeLessThanOrEqual(MAX_VOICES);
    expect(counts.stopped).toBeGreaterThan(0);
    // A sound less important than everything playing is not started at all.
    const before = counts.started;
    for (let i = 0; i < MAX_VOICES; i++) engine.play(buffer, { priority: 5 });
    engine.play(buffer, { priority: 0 });
    expect(counts.started).toBe(before + MAX_VOICES);
  });

  it('en silencio no suena nada', () => {
    fakeAudio();
    const engine = new AudioEngine();
    engine.unlock();
    engine.setMuted(true);
    expect(engine.play(engine.buffer([new Float32Array(100)]))).toBeNull();
  });
});

describe('el club', () => {
  /**
   * How loud something sounds on a phone, in dB: what a small speaker plays
   * (nothing under ~450 Hz), the loudest 100 ms. A held whistle and a hit that
   * is over in a few milliseconds can be compared this way; their peaks cannot.
   */
  function onPhone(x: Signal, sr: number, gain: number): number {
    const y = x.map((v) => v * gain);
    filter(sr, y, 'highpass', 450, 0.707);
    filter(sr, y, 'highpass', 450, 0.707);
    const win = Math.round(sr * 0.1);
    let loudest = 0;
    for (let i = 0; i + win <= y.length; i += Math.round(win / 4)) loudest = Math.max(loudest, rms(y, i, i + win));
    return 20 * Math.log10(loudest + 1e-12);
  }

  const settings = defaultSettings(false);
  const kinds: ClubEvent[] = ['thrush', 'kiskadee', 'sparrows', 'dove', 'rally', 'clink'];
  /** The softest of the hardest hits, close, at the default volume. */
  const hardHit = Math.min(
    ...[0, 1, 2].map((take) => {
      const top = CUES.hit.levels.length - 1;
      return onPhone(renderTake({ cue: 'hit', level: top, take }), SFX_RATE, settings.effects * EFFECTS_FULL * CUES.hit.gain * loudness(1));
    }),
  );
  /** The loudest each kind of event gets, at an ambience volume. */
  const loudestEvent = (kind: ClubEvent, ambience: number): number =>
    Math.max(...[0, 1].map((take) => onPhone(clubEvent(kind, 1000 + take * 17)[0], AMBIENCE_RATE, ambience * AMBIENCE_FULL * EVENT_LEVEL[kind] * 1.1)));

  it('queda de fondo: los pájaros, el vaso y la otra cancha, muy por debajo de un golpe', () => {
    for (const kind of kinds) expect(loudestEvent(kind, settings.ambience), kind).toBeLessThan(hardHit - 10);
    const [bedLeft] = bed(AMBIENCE_RATE, 7, 4, AMBIENCE_STYLES[CHOSEN.ambience]);
    expect(onPhone(bedLeft, AMBIENCE_RATE, settings.ambience * AMBIENCE_FULL)).toBeLessThan(hardHit - 10);
  });

  it('y con el ambiente al 100 %, todavía por debajo de los golpes', () => {
    for (const kind of kinds) expect(loudestEvent(kind, 1), kind).toBeLessThan(hardHit);
  });

  it('los pájaros cantan de vez en cuando, no todo el tiempo', () => {
    expect(AMBIENCE_STYLES[CHOSEN.ambience].birds).toBeLessThanOrEqual(3);
  });

  it('se prepara de a pasos chicos, y nunca en el momento de un toque', () => {
    let loops = 0;
    const engine = { ready: true, buffer: () => ({}), loop: () => (loops++, () => {}), play: () => null } as unknown as AudioEngine;
    const club = new ClubAmbience(engine, CHOSEN.ambience);
    // Asked to start before its bed is ready, it waits: nothing is rendered there and then.
    club.start();
    expect(club.playing).toBe(false);
    expect(club.ready).toBe(false);
    let steps = 0;
    while (!club.ready) {
      club.prepare();
      steps++;
    }
    // The bed alone is many small steps, not one long one.
    expect(steps).toBeGreaterThan(15);
    club.start();
    expect(club.playing).toBe(true);
    expect(loops).toBe(1);
    club.stop();
    while (club.prepare()) steps++;
    expect(steps).toBeGreaterThan(100);
  });
});

describe('las opciones de sonido', () => {
  it('por defecto: con sonido, bajo, y el ambiente más bajo todavía', () => {
    const s = defaultSettings(false);
    expect(s.sound).toBe(true);
    expect(s.effects).toBe(0.5);
    expect(s.ambience).toBeLessThan(s.effects);
  });

  it('lo guardado que no vale se ignora', () => {
    const s = readSettings({ sound: 'sí', effects: 3, ambience: 0.75 }, false);
    expect(s.sound).toBe(true);
    expect(s.effects).toBe(0.5);
    expect(s.ambience).toBe(0.75);
  });
});
