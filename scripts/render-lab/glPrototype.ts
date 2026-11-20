// Scratch prototype: draws a RenderBatch with instanced WebGL2. Node strokes
// become one capsule instance per polyline segment, link curves one ribbon
// instance per cubic plus a disc at each end for the round cap. Geometry is
// uploaded once; a frame sets the transform and draws.
import type { RenderBatch, TransformUniform } from '../../src/renderer/types'

const CAPSULE_VS = `#version 300 es
in vec2 a;
in vec2 b;
in float hw;
in vec4 color;
uniform vec2 scale;
uniform vec2 translate;
uniform vec2 viewport;
uniform float dpr;
out vec2 pa;
out vec2 pb;
out float r;
out vec4 c;
void main() {
  vec2 A = a * scale + translate;
  vec2 B = b * scale + translate;
  r = hw * dpr;
  float pad = r + 1.0;
  vec2 d = B - A;
  float len = length(d);
  vec2 u = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-u.y, u.x);
  int id = gl_VertexID;
  float s = id < 2 ? -1.0 : 1.0;
  float t = id % 2 == 0 ? -1.0 : 1.0;
  vec2 p = (s < 0.0 ? A - u * pad : B + u * pad) + n * pad * t;
  pa = A;
  pb = B;
  c = color;
  gl_Position = vec4(p / viewport * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`

const CAPSULE_FS = `#version 300 es
precision highp float;
in vec2 pa;
in vec2 pb;
in float r;
in vec4 c;
uniform vec2 viewport;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, viewport.y - gl_FragCoord.y);
  vec2 ab = pb - pa;
  float h = dot(ab, ab) > 0.0 ? clamp(dot(p - pa, ab) / dot(ab, ab), 0.0, 1.0) : 0.0;
  float d = length(p - pa - ab * h);
  float cov = clamp(r + 0.5 - d, 0.0, 1.0);
  if (cov <= 0.0) discard;
  o = vec4(c.rgb * c.a, c.a) * cov;
}`

const SEGMENTS = 16

const RIBBON_VS = `#version 300 es
in vec4 p01;
in vec4 c01;
in float hw;
in vec4 color;
uniform vec2 scale;
uniform vec2 translate;
uniform vec2 viewport;
uniform float dpr;
out float across;
out float r;
out vec4 c;
vec2 at(float t, vec2 P0, vec2 C0, vec2 C1, vec2 P1) {
  float m = 1.0 - t;
  return m * m * m * P0 + 3.0 * m * m * t * C0 + 3.0 * m * t * t * C1 + t * t * t * P1;
}
void main() {
  vec2 P0 = p01.xy * scale + translate;
  vec2 P1 = p01.zw * scale + translate;
  vec2 C0 = c01.xy * scale + translate;
  vec2 C1 = c01.zw * scale + translate;
  int i = gl_VertexID / 2;
  float side = (gl_VertexID % 2 == 0) ? -1.0 : 1.0;
  float t = float(i) / float(${SEGMENTS});
  vec2 p = at(t, P0, C0, C1, P1);
  vec2 q = at(min(t + 0.01, 1.0), P0, C0, C1, P1) - at(max(t - 0.01, 0.0), P0, C0, C1, P1);
  float len = length(q);
  vec2 n = len > 1e-6 ? vec2(-q.y, q.x) / len : vec2(0.0);
  r = hw * dpr;
  float pad = r + 1.0;
  across = side * pad;
  c = color;
  vec2 v = p + n * across;
  gl_Position = vec4(v / viewport * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`

const RIBBON_FS = `#version 300 es
precision highp float;
in float across;
in float r;
in vec4 c;
out vec4 o;
void main() {
  float cov = clamp(r + 0.5 - abs(across), 0.0, 1.0);
  if (cov <= 0.0) discard;
  o = vec4(c.rgb * c.a, c.a) * cov;
}`

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
    }
    gl.attachShader(p, s)
  }
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) ?? 'link')
  }
  return p
}

interface Layer {
  vao: WebGLVertexArrayObject
  count: number
  program: 'capsule' | 'ribbon'
}

export class GlRenderer {
  readonly gl: WebGL2RenderingContext
  private capsule: WebGLProgram
  private ribbon: WebGLProgram
  private layers: Layer[] = []
  private buffers: WebGLBuffer[] = []
  private t: TransformUniform | null = null
  private origin = { x: 0, y: 0 }
  bytes = 0
  layers_length() {
    return this.layers.length
  }
  uploadMs = 0
  instances = 0

  constructor(
    readonly canvas: HTMLCanvasElement,
    preserve = false,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: preserve,
    })
    if (!gl) {
      throw new Error('no webgl2')
    }
    this.gl = gl
    this.capsule = compile(gl, CAPSULE_VS, CAPSULE_FS)
    this.ribbon = compile(gl, RIBBON_VS, RIBBON_FS)
  }

  resize(width: number, height: number) {
    const dpr = Math.min(devicePixelRatio, 2)
    this.canvas.width = Math.round(width * dpr)
    this.canvas.height = Math.round(height * dpr)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
  }

  updateTransform(t: TransformUniform) {
    this.t = t
  }

  private instanced(
    program: WebGLProgram,
    floats: Float32Array,
    colors: Uint32Array,
    layout: [string, number][],
    count: number,
    kind: Layer['program'],
  ) {
    const gl = this.gl
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const stride = layout.reduce((a, [, n]) => a + n, 0) * 4
    const fbuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, fbuf)
    gl.bufferData(gl.ARRAY_BUFFER, floats, gl.STATIC_DRAW)
    let offset = 0
    for (const [name, n] of layout) {
      const loc = gl.getAttribLocation(program, name)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, offset)
      gl.vertexAttribDivisor(loc, 1)
      offset += n * 4
    }
    const cbuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, cbuf)
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW)
    const cl = gl.getAttribLocation(program, 'color')
    gl.enableVertexAttribArray(cl)
    gl.vertexAttribPointer(cl, 4, gl.UNSIGNED_BYTE, true, 4, 0)
    gl.vertexAttribDivisor(cl, 1)
    gl.bindVertexArray(null)
    this.buffers.push(fbuf, cbuf)
    this.bytes += floats.byteLength + colors.byteLength
    this.instances += count
    this.layers.push({ vao, count, program: kind })
  }

  uploadGeometry(batch: RenderBatch) {
    const t0 = performance.now()
    const gl = this.gl
    for (const b of this.buffers) gl.deleteBuffer(b)
    this.buffers = []
    this.layers = []
    this.bytes = 0
    this.instances = 0
    let minX = Infinity
    let minY = Infinity
    for (const s of batch.nodeStrokes) {
      for (const p of s.points) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
      }
    }
    this.origin = {
      x: Number.isFinite(minX) ? minX : 0,
      y: Number.isFinite(minY) ? minY : 0,
    }
    const ox = this.origin.x
    const oy = this.origin.y
    const capsules = (
      strokes: {
        points: { x: number; y: number }[]
        thickness: number
        color: number
      }[],
    ) => {
      let n = 0
      for (const s of strokes) n += Math.max(1, s.points.length - 1)
      const f = new Float32Array(n * 5)
      const c = new Uint32Array(n)
      let i = 0
      for (const s of strokes) {
        const pts = s.points
        const segs = Math.max(1, pts.length - 1)
        for (let k = 0; k < segs; k++) {
          const a = pts[k]!
          const b = pts[Math.min(k + 1, pts.length - 1)]!
          f.set([a.x - ox, a.y - oy, b.x - ox, b.y - oy, s.thickness], i * 5)
          c[i] = s.color >>> 0
          i++
        }
      }
      return { f, c, n }
    }
    const linkLayers = (curves: RenderBatch['edgeCurves']) => {
      let n = 0
      for (const e of curves) n += e.curves.length
      const f = new Float32Array(n * 9)
      const c = new Uint32Array(n)
      const ends: {
        points: { x: number; y: number }[]
        thickness: number
        color: number
      }[] = []
      let i = 0
      for (const e of curves) {
        for (const q of e.curves) {
          f.set(
            [
              q.x0 - ox,
              q.y0 - oy,
              q.x1 - ox,
              q.y1 - oy,
              q.cx0 - ox,
              q.cy0 - oy,
              q.cx1 - ox,
              q.cy1 - oy,
              e.thickness,
            ],
            i * 9,
          )
          c[i] = e.color >>> 0
          i++
        }
        const first = e.curves[0]!
        const last = e.curves.at(-1)!
        ends.push({
          points: [{ x: first.x0, y: first.y0 }],
          thickness: e.thickness,
          color: e.color,
        })
        ends.push({
          points: [{ x: last.x1, y: last.y1 }],
          thickness: e.thickness,
          color: e.color,
        })
      }
      if (n > 0) {
        this.instanced(
          this.ribbon,
          f,
          c,
          [
            ['p01', 4],
            ['c01', 4],
            ['hw', 1],
          ],
          n,
          'ribbon',
        )
        const caps = capsules(ends)
        this.instanced(
          this.capsule,
          caps.f,
          caps.c,
          [
            ['a', 2],
            ['b', 2],
            ['hw', 1],
          ],
          caps.n,
          'capsule',
        )
      }
    }
    const over = (e: RenderBatch['edgeCurves'][number]) =>
      e.skip === true || e.turn === true || e.along === true
    linkLayers(batch.edgeCurves.filter(e => !over(e)))
    const nodes = batch.nodeStrokes.toSorted(
      (a, b) =>
        Number(b.placeholder === true) - Number(a.placeholder === true) ||
        b.thickness - a.thickness,
    )
    const caps = capsules(nodes)
    if (caps.n > 0) {
      this.instanced(
        this.capsule,
        caps.f,
        caps.c,
        [
          ['a', 2],
          ['b', 2],
          ['hw', 1],
        ],
        caps.n,
        'capsule',
      )
    }
    linkLayers(batch.edgeCurves.filter(over))
    this.uploadMs = performance.now() - t0
  }

  render(clear: [number, number, number, number]) {
    const gl = this.gl
    const t = this.t
    if (!t) return
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(clear[0], clear[1], clear[2], clear[3])
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    const tx = t.translateX + this.origin.x * t.scaleX
    const ty = t.translateY + this.origin.y * t.scaleY
    for (const layer of this.layers) {
      const p = layer.program === 'capsule' ? this.capsule : this.ribbon
      gl.useProgram(p)
      gl.uniform2f(gl.getUniformLocation(p, 'scale'), t.scaleX, t.scaleY)
      gl.uniform2f(gl.getUniformLocation(p, 'translate'), tx, ty)
      gl.uniform2f(
        gl.getUniformLocation(p, 'viewport'),
        this.canvas.width,
        this.canvas.height,
      )
      gl.uniform1f(gl.getUniformLocation(p, 'dpr'), t.dpr)
      gl.bindVertexArray(layer.vao)
      gl.drawArraysInstanced(
        gl.TRIANGLE_STRIP,
        0,
        layer.program === 'capsule' ? 4 : 2 * (SEGMENTS + 1),
        layer.count,
      )
    }
    gl.bindVertexArray(null)
  }

  dispose() {
    for (const b of this.buffers) this.gl.deleteBuffer(b)
    this.buffers = []
    this.layers = []
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
