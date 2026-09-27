import { isBackbone } from '../anchoredNodes'

import type { Graph } from '../types'
import type { TubeMapLayout } from '@gmod/tubemap-core'

// On its own axis a tube map keeps none of the linear view's bp: a box is as
// wide as log2 of its length, and the lane changes between boxes take px that
// cover no reference at all. A band from each reference box up to the bp it
// covers on the linear view's ruler ties the two back together, the way the
// LD display ties its matrix columns to their variants.

export interface ReferenceNode {
  node: string
  bp0: number
  bp1: number
  x0: number
  x1: number
}

// A reference node's band, in screen px: its bp span along the top of the
// zone, its box's span along the bottom
export interface Connector {
  node: string
  top0: number
  top1: number
  bottom0: number
  bottom1: number
}

export function referenceNodes(graph: Graph, layout: TubeMapLayout) {
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const out: ReferenceNode[] = []
  // sparse: an unreached node has no entry
  layout.nodes.forEach(node => {
    const graphNode = nodeById.get(node.name)
    if (node.order >= 0 && graphNode && isBackbone(graphNode)) {
      out.push({
        node: node.name,
        bp0: graphNode.stable.start,
        bp1: graphNode.stable.start + node.sequenceLength,
        x0: node.x,
        x1: node.x + node.pixelWidth,
      })
    }
  })
  return out
}

// The bands whose box is on screen. A band's top may still run off the side,
// which is the linear view saying that box is outside its window.
export function tubeMapConnectors(
  nodes: readonly ReferenceNode[],
  bpToScreen: (bp: number) => number,
  tubeToScreen: (tx: number) => number,
  width: number,
): Connector[] {
  const out: Connector[] = []
  for (const n of nodes) {
    const bottom0 = tubeToScreen(n.x0)
    const bottom1 = tubeToScreen(n.x1)
    if (bottom1 >= 0 && bottom0 <= width) {
      out.push({
        node: n.node,
        top0: bpToScreen(n.bp0),
        top1: bpToScreen(n.bp1),
        bottom0,
        bottom1,
      })
    }
  }
  return out
}

// A SNP's band is a sliver, so the pointer gets a few px either side of one
const HIT_SLOP_PX = 3

export function connectorAt(
  connectors: readonly Connector[],
  zoneBottom: number,
  sx: number,
  sy: number,
) {
  if (zoneBottom <= 0 || sy < 0 || sy > zoneBottom) {
    return undefined
  }
  const t = sy / zoneBottom
  let hit: string | undefined
  let best = HIT_SLOP_PX
  for (const c of connectors) {
    const a = c.top0 + (c.bottom0 - c.top0) * t
    const b = c.top1 + (c.bottom1 - c.top1) * t
    const dist = Math.max(0, Math.min(a, b) - sx, sx - Math.max(a, b))
    if (dist < best) {
      best = dist
      hit = c.node
    }
  }
  return hit
}

function band(ctx: CanvasRenderingContext2D, c: Connector, bottom: number) {
  ctx.moveTo(c.top0, 0)
  ctx.lineTo(c.top1, 0)
  ctx.lineTo(c.bottom1, bottom)
  ctx.lineTo(c.bottom0, bottom)
  ctx.closePath()
}

function sides(ctx: CanvasRenderingContext2D, c: Connector, bottom: number) {
  ctx.moveTo(c.top0, 0)
  ctx.lineTo(c.bottom0, bottom)
  ctx.moveTo(c.top1, 0)
  ctx.lineTo(c.bottom1, bottom)
}

// One fill and one stroke for every band, so where hundreds of them converge
// on the ruler the ink composites once rather than going black. The lit band
// takes the tube map's own highlight.
export function drawTubeMapConnectors(
  ctx: CanvasRenderingContext2D,
  connectors: readonly Connector[],
  bottom: number,
  {
    highlightNode,
    darkMode,
  }: { highlightNode?: string | null; darkMode?: boolean },
) {
  if (bottom <= 0 || connectors.length === 0) {
    return
  }
  const ink = darkMode ? '255,255,255' : '0,0,0'
  ctx.beginPath()
  for (const c of connectors) {
    band(ctx, c, bottom)
  }
  ctx.fillStyle = `rgba(${ink},0.07)`
  ctx.fill()
  ctx.beginPath()
  for (const c of connectors) {
    sides(ctx, c, bottom)
  }
  ctx.strokeStyle = `rgba(${ink},0.35)`
  ctx.lineWidth = 0.5
  ctx.stroke()
  const lit = connectors.find(c => c.node === highlightNode)
  if (lit) {
    ctx.beginPath()
    band(ctx, lit, bottom)
    ctx.fillStyle = 'rgba(255,192,203,0.5)'
    ctx.fill()
    ctx.beginPath()
    sides(ctx, lit, bottom)
    ctx.strokeStyle = '#ff0000'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}
