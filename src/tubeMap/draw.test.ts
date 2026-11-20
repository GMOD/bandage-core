import fs from 'fs'
import path from 'path'

import { parseGaf } from '../gaf/parseGaf'
import { parseGFA } from '../gfa-core/index'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { tubeMapLayout } from '../layout/tubeMapLayout'
import { anchorGraph } from '../pathAnchoring'
import {
  drawTubeMap,
  drawTubeMapHighlight,
  parsePath,
  trackColors,
  tubeMapMismatchAt,
  tubeMapPicture,
  tubeMapTrackAt,
} from './draw'
import { FORWARD_READ_COLORS, REVERSE_READ_COLORS } from './reads'

import type { TubeMapPicture } from './draw'

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
  const over =
    (px: number, py: number) =>
    (r: NonNullable<typeof reads>['rects'][number]) =>
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

test('a tag-anchored graph draws the walk its rank 0 segments name as the reference', () => {
  const nodes = ['1', '2', '3'].map((id, i) => ({
    id,
    name: id,
    length: 4,
    depth: 1,
    stable: { refName: 'ref#1#chr', start: i * 4, rank: i === 1 ? 1 : 0 },
  }))
  const tubeMap = tubeMapLayout({
    name: 'tagged',
    nodes,
    edges: [],
    paths: [
      { name: 'alt#1#chr', nodeIds: ['1', '2', '3'] },
      { name: 'ref#1#chr:0-12', nodeIds: ['1', '3'] },
    ],
  })!.tubeMap!
  const [haplotypes] = tubeMapPicture(tubeMap).layers
  const ids = (reference: boolean) =>
    new Set(
      [...haplotypes!.rects, ...haplotypes!.shapes]
        .filter(s => s.reference === reference)
        .map(s => s.id),
    )
  expect(ids(true)).toEqual(new Set([1]))
  expect(ids(false)).toEqual(new Set([0]))
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
  const [start, top, down, bottom] = commands
  if (
    start?.op !== 'M' ||
    top?.op !== 'C' ||
    down?.op !== 'V' ||
    bottom?.op !== 'C'
  ) {
    throw new Error('not a ribbon')
  }
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
  const hits = curves.map(curve => {
    const [mx, my] = ribbonMiddle(curve.commands)
    const onRun = haplotypes!.rects.some(
      r => r.x0 <= mx && mx <= r.x1 && r.y0 <= my && my <= r.y1,
    )
    return { curve, onRun, hit: tubeMapTrackAt(picture, identity, mx, my) }
  })
  for (const { curve, hit } of hits.filter(h => h.curve.reference)) {
    expect(hit).toBe(curve.id)
  }
  expect(
    hits.filter(h => !h.onRun && h.hit !== undefined).length,
  ).toBeGreaterThan(0)
  expect(tubeMapTrackAt(picture, identity, -1e6, -1e6)).toBeUndefined()
})

// every fill's colour, from a context that accepts any other call
function fillRecorder() {
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
  return { ctx, fills }
}

// Three tubes over one stretch, and a lane change over the middle of it
function crossing(
  haplotype: boolean,
  colors = ['#000001', '#000002', '#000001'],
): TubeMapPicture {
  const tube = (id: number, color: string) => ({
    id,
    color,
    haplotype,
    reference: false,
  })
  const outline: [number, number][] = [
    [4, 2],
    [8, 2],
    [8, 8],
    [4, 8],
  ]
  return {
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    layers: [
      {
        rects: colors.map((color, id) => ({
          ...tube(id, color),
          x0: 0,
          x1: 10,
          y0: 0,
          y1: 10,
        })),
        shapes: [
          {
            ...tube(colors.length, colors[0]!),
            x0: 4,
            x1: 8,
            commands: parsePath('M 4 2 L 8 2 L 8 8 L 4 8 Z'),
            outline,
          },
        ],
      },
    ],
    nodes: [],
    mismatches: [],
  }
}

test('where tubes of shared colours cross, the pointer names the one painted last', () => {
  const picture = crossing(false)
  const { ctx, fills } = fillRecorder()
  drawTubeMap(ctx, picture, { ...identity, width: 100 })
  // both runs of the first colour, then the second colour's over them, then
  // the lane change over every run
  expect(fills).toEqual(['#000001', '#000002', '#000001'])
  expect(tubeMapTrackAt(picture, identity, 1, 5)).toBe(1)
  expect(tubeMapTrackAt(picture, identity, 5, 5)).toBe(3)
})

test('a restyle changes no tube on top, nor the one the pointer names', () => {
  const picture = crossing(true, ['#000001', '#000002', '#000003'])
  const { ctx, fills } = fillRecorder()
  drawTubeMap(ctx, picture, {
    ...identity,
    width: 100,
    tubeColors: ['red', 'blue', 'red', 'blue'],
  })
  expect(fills).toEqual(['red', 'blue', 'red', 'blue'])
  expect(tubeMapTrackAt(picture, identity, 1, 5)).toBe(2)
  expect(tubeMapTrackAt(picture, identity, 5, 5)).toBe(3)
})

test('what is off screen changes no tube on top', () => {
  const picture = crossing(false)
  const [layer] = picture.layers
  const scrolledOff = { ...layer!.rects[0]!, x0: -50, x1: -40 }
  const scrolled = {
    ...picture,
    layers: [{ ...layer!, rects: [scrolledOff, ...layer!.rects.slice(1)] }],
  }
  const { ctx, fills } = fillRecorder()
  drawTubeMap(ctx, scrolled, { ...identity, width: 100 })
  expect(fills).toEqual(['#000001', '#000002', '#000001'])
  expect(tubeMapTrackAt(scrolled, identity, 1, 5)).toBe(1)
})
