import { curvePaths, nodeOutlinePath } from '@jbrowse/tubemap-core'

import { tubeMapMismatches } from './mismatches'
import { readColor } from './reads'
import { MAX_GAP_PX } from './warp'
import { pathOrigin } from '../pathAnchoring'

import type { TubeMapTransform } from './frame'
import type { TubeMapMismatch } from './mismatches'
import type { TubeMapDrawing } from '../layout/tubeMapLayout'
import type { TrackType, TubeMapLayout } from '@jbrowse/tubemap-core'

// Paints a tube map layout on a 2D canvas, in the order sequenceTubeMap's d3
// drawing stacks it: haplotype tubes, their lane changes and turnarounds, then
// reads the same way, then the node boxes over all of them. Everything goes
// through `x` and `y`, tube coordinates to screen px, so the one painter serves
// the tube map's own axis (an affine map) and the reference axis (warp.ts).
//
// The package states curves, corners and node outlines as SVG path data. They
// are parsed once per layout into commands whose points can be mapped, since
// a Path2D built from the string could only be transformed affinely.

type Command =
  | { op: 'M' | 'L'; x: number; y: number }
  | { op: 'Q'; x1: number; y1: number; x: number; y: number }
  | {
      op: 'C'
      x1: number
      y1: number
      x2: number
      y2: number
      x: number
      y: number
    }
  | { op: 'H'; x: number }
  | { op: 'V'; y: number }
  | { op: 'Z' }

// The absolute M/L/H/V/Q/C/Z subset tubemap-core writes
export function parsePath(d: string): Command[] {
  const tokens = d.trim().split(/[\s,]+/)
  const commands: Command[] = []
  let i = 0
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    const op = tokens[i++]
    if (op === 'M' || op === 'L') {
      commands.push({ op, x: num(), y: num() })
    } else if (op === 'H') {
      commands.push({ op, x: num() })
    } else if (op === 'V') {
      commands.push({ op, y: num() })
    } else if (op === 'Q') {
      commands.push({ op, x1: num(), y1: num(), x: num(), y: num() })
    } else if (op === 'C') {
      commands.push({
        op,
        x1: num(),
        y1: num(),
        x2: num(),
        y2: num(),
        x: num(),
        y: num(),
      })
    } else if (op === 'Z') {
      commands.push({ op })
    }
  }
  return commands
}

interface Filled {
  color: string
  // the track's id: a haplotype's is its path's index in the graph
  id: number
  // a haplotype's fill is its path's, which a host may restyle (tubeColors)
  haplotype: boolean
  // filled last, so no tube crossing it can cut the line
  reference: boolean
  // tube x extent, for culling
  x0: number
  x1: number
}

interface Rect extends Filled {
  y0: number
  y1: number
}

interface Shape extends Filled {
  commands: Command[]
}

interface Layer {
  rects: Rect[]
  shapes: Shape[]
}

export interface TubeMapPicture {
  bounds: TubeMapLayout['bounds']
  layers: Layer[]
  nodes: { name: string; commands: Command[]; x0: number; x1: number }[]
  mismatches: TubeMapMismatch[]
}

function extentOf(commands: Command[]) {
  let x0 = Infinity
  let x1 = -Infinity
  for (const c of commands) {
    if ('x' in c) {
      x0 = Math.min(x0, c.x)
      x1 = Math.max(x1, c.x)
    }
    if ('x1' in c) {
      x0 = Math.min(x0, c.x1)
      x1 = Math.max(x1, c.x1)
    }
  }
  return { x0, x1 }
}

function shapeOf(
  d: string,
  color: string,
  id: number,
  haplotype: boolean,
  reference: boolean,
) {
  const commands = parsePath(d)
  return { commands, color, id, haplotype, reference, ...extentOf(commands) }
}

// Each track's fill by id: a read takes its strand's palette, a haplotype its
// path's colour
export function trackColors(
  layout: TubeMapLayout,
  pathColors: readonly string[],
): ReadonlyMap<number, string> {
  return new Map(
    layout.tracks.map(track => [
      track.id,
      track.type === 'read' ? readColor(track) : pathColors[track.id]!,
    ]),
  )
}

function layerOf(
  layout: TubeMapLayout,
  type: TrackType,
  colors: ReadonlyMap<number, string>,
  referenceIds: ReadonlySet<number>,
  gapWidth: number | undefined,
): Layer {
  const { shapes } = layout
  const haplotype = type === 'haplotype'
  const colorOf = (s: { id: number }) => colors.get(s.id)!
  const isReference = (s: { id: number }) => haplotype && referenceIds.has(s.id)
  const rects = [...shapes.rectangles, ...shapes.verticalRectangles]
    .filter(r => r.type === type)
    .map(r => ({
      color: colorOf(r),
      id: r.id,
      haplotype,
      reference: isReference(r),
      x0: r.xStart,
      x1: r.xEnd + 1,
      y0: r.yStart,
      y1: r.yEnd + 1,
    }))
  const curves = curvePaths(shapes.curves, type, { gapWidth }).map(c =>
    shapeOf(c.path!, colorOf(c), c.id, haplotype, isReference(c)),
  )
  const corners = shapes.corners
    .filter(c => c.type === type)
    .map(c => shapeOf(c.path, colorOf(c), c.id, haplotype, isReference(c)))
  return { rects, shapes: [...curves, ...corners] }
}

// The track ids of the reference's paths: a path's track id is its index
function referenceTrackIds(graph: TubeMapDrawing['graph'] | undefined) {
  const ids = new Set<number>()
  graph?.paths?.forEach((path, i) => {
    if (pathOrigin(path.name).name === graph.referencePath) {
      ids.add(i)
    }
  })
  return ids
}

// Everything a frame needs that does not depend on the transform
export function tubeMapPicture({
  layout,
  pathColors,
  graph,
  columns,
}: Pick<TubeMapDrawing, 'layout' | 'pathColors'> &
  Partial<Pick<TubeMapDrawing, 'graph' | 'columns'>>): TubeMapPicture {
  const colors = trackColors(layout, pathColors)
  const referenceIds = referenceTrackIds(graph)
  // the reference axis draws a gap at most this wide (warp.ts)
  const gapWidth = columns ? MAX_GAP_PX : undefined
  const nodes: TubeMapPicture['nodes'] = []
  layout.nodes.forEach(node => {
    if (node.order >= 0) {
      const commands = parsePath(nodeOutlinePath(node))
      nodes.push({ name: node.name, commands, ...extentOf(commands) })
    }
  })
  return {
    bounds: layout.bounds,
    layers: [
      layerOf(layout, 'haplotype', colors, referenceIds, gapWidth),
      layerOf(layout, 'read', colors, referenceIds, gapWidth),
    ],
    nodes,
    mismatches: tubeMapMismatches(layout).filter(
      m => m.kind !== 'insertion' || !m.softClip,
    ),
  }
}

function trace(
  ctx: CanvasRenderingContext2D,
  commands: Command[],
  x: (tx: number) => number,
  y: (ty: number) => number,
) {
  let cx = 0
  let cy = 0
  for (const c of commands) {
    switch (c.op) {
      case 'M':
        cx = c.x
        cy = c.y
        ctx.moveTo(x(cx), y(cy))
        break
      case 'L':
        cx = c.x
        cy = c.y
        ctx.lineTo(x(cx), y(cy))
        break
      case 'H':
        cx = c.x
        ctx.lineTo(x(cx), y(cy))
        break
      case 'V':
        cy = c.y
        ctx.lineTo(x(cx), y(cy))
        break
      case 'Q':
        cx = c.x
        cy = c.y
        ctx.quadraticCurveTo(x(c.x1), y(c.y1), x(cx), y(cy))
        break
      case 'C':
        cx = c.x
        cy = c.y
        ctx.bezierCurveTo(x(c.x1), y(c.y1), x(c.x2), y(c.y2), x(cx), y(cy))
        break
      case 'Z':
        ctx.closePath()
        break
    }
  }
}

export interface TubeMapFrame extends TubeMapTransform {
  width: number
  highlightNode?: string | null
  darkMode?: boolean
  // a haplotype tube's colour by track id, where it is not the layout's
  tubeColors?: readonly string[]
  // a box's tint by node name; a box with none is clear
  nodeColors?: ReadonlyMap<string, string>
}

// One fill per colour per layer, since a fill per shape costs a draw call
// each. Which of two crossing tubes covers the other is then the order of
// their colours, except that the reference goes over every other tube.
function fillByColor<T extends Filled>(
  ctx: CanvasRenderingContext2D,
  items: T[],
  visible: (item: T) => boolean,
  colorOf: (item: T) => string,
  addTo: (item: T) => void,
) {
  const byColor = new Map<string, T[]>()
  for (const item of items) {
    if (visible(item)) {
      const color = colorOf(item)
      const list = byColor.get(color)
      if (list) {
        list.push(item)
      } else {
        byColor.set(color, [item])
      }
    }
  }
  for (const list of byColor.values()) {
    ctx.fillStyle = colorOf(list[0]!)
    ctx.beginPath()
    for (const item of list) {
      addTo(item)
    }
    ctx.fill()
  }
}

// Zoomed out, a box is a few px of outline and a cut's boxes ink over the
// tubes between them, so an outline fades as its box narrows
const FULL_OUTLINE_PX = 12
const MIN_OUTLINE_ALPHA = 0.15

function outlineAlpha(screenWidth: number) {
  return Math.max(MIN_OUTLINE_ALPHA, Math.min(1, screenWidth / FULL_OUTLINE_PX))
}

// A tinted box lets the tubes through it show, as the clear box's wash does
const NODE_TINT_ALPHA = 0.55

export function drawTubeMap(
  ctx: CanvasRenderingContext2D,
  picture: TubeMapPicture,
  frame: TubeMapFrame,
) {
  const { x, y, width } = frame
  const visible = (item: { x0: number; x1: number }) =>
    x(item.x1) >= 0 && x(item.x0) <= width
  const colorOf = (item: Filled) =>
    (item.haplotype && frame.tubeColors?.[item.id]) || item.color
  ctx.globalAlpha = 1
  for (const layer of picture.layers) {
    for (const reference of [false, true]) {
      const inPass = (item: Filled) => item.reference === reference
      fillByColor(
        ctx,
        layer.rects,
        r => inPass(r) && visible(r),
        colorOf,
        r => {
          const left = x(r.x0)
          const top = y(r.y0)
          ctx.rect(left, top, x(r.x1) - left, y(r.y1) - top)
        },
      )
      fillByColor(
        ctx,
        layer.shapes,
        s => inPass(s) && visible(s),
        colorOf,
        s => {
          trace(ctx, s.commands, x, y)
        },
      )
    }
  }
  const stroke = frame.darkMode ? '#d0d0d0' : '#000000'
  const fill = frame.darkMode ? 'rgba(40,40,40,0.4)' : 'rgba(255,255,255,0.4)'
  ctx.lineWidth = outlineWidth(frame)
  for (const node of picture.nodes) {
    if (visible(node) && node.name !== frame.highlightNode) {
      ctx.beginPath()
      trace(ctx, node.commands, x, y)
      const tint = frame.nodeColors?.get(node.name)
      ctx.fillStyle = tint ?? fill
      ctx.strokeStyle = stroke
      ctx.globalAlpha = tint ? NODE_TINT_ALPHA : 1
      ctx.fill()
      ctx.globalAlpha = outlineAlpha(x(node.x1) - x(node.x0))
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
  drawTubeMapHighlight(ctx, picture, frame)
  drawMismatches(ctx, picture.mismatches, frame)
}

function outlineWidth(frame: TubeMapFrame) {
  return 2 * Math.max(0.25, Math.min(1, frame.yScale))
}

// The lit box alone, for a hover layer over a tube map drawn without it
export function drawTubeMapHighlight(
  ctx: CanvasRenderingContext2D,
  picture: TubeMapPicture,
  frame: TubeMapFrame,
) {
  const node = frame.highlightNode
    ? picture.nodes.find(n => n.name === frame.highlightNode)
    : undefined
  if (node) {
    ctx.beginPath()
    trace(ctx, node.commands, frame.x, frame.y)
    ctx.globalAlpha = 1
    ctx.lineWidth = outlineWidth(frame)
    ctx.fillStyle = 'rgba(255,192,203,0.5)'
    ctx.strokeStyle = '#ff0000'
    ctx.fill()
    ctx.stroke()
  }
}

// sequenceTubeMap's marks, which it draws at 12px and hides once zoomed out
// below half size
const MISMATCH_FONT_PX = 12
const MIN_MISMATCH_FONT_PX = 6

export function mismatchesLegible(yScale: number) {
  return MISMATCH_FONT_PX * yScale >= MIN_MISMATCH_FONT_PX
}

export function mismatchOnScreen(
  m: TubeMapMismatch,
  { x, width }: Pick<TubeMapFrame, 'x' | 'width'>,
) {
  const [x0, x1] = m.kind === 'insertion' ? [m.x, m.x] : [m.x0, m.x1]
  return x(x1) >= 0 && x(x0) <= width
}

function drawMismatches(
  ctx: CanvasRenderingContext2D,
  marks: readonly TubeMapMismatch[],
  frame: TubeMapFrame,
) {
  const { x, y, yScale, darkMode } = frame
  if (!mismatchesLegible(yScale) || marks.length === 0) {
    return
  }
  const fontPx = MISMATCH_FONT_PX * yScale
  ctx.fillStyle = 'grey'
  ctx.beginPath()
  for (const m of marks) {
    if (m.kind === 'deletion' && mismatchOnScreen(m, frame)) {
      const left = x(m.x0)
      const top = y(m.y)
      ctx.rect(left, top, x(m.x1) - left, y(m.y + m.height) - top)
    }
  }
  ctx.fill()
  ctx.font = `${fontPx}px monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = darkMode ? '#ffffff' : '#000000'
  for (const m of marks) {
    if (!mismatchOnScreen(m, frame)) {
      continue
    }
    if (m.kind === 'substitution') {
      ctx.fillText(m.seq, x(m.x0) + 1, y(m.y + m.height))
    } else if (m.kind === 'insertion') {
      ctx.fillText('*', x(m.x) - 3, y(m.y + m.height))
    }
  }
}

// A path's outline as screen points, its beziers flattened
function outline(
  commands: Command[],
  x: (tx: number) => number,
  y: (ty: number) => number,
) {
  const points: [number, number][] = []
  let cx = 0
  let cy = 0
  const STEPS = 12
  for (const c of commands) {
    if (c.op === 'C' || c.op === 'Q') {
      for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS
        const u = 1 - t
        const [px, py] =
          c.op === 'C'
            ? [
                u * u * u * cx +
                  3 * u * u * t * c.x1 +
                  3 * u * t * t * c.x2 +
                  t * t * t * c.x,
                u * u * u * cy +
                  3 * u * u * t * c.y1 +
                  3 * u * t * t * c.y2 +
                  t * t * t * c.y,
              ]
            : [
                u * u * cx + 2 * u * t * c.x1 + t * t * c.x,
                u * u * cy + 2 * u * t * c.y1 + t * t * c.y,
              ]
        points.push([x(px), y(py)])
      }
    }
    if (c.op !== 'Z') {
      cx = 'x' in c ? c.x : cx
      cy = 'y' in c ? c.y : cy
      if (c.op !== 'C' && c.op !== 'Q') {
        points.push([x(cx), y(cy)])
      }
    }
  }
  return points
}

function inside(points: [number, number][], sx: number, sy: number) {
  let hit = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!
    const [xj, yj] = points[j]!
    if (yi > sy !== yj > sy && sx < ((xj - xi) * (sy - yi)) / (yj - yi) + xi) {
      hit = !hit
    }
  }
  return hit
}

// The track whose tube is under a screen point, reads before haplotypes and
// the reference before other tubes, in the order they draw over each other.
// A curve is tested against its outline, not its bounds, since tubes cross
// between columns.
export function tubeMapTrackAt(
  picture: TubeMapPicture,
  { x, y }: TubeMapTransform,
  sx: number,
  sy: number,
) {
  for (let l = picture.layers.length - 1; l >= 0; l--) {
    const { rects, shapes } = picture.layers[l]!
    for (const reference of [true, false]) {
      for (const r of rects) {
        if (
          r.reference === reference &&
          x(r.x0) <= sx &&
          sx <= x(r.x1) &&
          y(r.y0) <= sy &&
          sy <= y(r.y1)
        ) {
          return r.id
        }
      }
      for (const s of shapes) {
        if (
          s.reference === reference &&
          x(s.x0) <= sx &&
          sx <= x(s.x1) &&
          inside(outline(s.commands, x, y), sx, sy)
        ) {
          return s.id
        }
      }
    }
  }
  return undefined
}

// an insertion's star is a point, so the pointer gets a few px either side
const INSERTION_SLOP_PX = 4

// The mismatch mark under a screen point, while the marks are drawn
export function tubeMapMismatchAt(
  picture: TubeMapPicture,
  frame: TubeMapTransform,
  sx: number,
  sy: number,
) {
  const { x, y, yScale } = frame
  return mismatchesLegible(yScale)
    ? picture.mismatches.find(
        m =>
          y(m.y) <= sy &&
          sy <= y(m.y + m.height) &&
          (m.kind === 'insertion'
            ? Math.abs(x(m.x) - sx) <= INSERTION_SLOP_PX
            : x(m.x0) <= sx && sx <= x(m.x1)),
      )
    : undefined
}
