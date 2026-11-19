import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { createScene, fillScene, type SceneOptions } from '../../src/app/scene';
import { CAST } from '../../src/characters/cast';
import { createConfig } from '../../src/config';
import { InputState } from '../../src/input/state';
import { figureScale } from '../../src/render/stage/camera';
import { FigureAnimator } from '../../src/render/toon/animator';
import { parseCharacter } from '../../src/render/toon/character';
import { Match, type PlayerEntry } from '../../src/sim/match';
import { aiEntry, humanEntry, partnerEntry, SKILLS, withTactics } from '../helpers';

/**
 * Reach report: `npm run sim` (or `npx vitest run --config vitest.sim.config.ts reach`).
 *
 * The golden rule of the real reach: what the body cannot be seen doing, the
 * simulation does not let happen. This plays whole matches with today's
 * generous reach and with the real one and measures, at every hit:
 *
 *   - how far from the middle of the feet the ball was struck, and how low;
 *   - how far the drawn body slid from where the simulation has the player,
 *     to put the racket on the ball (the "magnet");
 *   - how far the racket of the drawn body still was from the ball.
 *
 * Nothing is asserted: it says what the animation has left to do.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const MATCHES = Number(env?.SIM_MATCHES ?? 4);

const file = readFileSync(new URL('../../public/art/character.bin', import.meta.url));
const character = parseCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);

interface Numbers {
  gap: number[];
  low: number;
  slide: number[];
  racket: number[];
  hits: number;
}

function measure(real: boolean, doubles: boolean): Numbers {
  const numbers: Numbers = { gap: [], low: 0, slide: [], racket: [], hits: 0 };
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
    const animators = match.players.map(() => new FigureAnimator(character));
    const racket: [number, number, number] = [0, 0, 0];
    for (let frame = 0; frame < 360 * 60 && match.phase !== 'matchOver'; frame++) {
      const hits: Array<{ player: number; x: number; y: number; z: number; kind: string }> = [];
      for (let step = 0; step < 2; step++) {
        match.step();
        for (const event of match.events) if (event.type === 'hit') hits.push(event);
        match.events.length = 0;
      }
      fillScene(scene, match, 1, input, options);
      scene.players.forEach((who, i) => animators[i]!.update(who, figureScale(who.y), who.team === 0 ? 1 : -1, scene.ball, 1 / 60));
      for (const hit of hits) {
        if (hit.kind === 'serve') continue;
        const who = scene.players[hit.player]!;
        const body = animators[hit.player]!;
        numbers.hits++;
        numbers.gap.push(Math.hypot(hit.x - who.x, hit.y - who.y));
        if (hit.z < 0.3) numbers.low++;
        numbers.slide.push(Math.hypot(body.x - who.x, body.y - who.y));
        body.racketOnCourt(figureScale(who.y), who.team === 0 ? 1 : -1, racket);
        numbers.racket.push(Math.hypot(racket[0] - hit.x, racket[1] - hit.y, racket[2] - hit.z));
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

describe('alcance', () => {
  it('lo que el cuerpo muestra y lo que la simulación deja pegar', () => {
    const out: string[] = ['\nAlcance: dónde se pega, cuánto se desliza el cuerpo y dónde queda la pala (mediana / p90 / máximo)'];
    for (const doubles of [false, true]) {
      for (const real of [false, true]) {
        const n = measure(real, doubles);
        out.push(
          `  ${doubles ? 'dobles' : '1 contra 1'}, alcance ${real ? 'real  ' : 'actual'}  ${n.hits} golpes` +
            `   pelota a ${cm(at(n.gap, 0.5))} / ${cm(at(n.gap, 0.9))} / ${cm(Math.max(...n.gap))} del cuerpo, ${Math.round((n.low / n.hits) * 100)} % por debajo de 30 cm` +
            `   el cuerpo se desliza ${cm(at(n.slide, 0.5))} / ${cm(at(n.slide, 0.9))} / ${cm(Math.max(...n.slide))}` +
            `   la pala queda a ${cm(at(n.racket, 0.5))} / ${cm(at(n.racket, 0.9))} de la pelota`,
        );
      }
    }
    console.log(out.join('\n'));
  });
});
