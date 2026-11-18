import type { CharacterId } from '../../characters/types';

/**
 * What each character wears. Everybody shares one body for now, so a look is
 * a set of colours: one for each material of the mesh that is not skin deep.
 * The colours follow the cast design (docs/personajes.md): Beto in the white,
 * navy and mustard of the club; Romina in fire-brigade red, yellow and black;
 * Chela in lavender, white and pink. Silhouettes of their own come later.
 *
 * Colours are linear-ish RGB from 0 to 1, as the character file stores them.
 * A material that is not named keeps the colour of the base palette.
 */
export type Colour = [number, number, number];

export interface Look {
  /** The palette of the character file this look starts from. */
  base: 'jugador' | 'rival';
  colours: Partial<Record<string, Colour>>;
}

const rgb = (hex: string): Colour => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

/** The person's own player: cream, coral and teal. It is the palette the file calls "jugador". */
export const PLAYER_LOOK: Look = { base: 'jugador', colours: {} };

export const LOOKS: Record<CharacterId, Look> = {
  beto: {
    base: 'jugador',
    colours: {
      hair: rgb('#b9b6ae'),
      brow: rgb('#8d8a84'),
      hair_tie: rgb('#f4f1e8'),
      headband: rgb('#f4f1e8'),
      shirt: rgb('#f4f1e8'),
      shirt_stripe: rgb('#d9a520'),
      shirt_trim: rgb('#d9a520'),
      shorts: rgb('#27304a'),
      shorts_band: rgb('#d9a520'),
      sock: rgb('#f4f1e8'),
      shoe_upper: rgb('#f4f1e8'),
      shoe_cap: rgb('#dcd8cc'),
      shoe_accent: rgb('#27304a'),
      shoe_collar: rgb('#27304a'),
      shoe_tongue: rgb('#f4f1e8'),
      wrist: rgb('#27304a'),
      wrist_stripe: rgb('#d9a520'),
      racket_face: rgb('#5c6b8a'),
      racket_frame: rgb('#27304a'),
      racket_grip: rgb('#e8e2d0'),
    },
  },
  // The palette the file calls "rival" is Romina's.
  romina: { base: 'rival', colours: {} },
  chela: {
    base: 'rival',
    colours: {
      hair: rgb('#c9c2d6'),
      brow: rgb('#8f879c'),
      hair_tie: rgb('#f6f2f7'),
      headband: rgb('#f6f2f7'),
      shirt: rgb('#b9a3e3'),
      shirt_stripe: rgb('#f6f2f7'),
      shirt_trim: rgb('#f2a7c3'),
      shorts: rgb('#f6f2f7'),
      shorts_band: rgb('#f2a7c3'),
      sock: rgb('#f6f2f7'),
      shoe_upper: rgb('#f6f2f7'),
      shoe_cap: rgb('#e6dff0'),
      shoe_accent: rgb('#b9a3e3'),
      shoe_collar: rgb('#f2a7c3'),
      shoe_tongue: rgb('#f6f2f7'),
      wrist: rgb('#f2a7c3'),
      wrist_stripe: rgb('#f6f2f7'),
      racket_face: rgb('#cdb9f0'),
      racket_frame: rgb('#8f79c4'),
      racket_grip: rgb('#f6f2f7'),
    },
  },
};

/** The main colour of a look, for the simple figure drawn when there is no 3D: its shirt. */
export function shirtOf(look: Look, palettes: Record<string, Colour[]> | null, materials: readonly string[] | null): Colour {
  const own = look.colours.shirt;
  if (own) return own;
  const at = materials ? materials.indexOf('shirt') : -1;
  const base = palettes?.[look.base]?.[at];
  return base ?? (look.base === 'rival' ? [0.84, 0.2, 0.18] : [0.96, 0.93, 0.85]);
}

/** The colours of a look as the graphics card wants them: r, g, b and whether the material is flat. */
export function paletteOf(
  look: Look,
  palettes: Record<string, Colour[]>,
  materials: readonly string[],
  flat: readonly boolean[],
): Float32Array {
  const out = new Float32Array(26 * 4);
  const base = palettes[look.base] ?? Object.values(palettes)[0] ?? [];
  materials.forEach((name, i) => {
    const colour = look.colours[name] ?? base[i] ?? [1, 0, 1];
    out[i * 4] = colour[0];
    out[i * 4 + 1] = colour[1];
    out[i * 4 + 2] = colour[2];
    out[i * 4 + 3] = flat[i] ? 1 : 0;
  });
  return out;
}
