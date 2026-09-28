import { abgrToCssRgba } from '@jbrowse/core/util/colorBits'

import { isBackbone } from './anchoredNodes'
import {
  FADED_ALPHA,
  LIFT_BACKDROP_COLOR,
  computeColorSchemeRange,
  getNodeColor,
} from './renderer/GeometryBuilder'
import { fadeAbgr } from './renderer/colorBits'

import type { ResolvedColorScheme } from './colorSchemes'
import type { ReferenceRamp } from './renderer/GeometryBuilder'
import type { Graph, NodeSegment } from './types'

// A force or ordered drawing inside a linear view has no bp axis, so a strip
// along the top of the track draws each reference segment at its bp there, in
// the colour its node has in the graph below: the reference-position ramp's
// hue, or while walks are lifted a row per walk in its lane's colours, pale
// where that walk skips the segment. The strip leaves the linear view's
// gridlines showing, so each block reads as a feature at its bp, and while the
// blocks on screen are wide enough to read one by one, touching ones alternate
// between two tiers, as a feature track stacks features that would touch. A
// base-level cut splits the backbone at every SNP, and tiers there would be a
// barcode that reads as data, so it draws as one band. The lit node gets a leader from its span on the strip
// to where the graph drew it, as the variant matrix ties a column to its
// variant.

export const REFERENCE_STRIP_PX = 12
// the strip, and the gap under it the fit leaves the drawing
export const REFERENCE_STRIP_ZONE_PX = REFERENCE_STRIP_PX + 8
// a triangle at a strip end, in a cap cleared of the strip: reference the
// graph draws runs past that edge
const OVERHANG_PX = 8
const OVERHANG_CAP_PX = OVERHANG_PX + 3
// the average width, in css px, the blocks on screen need to be staggered
const MIN_STAGGER_PX = 12

export interface StripBlock {
  node: string
  bp0: number
  bp1: number
  // top to bottom: a row per lifted walk, else the node's own colour
  colors: string[]
  // pale on some row
  faded: boolean
}

const PALE = abgrToCssRgba(fadeAbgr(LIFT_BACKDROP_COLOR, FADED_ALPHA))

export function referenceStripBlocks(
  graph: Graph,
  {
    colorScheme,
    referenceRamp,
    walks,
  }: {
    colorScheme: ResolvedColorScheme
    referenceRamp?: ReferenceRamp
    // the lifted walks' lane colours at the nodes each visits
    walks?: readonly { colors: ReadonlyMap<string, number> }[]
  },
) {
  const range = { ...computeColorSchemeRange(graph), referenceRamp }
  const out: StripBlock[] = []
  graph.nodes.forEach((node, index) => {
    if (isBackbone(node)) {
      const colors = walks
        ? walks.map(w => {
            const lane = w.colors.get(node.id)
            return lane === undefined ? PALE : abgrToCssRgba(lane)
          })
        : [abgrToCssRgba(getNodeColor(node, index, colorScheme, range))]
      out.push({
        node: node.id,
        bp0: node.stable.start,
        bp1: node.stable.start + node.length,
        colors,
        faded: colors.includes(PALE),
      })
    }
  })
  return out.sort((a, b) => a.bp0 - b.bp0)
}

// bp to screen x, as the linear view places it; a reversed block's is negative
export interface BpFrame {
  scale: number
  translateX: number
}

function span(frame: BpFrame, bp0: number, bp1: number): [number, number] {
  const a = bp0 * frame.scale + frame.translateX
  const b = bp1 * frame.scale + frame.translateX
  return a < b ? [a, b] : [b, a]
}

// A SNP's block is a sliver, so the pointer gets a few px either side of one
const HIT_SLOP_PX = 2

// How much backbone the graph draws past each edge of the window, in bp
export function stripOverhang(
  blocks: readonly StripBlock[],
  frame: BpFrame,
  width: number,
) {
  const a = -frame.translateX / frame.scale
  const b = (width - frame.translateX) / frame.scale
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  let below = 0
  let above = 0
  for (const block of blocks) {
    below += Math.max(0, Math.min(block.bp1, lo) - block.bp0)
    above += Math.max(0, block.bp1 - Math.max(block.bp0, hi))
  }
  // a reversed window puts low bp on the right
  return frame.scale >= 0
    ? { left: Math.round(below), right: Math.round(above) }
    : { left: Math.round(above), right: Math.round(below) }
}

export function stripBlockAt(
  blocks: readonly StripBlock[],
  frame: BpFrame,
  sx: number,
  sy: number,
) {
  if (sy < 0 || sy > REFERENCE_STRIP_PX + HIT_SLOP_PX) {
    return undefined
  }
  let hit: string | undefined
  let best = HIT_SLOP_PX
  for (const b of blocks) {
    const [x0, x1] = span(frame, b.bp0, b.bp1)
    const dist = Math.max(0, x0 - sx, sx - x1)
    if (dist <= best) {
      best = dist
      hit = b.node
    }
  }
  return hit
}

// Where the graph drew a node, in screen px: the middle of its polyline
export function nodeAnchor(
  segments: readonly NodeSegment[] | undefined,
  toScreen: (p: NodeSegment) => { x: number; y: number },
) {
  const p = segments?.[Math.floor(segments.length / 2)]
  return p ? toScreen(p) : undefined
}

export interface StripLit {
  start: number
  end: number
  anchor?: { x: number; y: number }
}

// Each block in whole device pixels, left to right, none sharing a pixel.
// Fractional edges antialias: two opaque neighbours leave a pale seam between
// them and two faded ones a dark seam where they overlap, stripes that read
// as data. A block narrower than a pixel gets its pixel unless a block to its
// left already has it.
export interface StripPixel {
  colors: string[]
  x0: number
  x1: number
  // the tier a staggered strip draws the block in
  tier?: number
}

export function stripPixels(
  blocks: readonly StripBlock[],
  frame: BpFrame,
  width: number,
  dpr: number,
): StripPixel[] {
  const placed = blocks
    .map(b => {
      const [x0, x1] = span(frame, b.bp0, b.bp1)
      const px0 = Math.round(x0 * dpr)
      return {
        colors: b.colors,
        x0,
        px0,
        px1: Math.max(Math.round(x1 * dpr), px0 + 1),
      }
    })
    .filter(b => b.px1 > 0 && b.px0 < width * dpr)
    .sort((a, b) => a.x0 - b.x0)
  const out: StripPixel[] = []
  let claimed = -Infinity
  // where each tier's last block ends, in device px
  const tierEnds = [-Infinity, -Infinity]
  for (const { colors, px0, px1 } of placed) {
    const start = Math.max(px0, claimed)
    if (px1 > start) {
      const tier = tierEnds[0]! < start ? 0 : 1
      tierEnds[tier] = px1
      out.push({ colors, x0: start / dpr, x1: px1 / dpr, tier })
      claimed = px1
    }
  }
  const covered = out.length > 0 ? out.at(-1)!.x1 - out[0]!.x0 : 0
  return covered >= out.length * MIN_STAGGER_PX
    ? out
    : out.map(({ tier: _, ...b }) => b)
}

// A triangle the strip's height with its tip at the strip's edge, pointing
// off it, in a cap cleared of the strip; `inward` is +1 from the left edge and
// -1 from the right
function drawOverhang(
  ctx: CanvasRenderingContext2D,
  edgeX: number,
  inward: number,
  ink: string,
) {
  const capX = inward > 0 ? edgeX : edgeX - OVERHANG_CAP_PX
  ctx.clearRect(capX, 0, OVERHANG_CAP_PX, REFERENCE_STRIP_PX)
  const tipX = edgeX + inward
  const baseX = tipX + inward * OVERHANG_PX
  ctx.beginPath()
  ctx.moveTo(tipX, REFERENCE_STRIP_PX / 2)
  ctx.lineTo(baseX, 0)
  ctx.lineTo(baseX, REFERENCE_STRIP_PX)
  ctx.closePath()
  ctx.fillStyle = ink
  ctx.fill()
}

// Rows split the strip's height at whole device pixels, as blocks split its
// width
function rowEdge(row: number, rows: number, dpr: number) {
  return Math.round((row * REFERENCE_STRIP_PX * dpr) / rows) / dpr
}

export function drawReferenceStrip(
  ctx: CanvasRenderingContext2D,
  blocks: readonly StripBlock[],
  frame: BpFrame,
  {
    width,
    lit,
    darkMode,
    dpr = 1,
  }: {
    width: number
    lit?: StripLit
    darkMode?: boolean
    dpr?: number
  },
) {
  const ink = darkMode ? '#ffffff' : '#18181c'
  ctx.clearRect(0, 0, width, REFERENCE_STRIP_ZONE_PX)
  for (const b of stripPixels(blocks, frame, width, dpr)) {
    // a row per lifted walk, else the block's tier, else the whole strip
    const { tier } = b
    const staggered = tier !== undefined && b.colors.length === 1
    const rows = staggered ? 2 : b.colors.length
    b.colors.forEach((color, i) => {
      const row = staggered ? tier : i
      const y0 = rowEdge(row, rows, dpr)
      ctx.fillStyle = color
      ctx.fillRect(b.x0, y0, b.x1 - b.x0, rowEdge(row + 1, rows, dpr) - y0)
    })
  }
  const overhang = stripOverhang(blocks, frame, width)
  if (overhang.left > 0) {
    drawOverhang(ctx, 0, 1, ink)
  }
  if (overhang.right > 0) {
    drawOverhang(ctx, width, -1, ink)
  }
  if (lit) {
    const [x0, x1] = span(frame, lit.start, lit.end)
    const w = Math.max(x1 - x0, 3)
    const left = (x0 + x1) / 2 - w / 2
    ctx.strokeStyle = ink
    ctx.lineWidth = 1.5
    ctx.strokeRect(left, 0.75, w, REFERENCE_STRIP_PX - 1.5)
    if (lit.anchor) {
      ctx.beginPath()
      ctx.moveTo(left + w / 2, REFERENCE_STRIP_PX)
      ctx.lineTo(lit.anchor.x, lit.anchor.y)
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
}
