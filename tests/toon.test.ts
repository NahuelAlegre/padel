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
  styleOf,
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
    expect(character.meta.version).toBe(2);
    expect(character.bones).toBe(25);
    expect(character.poseSize).toBe(25 * 4 + 3);
    expect(character.meta.mesh.nv).toBeGreaterThan(1000);
    // Every index of the file, the optional pieces included.
    expect(character.idx.length).toBe(character.meta.mesh.nt);
    expect(character.idx.length).toBeGreaterThan(character.meta.mesh.ni);
    expect(Math.max(...character.idx)).toBeLessThan(character.meta.mesh.nv);
    // The shader has room for this many bones and materials.
    expect(character.bones).toBeLessThanOrEqual(26);
    expect(character.meta.materials.length).toBeLessThanOrEqual(26);
    // What the game animates with.
    for (const name of [
      'listo', 'espera', 'correr', 'correr_atras', 'lateral_izq', 'lateral_der', 'split_step',
      'saque', 'derecha', 'reves', 'volea', 'volea_reves', 'bandeja', 'remate', 'globo', 'estirada', 'estirada_reves',
      'festejo', 'lamento', 'mania_gorra', 'mania_zapatilla', 'mania_saludo',
    ]) {
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

  it('cada clip dice lo suyo: zancada y dirección los ciclos, contacto y armado los golpes', () => {
    for (const name of ['correr', 'correr_atras', 'lateral_izq', 'lateral_der']) {
      const clip = character.clips[name]!;
      expect(clip.loop, name).toBe(true);
      expect(clip.zancada, name).toBeGreaterThan(1);
      expect(clip.zancada, name).toBeLessThan(2.2);
      expect(Math.hypot(clip.dir![0], clip.dir![1]), name).toBeCloseTo(1, 6);
      expect(clip.entrada, name).toBeGreaterThanOrEqual(0);
      expect(clip.entrada, name).toBeLessThan(1);
    }
    for (const clip of Object.values(character.clips)) {
      if (clip.grupo !== 'golpe') continue;
      expect(clip.contact, clip.name).toBeGreaterThan(0);
      expect(clip.contact, clip.name).toBeLessThan(clip.dur);
      // The windup ends before the contact: what is left is the swing itself.
      expect(clip.armado![1], clip.name).toBeLessThan(clip.contact!);
      expect(clip.armado![0], clip.name).toBeLessThanOrEqual(clip.armado![1]);
      expect(['derecha', 'reves'], clip.name).toContain(clip.lado);
      // Reverses are played on the other side of the body.
      expect(Math.sign(clip.hit![0]), clip.name).toBe(clip.lado === 'reves' ? 1 : -1);
    }
    const serve = character.clips.saque!;
    expect(serve.release).toBeLessThan(serve.contact!);
    expect(serve.ballHold).toHaveLength(2);
    expect(character.clips.split_step!.aterrizaje).toBeLessThan(character.clips.split_step!.corte!);
  });

  it('un modelo, cuatro personajes: lo propio de cada uno viene en el archivo', () => {
    const own = styleOf(character, 'jugador');
    const beto = styleOf(character, 'beto');
    const romina = styleOf(character, 'romina');
    const chela = styleOf(character, 'chela');
    const drawn = (style: typeof own): number => style.parts.reduce((sum, part) => sum + part[1], 0);
    const base = character.meta.mesh.base!;
    // Everybody is the base body plus their own pieces, and nothing reaches past the end of the mesh.
    for (const style of [own, beto, romina, chela]) {
      expect(style.parts[0]![0]).toBe(0);
      expect(drawn(style)).toBeGreaterThanOrEqual(base);
      for (const [first, count] of style.parts) expect(first + count).toBeLessThanOrEqual(character.idx.length);
      expect(character.meta.palettes[style.palette]).toHaveLength(character.meta.materials.length);
    }
    // The braid for some, the cap and the moustache for Beto.
    expect(drawn(own)).toBe(character.meta.mesh.ni);
    expect(drawn(beto)).not.toBe(drawn(own));
    expect(new Set([own.palette, beto.palette, romina.palette, chela.palette]).size).toBe(4);
    // Chela is smaller; Beto has a belly and leans back; each has a tic.
    expect(chela.size).toBeCloseTo(0.9, 6);
    expect(beto.scale![character.bone('spine') * 3 + 1]).toBeGreaterThan(1.2);
    expect(beto.posture.length).toBeGreaterThan(0);
    expect(own.scale).toBeNull();
    expect(new Set([beto.mania, romina.mania, chela.mania]).size).toBe(3);
    // Somebody the file does not know is somebody plain.
    const stranger = styleOf(character, 'nadie');
    expect(stranger.size).toBe(1);
    expect(stranger.scale).toBeNull();
    expect(character.meta.palettes[stranger.palette]).toBeDefined();
  });

  it('con huesos escalados, la malla y el esqueleto siguen juntos', () => {
    const beto = styleOf(character, 'beto');
    const pose = samplePose(character, character.clips.listo!, 0, new Float32Array(character.poseSize));
    const plain = solveSkeleton(character, pose, createSkeleton(character));
    const big = solveSkeleton(character, pose, createSkeleton(character), beto);
    // Thinner legs are not shorter legs, and a bigger belly does not move the feet.
    const z = (skeleton: typeof plain, bone: string): number => skeleton.pos[character.bone(bone) * 3 + 2]!;
    expect(z(big, 'foot.L')).toBeCloseTo(z(plain, 'foot.L'), 2);
    expect(z(big, 'head')).toBeCloseTo(z(plain, 'head'), 2);
    const matrices = skinMatrices(character, big, new Float32Array(26 * 16), beto);
    // A point at the joint of a bone stays at the joint, scaled or not.
    const spine = character.bone('spine');
    const rest = character.meta.bones.rest[spine]!;
    const shift = [beto.shift![spine * 3]!, beto.shift![spine * 3 + 1]!, beto.shift![spine * 3 + 2]!];
    const m = spine * 16;
    for (let r = 0; r < 3; r++) {
      const at = matrices[m + r]! * rest[0] + matrices[m + 4 + r]! * rest[1] + matrices[m + 8 + r]! * rest[2] + matrices[m + 12 + r]!;
      // Only the shift of that part of the mesh, turned with the bone, separates them.
      expect(Math.abs(at - big.pos[spine * 3 + r]!)).toBeLessThan(Math.hypot(shift[0]!, shift[1]!, shift[2]!) + 1e-4);
    }
  });

  it('parado, mide lo que una persona y pisa el suelo', () => {
    const pose = samplePose(character, character.clips.listo!, 0, new Float32Array(character.poseSize));
    const skeleton = solveSkeleton(character, pose, createSkeleton(character));
    const height = (bone: string): number => skeleton.pos[character.bone(bone) * 3 + 2]!;
    // Standing ready is standing low: knees bent, weight forward.
    expect(height('head')).toBeGreaterThan(1.2);
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
