import { clamp } from '../../core/math';
import { makeCamera, REFERENCE, type StageCamera, type Vec3 } from '../stage/camera';
import { NEAR_WALL_ALPHA, type CourtLayers, type LayerName } from '../stage/court-art';
import { ballBehind, type BallFrame, type EffectFrame, type FigureFrame, type MarkFrame, type StageFrame } from '../stage/frame';
import type { Character } from './character';
import {
  CHARACTER_FS,
  CHARACTER_VS,
  LAYER_FS,
  LAYER_VS,
  MARK,
  MARK_FS,
  MARK_VS,
  SCREEN_FS,
  SCREEN_VS,
} from './shaders';

type GL = WebGL2RenderingContext;

interface Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: GL, vertex: string, fragment: string): Program {
  const shader = (type: number, source: string): WebGLShader => {
    const s = gl.createShader(type);
    if (!s) throw new Error('Could not create a shader');
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'Shader did not compile');
    return s;
  };
  const program = gl.createProgram();
  if (!program) throw new Error('Could not create a program');
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Program did not link');
  const uniforms: Program['uniforms'] = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

/** Toward the sun: low, behind the far end and to the left. It is the light the court was rendered with. */
export const SUN: Vec3 = (() => {
  const v: Vec3 = [-0.42, 0.8, 0.43];
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
})();
/** A shadow multiplies the floor and turns it toward violet. */
const SHADOW: Vec3 = [0.6, 0.56, 0.8];
/** The light the characters are shaded with: from the camera's side, so they do not end up as silhouettes. */
const KEY: Vec3 = (() => {
  const v: Vec3 = [-0.5, -0.6, 0.62];
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
})();

const CREAM = [1.0, 0.96, 0.84, 1];
const CORAL = [1.0, 0.416, 0.302, 1];
/** A mark on the floor is never smaller than this across, nor its line thinner than this, in CSS pixels. */
const MARK_MIN_RADIUS = 7;
const MARK_MIN_LINE = 1.25;
/** Bit of the stencil that says "somebody on the near side is drawn here". */
const NEAR_BODY = 0x80;
const SHADOW_BIT = 0x01;

const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): number[] => [...a, ...b, ...c, ...a, ...c, ...d];

/**
 * The planes of the world each layer of the court is laid on. A layer is a
 * flat picture; putting it on the plane where its things really are makes it
 * move the right way when the camera does.
 */
const PLANES: Partial<Record<LayerName, number[]>> = {
  piso: quad([-90, -70, 0], [90, -70, 0], [90, 60, 0], [-90, 60, 0]),
  // The surroundings: a "U" of walls (far end and sides) plus the ground inside it, for what stands on the pavement.
  entorno: [
    ...quad([-9.5, 17.3, 0], [9.5, 17.3, 0], [9.5, 17.3, 60], [-9.5, 17.3, 60]),
    ...quad([-9.5, -60, 0], [-9.5, 17.3, 0], [-9.5, 17.3, 60], [-9.5, -60, 60]),
    ...quad([9.5, 17.3, 0], [9.5, -60, 0], [9.5, -60, 60], [9.5, 17.3, 60]),
    ...quad([-9.5, -60, 0], [9.5, -60, 0], [9.5, 17.3, 0], [-9.5, 17.3, 0]),
  ],
  paredes: [
    ...quad([-5.04, 10, -0.1], [5.04, 10, -0.1], [5.04, 10, 4.2], [-5.04, 10, 4.2]),
    ...quad([-5, -10.04, -0.1], [-5, 10, -0.1], [-5, 10, 4.2], [-5, -10.04, 4.2]),
    ...quad([5, 10, -0.1], [5, -10.04, -0.1], [5, -10.04, 4.2], [5, 10, 4.2]),
  ],
  red: quad([-5.2, 0, -0.05], [5.2, 0, -0.05], [5.2, 0, 1.15], [-5.2, 0, 1.15]),
  cerca: quad([-5.1, -10, -0.1], [5.1, -10, -0.1], [5.1, -10, 3.2], [-5.1, -10, 3.2]),
  frente: quad([-9, -12.6, -0.3], [9, -12.6, -0.3], [9, -12.6, 2.2], [-9, -12.6, 2.2]),
};

/**
 * Draws a frame in 3D with WebGL2, with no library in between.
 *
 * The court is the baked pictures, each laid on its plane and looked up from
 * the camera it was rendered from: with the camera still it is the render,
 * pixel for pixel, and when the camera moves each plane shifts as it should.
 * The characters are a mesh with a skeleton, shaded in three flat tones, with
 * an ink outline (the mesh drawn again, inside out and a little fatter) and a
 * shadow on the floor that has the shape of the pose.
 *
 * Everything here belongs to one WebGL context. If the context is lost this
 * object is dead: a new one is made when it comes back.
 */
export class ToonGL {
  private readonly gl: GL;
  private readonly layer: Program;
  private readonly screen: Program;
  private readonly figure: Program;
  private readonly mark: Program;
  private readonly textures = new Map<LayerName, WebGLTexture>();
  private readonly planes = new Map<LayerName, { vao: WebGLVertexArrayObject; count: number }>();
  private readonly screenVao: WebGLVertexArrayObject;
  private readonly screenBuffer: WebGLBuffer;
  private readonly screenData = new Float32Array(24);
  private readonly markVao: WebGLVertexArrayObject;
  private readonly meshVao: WebGLVertexArrayObject;
  /** What is drawn of the mesh for somebody with nothing of their own: the body and the braid. */
  private readonly plain: ReadonlyArray<readonly [number, number]>;
  private readonly reference: StageCamera = makeCamera(REFERENCE);
  private readonly vp = new Float32Array(16);
  /** The background, kept as a picture while the camera does not move. */
  private readonly cache: { texture: WebGLTexture; frame: WebGLFramebuffer; key: string; last: string; still: number; w: number; h: number };
  private readonly v0 = new Float32Array(3);
  private readonly v1 = new Float32Array(3);
  private readonly v2 = new Float32Array(3);
  private readonly seen = { x: 0, y: 0, d: 0 };
  private readonly order: FigureFrame[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly court: CourtLayers,
    private readonly character: Character,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      stencil: true,
      depth: true,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('No WebGL2 here');
    this.gl = gl;
    this.layer = compile(gl, LAYER_VS, LAYER_FS);
    this.screen = compile(gl, SCREEN_VS, SCREEN_FS);
    this.figure = compile(gl, CHARACTER_VS, CHARACTER_FS);
    this.mark = compile(gl, MARK_VS, MARK_FS);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    for (const layer of Object.values(court)) {
      const texture = this.must(gl.createTexture());
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.image as TexImageSource);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.set(layer.name, texture);
    }

    for (const [name, vertices] of Object.entries(PLANES) as Array<[LayerName, number[]]>) {
      const vao = this.must(gl.createVertexArray());
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.must(gl.createBuffer()));
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      const at = gl.getAttribLocation(this.layer.program, 'aPos');
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, 3, gl.FLOAT, false, 0, 0);
      this.planes.set(name, { vao, count: vertices.length / 3 });
    }

    // A rectangle on the screen whose corners change: the sky, and the cached background.
    this.screenVao = this.must(gl.createVertexArray());
    this.screenBuffer = this.must(gl.createBuffer());
    gl.bindVertexArray(this.screenVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 24 * 4, gl.DYNAMIC_DRAW);
    for (const [name, offset] of [
      ['aPos', 0],
      ['aUV', 8],
    ] as const) {
      const at = gl.getAttribLocation(this.screen.program, name);
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 16, offset);
    }

    // A unit square for the ball and every mark.
    this.markVao = this.must(gl.createVertexArray());
    gl.bindVertexArray(this.markVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.must(gl.createBuffer()));
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    {
      const at = gl.getAttribLocation(this.mark.program, 'aPos');
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    }

    // The mesh of the character.
    this.meshVao = this.must(gl.createVertexArray());
    gl.bindVertexArray(this.meshVao);
    const attribute = (name: string, data: ArrayBufferView, size: number, type: number, normalized: boolean): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.must(gl.createBuffer()));
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const at = gl.getAttribLocation(this.figure.program, name);
      if (at < 0) return;
      gl.enableVertexAttribArray(at);
      gl.vertexAttribPointer(at, size, type, normalized, 0, 0);
    };
    attribute('aPos', character.pos, 3, gl.SHORT, true);
    attribute('aNrm', character.nrm, 3, gl.BYTE, true);
    attribute('aMat', character.mat, 1, gl.UNSIGNED_BYTE, false);
    attribute('aOut', character.out, 1, gl.UNSIGNED_BYTE, true);
    attribute('aJoints', character.joints, 3, gl.UNSIGNED_BYTE, false);
    attribute('aWeights', character.weights, 2, gl.UNSIGNED_BYTE, true);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.must(gl.createBuffer()));
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, character.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.plain = [[0, character.meta.mesh.ni]];

    const texture = this.must(gl.createTexture());
    const frame = this.must(gl.createFramebuffer());
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cache = { texture, frame, key: '', last: '', still: 0, w: 0, h: 0 };
  }

  private must<T>(value: T | null): T {
    if (value === null) throw new Error('The graphics context is gone');
    return value;
  }

  /** True while the context is lost: nothing can be drawn with this object any more. */
  get lost(): boolean {
    return this.gl.isContextLost();
  }

  /** Size of the drawing surface, in its own pixels. */
  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  // ---------------------------------------------------------------- pieces

  private drawLayer(name: LayerName, alpha = 1): void {
    const { gl, layer, reference } = this;
    const art = this.court[name];
    const plane = this.planes.get(name);
    const texture = this.textures.get(name);
    if (!plane || !texture) return;
    const u = layer.uniforms;
    gl.useProgram(layer.program);
    gl.uniformMatrix4fv(u.uVP!, false, this.vp);
    gl.uniform3fv(u.uPos!, reference.pos);
    gl.uniform3fv(u.uR!, reference.right);
    gl.uniform3fv(u.uU!, reference.up);
    gl.uniform3fv(u.uF!, reference.fwd);
    gl.uniform1f(u.uFocal!, reference.f);
    gl.uniform1f(u.uAlpha!, alpha);
    gl.uniform4f(u.uRect!, art.dx, art.dy, art.dw, art.dh);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bindVertexArray(plane.vao);
    gl.drawArrays(gl.TRIANGLES, 0, plane.count);
  }

  private fillScreenQuad(x0: number, y0: number, x1: number, y1: number, flip: boolean): void {
    const d = this.screenData;
    const top = flip ? 0 : 1;
    const bottom = flip ? 1 : 0;
    // Two triangles: position (x, y) and texture coordinate (u, v) per corner.
    d.set([x0, y0, 0, bottom, x1, y0, 1, bottom, x1, y1, 1, top, x0, y0, 0, bottom, x1, y1, 1, top, x0, y1, 0, top]);
    const { gl } = this;
    gl.bindVertexArray(this.screenVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.screenBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
  }

  /** The sky is a painted backdrop: it only slides sideways when the camera turns. */
  private drawSky(frame: StageFrame): void {
    const { gl } = this;
    const sky = this.court.cielo;
    const texture = this.textures.get('cielo');
    if (!texture) return;
    const lay = frame.view.lay;
    const toX = (dx: number): number => ((lay.ox + (dx + frame.skyShift) * lay.s) * 2) / lay.vw - 1;
    const toY = (dy: number): number => 1 - (2 * (lay.oy + dy * lay.s)) / lay.vh;
    gl.useProgram(this.screen.program);
    // The picture's first row is its top: flip it, since the screen's y grows upward here.
    this.fillScreenQuad(toX(sky.dx), toY(sky.dy + sky.dh), toX(sky.dx + sky.dw), toY(sky.dy), true);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private blitCache(): void {
    const { gl } = this;
    gl.useProgram(this.screen.program);
    this.fillScreenQuad(-1, -1, 1, 1, false);
    gl.bindTexture(gl.TEXTURE_2D, this.cache.texture);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.BLEND);
  }

  /** Sky, floor, surroundings and walls. With the camera still they are drawn once and then copied. */
  private drawBackground(frame: StageFrame): void {
    const { gl, cache, canvas } = this;
    const cam = frame.view.cam;
    const lay = frame.view.lay;
    const key = `${cam.pos[0]},${cam.fwd[0]},${cam.fwd[1]},${cam.f},${frame.skyShift},${canvas.width},${canvas.height},${lay.oy},${lay.s}`;
    if (key === cache.key) {
      this.blitCache();
      return;
    }
    cache.still = key === cache.last ? cache.still + 1 : 0;
    cache.last = key;
    cache.key = '';
    const bake = cache.still >= 2;
    if (bake) {
      if (cache.w !== canvas.width || cache.h !== canvas.height) {
        cache.w = canvas.width;
        cache.h = canvas.height;
        gl.bindTexture(gl.TEXTURE_2D, cache.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cache.w, cache.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, cache.frame);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.drawSky(frame);
    this.drawLayer('piso');
    this.drawLayer('entorno');
    this.drawLayer('paredes');
    if (bake) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      cache.key = key;
      this.blitCache();
    }
  }

  private drawFigure(figure: FigureFrame, frame: StageFrame, near: boolean): void {
    const bones = figure.bones;
    if (!bones) return;
    const { gl, canvas } = this;
    const meta = this.character.meta;
    const u = this.figure.uniforms;
    const cam = frame.view.cam;
    gl.useProgram(this.figure.program);
    gl.bindVertexArray(this.meshVao);
    gl.uniformMatrix4fv(u.uVP!, false, this.vp);
    gl.uniformMatrix4fv(u.uBones!, false, bones);
    gl.uniform3fv(u.uCenter!, meta.mesh.center);
    gl.uniform3fv(u.uHalf!, meta.mesh.half);
    // The character faces -y in its own axes: turned half way round, it faces the far end.
    gl.uniform4f(u.uRoot!, figure.x, figure.y, figure.facing > 0 ? Math.PI : 0, figure.k);
    gl.uniform4fv(u.uPal!, figure.palette);
    gl.uniform3fv(u.uSun!, SUN);
    gl.uniform3fv(u.uKey!, KEY);
    gl.uniform3fv(u.uEye!, cam.pos);
    gl.uniform3fv(u.uInk!, meta.ink);
    gl.uniform3fv(u.uShadowTint!, meta.shadowTint);
    gl.uniform3fv(u.uLightGain!, meta.lightGain);
    gl.uniform3fv(u.uRim!, meta.rimColor);
    gl.uniform3fv(u.uShadowCol!, SHADOW);
    gl.uniform2f(u.uViewport!, canvas.width, canvas.height);

    // 1) Its shadow on the floor: multiplied once per pixel, thanks to the stencil.
    gl.uniform1i(u.uMode!, 2);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(SHADOW_BIT);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilFunc(gl.NOTEQUAL, SHADOW_BIT, SHADOW_BIT);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    this.drawParts(figure);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // 2) The body and 3) its outline, with a depth of their own. On the near
    // side the body also leaves a note of where it is, for the glass in front.
    if (near) {
      gl.stencilMask(NEAR_BODY);
      gl.stencilFunc(gl.ALWAYS, NEAR_BODY, NEAR_BODY);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    } else {
      gl.disable(gl.STENCIL_TEST);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.uniform1i(u.uMode!, 0);
    this.drawParts(figure);
    gl.cullFace(gl.FRONT);
    gl.uniform1i(u.uMode!, 1);
    // Ink of 1.9 cm of the character, never thinner than about 0.6 CSS pixels.
    const ratio = canvas.width / frame.view.lay.vw;
    const pixelsPerMetre = (cam.f * frame.view.lay.s * ratio) / figure.depth;
    gl.uniform1f(u.uOutlinePx!, clamp(0.019 * figure.k * pixelsPerMetre, 0.62 * ratio, 2.3 * ratio));
    this.drawParts(figure);
    gl.cullFace(gl.BACK);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
  }

  /** The body, and the pieces that are this character's: a braid, a cap, a moustache. */
  private drawParts(figure: FigureFrame): void {
    const { gl } = this;
    for (const [first, count] of figure.parts ?? this.plain) {
      // Indices are 16 bits each: the offset is in bytes.
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, first * 2);
    }
  }

  /** A square in the world with one of the shapes of the mark shader. */
  private drawMark(
    kind: number,
    centre: ArrayLike<number>,
    axisX: ArrayLike<number>,
    axisY: ArrayLike<number>,
    colour: ArrayLike<number>,
    a: number,
    b: number,
    multiply: boolean,
  ): void {
    const { gl } = this;
    const u = this.mark.uniforms;
    gl.useProgram(this.mark.program);
    gl.bindVertexArray(this.markVao);
    gl.uniformMatrix4fv(u.uVP!, false, this.vp);
    gl.uniform3fv(u.uC!, centre as Float32Array);
    gl.uniform3fv(u.uAx!, axisX as Float32Array);
    gl.uniform3fv(u.uAy!, axisY as Float32Array);
    gl.uniform1i(u.uKind!, kind);
    gl.uniform4fv(u.uCol!, colour as Float32Array);
    gl.uniform1f(u.uA!, a);
    gl.uniform1f(u.uB!, b);
    if (multiply) gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (multiply) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private set(v: Float32Array, x: number, y: number, z: number): Float32Array {
    v[0] = x;
    v[1] = y;
    v[2] = z;
    return v;
  }

  /** Radius the ball is drawn with at a point: its real one would be a dot, so it never goes below a few pixels. */
  private ballRadius(frame: StageFrame, x: number, y: number, z: number): number {
    const cam = frame.view.cam;
    cam.project(x, y, z, this.seen);
    const pixelsPerMetre = (cam.f * frame.view.lay.s) / this.seen.d;
    return Math.max(0.085, 3.3 / pixelsPerMetre);
  }

  private drawBall(ball: BallFrame, frame: StageFrame): void {
    if (!ball.visible) return;
    const cam = frame.view.cam;
    const r = this.ballRadius(frame, ball.x, ball.y, ball.z);

    // Its shadow tells how high it is: right under it, smaller and fainter the
    // higher the ball. It leans away from the sun like every other shadow of
    // the court, but stays anchored under the ball, which is what it is for.
    const h = ball.z;
    const size = r * (1.5 + h * 0.1);
    const awayX = -SUN[0];
    const awayY = -SUN[1];
    const flat = Math.hypot(awayX, awayY);
    const ax = awayX / flat;
    const ay = awayY / flat;
    const stretch = 1.55;
    const offset = size * (stretch - 1);
    this.drawMark(
      MARK.shadow,
      this.set(this.v0, ball.x + ax * offset, ball.y + ay * offset, 0.014),
      this.set(this.v1, ax * size * stretch, ay * size * stretch, 0),
      this.set(this.v2, -ay * size * 0.9, ax * size * 0.9, 0),
      [0.5, 0.46, 0.72, 1],
      clamp(0.85 - h * 0.11, 0.25, 0.85),
      0,
      true,
    );

    // A short trail: it makes fast shots readable.
    for (let i = ball.trailCount - 1; i >= 0; i--) {
      const k = 1 - (i + 1) / (ball.trailCount + 1);
      this.drawMark(
        MARK.glow,
        this.set(this.v0, ball.trail[i * 3]!, ball.trail[i * 3 + 1]!, ball.trail[i * 3 + 2]!),
        this.set(this.v1, cam.right[0] * r * k, cam.right[1] * r * k, 0),
        this.set(this.v2, cam.up[0] * r * k, cam.up[1] * r * k, cam.up[2] * r * k),
        [0.95, 1.0, 0.6, 1],
        0.5 * k,
        1,
        false,
      );
    }

    this.drawMark(
      MARK.ball,
      this.set(this.v0, ball.x, ball.y, ball.z),
      this.set(this.v1, cam.right[0] * r, cam.right[1] * r, 0),
      this.set(this.v2, cam.up[0] * r, cam.up[1] * r, cam.up[2] * r),
      [1, 1, 1, 1],
      1,
      0,
      false,
    );
  }

  /** Impacts: small and short, no rings. A sparkle on the hit, a little dust on the bounce, a glint on the glass. */
  private drawEffect(effect: EffectFrame, frame: StageFrame): void {
    const cam = frame.view.cam;
    const u = effect.age;
    if (effect.kind === 'hit') {
      const r = (0.3 + 0.22 * u) * (effect.strong ? 1.35 : 1);
      this.drawMark(
        MARK.sparkle,
        this.set(this.v0, effect.x, effect.y, effect.z),
        this.set(this.v1, cam.right[0] * r, cam.right[1] * r, 0),
        this.set(this.v2, cam.up[0] * r, cam.up[1] * r, cam.up[2] * r),
        CREAM,
        (effect.strong ? 1 : 0.8) * (1 - u) * (1 - u),
        0,
        false,
      );
    } else if (effect.kind === 'bounce') {
      const r = 0.14 + 0.3 * u;
      this.drawMark(MARK.glow, this.set(this.v0, effect.x, effect.y, 0.02), this.set(this.v1, r, 0, 0), this.set(this.v2, 0, r, 0), CREAM, 0.5 * (1 - u), 0, false);
    } else {
      // On a side wall the glint lies along the court; on a back wall, across it.
      const side = Math.abs(effect.x) > 4.8;
      const w = 0.4 + 0.3 * u;
      this.drawMark(
        MARK.glow,
        this.set(this.v0, effect.x, effect.y, effect.z),
        side ? this.set(this.v1, 0, w, 0) : this.set(this.v1, w, 0, 0),
        this.set(this.v2, 0, 0, 0.55 + 0.3 * u),
        CREAM,
        0.6 * (1 - u),
        0,
        false,
      );
    }
  }

  /**
   * A thin, small ring with a dot, lying on the floor. Small and thin, but
   * never so much that it cannot be seen: at the far end a ring of a third of
   * a metre would be a line thinner than a pixel.
   */
  private drawRing(mark: MarkFrame, frame: StageFrame): void {
    const colour = mark.tone === 'coral' ? CORAL : CREAM;
    const cam = frame.view.cam;
    cam.project(mark.x, mark.y, 0, this.seen);
    // CSS pixels a metre takes there, and how much a circle on the floor is squashed seen from the camera.
    const perMetre = (cam.f * frame.view.lay.s) / this.seen.d;
    const squash = cam.pos[2] / Math.hypot(mark.x - cam.pos[0], mark.y - cam.pos[1], cam.pos[2]);
    const r = Math.max(mark.radius, MARK_MIN_RADIUS / perMetre);
    const thick = (size: number, least: number): number => clamp(MARK_MIN_LINE / (size * perMetre * squash), least, 0.5);
    if (mark.halo > 0) {
      const halo = r * (1.5 + mark.halo * 1.7);
      this.drawMark(MARK.glow, this.set(this.v0, mark.x, mark.y, 0.018), this.set(this.v1, halo, 0, 0), this.set(this.v2, 0, halo, 0), colour, 0.22 * mark.alpha, 0, false);
    }
    this.drawMark(MARK.ring, this.set(this.v0, mark.x, mark.y, 0.02), this.set(this.v1, r, 0, 0), this.set(this.v2, 0, r, 0), colour, mark.alpha, thick(r, 0.16), false);
    if (mark.double) {
      const outer = r * 1.5;
      this.drawMark(MARK.ring, this.set(this.v0, mark.x, mark.y, 0.02), this.set(this.v1, outer, 0, 0), this.set(this.v2, 0, outer, 0), colour, mark.alpha * 0.7, thick(outer, 0.1), false);
    }
  }

  /** For those who ask for every aid: a ring under their player and two footprints where it would be best to stand. */
  private drawExtras(frame: StageFrame, near: boolean): void {
    const ring = frame.ring;
    if (ring && (ring.y <= 0) === near) {
      const r = 0.58 * ring.k;
      this.drawMark(MARK.ring, this.set(this.v0, ring.x, ring.y, 0.016), this.set(this.v1, r, 0, 0), this.set(this.v2, 0, r, 0), CREAM, 0.55, 0.07, false);
    }
    const guide = frame.guide;
    if (guide && (guide.y <= 0) === near) {
      for (const side of [-1, 1]) {
        this.drawMark(MARK.glow, this.set(this.v0, guide.x + side * 0.17, guide.y, 0.016), this.set(this.v1, 0.11, 0, 0), this.set(this.v2, 0, 0.2, 0), CREAM, 0.6, 1, false);
      }
    }
  }

  /** The timing signal: the ball lights up in the last instant. Over the character, since at contact the racket hides the ball. */
  private drawGlow(ball: BallFrame, frame: StageFrame): void {
    if (!(ball.glow > 0) || !ball.visible) return;
    const cam = frame.view.cam;
    const g = this.ballRadius(frame, ball.x, ball.y, ball.z) * (2.0 + 1.2 * ball.glow);
    this.drawMark(
      MARK.glow,
      this.set(this.v0, ball.x, ball.y, ball.z),
      this.set(this.v1, cam.right[0] * g, cam.right[1] * g, 0),
      this.set(this.v2, cam.up[0] * g, cam.up[1] * g, cam.up[2] * g),
      [1.0, 0.98, 0.8, 1],
      0.6 * ball.glow,
      0,
      false,
    );
  }

  /** One side of the net, far to near, with the ball in its place among the players. */
  private drawSide(frame: StageFrame, near: boolean): void {
    const ball = frame.ball;
    const ballHere = ball.visible && (near ? ball.y <= 0 : ball.y > 0);
    let ballDrawn = !ballHere;
    // Whoever is on this side, from the far end toward the camera. They are one or two.
    const order = this.order;
    order.length = 0;
    for (const figure of frame.figures) {
      if ((figure.y <= 0) !== near) continue;
      let at = order.length;
      while (at > 0 && order[at - 1]!.y < figure.y) at--;
      order.splice(at, 0, figure);
    }
    for (const figure of order) {
      if (!ballDrawn && ballBehind(ball.y, figure)) {
        this.drawBall(ball, frame);
        ballDrawn = true;
      }
      this.drawFigure(figure, frame, near);
    }
    if (!ballDrawn) this.drawBall(ball, frame);
  }

  // ---------------------------------------------------------------- frame

  draw(frame: StageFrame): void {
    const { gl, canvas } = this;
    frame.view.viewProjection(this.vp);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    gl.clearColor(0.16, 0.12, 0.2, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);

    this.drawBackground(frame);

    const effects = frame.effects;
    // The far half: marks on its floor, then whoever is there, then the sparkle of their hits.
    if (frame.aim && frame.aim.y > 0) this.drawRing(frame.aim, frame);
    if (frame.bounce && frame.bounce.y > 0) this.drawRing(frame.bounce, frame);
    for (const effect of effects) if (effect.y > 0 && effect.kind !== 'hit') this.drawEffect(effect, frame);
    this.drawExtras(frame, false);
    this.drawSide(frame, false);
    for (const effect of effects) if (effect.y > 0 && effect.kind === 'hit') this.drawEffect(effect, frame);

    this.drawLayer('red');

    if (frame.aim && frame.aim.y <= 0) this.drawRing(frame.aim, frame);
    if (frame.bounce && frame.bounce.y <= 0) this.drawRing(frame.bounce, frame);
    for (const effect of effects) if (effect.y <= 0 && effect.kind !== 'hit') this.drawEffect(effect, frame);
    this.drawExtras(frame, true);
    this.drawSide(frame, true);
    for (const effect of effects) if (effect.y <= 0 && effect.kind === 'hit') this.drawEffect(effect, frame);
    this.drawGlow(frame.ball, frame);

    // The glass of the near wall is in front of the player. Its reflections
    // are kept off whoever stands behind it: there it is drawn much fainter.
    gl.enable(gl.STENCIL_TEST);
    gl.stencilMask(0);
    gl.stencilFunc(gl.NOTEQUAL, NEAR_BODY, NEAR_BODY);
    this.drawLayer('cerca', NEAR_WALL_ALPHA);
    gl.stencilFunc(gl.EQUAL, NEAR_BODY, NEAR_BODY);
    this.drawLayer('cerca', NEAR_WALL_ALPHA * 0.25);
    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0xff);
    this.drawLayer('frente');
  }
}

