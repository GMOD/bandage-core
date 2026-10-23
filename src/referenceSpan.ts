import { isBackbone } from './anchoredNodes'
import { pushTo } from './util/groups'

import type { Graph, GraphNode } from './types'

// How long an allele chain can be and still be located from both ends. An
// allele is a run of off-reference segments between two backbone flanks, so the
// two flanks sit at *different* hop depths from any segment in the middle and
// the walk has to keep going after it finds the first one. Minigraph alleles are
// short runs, so this reaches both flanks throughout the fixtures; a longer run
// degrades to the flanks it did reach rather than to nothing.
const MAX_BACKBONE_HOPS = 4

export interface ReferenceSpan {
  start: number
  end: number
}

// Undirected adjacency over node ids. Edges carry the topology in both
// directions for this purpose: finding the backbone a node hangs off doesn't
// care which way the L line was written.
export function buildNeighbors(graph: Graph) {
  const neighbors = new Map<string, string[]>()
  for (const edge of graph.edges) {
    pushTo(neighbors, edge.from, edge.to)
    pushTo(neighbors, edge.to, edge.from)
  }
  return neighbors
}

// The reference interval an allele branches into: between the end of the
// backbone segment upstream of it and the start of the one downstream.
// `[min(ends), max(starts)]` picks those two out of the reached flanks without
// needing to know which is which, and it degrades usefully in both directions —
// a pure insertion, whose flanks abut, collapses to the single reference point
// it is inserted at, and a bubble with only one flank inside the window yields
// that flank's own span.
function flankingSpan({
  nodeId,
  nodeById,
  neighbors,
}: {
  nodeId: string
  nodeById: Map<string, GraphNode>
  neighbors: Map<string, string[]>
}) {
  const seen = new Set([nodeId])
  let frontier = [nodeId]
  let minEnd = Infinity
  let maxStart = -Infinity

  // Backbone nodes are terminal — they are collected, never queued — so the walk
  // cannot cross the reference into a neighbouring bubble. It stays inside the
  // allele it started in and stops on its own at the flanks.
  for (let hop = 0; hop < MAX_BACKBONE_HOPS && frontier.length > 0; hop++) {
    const next: string[] = []
    for (const id of frontier) {
      const adjacent = neighbors.get(id)
      if (adjacent) {
        for (const neighborId of adjacent) {
          if (!seen.has(neighborId)) {
            seen.add(neighborId)
            const neighbor = nodeById.get(neighborId)
            if (neighbor && isBackbone(neighbor)) {
              minEnd = Math.min(minEnd, neighbor.stable.start + neighbor.length)
              maxStart = Math.max(maxStart, neighbor.stable.start)
            } else {
              next.push(neighborId)
            }
          }
        }
      }
    }
    frontier = next
  }

  return minEnd === Infinity
    ? undefined
    : {
        start: Math.min(minEnd, maxStart),
        end: Math.max(minEnd, maxStart),
      }
}

// The reference interval to highlight for a node, in the coordinates of the
// stable sequence the subgraph was cut from.
//
// A rank-0 node states its own, so the interval is exact. A rank>0 allele has
// none: its SO is an offset on a *different* stable sequence and is not
// comparable to the reference axis (see the axis note in
// layout/anchoredLayout.ts), so it is located by the backbone it branches from
// instead.
export function nodeReferenceSpan({
  nodeId,
  nodeById,
  neighbors,
}: {
  nodeId: string
  nodeById: Map<string, GraphNode>
  neighbors: Map<string, string[]>
}): ReferenceSpan | undefined {
  const node = nodeById.get(nodeId)
  return node === undefined
    ? undefined
    : isBackbone(node)
      ? { start: node.stable.start, end: node.stable.start + node.length }
      : flankingSpan({ nodeId, nodeById, neighbors })
}

// Every node's midpoint on the reference, keyed by id: what a position-based
// colour scheme ramps over. Alleles come through the same flanking walk hover
// sync uses, so a lane or a measured ramp extent can place them, though the
// node colouring paints them charcoal wherever they branch.
export function referenceMidpoints(graph: Graph) {
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]))
  const neighbors = buildNeighbors(graph)
  const midpoints = new Map<string, number>()
  for (const node of graph.nodes) {
    const span = nodeReferenceSpan({ nodeId: node.id, nodeById, neighbors })
    if (span) {
      midpoints.set(node.id, (span.start + span.end) / 2)
    }
  }
  return midpoints
}

// referenceMidpoints, with an allele chain too long for its flank search
// taking the nearest placed node's midpoint. Only a node nothing links to the
// reference stays unplaced.
export function referencePositions(graph: Graph) {
  const positions = referenceMidpoints(graph)
  const neighbors = buildNeighbors(graph)
  let frontier = [...positions.keys()]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      for (const neighborId of neighbors.get(id) ?? []) {
        if (!positions.has(neighborId)) {
          positions.set(neighborId, positions.get(id)!)
          next.push(neighborId)
        }
      }
    }
    frontier = next
  }
  return positions
}
