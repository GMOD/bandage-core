import type { GraphEdge } from '../types'

// Links in an order the graph states rather than the file: a layout that
// reads its links in turn, as FMMM and the allele sweep do, then draws the
// same graph the same whatever order its L lines came in. Each link is
// already in its canonical spelling (segmentOrientation.ts), so one sort key
// covers both of a link's spellings.
export function canonicalEdgeOrder<E extends GraphEdge>(edges: readonly E[]) {
  const key = (e: E) =>
    `${e.from}\t${e.to}\t${e.fromStrand ?? ''}${e.toStrand ?? ''}`
  return edges
    .map(e => ({ e, k: key(e) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map(({ e }) => e)
}
