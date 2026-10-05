import type { DeletionEdge } from './deletionEdges'
import type { GraphEdge } from './types'

// A span as a reader states one: 1-based and inclusive, the way a node's own
// location reads, so a deletion and the nodes around it can be compared.
export function regionLabel(loc: {
  refName: string
  start: number
  end: number
}) {
  return `${loc.refName}:${(loc.start + 1).toLocaleString()}-${loc.end.toLocaleString()}`
}

// What a hovered edge says. A deletion edge is the one link that means
// something on its own — the backbone it skips is sequence some haplotype does
// not carry — so it says how much and where rather than naming its endpoints.
// Any other edge names its two ends as the graph joins them, which needs the
// node's name rather than its id, strand and all.
export function edgeHoverText(
  edge: GraphEdge,
  deletion: DeletionEdge | undefined,
  nameOf: (id: string) => string = id => id,
) {
  return deletion
    ? {
        deletion: {
          bp: `${deletion.bp.toLocaleString()} bp`,
          where: regionLabel(deletion),
        },
      }
    : {
        ends: `${nameOf(edge.from)}${edge.fromStrand ?? ''} → ${nameOf(edge.to)}${edge.toStrand ?? ''}`,
      }
}
