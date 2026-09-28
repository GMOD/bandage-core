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
// the colour its node has in the graph below, faded where the graph fades it
// off a lifted walk. Under the reference-position ramp that is the hue a
// reader matches between the two; the lit node gets a
// leader from its span on the strip to where the graph drew it, as the
// variant matrix ties a column to its variant.

export const REFERENCE_STRIP_PX = 10
// the strip, and the gap under it the fit leaves the drawing
export const REFERENCE_STRIP_ZONE_PX = REFERENCE_STRIP_PX + 8
// a triangle at a strip end: reference the graph draws runs past that edge
const OVERHANG_PX = 5

export interface StripBlock {
  node: string
  bp0: number
  bp1: number
  color: string
  // off every lifted walk, so the strip pales it as the graph does
  faded: boolean
}

export function referenceStripBlocks(
  graph: Graph,
  {
    colorScheme,
    referenceRamp,
    walkNodes,
    walkColors,
  }: {
    colorScheme: ResolvedColorScheme
    referenceRamp?: ReferenceRamp
    // the nodes lifted walks visit, and the reference walk's lane colours
    // when it is one of them: the strip then takes those, else grey
    walkNodes?: ReadonlySet<string>
    walkColors?: ReadonlyMap<string, number>
  },
) {
  const range = { ...computeColorSchemeRange(graph), referenceRamp }
  const out: StripBlock[] = []
  graph.nodes.forEach((node, index) => {
    if (isBackbone(node)) {
      const own = walkNodes
        ? (walkColors?.get(node.id) ?? LIFT_BACKDROP_COLOR)
        : getNodeColor(node, index, colorScheme, range)
      const faded = !!walkNodes && !walkNodes.has(node.id)
      out.push({
        node: node.id,
        bp0: node.stable.start,
        bp1: node.stable.start + node.length,
        color: abgrToCssRgba(faded ? fadeAbgr(own, FADED_ALPHA) : own),
        faded,
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
export function stripPixels(
  blocks: readonly StripBlock[],
  frame: BpFrame,
  width: number,
  dpr: number,
) {
  const placed = blocks
    .map(b => {
      const [x0, x1] = span(frame, b.bp0, b.bp1)
      const px0 = Math.round(x0 * dpr)
      return {
        color: b.color,
        x0,
        px0,
        px1: Math.max(Math.round(x1 * dpr), px0 + 1),
      }
    })
    .filter(b => b.px1 > 0 && b.px0 < width * dpr)
    .sort((a, b) => a.x0 - b.x0)
  const out: { color: string; x0: number; x1: number }[] = []
  let claimed = -Infinity
  for (const { color, px0, px1 } of placed) {
    const start = Math.max(px0, claimed)
    if (px1 > start) {
      out.push({ color, x0: start / dpr, x1: px1 / dpr })
      claimed = px1
    }
  }
  return out
}

// A triangle with its tip on the strip's edge, pointing off it; `inward` is
// +1 from the left edge and -1 from the right
function drawOverhang(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  inward: number,
) {
  const mid = REFERENCE_STRIP_PX / 2
  const baseX = tipX + inward * (OVERHANG_PX + 1)
  ctx.moveTo(tipX + inward, mid)
  ctx.lineTo(baseX, mid - OVERHANG_PX / 1.4)
  ctx.lineTo(baseX, mid + OVERHANG_PX / 1.4)
  ctx.closePath()
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
  ctx.fillStyle = darkMode ? '#1f1f1f' : '#ffffff'
  ctx.fillRect(0, 0, width, REFERENCE_STRIP_ZONE_PX)
  for (const b of stripPixels(blocks, frame, width, dpr)) {
    ctx.fillStyle = b.color
    ctx.fillRect(b.x0, 0, b.x1 - b.x0, REFERENCE_STRIP_PX)
  }
  const overhang = stripOverhang(blocks, frame, width)
  if (overhang.left > 0 || overhang.right > 0) {
    ctx.beginPath()
    if (overhang.left > 0) {
      drawOverhang(ctx, 0, 1)
    }
    if (overhang.right > 0) {
      drawOverhang(ctx, width, -1)
    }
    ctx.fillStyle = ink
    ctx.fill()
    ctx.strokeStyle = darkMode ? '#1f1f1f' : '#ffffff'
    ctx.lineWidth = 1
    ctx.stroke()
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
