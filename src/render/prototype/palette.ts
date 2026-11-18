/**
 * Grey-box palette. Deliberately neutral: this renderer exists to judge the
 * mechanics, and the only saturated colour is the ball, so it is never lost.
 * Nothing relies on colour alone: the two sides differ in tone and outline,
 * the human has a ring under the feet, and every aid is a shape or a word.
 */
export const PAL = {
  background: '#15171b',
  floorNear: '#7c818a',
  floorFar: '#6f747d',
  line: '#eef0f2',
  glassFill: 'rgba(232, 238, 244, 0.075)',
  glassEdge: 'rgba(232, 238, 244, 0.45)',
  glassJoint: 'rgba(232, 238, 244, 0.14)',
  fenceFill: 'rgba(232, 238, 244, 0.03)',
  fenceLine: 'rgba(232, 238, 244, 0.2)',
  frontEdge: 'rgba(232, 238, 244, 0.3)',
  frontJoint: 'rgba(232, 238, 244, 0.08)',
  netFill: 'rgba(16, 18, 22, 0.46)',
  netMesh: 'rgba(240, 242, 244, 0.16)',
  netTape: '#f4f5f6',
  shadow: 'rgba(0, 0, 0, 0.32)',
  ball: '#e8f23a',
  ballEdge: '#1d2016',
  aid: '#ffffff',
  aidSoft: 'rgba(255, 255, 255, 0.55)',
  text: '#ffffff',
  textEdge: 'rgba(12, 13, 16, 0.85)',
  near: { body: '#f1f3f5', edge: '#17191d' },
  far: { body: '#2c3037', edge: '#f1f3f5' },
} as const;

export const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";
