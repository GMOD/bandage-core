import { bubbleSegmentIds, classifyBubble, formatBp } from './classifyBubble'
import { isBackbone } from '../anchoredNodes'
import { svgPath } from '../util/geometry'

import type { BubbleRoute, MinigraphBubble } from './bubbleLine'
import type { BubbleKind, RepeatSpan } from './classifyBubble'
import type { Graph, NodeSegment } from '../types'

// A bubble drawn over the graph itself: a wide translucent stroke along the
// nodes inside it, in layout coordinates, so the same halo follows the nodes
// through the force layout's loops as through the ordered layout's lenses. The
// two backbone nodes a bubble hangs between are not inside it, and are left
// out so neighbouring halos do not touch.
export interface BubbleHalo {
  bubble: MinigraphBubble
  kind: BubbleKind
  label: string
  // an SVG path in layout units; a drawing transform puts it on screen
  path: string
  // where the name goes, in layout units: over the middle of its nodes, at the
  // height of the highest
  labelAt: NodeSegment
  members: number
  // the ids of those nodes, so a lifted walk can say which bubbles it enters
  nodeIds: string[]
  // the bubble is the whole drawing, as a popped bubble's own row is: its
  // label still names it, but a halo around everything marks nothing
  whole: boolean
  // a small variant, drawn as a tick with no chip: its halo is a blob, and a
  // window of them buries the structural variants' names
  tick: boolean
  // each route the walks take through the bubble, the reference's own
  // included, named for the haplotypes that take it; a route with no steps, a
  // deletion, has nowhere to carry a chip
  routes: RouteLabel[]
}

export interface RouteLabel {
  route: BubbleRoute
  at: NodeSegment
  text: string
}

export const WHOLE_FRACTION = 0.9

// Holding every node but its own two ends, as a popped bubble's own row does,
// or nearly every node, as a repeat array filling its window does
export function coversGraph(members: number, nodes: number) {
  return members + 2 >= nodes || members >= WHOLE_FRACTION * nodes
}

// the usual line between a small variant and a structural one
export const SMALL_VARIANT_BP = 50
const NAMED_WALKS = 2
// a SNP's routes are a dot each; chips are for loops a reader can see
const MIN_CHIPPED_BP = 1000

export function bubbleHalos(
  graph: Graph,
  bubbles: MinigraphBubble[],
  positions: Record<string, NodeSegment[]>,
  walkLabel: (name: string) => string = name => name,
  repeats: readonly RepeatSpan[] = [],
): BubbleHalo[] {
  const byName = new Map(graph.nodes.map(n => [n.name, n]))
  const halos: BubbleHalo[] = []
  for (const bubble of bubbles) {
    const parts: string[] = []
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    const nodeIds: string[] = []
    const ends: NodeSegment[] = []
    const names = bubbleSegmentIds(bubble)
    for (const [i, name] of names.entries()) {
      const node = byName.get(name)
      const line = node && positions[node.id]
      if (!node || !line?.length) {
        continue
      }
      if (
        bubble.key
          ? i === 0 || i === names.length - 1
          : isBackbone(node) &&
            (node.stable.start < bubble.start ||
              node.stable.start >= bubble.end)
      ) {
        ends.push(line[Math.floor(line.length / 2)]!)
        continue
      }
      nodeIds.push(node.id)
      // a one-point line still needs a segment to stroke as a dot
      parts.push(svgPath(line.length === 1 ? [line[0]!, line[0]!] : line))
      for (const p of line) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
      }
    }
    if (nodeIds.length === 0) {
      continue
    }
    const labelAt = { x: (minX + maxX) / 2, y: minY }
    const anchor = ends.length
      ? {
          x: ends.reduce((s, p) => s + p.x, 0) / ends.length,
          y: ends.reduce((s, p) => s + p.y, 0) / ends.length,
        }
      : labelAt
    // A chip goes on the stretch that is the route's own: among the nodes the
    // fewest other routes share, the point farthest from the bubble's ends.
    // Routes through a repeat array share most of their copies, and the far
    // point of a shared copy would put every chip on one loop.
    const routes: RouteLabel[] = []
    for (const [route, own] of ownStretches(bubble)) {
      let at: NodeSegment | undefined
      let far = -1
      for (const id of own) {
        for (const p of positions[id] ?? []) {
          const d = Math.hypot(p.x - anchor.x, p.y - anchor.y)
          if (d > far) {
            far = d
            at = p
          }
        }
      }
      if (at) {
        routes.push({ route, at, text: routeText(route, walkLabel) })
      }
    }
    const whole =
      bubble.covering === true ||
      coversGraph(nodeIds.length, graph.nodes.length)
    halos.push({
      bubble,
      ...classifyBubble(bubble, repeats),
      path: parts.join(''),
      labelAt,
      members: nodeIds.length,
      nodeIds,
      whole,
      // The drawing's own bubble keeps its name however small. A partial
      // bubble's lengths are a floor, so it may be no small variant.
      tick:
        !whole &&
        !bubble.partial &&
        bubble.longestAlleleLength < SMALL_VARIANT_BP,
      routes,
    })
  }
  return halos
}

// Each chipped route's steps that the fewest other routes share. It reads the
// routes alone, so a bubble keeps it while its nodes move: KIV-2 cut with every
// haplotype has 465 routes of thousands of steps, half a second per drag frame
// when this was rebuilt with the halos.
const stretches = new WeakMap<MinigraphBubble, Map<BubbleRoute, string[]>>()

function ownStretches(bubble: MinigraphBubble) {
  const cached = stretches.get(bubble)
  if (cached) {
    return cached
  }
  const chipped =
    bubble.longestAlleleLength < MIN_CHIPPED_BP ? [] : (bubble.routes ?? [])
  const sharing = new Map<string, number>()
  chipped.forEach((route, r) => {
    const counted = new Map<string, number>()
    for (const id of route.steps) {
      if (counted.get(id) !== r) {
        counted.set(id, r)
        sharing.set(id, (sharing.get(id) ?? 0) + 1)
      }
    }
  })
  const own = new Map<BubbleRoute, string[]>()
  for (const route of chipped) {
    let rarest = Infinity
    for (const id of route.steps) {
      rarest = Math.min(rarest, sharing.get(id)!)
    }
    // each node once: a route round a repeat array passes the same copy's
    // nodes again on every lap, and each pass looked up its positions anew
    const steps = new Set(route.steps.filter(id => sharing.get(id) === rarest))
    if (steps.size > 0) {
      own.set(route, [...steps])
    }
  }
  stretches.set(bubble, own)
  return own
}

function routeText(route: BubbleRoute, walkLabel: (name: string) => string) {
  const names = [...new Set(route.walks.map(walkLabel))].sort()
  const shown = names.slice(0, NAMED_WALKS).join(', ')
  const more =
    names.length > NAMED_WALKS ? ` +${names.length - NAMED_WALKS}` : ''
  return `${shown}${more} · ${formatBp(route.bp)}`
}
