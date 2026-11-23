import { panSNHaplotype } from './pansn'

import type { Run } from './levelOfDetail'
import type { Graph, GraphNode, GraphPath } from './types'
import type { NodeInk } from './util/hitDetection'

// How thick a node draws. Bandage widens a node by its depth, the square root
// of its depth against the graph's mean, so a contig every read covers is fat
// and a spurious one is a hair. In a pangenome cut depth is carriage, how many
// walks go through the node, and the walks mode draws that count on a linear
// scale shared with links by walks, so the thicknesses at a fork add up. The
// frequency mode draws carriage on a fixed scale, so a node every haplotype
// passes once is `contigThickness` wide in any graph. One table drives the
// persisted enum and the dropdown, the way BUBBLE_SPREADS does.
export const NODE_WIDTHS = [
  {
    value: 'walks',
    label: 'By walks',
    description:
      'As thick as the passes the walks make through a node, on one linear scale with links by walks, so the thicknesses at a fork add up. Uniform while a walk holds nodes not loaded, and by depth in a graph without walks.',
  },
  {
    value: 'depth',
    label: 'By depth',
    description:
      'Thicker the more paths carry a node, on the square root of its depth against the mean. A graph with one depth everywhere draws uniform.',
  },
  {
    value: 'frequency',
    label: 'By frequency',
    description:
      'As wide as the share of haplotypes that pass a node, or its AF tag: full width at 100%, half at 50%, and wider where a haplotype passes it more than once.',
  },
  {
    value: 'uniform',
    label: 'Uniform',
    description: 'Every node the same thickness.',
  },
] as const

export type NodeWidth = (typeof NODE_WIDTHS)[number]['value']

const MIN_FACTOR = 0.3
const MAX_FACTOR = 3
// a hairline, so a 1% allele still draws, and 10% still draws wider
const MIN_FREQUENCY_FACTOR = 0.05
// Under `walks`, a node this many passes cross is `contigThickness` thick, so
// the default 6 px draws a pass 1 px, unless the most passes a node takes
// would then draw it over MAX_FACTOR times that
const PASSES_AT_CONTIG_THICKNESS = 6
// the thinnest a walked node or link draws under `walks`
export const MIN_WALKS_PX = 1
// a node or link no walk takes, in a graph that lists one, since nothing
// travels it
export const UNWALKED_PX = 0.5

// Length-weighted, as Bandage's mean depth is, so a cut's long reference nodes
// set the norm and the alleles read against it.
export function meanDepth(graph: Graph) {
  let weighted = 0
  let length = 0
  for (const node of graph.nodes) {
    weighted += node.depth * node.length
    length += node.length
  }
  return length > 0 ? weighted / length : 0
}

export function haplotypeOf(path: GraphPath) {
  return path.sample === undefined
    ? (panSNHaplotype(path.name) ?? path.name)
    : `${path.sample}#${path.haplotype ?? 0}`
}

// The haplotypes the graph's walks belong to, numbered as met, a contig split
// into several records one haplotype
export function haplotypeIndex(graph: Graph) {
  const index = new Map<string, number>()
  for (const path of graph.paths ?? []) {
    const haplotype = haplotypeOf(path)
    if (!index.has(haplotype)) {
      index.set(haplotype, index.size)
    }
  }
  return index
}

export function haplotypeCount(graph: Graph) {
  return haplotypeIndex(graph).size
}

// The node's passes per haplotype: its AF tag, or its depth over the
// haplotypes. Above 1 where a haplotype passes the node more than once, as
// through a repeat's copies; undefined with neither.
export function nodeFrequency(node: GraphNode, haplotypes: number) {
  return (
    node.frequency ?? (haplotypes > 0 ? node.depth / haplotypes : undefined)
  )
}

// The graph with each segment `frequencies` names taking that frequency, as an
// AF tag would give it
export function withFrequencies(
  graph: Graph,
  frequencies: Readonly<Record<string, number>> | undefined,
): Graph {
  if (!frequencies) {
    return graph
  }
  const nodes = graph.nodes.map(node => {
    const frequency = frequencies[node.name]
    return frequency === undefined ? node : { ...node, frequency }
  })
  return { ...graph, nodes }
}

// Whether a walk holds nodes the cut did not load, whose passes no node's
// depth counts: what its placeholders stand in for are nodes it passes
export const passesUncounted = (graph: Graph) =>
  graph.nodes.some(node => node.placeholder)

// What a width setting draws on a graph: `walks` counts passes only where
// the graph has walks, its file states no depths, and every pass of its walks
// is loaded; by depth without walks, and uniform while passes go uncounted
export function drawnNodeWidth(graph: Graph, nodeWidth: NodeWidth): NodeWidth {
  return nodeWidth !== 'walks'
    ? nodeWidth
    : !graph.paths?.length || graph.depthStated
      ? 'depth'
      : passesUncounted(graph)
        ? 'uniform'
        : 'walks'
}

// The passes a `contigThickness`-thick node takes under `walks`: six, or
// where the busiest node would then draw over MAX_FACTOR times as thick, its
// passes over MAX_FACTOR
export function passesAtContigThickness(graph: Graph) {
  let most = 0
  for (const node of graph.nodes) {
    if (!node.placeholder) {
      most = Math.max(most, node.depth)
    }
  }
  return Math.max(PASSES_AT_CONTIG_THICKNESS, most / MAX_FACTOR)
}

// How thick `passes` draw under `walks`, at `perPass` px a pass
export const walksPx = (passes: number, perPass: number) =>
  passes === 0 ? UNWALKED_PX : Math.max(MIN_WALKS_PX, passes * perPass)

// What a width is measured against: the mean depth, the haplotype count, or
// the passes a contigThickness-thick node takes
export function widthNorm(graph: Graph, nodeWidth: NodeWidth) {
  return nodeWidth === 'depth'
    ? meanDepth(graph)
    : nodeWidth === 'frequency'
      ? haplotypeCount(graph)
      : nodeWidth === 'walks'
        ? passesAtContigThickness(graph)
        : 0
}

function frequencyFactor(f: number) {
  return Math.min(MAX_FACTOR, Math.max(MIN_FREQUENCY_FACTOR, f))
}

function frequencyWidthFactor(node: GraphNode, haplotypes: number) {
  const f = nodeFrequency(node, haplotypes)
  return f === undefined ? 1 : frequencyFactor(f)
}

// The widths a key for `nodeWidth: 'frequency'` shows, each with its share
export function frequencyKey(contigThickness: number) {
  return [1, 0.5, 0.1].map(f => ({
    label: `${f * 100}%`,
    widthPx: contigThickness * frequencyFactor(f),
  }))
}

function depthWidthFactor(depth: number, mean: number) {
  if (!(mean > 0) || !(depth >= 0)) {
    return 1
  }
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, Math.sqrt(depth / mean)))
}

// The ends of the depth scale among the `shown` nodes, or every node, thickest
// first, each as wide as a node of that depth draws against the whole graph's
// mean; one where they share a depth, none where there are none
export function depthKey(
  graph: Graph,
  contigThickness: number,
  shown?: ReadonlySet<string>,
) {
  let min = Infinity
  let max = -Infinity
  for (const { id, depth } of graph.nodes) {
    if (!shown || shown.has(id)) {
      min = Math.min(min, depth)
      max = Math.max(max, depth)
    }
  }
  const mean = meanDepth(graph)
  return (min < max ? [max, min] : min === max ? [max] : []).map(depth => ({
    depth,
    widthPx: contigThickness * depthWidthFactor(depth, mean),
  }))
}

// How wide a node is drawn, in screen px. One function for the geometry and
// for the hit test, so the pointer finds a node exactly where its ink is.
// `norm` is widthNorm's, and `nodeWidth` drawnNodeWidth's.
export function nodeWidthPx(
  node: GraphNode,
  contigThickness: number,
  nodeWidth: NodeWidth,
  norm: number,
) {
  return nodeWidth === 'walks' && norm > 0
    ? walksPx(node.depth, contigThickness / norm)
    : contigThickness *
        (nodeWidth === 'depth'
          ? depthWidthFactor(node.depth, norm)
          : nodeWidth === 'frequency'
            ? frequencyWidthFactor(node, norm)
            : 1)
}

export function maxNodeWidthPx(contigThickness: number, nodeWidth: NodeWidth) {
  return contigThickness * (nodeWidth === 'uniform' ? 1 : MAX_FACTOR)
}

// A lifted walk's lane is never thinner than this, so a node carrying three
// lifted walks widens rather than splitting into hairlines
export const MIN_WALK_LANE_PX = 4

// One lane's width when a node of `width` carries `lanes` lifted walks
export function walkLaneWidthPx(width: number, lanes: number) {
  return Math.max(width / lanes, MIN_WALK_LANE_PX)
}

// A lane that states how many haplotypes it stands for, as a thread of a
// folded graph does (threadFold.ts), is as wide as that count says, on a log
// scale as the tube map's tubes are, so a thread of one haplotype and a thread
// of hundreds both show
export const COUNT_LANE_PX = 3
export const COUNT_LANE_LOG_PX = 2

export function countLaneWidthPx(count: number) {
  return COUNT_LANE_PX + COUNT_LANE_LOG_PX * Math.log(Math.max(count, 1))
}

// Each lane's width and its middle's offset from the middle of the band they
// make side by side, where any lane states a count: the same on every node,
// whatever the node's own width, so a lane runs straight from node to node
export function countLanes(lanes: readonly { count?: number }[]) {
  const widths = lanes.map(lane => countLaneWidthPx(lane.count ?? 1))
  const band = widths.reduce((a, b) => a + b, 0)
  let at = -band / 2
  return lanes.some(lane => lane.count !== undefined)
    ? {
        widths,
        band,
        offsets: widths.map(width => {
          at += width
          return at - width / 2
        }),
      }
    : undefined
}

// The width the reference through a run of folded sites is drawn at: the
// thinner of the drawn reference nodes at its two ends, or `own` where
// neither is known
export function runWidthPx(
  run: Run,
  own: number,
  widthOf: (id: string) => number | undefined,
) {
  const widths = [...run.from, ...run.to].flatMap(id => {
    const width = widthOf(id)
    return width === undefined ? [] : [width]
  })
  return widths.length > 0
    ? widths.reduce((a, b) => Math.min(a, b), Infinity)
    : own
}

// How far each node's ink reaches from its centreline, for the hit test: the
// widths the geometry draws with, from the same function. With `lanes` lifted
// walks, their number or the walks themselves where they may state counts,
// the node draws as that many side-by-side lanes, which can reach
// further than the node's own width. A reference node inside a run of folded
// sites, `through` the batch's collapsed.through, reaches as far as the run
// is drawn.
export function nodeInk(
  graph: Graph | undefined,
  nodeById: ReadonlyMap<string, GraphNode> | undefined,
  contigThickness: number,
  nodeWidth: NodeWidth,
  lanes: number | readonly { count?: number }[] = 0,
  through?: ReadonlyMap<string, Run>,
): NodeInk {
  const drawn = graph ? drawnNodeWidth(graph, nodeWidth) : nodeWidth
  const norm = graph ? widthNorm(graph, drawn) : 0
  const laneCount = typeof lanes === 'number' ? lanes : lanes.length
  const counted = typeof lanes === 'number' ? undefined : countLanes(lanes)
  const reach = (width: number) =>
    counted
      ? Math.max(counted.band, width) / 2
      : laneCount > 0
        ? (walkLaneWidthPx(width, laneCount) * laneCount) / 2
        : width / 2
  const widthOf = (id: string) => {
    const node = nodeById?.get(id)
    return node ? nodeWidthPx(node, contigThickness, drawn, norm) : undefined
  }
  return {
    maxHalfWidthPx: reach(maxNodeWidthPx(contigThickness, drawn)),
    halfWidthPx: id => {
      const own = widthOf(id) ?? contigThickness
      const run = through?.get(id)
      return reach(run ? runWidthPx(run, own, widthOf) : own)
    },
  }
}
