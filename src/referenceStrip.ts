import { isBackbone } from './anchoredNodes'
import {
  REFERENCE_RAMP_LIGHTNESS,
  REFERENCE_RAMP_SATURATION,
  rampHueAt,
  rampPieces,
} from './referenceRampCss'
import {
  LIFT_BACKDROP_CSS,
  computeColorSchemeRange,
  getNodeColor,
  packHsl,
} from './renderer/GeometryBuilder'
import { abgrToCssRgba } from './renderer/colorBits'

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
// barcode that reads as data, so it draws as one band. The lit node's span is
// outlined on the strip, as far as the strip shows it, and the graph outlines
// the node in the same ink.

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
  // where the ramp paints the block in more than one colour: its flat
  // pieces, as fractions of the block from bp0, each with its rows' colours
  pieces?: StripPiece[]
}

export interface StripPiece {
  from: number
  to: number
  colors: string[]
}

export function referenceStripBlocks(
  graph: Graph,
  {
    colorScheme,
    referenceRamp,
    walks,
  }: {
    colorScheme: ResolvedColorScheme
    referenceRamp?: ReferenceRamp
    // the lifted walks' lane colours at the nodes each visits, and along a
    // reference node where a lane takes more than one
    walks?: readonly {
      colors: ReadonlyMap<string, number>
      rampColors?: ReadonlyMap<string, readonly StripRampPiece[]>
    }[]
  },
) {
  const range = computeColorSchemeRange(graph, referenceRamp)
  const out: StripBlock[] = []
  graph.nodes.forEach((node, index) => {
    if (isBackbone(node)) {
      const colors = walks
        ? walks.map(w => {
            const lane = w.colors.get(node.id)
            return lane === undefined ? LIFT_BACKDROP_CSS : abgrToCssRgba(lane)
          })
        : [abgrToCssRgba(getNodeColor(node, index, colorScheme, range))]
      const pieces = walks
        ? laneRampPieces(node.id, walks, colors)
        : referenceRamp &&
            colorScheme === 'reference-position' &&
            !node.placeholder
          ? rampPieces(
              { start: node.stable.start, bp: node.length },
              {
                start: referenceRamp.start,
                end: referenceRamp.start + referenceRamp.span,
              },
            ).map(({ from, to, t }) => ({
              from,
              to,
              colors: [
                abgrToCssRgba(
                  packHsl(
                    rampHueAt(t),
                    REFERENCE_RAMP_SATURATION,
                    REFERENCE_RAMP_LIGHTNESS,
                  ),
                ),
              ],
            }))
          : []
      out.push({
        node: node.id,
        bp0: node.stable.start,
        bp1: node.stable.start + node.length,
        colors,
        faded: colors.includes(LIFT_BACKDROP_CSS),
        ...(pieces.length > 1 ? { pieces } : {}),
      })
    }
  })
  return out.sort((a, b) => a.bp0 - b.bp0)
}

interface StripRampPiece {
  from: number
  to: number
  color: number
}

// A block's pieces under lanes: where some lane takes more than one colour
// along the node, every row is cut where it is, each lane in its piece's
// colour and the rest in their one colour
function laneRampPieces(
  node: string,
  walks: readonly {
    rampColors?: ReadonlyMap<string, readonly StripRampPiece[]>
  }[],
  colors: readonly string[],
): StripPiece[] {
  const cut = walks.find(w => w.rampColors?.has(node))?.rampColors?.get(node)
  return (cut ?? []).map(({ from, to }, k) => ({
    from,
    to,
    colors: walks.map((w, row) => {
      const piece = w.rampColors?.get(node)?.[k]
      return piece ? abgrToCssRgba(piece.color) : colors[row]!
    }),
  }))
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

// Whether a block drawn pale on some row lies inside the window, so a key
// names the grey only while some shows
export function stripFadedShown(
  blocks: readonly StripBlock[],
  frame: BpFrame,
  width: number,
) {
  return blocks.some(b => {
    const [x0, x1] = span(frame, b.bp0, b.bp1)
    return b.faded && x1 > 0 && x0 < width
  })
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
  const last = (segments?.length ?? 0) - 1
  const a = segments?.[Math.floor(last / 2)]
  const b = segments?.[Math.ceil(last / 2)]
  return a && b
    ? toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    : undefined
}

export interface StripLit {
  start: number
  end: number
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
  // a block the ramp paints in pieces, each in whole device pixels
  pieces?: { colors: string[]; x0: number; x1: number }[]
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
        pieces: b.pieces?.map(piece => {
          const bp = b.bp1 - b.bp0
          const [p0, p1] = span(
            frame,
            b.bp0 + piece.from * bp,
            b.bp0 + piece.to * bp,
          )
          return {
            colors: piece.colors,
            px0: Math.round(p0 * dpr),
            px1: Math.round(p1 * dpr),
          }
        }),
      }
    })
    .filter(b => b.px1 > 0 && b.px0 < width * dpr)
    .sort((a, b) => a.x0 - b.x0)
  const out: StripPixel[] = []
  let claimed = -Infinity
  // where each tier's last block ends, in device px
  const tierEnds = [-Infinity, -Infinity]
  for (const { colors, px0, px1, pieces } of placed) {
    const start = Math.max(px0, claimed)
    if (px1 > start) {
      const tier = tierEnds[0]! < start ? 0 : 1
      tierEnds[tier] = px1
      const cut = pieces?.flatMap(piece => {
        const a = Math.max(piece.px0, start)
        const b = Math.min(piece.px1, px1)
        return b > a ? [{ colors: piece.colors, x0: a / dpr, x1: b / dpr }] : []
      })
      out.push({
        colors,
        x0: start / dpr,
        x1: px1 / dpr,
        tier,
        ...(cut?.length ? { pieces: cut } : {}),
      })
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

// The ink the strip outlines a lit span in, and the graph its node
export const stripInk = (darkMode?: boolean) =>
  darkMode ? '#ffffff' : '#18181c'

const LIT_PX = 1.5
const LIT_MIN_PX = 3

// A lit span's outline, as the polylines to stroke: over the part of it
// between the strip's end caps, open on a side the pane cuts, so it runs on
// past the cap there. A span wholly past an edge outlines that edge's cap, and
// nothing where the strip draws none. `lo` and `hi` are where the caps begin.
export function litOutline(
  [x0, x1]: readonly [number, number],
  { lo, hi, width }: { lo: number; hi: number; width: number },
) {
  const cutLeft = x0 < lo
  const cutRight = x1 > hi
  const v0 = Math.max(x0, lo)
  const v1 = Math.min(x1, hi)
  const top = LIT_PX / 2
  const bottom = REFERENCE_STRIP_PX - LIT_PX / 2
  const w = Math.max(v1 - v0, LIT_MIN_PX)
  const left = cutRight ? v1 - w : cutLeft ? v0 : (v0 + v1) / 2 - w / 2
  const right = left + w
  const capLeft = cutLeft ? lo - OVERHANG_CAP_PX : hi
  const cap = [
    { x: capLeft + top, y: top },
    { x: capLeft + OVERHANG_CAP_PX - top, y: top },
    { x: capLeft + OVERHANG_CAP_PX - top, y: bottom },
    { x: capLeft + top, y: bottom },
    { x: capLeft + top, y: top },
  ]
  return v1 >= v0
    ? cutRight
      ? [
          [
            ...(cutLeft ? [] : [{ x: left, y: bottom }]),
            { x: left, y: top },
            { x: right, y: top },
          ],
          [
            { x: right, y: bottom },
            { x: left, y: bottom },
          ],
        ]
      : [
          [
            ...(cutLeft ? [] : [{ x: left, y: bottom }]),
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
          ],
        ]
    : (cutLeft ? lo > 0 : hi < width)
      ? [cap]
      : []
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
  const ink = stripInk(darkMode)
  ctx.clearRect(0, 0, width, REFERENCE_STRIP_ZONE_PX)
  for (const b of stripPixels(blocks, frame, width, dpr)) {
    // a row per lifted walk, else the block's tier, else the whole strip
    const { tier } = b
    const staggered = tier !== undefined && b.colors.length === 1
    const rows = staggered ? 2 : b.colors.length
    for (const piece of b.pieces ?? [b]) {
      piece.colors.forEach((color, i) => {
        const row = staggered ? tier : i
        const y0 = rowEdge(row, rows, dpr)
        ctx.fillStyle = color
        ctx.fillRect(
          piece.x0,
          y0,
          piece.x1 - piece.x0,
          rowEdge(row + 1, rows, dpr) - y0,
        )
      })
    }
  }
  const overhang = stripOverhang(blocks, frame, width)
  if (overhang.left > 0) {
    drawOverhang(ctx, 0, 1, ink)
  }
  if (overhang.right > 0) {
    drawOverhang(ctx, width, -1, ink)
  }
  if (lit) {
    ctx.strokeStyle = ink
    ctx.lineWidth = LIT_PX
    ctx.beginPath()
    for (const line of litOutline(span(frame, lit.start, lit.end), {
      lo: overhang.left > 0 ? OVERHANG_CAP_PX : 0,
      hi: overhang.right > 0 ? width - OVERHANG_CAP_PX : width,
      width,
    })) {
      line.forEach(({ x, y }, i) => {
        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      })
    }
    ctx.stroke()
  }
}
