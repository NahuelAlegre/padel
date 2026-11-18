/**
 * The voices of the people on court: how each one sounds, and what comes out
 * of them when something happens. Nothing here is information: everything a
 * voice says is also on screen (the bubble, the score), so the game plays the
 * same in silence.
 */
import type { CharacterId } from '../characters/types';
import type { SayOptions, VoiceProfile } from './synth/voice';

export const VOICES: Record<CharacterId, VoiceProfile> = {
  // 55, the club's coach for twenty-five years: a warm, low, unhurried voice that creaks a little at the end.
  beto: {
    f0: 112,
    size: 1,
    oq: 0.58,
    tilt: 1400,
    breath: 0.12,
    jitter: 0.009,
    shimmer: 0.05,
    tremor: { rate: 4.5, depth: 0.08 },
    creak: 0.55,
    rate: 0.95,
    range: 1,
  },
  // 35, played handball, laughs loud: a strong, bright, pressed voice that goes high when she shouts.
  romina: {
    f0: 200,
    size: 1.13,
    oq: 0.5,
    tilt: 2400,
    breath: 0.06,
    jitter: 0.007,
    shimmer: 0.04,
    tremor: { rate: 0, depth: 0 },
    creak: 0.15,
    rate: 1.12,
    range: 1.1,
  },
  // 68, drove a bus for thirty years: soft and breathy, a little tremble, and a voice that sings.
  chela: {
    f0: 182,
    size: 1.1,
    oq: 0.66,
    tilt: 1100,
    breath: 0.22,
    jitter: 0.016,
    shimmer: 0.07,
    tremor: { rate: 5.6, depth: 0.35 },
    creak: 0.2,
    rate: 0.88,
    range: 1.35,
  },
};

/** When a voice is heard. */
export type Reaction = 'win' | 'lose' | 'effort' | 'hello' | 'laugh';

/**
 * Three ways of giving them a voice, to choose by ear:
 *   words   short real exclamations ("¡Eso!", "¡Tomá!", "¡Ay!")
 *   murmur  the line of the bubble, said fast and blurred, like a cartoon character
 *   sounds  no words at all: hums, laughs, sighs, effort
 */
export type VoiceStyle = 'words' | 'murmur' | 'sounds';

export interface Utterance {
  text: string;
  opts: SayOptions;
}

type Lines = Record<Reaction, Utterance[]>;

const u = (text: string, opts: SayOptions): Utterance => ({ text, opts });

const BETO: Record<VoiceStyle, Lines> = {
  words: {
    win: [u('¡Otra!', { tune: 'calm', effort: 0.3, release: 'creak' }), u('¡Dale!', { tune: 'exclaim', effort: 0.35 })],
    lose: [
      u('¡Eso!', { tune: 'exclaim', effort: 0.6, onset: 'hard' }),
      u('¡Fa!', { tune: 'exclaim', effort: 0.55, hold: 1.8 }),
      u('¡Bien ahí!', { tune: 'exclaim', effort: 0.55 }),
    ],
    effort: [u('/h u*', { tune: 'grunt', effort: 0.5, release: 'cut', onset: 'breathy' })],
    hello: [u('¡Hola!', { tune: 'exclaim', effort: 0.4 })],
    laugh: [u('je je je', { tune: 'laugh', effort: 0.3, rate: 1.2 })],
  },
  murmur: {
    win: [u('Tranqui, se aprende.', { tune: 'chatter', murmur: true, effort: 0.3 })],
    lose: [u('¡Eso! ¡Así se pega!', { tune: 'chatter', murmur: true, effort: 0.55 })],
    effort: [u('/h u*', { tune: 'grunt', effort: 0.5, release: 'cut', onset: 'breathy' })],
    hello: [u('¡Hola! Soy Beto, el profe.', { tune: 'chatter', murmur: true, effort: 0.4 })],
    laugh: [u('je je je', { tune: 'laugh', effort: 0.3, rate: 1.2 })],
  },
  sounds: {
    win: [u('/m:* _ h m:', { tune: 'calm', effort: 0.25, release: 'creak' })],
    lose: [u('/u:*', { tune: 'exclaim', effort: 0.55, hold: 1.4 })],
    effort: [u('/h u*', { tune: 'grunt', effort: 0.5, release: 'cut', onset: 'breathy' })],
    hello: [u('/e:*', { tune: 'rise', effort: 0.4 })],
    laugh: [u('je je je', { tune: 'laugh', effort: 0.3, rate: 1.2 })],
  },
};

const ROMINA: Record<VoiceStyle, Lines> = {
  words: {
    win: [u('¡Tomá!', { tune: 'shout', effort: 0.9, onset: 'hard' }), u('¡Vamos!', { tune: 'shout', effort: 0.95 })],
    lose: [u('¡No!', { tune: 'sad', effort: 0.6, hold: 1.6 }), u('¡Uf!', { tune: 'grunt', effort: 0.4 })],
    effort: [u('/h a*', { tune: 'grunt', effort: 1, release: 'cut', onset: 'breathy' })],
    hello: [u('¡Hola!', { tune: 'exclaim', effort: 0.6 })],
    laugh: [u('ja ja ja', { tune: 'laugh', effort: 0.7, rate: 1.1 })],
  },
  murmur: {
    win: [u('¿La viste pasar?', { tune: 'chatter', murmur: true, effort: 0.8 })],
    lose: [u('Bueno, bueno, bueno…', { tune: 'chatter', murmur: true, effort: 0.5 })],
    effort: [u('/h a*', { tune: 'grunt', effort: 1, release: 'cut', onset: 'breathy' })],
    hello: [u('Romina. Pego fuerte, eh.', { tune: 'chatter', murmur: true, effort: 0.6 })],
    laugh: [u('ja ja ja', { tune: 'laugh', effort: 0.7, rate: 1.1 })],
  },
  sounds: {
    win: [u('/e:*', { tune: 'shout', effort: 0.95, hold: 1.2, onset: 'hard' })],
    lose: [u('/a:*', { tune: 'sad', effort: 0.5 })],
    effort: [u('/h a*', { tune: 'grunt', effort: 1, release: 'cut', onset: 'breathy' })],
    hello: [u('/e* j', { tune: 'exclaim', effort: 0.6 })],
    laugh: [u('ja ja ja', { tune: 'laugh', effort: 0.7, rate: 1.1 })],
  },
};

const CHELA: Record<VoiceStyle, Lines> = {
  words: {
    win: [u('ji ji ji', { tune: 'laugh', effort: 0.25, rate: 1.3 }), u('¡Arriba!', { tune: 'sing', effort: 0.4 })],
    lose: [u('¡Ay!', { tune: 'sad', effort: 0.35, hold: 1.4 }), u('¡Uy, uy!', { tune: 'exclaim', effort: 0.4 })],
    effort: [u('¡Upa!', { tune: 'exclaim', effort: 0.45 })],
    hello: [u('¡Hola, tesoro!', { tune: 'sing', effort: 0.35 })],
    laugh: [u('ji ji ji', { tune: 'laugh', effort: 0.25, rate: 1.3 })],
  },
  murmur: {
    win: [u('Arriba, corazón.', { tune: 'chatter', murmur: true, effort: 0.35 })],
    lose: [u('Ay, si tuviera sesenta…', { tune: 'chatter', murmur: true, effort: 0.35 })],
    effort: [u('¡Upa!', { tune: 'exclaim', effort: 0.45 })],
    hello: [u('Hola, tesoro. Soy Chela.', { tune: 'chatter', murmur: true, effort: 0.35 })],
    laugh: [u('ji ji ji', { tune: 'laugh', effort: 0.25, rate: 1.3 })],
  },
  sounds: {
    win: [u('ji ji ji', { tune: 'laugh', effort: 0.25, rate: 1.3 })],
    lose: [u('/a* j', { tune: 'sad', effort: 0.35, hold: 1.4 })],
    effort: [u('/h m*', { tune: 'grunt', effort: 0.35, onset: 'breathy' })],
    hello: [u('/u: i*:', { tune: 'sing', effort: 0.4 })],
    laugh: [u('ji ji ji', { tune: 'laugh', effort: 0.25, rate: 1.3 })],
  },
};

export const UTTERANCES: Record<CharacterId, Record<VoiceStyle, Lines>> = { beto: BETO, romina: ROMINA, chela: CHELA };
