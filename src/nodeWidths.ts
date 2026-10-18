import type { Graph, GraphNode } from './types'
import type { NodeInk } from './util/hitDetection'

// How thick a node draws. Bandage widens a node by its depth, the square root
// of its depth against the graph's mean, so a contig every read covers is fat
// and a spurious one is a hair. In a pangenome cut depth is carriage, how many
// walks go through the node, and the same rule makes the reference thick and a
// private allele thin. One table drives the persisted enum and the dropdown,
// the way BUBBLE_SPREADS does.
export const NODE_WIDTHS = [
  {
    value: 'depth',
    label: 'By depth',
    description:
      'Thicker the more paths carry a node, on the square root of its depth against the mean. A graph with one depth everywhere draws uniform.',
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

function depthWidthFactor(node: GraphNode, mean: number) {
  if (!(mean > 0) || !(node.depth > 0)) {
    return 1
  }
  return Math.min(
    MAX_FACTOR,
    Math.max(MIN_FACTOR, Math.sqrt(node.depth / mean)),
  )
}

// How wide a node is drawn, in screen px. One function for the geometry and
// for the hit test, so the pointer finds a node exactly where its ink is.
export function nodeWidthPx(
  node: GraphNode,
  contigThickness: number,
  nodeWidth: NodeWidth,
  mean: number,
) {
  return (
    contigThickness * (nodeWidth === 'depth' ? depthWidthFactor(node, mean) : 1)
  )
}

export function maxNodeWidthPx(contigThickness: number, nodeWidth: NodeWidth) {
  return contigThickness * (nodeWidth === 'depth' ? MAX_FACTOR : 1)
}

// A lifted walk's lane is never thinner than this, so a node carrying three
// lifted walks widens rather than splitting into hairlines
const MIN_WALK_LANE_PX = 4

// One lane's width when a node of `width` carries `lanes` lifted walks
export function walkLaneWidthPx(width: number, lanes: number) {
  return Math.max(width / lanes, MIN_WALK_LANE_PX)
}

// How far each node's ink reaches from its centreline, for the hit test: the
// widths the geometry draws with, from the same function. With `lanes` lifted
// walks the node draws as that many side-by-side lanes, which can reach
// further than the node's own width.
export function nodeInk(
  graph: Graph | undefined,
  nodeById: ReadonlyMap<string, GraphNode> | undefined,
  contigThickness: number,
  nodeWidth: NodeWidth,
  lanes = 0,
): NodeInk {
  const mean = graph ? meanDepth(graph) : 0
  const reach = (width: number) =>
    lanes > 0 ? (walkLaneWidthPx(width, lanes) * lanes) / 2 : width / 2
  return {
    maxHalfWidthPx: reach(maxNodeWidthPx(contigThickness, nodeWidth)),
    halfWidthPx: id => {
      const node = nodeById?.get(id)
      return reach(
        node
          ? nodeWidthPx(node, contigThickness, nodeWidth, mean)
          : contigThickness,
      )
    },
  }
}
