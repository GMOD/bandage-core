import { isBackbone } from './anchoredNodes'
import { NOT_LOADED_TEXT } from './gfa/departures'
import { formatBp, groupDigits } from './graphLabels'
import { paddedFeet } from './layout/replacementFeet'
import { panSNHaplotype } from './pansn'
import { weakMemo } from './util/weakMemo'

import type { DeletionEdge } from './deletionEdges'
import type { DeletionRoutes } from './layout/deletionRoutes'
import type { PaddedFoot } from './layout/replacementFeet'
import type { Graph, GraphEdge, GraphNode } from './types'

// A span as a reader states one: 1-based and inclusive, the way a node's own
// location reads, so a deletion and the nodes around it can be compared.
export function regionLabel(loc: {
  refName: string
  start: number
  end: number
}) {
  return `${loc.refName}:${groupDigits(loc.start + 1)}-${groupDigits(loc.end)}`
}

// What a hovered edge says. A deletion edge is the one link that means
// something on its own — the backbone it skips is sequence some haplotype does
// not carry — so it says how much and where rather than naming its endpoints.
// Any other edge names its two ends as the graph joins them, which needs the
// node's name rather than its id, strand and all.
export function edgeHoverText(
  edge: GraphEdge,
  skip: DeletionEdge | PaddedFoot | undefined,
  nameOf: (id: string) => string = id => id,
) {
  return skip
    ? {
        deletion:
          'sameStretch' in skip && !skip.sameStretch
            ? {}
            : {
                bp: `${groupDigits(skip.end - skip.start)} bp`,
                where: regionLabel(skip),
              },
      }
    : {
        ends: `${nameOf(edge.from)}${edge.fromStrand ?? ''} → ${nameOf(edge.to)}${edge.toStrand ?? ''}`,
      }
}

// The name a hover gives a node: none for sequence a fold made of the
// haplotypes' own, whose name the fold wrote from where it lies and its size
// and no file holds, so it goes by its length alone
export function nodeHoverName(
  graph: Pick<Graph, 'threadFold'> | undefined,
  node: GraphNode,
) {
  return graph?.threadFold && !isBackbone(node) ? undefined : node.name
}

// What a hovered placeholder says in place of a node's name, length and
// depth: whose route it is part of and that its nodes are not shown
export function placeholderHoverText(node: GraphNode) {
  const walk = node.stable?.refName ?? node.name
  return node.placeholder
    ? `${formatBp(node.length)} of ${panSNHaplotype(walk) ?? walk}'s route, ${NOT_LOADED_TEXT}`
    : undefined
}

const feetCache = weakMemo<Graph, ReadonlyMap<number, PaddedFoot>>()

// The skip a link is drawn as: the deletion it is, or a foot a force layout
// routed of a walk's run in place of longer reference
export function skipAt(
  graph: Graph,
  edgeIndex: number,
  deletions: readonly DeletionEdge[],
  routes: DeletionRoutes | undefined,
) {
  return (
    deletions.find(d => d.edgeIndex === edgeIndex) ??
    (routes?.[edgeIndex]
      ? feetCache(
          graph,
          [],
          () => new Map(paddedFeet(graph).map(foot => [foot.edgeIndex, foot])),
        ).get(edgeIndex)
      : undefined)
  )
}
