import { Canvas2DRenderer } from '../../src/renderer/Canvas2DRenderer'
import { GlRenderer } from './glPrototype'

import type { RenderBatch, TransformUniform } from '../../src/renderer/types'

const W = 1280
const H = 800

type Painter = 'canvas' | 'gl'

interface Scene {
  batch: RenderBatch
  nodes: number
  scale: number
  sy?: number
  tx: number
  ty: number
}

const scenes = new Map<string, Scene>()

async function sceneOf(name: string) {
  const cached = scenes.get(name)
  const scene =
    cached ??
    (JSON.parse(await (await fetch(`/${name}.json`)).text(), (_k, v) =>
      v && typeof v === 'object' && '__map' in v
        ? new Map(v.__map)
        : v && typeof v === 'object' && '__set' in v
          ? new Set(v.__set)
          : v,
    ) as Scene)
  scenes.set(name, scene)
  return scene
}

// a one-pixel pan every frame, so no frame repeats the last
function transformOf(s: Scene, dpr: number, f: number): TransformUniform {
  return {
    scaleX: s.scale * dpr,
    scaleY: (s.sy ?? s.scale) * dpr,
    translateX: (s.tx + (f % 2)) * dpr,
    translateY: s.ty * dpr,
    dpr,
  }
}

function freshCanvas() {
  document.body.innerHTML = ''
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  return canvas
}

function painterOf(painter: Painter, canvas: HTMLCanvasElement, s: Scene) {
  const r =
    painter === 'gl'
      ? new GlRenderer(canvas, true)
      : new Canvas2DRenderer(canvas)
  r.resize(W, H)
  const t0 = performance.now()
  r.uploadGeometry(s.batch)
  return { r, uploadMs: performance.now() - t0 }
}

const median = (a: number[]) =>
  a.toSorted((x, y) => x - y)[Math.floor(a.length / 2)] ?? Number.NaN
const nextFrame = () =>
  new Promise<number>(resolve => requestAnimationFrame(resolve))

// Frames as a user sees them: each painter repaints on every animation frame
// for `per` frames, `rounds` times, interleaved with the others
export async function raf(
  name: string,
  painters: Painter[],
  rounds = 3,
  per = 20,
) {
  const s = await sceneOf(name)
  const dpr = Math.min(devicePixelRatio, 2)
  const idle: number[] = []
  let last = await nextFrame()
  for (let i = 0; i < 30; i++) {
    const now = await nextFrame()
    idle.push(now - last)
    last = now
  }
  const vsync = median(idle)
  const stats = painters.map(painter => ({
    painter,
    frame: [] as number[],
    upload: [] as number[],
    span: 0,
    frames: 0,
  }))
  let f = 0
  for (let round = 0; round < rounds; round++) {
    for (let k = 0; k < stats.length; k++) {
      const x = stats[(k + round) % stats.length]!
      const { r, uploadMs } = painterOf(x.painter, freshCanvas(), s)
      x.upload.push(uploadMs)
      r.updateTransform(transformOf(s, dpr, f))
      r.render([1, 1, 1, 1])
      await nextFrame()
      let prev = await nextFrame()
      const start = prev
      for (let i = 0; i < per; i++) {
        r.updateTransform(transformOf(s, dpr, f++))
        r.render([1, 1, 1, 1])
        const now = await nextFrame()
        x.frame.push(now - prev)
        prev = now
      }
      x.span += prev - start
      x.frames += per
      r.dispose()
    }
  }
  return stats.map(x => ({
    scene: name,
    nodes: s.nodes,
    painter: x.painter,
    vsyncMs: vsync,
    frameMs: median(x.frame),
    fps: (1000 * x.frames) / x.span,
    droppedPerFrame:
      x.frame.reduce((a, d) => a + Math.max(0, Math.round(d / vsync) - 1), 0) /
      x.frames,
    uploadMs: median(x.upload),
  }))
}

// Pixels each painter draws differently from the first, and a PNG of each
export async function diff(name: string, painters: Painter[]) {
  const s = await sceneOf(name)
  const dpr = Math.min(devicePixelRatio, 2)
  document.body.innerHTML = ''
  const shots = painters.map(painter => {
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    if (painter === 'canvas') {
      canvas.getContext('2d', { willReadFrequently: true })
    }
    const { r } = painterOf(painter, canvas, s)
    r.updateTransform(transformOf(s, dpr, 0))
    r.render([1, 1, 1, 1])
    const png = canvas.toDataURL('image/png')
    if (r instanceof GlRenderer) {
      const { gl } = r
      const w = canvas.width
      const h = canvas.height
      const raw = new Uint8Array(w * h * 4)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw)
      const data = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++) {
        data.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4)
      }
      return { painter, data, png }
    }
    const ctx = canvas.getContext('2d')!
    return {
      painter,
      data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      png,
    }
  })
  const base = shots[0]!.data
  return shots.map(({ painter, data, png }) => {
    let differ = 0
    let big = 0
    for (let i = 0; i < data.length; i += 4) {
      const d = Math.max(
        Math.abs(data[i]! - base[i]!),
        Math.abs(data[i + 1]! - base[i + 1]!),
        Math.abs(data[i + 2]! - base[i + 2]!),
      )
      differ += d > 0 ? 1 : 0
      big += d > 32 ? 1 : 0
    }
    return { scene: name, painter, differ, big, png }
  })
}

Object.assign(window, { raf, diff })
