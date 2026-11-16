import type { GraphEdge, GraphNode } from '../types'

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// Links in an order the graph states rather than the file: a layout that
// reads its links in turn, as FMMM and the allele sweep do, then draws the
// same graph the same whatever order its L lines came in. Each link is
// already in its canonical spelling (segmentOrientation.ts), so one sort key
// covers both of a link's spellings.
export function canonicalEdgeOrder<E extends GraphEdge>(edges: readonly E[]) {
  const key = (e: E) =>
    `${e.from}\t${e.to}\t${e.fromStrand ?? ''}${e.toStrand ?? ''}\t${e.fromStrand ?? ''}`
  return edges
    .map(e => ({ e, k: key(e) }))
    .sort((a, b) => byKey(a.k, b.k))
    .map(({ e }) => e)
}

const chunksOf = (id: string) =>
  (id.match(/\d+|\D+/g) ?? []).map(chunk =>
    /^\d/.test(chunk)
      ? { numeral: true, text: chunk.replace(/^0+(?=\d)/, '') }
      : { numeral: false, text: chunk },
  )

type Chunk = ReturnType<typeof chunksOf>[number]

const compareChunks = (a: Chunk, b: Chunk) =>
  a.numeral !== b.numeral
    ? a.numeral
      ? -1
      : 1
    : (a.numeral ? a.text.length - b.text.length : 0) || byKey(a.text, b.text)

function compareChunkLists(x: readonly Chunk[], y: readonly Chunk[]) {
  let order = 0
  for (let i = 0; order === 0 && i < Math.min(x.length, y.length); i++) {
    const a = x[i]
    const b = y[i]
    order = a && b ? compareChunks(a, b) : 0
  }
  return order || x.length - y.length
}

// Numbers in an id compare as numbers, 9+ before 10+ and s2 before s10, and
// the plain spelling settles the ids that leaves tied, 007 before 7
export function canonicalNodeOrder<N extends GraphNode>(nodes: readonly N[]) {
  return nodes
    .map(n => ({ n, chunks: chunksOf(n.id) }))
    .sort(
      (a, b) => compareChunkLists(a.chunks, b.chunks) || byKey(a.n.id, b.n.id),
    )
    .map(({ n }) => n)
}
