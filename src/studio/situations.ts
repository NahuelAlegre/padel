import type { Match, SimEvent } from '../sim/match';
import type { CallKind } from '../sim/pair';
import { snapshot } from './snapshot';

/**
 * The situations of the studio: what can be looked at, and how each one is
 * found in a match the computer plays against itself.
 *
 * Most of them are real: the demo is played without drawing it, and the best
 * example of each one is kept, as a copy of the match a moment before it.
 * What the demo never shows is staged (see `stage.ts`).
 */
export type SituationId =
  | 'baja'
  | 'zancada'
  | 'estirada'
  | 'derecha'
  | 'volea'
  | 'bandeja'
  | 'remate'
  | 'globo'
  | 'saque'
  | 'estocada'
  | 'bloqueo'
  | 'apurado'
  | 'no-llego'
  | 'sorprendido'
  | 'tension'
  | 'robo'
  | 'perdon'
  | 'split'
  | 'festejo'
  | 'manias'
  | 'correr'
  | 'atras'
  | 'lateral'
  | 'mia'
  | 'tuya'
  | 'voy'
  | 'arriba'
  | 'atras-juntos';

export type Group = 'Golpes' | 'IA' | 'Cuerpo' | 'Correr' | 'Señas';

export interface Situation {
  id: SituationId;
  /** Its name in the list: one or two words. */
  label: string;
  group: Group;
  /** Seconds of play shown before its key instant and after it. */
  lead: number;
  tail: number;
  /** Found in the demo, staged, or found if it can be and staged if not. */
  source: 'real' | 'staged' | 'either';
}

export const SITUATIONS: readonly Situation[] = [
  { id: 'baja', label: 'Baja', group: 'Golpes', lead: 1.4, tail: 0.9, source: 'real' },
  { id: 'zancada', label: 'Zancada revés', group: 'Golpes', lead: 1.4, tail: 0.9, source: 'real' },
  { id: 'estirada', label: 'Estirada', group: 'Golpes', lead: 1.4, tail: 0.9, source: 'real' },
  { id: 'derecha', label: 'Derecha', group: 'Golpes', lead: 1.4, tail: 0.9, source: 'real' },
  { id: 'volea', label: 'Volea', group: 'Golpes', lead: 1.2, tail: 0.9, source: 'real' },
  { id: 'bandeja', label: 'Bandeja', group: 'Golpes', lead: 1.5, tail: 1.0, source: 'real' },
  { id: 'remate', label: 'Remate', group: 'Golpes', lead: 1.5, tail: 1.0, source: 'real' },
  { id: 'globo', label: 'Globo', group: 'Golpes', lead: 1.4, tail: 1.0, source: 'real' },
  { id: 'saque', label: 'Saque', group: 'Golpes', lead: 1.8, tail: 0.9, source: 'real' },
  { id: 'estocada', label: 'Estocada', group: 'Golpes', lead: 0, tail: 0, source: 'staged' },
  { id: 'bloqueo', label: 'Bloqueo', group: 'IA', lead: 1.0, tail: 0.9, source: 'real' },
  { id: 'apurado', label: 'Apurado', group: 'IA', lead: 1.4, tail: 0.9, source: 'real' },
  { id: 'no-llego', label: 'No llegó', group: 'IA', lead: 1.3, tail: 1.1, source: 'real' },
  { id: 'sorprendido', label: 'Sorprendido', group: 'IA', lead: 1.1, tail: 0.8, source: 'real' },
  { id: 'tension', label: 'Tensión', group: 'IA', lead: 1.2, tail: 1.2, source: 'real' },
  { id: 'robo', label: 'Robo', group: 'IA', lead: 1.3, tail: 1.0, source: 'either' },
  { id: 'perdon', label: 'Perdón', group: 'IA', lead: 1.3, tail: 1.2, source: 'either' },
  { id: 'split', label: 'Split step', group: 'Cuerpo', lead: 1.0, tail: 0.6, source: 'real' },
  { id: 'festejo', label: 'Festejo', group: 'Cuerpo', lead: 0.9, tail: 1.8, source: 'real' },
  { id: 'manias', label: 'Manías', group: 'Cuerpo', lead: 0, tail: 0, source: 'staged' },
  { id: 'correr', label: 'Adelante', group: 'Correr', lead: 0.8, tail: 0.9, source: 'real' },
  { id: 'atras', label: 'Atrás', group: 'Correr', lead: 0.8, tail: 0.9, source: 'real' },
  { id: 'lateral', label: 'Lateral', group: 'Correr', lead: 0.8, tail: 0.9, source: 'real' },
  { id: 'mia', label: '¡Mía!', group: 'Señas', lead: 1.0, tail: 1.2, source: 'either' },
  { id: 'tuya', label: '¡Tuya!', group: 'Señas', lead: 1.0, tail: 1.2, source: 'either' },
  { id: 'voy', label: '¡Voy!', group: 'Señas', lead: 1.0, tail: 1.2, source: 'either' },
  { id: 'arriba', label: '¡Arriba!', group: 'Señas', lead: 1.0, tail: 1.2, source: 'either' },
  { id: 'atras-juntos', label: '¡Atrás!', group: 'Señas', lead: 1.0, tail: 1.2, source: 'either' },
];

/** Each call of doubles, and the situation that shows it. */
export const SIGN: Readonly<Record<CallKind, SituationId>> = { mine: 'mia', yours: 'tuya', switch: 'voy', up: 'arriba', back: 'atras-juntos' };

/** A call is at its fullest this long after it is said, in seconds: the key instant of its situation. */
export const SIGN_PEAK = 0.3;

export const SITUATION: Readonly<Record<SituationId, Situation>> = Object.fromEntries(
  SITUATIONS.map((situation) => [situation.id, situation]),
) as Record<SituationId, Situation>;

/** A real example of a situation: a copy of the match a moment before it, and the stretch of play to loop. */
export interface Moment {
  id: SituationId;
  near: boolean;
  /** Position in `match.players` of the player it is about. */
  player: number;
  /** Match time of its key instant: the contact, the miss, the end of the point. */
  at: number;
  /** The match when the loop starts, never to be played on itself (play a copy), and when the loop ends. */
  from: Match;
  start: number;
  end: number;
  /** Higher is a better example. */
  score: number;
  /** A few words on it: how high, how far. */
  note: string;
}

/** A match with everybody in place for a serve: the background of what is staged. */
export interface Calm {
  match: Match;
  time: number;
}

/** A copy of the match is kept this often, in seconds of play, and this many of them. */
const SNAP_EVERY = 0.25;
const SNAPS = 14;
/** Nothing from the first seconds of the match: the players are still finding their places. */
const SETTLED = 4;
/** Running (metres per second): toward the net, back from it, across. And for how long, in seconds. */
const RUN = { forward: 2.6, back: 2.0, across: 2.6, lasts: 0.35 };
/** Somebody this slow is standing. */
const STANDING = 0.3;
/** A ball read this much more slowly than usual took the player by surprise. */
const SURPRISED = 1.25;

const metres = (value: number): string => `${value.toFixed(2).replace('.', ',')} m`;

/**
 * Plays a match without drawing it and keeps the best example of each
 * situation, on each side of the net. It works by slices (`run`), so that the
 * page can say how it is going in between.
 */
export class Scan {
  /** The best example of each situation found so far, by `key`. */
  readonly found = new Map<string, Moment>();
  calm: Calm | null = null;
  private readonly match: Match;
  private readonly snaps: Calm[] = [];
  private nextSnap = 0;
  private wantCalm = false;
  /** Per player: how fast it goes, the last time it went fast and how fast, and since when it runs each way. */
  private readonly speed: number[] = [];
  private readonly fastAt: number[] = [];
  private readonly fast: number[] = [];
  private readonly runSince: Array<Record<'correr' | 'atras' | 'lateral', number>> = [];
  /** The strain of each side's most strained player, so far. */
  private readonly strain = [0, 0];
  /** A ball somebody stole from its partner, until it is known how it went. */
  private stolen: { player: number; team: number; at: number } | null = null;

  constructor(
    start: Match,
    /** Seconds of play to look through. */
    private readonly until: number,
  ) {
    this.match = snapshot(start);
    for (let i = 0; i < this.match.players.length; i++) {
      this.speed.push(0);
      this.fastAt.push(-Infinity);
      this.fast.push(0);
      this.runSince.push({ correr: -1, atras: -1, lateral: -1 });
    }
  }

  static key(id: SituationId, near: boolean): string {
    return `${id}:${near ? 'cerca' : 'lejos'}`;
  }

  /** 0..1, how far it has looked. */
  get progress(): number {
    return Math.min(1, this.match.time / this.until);
  }

  get done(): boolean {
    return this.match.time >= this.until || this.match.phase === 'matchOver';
  }

  /** Looks on for about `budget` milliseconds. */
  run(budget: number): void {
    const begin = performance.now();
    while (!this.done && performance.now() - begin < budget) {
      for (let i = 0; i < 60 && !this.done; i++) this.step();
    }
    // A loop that runs past the end of the match would show the result: those are dropped.
    if (this.match.phase === 'matchOver') {
      for (const [key, moment] of this.found) if (moment.end >= this.match.time - 0.5) this.found.delete(key);
    }
  }

  private step(): void {
    const match = this.match;
    if (match.time >= this.nextSnap) {
      const copy = { match: snapshot(match), time: match.time };
      this.snaps.push(copy);
      if (this.snaps.length > SNAPS) this.snaps.shift();
      this.nextSnap = match.time + SNAP_EVERY;
      if (this.wantCalm && match.phase === 'serve') {
        this.calm = copy;
        this.wantCalm = false;
      }
    }
    const before = match.time;
    match.step();
    const dt = match.time - before;
    if (dt <= 0) return;
    const now = match.time;
    for (let i = 0; i < match.players.length; i++) {
      const player = match.players[i]!;
      const vx = (player.x - player.px) / dt;
      const vy = (player.y - player.py) / dt;
      const speed = Math.hypot(vx, vy);
      // Somebody put somewhere else (a new point) did not run there.
      this.speed[i] = speed > 12 ? 0 : speed;
      if (this.speed[i]! > 2.5) {
        // The fastest it went in its last run, while it is still running or has only just stopped.
        const still = now - this.fastAt[i]! < 0.4;
        this.fast[i] = still ? Math.max(this.fast[i]!, this.speed[i]!) : this.speed[i]!;
        this.fastAt[i] = now;
      }
      if (now > SETTLED && match.rally.live && speed <= 12) this.running(i, vx, vy, now);
    }
    for (const event of match.events) this.consider(event, now);
    match.events.length = 0;
    // What somebody shows its partner, from when it starts: the one with the most room before its own stroke, and
    // not two who doubt and point at each other, which is a call of its own kind. Never one made over the swing of
    // its own stroke, which would hide it («¡arriba!» and «¡atrás!» often come right after one): staged instead.
    if (now > SETTLED && match.rally.live) {
      for (let i = 0; i < match.players.length; i++) {
        const player = match.players[i]!;
        if (!player.call || !player.callShown || player.callAt !== now) continue;
        const anim = player.anim;
        if (anim.kind !== 'idle' && now >= anim.t0 && now - anim.t0 < anim.duration) continue;
        const room = player.plan && player.plan.trajId === match.trajectory?.id ? player.plan.t - now : Infinity;
        const doubt = match.pairs[player.team]!.doubted === match.trajectory?.id;
        const note = doubt ? 'dudan' : room < 5 ? `golpea ${room.toFixed(1).replace('.', ',')} s después` : '';
        this.offer(SIGN[player.call], i, now + SIGN_PEAK, Math.min(room, 1.6) - this.speed[i]! * 0.05 - (doubt ? 1 : 0), note);
      }
    }
    if (now > SETTLED && match.rally.live) this.tension(now);
  }

  /** The best example of a situation so far, with a copy of the match `lead` seconds before its key instant. */
  private offer(id: SituationId, player: number, at: number, score: number, note: string, lead?: number, tail?: number): void {
    const near = this.match.players[player]!.team === 0;
    const key = Scan.key(id, near);
    const old = this.found.get(key);
    if (old && old.score >= score) return;
    const situation = SITUATION[id];
    const want = at - (lead ?? situation.lead);
    let from: Calm | null = null;
    for (const snap of this.snaps) if (snap.time <= want + 1e-9) from = snap;
    if (!from) return;
    this.found.set(key, { id, near, player, at, from: from.match, start: from.time, end: at + (tail ?? situation.tail), score, note });
  }

  private consider(event: SimEvent, now: number): void {
    const match = this.match;
    this.followSteal(event, now);
    switch (event.type) {
      case 'serveReady':
        if (!this.calm && now > SETTLED) this.wantCalm = true;
        break;
      case 'whiff':
        if (now > SETTLED) this.offer('no-llego', event.player, now, event.reason === 'far' ? 2 : 1, 'al aire');
        break;
      case 'point':
        if (now > SETTLED) {
          // One of each side, whoever won: they cheer or they sag.
          for (const team of [0, 1]) {
            const index = match.players.findIndex((player) => player.team === team);
            if (index >= 0) this.offer('festejo', index, now, event.winner === team ? 2 : 1, event.winner === team ? 'ganó el punto' : 'perdió el punto');
          }
        }
        break;
      case 'hit': {
        if (now <= SETTLED && event.kind !== 'serve') break;
        const player = match.players[event.player]!;
        const gap = Math.hypot(event.x - player.x, event.y - player.y);
        const high = `a ${metres(event.z)}`;
        const reach = `a ${metres(gap)} del cuerpo`;
        const overhead = event.kind === 'smash' || event.kind === 'bandeja' || event.kind === 'vibora';
        if (event.kind === 'serve') {
          this.offer('saque', event.player, now, -now, '');
          break;
        }
        if (event.z < 0.45) this.offer('baja', event.player, now, -event.z, high);
        if (!event.forehand && gap >= 0.85 && gap <= 1.15 && !overhead) this.offer('zancada', event.player, now, gap, reach);
        if (gap > 1.15 && !overhead) this.offer('estirada', event.player, now, gap, reach);
        if (event.forehand && (event.kind === 'drive' || event.kind === 'wallExit') && event.z > 0.55 && event.z < 1.05 && gap < 0.8) {
          this.offer('derecha', event.player, now, -Math.abs(event.z - 0.8), high);
        }
        if (event.kind === 'volley' && event.why !== 'reflex') this.offer('volea', event.player, now, -Math.abs(event.z - 1.1), high);
        if (event.kind === 'bandeja') this.offer('bandeja', event.player, now, event.z, high);
        if (event.kind === 'smash') this.offer('remate', event.player, now, event.z, high);
        if (event.kind === 'lob') this.offer('globo', event.player, now, -Math.abs(gap - 0.6), high);
        if (event.why === 'reflex') this.offer('bloqueo', event.player, now, -now, high);
        if (event.why === 'forced') {
          const came = now - this.fastAt[event.player]! < 0.4 ? this.fast[event.player]! : 0;
          this.offer('apurado', event.player, now, came, came > 0 ? `venía a ${came.toFixed(1).replace('.', ',')} m/s` : '');
        }
        // On the other side of the net: who read it late, and who was waiting for it.
        for (let i = 0; i < match.players.length; i++) {
          const other = match.players[i]!;
          if (other.team === player.team) continue;
          if (!other.isHuman && other.read >= other.reaction * SURPRISED) {
            this.offer('sorprendido', i, now + other.read, other.read / other.reaction, `lee ${(other.read / other.reaction).toFixed(1).replace('.', ',')} veces más lento`);
          }
          if (this.speed[i]! < STANDING) this.offer('split', i, now, -now, '');
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Doubles: how a ball somebody stole from its partner went, judged as the
   * renderer judges it. One that went in is a «robo»; one that went out, into
   * the net or that the swing did not get to is a «perdón».
   */
  private followSteal(event: SimEvent, now: number): void {
    const match = this.match;
    if (event.type === 'whiff') {
      const player = match.players[event.player]!;
      if (match.pairs[player.team]?.why === 'steal' && match.assigned[player.team] === event.player) {
        this.offer('perdon', event.player, now, now, 'no llegó', SITUATION.perdon.lead);
      }
      return;
    }
    const stolen = this.stolen;
    if (event.type === 'hit') {
      const player = match.players[event.player]!;
      if (stolen && player.team !== stolen.team) {
        this.offer('robo', stolen.player, stolen.at, stolen.at, 'salió bien', undefined, now - stolen.at + 0.9);
      }
      this.stolen = event.kind !== 'serve' && match.pairs[player.team]?.why === 'steal' ? { player: event.player, team: player.team, at: now } : null;
      return;
    }
    if (!stolen || (event.type !== 'bounce' && event.type !== 'point')) return;
    const well = event.type === 'bounce' ? (event.y > 0) === (stolen.team === 0) : event.winner === stolen.team;
    this.stolen = null;
    if (well) this.offer('robo', stolen.player, stolen.at, stolen.at, 'salió bien', undefined, now - stolen.at + 0.9);
    else this.offer('perdon', stolen.player, now, now, 'salió mal', now - stolen.at + 0.9);
  }

  /** Whoever runs one way long enough: toward the net, back from it, or across. */
  private running(index: number, vx: number, vy: number, now: number): void {
    const player = this.match.players[index]!;
    const toNet = player.team === 0 ? vy : -vy;
    const since = this.runSince[index]!;
    const kinds: Array<['correr' | 'atras' | 'lateral', boolean, number]> = [
      ['correr', toNet > RUN.forward && Math.abs(vx) < toNet, toNet],
      ['atras', toNet < -RUN.back && Math.abs(vx) < -toNet, -toNet],
      ['lateral', Math.abs(vx) > RUN.across && Math.abs(vy) < 0.6 * Math.abs(vx), Math.abs(vx)],
    ];
    for (const [kind, going, speed] of kinds) {
      if (!going) {
        since[kind] = -1;
        continue;
      }
      if (since[kind] < 0) since[kind] = now;
      if (now - since[kind] >= RUN.lasts) {
        this.offer(kind, index, since[kind] + 0.2, speed, `${speed.toFixed(1).replace('.', ',')} m/s`);
        since[kind] = Infinity;
      }
    }
  }

  /** The most a long point has got to somebody standing and waiting for the ball. */
  private tension(now: number): void {
    const match = this.match;
    for (let i = 0; i < match.players.length; i++) {
      const player = match.players[i]!;
      const anim = player.anim;
      const swinging = anim.kind !== 'idle' && (now - anim.t0) / Math.max(anim.duration, 1e-6) < 1;
      if (swinging || this.speed[i]! > STANDING || player.strain <= this.strain[player.team]!) continue;
      this.strain[player.team] = player.strain;
      this.offer('tension', i, now, player.strain, `tensión ${player.strain.toFixed(2).replace('.', ',')}`);
    }
  }
}
