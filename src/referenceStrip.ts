import { abgrToCssRgba } from '@jbrowse/core/util/colorBits'

import { isBackbone } from './anchoredNodes'
import {
  FADED_ALPHA,
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

export interface StripBlock {
  node: string
  bp0: number
  bp1: number
  color: string
}

export function referenceStripBlocks(
  graph: Graph,
  {
    colorScheme,
    referenceRamp,
    walkNodes,
  }: {
    colorScheme: ResolvedColorScheme
    referenceRamp?: ReferenceRamp
    walkNodes?: ReadonlySet<string>
  },
) {
  const range = { ...computeColorSchemeRange(graph), referenceRamp }
  const out: StripBlock[] = []
  graph.nodes.forEach((node, index) => {
    if (isBackbone(node)) {
      const own = getNodeColor(node, index, colorScheme, range)
      out.push({
        node: node.id,
        bp0: node.stable.start,
        bp1: node.stable.start + node.length,
        color: abgrToCssRgba(
          walkNodes && !walkNodes.has(node.id)
            ? fadeAbgr(own, FADED_ALPHA)
            : own,
        ),
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

export function drawReferenceStrip(
  ctx: CanvasRenderingContext2D,
  blocks: readonly StripBlock[],
  frame: BpFrame,
  {
    width,
    lit,
    darkMode,
  }: { width: number; lit?: StripLit; darkMode?: boolean },
) {
  ctx.fillStyle = darkMode ? '#1f1f1f' : '#ffffff'
  ctx.fillRect(0, 0, width, REFERENCE_STRIP_ZONE_PX)
  for (const b of blocks) {
    const [x0, x1] = span(frame, b.bp0, b.bp1)
    if (x1 >= 0 && x0 <= width) {
      ctx.fillStyle = b.color
      ctx.fillRect(x0, 0, Math.max(x1 - x0, 1), REFERENCE_STRIP_PX)
    }
  }
  if (lit) {
    const ink = darkMode ? '#ffffff' : '#18181c'
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
