import { isBackbone } from './anchoredNodes'
import { haplotypeOf } from './nodeWidths'
import { overlaps } from './overlayLabels'
import { panSNHaplotype } from './pansn'
import { spanPx } from './util/edgeCurves'
import { weakMemo } from './util/weakMemo'

import type { Box } from './overlayLabels'
import type { Tick } from './renderer/types'
import type { Graph, GraphNode, NodeSegment } from './types'
import type { EdgeCurves } from './util/edgeCurves'
import type { AxisScale } from './util/geometry'

// screen px
export const SITE_EXTENT_PX = 3
export const SITE_REACH_PX = 8
export const TICK_MIN_PX = 3
export const TICK_MAX_PX = 12
export const TICK_WIDTH_PX = 1.5
const TICK_CELL_PX = 32
const TICK_CELL_ROW = 1 << 20

interface Point {
  x: number
  y: number
}

// where an edge's curve meets the reference: its start, or its end
interface Foot {
  edge: number
  atEnd: boolean
}

interface Unit {
  nodes: string[]
  edges: number[]
  feet: Foot[]
  anchors: string[]
  walks: number[]
  skip: boolean
}

export interface Site {
  nodes: string[]
  edges: number[]
  x: number
  y: number
  nx: number
  ny: number
  count: number
  total: number
  anchors: string[]
}

export interface Collapse {
  sites: Site[]
  nodes: ReadonlySet<string>
  edges: ReadonlySet<number>
  siteOf: ReadonlyMap<string, Site>
}

export const NO_COLLAPSE: Collapse = {
  sites: [],
  nodes: new Set(),
  edges: new Set(),
  siteOf: new Map(),
}

const offReference = (node: GraphNode) => !isBackbone(node) && !node.placeholder
const onReference = (node: GraphNode | undefined) =>
  !!node && isBackbone(node) && !node.placeholder

function shownWalks(graph: Graph) {
  const haplotypes = new Map<string, number>()
  const byName = new Map<string, number>()
  const byNode = new Map<string, Set<number>>()
  const indexOf = (haplotype: string) => {
    const known = haplotypes.get(haplotype)
    const index = known ?? haplotypes.size
    if (known === undefined) {
      haplotypes.set(haplotype, index)
    }
    return index
  }
  const visit = (nodeId: string, walk: number) => {
    const walks = byNode.get(nodeId)
    if (walks) {
      walks.add(walk)
    } else {
      byNode.set(nodeId, new Set([walk]))
    }
  }
  for (const path of graph.paths ?? []) {
    const walk = indexOf(haplotypeOf(path))
    byName.set(path.name, walk)
    for (const id of path.nodeIds) {
      visit(id, walk)
    }
  }
  const walkNamed = (name: string) =>
    byName.get(name) ?? haplotypes.get(panSNHaplotype(name) ?? name)
  for (const node of graph.nodes) {
    for (const { path } of node.departureVisits ?? []) {
      const walk = walkNamed(path)
      if (walk !== undefined) {
        visit(node.id, walk)
      }
    }
  }
  return { total: haplotypes.size, byNode, walkNamed }
}

function unitsOf(
  graph: Graph,
  deletions: ReadonlyMap<number, string[]> | undefined,
  hiddenEdges: ReadonlySet<number> | undefined,
) {
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const { total, byNode, walkNamed } = shownWalks(graph)
  const parent = new Map<string, string>()
  for (const node of graph.nodes) {
    if (offReference(node)) {
      parent.set(node.id, node.id)
    }
  }
  const find = (id: string) => {
    let root = id
    while (parent.get(root) !== root) {
      root = parent.get(root)!
    }
    let at = id
    while (at !== root) {
      const next = parent.get(at)!
      parent.set(at, root)
      at = next
    }
    return root
  }
  const off = (id: string) => parent.has(id)
  graph.edges.forEach(({ from, to }) => {
    if (off(from) && off(to)) {
      parent.set(find(from), find(to))
    }
  })
  const components = new Map<string, Unit & { tied: boolean }>()
  const componentOf = (id: string) => {
    const root = find(id)
    const known = components.get(root)
    const component = known ?? {
      nodes: [],
      edges: [],
      feet: [],
      anchors: [],
      walks: [],
      skip: false,
      tied: false,
    }
    if (!known) {
      components.set(root, component)
    }
    return component
  }
  for (const node of graph.nodes) {
    if (off(node.id)) {
      componentOf(node.id).nodes.push(node.id)
    }
  }
  const skips: Unit[] = []
  graph.edges.forEach(({ from, to, pathIds }, edge) => {
    const inside = off(from) ? from : off(to) ? to : undefined
    const outside = off(from) ? to : from
    if (inside !== undefined) {
      const component = componentOf(inside)
      component.edges.push(edge)
      if (!off(outside)) {
        if (onReference(nodeById.get(outside))) {
          component.feet.push({ edge, atEnd: outside === to })
          component.anchors.push(outside)
        } else {
          component.tied = true
        }
      }
    } else if (
      deletions?.has(edge) &&
      !hiddenEdges?.has(edge) &&
      onReference(nodeById.get(from)) &&
      onReference(nodeById.get(to))
    ) {
      const walks = new Set<number>()
      for (const name of pathIds ?? []) {
        const walk = walkNamed(name)
        if (walk !== undefined) {
          walks.add(walk)
        }
      }
      if (walks.size > 0) {
        skips.push({
          nodes: [],
          edges: [edge],
          feet: [
            { edge, atEnd: false },
            { edge, atEnd: true },
          ],
          anchors: [from, to],
          walks: [...walks],
          skip: true,
        })
      }
    }
  })
  const units: Unit[] = [...skips]
  for (const { tied, ...component } of components.values()) {
    const walks = new Set<number>()
    for (const id of component.nodes) {
      for (const walk of byNode.get(id) ?? []) {
        walks.add(walk)
      }
    }
    if (!tied && component.feet.length > 0 && walks.size > 0) {
      units.push({ ...component, walks: [...walks] })
    }
  }
  const startOf = (id: string) => nodeById.get(id)?.stable?.start ?? 0
  const orderOf = (unit: Unit) =>
    unit.anchors.reduce(
      (least, id) => Math.min(least, startOf(id)),
      Number.POSITIVE_INFINITY,
    )
  const keyOf = (unit: Unit) => unit.nodes[0] ?? `#${unit.edges[0]}`
  const sorted = units
    .map(unit => ({ unit, order: orderOf(unit), key: keyOf(unit) }))
    .sort((a, b) =>
      a.order !== b.order
        ? a.order - b.order
        : a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : 0,
    )
    .map(({ unit }) => unit)
  const backbone = graph.nodes
    .filter(onReference)
    .sort((a, b) => startOf(a.id) - startOf(b.id) || (a.id < b.id ? -1 : 1))
    .map(n => n.id)
  return {
    units: sorted,
    total,
    backbone,
    backboneIndex: new Map(backbone.map((id, i) => [id, i])),
    startOf,
  }
}

const unitsCache = weakMemo<Graph, ReturnType<typeof unitsOf>>()

// the box round some points, as its diagonal on screen
function screenDiagonal(points: Iterable<Point>, axis: AxisScale) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { x, y } of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return maxX < minX
    ? 0
    : Math.hypot((maxX - minX) * axis.scaleX, (maxY - minY) * axis.scaleY)
}

function* nodePoints(
  nodes: readonly string[],
  positions: Record<string, NodeSegment[]>,
) {
  for (const id of nodes) {
    yield* positions[id] ?? []
  }
}

function footPoint(curves: EdgeCurves, { edge, atEnd }: Foot) {
  const line = curves.get(edge)
  const first = line?.[0]
  const last = line?.at(-1)
  return !first || !last
    ? undefined
    : atEnd
      ? { x: last.x1, y: last.y1 }
      : { x: first.x0, y: first.y0 }
}

const mean = (points: readonly Point[]) => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
})

// The site a unit is too small to draw at: the mean of its feet on the
// reference, or nothing where it draws as it is
function siteAt(
  unit: Unit,
  positions: Record<string, NodeSegment[]>,
  curves: EdgeCurves,
  axis: AxisScale,
) {
  const feet = unit.feet.map(foot => footPoint(curves, foot))
  const placed = feet.flatMap(p => (p ? [p] : []))
  const skipped = unit.skip ? curves.get(unit.edges[0]!) : undefined
  const small = skipped
    ? spanPx(skipped, axis) < SITE_EXTENT_PX
    : !unit.skip &&
      unit.nodes.every(id => positions[id]?.length) &&
      screenDiagonal(nodePoints(unit.nodes, positions), axis) < SITE_EXTENT_PX
  return small &&
    placed.length === feet.length &&
    screenDiagonal(placed, axis) < SITE_REACH_PX
    ? mean(placed)
    : undefined
}

const middleOf = (line: NodeSegment[] | undefined) => {
  const first = line?.[0]
  const last = line?.at(-1)
  return first && last
    ? { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }
    : undefined
}

// The way the reference runs at a site, on screen, from the first of its
// anchors along the reference to the last, or across their neighbours where
// those lie on one point
function alongReference(
  anchors: readonly string[],
  positions: Record<string, NodeSegment[]>,
  axis: AxisScale,
  { backbone, backboneIndex }: ReturnType<typeof unitsOf>,
) {
  const indexes = anchors.map(id => backboneIndex.get(id) ?? 0)
  const lo = indexes.reduce((a, b) => Math.min(a, b), Infinity)
  const hi = indexes.reduce((a, b) => Math.max(a, b), -Infinity)
  const between = (a: number, b: number) => {
    const from = middleOf(positions[backbone[a] ?? ''])
    const to = middleOf(positions[backbone[b] ?? ''])
    const dx = from && to ? (to.x - from.x) * axis.scaleX : 0
    const dy = from && to ? (to.y - from.y) * axis.scaleY : 0
    const length = Math.hypot(dx, dy)
    return length > 0 ? { dx: dx / length, dy: dy / length } : undefined
  }
  return (
    between(lo, hi) ??
    between(Math.max(0, lo - 1), Math.min(backbone.length - 1, hi + 1)) ?? {
      dx: 1,
      dy: 0,
    }
  )
}

function collapseOf(
  graph: Graph,
  positions: Record<string, NodeSegment[]>,
  axis: AxisScale,
  curves: EdgeCurves,
  deletions: ReadonlyMap<number, string[]> | undefined,
  hiddenEdges: ReadonlySet<number> | undefined,
): Collapse {
  const units = unitsCache(graph, [deletions, hiddenEdges], () =>
    unitsOf(graph, deletions, hiddenEdges),
  )
  const near = (a: Point, b: Point) =>
    Math.hypot((a.x - b.x) * axis.scaleX, (a.y - b.y) * axis.scaleY) <
    SITE_REACH_PX
  const groups: { at: Point; last: Point; units: Unit[] }[] = []
  for (const unit of units.units) {
    const at = siteAt(unit, positions, curves, axis)
    const open = groups.at(-1)
    if (at && open && near(at, open.at)) {
      open.units.push(unit)
      open.last = at
    } else if (at) {
      groups.push({ at, last: at, units: [unit] })
    }
  }
  const stamp = new Int32Array(units.total).fill(-1)
  const nodes = new Set<string>()
  const edges = new Set<number>()
  const siteOf = new Map<string, Site>()
  const sites = groups.map((group, index) => {
    let count = 0
    const site: Site = {
      nodes: [],
      edges: [],
      anchors: [],
      x: (group.at.x + group.last.x) / 2,
      y: (group.at.y + group.last.y) / 2,
      nx: 0,
      ny: 0,
      count: 0,
      total: units.total,
    }
    for (const unit of group.units) {
      for (const walk of unit.walks) {
        if (stamp[walk] !== index) {
          stamp[walk] = index
          count++
        }
      }
      for (const id of unit.nodes) {
        site.nodes.push(id)
        nodes.add(id)
        siteOf.set(id, site)
      }
      for (const edge of unit.edges) {
        site.edges.push(edge)
        edges.add(edge)
      }
      for (const id of unit.anchors) {
        site.anchors.push(id)
      }
    }
    const { dx, dy } = alongReference(site.anchors, positions, axis, units)
    site.count = count
    site.nx = dy
    site.ny = -dx
    return site
  })
  return { sites, nodes, edges, siteOf }
}

const collapseCache = weakMemo<EdgeCurves, Collapse>()

// The sites too small at this scale to draw as nodes and links, each drawn as
// a tick instead: a pure function of the graph, its layout and the axis, held
// against the curves derived for that axis
export function collapsedSites(
  graph: Graph,
  positions: Record<string, NodeSegment[]>,
  axis: AxisScale,
  curves: EdgeCurves,
  deletions: ReadonlyMap<number, string[]> | undefined,
  hiddenEdges: ReadonlySet<number> | undefined,
) {
  return collapseCache(curves, [graph, positions, deletions, hiddenEdges], () =>
    collapseOf(graph, positions, axis, curves, deletions, hiddenEdges),
  )
}

// A tick's foot and top in backing-store px, under a transform whose dpr is
// 1 for css px
export function tickEnds(
  tick: Pick<Tick, 'x' | 'y' | 'nx' | 'ny' | 'offset' | 'height'>,
  t: {
    scaleX: number
    scaleY: number
    translateX: number
    translateY: number
    dpr: number
  },
) {
  const x = tick.x * t.scaleX + t.translateX
  const y = tick.y * t.scaleY + t.translateY
  const along = (px: number) => ({
    x: x + tick.nx * px * t.dpr,
    y: y + tick.ny * px * t.dpr,
  })
  return [along(tick.offset), along(tick.offset + tick.height)] as const
}

const cell = (px: number) => Math.floor(px / TICK_CELL_PX)
const keyOf = (cx: number, cy: number) => cx * TICK_CELL_ROW + cy

// Whether a screen box lies over any tick, a grid of cells over the ticks
// answering it, so a label's every try costs the few ticks near it
export function ticksUnder(
  ticks: readonly Tick[],
  t: { scaleX: number; scaleY: number; translateX: number; translateY: number },
) {
  const cells = new Map<number, Box[]>()
  for (const tick of ticks) {
    const [foot, top] = tickEnds(tick, { ...t, dpr: 1 })
    const box = {
      x0: Math.min(foot.x, top.x) - tick.thickness,
      x1: Math.max(foot.x, top.x) + tick.thickness,
      y0: Math.min(foot.y, top.y) - tick.thickness,
      y1: Math.max(foot.y, top.y) + tick.thickness,
    }
    for (let cx = cell(box.x0); cx <= cell(box.x1); cx++) {
      for (let cy = cell(box.y0); cy <= cell(box.y1); cy++) {
        const held = cells.get(keyOf(cx, cy))
        if (held) {
          held.push(box)
        } else {
          cells.set(keyOf(cx, cy), [box])
        }
      }
    }
  }
  return (box: Box) => {
    let under = false
    for (let cx = cell(box.x0); cx <= cell(box.x1) && !under; cx++) {
      for (let cy = cell(box.y0); cy <= cell(box.y1) && !under; cy++) {
        under = !!cells.get(keyOf(cx, cy))?.some(tick => overlaps(tick, box))
      }
    }
    return under
  }
}

export function tickHeightPx(count: number, total: number) {
  return (
    TICK_MIN_PX +
    (TICK_MAX_PX - TICK_MIN_PX) *
      (total > 1 ? Math.min(1, (count - 1) / (total - 1)) : 0)
  )
}
