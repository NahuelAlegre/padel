/**
 * The listening board: every sound of the game in two or three versions, to
 * hear on the phone and choose. It uses the game's own recipes and engine, so
 * what is chosen here is exactly what the game will play. The first round of
 * choices (2026-11-18) took the first version of everything and dropped the
 * voices, which are no longer on the board.
 *
 * Built into one HTML file by `npm run sound-board`. The choices are kept in
 * the artifact's database when it runs as a claude.ai artifact, and in the
 * browser otherwise.
 */
import { Rng } from '../../src/core/rng';
import { AudioEngine } from '../../src/platform/audio';
import { ClubAmbience } from '../../src/platform/club';
import { place, type Distance } from '../../src/audio/space';
import {
  bounce,
  FEET_STYLES,
  feet,
  fence,
  FENCE_STYLES,
  glass,
  GLASS_STYLES,
  net,
  NET_STYLES,
  RACKET_STYLES,
  racketHit,
  swing,
  TURF_STYLES,
  type FeetStyleId,
  type FenceStyleId,
  type GlassStyleId,
  type NetStyleId,
  type RacketStyleId,
  type StepKind,
  type TurfStyleId,
} from '../../src/audio/synth/impacts';
import type { AmbienceStyleId } from '../../src/audio/synth/ambience';
import type { Signal } from '../../src/audio/synth/dsp';

// ================================================================ sound

const engine = new AudioEngine();
const cache = new Map<string, AudioBuffer>();
const takes = new Map<string, number>();
/** Different takes of a sound, so tapping twice does not sound like a machine. */
const TAKES = 4;

function nextTake(key: string): number {
  const t = ((takes.get(key) ?? -1) + 1) % TAKES;
  takes.set(key, t);
  return t;
}

function buffer(key: string, render: () => Signal, distance: Distance): AudioBuffer | null {
  const full = `${key}|${distance}`;
  let b = cache.get(full);
  if (!b) {
    const [l, r] = place(engine.sampleRate, render(), distance);
    b = engine.buffer([l, r]) ?? undefined;
    if (b) cache.set(full, b);
  }
  return b ?? null;
}

interface Cue {
  at: number;
  key: string;
  render: (sr: number, rng: Rng) => Signal;
  distance?: Distance;
  gain?: number;
  pan?: number;
}

/** Plays cues on the audio clock, so a sequence keeps its rhythm. */
function perform(cues: Cue[]): number {
  if (!engine.ready) return 0;
  let end = 0;
  for (const cue of cues) {
    const take = nextTake(cue.key);
    const b = buffer(`${cue.key}#${take}`, () => cue.render(engine.sampleRate, new Rng(1 + take * 101 + hash(cue.key))), cue.distance ?? 'near');
    engine.play(b, { delay: cue.at, gain: cue.gain ?? 1, pan: cue.pan ?? 0, rate: 1 + (take - 1.5) * 0.008 });
    if (b) end = Math.max(end, cue.at + b.duration);
  }
  return end;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Levels of each family, so that the board plays them in the balance of a match.
const LEVEL = { hit: 1, bounce: 0.75, glass: 0.95, fence: 0.85, net: 0.8, feet: 0.55 };

const hitCue = (style: RacketStyleId, power: number, at = 0, distance: Distance = 'near', pan = 0): Cue => ({
  at,
  key: `hit-${style}-${power}`,
  render: (sr, rng) => racketHit(sr, rng, power, RACKET_STYLES[style]),
  distance,
  pan,
  gain: LEVEL.hit,
});
const swingCue = (at: number, pan = 0): Cue => ({ at, key: 'swing', render: (sr, rng) => swing(sr, rng, 1), pan, gain: 0.8 });
const bounceCue = (style: TurfStyleId, speed: number, at = 0, distance: Distance = 'near', pan = 0): Cue => ({
  at,
  key: `bounce-${style}-${speed}`,
  render: (sr, rng) => bounce(sr, rng, speed, TURF_STYLES[style]),
  distance,
  pan,
  gain: LEVEL.bounce,
});
const glassCue = (style: GlassStyleId, at = 0, distance: Distance = 'near', pan = 0, speed = 0.75): Cue => ({
  at,
  key: `glass-${style}-${speed}`,
  render: (sr, rng) => glass(sr, rng, speed, GLASS_STYLES[style]),
  distance,
  pan,
  gain: LEVEL.glass,
});
const fenceCue = (style: FenceStyleId, at = 0, distance: Distance = 'near', pan = 0, speed = 0.8): Cue => ({
  at,
  key: `fence-${style}-${speed}`,
  render: (sr, rng) => fence(sr, rng, speed, FENCE_STYLES[style]),
  distance,
  pan,
  gain: LEVEL.fence,
});
const netCue = (style: NetStyleId, cord: boolean, at = 0, distance: Distance = 'near'): Cue => ({
  at,
  key: `net-${style}-${cord}`,
  render: (sr, rng) => net(sr, rng, 0.7, cord, NET_STYLES[style]),
  distance,
  gain: LEVEL.net,
});
const feetCue = (style: FeetStyleId, kind: StepKind, at = 0, distance: Distance = 'near', pan = 0): Cue => ({
  at,
  key: `feet-${style}-${kind}`,
  render: (sr, rng) => feet(sr, rng, kind, FEET_STYLES[style]),
  distance,
  pan,
  gain: LEVEL.feet,
});

// ================================================================ what can be chosen

interface Action {
  label: string;
  play: () => number;
}

interface Variant {
  id: string;
  name: string;
  desc: string;
  actions: Action[];
}

interface Group {
  id: string;
  title: string;
  lead: string;
  variants: Variant[];
  /** A section heading before this group. */
  section?: string;
}

const picks: Record<string, { choice: string | null; note: string }> = {};

function chosen<T extends string>(group: string, fallback: T): T {
  return (picks[group]?.choice as T | null) ?? fallback;
}

const hitStyle = () => chosen<RacketStyleId>('golpe', 'carbon');
const turfStyle = () => chosen<TurfStyleId>('pique', 'firm');
const glassStyle = () => chosen<GlassStyleId>('vidrio', 'dry');
const fenceStyle = () => chosen<FenceStyleId>('reja', 'tight');
const feetStyle = () => chosen<FeetStyleId>('pies', 'sand');

function serve(kind: string): number {
  const hit = hitStyle();
  const turf = turfStyle();
  const steps = feetStyle();
  switch (kind) {
    case 'ritual':
      return perform([
        bounceCue(turf, 0.3, 0),
        bounceCue(turf, 0.3, 0.62),
        bounceCue(turf, 0.32, 1.85),
        hitCue(hit, 0.42, 2.4),
      ]);
    case 'step':
      return perform([bounceCue(turf, 0.32, 0), feetCue(steps, 'step', 0.35), hitCue(hit, 0.45, 0.6)]);
    default:
      return perform([bounceCue(turf, 0.32, 0), hitCue(hit, 0.42, 0.55)]);
  }
}

let ambience: ClubAmbience | null = null;
let ambienceStyle: AmbienceStyleId | null = null;

function toggleAmbience(style: AmbienceStyleId): number {
  if (ambience && ambienceStyle === style) {
    stopAmbience();
    return 0;
  }
  stopAmbience();
  const club = new ClubAmbience(engine, style);
  ambience = club;
  ambienceStyle = style;
  // The bed takes a moment to render on a phone: say so first, then render.
  setStatus('Preparando el ambiente…');
  renderAmbienceState();
  // The bed, then the birds and the next court, a piece at a time; it starts as soon as the bed is ready.
  const more = () => {
    if (ambience !== club) return;
    const going = club.prepare();
    if (club.ready && !club.playing) {
      club.start(0.9);
      setStatus(store.kind === 'shared' ? 'Tus elecciones se guardan solas' : 'Se guardan en este navegador');
    }
    if (going) setTimeout(more, 0);
  };
  setTimeout(more, 60);
  return 0;
}

function stopAmbience(): void {
  ambience?.stop();
  ambience = null;
  ambienceStyle = null;
  renderAmbienceState();
}

const GROUPS: Group[] = [
  {
    id: 'golpe',
    section: 'La pelota',
    title: 'Golpe de pala',
    lead: 'El «pop» de la pelota es la firma del pádel. Probá los tres toques en cada uno.',
    variants: (
      [
        ['carbon', 'Carbono', 'Pop firme con algo de cuerpo, como una pala de carbono con núcleo de goma.'],
        ['foam', 'Goma blanda', 'Más redondo y corto: un «puc» más que un «pop». Pala de núcleo blando.'],
        ['hollow', 'Hueco', 'Pop brillante y hueco: la pelota se escucha más, como un toc sobre madera.'],
      ] as [RacketStyleId, string, string][]
    ).map(([id, name, desc]) => ({
      id,
      name,
      desc,
      actions: [
        { label: 'Suave (chiquita, globo)', play: () => perform([hitCue(id, 0.15)]) },
        { label: 'Normal', play: () => perform([hitCue(id, 0.5)]) },
        { label: 'Remate', play: () => perform([swingCue(0), hitCue(id, 1, 0.2)]) },
      ],
    })),
  },
  {
    id: 'pique',
    title: 'Pique en el césped',
    lead: 'Césped sintético con arena: tiene que sonar sordo, nunca a pelota de tenis sobre cemento.',
    variants: (
      [
        ['firm', 'Firme', 'Un «poc» claro y apagado, con poca arena.'],
        ['sandy', 'Con arena', 'Más blando, con el grano de la arena.'],
        ['dry', 'Seco', 'Se escucha más la pelota que el piso: un toc corto.'],
      ] as [TurfStyleId, string, string][]
    ).map(([id, name, desc]) => ({
      id,
      name,
      desc,
      actions: [
        { label: 'Pique suave', play: () => perform([bounceCue(id, 0.3)]) },
        { label: 'Pique fuerte', play: () => perform([bounceCue(id, 0.9)]) },
        { label: 'Pique y golpe', play: () => perform([bounceCue(id, 0.55), hitCue(hitStyle(), 0.55, 0.32)]) },
      ],
    })),
  },
  {
    id: 'vidrio',
    section: 'Las paredes',
    title: 'Vidrio',
    lead: 'Un golpe seco y grave. Tiene que distinguirse de la reja sin mirar.',
    variants: (
      [
        ['dry', 'Seco', 'Un «bom» corto y grave.'],
        ['full', 'Con cuerpo', 'El panel resuena un poco más y queda flotando.'],
        ['framed', 'Con marco', 'Se suma un filo metálico, apenas: el panel se mueve en su marco.'],
      ] as [GlassStyleId, string, string][]
    ).map(([id, name, desc]) => ({
      id,
      name,
      desc,
      actions: [
        { label: 'Contra el vidrio', play: () => perform([glassCue(id)]) },
        { label: 'Pique y vidrio', play: () => perform([bounceCue(turfStyle(), 0.7), glassCue(id, 0.38)]) },
        { label: 'Vidrio, después reja', play: () => perform([glassCue(id), fenceCue(fenceStyle(), 0.9)]) },
      ],
    })),
  },
  {
    id: 'reja',
    title: 'Reja metálica',
    lead: 'Vibración y traqueteo de la malla. La diferencia con el vidrio es muy de pádel.',
    variants: (
      [
        ['tight', 'Tensa', 'Un chasquido metálico brillante y un traqueteo corto.'],
        ['loose', 'Floja', 'El «trrrr» del panel suelto dura más.'],
        ['post', 'Cerca del poste', 'Más golpe de caño y menos vibración de la malla.'],
      ] as [FenceStyleId, string, string][]
    ).map(([id, name, desc]) => ({
      id,
      name,
      desc,
      actions: [
        { label: 'Contra la reja', play: () => perform([fenceCue(id)]) },
        { label: 'Reja, después vidrio', play: () => perform([fenceCue(id), glassCue(glassStyle(), 1.1)]) },
      ],
    })),
  },
  {
    id: 'red',
    title: 'Red',
    lead: 'La pelota que queda en la red y la que toca la cinta y pasa.',
    variants: (
      [
        ['soft', 'Suave', 'La red frena la pelota con un golpe sordo y un roce.'],
        ['rope', 'Con cable', 'Más roce de la malla y el cable de acero que vibra.'],
      ] as [NetStyleId, string, string][]
    ).map(([id, name, desc]) => ({
      id,
      name,
      desc,
      actions: [
        { label: 'A la red', play: () => perform([netCue(id, false)]) },
        { label: 'Toca la cinta', play: () => perform([netCue(id, true)]) },
      ],
    })),
  },
  {
    id: 'pies',
    section: 'La jugadora y el jugador',
    title: 'Pasos y zapatillas',
    lead: 'En una cancha con arena casi no hay chirrido: lo que suena es la arena. Elegí qué tan fiel lo querés.',
    variants: (
      [
        ['sand', 'Arena', 'Pisadas con crujido de arena y frenadas que raspan. Lo más fiel a una cancha de pádel.'],
        ['rubber', 'Goma', 'Chirridos de zapatilla en los frenos, como en una cancha rápida.'],
        ['mixed', 'Mezcla', 'Arena, y de vez en cuando un chirrido en una frenada fuerte.'],
      ] as [FeetStyleId, string, string][]
    ).map(([id, name, desc]) => ({
      id,
      name,
      desc,
      actions: [
        { label: 'Paso', play: () => perform([feetCue(id, 'step')]) },
        { label: 'Split step', play: () => perform([feetCue(id, 'split')]) },
        { label: 'Frenada', play: () => perform([feetCue(id, 'slide')]) },
        { label: 'Cambio de dirección', play: () => perform([feetCue(id, 'squeak')]) },
        {
          label: 'Corrida',
          play: () =>
            perform([
              feetCue(id, 'step', 0),
              feetCue(id, 'step', 0.22),
              feetCue(id, 'step', 0.43),
              feetCue(id, 'step', 0.63),
              feetCue(id, 'slide', 0.82),
            ]),
        },
      ],
    })),
  },
  {
    id: 'saque',
    title: 'Saque',
    lead: 'Saque por abajo: primero el bote obligatorio y después el golpe. Usa el golpe y el pique que elegiste arriba.',
    variants: [
      { id: 'one', name: 'Directo', desc: 'Un bote y saca.', actions: [{ label: 'Escuchar', play: () => serve('one') }] },
      {
        id: 'ritual',
        name: 'Ritual',
        desc: 'Dos botes, una pausa y saca, como hace casi todo el mundo.',
        actions: [{ label: 'Escuchar', play: () => serve('ritual') }],
      },
      { id: 'step', name: 'Con paso', desc: 'Bote, un paso adelante y saca.', actions: [{ label: 'Escuchar', play: () => serve('step') }] },
    ],
  },
  {
    id: 'ambiente',
    section: 'El club',
    title: 'Ambiente al atardecer',
    lead: 'Viento en los árboles, pájaros de acá y la cancha de al lado. Va bajo y en loop; los pájaros caen al azar, así que nunca se repite igual.',
    variants: (
      [
        ['club', 'Club de barrio', 'Zorzales y gorriones, un vaso en el buffet y un peloteo en la cancha de al lado.'],
        ['quiet', 'Tarde tranquila', 'Más viento y pájaros (zorzal, torcaza, benteveo); nadie en la cancha de al lado.'],
        ['busy', 'Club lleno', 'Dos canchas jugando, más vasos en el buffet y menos pájaros.'],
      ] as [AmbienceStyleId, string, string][]
    ).map(([id, name, desc]) => ({
      id,
      name,
      desc,
      actions: [{ label: 'Escuchar', play: () => toggleAmbience(id) }],
    })),
  },
];

// ================================================================ a rally to hear it all together

function rally(): number {
  const hit = hitStyle();
  const turf = turfStyle();
  const steps = feetStyle();
  const L = -0.25;
  const R = 0.3;
  return perform([
    // The serve: the bounce, the hit.
    bounceCue(turf, 0.32, 0, 'near', L),
    hitCue(hit, 0.42, 0.55, 'near', L),
    bounceCue(turf, 0.55, 1.3, 'far', R),
    feetCue(steps, 'step', 1.45, 'far', R),
    hitCue(hit, 0.6, 1.8, 'far', R),
    // Deep: let it come off the glass.
    bounceCue(turf, 0.65, 2.45, 'near', 0),
    feetCue(steps, 'split', 2.5, 'near', 0),
    glassCue(glassStyle(), 2.85, 'near', 0.1, 0.55),
    feetCue(steps, 'squeak', 3.0, 'near', 0.1),
    hitCue(hit, 0.5, 3.3, 'near', 0.1),
    bounceCue(turf, 0.55, 4.0, 'far', -0.2),
    feetCue(steps, 'slide', 4.05, 'far', -0.2),
    // The rival lobs, under pressure.
    hitCue(hit, 0.18, 4.4, 'far', -0.2),
    // Short: smash it.
    feetCue(steps, 'step', 5.0, 'near', 0.2),
    swingCue(5.42, 0.2),
    hitCue(hit, 1, 5.62, 'near', 0.2),
    bounceCue(turf, 1, 6.0, 'far', 0.35),
    fenceCue(fenceStyle(), 6.3, 'far', 0.5, 0.9),
  ]);
}

// ================================================================ keeping the choices

interface Store {
  save(group: string, value: { choice: string | null; note: string }): Promise<void>;
  kind: 'shared' | 'local';
}

const LOCAL_KEY = 'sonidos-del-rebote';

function localStore(): Store {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as typeof picks;
    Object.assign(picks, saved);
  } catch {
    // No storage: the choices last as long as the page.
  }
  return {
    kind: 'local',
    async save() {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(picks));
      } catch {
        // Nothing to do.
      }
    },
  };
}

interface DbDoc {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface Db {
  collection(path: string): {
    doc(id: string): { set(data: Record<string, unknown>): Promise<void> };
    onSnapshot(next: (snap: { docs: DbDoc[] }) => void, error?: (e: { code: string }) => void): () => void;
  };
}

let store: Store = localStore();

async function connect(): Promise<void> {
  const claude = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (!claude) return;
  let db: Db | null = null;
  try {
    db = (await claude.use('db')) as Db | null;
  } catch {
    db = null;
  }
  if (!db) return;
  const picksRef = db.collection('picks');
  const pending = new Map<string, Promise<void>>();
  store = {
    kind: 'shared',
    async save(group, value) {
      // One write at a time per group.
      const before = pending.get(group) ?? Promise.resolve();
      const write = before
        .catch(() => undefined)
        .then(() => picksRef.doc(group).set({ ...value, at: new Date().toISOString() }));
      pending.set(group, write);
      try {
        await write;
        setStatus('Guardado');
      } catch {
        setStatus('No se pudo guardar. Copiá tu elección abajo.');
      }
    },
  };
  setStatus('Tus elecciones se guardan solas');
  picksRef.onSnapshot(
    (snap) => {
      for (const doc of snap.docs) {
        const d = doc.data();
        if (!d) continue;
        picks[doc.id] = { choice: typeof d.choice === 'string' ? d.choice : null, note: typeof d.note === 'string' ? d.note : '' };
      }
      renderPicks();
    },
    () => {
      store = localStore();
      setStatus('Se guardan en este navegador');
    },
  );
}

// ================================================================ the page

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function setStatus(text: string): void {
  const s = document.getElementById('status');
  if (s) s.textContent = text;
}

/** The first touch wakes the audio; every button goes through here. */
function withSound(fn: () => number, button?: HTMLElement): void {
  engine.unlock('playback');
  const run = () => {
    const seconds = fn();
    if (button && seconds > 0) {
      button.classList.add('is-playing');
      setTimeout(() => button.classList.remove('is-playing'), Math.min(8000, seconds * 1000));
    }
  };
  if (engine.ready) run();
  else if (engine.ctx) void engine.ctx.resume().then(run);
}

function build(): void {
  const list = $('#groups');
  for (const group of GROUPS) {
    if (group.section) list.append(el('h2', 'section', group.section));
    const section = el('section', 'group');
    section.id = group.id;
    const head = el('header', 'group-head');
    head.append(el('h3', '', group.title), el('p', 'lead', group.lead));
    section.append(head);
    const cards = el('div', 'cards');
    group.variants.forEach((variant, i) => {
      const card = el('article', 'card');
      card.dataset.group = group.id;
      card.dataset.variant = variant.id;
      const top = el('div', 'card-top');
      const letter = el('span', 'letter', 'ABC'[i]!);
      letter.setAttribute('aria-hidden', 'true');
      const title = el('div', 'card-title');
      title.append(el('h4', '', variant.name), el('p', 'desc', variant.desc));
      const pick = el('button', 'pick');
      pick.type = 'button';
      pick.id = `pick-${group.id}-${variant.id}`;
      pick.setAttribute('aria-pressed', 'false');
      pick.innerHTML = '<span class="star" aria-hidden="true">★</span><span class="pick-label">Elegir</span>';
      pick.addEventListener('click', () => choose(group.id, variant.id));
      top.append(letter, title, pick);
      const actions = el('div', 'actions');
      variant.actions.forEach((action, k) => {
        const b = el('button', 'play');
        b.type = 'button';
        b.id = `play-${group.id}-${variant.id}-${k}`;
        b.innerHTML = `<span class="tri" aria-hidden="true"></span><span>${action.label}</span>`;
        if (group.id === 'ambiente') b.dataset.ambience = variant.id;
        b.addEventListener('click', () => withSound(action.play, b));
        actions.append(b);
      });
      card.append(top, actions);
      cards.append(card);
    });
    section.append(cards);
    const noteWrap = el('div', 'note');
    const label = el('label', '', 'Comentario (opcional)');
    const note = el('textarea');
    note.id = `note-${group.id}`;
    label.htmlFor = note.id;
    note.rows = 2;
    note.placeholder = 'Por ejemplo: «la B, pero más grave»';
    note.addEventListener('change', () => {
      picks[group.id] = { choice: picks[group.id]?.choice ?? null, note: note.value.trim() };
      void store.save(group.id, picks[group.id]!);
      renderSummary();
    });
    noteWrap.append(label, note);
    section.append(noteWrap);
    list.append(section);
  }

  $('#rally').addEventListener('click', (e) => withSound(rally, e.currentTarget as HTMLElement));
  $('#ambience').addEventListener('click', () =>
    withSound(() => {
      if (ambience) stopAmbience();
      else toggleAmbience(chosen<AmbienceStyleId>('ambiente', 'club'));
      return 0;
    }),
  );
  $('#copy').addEventListener('click', copySummary);

  renderPicks();
  scope();
}

function choose(group: string, variant: string): void {
  const current = picks[group]?.choice ?? null;
  const choice = current === variant ? null : variant;
  picks[group] = { choice, note: picks[group]?.note ?? '' };
  renderPicks();
  void store.save(group, picks[group]!);
}

function renderPicks(): void {
  for (const card of document.querySelectorAll<HTMLElement>('.card')) {
    const on = picks[card.dataset.group!]?.choice === card.dataset.variant;
    card.classList.toggle('is-chosen', on);
    const pick = card.querySelector('.pick')!;
    pick.setAttribute('aria-pressed', String(on));
    pick.querySelector('.pick-label')!.textContent = on ? 'Elegido' : 'Elegir';
  }
  for (const group of GROUPS) {
    const note = document.getElementById(`note-${group.id}`) as HTMLTextAreaElement | null;
    if (note && document.activeElement !== note) note.value = picks[group.id]?.note ?? '';
  }
  renderSummary();
}

function summaryLines(): string[] {
  return GROUPS.map((g) => {
    const p = picks[g.id];
    const v = g.variants.find((x) => x.id === p?.choice);
    const letter = v ? 'ABC'[g.variants.indexOf(v)] : '';
    const choice = v ? `${letter} · ${v.name}` : 'sin elegir';
    return `${g.title}: ${choice}${p?.note ? ` («${p.note}»)` : ''}`;
  });
}

function renderSummary(): void {
  const ul = $('#summary');
  ul.replaceChildren(
    ...summaryLines().map((line) => {
      const li = el('li');
      const [name, rest] = [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)];
      li.append(el('span', 'sum-name', name), el('span', rest.includes('sin elegir') ? 'sum-none' : 'sum-pick', rest.trim()));
      return li;
    }),
  );
  const done = GROUPS.filter((g) => picks[g.id]?.choice).length;
  $('#progress').textContent = `${done} de ${GROUPS.length}`;
}

function copySummary(): void {
  const text = `Sonidos elegidos:\n${summaryLines().join('\n')}`;
  const done = () => setStatus('Copiado');
  navigator.clipboard?.writeText(text).then(done, () => {
    const area = $<HTMLTextAreaElement>('#copy-fallback');
    area.hidden = false;
    area.value = text;
    area.select();
  });
}

function renderAmbienceState(): void {
  const b = document.getElementById('ambience');
  if (b) {
    b.classList.toggle('is-on', !!ambience);
    b.querySelector('.amb-label')!.textContent = ambience ? 'Parar ambiente' : 'Ambiente';
  }
  for (const btn of document.querySelectorAll<HTMLElement>('[data-ambience]')) {
    const on = btn.dataset.ambience === ambienceStyle;
    btn.classList.toggle('is-on', on);
    btn.querySelector('span:last-child')!.textContent = on ? 'Parar' : 'Escuchar';
  }
}

/** A small oscilloscope in the bar: proof that something is sounding, even on mute. */
function scope(): void {
  const canvas = $<HTMLCanvasElement>('#scope');
  const g = canvas.getContext('2d');
  if (!g) return;
  let analyser: AnalyserNode | null = null;
  let data: Float32Array<ArrayBuffer> | null = null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = () => {
    requestAnimationFrame(draw);
    if (!analyser && engine.ctx) {
      analyser = engine.analyser();
      if (analyser) data = new Float32Array(analyser.fftSize);
    }
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    g.clearRect(0, 0, w, h);
    const style = getComputedStyle(document.documentElement);
    g.strokeStyle = style.getPropertyValue('--accent').trim() || '#f0c14a';
    g.lineWidth = 1.5 * devicePixelRatio;
    g.beginPath();
    if (analyser && data && !reduce) {
      analyser.getFloatTimeDomainData(data);
      for (let i = 0; i < data.length; i += 4) {
        const x = (i / data.length) * w;
        const y = h / 2 - data[i]! * h * 1.6;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    } else {
      g.moveTo(0, h / 2);
      g.lineTo(w, h / 2);
    }
    g.stroke();
  };
  draw();
}

document.addEventListener('visibilitychange', () => engine.setSuspended(document.hidden));
build();
void connect();
