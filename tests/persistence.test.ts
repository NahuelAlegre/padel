import { describe, expect, it } from 'vitest';
import { PHYSICS_VERSION } from '../src/config';
import {
  emptyProfile,
  exportData,
  importData,
  loadData,
  newRivalRecord,
  saveMatch,
  saveProfile,
  saveSettings,
  type SavedMatch,
} from '../src/app/persistence';
import { createMemoryStore } from '../src/platform/memory';
import { createScore, awardPoint } from '../src/sim/score';
import { FORMATS } from '../src/config';
import { defaultSettings } from '../src/ui/settings';

/** Saving is fire-and-forget: give the pending writes a turn to land. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function matchInProgress(): SavedMatch {
  const score = createScore(0);
  for (const team of [0, 0, 0, 0, 1, 0] as const) awardPoint(score, team, FORMATS.quick, [1, 1]);
  return { version: PHYSICS_VERSION, format: 'quick', rival: 'romina', snapshot: { score, serveAttempt: 2 } };
}

describe('guardado local', () => {
  it('la primera vez no hay nada: valores por defecto y sin partido a medias', async () => {
    const data = await loadData(createMemoryStore(), false);
    expect(data.settings).toEqual(defaultSettings(false));
    expect(data.profile).toEqual(emptyProfile());
    expect(data.match).toBeNull();
  });

  it('por defecto el movimiento es a mano y el esquema es de dos pulgares', () => {
    const settings = defaultSettings(false);
    expect(settings.assistedMovement).toBe(false);
    expect(settings.scheme).toBe('two');
    expect(settings.rival).toBe('beto');
  });

  it('respeta la preferencia del sistema de reducir movimiento', async () => {
    expect((await loadData(createMemoryStore(), true)).settings.reduceMotion).toBe(true);
    expect((await loadData(createMemoryStore(), false)).settings.reduceMotion).toBe(false);
  });

  it('lo que se guarda vuelve igual', async () => {
    const store = createMemoryStore();
    const settings = { ...defaultSettings(false), scheme: 'one' as const, rival: 'chela' as const, speed: 0.8, assistedMovement: true };
    const profile = { ...emptyProfile(), introDone: true, opens: 3, matchesStarted: 2, matchesWon: 1, firstHitSeconds: 3.4 };
    profile.hits.perfect = 12;
    profile.rivals.chela = { ...newRivalRecord('2026-11-03'), lastPlayed: '2026-11-17', played: 2, wins: 1, losses: 1, streak: -1, goldenWon: 1, longestRally: 14, hintShown: true };
    const match = matchInProgress();

    saveSettings(store, settings);
    saveProfile(store, profile);
    saveMatch(store, match);
    await settle();

    const data = await loadData(store, false);
    expect(data.settings).toEqual(settings);
    expect(data.profile).toEqual(profile);
    expect(data.match).toEqual(match);
    // The score that comes back is the real thing: games, points and who serves.
    expect(data.match!.snapshot.score.games).toEqual([1, 0]);
    expect(data.match!.snapshot.score.points).toEqual([1, 1]);
    expect(data.match!.snapshot.score.servingTeam).toBe(1);
  });

  it('al terminar el partido se borra el que estaba a medias', async () => {
    const store = createMemoryStore();
    saveMatch(store, matchInProgress());
    await settle();
    expect((await loadData(store, false)).match).not.toBeNull();
    saveMatch(store, null);
    await settle();
    expect((await loadData(store, false)).match).toBeNull();
  });

  it('ignora lo que no entiende en vez de romperse', async () => {
    const store = createMemoryStore({
      'padel.settings.v2': '{"scheme":"tres","speed":7,"rival":"nadie","bounceMarker":"sí","camera":"mid"}',
      'padel.profile.v1': 'esto no es JSON',
      'padel.match.v1': '{"version":1,"format":"quick"}',
    });
    const data = await loadData(store, false);
    expect(data.settings).toEqual(defaultSettings(false));
    expect(data.profile).toEqual(emptyProfile());
    expect(data.match).toBeNull();
  });

  it('por defecto la pantalla está limpia y la cámara acompaña', () => {
    const settings = defaultSettings(false);
    expect(settings.aids).toBe('minimal');
    expect(settings.camera).toBe('follow');
    // Whoever has never played gets all of the little help there is.
    expect(emptyProfile().assist).toBe(1);
  });

  it('quien ya jugó la versión anterior queda con las ayudas mínimas y la cámara que acompaña', async () => {
    // What the first published prototype saved: every aid on, and a camera that no longer exists.
    const store = createMemoryStore({
      'padel.settings.v2':
        '{"scheme":"one","stickSide":"right","assistedMovement":false,"rival":"romina","speed":0.8,"bounceMarker":true,' +
        '"timingAid":true,"positionGuide":true,"lines":"few","reduceMotion":false,"vibration":false,"camera":"mid","quality":"auto","fullscreen":false,"showFps":false}',
      'padel.profile.v1': '{"introDone":true,"opens":3,"matchesStarted":2,"hits":{"perfect":4,"good":9,"early":2,"late":1}}',
    });
    const data = await loadData(store, false);
    expect(data.settings.aids).toBe('minimal');
    expect(data.settings.camera).toBe('follow');
    // Everything else they chose is kept.
    expect(data.settings).toMatchObject({ scheme: 'one', stickSide: 'right', rival: 'romina', speed: 0.8, lines: 'few', vibration: false });
    expect(data.profile.introDone).toBe(true);
    expect(data.profile.assist).toBe(1);
  });

  it('las ayudas y la cámara elegidas se guardan, y cuánto queda de las ayudas también', async () => {
    const store = createMemoryStore();
    saveSettings(store, { ...defaultSettings(false), aids: 'full', camera: 'fixed' });
    saveProfile(store, { ...emptyProfile(), assist: 0.4 });
    await settle();
    const data = await loadData(store, false);
    expect(data.settings.aids).toBe('full');
    expect(data.settings.camera).toBe('fixed');
    expect(data.profile.assist).toBeCloseTo(0.4, 9);
    // A value that makes no sense is not trusted.
    saveProfile(store, { ...emptyProfile(), assist: 7 });
    await settle();
    expect((await loadData(store, false)).profile.assist).toBe(1);
  });

  it('descarta un partido guardado con otra versión de la física', async () => {
    const store = createMemoryStore();
    saveMatch(store, { ...matchInProgress(), version: PHYSICS_VERSION + 1 });
    await settle();
    expect((await loadData(store, false)).match).toBeNull();
  });

  it('todo se puede exportar como un texto y llevarse a otro dispositivo', async () => {
    const here = createMemoryStore();
    saveSettings(here, { ...defaultSettings(false), rival: 'chela', scheme: 'one' });
    saveProfile(here, { ...emptyProfile(), introDone: true, matchesWon: 5 });
    saveMatch(here, matchInProgress());
    await settle();

    const text = await exportData(here);
    expect(JSON.parse(text)).toMatchObject({ format: 'padel-save', version: 1 });

    const there = createMemoryStore();
    expect(await importData(there, text)).toBe(true);
    await settle();
    expect(await loadData(there, false)).toEqual(await loadData(here, false));

    // Anything else is refused and changes nothing.
    expect(await importData(there, '{"format":"otra cosa"}')).toBe(false);
    expect(await importData(there, 'basura')).toBe(false);
  });

  it('un almacenamiento que falla no rompe el juego', async () => {
    const broken = {
      get: async () => {
        throw new Error('no storage');
      },
      set: async () => {
        throw new Error('no storage');
      },
      remove: async () => {
        throw new Error('no storage');
      },
    };
    // Writing swallows the failure.
    expect(() => saveSettings(broken, defaultSettings(false))).not.toThrow();
    expect(() => saveMatch(broken, null)).not.toThrow();
    await settle();
  });
});
