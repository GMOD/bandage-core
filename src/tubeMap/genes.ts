import { contig, tubeSpan } from './axis'

import type { ReferenceBoxes } from './axis'
import type { TubeMapFrame } from './draw'
import type { GeneModel } from '../genes/genePins'

// A gene over the tube map, in tube x, mapped through the reference's boxes
// (axis.ts)
export interface TubeMapGene {
  gene: GeneModel
  x0: number
  x1: number
  exons: { x0: number; x1: number }[]
}

export function tubeMapGenes(
  byContig: ReferenceBoxes,
  genes: readonly GeneModel[],
): TubeMapGene[] {
  const out: TubeMapGene[] = []
  for (const gene of genes) {
    const boxes = byContig.get(contig(gene.refName))
    const first = boxes?.[0]
    const last = boxes?.at(-1)
    if (!boxes || !first || !last) {
      continue
    }
    const start = Math.max(gene.start, first.bp0)
    const end = Math.min(gene.end, last.bp1)
    if (end <= start) {
      continue
    }
    out.push({
      gene,
      ...tubeSpan(boxes, start, end),
      exons: gene.exons
        .filter(e => e.end > start && e.start < end)
        .map(e =>
          tubeSpan(boxes, Math.max(e.start, start), Math.min(e.end, end)),
        ),
    })
  }
  return out
}

const ROW_PX = 22
const EXON_PX = 8
const NAME_FONT = '11px sans-serif'
const NAME_GAP_PX = 8

// Rows of genes above the tubes, bottom row nearest them, packed so neither
// glyphs nor names overlap. Packed per frame, since the reference axis warps x
// by zoom. The rows go up to `top`; past that, genes share the top row.
export function drawTubeMapGenes(
  ctx: CanvasRenderingContext2D,
  genes: readonly TubeMapGene[],
  frame: TubeMapFrame,
  bottom: number,
  top = 0,
) {
  const { x, width, darkMode } = frame
  const rows = Math.max(1, Math.floor((bottom - top) / ROW_PX))
  const rowEnds: number[] = []
  const ink = darkMode ? '#e0e0e6' : '#1c1c22'
  ctx.font = NAME_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ink
  ctx.strokeStyle = ink
  ctx.lineWidth = 1
  const placed = genes
    .map(g => ({ g, s0: x(g.x0), s1: x(g.x1) }))
    .filter(({ s0, s1 }) => s1 >= 0 && s0 <= width)
    .sort((a, b) => a.s0 - b.s0)
  for (const { g, s0, s1 } of placed) {
    const arrow = g.gene.strand > 0 ? ' →' : g.gene.strand < 0 ? '← ' : ''
    const label =
      g.gene.strand < 0 ? `${arrow}${g.gene.name}` : `${g.gene.name}${arrow}`
    const mid = (Math.max(s0, 0) + Math.min(s1, width)) / 2
    const half = ctx.measureText(label).width / 2
    const left = Math.min(s0, mid - half)
    const right = Math.max(s1, mid + half)
    let row = rowEnds.findIndex(end => end + NAME_GAP_PX <= left)
    if (row === -1) {
      row = Math.min(rowEnds.length, rows - 1)
    }
    rowEnds[row] = Math.max(rowEnds[row] ?? -Infinity, right)
    const glyphY = bottom - row * ROW_PX - EXON_PX / 2
    ctx.beginPath()
    ctx.moveTo(s0, glyphY + 0.5)
    ctx.lineTo(s1, glyphY + 0.5)
    ctx.stroke()
    for (const e of g.exons) {
      const e0 = x(e.x0)
      ctx.fillRect(e0, glyphY - EXON_PX / 2, Math.max(1, x(e.x1) - e0), EXON_PX)
    }
    ctx.fillText(label, mid, glyphY - EXON_PX / 2 - 2)
  }
}
