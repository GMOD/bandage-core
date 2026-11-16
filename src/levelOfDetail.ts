import { isBackbone } from './anchoredNodes'
import { haplotypeIndex, haplotypeOf } from './nodeWidths'
import { panSNHaplotype } from './pansn'
import { weakMemo } from './util/weakMemo'

import type { AnchoredNode } from './anchoredNodes'
import type { Graph, GraphNode, NodeSegment } from './types'
import type { EdgeCurves } from './util/edgeCurves'
import type { AxisScale } from './util/geometry'

export const SMALL_SITE_PX = 3

export type SmallSites = 'hidden' | 'nodes'

interface Point {
  x: number
  y: number
}

interface Foot {
  edge: number
  atEnd: boolean
}

interface Unit {
  nodes: string[]
  edges: number[]
  feet: Foot[]
  attachments: number[]
  refNames: Set<string>
  walks: number[]
  bp: number
  skip: number | undefined
}

export interface Site {
  nodes: string[]
  edges: number[]
  refName: string
  start: number
  end: number
  bp: number
  x: number
  y: number
  count: number
  total: number
}

export interface Fold {
  sites: Site[]
  nodes: ReadonlySet<string>
  edges: ReadonlySet<number>
  siteOf: ReadonlyMap<string, Site>
  pxPerBp: number
}

export const NO_FOLD: Fold = {
  sites: [],
  nodes: new Set(),
  edges: new Set(),
  siteOf: new Map(),
  pxPerBp: 0,
}

const onReference = (node: GraphNode | undefined): node is AnchoredNode =>
  !!node && isBackbone(node) && !node.placeholder

const forward = (node: AnchoredNode, strand: '+' | '-' | undefined) =>
  (strand ?? '+') === (node.stable.strand ?? '+')

const leavesAt = (node: AnchoredNode, strand: '+' | '-' | undefined) =>
  node.stable.start + (forward(node, strand) ? node.length : 0)

const arrivesAt = (node: AnchoredNode, strand: '+' | '-' | undefined) =>
  node.stable.start + (forward(node, strand) ? 0 : node.length)

function walksByNode(graph: Graph) {
  const haplotypes = haplotypeIndex(graph)
  const byName = new Map<string, number>()
  const byNode = new Map<string, Set<number>>()
  const visit = (nodeId: string, walk: number) => {
    const walks = byNode.get(nodeId)
    if (walks) {
      walks.add(walk)
    } else {
      byNode.set(nodeId, new Set([walk]))
    }
  }
  for (const path of graph.paths ?? []) {
    const walk = haplotypes.get(haplotypeOf(path)) ?? 0
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
  const { total, byNode, walkNamed } = walksByNode(graph)
  const parent = new Map<string, string>()
  for (const node of graph.nodes) {
    if (!isBackbone(node)) {
      parent.set(node.id, node.id)
    }
  }
  const find = (id: string) => {
    let root = id
    let up = parent.get(root)
    while (up !== undefined && up !== root) {
      root = up
      up = parent.get(root)
    }
    let at = id
    while (at !== root) {
      const next = parent.get(at) ?? root
      parent.set(at, root)
      at = next
    }
    return root
  }
  const off = (id: string) => parent.has(id)
  for (const { from, to } of graph.edges) {
    if (off(from) && off(to)) {
      parent.set(find(from), find(to))
    }
  }
  const components = new Map<string, Unit & { tied: boolean }>()
  const componentOf = (id: string) => {
    const root = find(id)
    const known = components.get(root)
    const component = known ?? {
      nodes: [],
      edges: [],
      feet: [],
      attachments: [],
      refNames: new Set<string>(),
      walks: [],
      bp: 0,
      skip: undefined,
      tied: false,
    }
    if (!known) {
      components.set(root, component)
    }
    return component
  }
  for (const node of graph.nodes) {
    if (off(node.id)) {
      const component = componentOf(node.id)
      component.nodes.push(node.id)
      component.bp += node.length
    }
  }
  const skips: Unit[] = []
  graph.edges.forEach(({ from, to, fromStrand, toStrand, pathIds }, edge) => {
    const inside = off(from) ? from : off(to) ? to : undefined
    const outsideId = off(from) ? to : from
    const outside = nodeById.get(outsideId)
    const fromNode = nodeById.get(from)
    const toNode = nodeById.get(to)
    if (inside !== undefined) {
      const component = componentOf(inside)
      component.edges.push(edge)
      if (!off(outsideId)) {
        if (onReference(outside)) {
          component.feet.push({ edge, atEnd: outsideId === to })
          component.refNames.add(outside.stable.refName)
          component.attachments.push(
            outsideId === from
              ? leavesAt(outside, fromStrand)
              : arrivesAt(outside, toStrand),
          )
        } else {
          component.tied = true
        }
      }
    } else if (
      deletions?.has(edge) &&
      !hiddenEdges?.has(edge) &&
      onReference(fromNode) &&
      onReference(toNode)
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
          attachments: [
            leavesAt(fromNode, fromStrand),
            arrivesAt(toNode, toStrand),
          ],
          refNames: new Set([fromNode.stable.refName, toNode.stable.refName]),
          walks: [...walks],
          bp: (deletions.get(edge) ?? []).reduce(
            (sum, id) => sum + (nodeById.get(id)?.length ?? 0),
            0,
          ),
          skip: edge,
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
      units.push({
        ...component,
        bp: component.bp + spread(component.attachments),
        walks: [...walks],
      })
    }
  }
  const backbone = graph.nodes.filter(onReference)
  const keyOf = (unit: Unit) => unit.nodes[0] ?? `#${unit.skip}`
  const sorted = units
    .map(unit => ({ unit, start: least(unit.attachments), key: keyOf(unit) }))
    .sort((a, b) =>
      a.start !== b.start
        ? a.start - b.start
        : a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : 0,
    )
    .map(({ unit }) => unit)
  return {
    units: sorted,
    total,
    backbone: backbone.map(n => n.id),
    backboneBp: backbone.reduce((sum, n) => sum + n.length, 0),
  }
}

const least = (values: readonly number[]) =>
  values.reduce((a, b) => Math.min(a, b), Infinity)

const most = (values: readonly number[]) =>
  values.reduce((a, b) => Math.max(a, b), -Infinity)

const spread = (values: readonly number[]) =>
  values.length > 0 ? most(values) - least(values) : 0

const unitsCache = weakMemo<Graph, ReturnType<typeof unitsOf>>()

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

function drawnPx(line: readonly NodeSegment[], axis: AxisScale) {
  let px = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    px +=
      a && b
        ? Math.hypot((b.x - a.x) * axis.scaleX, (b.y - a.y) * axis.scaleY)
        : 0
  }
  return px
}

function referencePxPerBp(
  backbone: readonly string[],
  backboneBp: number,
  positions: Record<string, NodeSegment[]>,
  axis: AxisScale,
) {
  const px = backbone.reduce(
    (sum, id) => sum + drawnPx(positions[id] ?? [], axis),
    0,
  )
  return backboneBp > 0 ? px / backboneBp : 0
}

function foldOf(
  graph: Graph,
  positions: Record<string, NodeSegment[]>,
  axis: AxisScale,
  curves: EdgeCurves,
  deletions: ReadonlyMap<number, string[]> | undefined,
  hiddenEdges: ReadonlySet<number> | undefined,
): Fold {
  const { units, total, backbone, backboneBp } = unitsCache(
    graph,
    [deletions, hiddenEdges],
    () => unitsOf(graph, deletions, hiddenEdges),
  )
  const pxPerBp = referencePxPerBp(backbone, backboneBp, positions, axis)
  const nodes = new Set<string>()
  const edges = new Set<number>()
  const siteOf = new Map<string, Site>()
  const sites: Site[] = []
  for (const unit of units) {
    const feet = unit.feet.flatMap(foot => {
      const point = footPoint(curves, foot)
      return point ? [point] : []
    })
    const [refName] = unit.refNames
    if (
      refName !== undefined &&
      unit.refNames.size === 1 &&
      pxPerBp > 0 &&
      unit.bp * pxPerBp < SMALL_SITE_PX &&
      feet.length === unit.feet.length &&
      unit.nodes.every(id => positions[id]?.length)
    ) {
      const site: Site = {
        nodes: unit.nodes,
        edges: unit.edges,
        refName,
        start: least(unit.attachments),
        end: most(unit.attachments),
        bp: unit.bp,
        ...mean(feet),
        count: unit.walks.length,
        total,
      }
      sites.push(site)
      for (const id of unit.nodes) {
        nodes.add(id)
        siteOf.set(id, site)
      }
      for (const edge of unit.edges) {
        edges.add(edge)
      }
    }
  }
  return { sites, nodes, edges, siteOf, pxPerBp }
}

const foldCache = weakMemo<EdgeCurves, Fold>()

// The sites too small to draw at this scale: a pure function of the graph,
// its layout and the axis, held against the curves derived for that axis
export function foldedSites(
  graph: Graph,
  positions: Record<string, NodeSegment[]>,
  axis: AxisScale,
  curves: EdgeCurves,
  deletions: ReadonlyMap<number, string[]> | undefined,
  hiddenEdges: ReadonlySet<number> | undefined,
) {
  return foldCache(curves, [graph, positions, deletions, hiddenEdges], () =>
    foldOf(graph, positions, axis, curves, deletions, hiddenEdges),
  )
}
