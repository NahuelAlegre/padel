import type { CharacterId } from '../../characters/types';
import type { Character, Style } from '../toon/character';

/**
 * What each character wears. Everybody shares one body; what makes each one
 * itself (its colours, its cap or its braid, its belly) comes in the
 * character file, one entry per member of the cast. This is the little that
 * is left on this side: which entry is whose, and a colour for the simple
 * figure of the 2D look, which has no file to ask.
 *
 * Colours are RGB from 0 to 1, as the character file stores them.
 */
export type Colour = [number, number, number];

/** The entry of the character file for the person's own player. */
export const OWN = 'jugador';

/** Which entry of the character file somebody is. */
export function castName(id: CharacterId | null): string {
  return id ?? OWN;
}

const rgb = (hex: string): Colour => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

/** Shirts for when there is no character file: cream, white, fire-brigade red and lavender. */
const SHIRTS: Record<string, Colour> = {
  [OWN]: rgb('#f5edd9'),
  beto: rgb('#f4f1e8'),
  romina: rgb('#d6332e'),
  chela: rgb('#b9a3e3'),
};

/** The main colour of somebody, for the simple figure drawn when there is no 3D: its shirt. */
export function shirtOf(character: Character | null, name: string): Colour {
  if (character) {
    const meta = character.meta;
    const at = meta.materials.indexOf('shirt');
    const palette = meta.palettes[meta.personajes?.[name]?.paleta ?? name];
    const colour = palette?.[at];
    if (colour) return colour;
  }
  return SHIRTS[name] ?? SHIRTS[OWN]!;
}

/** The colours of a character as the graphics card wants them: r, g, b and whether the material is flat. */
export function paletteOf(character: Character, style: Style): Float32Array {
  const meta = character.meta;
  const out = new Float32Array(26 * 4);
  const palette = meta.palettes[style.palette] ?? Object.values(meta.palettes)[0] ?? [];
  meta.materials.forEach((_name, i) => {
    const colour = palette[i] ?? [1, 0, 1];
    out[i * 4] = colour[0];
    out[i * 4 + 1] = colour[1];
    out[i * 4 + 2] = colour[2];
    out[i * 4 + 3] = meta.flat[i] ? 1 : 0;
  });
  return out;
}
