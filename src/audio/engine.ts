/**
 * The game's speaker: one AudioContext, three buses (effects, voices and the
 * club around), and a small pool of playing sounds with a hard limit.
 *
 * Nothing here knows about padel. It plays buffers where it is told, keeps
 * the count of what is sounding, unlocks itself on the first touch and goes
 * quiet when the page is hidden.
 */

export type Bus = 'sfx' | 'voice' | 'ambience';

export interface PlayOptions {
  bus?: Bus;
  /** Linear gain. */
  gain?: number;
  /** -1 left .. 1 right. */
  pan?: number;
  /** Playback rate: 1.03 is a little higher and shorter. */
  rate?: number;
  /** Seconds from now. */
  delay?: number;
  /** Lower ones are dropped first when the pool is full. */
  priority?: number;
}

interface Playing {
  source: AudioBufferSourceNode;
  ends: number;
  priority: number;
}

/** The most sounds at once. Beyond this the least important is cut. */
export const MAX_VOICES = 14;

type AudioContextClass = typeof AudioContext;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private readonly levels: Record<Bus, number> = { sfx: 1, voice: 1, ambience: 1 };
  private readonly playing: Playing[] = [];
  private muted = false;
  private paused = false;

  /** True once a touch has let the page make sound. */
  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /**
   * Creates the context. Must run inside a user gesture on iOS and in most
   * mobile browsers. Safe to call many times.
   */
  unlock(session: 'ambient' | 'playback' = 'ambient'): void {
    const w = globalThis as unknown as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    if (!this.ctx) {
      // On iOS, "ambient" respects the silent switch and mixes with the person's music.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      try {
        if (nav.audioSession) nav.audioSession.type = session;
      } catch {
        // Not supported: nothing to do.
      }
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const master = ctx.createGain();
      // A gentle limiter so that a busy moment never clips.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.15;
      master.connect(limiter).connect(ctx.destination);
      this.master = master;
      for (const bus of ['sfx', 'voice', 'ambience'] as Bus[]) {
        const g = ctx.createGain();
        g.gain.value = this.levels[bus];
        g.connect(master);
        this.buses[bus] = g;
      }
      this.applyMute();
    }
    if (this.ctx.state === 'suspended' && !this.paused) void this.ctx.resume();
    // A silent buffer: the old iOS way of waking the hardware.
    const silent = this.ctx.createBufferSource();
    silent.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    silent.connect(this.ctx.destination);
    silent.start();
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 44100;
  }

  /** Builds an AudioBuffer from rendered channels. */
  buffer(channels: Float32Array[], sr = this.sampleRate): AudioBuffer | null {
    if (!this.ctx || channels.length === 0) return null;
    const b = this.ctx.createBuffer(channels.length, channels[0]!.length, sr);
    channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return b;
  }

  play(buffer: AudioBuffer | null, opts: PlayOptions = {}): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    if (!ctx || !buffer || this.muted || ctx.state !== 'running') return null;
    const now = ctx.currentTime;
    this.prune(now);
    const priority = opts.priority ?? 1;
    if (this.playing.length >= MAX_VOICES) {
      // Cut the least important, oldest first; if all matter more, skip this one.
      let victim = -1;
      for (let i = 0; i < this.playing.length; i++) {
        if (this.playing[i]!.priority <= priority && (victim < 0 || this.playing[i]!.priority < this.playing[victim]!.priority)) victim = i;
      }
      if (victim < 0) return null;
      const [v] = this.playing.splice(victim, 1);
      try {
        v!.source.stop();
      } catch {
        // Already stopped.
      }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const rate = opts.rate ?? 1;
    source.playbackRate.value = rate;
    let node: AudioNode = source;
    const gain = opts.gain ?? 1;
    if (gain !== 1) {
      const g = ctx.createGain();
      g.gain.value = gain;
      node = node.connect(g);
    }
    if (opts.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      node = node.connect(p);
    }
    node.connect(this.buses[opts.bus ?? 'sfx']!);
    const when = now + Math.max(0, opts.delay ?? 0);
    source.start(when);
    this.playing.push({ source, ends: when + buffer.duration / rate, priority });
    return source;
  }

  /** A looping buffer (the club around): returns a stop function that fades it out. */
  loop(buffer: AudioBuffer | null, bus: Bus = 'ambience', gain = 1, fadeIn = 1.5): (() => void) | null {
    const ctx = this.ctx;
    if (!ctx || !buffer) return null;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + fadeIn);
    source.connect(g).connect(this.buses[bus]!);
    source.start();
    return () => {
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.6);
      source.stop(t + 0.65);
    };
  }

  /** How many sounds are playing now. */
  get active(): number {
    if (this.ctx) this.prune(this.ctx.currentTime);
    return this.playing.length;
  }

  setLevel(bus: Bus, level: number): void {
    this.levels[bus] = level;
    const g = this.buses[bus];
    if (g && this.ctx) g.gain.setTargetAtTime(level, this.ctx.currentTime, 0.05);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMute();
  }

  /** Pause and hidden tabs: everything stops where it is and comes back as it was. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx) return;
    if (paused && this.ctx.state === 'running') void this.ctx.suspend();
    if (!paused && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Stops every one-shot sound (a menu opened, a match ended). Loops keep going. */
  hush(): void {
    for (const p of this.playing) {
      try {
        p.source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.playing.length = 0;
  }

  /** A tap on everything that sounds, for a level meter. */
  analyser(): AnalyserNode | null {
    if (!this.ctx || !this.master) return null;
    const a = this.ctx.createAnalyser();
    a.fftSize = 1024;
    this.master.connect(a);
    return a;
  }

  private applyMute(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.03);
  }

  private prune(now: number): void {
    for (let i = this.playing.length - 1; i >= 0; i--) if (this.playing[i]!.ends <= now) this.playing.splice(i, 1);
  }
}
