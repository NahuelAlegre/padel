import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { createScene, fillScene, type SceneOptions } from '../../src/app/scene';
import { CAST } from '../../src/characters/cast';
import { createConfig } from '../../src/config';
import { InputState } from '../../src/input/state';
import { figureScale } from '../../src/render/stage/camera';
import { FigureAnimator } from '../../src/render/toon/animator';
import { parseCharacter, styleOf } from '../../src/render/toon/character';
import { Match, type PlayerEntry } from '../../src/sim/match';
import { aiEntry, humanEntry, partnerEntry, SKILLS, withTactics } from '../helpers';

/**
 * Reach report: `npm run sim` (or `npx vitest run --config vitest.sim.config.ts reach`).
 *
 * The golden rule of the real reach: what the body cannot be seen doing, the
 * simulation does not let happen. This plays whole matches with today's
 * generous reach and with the real one, every player drawn as the game draws
 * it (its own body, its size, bigger the further away it is), and measures:
 *
 *   - how far from the middle of the feet the ball was struck, and how low;
 *   - how far the drawn body slid from where the simulation has the player,
 *     to put the racket on the ball (the "magnet"), standing and running;
 *   - how far the racket of the drawn body still was from the ball;
 *   - how much a foot that is on the floor moves over it, around the hits of
 *     a player that stands (the feet must not skate);
 *   - how low the hips get for a low ball, and the knee;
 *   - which balls are played at full stretch.
 *
 * Nothing is asserted: it says what the animation still has to do.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const MATCHES = Number(env?.SIM_MATCHES ?? 4);
/** Below this speed, in metres per second, a player is standing at its hit. */
const STANDING = 0.45;
/** A foot whose toe is this close to the floor, in metres at life size, is on it. */
const DOWN = 0.045;

const file = readFileSync(new URL('../../public/art/character.bin', import.meta.url));
const character = parseCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
const toes = [character.bone('toe.L'), character.bone('toe.R')];
const knees = [character.bone('shin.L'), character.bone('shin.R')];
const hips = character.bone('hips');

interface Numbers {
  gap: number[];
  low: number;
  slide: number[];
  slideStanding: number[];
  slideRunning: number[];
  racket: number[];
  racketStanding: number[];
  /** Per frame, how far a foot on the floor moved over it, around the hits of a player standing still. */
  skate: number[];
  /** For balls below 45 cm: how far the hips dropped from standing, and how high the lower knee was. In metres at life size. */
  drop: number[];
  knee: number[];
  /** Balls beyond the reach of somebody standing (1.15 m), and how many of those were played at full stretch. */
  beyond: number;
  stretched: number;
  hits: number;
}

function measure(real: boolean, doubles: boolean): Numbers {
  const numbers: Numbers = { gap: [], low: 0, slide: [], slideStanding: [], slideRunning: [], racket: [], racketStanding: [], skate: [], drop: [], knee: [], beyond: 0, stretched: 0, hits: 0 };
  for (let m = 0; m < MATCHES; m++) {
    const config = createConfig();
    config.player.realReach = real;
    const seed = 300 + m * 11;
    const near: PlayerEntry[] = doubles
      ? [humanEntry(seed, withTactics(SKILLS.average, 1)), partnerEntry(config, 'beto', seed + 1)]
      : [humanEntry(seed, withTactics(SKILLS.average, 1))];
    const far: PlayerEntry[] = doubles ? [aiEntry(config, 'romina', seed + 2), aiEntry(config, 'chela', seed + 3)] : [aiEntry(config, 'romina', seed + 2)];
    const match = new Match({ config, seed, teams: [{ name: 'A', players: near }, { name: 'B', players: far }] });
    const cast = doubles ? [null, CAST.beto, CAST.romina, CAST.chela] : [null, CAST.romina];
    const names = doubles ? ['jugador', 'beto', 'romina', 'chela'] : ['jugador', 'romina'];
    const options: SceneOptions = {
      aids: 'minimal',
      aidStrength: 1,
      reduceMotion: false,
      debug: false,
      cueLead: 0,
      tutorial: null,
      cast,
      acts: cast.map(() => null),
    };
    const scene = createScene();
    const input = new InputState();
    // Every one with its own body and its own size, as the game draws them.
    const animators = names.map((name) => new FigureAnimator(character, styleOf(character, name)));
    const sizes = animators.map((animator) => animator.style?.size ?? 1);
    const racket: [number, number, number] = [0, 0, 0];
    // Where each toe was on the court in the frame before, when it was on the floor.
    const was = animators.map(() => [null, null] as Array<[number, number] | null>);
    // Where the simulation had each player in the frame before: one put somewhere else (a new point) did not walk there.
    const seen = animators.map(() => [NaN, NaN]);
    for (let frame = 0; frame < 360 * 60 && match.phase !== 'matchOver'; frame++) {
      const hits: Array<{ player: number; x: number; y: number; z: number; kind: string }> = [];
      for (let step = 0; step < 2; step++) {
        match.step();
        for (const event of match.events) if (event.type === 'hit') hits.push(event);
        match.events.length = 0;
      }
      fillScene(scene, match, 1, input, options);
      scene.players.forEach((who, i) => {
        const animator = animators[i]!;
        const k = figureScale(who.y) * sizes[i]!;
        const facing = who.team === 0 ? 1 : -1;
        animator.update(who, k, facing, scene.ball, 1 / 60);
        // The feet around a hit of somebody standing: the window of a stroke, from a third of a second before to after.
        const put = Math.hypot(who.x - seen[i]![0]!, who.y - seen[i]![1]!) > 0.5;
        seen[i]![0] = who.x;
        seen[i]![1] = who.y;
        const around = !put && who.anim !== 'idle' && Math.abs(who.contactIn) < 0.4 && Math.hypot(who.vx, who.vy) < STANDING;
        const pos = animator.skeleton.pos;
        const s = facing > 0 ? -1 : 1;
        for (let f = 0; f < 2; f++) {
          const toe = toes[f]! * 3;
          const down = pos[toe + 2]! < DOWN;
          const at: [number, number] = [animator.x + s * pos[toe]! * k, animator.y + s * pos[toe + 1]! * k];
          const before = was[i]![f];
          if (around && down && before) numbers.skate.push(Math.hypot(at[0] - before[0], at[1] - before[1]));
          was[i]![f] = down ? at : null;
        }
      });
      for (const hit of hits) {
        if (hit.kind === 'serve') continue;
        const who = scene.players[hit.player]!;
        const body = animators[hit.player]!;
        const k = figureScale(who.y) * sizes[hit.player]!;
        const standing = Math.hypot(who.vx, who.vy) < STANDING;
        numbers.hits++;
        const gap = Math.hypot(hit.x - who.x, hit.y - who.y);
        numbers.gap.push(gap);
        if (hit.z < 0.3) numbers.low++;
        const slide = Math.hypot(body.x - who.x, body.y - who.y);
        numbers.slide.push(slide);
        (standing ? numbers.slideStanding : numbers.slideRunning).push(slide);
        body.racketOnCourt(k, who.team === 0 ? 1 : -1, racket);
        const miss = Math.hypot(racket[0] - hit.x, racket[1] - hit.y, racket[2] - hit.z);
        numbers.racket.push(miss);
        if (standing) numbers.racketStanding.push(miss);
        const pos = body.skeleton.pos;
        if (hit.z < 0.45) {
          numbers.drop.push(character.meta.bones.rest[hips]![2] - pos[hips * 3 + 2]!);
          numbers.knee.push(Math.min(pos[knees[0]! * 3 + 2]!, pos[knees[1]! * 3 + 2]!));
        }
        if (gap > 1.15) {
          numbers.beyond++;
          // At full stretch the hips go out after the ball, far from where the feet were.
          if (Math.abs(pos[hips * 3]!) > 0.2) numbers.stretched++;
        }
      }
    }
  }
  return numbers;
}

const at = (xs: number[], q: number): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
};
const cm = (metres: number): string => `${Math.round(metres * 100)} cm`;
const mm = (metres: number): string => `${(metres * 1000).toFixed(1)} mm`;
const spread = (xs: number[]): string => `${cm(at(xs, 0.5))} / ${cm(at(xs, 0.9))} / ${cm(Math.max(0, ...xs))}`;

describe('alcance', () => {
  it('lo que el cuerpo muestra y lo que la simulación deja pegar', () => {
    const out: string[] = ['\nAlcance: dónde se pega y qué hace el cuerpo para llegar (mediana / p90 / máximo)'];
    for (const doubles of [false, true]) {
      for (const real of [false, true]) {
        const n = measure(real, doubles);
        out.push(
          `  ${doubles ? 'dobles' : '1 contra 1'}, alcance ${real ? 'real' : 'actual'}: ${n.hits} golpes, pelota a ${spread(n.gap)} del cuerpo, ${Math.round((n.low / n.hits) * 100)} % por debajo de 30 cm`,
          `    el cuerpo se desliza ${spread(n.slide)}; parado (${n.slideStanding.length}) ${spread(n.slideStanding)}; corriendo (${n.slideRunning.length}) ${spread(n.slideRunning)}`,
          `    la pala queda a ${cm(at(n.racket, 0.5))} / ${cm(at(n.racket, 0.9))} de la pelota; parado, ${cm(at(n.racketStanding, 0.5))} / ${cm(at(n.racketStanding, 0.9))}`,
          `    un pie apoyado se mueve por cuadro ${mm(at(n.skate, 0.5))} / ${mm(at(n.skate, 0.99))} (p99) / ${mm(Math.max(0, ...n.skate))}, alrededor de los golpes parados`,
          `    pelotas por debajo de 45 cm (${n.drop.length}): la cadera baja ${cm(at(n.drop, 0.5))} / ${cm(at(n.drop, 0.9))} / ${cm(Math.max(0, ...n.drop))}, la rodilla más baja a ${cm(at(n.knee, 0.1))} (p10) / ${cm(Math.min(9, ...n.knee))} del piso`,
          `    más lejos que 1,15 m: ${n.beyond}, a fondo ${n.stretched}`,
        );
      }
    }
    console.log(out.join('\n'));
  });
});
