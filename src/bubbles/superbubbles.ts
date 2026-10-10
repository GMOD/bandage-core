import { coversGraph } from './bubbleHalos'
import { SATURATED_PATH_COUNT } from './bubbleLine'
import { bubblesFromGraph, walkIndexOf, walkRoutes } from './bubblesFromGraph'
import { bubbleSegmentIds } from './classifyBubble'
import { bubbleSubgraph } from './popBubble'
import { isBackbone } from '../anchoredNodes'
import { strandSides } from '../util/geometry'

import type { MinigraphBubble } from './bubbleLine'
import type { Routes } from './bubblesFromGraph'
import type { Graph, GraphNode } from '../types'

// Superbubbles (Onodera et al. 2013) as BubbleGun finds them
// (find_bubbles.py's find_sb_alg): from one side of a source, take a node once
// every link into it has been taken, until one node is left and nothing else
// is pending. That node is the sink. A tip or a link back to the source ends
// the search. Unlike bubblesFromGraph this needs no reference, so it opens a
// bubble whose own interior the reach rule cannot split.

// A node side is a slot, node * 2 for its start and node * 2 + 1 for its end
interface Found {
  // the slot the source faces into the bubble with
  source: number
  // the slot the sink faces out of it with
  sink: number
  // the slot each interior node was left by, in topological order
  inside: Int32Array
}

function slotGraph(graph: Graph, index: Map<string, number>) {
  const slots = graph.nodes.length * 2
  const seen = new Set<number>()
  const pairs: number[] = []
  const degree = new Int32Array(slots)
  for (const e of graph.edges) {
    const a = index.get(e.from)
    const b = index.get(e.to)
    if (a === undefined || b === undefined) {
      continue
    }
    const sides = strandSides(e)
    const ka = a * 2 + (sides.from === 'end' ? 1 : 0)
    const kb = b * 2 + (sides.to === 'end' ? 1 : 0)
    const id = Math.min(ka, kb) * slots + Math.max(ka, kb)
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    pairs.push(ka, kb)
    degree[ka]!++
    if (ka !== kb) {
      degree[kb]!++
    }
  }
  const offset = new Int32Array(slots + 1)
  for (let k = 0; k < slots; k++) {
    offset[k + 1] = offset[k]! + degree[k]!
  }
  const next = new Int32Array(offset[slots]!)
  const fill = offset.slice(0, slots)
  for (let i = 0; i < pairs.length; i += 2) {
    const ka = pairs[i]!
    const kb = pairs[i + 1]!
    next[fill[ka]!++] = kb
    if (ka !== kb) {
      next[fill[kb]!++] = ka
    }
  }
  return { offset, next }
}

function searcher(nodes: number, offset: Int32Array, next: Int32Array) {
  const visited = new Int32Array(nodes)
  const pending = new Uint8Array(nodes * 2)
  const stack = new Int32Array(nodes * 2)
  const inside = new Int32Array(nodes)
  const touched: number[] = []
  let stamp = 0
  return (start: number): Found | undefined => {
    const s = start >> 1
    stamp++
    touched.length = 0
    let open = 0
    let top = 0
    let count = 0
    let found: Found | undefined
    const expect = (k: number) => {
      if (!pending[k]) {
        pending[k] = 1
        open++
        touched.push(k)
      }
    }
    expect(start)
    stack[top++] = start
    search: while (top > 0) {
      const k = stack[--top]!
      const v = k >> 1
      visited[v] = stamp
      if (v !== s) {
        inside[count++] = k
      }
      if (pending[k]) {
        pending[k] = 0
        open--
      }
      if (offset[k] === offset[k + 1]) {
        break
      }
      for (let p = offset[k]!; p < offset[k + 1]!; p++) {
        const entry = next[p]!
        const u = entry >> 1
        if (u === s) {
          break search
        }
        expect(entry ^ 1)
        if (visited[u] === stamp) {
          continue
        }
        let ready = true
        for (let q = offset[entry]!; q < offset[entry + 1]!; q++) {
          if (visited[next[q]! >> 1] !== stamp) {
            ready = false
            break
          }
        }
        if (ready) {
          stack[top++] = entry ^ 1
        }
      }
      if (top === 1 && open === 1) {
        if (count > 0) {
          found = {
            source: start,
            sink: stack[0]!,
            inside: inside.slice(0, count),
          }
        }
        break
      }
    }
    for (const k of touched) {
      pending[k] = 0
    }
    return found
  }
}

function reversed(f: Found): Found {
  return {
    source: f.sink ^ 1,
    sink: f.source ^ 1,
    inside: f.inside.map(k => k ^ 1).reverse(),
  }
}

const collator = new Intl.Collator(undefined, { numeric: true })

function onReference(a: GraphNode, b: GraphNode) {
  return isBackbone(a) && isBackbone(b) && a.stable.refName === b.stable.refName
}

// Reference order where both ends are on it, else whichever way leaves the
// source by its end, so a bubble reads the same way whichever end the search
// found it from and runs along its links on a forward strand
function forward(f: Found, nodes: GraphNode[]) {
  const a = nodes[f.source >> 1]!
  const b = nodes[f.sink >> 1]!
  const byRef = onReference(a, b) ? a.stable!.start - b.stable!.start : 0
  const bySide = ((f.sink ^ 1) & 1) - (f.source & 1)
  return (byRef || bySide || collator.compare(a.name, b.name)) < 0
}

function nodesOf(f: Found) {
  return [f.source >> 1, ...Array.from(f.inside, k => k >> 1), f.sink >> 1]
}

// Every superbubble in the graph, each once, read source to sink
function allSuperbubbles(graph: Graph) {
  const { nodes } = graph
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const { offset, next } = slotGraph(graph, index)
  const find = searcher(nodes.length, offset, next)
  const byEnds = new Map<number, Found>()
  for (let k = 0; k < nodes.length * 2; k++) {
    const hit = find(k)
    if (!hit) {
      continue
    }
    const a = hit.source >> 1
    const b = hit.sink >> 1
    const id = Math.min(a, b) * nodes.length + Math.max(a, b)
    if (forward(hit, nodes) || !byEnds.has(id)) {
      byEnds.set(id, hit)
    }
  }
  const found = [...byEnds.values()].map(f =>
    forward(f, nodes) ? f : reversed(f),
  )
  return { found, offset, next }
}

// Routes over the bubble's own DAG, for a graph whose walks do not cross it
function routesThrough(
  nodes: GraphNode[],
  offset: Int32Array,
  next: Int32Array,
  f: Found,
): Routes {
  const sink = f.sink >> 1
  const best = new Map<number, Routes>([
    [f.source >> 1, { min: 0, max: 0, n: 1 }],
  ])
  for (const k of [f.source, ...f.inside]) {
    const cur = best.get(k >> 1)
    if (!cur) {
      continue
    }
    for (let p = offset[k]!; p < offset[k + 1]!; p++) {
      const u = next[p]! >> 1
      const add = u === sink ? 0 : nodes[u]!.length
      const prev = best.get(u)
      best.set(u, {
        min: Math.min(prev?.min ?? Infinity, cur.min + add),
        max: Math.max(prev?.max ?? -Infinity, cur.max + add),
        n: Math.min(SATURATED_PATH_COUNT, cur.n + (prev?.n ?? 0)),
      })
    }
  }
  return best.get(sink) ?? { min: 0, max: 0, n: 0 }
}

// The outermost superbubbles that are not the whole graph. One with both ends
// on the reference is placed between them; any other takes `span`, the bubble
// it was found in, and is dropped without one.
export function superbubblesFromGraph(
  graph: Graph,
  span?: MinigraphBubble,
): MinigraphBubble[] {
  const { nodes } = graph
  const { found, offset, next } = allSuperbubbles(graph)
  const covers = found.map(f => coversGraph(f.inside.length, nodes.length))
  const members = found.map(nodesOf)
  const holders = new Map<number, number[]>()
  members.forEach((vs, i) => {
    for (const v of vs) {
      ;(holders.get(v) ?? holders.set(v, []).get(v)!).push(i)
    }
  })
  const nested = (f: Found, i: number) =>
    holders
      .get(f.inside[0]! >> 1)!
      .some(
        j =>
          j !== i &&
          !covers[j] &&
          members[j]!.length > members[i]!.length &&
          members[i]!.every(v => holders.get(v)!.includes(j)),
      )
  const placed = (f: Found) =>
    span !== undefined ||
    onReference(nodes[f.source >> 1]!, nodes[f.sink >> 1]!)
  const outermost = found.filter(
    (f, i) => !covers[i] && placed(f) && !nested(f, i),
  )
  const byId = new Map(nodes.map(n => [n.id, n]))
  const walkIndex = walkIndexOf(graph)
  return (
    outermost
      .map(f => {
        const source = nodes[f.source >> 1]!
        const sink = nodes[f.sink >> 1]!
        const walked =
          walkIndex && walkRoutes(graph, byId, walkIndex, source.id, sink.id)
        const crossed = walked?.n ? walked : undefined
        const routes = crossed ?? routesThrough(nodes, offset, next, f)
        const placedOn = onReference(source, sink)
        return {
          refName: placedOn ? source.stable!.refName : span!.refName,
          start: placedOn ? source.stable!.start + source.length : span!.start,
          end: placedOn ? sink.stable!.start : span!.end,
          segmentCount: f.inside.length + 2,
          pathCount: routes.n,
          inversion: false,
          shortestAlleleLength: routes.min,
          longestAlleleLength: routes.max,
          segments: nodesOf(f)
            .map(v => nodes[v]!.name)
            .join(','),
          shortestAllele: undefined,
          longestAllele: undefined,
          partial: walked !== undefined && walked.left > 0,
          routes: crossed?.routes,
          key: `${source.name}>${sink.name}`,
          ...(placedOn ? {} : { offReference: true as const }),
        }
      })
      // Siblings off the reference share a span and sort by name. BubbleGun's
      // chains (connect_bubbles.py) would order them along their arm, but
      // nothing reads the order: halos key by source>sink, chips sort by size.
      .sort(
        (a, b) =>
          a.start - b.start || a.end - b.end || collator.compare(a.key, b.key),
      )
  )
}

// The bubbles a drawing marks: the reach rule's, with any that is the whole
// drawing opened into the superbubbles inside it, and the superbubbles of the
// whole graph where the reach rule finds nothing
export function graphBubbles(
  graph: Graph,
  span?: MinigraphBubble,
): MinigraphBubble[] {
  const n = graph.nodes.length
  const reach = bubblesFromGraph(graph)
  return reach.length === 0
    ? superbubblesFromGraph(graph, span)
    : reach.flatMap(b =>
        coversGraph(b.segmentCount - 2, n)
          ? superbubblesFromGraph(
              b.segmentCount === n
                ? graph
                : bubbleSubgraph(graph, bubbleSegmentIds(b)),
              b,
            )
          : [b],
      )
}
