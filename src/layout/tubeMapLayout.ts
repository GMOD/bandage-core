import { forward, isReverse, layoutTubeMap } from '@jbrowse/tubemap-core'

import { isBackbone } from '../anchoredNodes'
import { pathOrigin } from '../pathAnchoring'
import { pathCssColor, pathGreyCssColor } from '../pathColors'
import { canonicalStrand, stepName, tubeMapReads } from '../tubeMap/reads'
import { ownStrand, strandSides } from '../util/geometry'

import type { Coarsened } from '../tubeMap/coarsen'
import type { Graph, GraphNode, LayoutResult, NodeSegment } from '../types'
import type {
  InputNode,
  InputTrack,
  LayoutNode,
  TubeMapLayout,
} from '@jbrowse/tubemap-core'

// The sequenceTubeMap drawing of a graph's paths: every P or W line a tube,
// every node a box the tubes pass through, laid out by @jbrowse/tubemap-core.
// The canvas draws none of it; TubeMapOverlay draws the shapes, and
// nodePositions is each box's centreline, for the hit test, the fit and the
// labels.
//
// Two x axes. `own` is the tube map's: columns in node order, a node as wide as
// log2 of its length, which is the compact picture sequenceTubeMap draws.
// `reference` pins each column to the reference bp its backbone node covers,
// so the tubes line up with the linear view's other tracks; the overlay makes
// room for the curves between columns when it draws (tubeMapWarp.ts).

// A column of the tube map: the nodes at one `order`, the tube x they were
// drawn over, and under the reference axis the reference bp they stand for.
export interface TubeMapColumn {
  order: number
  x0: number
  x1: number
  bp0: number
  bp1: number
}

export interface TubeMapDrawing {
  layout: TubeMapLayout
  // each path's tube colour, in the order the graph states its paths
  pathColors: string[]
  // tube y minus this is the drawing's y, so the drawing starts at 0
  yOffset: number
  // set on the reference axis, sorted by order
  columns?: TubeMapColumn[]
  // set when the cut was folded before layout (coarsen.ts): the drawing's node
  // ids are the coarse graph's, not the cut's
  coarse?: Coarsened
  // the graph the boxes address: the one laid out, each merged run one node
  graph: Graph
  // box to the nodes it stands for, in run order, where that is more than one
  members: Map<string, string[]>
}

export interface PathStep {
  node: GraphNode
  strand: '+' | '-'
}

// Each path's steps, with the strand it reads each segment on. A segment's
// visits are listed in walk order and name the walk without the range suffix
// `odgi extract` appends (pathOrigin), and a walk cut into pieces lists its
// pieces in the order of the paths. So replaying the paths in that order, with
// one count per walk and segment that its pieces share, reads each step's own
// visit, as trimToWindow's trimVisits does.
export function pathSteps(graph: Graph): PathStep[][] {
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const strands = new Map<string, ('+' | '-')[]>()
  for (const [segment, visits] of graph.pathVisits ?? []) {
    for (const visit of visits) {
      const key = `${visit.path}\t${segment}`
      const list = strands.get(key)
      if (list) {
        list.push(visit.strand)
      } else {
        strands.set(key, [visit.strand])
      }
    }
  }
  const seen = new Map<string, number>()
  return (graph.paths ?? []).map(path => {
    const walk = pathOrigin(path.name).name
    return path.nodeIds.flatMap(id => {
      const node = nodeById.get(id)
      if (!node) {
        return []
      }
      const key = `${walk}\t${node.name}`
      const k = seen.get(key) ?? 0
      seen.set(key, k + 1)
      return [{ node, strand: strands.get(key)?.[k] ?? canonicalStrand(node) }]
    })
  })
}

// A tube map track per path, the reference first: the layout straightens
// track 0 and orders every other node around it. A step reads its node in
// reverse where the path walks the segment against the strand the node is
// drawn in.
export function tubeMapTracks(graph: Graph): InputTrack[] {
  const steps = pathSteps(graph)
  const tracks = (graph.paths ?? []).flatMap((path, index) => {
    const sequence = steps[index]!.map(s => stepName(s.node, s.strand))
    return sequence.length > 0
      ? [
          {
            id: index,
            name: path.name,
            sequence,
            sourceTrackID: 0,
            type: 'haplotype' as const,
          },
        ]
      : []
  })
  const reference = tracks.findIndex(
    t => pathOrigin(t.name).name === graph.referencePath,
  )
  if (reference > 0) {
    tracks.unshift(...tracks.splice(reference, 1))
  }
  return tracks
}

function tubeMapNodes(graph: Graph): InputNode[] {
  return graph.nodes.map(n => ({
    name: n.id,
    seq: '',
    sequenceLength: Math.max(1, n.length),
  }))
}

export function hasTubeMapPaths(graph: Graph) {
  return (graph.paths?.length ?? 0) > 0
}

// Tubes narrow as paths are added, so ninety haplotypes stack about as tall as
// forty at full width rather than filling a screen and a half each.
const STACK_PX = 600
const MIN_TUBE_PX = 3
const MAX_TUBE_PX = 15

export function tubeWidth(trackCount: number) {
  return Math.max(
    MIN_TUBE_PX,
    Math.min(MAX_TUBE_PX, Math.floor(STACK_PX / Math.max(1, trackCount))),
  )
}

// The nodes tubemap-core turns around before it merges (straightenTrack):
// those the first track reads in reverse before it reads them forward
function straightened(first: InputTrack | undefined) {
  const flipped = new Set<string>()
  const forwards = new Set<string>()
  for (const step of first?.sequence ?? []) {
    if (!isReverse(step)) {
      forwards.add(step)
    } else if (!forwards.has(forward(step))) {
      flipped.add(forward(step))
    }
  }
  return flipped
}

export interface MergedRuns {
  // box to the nodes it stands for, in the order the layout draws them
  members: Map<string, string[]>
  // the nodes the layout draws against their own strand
  flipped: Set<string>
}

// Which nodes each box stands for. tubemap-core merges a run that every track
// and primary read walks straight through into the run's first node, and gives
// the rest no box. Each of the rest has one predecessor in its run, which a
// walk visits just before it going the way the layout draws it, and just after
// it going against. A run is kept only where its members add up to the box the
// layout drew, so a merge this misreads leaves the box standing for its first
// node alone.
export function mergedRuns(
  graph: Graph,
  layout: TubeMapLayout,
  walks: readonly InputTrack[],
): MergedRuns {
  const flipped = straightened(walks[0])
  const before = new Map<string, string>()
  for (const { sequence, is_secondary } of walks) {
    if (!is_secondary) {
      sequence.forEach((step, i) => {
        const id = forward(step)
        const against = isReverse(step) !== flipped.has(id)
        const neighbour = against ? sequence[i + 1] : sequence[i - 1]
        if (!layout.nodeMap.has(id) && neighbour !== undefined) {
          before.set(id, forward(neighbour))
        }
      })
    }
  }
  const lengthOf = new Map(graph.nodes.map(n => [n.id, Math.max(1, n.length)]))
  const after = new Map([...before].map(([node, prev]) => [prev, node]))
  const members = new Map<string, string[]>()
  for (const head of after.keys()) {
    const index = layout.nodeMap.get(head)
    if (index !== undefined) {
      const run = [head]
      for (let n = after.get(head); n !== undefined; n = after.get(n)) {
        run.push(n)
      }
      const bp = run.reduce((sum, id) => sum + (lengthOf.get(id) ?? 0), 0)
      if (bp === layout.nodes[index]!.sequenceLength) {
        members.set(head, run)
      }
    }
  }
  return { members, flipped }
}

const opposite = { start: 'end', end: 'start' } as const
const otherStrand = { '+': '-', '-': '+' } as const

// The graph as its boxes draw it: each merged run one node, as long as its
// members together and starting where the first of them on the reference
// does, the links inside the run gone and the rest moved onto the side of the
// box they reach
export function boxGraph(
  graph: Graph,
  { members, flipped }: MergedRuns,
): Graph {
  if (members.size === 0) {
    return graph
  }
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const boxOf = new Map<string, string>()
  const inner = new Set<string>()
  // a node's side as the layout draws the node
  const drawn = (id: string, side: 'start' | 'end') =>
    flipped.has(id) ? opposite[side] : side
  for (const [box, run] of members) {
    run.forEach((id, i) => {
      boxOf.set(id, box)
      const next = run[i + 1]
      if (next !== undefined) {
        inner.add(`${id}:${drawn(id, 'end')}\t${next}:${drawn(next, 'start')}`)
      }
    })
  }
  const absorbed = new Set(
    [...boxOf].filter(([id, box]) => id !== box).map(([id]) => id),
  )
  const nodes = graph.nodes.flatMap(node => {
    const run = members.get(node.id)
    if (!run) {
      return absorbed.has(node.id) ? [] : [node]
    }
    const parts = run.map(id => nodeById.get(id)!)
    const starts = parts.flatMap(p => (p.stable ? [p.stable.start] : []))
    return [
      {
        ...node,
        length: parts.reduce((sum, p) => sum + p.length, 0),
        stable: node.stable && { ...node.stable, start: Math.min(...starts) },
      },
    ]
  })
  // the strand a link leaving the box reads it with, to leave from the side
  // of the box that its member's `side` is on
  const leaving = (id: string, box: string, side: 'start' | 'end') =>
    drawn(box, drawn(id, side)) === 'end'
      ? ownStrand(box)
      : otherStrand[ownStrand(box)]
  const edges = graph.edges.flatMap(edge => {
    const sides = strandSides(edge)
    const from = `${edge.from}:${sides.from}`
    const to = `${edge.to}:${sides.to}`
    if (inner.has(`${from}\t${to}`) || inner.has(`${to}\t${from}`)) {
      return []
    }
    const fromBox = boxOf.get(edge.from)
    const toBox = boxOf.get(edge.to)
    return [
      {
        ...edge,
        ...(fromBox === undefined
          ? {}
          : {
              from: fromBox,
              fromStrand: leaving(edge.from, fromBox, sides.from),
            }),
        ...(toBox === undefined
          ? {}
          : {
              to: toBox,
              toStrand: otherStrand[leaving(edge.to, toBox, sides.to)],
            }),
      },
    ]
  })
  const absorbedNames = new Set(
    [...absorbed].map(id => nodeById.get(id)?.name ?? id),
  )
  return {
    ...graph,
    nodes,
    edges,
    paths: graph.paths?.map(path => ({
      ...path,
      nodeIds: path.nodeIds.filter(id => !absorbed.has(id)),
    })),
    pathVisits:
      graph.pathVisits &&
      new Map(
        [...graph.pathVisits].filter(([name]) => !absorbedNames.has(name)),
      ),
  }
}

function runTubeMap(graph: Graph) {
  const paths = graph.paths ?? []
  const tracks = tubeMapTracks(graph)
  const reads = graph.reads
    ? tubeMapReads(graph, graph.reads, paths.length)
    : []
  const tubeColor = reads.length > 0 ? pathGreyCssColor : pathCssColor
  const pathColors = paths.map((_, i) => tubeColor(i, paths.length))
  const layout = layoutTubeMap(tubeMapNodes(graph), tracks, reads, {
    nodeWidthOption: 'compressed',
    trackWidth: tubeWidth(tracks.length),
  })
  if (!layout) {
    return undefined
  }
  const runs = mergedRuns(graph, layout, [...tracks, ...reads])
  return {
    layout,
    pathColors,
    members: runs.members,
    graph: boxGraph(graph, runs),
  }
}

// Drawn nodes only: an unreached one has no x.
function drawnNodes(layout: TubeMapLayout) {
  const nodes: LayoutNode[] = []
  layout.nodes.forEach(node => {
    if (node.order >= 0) {
      nodes.push(node)
    }
  })
  return nodes
}

function centreline(node: LayoutNode, yOffset: number, x0: number, x1: number) {
  const y = node.y + node.contentHeight / 2 - yOffset
  return [
    { x: x0, y },
    { x: x1, y },
  ]
}

function extentOf(layout: TubeMapLayout, yOffset: number) {
  return {
    minY: layout.bounds.minY - yOffset,
    maxY: layout.bounds.maxY - yOffset,
  }
}

export function tubeMapLayout(graph: Graph): LayoutResult | undefined {
  const run = hasTubeMapPaths(graph) ? runTubeMap(graph) : undefined
  if (!run) {
    return undefined
  }
  const { layout, ...drawing } = run
  const yOffset = layout.bounds.minY
  const nodePositions: Record<string, NodeSegment[]> = {}
  for (const node of drawnNodes(layout)) {
    nodePositions[node.name] = centreline(
      node,
      yOffset,
      node.x,
      node.x + node.pixelWidth,
    )
  }
  const { minY, maxY } = extentOf(layout, yOffset)
  return {
    nodePositions,
    tubeMap: { layout, yOffset, ...drawing },
    extent: {
      minX: layout.bounds.minX,
      maxX: layout.bounds.maxX,
      minY,
      maxY,
    },
  }
}

// Each column's reference bp: the span of its backbone nodes, or a point where the previous column ended for a
// column of inserted sequence alone. Clamped to run left to right, so an
// inversion the reference walks backwards cannot fold the axis over.
function tubeMapColumns(graph: Graph, layout: TubeMapLayout): TubeMapColumn[] {
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const byOrder = new Map<number, LayoutNode[]>()
  for (const node of drawnNodes(layout)) {
    const list = byOrder.get(node.order)
    if (list) {
      list.push(node)
    } else {
      byOrder.set(node.order, [node])
    }
  }
  const columns: TubeMapColumn[] = []
  let end = -Infinity
  for (const order of [...byOrder.keys()].sort((a, b) => a - b)) {
    const nodes = byOrder.get(order)!
    let bp0 = Infinity
    let bp1 = -Infinity
    for (const node of nodes) {
      const graphNode = nodeById.get(node.name)
      if (graphNode && isBackbone(graphNode)) {
        bp0 = Math.min(bp0, graphNode.stable.start)
        bp1 = Math.max(bp1, graphNode.stable.start + graphNode.length)
      }
    }
    if (bp0 === Infinity) {
      bp0 = bp1 = end
    }
    if (bp0 < end) {
      bp0 = end
      bp1 = Math.max(end, bp1)
    }
    end = Math.max(end, bp1)
    columns.push({
      order,
      x0: Math.min(...nodes.map(n => n.x)),
      x1: Math.max(...nodes.map(n => n.x + n.pixelWidth)),
      bp0,
      bp1,
    })
  }
  // columns before the first backbone node take its start
  const first = columns.find(c => c.bp0 !== -Infinity)
  for (const column of columns) {
    if (column.bp0 === -Infinity) {
      column.bp0 = column.bp1 = first?.bp0 ?? 0
    }
  }
  return columns
}

export function hasTubeMapBackbone(graph: Graph) {
  return hasTubeMapPaths(graph) && graph.nodes.some(isBackbone)
}

export function tubeMapReferenceLayout(graph: Graph): LayoutResult | undefined {
  const run = hasTubeMapBackbone(graph) ? runTubeMap(graph) : undefined
  if (!run) {
    return undefined
  }
  const { layout, ...drawing } = run
  const columns = tubeMapColumns(drawing.graph, layout)
  const byOrder = new Map(columns.map(c => [c.order, c]))
  const yOffset = layout.bounds.minY
  const nodePositions: Record<string, NodeSegment[]> = {}
  for (const node of drawnNodes(layout)) {
    const column = byOrder.get(node.order)!
    nodePositions[node.name] = centreline(node, yOffset, column.bp0, column.bp1)
  }
  return {
    nodePositions,
    tubeMap: { layout, yOffset, columns, ...drawing },
    referenceAxis: true,
    pixelRows: true,
    extent: extentOf(layout, yOffset),
  }
}
