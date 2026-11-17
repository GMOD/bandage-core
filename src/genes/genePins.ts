import {
  REFERENCE_RANK,
  drawnAlongStable,
  firstNodeAtOrAfter,
  isAnchored,
} from '../anchoredNodes'
import { polylineSlice } from '../layout/mergeRuns'
import { pathOrigin } from '../pathAnchoring'
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

// A gene drawn onto the graph: its exons as stretches of the nodes that carry
// them, in layout units, and one point to pin its name to. A gene lands on the
// nodes whose stable coordinate lies on its sequence: the backbone, and a
// level-of-detail tier's bubble nodes, each a span of the reference. An
// allele's coordinate is on its own assembly, so it shows no exon even where a
// haplotype's own annotation would put one.
export interface GenePin {
  gene: GeneModel
  // an SVG path of the exon stretches, in layout units
  exons: string
  // the same stretches per node, for a drawing sized to each node, as a path
  // and as points
  exonsByNode: { nodeId: string; d: string; stretches: NodeSegment[][] }[]
  // every node the gene lies over, the only ones its name may cover
  nodeIds: ReadonlySet<string>
  // where the name goes: the point at the gene's midpoint, or the nearest
  // point inside the gene where the midpoint is not in the cut
  at: NodeSegment
  // how much of the gene's span the drawing holds, so a label can say when a
  // gene runs off it: on the reference, the drawn backbone's share; on a
  // haplotype's own contig, the share inside its walk's records of that contig
  covered: number
  // of the gene's stretch inside the reference's walk records, the share the
  // drawn nodes anchored on it hold. Under half where the reference walks
  // that stretch over nodes it passed before, as through a collapsed
  // repeat's later copies, whose sequence is drawn where the first copy is
  // pinned. 1 on a haplotype's own contig, and where no reference walk is cut
  anchored: number
  // whether the gene lies on the reference's own sequence
  onReference: boolean
  // how many of the graph's walks step any node the gene lies over
  walks: number
}

// The nodes on one refName in offset order, for finding the nodes a gene lies
// over without reading the rest. `reach` is the longest node: a node over a
// gene's start begins no further before it than that.
interface RefNameNodes {
  nodes: AnchoredNode[]
  reach: number
  reference: boolean
}

// What a graph says of its genes that no layout or drag changes, read once
// per graph: its anchored nodes by refName, where its walks lie on each
// contig, and how many walks step the nodes under each gene span asked about
interface GraphGenes {
  byRefName: Map<string, RefNameNodes>
  stretches: Map<string, Interval[]>
  walks: Map<string, number>
}

const graphGenesCache = new WeakMap<Graph, GraphGenes>()

function graphGenesOf(graph: Graph) {
  let known = graphGenesCache.get(graph)
  if (!known) {
    known = {
      byRefName: anchoredByRefName(graph),
      stretches: walkStretches(graph),
      walks: new Map(),
    }
    graphGenesCache.set(graph, known)
  }
  return known
}

const spanKey = (gene: GeneModel) =>
  `${gene.refName}\t${gene.start}\t${gene.end}`

function anchoredByRefName(graph: Graph) {
  const byRefName = new Map<string, RefNameNodes>()
  for (const node of graph.nodes) {
    if (isAnchored(node)) {
      const { refName } = node.stable
      const entry =
        byRefName.get(refName) ??
        byRefName
          .set(refName, { nodes: [], reach: 0, reference: false })
          .get(refName)!
      entry.reference ||= node.stable.rank === REFERENCE_RANK
      entry.nodes.push(node)
      entry.reach = Math.max(entry.reach, node.length)
    }
  }
  for (const { nodes } of byRefName.values()) {
    nodes.sort((a, b) => a.stable.start - b.stable.start)
  }
  return byRefName
}

interface Interval {
  start: number
  end: number
}

// Where the walks' records lie on each contig, by the contig's name: one
// interval per record, sorted, with those that touch or overlap merged
function walkStretches(graph: Graph) {
  const lengths = new Map(graph.nodes.map(n => [n.id, n.length]))
  const records = new Map<string, Interval[]>()
  for (const path of graph.paths ?? []) {
    const origin = pathOrigin(path.name)
    const start = path.start ?? origin.start
    const end = path.nodeIds.reduce(
      (sum, id) => sum + (lengths.get(id) ?? 0),
      start,
    )
    const onContig = records.get(origin.name)
    if (onContig) {
      onContig.push({ start, end })
    } else {
      records.set(origin.name, [{ start, end }])
    }
  }
  const stretches = new Map<string, Interval[]>()
  for (const [contig, intervals] of records) {
    const merged: Interval[] = []
    for (const { start, end } of intervals.sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1)
      if (last && start <= last.end) {
        last.end = Math.max(last.end, end)
      } else {
        merged.push({ start, end })
      }
    }
    stretches.set(contig, merged)
  }
  return stretches
}

function overlap(stretch: readonly Interval[], { start, end }: Interval) {
  return stretch.reduce(
    (sum, s) =>
      sum + Math.max(0, Math.min(end, s.end) - Math.max(start, s.start)),
    0,
  )
}

// How many walks step any node of each set, by the set
function walksStepping(graph: Graph, nodeSets: readonly ReadonlySet<string>[]) {
  const stepping = new Map(nodeSets.map(ids => [ids, new Set<string>()]))
  const steppedBy = new Map<string, Set<string>[]>()
  for (const [ids, walks] of stepping) {
    for (const id of ids) {
      const into = steppedBy.get(id)
      if (into) {
        into.push(walks)
      } else {
        steppedBy.set(id, [walks])
      }
    }
  }
  for (const path of graph.paths ?? []) {
    const origin = pathOrigin(path.name).name
    for (const id of path.nodeIds) {
      for (const walks of steppedBy.get(id) ?? []) {
        walks.add(origin)
      }
    }
  }
  return new Map([...stepping].map(([ids, walks]) => [ids, walks.size]))
}

function alongLine(
  node: AnchoredNode,
  from: number,
  to: number,
  stranded: boolean,
) {
  const a = node.length ? from / node.length : 0
  const b = node.length ? to / node.length : 0
  return stranded && !drawnAlongStable(node)
    ? ([1 - b, 1 - a] as const)
    : ([a, b] as const)
}

// A gene lands on the backbone refName it equals. An assembly's `chr6` lands
// on none, so a host renames its genes onto the graph's `GRCh38#0#chr6` with
// featuresOnBackbone once it knows the backbone lies on that assembly.
export function genePins(
  graph: Graph,
  genes: GeneModel[],
  positions: Record<string, NodeSegment[]>,
  stranded = false,
): GenePin[] {
  // A node drag recomputes the pins each frame and reads no walk's steps
  const known = graphGenesOf(graph)
  const uncounted = new Map<string, Set<string>>()
  const pins: Omit<GenePin, 'walks' | 'anchored'>[] = []
  for (const gene of genes) {
    const onRefName = known.byRefName.get(gene.refName)
    if (!onRefName) {
      continue
    }
    const parts: string[] = []
    const exonsByNode: GenePin['exonsByNode'] = []
    const nodeIds = new Set<string>()
    let at: NodeSegment | undefined
    let atDistance = Infinity
    let covered = 0
    const key = spanKey(gene)
    const under = known.walks.has(key) ? undefined : new Set<string>()
    const mid = (gene.start + gene.end) / 2
    const { nodes, reach, reference } = onRefName
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
      under?.add(node.id)
      const line = positions[node.id]
      if (!line?.length) {
        continue
      }
      nodeIds.add(node.id)
      covered += Math.min(nodeEnd, gene.end) - Math.max(nodeStart, gene.start)
      const nodeParts: string[] = []
      const stretches: NodeSegment[][] = []
      for (const exon of gene.exons) {
        const a = Math.max(exon.start, nodeStart)
        const b = Math.min(exon.end, nodeEnd)
        if (b <= a) {
          continue
        }
        const [from, to] = alongLine(
          node,
          a - nodeStart,
          b - nodeStart,
          stranded,
        )
        const stretch = polylineSlice(line, from, to)
        if (stretch.length === 1) {
          stretch.push({ ...stretch[0]! })
        }
        nodeParts.push(svgPath(stretch))
        stretches.push(stretch)
      }
      if (nodeParts.length > 0) {
        for (const part of nodeParts) {
          parts.push(part)
        }
        exonsByNode.push({ nodeId: node.id, d: nodeParts.join(''), stretches })
      }
      const pinBp = Math.min(Math.max(mid, nodeStart), nodeEnd)
      const distance = Math.abs(pinBp - mid)
      if (distance < atDistance) {
        atDistance = distance
        const [along] = alongLine(
          node,
          pinBp - nodeStart,
          pinBp - nodeStart,
          stranded,
        )
        at = polylineSlice(line, along, along)[0]
      }
    }
    if (at) {
      if (under) {
        uncounted.set(key, under)
      }
      pins.push({
        gene,
        exons: parts.join(''),
        exonsByNode,
        nodeIds,
        at,
        covered: covered / (gene.end - gene.start),
        onReference: reference,
      })
    }
  }
  if (uncounted.size > 0) {
    const counted = walksStepping(graph, [...uncounted.values()])
    for (const [key, ids] of uncounted) {
      known.walks.set(key, counted.get(ids) ?? 0)
    }
  }
  return pins.map(pin => {
    const stretch = known.stretches.get(pin.gene.refName)
    const walked = stretch ? overlap(stretch, pin.gene) : 0
    const length = pin.gene.end - pin.gene.start
    return {
      ...pin,
      covered: stretch && !pin.onReference ? walked / length : pin.covered,
      anchored:
        pin.onReference && walked > 0
          ? Math.min(1, (pin.covered * length) / walked)
          : 1,
      walks: known.walks.get(spanKey(pin.gene)) ?? 0,
    }
  })
}
