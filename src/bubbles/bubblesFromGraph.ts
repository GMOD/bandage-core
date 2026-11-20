import { isBackbone } from '../anchoredNodes'
import { referenceOrder } from '../layout/orderedLayout'
import { strandSides } from '../util/geometry'
import { addTo, groupBy, pushTo } from '../util/groups'
import { SATURATED_PATH_COUNT } from './bubbleLine'

import type { AnchoredNode } from '../anchoredNodes'
import type { Graph, GraphEdge, GraphNode } from '../types'
import type { BubbleRoute, MinigraphBubble } from './bubbleLine'

// Bubbles from the graph alone, off the reference order the ordered layout is
// also drawn from (referenceOrder): a backbone node no link reaches across is a
// bubble boundary, and whatever sorts between two consecutive boundaries of
// one contig is a bubble. Needs a reference, not an index, so it works on a
// GBZ cut, a pggb file and the inside of a popped superbubble alike.
//
// Read off the order itself, not off the layers the drawing puts it in. A
// layer is where a node is drawn, and one nothing leads into is drawn in the
// first layer wherever it sorts. That is every node a walk enters the cut at,
// the ordinary shape of a GBZ cut whose context stops short of a haplotype's
// walk: its link into the backbone then crossed every layer between, and the
// bubbles on either side of those boundaries fused into one.
//
// Route statistics come from the walks when the graph has paths (exact, and
// immune to a repeat array whose copies the order cannot direct), and from a
// DP over the ordered DAG otherwise. A reversed stretch comes out as one
// bubble whose interior runs against the reference, not as an inversion flag.

export interface Routes {
  min: number
  max: number
  n: number
}

// Folds the routes reaching `cur`, extended by `add` bp, into those at `to`
export function relax<K>(
  best: Map<K, Routes>,
  to: K,
  cur: Routes,
  add: number,
) {
  const prev = best.get(to)
  best.set(to, {
    min: Math.min(prev?.min ?? Infinity, cur.min + add),
    max: Math.max(prev?.max ?? -Infinity, cur.max + add),
    n: Math.min(SATURATED_PATH_COUNT, cur.n + (prev?.n ?? 0)),
  })
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\t${b}` : `${b}\t${a}`)

const downstream = (n: AnchoredNode) =>
  n.stable.strand === '-' ? 'start' : 'end'
const upstream = (n: AnchoredNode) =>
  n.stable.strand === '-' ? 'end' : 'start'

// A link straight from the start's downstream side to the end's upstream one,
// as a deletion of everything between them, and not the way round a circular
// contig from its last node to its first. Ends no link joins, as in a GFA
// whose walks state its links, and a link stating no strands, are taken to be
// joined that way.
function joinsAcross(
  edges: readonly GraphEdge[],
  start: AnchoredNode,
  end: AnchoredNode,
) {
  return (
    edges.length === 0 ||
    edges.some(e => {
      const sides = strandSides(e)
      return (
        e.fromStrand === undefined ||
        e.toStrand === undefined ||
        (e.from === start.id
          ? sides.from === downstream(start) && sides.to === upstream(end)
          : sides.from === upstream(end) && sides.to === downstream(start))
      )
    })
  )
}

export function bubblesFromGraph(graph: Graph): MinigraphBubble[] {
  if (!graph.nodes.some(isBackbone)) {
    return []
  }
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const order = referenceOrder(graph)
  const indexOf = new Map(order.map((id, i) => [id, i]))
  // how many links reach across each place in the order, as a running sum of
  // where each one starts and stops
  const reach = new Int32Array(order.length + 1)
  // successors as a set: a repeat's back edge is the same DAG edge as its
  // forward one, and counting it twice doubles every route through the copy
  const succ = new Map<string, Set<string>>()
  const linked = new Set<string>()
  const edgesBetween = new Map<string, GraphEdge[]>()
  for (const e of graph.edges) {
    const a = indexOf.get(e.from)
    const b = indexOf.get(e.to)
    if (a === undefined || b === undefined || a === b) {
      continue
    }
    linked.add(`${e.from}>${e.to}`).add(`${e.to}>${e.from}`)
    pushTo(edgesBetween, pairKey(e.from, e.to), e)
    const [lo, hi] = a < b ? [a, b] : [b, a]
    reach[lo + 1]!++
    reach[hi]!--
    const [from, to] = a < b ? [e.from, e.to] : [e.to, e.from]
    addTo(succ, from, to)
  }
  for (let i = 1; i < reach.length; i++) {
    reach[i]! += reach[i - 1]!
  }
  // Boundaries are nodes: every backbone node no link reaches across, plus
  // each contig's first and last backbone node in the window whatever reaches
  // across them, since a repeat array whose copies reach the last backbone
  // node would otherwise never close.
  const backbone = graph.nodes
    .filter(isBackbone)
    .sort((a, b) => a.stable.start - b.stable.start)
  const ends = new Set(
    [...groupBy(backbone, node => node.stable.refName).values()].flatMap(
      contig => [contig[0]!.id, contig.at(-1)!.id],
    ),
  )
  const boundaries = backbone
    .map(node => [node, indexOf.get(node.id)!] as const)
    .filter(([node, i]) => ends.has(node.id) || reach[i] === 0)
    .sort(([a, ia], [b, ib]) => ia - ib || a.stable.start - b.stable.start)
  const walkIndex = walkIndexOf(
    graph,
    boundaries.map(([node]) => node.id),
  )

  const bubbles: MinigraphBubble[] = []
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const [start, i0] = boundaries[i]!
    const [end, i1] = boundaries[i + 1]!
    const interior = order.slice(i0 + 1, i1)
    if (interior.length === 0 || start.stable.refName !== end.stable.refName) {
      continue
    }

    const best = new Map<string, Routes>([[start.id, { min: 0, max: 0, n: 1 }]])
    for (const id of [start.id, ...interior]) {
      const cur = best.get(id)
      if (!cur) {
        continue
      }
      for (const t of succ.get(id) ?? []) {
        const ti = indexOf.get(t)!
        if (ti > i1) {
          continue
        }
        relax(best, t, cur, t === end.id ? 0 : byId.get(t)!.length)
      }
    }
    const walked = walkRoutes(
      graph,
      byId,
      walkIndex,
      start.id,
      end.id,
      {
        inside: new Set(interior),
        beyond: (id, at) => {
          const k = indexOf.get(id)
          return k !== undefined && (at === start.id ? k < i0 : k > i1)
        },
        direct: joinsAcross(
          edgesBetween.get(pairKey(start.id, end.id)) ?? [],
          start,
          end,
        ),
      },
      () => best.get(end.id) ?? { min: 0, max: 0, n: 0 },
    )

    const refStart = start.stable.start + start.length
    const refEnd = end.stable.start
    // The reference route exists in the cut only if every backbone pair inside
    // is linked; a flank the hop reached from an allele is not.
    const chain = [
      start.id,
      ...interior.filter(id => isBackbone(byId.get(id)!)),
      end.id,
    ]
    const chainBroken = chain.some(
      (id, k) => k > 0 && !linked.has(`${chain[k - 1]}>${id}`),
    )
    const refLength = refEnd - refStart
    bubbles.push(
      derivedBubble(
        { refName: start.stable.refName, start: refStart, end: refEnd },
        [start, ...interior.map(id => byId.get(id)!), end],
        chainBroken && !walked.routes
          ? { ...walked, min: refLength, max: refLength }
          : walked,
        chainBroken || walked.walksLeave,
      ),
    )
  }
  return bubbles
}

// Where each walk first visits each of `ids`, -1 where it never does. Only
// the nodes asked about: a map per walk of every node it visits was 6.1M
// entries for KIV-2 cut with all 465 haplotypes, and a second of the pass.
export type WalkIndex = Map<string, Int32Array>

export function walkIndexOf(
  graph: Graph,
  ids: Iterable<string>,
): WalkIndex | undefined {
  const paths = graph.paths
  if (!paths) {
    return undefined
  }
  const index: WalkIndex = new Map()
  for (const id of ids) {
    index.set(id, new Int32Array(paths.length).fill(-1))
  }
  paths.forEach((p, k) => {
    const steps = p.nodeIds
    for (let i = 0; i < steps.length; i++) {
      const at = index.get(steps[i]!)
      if (at?.[k] === -1) {
        at[k] = i
      }
    }
  })
  return index
}

export interface WalkedRoutes extends Routes {
  // set where a walk crosses the bubble
  routes?: BubbleRoute[]
  // A walk that enters the bubble and never reaches its other end left the
  // cut: a GBZ cut of a repeat array at 1 kb of context splits each
  // haplotype's walk into pieces, and the routes seen are then a floor.
  walksLeave: boolean
}

// A bubble's own interior, and whether a link of its own joins its two ends.
// `beyond` says whether a node lies past one of its ends, away from it, for a
// bubble whose interior links may leave: a duplication's copy runs out of it
// and back, and is sequence the haplotype carries there. Without it the
// interior is closed, as a superbubble's is, and no crossing leaves it.
export interface BubbleBody {
  inside: ReadonlySet<string>
  direct: boolean
  beyond?: (id: string, end: string) => boolean
}

// For every walk that passes both boundary nodes, the bp between them and the
// step sequence, so routes are distinct sequences and lengths are the true
// haplotype lengths. Where no walk crosses, the counts are `fallback`'s.
//
// A walk is read between its first visits to the two ends, unless that
// stretch runs the other way round, out of each end on its far side, or
// straight from one to the other by a link that is not the bubble's own; it
// is then read at its first stretch through the bubble alone, and leaves it
// where it has none. Round a circular contig the first visits can lie the
// other way round, through everything but the bubble, and a walk written from
// a point inside the bubble crosses it only in pieces at its two ends.
//
// `byId` is the caller's: this runs once per bubble, and a map of every node
// built here made the whole pass quadratic, seven seconds at 15k nodes.
export function walkRoutes(
  graph: Graph,
  byId: Map<string, GraphNode>,
  walkIndex: WalkIndex | undefined,
  startId: string,
  endId: string,
  body: BubbleBody,
  fallback: () => Routes,
): WalkedRoutes {
  if (!walkIndex) {
    return { ...fallback(), walksLeave: false }
  }
  const at0 = walkIndex.get(startId)!
  const at1 = walkIndex.get(endId)!
  const ends = [startId, endId] as const
  return crossingRoutes(
    graph,
    byId,
    (steps, k) => {
      const i0 = at0[k]!
      const i1 = at1[k]!
      const lo = Math.min(i0, i1) + 1
      const hi = Math.max(i0, i1)
      return i0 < 0 || i1 < 0
        ? i0 >= 0 || i1 >= 0
          ? 'leaves'
          : undefined
        : betweenFirstVisits(steps, lo, hi, ends, body)
          ? { lo, hi, endFirst: i1 < i0 }
          : (firstCrossing(steps, ends, body) ?? 'leaves')
    },
    fallback,
  )
}

function betweenFirstVisits(
  steps: readonly string[],
  lo: number,
  hi: number,
  ends: readonly [string, string],
  body: BubbleBody,
) {
  const { beyond } = body
  return hi > lo && beyond
    ? !(
        beyond(steps[lo]!, steps[lo - 1]!) && beyond(steps[hi - 1]!, steps[hi]!)
      )
    : throughBody(steps, lo, hi, ends, body)
}

// Every step inside the bubble or at one of its ends, which a collapsed
// repeat's copy loops back through, or none where its own link joins them
function throughBody(
  steps: readonly string[],
  lo: number,
  hi: number,
  ends: readonly [string, string],
  { inside, direct }: BubbleBody,
) {
  let through = hi > lo || direct
  for (let i = lo; i < hi && through; i++) {
    const id = steps[i]!
    through = inside.has(id) || id === ends[0] || id === ends[1]
  }
  return through
}

// A walk's first stretch from one end of a bubble to the other through its
// body alone
export function firstCrossing(
  steps: readonly string[],
  ends: readonly [string, string],
  body: BubbleBody,
) {
  let crossing: Crossing | undefined
  let at = -1
  for (let i = 0; i < steps.length && !crossing; i++) {
    const id = steps[i]!
    if (id === ends[0] || id === ends[1]) {
      if (at < 0 || steps[at] !== id) {
        if (at >= 0 && throughBody(steps, at + 1, i, ends, body)) {
          crossing = { lo: at + 1, hi: i, endFirst: steps[at] === ends[1] }
        } else {
          at = i
        }
      }
    } else if (!body.inside.has(id)) {
      at = -1
    }
  }
  return crossing
}

// Where a walk crosses a bubble: its steps from `lo` up to but not `hi`, the
// ones between the two ends, and whether it reached the sink first
export interface Crossing {
  lo: number
  hi: number
  endFirst: boolean
}

// The routes the walks take, each walk read where `crossingOf` says it crosses
// the bubble or counted as leaving it
export function crossingRoutes(
  graph: Graph,
  byId: Map<string, GraphNode>,
  crossingOf: (
    steps: readonly string[],
    walk: number,
  ) => Crossing | 'leaves' | undefined,
  fallback: () => Routes,
) {
  const routes: BubbleRoute[] = []
  let min = Infinity
  let max = -Infinity
  let left = 0
  graph.paths?.forEach((p, k) => {
    const ids = p.nodeIds
    const crossing = crossingOf(ids, k)
    if (crossing === 'leaves') {
      left++
    } else if (crossing) {
      // Start to end, whichever way the walk crosses: a contig on the reverse
      // strand takes the same route, and read end-first it keyed as a second
      // one.
      const { lo, hi, endFirst } = crossing
      const step = endFirst
        ? (j: number) => ids[hi - 1 - j]!
        : (j: number) => ids[lo + j]!
      // copied and measured only for a route not seen yet: hundreds of walks
      // take most routes
      let route = routes.find(
        r =>
          r.steps.length === hi - lo &&
          r.steps.every((id, j) => id === step(j)),
      )
      if (!route) {
        const steps = Array.from({ length: hi - lo }, (_, j) => step(j))
        let bp = 0
        for (const id of steps) {
          bp += byId.get(id)?.length ?? 0
        }
        route = { steps, bp, walks: [] }
        routes.push(route)
      }
      route.walks.push(p.name)
      min = Math.min(min, route.bp)
      max = Math.max(max, route.bp)
    }
  })
  const walksLeave = left > 0
  return routes.length
    ? { min, max, n: routes.length, routes, walksLeave }
    : { ...fallback(), walksLeave }
}

// A bubble found from the graph's shape, `segments` from boundary to boundary.
// `inversion` stays false: a real test needs each walk's direction relative to
// the reference.
export function derivedBubble(
  place: Pick<MinigraphBubble, 'refName' | 'start' | 'end'>,
  segments: readonly GraphNode[],
  { min, max, n, routes }: WalkedRoutes,
  partial: boolean,
): MinigraphBubble {
  return {
    ...place,
    segmentCount: segments.length,
    pathCount: n,
    inversion: false,
    shortestAlleleLength: min,
    longestAlleleLength: max,
    segments: segments.map(s => s.name).join(','),
    shortestAllele: undefined,
    longestAllele: undefined,
    partial,
    routes,
    ...(segments.some(s => s.placeholder) ? { unloaded: true as const } : {}),
  }
}
