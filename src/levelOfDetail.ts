import { isBackbone, readsAsReference } from './anchoredNodes'
import { departureTails } from './gfa/departures'
import {
  haplotypeIndex,
  haplotypeOf,
  nodeWidthPx,
  widthNorm,
} from './nodeWidths'
import { panSNHaplotype } from './pansn'
import { cubicLengthPx } from './util/curveLength'
import { partitionPoint } from './util/partitionPoint'
import { flattenedPx, pointInStroke, segmentInStroke } from './util/strokeCover'
import { weakMemo } from './util/weakMemo'
import { MAX_ZOOM } from './zoomLimits'

import type { AnchoredNode } from './anchoredNodes'
import type { NodeWidth } from './nodeWidths'
import type { RenderBatch } from './renderer/types'
import type { Graph, GraphNode, NodeSegment } from './types'
import type { EdgeCurves } from './util/edgeCurves'
import type { AxisScale, BezierCurve } from './util/geometry'
import type { Stroke } from './util/strokeCover'

export const SMALL_SITE_PX = 3

export type SmallSites = 'hidden' | 'nodes'

// how the drawing sets a node's width, which says how wide the reference's
// stroke is
export interface NodeStrokes {
  contigThickness: number
  nodeWidth: NodeWidth
}

// how far a link's curve may be flattened from the curve drawn, in px, when
// asking whether it lies inside the reference's stroke
const FLATNESS_PX = 0.01

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
  // a departure's tail the cut did not load, which states its bp and nothing
  // more
  tail: boolean
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
  // the reference nodes lying between a folded site's attachments
  within: ReadonlyMap<string, Site>
  // the reference through each run of folded sites that overlap or touch:
  // its nodes there, and its own links from one end of the run to the other
  through: ReadonlyMap<string, Run>
  bridges: ReadonlyMap<number, Bridge>
  // the run each folded site belongs to
  runOf: ReadonlyMap<Site, Run>
}

// where a run lies on the reference, and the drawn reference nodes ending
// where it starts and starting where it ends
export interface Run {
  start: number
  end: number
  from: string[]
  to: string[]
}

export interface Bridge {
  run: Run
  at: number
}

// The nodes a batch draws no stroke of their own for: those its fold leaves
// out, and the reference nodes inside a folded site that, with walks lifted,
// only the lanes crossing it draw
export function nodesNotDrawn(
  batch: Pick<RenderBatch, 'collapsed' | 'laneOnly'>,
) {
  const out = new Set(batch.collapsed?.nodes)
  for (const id of batch.laneOnly?.nodes ?? []) {
    out.add(id)
  }
  return out
}

export const NO_FOLD: Fold = {
  sites: [],
  nodes: new Set(),
  edges: new Set(),
  siteOf: new Map(),
  pxPerBp: 0,
  within: new Map(),
  through: new Map(),
  bridges: new Map(),
  runOf: new Map(),
}

interface ReferenceLink {
  edge: number
  at: number
}

interface ReferenceSpan {
  id: string
  start: number
  end: number
}

interface ReferenceSequence {
  spans: ReferenceSpan[]
  links: ReferenceLink[]
  endingAt: Map<number, string[]>
  startingAt: Map<number, string[]>
}

const onReference = (node: GraphNode | undefined): node is AnchoredNode =>
  !!node && isBackbone(node) && !node.placeholder

const leavesAt = (node: AnchoredNode, strand: '+' | '-' | undefined) =>
  node.stable.start + (readsAsReference(node, strand) ? node.length : 0)

const arrivesAt = (node: AnchoredNode, strand: '+' | '-' | undefined) =>
  node.stable.start + (readsAsReference(node, strand) ? 0 : node.length)

const endTouched = (
  node: AnchoredNode,
  strand: '+' | '-' | undefined,
  leaving: boolean,
) => (leaving === readsAsReference(node, strand) ? 'end' : 'start')

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

const listAt = (at: Map<number, string[]>, pos: number, id: string) => {
  at.set(pos, [...(at.get(pos) ?? []), id])
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
  const components = new Map<
    string,
    Unit & { tied: boolean; ends: Set<'start' | 'end'> }
  >()
  const componentOf = (id: string) => {
    const root = find(id)
    const known = components.get(root)
    const component = known ?? {
      nodes: [],
      edges: [],
      feet: [],
      attachments: [],
      ends: new Set<'start' | 'end'>(),
      refNames: new Set<string>(),
      walks: [],
      bp: 0,
      skip: undefined,
      tail: false,
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
  const referenceLinks = new Map<string, ReferenceLink[]>()
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
          component.ends.add(
            outsideId === from
              ? endTouched(outside, fromStrand, true)
              : endTouched(outside, toStrand, false),
          )
        } else {
          component.tied = true
        }
      }
    } else if (
      onReference(fromNode) &&
      onReference(toNode) &&
      fromNode.stable.refName === toNode.stable.refName &&
      leavesAt(fromNode, fromStrand) === arrivesAt(toNode, toStrand)
    ) {
      const held = referenceLinks.get(fromNode.stable.refName) ?? []
      held.push({ edge, at: leavesAt(fromNode, fromStrand) })
      referenceLinks.set(fromNode.stable.refName, held)
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
        const attachments = [
          leavesAt(fromNode, fromStrand),
          arrivesAt(toNode, toStrand),
        ]
        skips.push({
          nodes: [],
          edges: [edge],
          feet: [
            { edge, atEnd: false },
            { edge, atEnd: true },
          ],
          attachments,
          refNames: new Set([fromNode.stable.refName, toNode.stable.refName]),
          walks: [...walks],
          bp: spread(attachments),
          skip: edge,
          tail: false,
        })
      }
    }
  })
  const units: Unit[] = [...skips]
  const tails = departureTails(graph)
  for (const { tied, ends, ...component } of components.values()) {
    const walks = new Set<number>()
    for (const id of component.nodes) {
      for (const walk of byNode.get(id) ?? []) {
        walks.add(walk)
      }
    }
    const tail = component.nodes.some(id => tails.has(id))
    if (
      !tied &&
      (ends.size === 2 || component.feet.length === 1) &&
      (!tail || component.nodes.every(id => nodeById.get(id)?.placeholder)) &&
      walks.size > 0
    ) {
      units.push({
        ...component,
        bp: component.bp + spread(component.attachments),
        walks: [...walks],
        tail,
      })
    }
  }
  const backbone = graph.nodes.filter(onReference)
  const references = new Map<string, ReferenceSequence>()
  const referenceOf = (refName: string) => {
    const known = references.get(refName)
    const reference = known ?? {
      spans: [],
      links: [],
      endingAt: new Map<number, string[]>(),
      startingAt: new Map<number, string[]>(),
    }
    if (!known) {
      references.set(refName, reference)
    }
    return reference
  }
  for (const node of backbone) {
    const { refName, start } = node.stable
    const reference = referenceOf(refName)
    const end = start + node.length
    reference.spans.push({ id: node.id, start, end })
    listAt(reference.endingAt, end, node.id)
    listAt(reference.startingAt, start, node.id)
  }
  for (const [refName, links] of referenceLinks) {
    referenceOf(refName).links = links
  }
  for (const reference of references.values()) {
    reference.spans.sort((a, b) => a.start - b.start)
    reference.links.sort((a, b) => a.at - b.at)
  }
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
    references,
  }
}

function spansInside(
  spans: readonly ReferenceSpan[],
  start: number,
  end: number,
) {
  const inside: ReferenceSpan[] = []
  for (
    let i = partitionPoint(spans.length, k => spans[k]!.start < start);
    i < spans.length && spans[i]!.start < end;
    i++
  ) {
    const span = spans[i]!
    if (span.end <= end && span.end > span.start) {
      inside.push(span)
    }
  }
  return inside
}

function within(
  sites: readonly Site[],
  references: Map<string, ReferenceSequence>,
) {
  const inside = new Map<string, Site>()
  for (const site of sites) {
    const spans = references.get(site.refName)?.spans ?? []
    for (const span of spansInside(spans, site.start, site.end)) {
      inside.set(span.id, site)
    }
  }
  return inside
}

// Folded sites whose spans on the reference overlap or touch make one run,
// and the reference through it is drawn as one: its nodes between the run's
// outer attachments and its own links from one to the other
function through(
  sites: readonly Site[],
  references: Map<string, ReferenceSequence>,
) {
  const nodes = new Map<string, Run>()
  const bridges = new Map<number, Bridge>()
  const runOf = new Map<Site, Run>()
  const byStart = sites.toSorted((a, b) =>
    a.refName !== b.refName
      ? a.refName < b.refName
        ? -1
        : 1
      : a.start - b.start,
  )
  let k = 0
  while (k < byStart.length) {
    const { refName } = byStart[k]!
    const { start } = byStart[k]!
    let { end } = byStart[k]!
    const first = k
    k++
    while (
      k < byStart.length &&
      byStart[k]!.refName === refName &&
      byStart[k]!.start <= end
    ) {
      end = Math.max(end, byStart[k]!.end)
      k++
    }
    const reference = references.get(refName)
    if (reference) {
      const inside = spansInside(reference.spans, start, end)
      const run = {
        start,
        end,
        from: reference.endingAt.get(start) ?? [],
        to: reference.startingAt.get(end) ?? [],
      }
      for (const span of inside) {
        nodes.set(span.id, run)
      }
      for (const site of byStart.slice(first, k)) {
        runOf.set(site, run)
      }
      const { links } = reference
      for (
        let i = partitionPoint(links.length, j => links[j]!.at < start);
        i < links.length && links[i]!.at <= end;
        i++
      ) {
        bridges.set(links[i]!.edge, { run, at: links[i]!.at })
      }
    }
  }
  return { nodes, bridges, runOf }
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

// how long a link's curve is drawn on screen
const curvePx = (curves: readonly BezierCurve[], axis: AxisScale) =>
  curves.reduce((px, c) => px + cubicLengthPx(c, axis.scaleX, axis.scaleY), 0)

// the straight distance between a link's ends on screen, which no drawing
// of it at any zoom is shorter than
function chordPx(curves: readonly BezierCurve[], axis: AxisScale) {
  const first = curves[0]
  const last = curves.at(-1)
  return first && last
    ? Math.hypot(
        (last.x1 - first.x0) * axis.scaleX,
        (last.y1 - first.y0) * axis.scaleY,
      )
    : 0
}

// How long a piece is drawn on screen: its own nodes and links, and the
// reference between its attachments as that is drawn, its nodes and its own
// links there, never the straight distance between the attachments, so a
// long skip whose ends the layout set close together is not small
function drawnSize(
  unit: Unit,
  reference: ReferenceSequence | undefined,
  nodePx: (id: string) => number,
  edgePx: (edge: number) => number,
) {
  const start = least(unit.attachments)
  const end = most(unit.attachments)
  const links = reference?.links ?? []
  let px = 0
  for (const id of unit.nodes) {
    px += nodePx(id)
  }
  for (const edge of unit.edges) {
    px += edgePx(edge)
  }
  for (const span of reference
    ? spansInside(reference.spans, start, end)
    : []) {
    px += nodePx(span.id)
  }
  for (
    let i = partitionPoint(links.length, j => links[j]!.at < start);
    i < links.length && links[i]!.at <= end;
    i++
  ) {
    px += edgePx(links[i]!.edge)
  }
  return px
}

// each key measured the first time it is asked for, and held
function once<K>(measure: (key: K) => number) {
  const held = new Map<K, number>()
  return (key: K) => {
    const known = held.get(key)
    const px = known ?? measure(key)
    if (known === undefined) {
      held.set(key, px)
    }
    return px
  }
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

const onScreen = (p: Point, axis: AxisScale) => ({
  x: p.x * axis.scaleX,
  y: p.y * axis.scaleY,
})

// whether every point of a piece's nodes as laid and its links as drawn lies
// inside a stroke, at this axis
function laidInside(
  unit: Unit,
  stroke: Stroke,
  positions: Record<string, NodeSegment[]>,
  curves: EdgeCurves,
  axis: AxisScale,
) {
  const lines = unit.nodes.map(id =>
    (positions[id] ?? []).map(p => onScreen(p, axis)),
  )
  const along = (line: readonly Point[], inset: number) =>
    line.every(
      (p, i) => i === 0 || segmentInStroke(line[i - 1]!, p, stroke, inset),
    )
  return (
    lines.every(line => line.every(p => pointInStroke(p, stroke))) &&
    lines.every(line => along(line, 0)) &&
    unit.edges.every(edge =>
      (curves.get(edge) ?? []).every(c =>
        along(
          flattenedPx(c, axis.scaleX, axis.scaleY, FLATNESS_PX),
          FLATNESS_PX,
        ),
      ),
    )
  )
}

function foldOf(
  graph: Graph,
  positions: Record<string, NodeSegment[]>,
  axis: AxisScale,
  curves: EdgeCurves,
  deletions: ReadonlyMap<number, string[]> | undefined,
  hiddenEdges: ReadonlySet<number> | undefined,
  strokes: NodeStrokes,
): Fold {
  const { units, total, backbone, backboneBp, references } = unitsCache(
    graph,
    [deletions, hiddenEdges],
    () => unitsOf(graph, deletions, hiddenEdges),
  )
  const pxPerBp = referencePxPerBp(backbone, backboneBp, positions, axis)
  const deepest = {
    ...axis,
    scaleX: MAX_ZOOM,
    scaleY: axis.pixelRows ? axis.scaleY : MAX_ZOOM,
  }
  const deepestPxPerBp = referencePxPerBp(
    backbone,
    backboneBp,
    positions,
    deepest,
  )
  const placeholders = new Set(
    graph.nodes.flatMap(n => (n.placeholder ? [n.id] : [])),
  )
  const measured = (
    axisOf: AxisScale,
    linkPx: (curves: readonly BezierCurve[], axis: AxisScale) => number,
  ) => ({
    node: once((id: string) => drawnPx(positions[id] ?? [], axisOf)),
    edge: once((edge: number) => linkPx(curves.get(edge) ?? [], axisOf)),
  })
  const atAxis = measured(axis, curvePx)
  const atDeepest = measured(deepest, chordPx)
  // A piece is small as it is drawn, at this axis, and comes back at the
  // deepest zoom, drawn no shorter there than its links' straight ends. A
  // not-loaded stretch is drawn at the layout's least length whatever its
  // bp, so a piece holding one is also measured by its bp at the
  // reference's px a bp, and the smaller measure counts; a departure's tail
  // the cut did not load is measured by its bp alone
  const sizeOf = (unit: Unit, refName: string) => {
    const reference = references.get(refName)
    const shown = drawnSize(unit, reference, atAxis.node, atAxis.edge)
    const back = drawnSize(unit, reference, atDeepest.node, atDeepest.edge)
    const stated = unit.nodes.some(id => placeholders.has(id)) && pxPerBp > 0
    return unit.tail
      ? { shown: unit.bp * pxPerBp, back: unit.bp * deepestPxPerBp }
      : {
          shown: stated ? Math.min(shown, unit.bp * pxPerBp) : shown,
          back: stated ? Math.min(back, unit.bp * deepestPxPerBp) : back,
        }
  }
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const norm = widthNorm(graph, strokes.nodeWidth)
  const halfWidthOf = (id: string) => {
    const node = nodeById.get(id)
    return node
      ? nodeWidthPx(node, strokes.contigThickness, strokes.nodeWidth, norm) / 2
      : 0
  }
  // The reference's stroke between a piece's attachments, on screen at an
  // axis: the laid lines of the reference nodes lying wholly between them and
  // the points where its links meet the reference, each widened by half the
  // least drawn width of those nodes and the reference nodes its links meet
  const referenceStroke = (
    unit: Unit,
    reference: ReferenceSequence | undefined,
    feet: readonly Point[],
    axisOf: AxisScale,
  ): Stroke => {
    const between = reference
      ? spansInside(
          reference.spans,
          least(unit.attachments),
          most(unit.attachments),
        ).map(span => span.id)
      : []
    const met = unit.feet.flatMap(({ edge, atEnd }) => {
      const link = graph.edges[edge]
      return link ? [atEnd ? link.to : link.from] : []
    })
    return {
      lines: between.map(id =>
        (positions[id] ?? []).map(p => onScreen(p, axisOf)),
      ),
      points: feet.map(p => onScreen(p, axisOf)),
      halfWidth: [...between, ...met].reduce(
        (half, id) => Math.min(half, halfWidthOf(id)),
        Infinity,
      ),
    }
  }
  // A piece drawn inside the reference's stroke between its attachments
  // shows no length of its own, so it is measured by its bp at the
  // reference's px a bp, and folds where that is small and, at the deepest
  // zoom, that comes to SMALL_SITE_PX and a point of its nodes as laid comes
  // out of that stroke
  const coveredOf = (
    unit: Unit,
    reference: ReferenceSequence | undefined,
    feet: readonly Point[],
  ) => {
    const comesOut = () => {
      const deepStroke = referenceStroke(unit, reference, feet, deepest)
      return unit.nodes.some(id =>
        (positions[id] ?? []).some(
          p => !pointInStroke(onScreen(p, deepest), deepStroke),
        ),
      )
    }
    return (
      unit.nodes.length > 0 &&
      unit.bp * pxPerBp < SMALL_SITE_PX &&
      unit.bp * deepestPxPerBp >= SMALL_SITE_PX &&
      laidInside(
        unit,
        referenceStroke(unit, reference, feet, axis),
        positions,
        curves,
        axis,
      ) &&
      comesOut()
    )
  }
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
    const size =
      refName !== undefined &&
      unit.refNames.size === 1 &&
      unit.bp > 0 &&
      feet.length === unit.feet.length &&
      unit.nodes.every(id => positions[id]?.length)
        ? sizeOf(unit, refName)
        : undefined
    if (
      refName !== undefined &&
      size &&
      size.back >= SMALL_SITE_PX &&
      (size.shown < SMALL_SITE_PX ||
        coveredOf(unit, references.get(refName), feet))
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
  const reference = through(sites, references)
  return {
    sites,
    nodes,
    edges,
    siteOf,
    pxPerBp,
    within: within(sites, references),
    through: reference.nodes,
    bridges: reference.bridges,
    runOf: reference.runOf,
  }
}

const foldCache = weakMemo<EdgeCurves, Fold>()

// A bp every folded site is under: the largest folded site's bp and one more
export const foldedUnderBp = (fold: Fold) =>
  fold.sites.reduce((bp, site) => Math.max(bp, site.bp + 1), 0)

// The sites too small to draw at this scale: a pure function of the graph,
// its layout and the axis, held against the curves derived for that axis
export function foldedSites(
  graph: Graph,
  positions: Record<string, NodeSegment[]>,
  axis: AxisScale,
  curves: EdgeCurves,
  deletions: ReadonlyMap<number, string[]> | undefined,
  hiddenEdges: ReadonlySet<number> | undefined,
  strokes: NodeStrokes,
) {
  return foldCache(
    curves,
    [
      graph,
      positions,
      deletions,
      hiddenEdges,
      strokes.contigThickness,
      strokes.nodeWidth,
    ],
    () =>
      foldOf(graph, positions, axis, curves, deletions, hiddenEdges, strokes),
  )
}
