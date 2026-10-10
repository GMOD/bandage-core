import { isBackbone } from './anchoredNodes'
import { ownStrand } from './util/geometry'

import type { Graph, GraphEdge, GraphNode } from './types'

// A graph drawn at a zoom where nothing under `belowBp` can show: every allele
// shorter than that, and every deletion skipping less, folds into the
// reference.
//
// An allele is a run of segments contiguous on one stable sequence at one
// rank: the stretch one assembly contributed, which the junctions later
// assemblies cut it at do not break. One is big when its own length, or the
// reference between the backbone it hangs from, reaches `belowBp`. The fold
// keeps the backbone, every big allele, and from each big allele's two ends
// the shortest way back to the backbone, so nothing big is cut loose and
// everything else goes, however tangled. Folding bubble by bubble stalls in a
// tangle: at bovine DEFB it left 98 alleles under 50 kb that this removes.
//
// Kept segments keep their ids. A run of one allele's segments that no kept
// link branches off merges into its first segment, so the result is itself an
// rGFA graph and folding it again at a larger threshold folds the original at
// that one. That is what lets a coarse tier built by this fold and the same
// fold run on a fine cut draw the same picture.
//
// A graph with walks is returned as it is, since a folded detour would need
// every walk rerouted along what is kept, and so is a graph with no backbone.
export function foldVariants(graph: Graph, belowBp: number): Graph {
  if (
    !(belowBp > 0) ||
    graph.paths?.length ||
    !graph.nodes.some(node => isBackbone(node))
  ) {
    return graph
  }
  const { nodes, edges } = graph
  const index = new Map(nodes.map((node, i) => [node.id, i]))
  const sides = edges.map(forwardSides)
  const links = linksAt(nodes.length, edges, sides, index)
  const allele = alleleOf(nodes, edges, sides, index)
  const members = groupBy(allele)

  const kept = new Uint8Array(nodes.length)
  const big: number[][] = []
  for (const group of members.values()) {
    if (alleleContent(group, nodes, links, allele) >= belowBp) {
      for (const i of group) {
        kept[i] = 1
      }
      if (!isBackbone(nodes[group[0]!]!)) {
        big.push(group)
      }
    }
  }

  const { dist, pred } = distancesFromBackbone(nodes, links)
  for (const group of big) {
    for (const [i, side] of alleleEnds(group, nodes, links, allele)) {
      let next = nearestOutside(i, side, links, allele, dist, nodes)
      while (next !== undefined && !kept[next]) {
        kept[next] = 1
        next = isBackbone(nodes[next]!) ? undefined : pred[next]
      }
    }
  }

  const keptEdges = edges.filter((edge, k) => {
    const a = index.get(edge.from)
    const b = index.get(edge.to)
    if (a === undefined || b === undefined) {
      return false
    }
    const skip = skipped(nodes[a]!, sides[k]!.from, nodes[b]!, sides[k]!.to)
    return kept[a] && kept[b] && !(skip > 0 && skip < belowBp)
  })
  return mergeAlleleRuns({ ...graph, edges: keptEdges }, kept, allele)
}

type Side = 's' | 'e'

interface Link {
  other: number
  // the side of this node the link attaches to
  side: Side
}

// The ends a link joins, on each segment's own forward strand: `L a + b +`
// leaves a's end and enters b's start. An absent strand reads as the id's own.
function forwardSides(edge: GraphEdge): { from: Side; to: Side } {
  return {
    from: (edge.fromStrand ?? ownStrand(edge.from)) === '+' ? 'e' : 's',
    to: (edge.toStrand ?? ownStrand(edge.to)) === '+' ? 's' : 'e',
  }
}

function linksAt(
  count: number,
  edges: GraphEdge[],
  sides: { from: Side; to: Side }[],
  index: Map<string, number>,
) {
  const links: Link[][] = Array.from({ length: count }, () => [])
  edges.forEach((edge, k) => {
    const a = index.get(edge.from)
    const b = index.get(edge.to)
    if (a !== undefined && b !== undefined) {
      links[a]!.push({ other: b, side: sides[k]!.from })
      links[b]!.push({ other: a, side: sides[k]!.to })
    }
  })
  return links
}

// Both segments' places, when they lie on one stable sequence at one rank
function onOneSequence(a: GraphNode, b: GraphNode) {
  const sa = a.stable
  const sb = b.stable
  return sa && sb?.refName === sa.refName && sb.rank === sa.rank
    ? ([sa, sb] as const)
    : undefined
}

// Whether a link reads one stable sequence straight on: it joins opposite
// ends of two segments that abut there. Either way round, since a path GFA's
// reference reads some segments reversed (`L a - b -`) and an index keeps no
// strand to say which.
function continues(a: GraphNode, aSide: Side, b: GraphNode, bSide: Side) {
  const pair = onOneSequence(a, b)
  if (!pair || aSide === bSide) {
    return false
  }
  const [sa, sb] = pair
  return sa.start + a.length === sb.start || sb.start + b.length === sa.start
}

// Reference bp a link jumps between two segments of one stable sequence at
// one rank, which is a deletion on that sequence; 0 for any other link
function skipped(a: GraphNode, aSide: Side, b: GraphNode, bSide: Side) {
  const pair = onOneSequence(a, b)
  if (!pair || continues(a, aSide, b, bSide)) {
    return 0
  }
  const [sa, sb] = pair
  return Math.max(
    sb.start - (sa.start + a.length),
    sa.start - (sb.start + b.length),
  )
}

function alleleOf(
  nodes: GraphNode[],
  edges: GraphEdge[],
  sides: { from: Side; to: Side }[],
  index: Map<string, number>,
) {
  const parent = nodes.map((_, i) => i)
  const find = (i: number) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  edges.forEach((edge, k) => {
    const a = index.get(edge.from)
    const b = index.get(edge.to)
    if (
      a !== undefined &&
      b !== undefined &&
      continues(nodes[a]!, sides[k]!.from, nodes[b]!, sides[k]!.to)
    ) {
      parent[find(a)] = find(b)
    }
  })
  return nodes.map((_, i) => find(i))
}

function groupBy(allele: number[]) {
  const groups = new Map<number, number[]>()
  allele.forEach((root, i) => {
    const group = groups.get(root)
    if (group) {
      group.push(i)
    } else {
      groups.set(root, [i])
    }
  })
  return groups
}

// An allele's own length, or the reference between the backbone it hangs
// from where that is longer: a 93 bp segment standing in for 7 kb of
// reference is a 7 kb deletion. The backbone is never folded.
function alleleContent(
  group: number[],
  nodes: GraphNode[],
  links: Link[][],
  allele: number[],
) {
  if (isBackbone(nodes[group[0]!]!)) {
    return Infinity
  }
  let length = 0
  let refName: string | undefined
  let lo = Infinity
  let hi = -Infinity
  let oneSequence = true
  for (const i of group) {
    length += nodes[i]!.length
    for (const { other } of links[i]!) {
      const node = nodes[other]!
      if (allele[other] !== allele[i] && isBackbone(node)) {
        refName ??= node.stable.refName
        oneSequence &&= node.stable.refName === refName
        lo = Math.min(lo, node.stable.start + node.length)
        hi = Math.max(hi, node.stable.start)
      }
    }
  }
  return oneSequence && hi > lo ? Math.max(length, hi - lo) : length
}

// Where an allele meets the rest of the graph: each side of its first and
// last segment, in its stable sequence's order, that no link to the allele's
// own segments uses
function alleleEnds(
  group: number[],
  nodes: GraphNode[],
  links: Link[][],
  allele: number[],
) {
  const start = (i: number) => nodes[i]!.stable?.start ?? 0
  const end = (i: number) => start(i) + nodes[i]!.length
  let first = group[0]!
  let last = group[0]!
  for (const i of group) {
    if (start(i) < start(first)) {
      first = i
    }
    if (end(i) > end(last)) {
      last = i
    }
  }
  const ends: [number, Side][] = []
  for (const i of new Set([first, last])) {
    for (const side of ['s', 'e'] as const) {
      if (
        !links[i]!.some(
          link => link.side === side && allele[link.other] === allele[i],
        )
      ) {
        ends.push([i, side])
      }
    }
  }
  return ends
}

// The neighbour off one end of an allele nearest the backbone, ties to the
// lower id so the choice does not depend on the order nodes arrived in
function nearestOutside(
  i: number,
  side: Side,
  links: Link[][],
  allele: number[],
  dist: Float64Array,
  nodes: GraphNode[],
) {
  let best: number | undefined
  for (const link of links[i]!) {
    const j = link.other
    if (
      link.side === side &&
      allele[j] !== allele[i] &&
      Number.isFinite(dist[j]!) &&
      (best === undefined ||
        dist[j]! < dist[best]! ||
        (dist[j] === dist[best] && nodes[j]!.id < nodes[best]!.id))
    ) {
      best = j
    }
  }
  return best
}

// Shortest bp from every node back to the backbone, and the neighbour that
// way lies through, ties to the lower id
function distancesFromBackbone(nodes: GraphNode[], links: Link[][]) {
  const dist = new Float64Array(nodes.length).fill(Infinity)
  const pred = new Int32Array(nodes.length).fill(-1)
  const heap = new MinHeap<[number, number]>(
    ([da, a], [db, b]) => da - db || cmp(nodes[a]!.id, nodes[b]!.id),
  )
  nodes.forEach((node, i) => {
    if (isBackbone(node)) {
      dist[i] = 0
      heap.push([0, i])
    }
  })
  for (let top = heap.pop(); top !== undefined; top = heap.pop()) {
    const [d0, i] = top
    if (d0 > dist[i]!) {
      continue
    }
    for (const { other } of links[i]!) {
      if (isBackbone(nodes[other]!)) {
        continue
      }
      const d = d0 + nodes[other]!.length
      if (d < dist[other]!) {
        dist[other] = d
        pred[other] = i
        heap.push([d, other])
      } else if (
        d === dist[other] &&
        cmp(nodes[i]!.id, nodes[pred[other]!]!.id) < 0
      ) {
        pred[other] = i
      }
    }
  }
  return { dist, pred: Array.from(pred, p => (p < 0 ? undefined : p)) }
}

function cmp(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0
}

class MinHeap<T> {
  private items: T[] = []

  constructor(private readonly order: (a: T, b: T) => number) {}

  push(item: T) {
    const { items } = this
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (this.order(items[i]!, items[up]!) >= 0) {
        break
      }
      ;[items[i], items[up]] = [items[up]!, items[i]!]
      i = up
    }
  }

  pop() {
    const { items } = this
    const top = items[0]
    const last = items.pop()
    if (items.length > 0 && last !== undefined) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < items.length && this.order(items[l]!, items[m]!) < 0) {
          m = l
        }
        if (r < items.length && this.order(items[r]!, items[m]!) < 0) {
          m = r
        }
        if (m === i) {
          break
        }
        ;[items[i], items[m]] = [items[m]!, items[i]!]
        i = m
      }
    }
    return top
  }
}

// Consecutive kept segments of one allele, joined by the one kept link at the
// junction between them, become one segment over the run, named for the one
// that starts it and read along the stable sequence
function mergeAlleleRuns(
  graph: Graph,
  kept: Uint8Array,
  allele: number[],
): Graph {
  const { nodes, edges } = graph
  const index = new Map(nodes.map((node, i) => [node.id, i]))
  const sides = edges.map(forwardSides)
  const ends = edges.map((edge, k) => [
    { i: index.get(edge.from)!, side: sides[k]!.from },
    { i: index.get(edge.to)!, side: sides[k]!.to },
  ])
  const degree = new Map<string, number>()
  const sideKey = (i: number, side: Side) => `${i}${side}`
  for (const pair of ends) {
    for (const { i, side } of pair) {
      degree.set(sideKey(i, side), (degree.get(sideKey(i, side)) ?? 0) + 1)
    }
  }
  // the next segment along the sequence, and the side each joins it by
  const next = new Map<number, { j: number; out: Side; in: Side }>()
  const hasPrev = new Set<number>()
  const internal = new Set<number>()
  ends.forEach(([a, b], k) => {
    if (
      a!.i !== b!.i &&
      allele[a!.i] === allele[b!.i] &&
      continues(nodes[a!.i]!, a!.side, nodes[b!.i]!, b!.side) &&
      degree.get(sideKey(a!.i, a!.side)) === 1 &&
      degree.get(sideKey(b!.i, b!.side)) === 1
    ) {
      const [left, right] =
        nodes[a!.i]!.stable!.start < nodes[b!.i]!.stable!.start
          ? [a!, b!]
          : [b!, a!]
      next.set(left.i, { j: right.i, out: left.side, in: right.side })
      hasPrev.add(right.i)
      internal.add(k)
    }
  })
  // a run member's outer side, as the merged segment's start or end
  const headOf = nodes.map((_, i) => i)
  const outer = new Map<string, Side>()
  const merged = new Map<number, GraphNode>()
  nodes.forEach((_, i) => {
    if (!kept[i] || hasPrev.has(i) || !next.has(i)) {
      return
    }
    const run = [i]
    let into = flip(next.get(i)!.out)
    outer.set(sideKey(i, into), 's')
    for (let step = next.get(i); step; step = next.get(step.j)) {
      run.push(step.j)
      into = step.in
    }
    outer.set(sideKey(run.at(-1)!, flip(into)), 'e')
    for (const j of run) {
      headOf[j] = i
    }
    merged.set(i, mergedNode(run.map(j => nodes[j]!)))
  })
  const endpoint = ({ i, side }: { i: number; side: Side }) => ({
    id: nodes[headOf[i]!]!.id,
    side:
      headOf[i] === i && !merged.has(i) ? side : outer.get(sideKey(i, side))!,
  })
  return {
    ...graph,
    nodes: nodes.flatMap((node, i) =>
      !kept[i] || headOf[i] !== i ? [] : [merged.get(i) ?? node],
    ),
    edges: edges.flatMap((edge, k) => {
      if (internal.has(k)) {
        return []
      }
      const [a, b] = ends[k]!
      if (!merged.has(headOf[a!.i]!) && !merged.has(headOf[b!.i]!)) {
        return [edge]
      }
      const from = endpoint(a!)
      const to = endpoint(b!)
      return [
        {
          ...edge,
          from: from.id,
          to: to.id,
          fromStrand: from.side === 'e' ? '+' : '-',
          toStrand: to.side === 's' ? '+' : '-',
        },
      ]
    }),
  }
}

function flip(side: Side): Side {
  return side === 's' ? 'e' : 's'
}

function mergedNode(run: GraphNode[]): GraphNode {
  const { samples: firstSamples, ...first } = run[0]!
  const length = run.reduce((sum, node) => sum + node.length, 0)
  const depth =
    length > 0
      ? run.reduce((sum, node) => sum + node.depth * node.length, 0) / length
      : first.depth
  const samples = run.every(node => node.samples)
    ? run.reduce(
        (common, node) => common.filter(s => node.samples!.includes(s)),
        firstSamples!,
      )
    : undefined
  return samples
    ? { ...first, length, depth, samples }
    : { ...first, length, depth }
}
