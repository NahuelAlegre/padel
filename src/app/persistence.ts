import { PHYSICS_VERSION, type FormatName, type RivalId } from '../config';
import type { KeyValueStore } from '../platform/types';
import type { MatchSnapshot } from '../sim/match';
import type { Quality } from '../sim/types';
import { readSettings, RIVALS, type Settings } from '../ui/settings';

/**
 * What the game keeps between visits. There are no accounts, so all of it
 * lives on the device: a few small JSON documents behind the platform's
 * storage. `exportData` puts them in one text, so progress can be taken to
 * another device the day there is a button for it.
 */

const KEYS = {
  settings: 'padel.settings.v2',
  profile: 'padel.profile.v1',
  match: 'padel.match.v1',
} as const;

/** What the person has done so far. Counts only: nothing that identifies anybody. */
export interface Profile {
  /** The first-time help is over: from now on the game opens on the start screen. */
  introDone: boolean;
  opens: number;
  /** Seconds from opening the game to the first hit ever. The number to keep low. */
  firstHitSeconds: number | null;
  matchesStarted: number;
  matchesFinished: number;
  matchesWon: number;
  rematches: number;
  pointsWon: number;
  pointsLost: number;
  hits: Record<Quality, number>;
  byRival: Record<RivalId, { played: number; won: number }>;
}

/** A match in progress, saved at the start of every point. */
export interface SavedMatch {
  /** Physics version it was being played with. */
  version: number;
  format: FormatName;
  rival: RivalId;
  snapshot: MatchSnapshot;
}

export function emptyProfile(): Profile {
  return {
    introDone: false,
    opens: 0,
    firstHitSeconds: null,
    matchesStarted: 0,
    matchesFinished: 0,
    matchesWon: 0,
    rematches: 0,
    pointsWon: 0,
    pointsLost: 0,
    hits: { perfect: 0, good: 0, early: 0, late: 0 },
    byRival: { lola: { played: 0, won: 0 }, tincho: { played: 0, won: 0 }, mora: { played: 0, won: 0 } },
  };
}

function parse(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const count = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

function readProfile(saved: unknown): Profile {
  const base = emptyProfile();
  if (typeof saved !== 'object' || saved === null) return base;
  const data = saved as Partial<Record<keyof Profile, unknown>>;
  const hits = (data.hits ?? {}) as Partial<Record<Quality, unknown>>;
  const byRival = (data.byRival ?? {}) as Partial<Record<RivalId, { played?: unknown; won?: unknown }>>;
  for (const rival of RIVALS) {
    base.byRival[rival] = { played: count(byRival[rival]?.played), won: count(byRival[rival]?.won) };
  }
  return {
    ...base,
    introDone: data.introDone === true,
    opens: count(data.opens),
    firstHitSeconds: typeof data.firstHitSeconds === 'number' ? data.firstHitSeconds : null,
    matchesStarted: count(data.matchesStarted),
    matchesFinished: count(data.matchesFinished),
    matchesWon: count(data.matchesWon),
    rematches: count(data.rematches),
    pointsWon: count(data.pointsWon),
    pointsLost: count(data.pointsLost),
    hits: {
      perfect: count(hits.perfect),
      good: count(hits.good),
      early: count(hits.early),
      late: count(hits.late),
    },
  };
}

function readMatch(saved: unknown): SavedMatch | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const data = saved as Partial<SavedMatch>;
  // A match saved with other physics or with a shape we do not know is dropped, not guessed at.
  if (data.version !== PHYSICS_VERSION) return null;
  if (data.format !== 'quick' && data.format !== 'match') return null;
  if (!data.rival || !RIVALS.includes(data.rival)) return null;
  const score = data.snapshot?.score;
  if (!score || !Array.isArray(score.points) || !Array.isArray(score.games) || score.winner !== null) return null;
  return data as SavedMatch;
}

export interface SavedData {
  settings: Settings;
  profile: Profile;
  match: SavedMatch | null;
}

export async function loadData(store: KeyValueStore, reduceMotion: boolean): Promise<SavedData> {
  const [settings, profile, match] = await Promise.all([
    store.get(KEYS.settings),
    store.get(KEYS.profile),
    store.get(KEYS.match),
  ]);
  return {
    settings: readSettings(parse(settings), reduceMotion),
    profile: readProfile(parse(profile)),
    match: readMatch(parse(match)),
  };
}

// Saving never blocks the game and never throws into it.
const quietly = (work: Promise<void>): void => void work.catch(() => {});

export function saveSettings(store: KeyValueStore, settings: Settings): void {
  quietly(store.set(KEYS.settings, JSON.stringify(settings)));
}

export function saveProfile(store: KeyValueStore, profile: Profile): void {
  quietly(store.set(KEYS.profile, JSON.stringify(profile)));
}

export function saveMatch(store: KeyValueStore, match: SavedMatch | null): void {
  quietly(match ? store.set(KEYS.match, JSON.stringify(match)) : store.remove(KEYS.match));
}

/** Everything that is saved, as one piece of text that can be kept or moved to another device. */
export async function exportData(store: KeyValueStore): Promise<string> {
  const data = await loadData(store, false);
  return JSON.stringify({ format: 'padel-save', version: 1, ...data });
}

/** Restores what `exportData` produced. Returns false when the text is not a save of this game. */
export async function importData(store: KeyValueStore, text: string): Promise<boolean> {
  const data = parse(text) as { format?: unknown; settings?: unknown; profile?: unknown; match?: unknown } | null;
  if (!data || data.format !== 'padel-save') return false;
  saveSettings(store, readSettings(data.settings, false));
  saveProfile(store, readProfile(data.profile));
  saveMatch(store, readMatch(data.match));
  return true;
}
