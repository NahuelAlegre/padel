/**
 * The shaders of the 3D look. Four small programs:
 *
 *   layer      a picture of the court, laid on a plane of the world and looked
 *              up from the camera it was rendered from
 *   screen     a picture straight on the screen (the sky, the cached background)
 *   character  the mesh: toon colour, ink outline or shadow on the floor
 *   mark       a square whose shape the fragment shader draws: the ball, soft
 *              shadows, glows, thin rings
 */

export const LAYER_VS = `#version 300 es
in vec3 aPos; uniform mat4 uVP; out vec3 vW;
void main() { vW = aPos; gl_Position = uVP * vec4(aPos, 1.0); }`;

/* Every point of the plane asks the reference camera where it fell in the render: that is its colour. */
export const LAYER_FS = `#version 300 es
precision highp float;
in vec3 vW; out vec4 o;
uniform sampler2D uTex; uniform vec3 uPos, uR, uU, uF; uniform float uFocal, uAlpha; uniform vec4 uRect;
void main() {
  vec3 d = vW - uPos;
  float depth = dot(d, uF);
  if (depth < 0.5) discard;
  vec2 s = vec2(dot(d, uR), -dot(d, uU)) * (uFocal / depth);
  vec2 uv = (s - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  o = texture(uTex, uv) * uAlpha;
}`;

export const SCREEN_VS = `#version 300 es
in vec2 aPos; in vec2 aUV; out vec2 vUV;
void main() { vUV = aUV; gl_Position = vec4(aPos, 0.999, 1.0); }`;

export const SCREEN_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o; uniform sampler2D uTex;
void main() { o = texture(uTex, vUV); }`;

/* The same vertex does for the colour, the outline and the shadow (uMode). */
export const CHARACTER_VS = `#version 300 es
precision highp float; precision highp int;
in vec3 aPos; in vec3 aNrm; in float aMat; in float aOut; in vec3 aJoints; in vec2 aWeights;
uniform mat4 uVP; uniform mat4 uBones[26]; uniform vec3 uCenter, uHalf;
uniform vec4 uRoot;            /* x, y, turn, scale */
uniform vec4 uPal[26];
uniform int uMode;             /* 0 colour, 1 outline, 2 shadow */
uniform vec3 uSun; uniform vec2 uViewport; uniform float uOutlinePx;
out vec3 vN; out vec3 vW; flat out vec4 vBase;
void main() {
  vec4 p = vec4(uCenter + uHalf * aPos, 1.0);
  float w2 = 1.0 - aWeights.x - aWeights.y;
  mat4 B = uBones[int(aJoints.x)] * aWeights.x + uBones[int(aJoints.y)] * aWeights.y + uBones[int(aJoints.z)] * w2;
  vec3 lp = (B * p).xyz;
  vec3 ln = mat3(B) * aNrm;
  float c = cos(uRoot.z), s = sin(uRoot.z);
  vec3 wp = vec3(c * lp.x - s * lp.y, s * lp.x + c * lp.y, lp.z) * uRoot.w + vec3(uRoot.xy, 0.0);
  vec3 wn = normalize(vec3(c * ln.x - s * ln.y, s * ln.x + c * ln.y, ln.z));
  vBase = uPal[int(aMat + 0.5)];
  vN = wn; vW = wp;
  if (uMode == 2) {
    wp = vec3(wp.xy - uSun.xy * (wp.z / uSun.z), 0.012);     /* flattened on the floor, away from the sun */
    gl_Position = uVP * vec4(wp, 1.0);
    return;
  }
  vec4 clip = uVP * vec4(wp, 1.0);
  if (uMode == 1) {
    vec4 cn = uVP * vec4(wp + wn * 0.02, 1.0);
    vec2 d = cn.xy / cn.w - clip.xy / clip.w;
    float l = length(d * uViewport);
    if (l > 1e-5) clip.xy += (d * uViewport / l) * (uOutlinePx * aOut * 2.0) / uViewport * clip.w;
    clip.z += 0.0006 * clip.w;
  }
  gl_Position = clip;
}`;

export const CHARACTER_FS = `#version 300 es
precision highp float; precision highp int;
in vec3 vN; in vec3 vW; flat in vec4 vBase; out vec4 o;
uniform int uMode; uniform vec3 uKey, uSun, uEye, uInk, uShadowTint, uLightGain, uRim, uShadowCol;
void main() {
  if (uMode == 1) { o = vec4(uInk, 1.0); return; }
  if (uMode == 2) { o = vec4(uShadowCol, 1.0); return; }
  vec3 n = normalize(vN);
  vec3 base = vBase.rgb;
  float ndl = dot(n, uKey);
  float mid = step(0.22, ndl), hi = step(0.80, ndl);
  vec3 col;
  if (vBase.a > 0.5) {                       /* flat materials: eyes, brows, mouth */
    col = mix(base * (0.5 + 0.5 * uShadowTint), base, mid);
  } else {
    col = mix(base * uShadowTint, base, mid);
    col = mix(col, min(base * uLightGain + 0.03, vec3(1.0)), hi);
    float facing = 1.0 - abs(dot(n, normalize(uEye - vW)));
    float rim = step(0.56, facing) * step(0.18, dot(n, uSun)) * 0.9;
    col = mix(col, min(base * 0.45 + uRim * 0.62, vec3(1.0)), rim);
  }
  o = vec4(col, 1.0);
}`;

export const MARK_VS = `#version 300 es
precision highp float;
in vec2 aPos; uniform mat4 uVP; uniform vec3 uC, uAx, uAy; out vec2 vP;
void main() { vP = aPos; gl_Position = uVP * vec4(uC + uAx * aPos.x + uAy * aPos.y, 1.0); }`;

/** What a mark is. The numbers are the ones the fragment shader switches on. */
export const MARK = {
  ball: 0,
  /** A soft dark ellipse that multiplies what is under it. */
  shadow: 1,
  /** A soft spot of light, added: dust, a glint, the glow of the ball. */
  glow: 2,
  /** A thin ring with a dot in the middle, lying on the floor. */
  ring: 3,
  /** A four-pointed sparkle, added. */
  sparkle: 4,
} as const;

export const MARK_FS = `#version 300 es
precision highp float; precision highp int;
in vec2 vP; out vec4 o; uniform int uKind; uniform vec4 uCol; uniform float uA, uB;
void main() {
  float r = length(vP);
  if (uKind == 0) {                 /* ball: three tones and an edge */
    if (r > 1.0) discard;
    vec3 n = vec3(vP, sqrt(max(0.0, 1.0 - r * r)));
    float l = dot(n, normalize(vec3(-0.45, 0.55, 0.7)));
    vec3 c = mix(vec3(0.651, 0.749, 0.169), vec3(0.918, 0.965, 0.290), step(0.05, l));
    c = mix(c, vec3(0.992, 1.0, 0.851), step(0.78, l));
    c = mix(c, vec3(0.30, 0.36, 0.08), step(0.80, r));
    o = vec4(c, 1.0);
  } else if (uKind == 1) {          /* soft shadow (multiplied) */
    float a = smoothstep(1.0, 0.45, r) * uA;
    o = vec4(mix(vec3(1.0), uCol.rgb, a), 1.0);
  } else if (uKind == 2) {          /* soft light (added) */
    float a = smoothstep(1.0, 0.0, r);
    a *= a * uA;
    o = vec4(uCol.rgb * a, 0.0);
  } else if (uKind == 3) {          /* thin ring with a dot; uB is how thick the ring is */
    float ring = smoothstep(1.0, 0.94, r) * smoothstep(1.0 - uB - 0.06, 1.0 - uB, r);
    if (r > 1.0) ring = 0.0;
    float a = max(ring, smoothstep(0.26, 0.18, r)) * uA;
    o = vec4(uCol.rgb * a, a);
  } else {                          /* four-pointed sparkle (added) */
    vec2 q = abs(vP);
    float star = max(0.0, 1.0 - (q.x * 9.0 + q.y * 0.9)) + max(0.0, 1.0 - (q.y * 9.0 + q.x * 0.9));
    float a = clamp(star, 0.0, 1.0) * smoothstep(1.0, 0.2, r) * uA;
    o = vec4(uCol.rgb * a, 0.0);
  }
}`;
