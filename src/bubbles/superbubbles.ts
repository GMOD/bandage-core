import { isBackbone } from '../anchoredNodes'
import { compareIds } from '../util/canonicalOrder'
import { strandSides } from '../util/geometry'
import { pushTo } from '../util/groups'
import { coversGraph } from './bubbleHalos'
import { bubbleSegmentIds } from './bubbleLabel'
import {
  bubblesFromGraph,
  crossingRoutes,
  derivedBubble,
  relax,
  walkIndexOf,
  walkRoutes,
} from './bubblesFromGraph'
import { bubbleSubgraph } from './popBubble'

import type { Graph, GraphNode } from '../types'
import type { MinigraphBubble } from './bubbleLine'
import type { Crossing, Routes } from './bubblesFromGraph'

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

function onReference(a: GraphNode, b: GraphNode) {
  return isBackbone(a) && isBackbone(b) && a.stable.refName === b.stable.refName
}

function facesUp(k: number, nodes: GraphNode[]) {
  return (k & 1) === (nodes[k >> 1]!.stable!.strand === '-' ? 0 : 1)
}

// Both ends on the reference, and the bubble leaves the earlier upstream and
// the later downstream: round a circular contig, or from the last copy of a
// tandem array drawn as a loop back to the first, so nothing between the two
// is its interval
function wraps(f: Found, nodes: GraphNode[]) {
  const a = nodes[f.source >> 1]!
  const b = nodes[f.sink >> 1]!
  return (
    onReference(a, b) &&
    a.stable!.start !== b.stable!.start &&
    facesUp(f.source, nodes) === a.stable!.start > b.stable!.start &&
    facesUp(f.sink ^ 1, nodes) === b.stable!.start > a.stable!.start
  )
}

function placedOn(f: Found, nodes: GraphNode[]) {
  return (
    onReference(nodes[f.source >> 1]!, nodes[f.sink >> 1]!) && !wraps(f, nodes)
  )
}

// Reference order where it lies between its ends on the reference, else
// whichever way leaves the source by its end, so a bubble reads the same way
// whichever end the search found it from and runs along its links on a
// forward strand
function forward(f: Found, nodes: GraphNode[]) {
  const a = nodes[f.source >> 1]!
  const b = nodes[f.sink >> 1]!
  const byRef = placedOn(f, nodes) ? a.stable!.start - b.stable!.start : 0
  const bySide = ((f.sink ^ 1) & 1) - (f.source & 1)
  return (byRef || bySide || compareIds(a.name, b.name)) < 0
}

function nodesOf(f: Found) {
  return [f.source >> 1, ...Array.from(f.inside, k => k >> 1), f.sink >> 1]
}

function endsOf(f: Found, nodes: number) {
  const a = f.source >> 1
  const b = f.sink >> 1
  return Math.min(a, b) * nodes + Math.max(a, b)
}

// Every superbubble in the graph, each once, read source to sink. Two can
// share both ends, one each way round a ring of the two: keyed by the sides
// they face in with, and read one each way, so their keys differ.
function allSuperbubbles(graph: Graph) {
  const { nodes } = graph
  const slots = nodes.length * 2
  const index = new Map(nodes.map((n, i) => [n.id, i]))
  const { offset, next } = slotGraph(graph, index)
  const find = searcher(nodes.length, offset, next)
  const bySides = new Map<number, Found>()
  for (let k = 0; k < slots; k++) {
    const hit = find(k)
    if (hit) {
      const a = hit.source
      const b = hit.sink ^ 1
      const id = Math.min(a, b) * slots + Math.max(a, b)
      if (forward(hit, nodes) || !bySides.has(id)) {
        bySides.set(id, hit)
      }
    }
  }
  const byEnds = new Map<number, Found[]>()
  for (const hit of bySides.values()) {
    const f = forward(hit, nodes) ? hit : reversed(hit)
    pushTo(byEnds, endsOf(f, nodes.length), f)
  }
  const found: Found[] = []
  const twins = new Map<Found, Found>()
  for (const pair of byEnds.values()) {
    const sameWay =
      pair.length === 2 && pair[0]!.source >> 1 === pair[1]!.source >> 1
    const read = pair.map(f =>
      sameWay && (f.source & 1) === 0 ? reversed(f) : f,
    )
    found.push(...read)
    if (read.length === 2) {
      twins.set(read[0]!, read[1]!).set(read[1]!, read[0]!)
    }
  }
  return { found, twins, offset, next }
}

function linksEnds(f: Found, offset: Int32Array, next: Int32Array) {
  return next
    .subarray(offset[f.source], offset[f.source + 1])
    .includes(f.sink ^ 1)
}

// A walk's first stretch from one end of a bubble to the other through its
// own interior: its twin shares both ends, so where a walk first visits them
// says nothing. A walk holds no strands, so a step straight from one end to
// the other is the bubble's only if its twin does not link them too, and a
// walk taking it where both do cannot be followed.
function twinCrossing(
  steps: readonly string[],
  ends: readonly [string, string],
  inside: Set<string>,
  direct: { mine: boolean; theirs: boolean },
) {
  let crossing: Crossing | undefined
  let at = -1
  let entered = false
  for (let i = 0; i < steps.length && !crossing; i++) {
    const id = steps[i]!
    if (ends.includes(id)) {
      const stretch = at >= 0 && steps[at] !== id ? i - at - 1 : -1
      if (stretch > 0 || (stretch === 0 && direct.mine && !direct.theirs)) {
        crossing = { lo: at + 1, hi: i, endFirst: steps[at] === ends[1] }
      } else {
        entered ||= stretch === 0 && direct.mine && direct.theirs
        at = i
      }
    } else if (inside.has(id)) {
      entered = true
    } else {
      at = -1
    }
  }
  return crossing ?? (entered ? ('leaves' as const) : undefined)
}

function twinRoutes(
  graph: Graph,
  byId: Map<string, GraphNode>,
  f: Found,
  twin: Found,
  offset: Int32Array,
  next: Int32Array,
  fallback: () => Routes,
) {
  const { nodes } = graph
  const ends = [nodes[f.source >> 1]!.id, nodes[f.sink >> 1]!.id] as const
  const inside = new Set(Array.from(f.inside, k => nodes[k >> 1]!.id))
  const direct = {
    mine: linksEnds(f, offset, next),
    theirs: linksEnds(twin, offset, next),
  }
  return crossingRoutes(
    graph,
    byId,
    steps => twinCrossing(steps, ends, inside, direct),
    fallback,
  )
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
      relax(best, u, cur, u === sink ? 0 : nodes[u]!.length)
    }
  }
  return best.get(sink) ?? { min: 0, max: 0, n: 0 }
}

// The outermost superbubbles that are not the whole graph. One with both ends
// on the reference is placed between them unless it wraps; any other takes
// `span`, the bubble it was found in, and is dropped without one.
export function superbubblesFromGraph(
  graph: Graph,
  span?: MinigraphBubble,
): MinigraphBubble[] {
  const { nodes } = graph
  const { found, twins, offset, next } = allSuperbubbles(graph)
  const covers = found.map(f => coversGraph(f.inside.length, nodes.length))
  const members = found.map(nodesOf)
  const holders = new Map<number, number[]>()
  members.forEach((vs, i) => {
    for (const v of vs) {
      pushTo(holders, v, i)
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
  const outermost = found.filter(
    (f, i) =>
      !covers[i] && (span !== undefined || placedOn(f, nodes)) && !nested(f, i),
  )
  const byId = new Map(nodes.map(n => [n.id, n]))
  const walkIndex = walkIndexOf(
    graph,
    outermost.flatMap(f => [nodes[f.source >> 1]!.id, nodes[f.sink >> 1]!.id]),
  )
  // Siblings off the reference share a span and sort by name. BubbleGun's
  // chains (connect_bubbles.py) would order them along their arm, but nothing
  // reads the order: halos key by source>sink, chips sort by size.
  return outermost
    .map(f => {
      const source = nodes[f.source >> 1]!
      const sink = nodes[f.sink >> 1]!
      const twin = twins.get(f)
      const fallback = () => routesThrough(nodes, offset, next, f)
      const walked = twin
        ? twinRoutes(graph, byId, f, twin, offset, next, fallback)
        : walkRoutes(graph, byId, walkIndex, source.id, sink.id, fallback)
      const placed = placedOn(f, nodes)
      const [early, late] =
        !placed || source.stable!.start <= sink.stable!.start
          ? [source, sink]
          : [sink, source]
      return {
        ...derivedBubble(
          {
            refName: placed ? source.stable!.refName : span!.refName,
            start: placed ? early.stable!.start + early.length : span!.start,
            end: placed ? late.stable!.start : span!.end,
          },
          nodesOf(f).map(v => nodes[v]!),
          walked,
          walked.walksLeave,
        ),
        key: `${source.name}>${sink.name}`,
        ...(placed ? {} : { offReference: true as const }),
      }
    })
    .sort(
      (a, b) => a.start - b.start || a.end - b.end || compareIds(a.key, b.key),
    )
}

// The bubbles a drawing marks: the reach rule's, with any that is the whole
// drawing opened into the superbubbles inside it, and the superbubbles of the
// whole graph where the reach rule finds nothing. The bubble the drawing is
// stays on the list, marked `covering`: the reach rule's, or else the `span` a
// pop opened.
export function graphBubbles(
  graph: Graph,
  span?: MinigraphBubble,
): MinigraphBubble[] {
  const n = graph.nodes.length
  const reach = bubblesFromGraph(graph)
  if (reach.length === 0) {
    const inside = superbubblesFromGraph(graph, span)
    return span ? [...inside, { ...span, covering: true }] : inside
  }
  return reach.flatMap(b =>
    coversGraph(b.segmentCount - 2, n)
      ? [
          ...superbubblesFromGraph(
            b.segmentCount === n
              ? graph
              : bubbleSubgraph(graph, bubbleSegmentIds(b)),
            b,
          ),
          { ...b, covering: true as const },
        ]
      : [b],
  )
}
