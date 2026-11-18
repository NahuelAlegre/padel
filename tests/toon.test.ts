import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  blendPose,
  boneToCharacter,
  createSkeleton,
  parseCharacter,
  samplePose,
  skinMatrices,
  solveSkeleton,
  type Character,
} from '../src/render/toon/character';

/** The character that ships with the game. */
function loadCharacter(): Character {
  const file = readFileSync(new URL('../public/art/character.bin', import.meta.url));
  return parseCharacter(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
}

const character = loadCharacter();
const racket = character.bone('racket');

/** Middle of the racket head at a moment of a clip, in the character's own axes. */
function racketAt(clip: string, time: number): [number, number, number] {
  const pose = samplePose(character, character.clips[clip]!, time, new Float32Array(character.poseSize));
  const skeleton = solveSkeleton(character, pose, createSkeleton(character));
  return boneToCharacter(skeleton, racket, character.meta.racketCenter, [0, 0, 0]);
}

describe('el personaje', () => {
  it('se lee del archivo: malla, esqueleto y clips', () => {
    expect(character.meta.version).toBe(1);
    expect(character.bones).toBe(25);
    expect(character.poseSize).toBe(25 * 4 + 3);
    expect(character.meta.mesh.nv).toBeGreaterThan(1000);
    expect(character.idx.length).toBe(character.meta.mesh.ni);
    expect(Math.max(...character.idx)).toBeLessThan(character.meta.mesh.nv);
    // What the game animates with.
    for (const name of ['listo', 'correr', 'lateral_izq', 'lateral_der', 'saque', 'derecha', 'reves', 'globo', 'remate']) {
      expect(character.clips[name], name).toBeDefined();
    }
    // The bones the game reaches for by name.
    for (const name of ['hips', 'chest', 'neck', 'head', 'upper_arm.R', 'forearm.R', 'hand.R', 'upper_arm.L', 'forearm.L', 'hand.L', 'racket']) {
      expect(character.bone(name), name).toBeGreaterThanOrEqual(0);
    }
    expect(character.meta.palettes.jugador).toHaveLength(character.meta.materials.length);
  });

  it('los padres van antes que los hijos, así el esqueleto se resuelve de una pasada', () => {
    character.meta.bones.parents.forEach((parent, i) => expect(parent).toBeLessThan(i));
  });

  it('cada rotación de cada cuadro es un cuaternión unitario', () => {
    for (const clip of Object.values(character.clips)) {
      for (let f = 0; f < clip.frames; f++) {
        for (let b = 0; b < character.bones; b++) {
          const k = f * character.poseSize + b * 4;
          const s = clip.samples;
          expect(Math.hypot(s[k]!, s[k + 1]!, s[k + 2]!, s[k + 3]!), `${clip.name} ${f} ${b}`).toBeCloseTo(1, 2);
        }
      }
    }
  });

  it('en el instante del contacto, la pala está donde el clip dice que le pega', () => {
    for (const name of ['saque', 'derecha', 'reves', 'globo', 'remate']) {
      const clip = character.clips[name]!;
      expect(clip.contact, name).toBeGreaterThan(0);
      const at = racketAt(name, clip.contact!);
      for (let c = 0; c < 3; c++) expect(at[c], `${name} eje ${c}`).toBeCloseTo(clip.hit![c]!, 2);
    }
  });

  it('la derecha le pega del lado de la pala y el revés del otro; el remate, bien arriba', () => {
    // It faces -y with x to its left: the racket hand is on the -x side.
    expect(character.clips.derecha!.hit![0]).toBeLessThan(-0.4);
    expect(character.clips.reves!.hit![0]).toBeGreaterThan(0.2);
    expect(character.clips.remate!.hit![2]).toBeGreaterThan(2);
    for (const name of ['derecha', 'reves', 'globo', 'remate', 'saque']) expect(character.clips[name]!.hit![1], name).toBeLessThan(0);
  });

  it('parado, mide lo que una persona y pisa el suelo', () => {
    const pose = samplePose(character, character.clips.listo!, 0, new Float32Array(character.poseSize));
    const skeleton = solveSkeleton(character, pose, createSkeleton(character));
    const height = (bone: string): number => skeleton.pos[character.bone(bone) * 3 + 2]!;
    expect(height('head')).toBeGreaterThan(1.3);
    expect(height('head')).toBeLessThan(1.9);
    expect(height('hips')).toBeGreaterThan(0.7);
    expect(height('foot.L')).toBeLessThan(0.2);
    expect(height('foot.R')).toBeLessThan(0.2);
  });

  it('los ciclos cierran: el último cuadro sigue en el primero sin salto', () => {
    for (const name of ['listo', 'correr', 'lateral_izq', 'lateral_der']) {
      const clip = character.clips[name]!;
      expect(clip.loop).toBe(true);
      const end = racketAt(name, clip.dur - 1e-4);
      const start = racketAt(name, 0);
      expect(Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]), name).toBeLessThan(0.02);
    }
  });

  it('una pose a medio camino entre dos queda entre las dos', () => {
    const size = character.poseSize;
    const a = samplePose(character, character.clips.listo!, 0, new Float32Array(size));
    const b = samplePose(character, character.clips.remate!, character.clips.remate!.contact!, new Float32Array(size));
    const racketOf = (pose: Float32Array): [number, number, number] =>
      boneToCharacter(solveSkeleton(character, pose, createSkeleton(character)), racket, character.meta.racketCenter, [0, 0, 0]);
    const low = racketOf(a)[2];
    const high = racketOf(b)[2];
    const mid = racketOf(blendPose(character.bones, a, b, 0.5, new Float32Array(size)))[2];
    expect(mid).toBeGreaterThan(low);
    expect(mid).toBeLessThan(high);
    // The ends are the ends.
    expect(racketOf(blendPose(character.bones, a, b, 0, new Float32Array(size)))[2]).toBeCloseTo(low, 5);
    expect(racketOf(blendPose(character.bones, a, b, 1, new Float32Array(size)))[2]).toBeCloseTo(high, 5);
  });

  it('las matrices de piel dejan cada articulación donde el esqueleto dice', () => {
    const pose = samplePose(character, character.clips.derecha!, 0.4, new Float32Array(character.poseSize));
    const skeleton = solveSkeleton(character, pose, createSkeleton(character));
    const matrices = skinMatrices(character, skeleton, new Float32Array(character.bones * 16));
    character.meta.bones.rest.forEach((rest, i) => {
      // A vertex sitting on the joint in the rest pose goes to where the joint is now.
      const m = i * 16;
      for (let c = 0; c < 3; c++) {
        const moved = matrices[m + c]! * rest[0] + matrices[m + 4 + c]! * rest[1] + matrices[m + 8 + c]! * rest[2] + matrices[m + 12 + c]!;
        expect(moved, `${character.meta.bones.names[i]} eje ${c}`).toBeCloseTo(skeleton.pos[i * 3 + c]!, 4);
      }
    });
  });
});
