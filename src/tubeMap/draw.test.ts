import fs from 'fs'
import path from 'path'

import {
  drawTubeMap,
  drawTubeMapHighlight,
  trackColors,
  tubeMapMismatchAt,
  tubeMapPicture,
  tubeMapTrackAt,
} from './draw'
import { FORWARD_READ_COLORS, REVERSE_READ_COLORS } from './reads'
import { parseGaf } from '../gaf/parseGaf'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { tubeMapLayout } from '../layout/tubeMapLayout'
import { anchorGraph } from '../pathAnchoring'

import type { parsePath } from './draw'

const dir = path.join(__dirname, '../../test_data/cactus')
const GFA = fs.readFileSync(path.join(dir, 'cactus_240_280.gfa'), 'utf8')
const GAF = fs.readFileSync(path.join(dir, 'cactus_240_280.gaf'), 'utf8')

function drawing() {
  const graph = anchorGraph(convertGFAToGraph(parseGFA(GFA)), 'ref')
  return tubeMapLayout({ ...graph, reads: parseGaf(GAF) })!.tubeMap!
}

test('a haplotype takes its path colour and a read its strand palette', () => {
  const { layout, pathColors } = drawing()
  const colors = trackColors(layout, pathColors)
  for (const track of layout.tracks) {
    const palette = track.is_reverse ? REVERSE_READ_COLORS : FORWARD_READ_COLORS
    expect(colors.get(track.id)).toBe(
      track.type === 'read'
        ? palette[track.id % palette.length]
        : pathColors[track.id],
    )
  }
})

test('every shape is filled from the colour of the track it names', () => {
  const tubeMap = {
    ...drawing(),
    pathColors: ['#000001', '#000002', '#000003'],
  }
  const { layout } = tubeMap
  const colors = trackColors(layout, tubeMap.pathColors)
  const [haplotypes, reads] = tubeMapPicture(tubeMap).layers
  const fills = (type: string) =>
    [...layout.shapes.rectangles, ...layout.shapes.verticalRectangles]
      .filter(r => r.type === type)
      .map(r => colors.get(r.id))
  expect(haplotypes!.rects.map(r => r.color)).toEqual(fills('haplotype'))
  expect(reads!.rects.map(r => r.color)).toEqual(fills('read'))
  expect(haplotypes!.shapes.length).toBeGreaterThan(0)
  for (const shape of haplotypes!.shapes) {
    expect(shape.color).toBe(tubeMap.pathColors[shape.id])
  }
  const readPalette = [...FORWARD_READ_COLORS, ...REVERSE_READ_COLORS]
  expect(reads!.shapes.length).toBeGreaterThan(0)
  for (const shape of reads!.shapes) {
    expect(readPalette).toContain(shape.color)
  }
})

const identity = { x: (t: number) => t, y: (t: number) => t, yScale: 1 }

function middle(r: { x0: number; x1: number; y0: number; y1: number }) {
  return [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2] as const
}

test('the pointer names the tube it is over, a read before the tube under it', () => {
  const picture = tubeMapPicture(drawing())
  const [haplotypes, reads] = picture.layers
  const over = (px: number, py: number) => (r: (typeof reads.rects)[number]) =>
    r.x0 <= px && px <= r.x1 && r.y0 <= py && py <= r.y1
  const [rx, ry] = middle(reads!.rects[0]!)
  const read = tubeMapTrackAt(picture, identity, rx, ry)
  expect(reads!.rects.some(r => r.id === read && over(rx, ry)(r))).toBe(true)
  const tube = haplotypes!.rects.find(
    h => !reads!.rects.some(over(...middle(h))),
  )!
  expect(tubeMapTrackAt(picture, identity, ...middle(tube))).toBe(tube.id)
  expect(tubeMapTrackAt(picture, identity, -1e6, -1e6)).toBeUndefined()
})

test('the pointer finds a mismatch mark while the marks are drawn', () => {
  const picture = tubeMapPicture(drawing())
  const mark = picture.mismatches.find(m => m.kind === 'substitution')!
  expect(mark).toBeDefined()
  const at = [(mark.x0 + mark.x1) / 2, mark.y + mark.height / 2] as const
  expect(tubeMapMismatchAt(picture, identity, ...at)).toMatchObject({
    kind: 'substitution',
    readId: mark.readId,
  })
  const squeezed = { ...identity, yScale: 0.1 }
  expect(tubeMapMismatchAt(picture, squeezed, ...at)).toBeUndefined()
})

// every stroke's colour, from a context that accepts any other call
function strokeRecorder() {
  const strokes: string[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get: (target, key: string) =>
      key === 'stroke'
        ? () => strokes.push(String(target.strokeStyle))
        : key in target
          ? target[key]
          : () => {},
    set: (target, key: string, value) => {
      target[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, strokes }
}

test('a hover layer outlines the lit box alone, as the full drawing does', () => {
  const picture = tubeMapPicture(drawing())
  const frame = {
    ...identity,
    width: 1e6,
    highlightNode: picture.nodes[0]!.name,
  }
  const full = strokeRecorder()
  drawTubeMap(full.ctx, picture, frame)
  expect(full.strokes.filter(s => s === '#ff0000')).toHaveLength(1)
  expect(full.strokes).toHaveLength(picture.nodes.length)

  const layer = strokeRecorder()
  drawTubeMapHighlight(layer.ctx, picture, frame)
  expect(layer.strokes).toEqual(['#ff0000'])
  drawTubeMapHighlight(layer.ctx, picture, { ...frame, highlightNode: null })
  expect(layer.strokes).toHaveLength(1)
})

test('the reference fills last, over any tube that crosses it', () => {
  const tubeMap = drawing()
  const { paths, referencePath } = tubeMap.graph
  const pathColors = paths!.map((_, i) => `#00000${i + 1}`)
  const reference = pathColors[paths!.findIndex(p => p.name === referencePath)]!
  const fills: string[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get: (target, key: string) =>
      key === 'fill'
        ? () => fills.push(String(target.fillStyle))
        : key in target
          ? target[key]
          : () => {},
    set: (target, key: string, value) => {
      target[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  const picture = tubeMapPicture({ ...tubeMap, pathColors })
  drawTubeMap(ctx, picture, { ...identity, width: 1e6 })
  const tubes = fills.filter(f => pathColors.includes(f))
  expect(new Set(tubes).size).toBeGreaterThan(1)
  const first = tubes.indexOf(reference)
  expect(first).toBeGreaterThan(0)
  expect(tubes.slice(first).every(f => f === reference)).toBe(true)
})

interface Cubic {
  x1: number
  y1: number
  x2: number
  y2: number
  x: number
  y: number
}

const cubicMiddle = (x0: number, y0: number, c: Cubic) => [
  (x0 + 3 * c.x1 + 3 * c.x2 + c.x) / 8,
  (y0 + 3 * c.y1 + 3 * c.y2 + c.y) / 8,
]

// A ribbon is M, its top edge, V down its far end, its bottom edge back, Z;
// this is halfway between its edges' midpoints
function ribbonMiddle(commands: ReturnType<typeof parsePath>) {
  const [start, top, down, bottom] = commands as [
    { x: number; y: number },
    Cubic,
    { y: number },
    Cubic,
  ]
  const [tx, ty] = cubicMiddle(start.x, start.y, top)
  const [bx, by] = cubicMiddle(top.x, down.y, bottom)
  return [(tx! + bx!) / 2, (ty! + by!) / 2] as const
}

test('the pointer names the tube on a lane change, the reference over the rest', () => {
  const picture = tubeMapPicture(drawing())
  const [haplotypes] = picture.layers
  const curves = haplotypes!.shapes.filter(
    s => s.commands.length === 5 && s.commands[1]!.op === 'C',
  )
  expect(curves.length).toBeGreaterThan(0)
  let named = 0
  for (const curve of curves) {
    const [mx, my] = ribbonMiddle(curve.commands)
    const onRun = haplotypes!.rects.some(
      r => r.x0 <= mx && mx <= r.x1 && r.y0 <= my && my <= r.y1,
    )
    const hit = tubeMapTrackAt(picture, identity, mx, my)
    if (!onRun && hit !== undefined) {
      named++
    }
    if (curve.reference) {
      expect(hit).toBe(curve.id)
    }
  }
  expect(named).toBeGreaterThan(0)
  expect(tubeMapTrackAt(picture, identity, -1e6, -1e6)).toBeUndefined()
})
