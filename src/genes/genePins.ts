import { firstNodeAtOrAfter, isBackbone } from '../anchoredNodes'
import { polylineSlice } from '../layout/mergeRuns'
import { svgPath } from '../util/geometry'

import type { AnchoredNode } from '../anchoredNodes'
import type { Graph, NodeSegment } from '../types'

// A gene as the pins need it: its name, its span on the reference, and the
// exons of all its transcripts merged into one set of intervals.
export interface GeneModel {
  name: string
  refName: string
  start: number
  end: number
  strand: number
  exons: { start: number; end: number }[]
}

// A gene drawn onto the graph: its exons as stretches of the backbone nodes
// that carry them, in layout units, and one point on the backbone to pin its
// name to. Only the backbone has coordinates, so an allele shows no exon even
// where a haplotype's own annotation would put one.
export interface GenePin {
  gene: GeneModel
  // an SVG path of the exon stretches, in layout units
  exons: string
  // where the name goes: the backbone point at the gene's midpoint, or the
  // nearest backbone point inside the gene where the midpoint is not in the cut
  at: NodeSegment
  // how much of the gene's span the cut's backbone covers, so a label can say
  // when a gene runs off the cut
  covered: number
}

// The backbone of one refName in offset order, for finding the nodes a gene
// lies over without reading the rest. `reach` is the longest node: a node over
// a gene's start begins no further before it than that.
interface RefNameBackbone {
  nodes: AnchoredNode[]
  reach: number
}

// A gene lands on the backbone refName it equals. An assembly's `chr6` lands
// on none, so a host renames its genes onto the graph's `GRCh38#0#chr6` with
// featuresOnBackbone once it knows the backbone lies on that assembly.
export function genePins(
  graph: Graph,
  genes: GeneModel[],
  positions: Record<string, NodeSegment[]>,
): GenePin[] {
  // Per refName and sorted once, so a gene reads the few nodes it lies over.
  // Every gene used to read every backbone node on each frame of a node drag:
  // 199 ms for 100 genes over 15k nodes, now 12.
  const byRefName = new Map<string, RefNameBackbone>()
  for (const node of graph.nodes) {
    if (isBackbone(node)) {
      const { refName } = node.stable
      if (positions[node.id]?.length) {
        const entry =
          byRefName.get(refName) ??
          byRefName.set(refName, { nodes: [], reach: 0 }).get(refName)!
        entry.nodes.push(node)
        entry.reach = Math.max(entry.reach, node.length)
      }
    }
  }
  for (const { nodes } of byRefName.values()) {
    nodes.sort((a, b) => a.stable.start - b.stable.start)
  }
  const pins: GenePin[] = []
  for (const gene of genes) {
    const backbone = byRefName.get(gene.refName)
    if (!backbone) {
      continue
    }
    const parts: string[] = []
    let at: NodeSegment | undefined
    let atDistance = Infinity
    let covered = 0
    const mid = (gene.start + gene.end) / 2
    const { nodes, reach } = backbone
    for (
      let i = firstNodeAtOrAfter(nodes, gene.start - reach);
      i < nodes.length && nodes[i]!.stable.start < gene.end;
      i++
    ) {
      const node = nodes[i]!
      const nodeStart = node.stable.start
      const nodeEnd = nodeStart + node.length
      if (nodeEnd <= gene.start) {
        continue
      }
      const line = positions[node.id]!
      covered += Math.min(nodeEnd, gene.end) - Math.max(nodeStart, gene.start)
      for (const exon of gene.exons) {
        const a = Math.max(exon.start, nodeStart)
        const b = Math.min(exon.end, nodeEnd)
        if (b <= a) {
          continue
        }
        const stretch = polylineSlice(
          line,
          (a - nodeStart) / node.length,
          (b - nodeStart) / node.length,
        )
        if (stretch.length === 1) {
          stretch.push({ ...stretch[0]! })
        }
        parts.push(svgPath(stretch))
      }
      const pinBp = Math.min(Math.max(mid, nodeStart), nodeEnd)
      const distance = Math.abs(pinBp - mid)
      if (distance < atDistance) {
        atDistance = distance
        const [p] = polylineSlice(
          line,
          (pinBp - nodeStart) / node.length,
          (pinBp - nodeStart) / node.length,
        )
        at = p
      }
    }
    if (at) {
      pins.push({
        gene,
        exons: parts.join(''),
        at,
        covered: covered / (gene.end - gene.start),
      })
    }
  }
  return pins
}
