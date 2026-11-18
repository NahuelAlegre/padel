/**
 * Colours of the plain 2D look: what is drawn when there is no 3D, and the
 * few things drawn over the 3D (the thumbs, a name, the extra aids).
 *
 * They are the colours of the club at dusk, so that going from one look to
 * the other is not a shock. Nothing relies on colour alone: every aid is a
 * shape or a word.
 */
export const PAL = {
  /** Behind everything, before any picture has arrived. */
  background: '#291f34',
  floorNear: '#3f78b4',
  floorFar: '#386ca6',
  line: '#f6efe0',
  glassFill: 'rgba(214, 232, 246, 0.08)',
  glassEdge: 'rgba(240, 244, 248, 0.42)',
  glassJoint: 'rgba(240, 244, 248, 0.14)',
  fenceFill: 'rgba(240, 244, 248, 0.03)',
  fenceLine: 'rgba(240, 244, 248, 0.16)',
  frontEdge: 'rgba(240, 244, 248, 0.3)',
  frontJoint: 'rgba(240, 244, 248, 0.08)',
  netFill: 'rgba(30, 22, 40, 0.42)',
  netMesh: 'rgba(246, 239, 224, 0.18)',
  netTape: '#f6efe0',
  /** Shadows multiply toward violet, like the ones baked into the court. */
  shadow: 'rgba(52, 40, 96, 0.38)',
  ball: '#eaf64a',
  ballEdge: '#4d5c14',
  /** Marks and aids: cream for what comes to the person, coral for what the person aims. */
  cream: '#fff5d6',
  coral: '#ff6a4d',
  aid: '#fff5d6',
  aidSoft: 'rgba(255, 245, 214, 0.55)',
  ink: '#2a1b2e',
  mustard: '#f0c14a',
  text: '#ffffff',
  textEdge: 'rgba(42, 27, 46, 0.9)',
} as const;

export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";
