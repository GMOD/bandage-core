import { isBackbone } from './anchoredNodes'
import { spreadFor } from './bubbleSpreads'
import { deletionDrawing, deletionEdges } from './deletionEdges'
import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { gfaTables } from './gfa/gfaTables'
import { graphFromTables } from './gfa/graphTables'
import {
  routeNodes,
  takeRoutes,
  withDeletionRoutes,
} from './layout/deletionRoutes'
import {
  drawnLengthOf,
  drawnNodeLength,
  isProportional,
  layoutScaling,
} from './layout/drawnScale'
import { FIT_PADDING, fitOrAssumed, fitRoom } from './layout/fitAssumptions'
import { mergeRuns, splitRuns } from './layout/mergeRuns'
import { orientToReference } from './layout/orientToReference'
import { clearOfReference } from './layout/referenceClearance'
import { seededNodes } from './layout/referenceSeeds'
import { smoothChain } from './layout/smoothChains'
import { anchorGraph } from './pathAnchoring'
import { MAX_BAND_PX } from './renderer/walkLanes'
import { canonicalEdgeOrder, canonicalNodeOrder } from './util/canonicalOrder'

import type { BubbleSpread } from './bubbleSpreads'
import type { GraphTables } from './gfa/graphTables'
import type { LayoutScaling } from './layout/drawnScale'
import type { FitSize } from './layout/fitAssumptions'
import type { LayoutNode } from './layout/referenceSeeds'
import type { LayoutEngineKind } from './layoutEngines'
import type { Graph, LayoutResult, NodeSegment } from './types'

// The graph a view draws, from GFA text to layouts, with no host in it: the
// GraphGenomeView model and a standalone page both drive this.

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// Text the tables can hold takes their route, a few times faster over a cut
// of millions of walk steps
function graphOf(source: string | GraphTables, name: string) {
  if (typeof source !== 'string') {
    return graphFromTables(source, name)
  }
  const tables = gfaTables(source)
  return tables
    ? graphFromTables(tables, name)
    : convertGFAToGraph(parseGFA(source), name)
}

// GFA text, or the same graph as typed arrays. A general GFA states its
// coordinates only in its P/W lines, so the walk that recovers them happens
// before anything reads `stable`; otherwise the anchored layouts see an
// unanchored graph and hand off to force. `maxNodes` is checked here because it
// is upstream of everything that scales with the node count, and it counts a
// run of steps not loaded as the node a layout places for it.
export function loadGraph(
  source: string | GraphTables,
  name: string,
  opts: { referencePath?: string; maxNodes?: number } = {},
) {
  const graph = graphOf(source, name)
  if (graph.nodes.length === 0) {
    throw new Error(`No graph segments in ${name}`)
  }
  if (opts.maxNodes !== undefined && graph.nodes.length > opts.maxNodes) {
    const unloaded = graph.nodes.filter(node => node.placeholder).length
    throw new Error(
      unloaded > 0
        ? `Graph too large to draw: ${graph.nodes.length.toLocaleString()} nodes, ${unloaded.toLocaleString()} of them stretches whose nodes are not shown (limit ${opts.maxNodes.toLocaleString()}). Zoom in to a smaller region, show fewer haplotypes, or raise maxGraphNodes on this view.`
        : `Graph too large to draw: ${graph.nodes.length.toLocaleString()} nodes (limit ${opts.maxNodes.toLocaleString()}). Zoom in to a smaller region, or raise maxGraphNodes on this view.`,
    )
  }
  return anchorGraph(graph, opts.referencePath)
}

// What the Bandage engine is handed. A node may carry an `x`/`y` seed, which
// the engine reads as where its chain starts (referenceSeeds.ts).
export interface EngineRequest {
  graph: { nodes: LayoutNode[]; edges: Graph['edges'] }
  options: Record<string, unknown>
}

export type LayoutEngine = (
  request: EngineRequest,
) => Promise<{ result: LayoutResult; duration: number }>

export interface EngineSettings {
  quality: number
  linearLayout: boolean
  bubbleSpread: BubbleSpread
  // multipliers on the engine's link length and on the gap it leaves between
  // the graph's components; 1 when absent
  spacing?: number
  componentSeparation?: number
  // false lays the graph out without the deletion edges it can close
  showDeletionEdges?: boolean
  // which engine draws it; Bandage's FMMM when absent (LAYOUT_ENGINES)
  engine?: LayoutEngineKind
}

// What every setting means when a caller leaves it out, so a spec, a view and
// the CLI lay the same graph out the same way.
export const ENGINE_DEFAULTS: Required<EngineSettings> = {
  engine: 'fmmm',
  quality: 2,
  linearLayout: false,
  bubbleSpread: 'auto',
  spacing: 1,
  componentSeparation: 1,
  showDeletionEdges: true,
}

// Settings from a partial set, which is what a figure spec and a host's own
// settings both are. An explicit `undefined` reads as absent, so spreading a
// spec in cannot turn a default off.
export function engineSettingsOf(
  s: Partial<EngineSettings> = {},
): Required<EngineSettings> {
  return {
    engine: s.engine ?? ENGINE_DEFAULTS.engine,
    quality: s.quality ?? ENGINE_DEFAULTS.quality,
    linearLayout: s.linearLayout ?? ENGINE_DEFAULTS.linearLayout,
    bubbleSpread: s.bubbleSpread ?? ENGINE_DEFAULTS.bubbleSpread,
    spacing: s.spacing ?? ENGINE_DEFAULTS.spacing,
    componentSeparation:
      s.componentSeparation ?? ENGINE_DEFAULTS.componentSeparation,
    showDeletionEdges: s.showDeletionEdges ?? ENGINE_DEFAULTS.showDeletionEdges,
  }
}

// FMMM's coarsest level buckled a chain seeded at drawn length into waves.
// Fitted to FMMM's force law, not derived from it: any stretch from 3 to 6
// straightens it
const FMMM_SEED_STRETCH = 4

// the engine's own gap between components, which `componentSeparation` scales
const COMPONENT_SEPARATION = 15

// `scaling.nodes` rather than the graph's own: under a compressing drawn-length
// law a node's `length` crosses this boundary as a drawn length, which is all
// the engine ever reads it as. An anchored graph also carries a seed per node,
// the backbone along x, and asks the engine not to rotate components: FMMM
// then keeps the reference's coarse shape instead of curling it into a C
// (ADR-042).
export function engineRequest(
  graph: Graph,
  scaling: LayoutScaling,
  settings: EngineSettings,
): EngineRequest {
  const anchored = graph.nodes.some(isBackbone)
  const s = engineSettingsOf(settings)
  const canonical = {
    ...graph,
    nodes: canonicalNodeOrder(graph.nodes),
    edges: canonicalEdgeOrder(graph.edges),
  }
  // the seeds lay the backbone out at the spaced link length too
  const spaced = {
    nodes: canonicalNodeOrder(scaling.nodes),
    opts: {
      ...scaling.opts,
      edgeLength: scaling.opts.edgeLength * s.spacing,
    },
  }
  return {
    graph: {
      nodes: anchored
        ? seededNodes(
            canonical,
            spaced,
            s.engine === 'fmmm' ? FMMM_SEED_STRETCH : 1,
          )
        : spaced.nodes,
      edges: canonical.edges,
    },
    options: {
      quality: s.quality,
      linearLayout: s.linearLayout,
      ...spaced.opts,
      componentSeparation: COMPONENT_SEPARATION * s.componentSeparation,
      ...(anchored ? { rotateComponents: false } : {}),
      engine: s.engine,
    },
  }
}

// What a force layout of this graph is a function of, as a cache key: every
// engine setting, whether it seeds, the reference path the seeds follow, and
// what it reads of the pane it is sized for: the stress engine's clearance
// its width and height, a compressing spread's loop floor its width.
export function engineKey(
  graph: Graph,
  settings: EngineSettings,
  fit?: FitSize,
) {
  const s = engineSettingsOf(settings)
  const anchored = graph.nodes.some(isBackbone)
  const { width, height } = fitOrAssumed(fit)
  return [
    ...Object.values(s),
    anchored,
    graph.referencePath ?? '',
    ...(s.engine === 'stress'
      ? [width, height]
      : isProportional(spreadFor(s.bubbleSpread).law)
        ? []
        : [width]),
  ].join('|')
}

// The engine lays out the runs, not the nodes: a base-level cut is thousands
// of nodes in unbranching chains, and one chain per run is the same drawing at
// a third of the time. Members take their share of the run's polyline by drawn
// length, so the picture is per node again before anything else sees it, and
// it is turned so the reference reads left to right.
//
// Seeding a re-cut from the layout before it, and turning the result to
// match, was prototyped and declined (scripts/layout-lab/continuity.ts): FMMM
// keeps only its coarsest level's seeds, and the matched turn carried a
// curled reference's angle forward, to 45 degrees by 125 kb at bovine DEFB.
//
// `fit` is the pane in px the host will fit the drawing into, the size it
// hands fitTransform: the gap between the reference and what lies beside it,
// and under compress the shortest loop off it, are sized in px at that fit.
// Absent, or too small to hold a drawing, the layout assumes ASSUMED_FIT.
export async function forceLayout(
  given: Graph,
  settings: EngineSettings,
  engine: LayoutEngine,
  fit?: FitSize,
) {
  const graph = {
    ...given,
    nodes: canonicalNodeOrder(given.nodes),
    departures: undefined,
  }
  const sized = fitOrAssumed(fit)
  const spread = spreadFor(settings.bubbleSpread)
  const { shown: deletions, hidden: dropped } = deletionDrawing(
    graph,
    deletionEdges(graph),
    settings.showDeletionEdges !== false,
  )
  const routed = withDeletionRoutes(graph, deletions, dropped)
  const merged = mergeRuns(routed.graph, routed.ids)
  const runs = {
    ...merged.graph,
    nodes: merged.graph.nodes.filter(n => !routed.ids.has(n.id)),
  }
  const engineScaling = layoutScaling(runs, spread, loopFloor(sized))
  const drawnOf = drawnLengthOf(runs, spread)
  const { result, duration } = await engine(
    engineRequest(
      merged.graph,
      {
        ...engineScaling,
        nodes: [
          ...engineScaling.nodes,
          ...routeNodes(
            graph,
            deletions,
            routed.routes,
            drawnOf,
            engineScaling.opts,
            engineScaling.nodes.reduce(
              (sum, n) => sum + drawnNodeLength(engineScaling.opts, n.length),
              0,
            ),
          ),
        ],
      },
      settings,
    ),
  )
  const scaling = layoutScaling(graph, spread)
  const drawn = new Map(
    scaling.nodes.map(n => [n.id, drawnNodeLength(scaling.opts, n.length)]),
  )
  const smoothed = Object.fromEntries(
    Object.entries(result.nodePositions).map(([id, line]) => [
      id,
      smoothChain(line),
    ]),
  )
  const positions = splitRuns(smoothed, merged.runs, id => drawn.get(id) ?? 0)
  const routedPositions = takeRoutes(
    graph.nodes.some(isBackbone)
      ? orientToReference(graph, positions)
      : positions,
    routed.routes,
  )
  const { deletionRoutes } = routedPositions
  const tails = departureTails(given)
  const referenceStraight = engineSettingsOf(settings).engine === 'stress'
  const nodePositions = referenceStraight
    ? clearOfReference(
        graph,
        routedPositions.nodePositions,
        fittedExtent(routedPositions.nodePositions, deletionRoutes, tails),
        sized,
      )
    : routedPositions.nodePositions
  return {
    result: {
      ...result,
      nodePositions,
      stranded: true,
      ...(isProportional(spread.law) ? {} : { compressed: true }),
      ...(tails.size > 0
        ? {
            frame: layoutExtent(
              Object.fromEntries(
                Object.entries(nodePositions).filter(([id]) => !tails.has(id)),
              ),
            ),
          }
        : {}),
      ...(deletions.length
        ? { deletionRoutes, extent: layoutExtent(deletionRoutes) }
        : {}),
    },
    duration,
  }
}

// The own steps no walk carries of each departure that leaves or rejoins the
// reference past the cut's ends: a haplotype's sequence on its way to a place
// the cut does not hold. They are drawn at their length like any node, and
// the fit leaves them to run off the pane, as the reference runs on past the
// cut.
export function departureTails(graph: Graph) {
  const tails = new Set<string>()
  const d = graph.departures
  const backbone = graph.nodes.filter(isBackbone)
  if (d && backbone.length > 0) {
    let start = Infinity
    let end = -Infinity
    for (const node of backbone) {
      start = Math.min(start, node.stable.start)
      end = Math.max(end, node.stable.start + node.length)
    }
    const off = (pos: number) => pos < start || pos > end
    const carried = new Set(graph.paths?.flatMap(p => p.nodeIds))
    for (let k = 0; k < d.names.length; k++) {
      if (off(d.leavePos[k]!) || off(d.rejoinPos[k]!)) {
        for (let j = d.offsets[k]!; j < d.offsets[k + 1]!; j++) {
          const id = graph.nodes[d.steps[j]!]?.id
          if (id !== undefined && !carried.has(id)) {
            tails.add(id)
          }
        }
      }
    }
  }
  return tails
}

// What the fit frames of a force layout: its nodes but the departure tails it
// leaves to run off the pane, and its deletion routes
function fittedExtent(
  nodePositions: Record<string, NodeSegment[]>,
  deletionRoutes: Record<number, NodeSegment[]>,
  tails: ReadonlySet<string>,
) {
  const nodes = layoutExtent(
    Object.fromEntries(
      Object.entries(nodePositions).filter(([id]) => !tails.has(id)),
    ),
  )
  const routes = layoutExtent(deletionRoutes)
  return {
    minX: Math.min(nodes.minX, routes.minX),
    minY: Math.min(nodes.minY, routes.minY),
    maxX: Math.max(nodes.maxX, routes.maxX),
    maxY: Math.max(nodes.maxY, routes.maxY),
  }
}

export function layoutExtent(
  nodePositions: Record<string | number, NodeSegment[]>,
): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const segments of Object.values(nodePositions)) {
    for (const seg of segments) {
      minX = Math.min(minX, seg.x)
      minY = Math.min(minY, seg.y)
      maxX = Math.max(maxX, seg.x)
      maxY = Math.max(maxY, seg.y)
    }
  }
  return { minX, minY, maxX, maxY }
}

// A stretch off the reference draws as a loop beside it, and shows only where
// the loop reaches past the widest band of lanes the reference draws with. A
// loop spans its length over pi, and the fit lays the reference across the
// pane.
export function loopFloor(fit?: FitSize) {
  return (Math.PI * MAX_BAND_PX) / fitRoom(fitOrAssumed(fit)).width
}

// The floor keeps a scale positive and finite, and has to clear the smallest
// scale a real layout asks for: fitting a chromosome-scale rGFA (250 Mbp) into
// ~720 px needs ~3e-6.
const MIN_ZOOM = 1e-6
const MAX_ZOOM = 100

export function clampZoom(zoom: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}

// Centre the leftover, but only when there IS leftover. A row layout fits on x
// alone, so its drawing is routinely taller than the pane, and centring an
// overflow would push the top row, the reference backbone, off the top.
export function fittedTranslateY(
  bounds: { minY: number; h: number },
  usableHeight: number,
  yScale: number,
  padTop = FIT_PADDING,
) {
  const leftoverY = usableHeight - bounds.h * yScale
  return padTop - bounds.minY * yScale + Math.max(0, leftoverY) / 2
}

// The transform that fits `bounds` in the pane, or undefined when there is
// nothing to fit or nothing to fit into. Each axis constrains the scale only
// when it has extent, since an anchored window holding only backbone puts every
// node on row 0. A row layout (`pixelRows`) fits on x alone and keeps y in
// screen px; an isotropic one fits on whichever axis binds. Below `minScale`
// the drawing overflows x instead, its left end at the padding. `padLeft`
// widens the left gap past the row labels pinned to that edge, `padTop` the
// top one for the gene rows over a tube map.
export function fitTransform(
  bounds: { minX: number; minY: number; w: number; h: number },
  paneWidth: number,
  paneHeight: number,
  pixelRows: boolean,
  {
    minScale = 0,
    padLeft = FIT_PADDING,
    padTop = FIT_PADDING,
    padRight = FIT_PADDING,
    padBottom = FIT_PADDING,
  } = {},
) {
  const usableWidth = paneWidth - padLeft - padRight
  const usableHeight = paneHeight - padTop - padBottom
  if (
    usableWidth <= 0 ||
    usableHeight <= 0 ||
    !(bounds.w > 0 || (!pixelRows && bounds.h > 0))
  ) {
    return undefined
  }
  const fitX = bounds.w > 0 ? usableWidth / bounds.w : Infinity
  const fitY = bounds.h > 0 ? usableHeight / bounds.h : Infinity
  const scale = clampZoom(
    Math.max(minScale, pixelRows ? fitX : Math.min(fitX, fitY)),
  )
  const leftoverX = usableWidth - bounds.w * scale
  return {
    scale,
    translateX: padLeft - bounds.minX * scale + Math.max(0, leftoverX) / 2,
    translateY: fittedTranslateY(
      bounds,
      usableHeight,
      pixelRows ? 1 : scale,
      padTop,
    ),
  }
}

// Extent of the drawing in layout units, which the fit and the pane height
// read. On a reference-bp layout x is the cut window rather than how far the
// drawing reaches: an allele anchored far outside it is a fact about the
// graph, not a reason to draw the window at 6% of the frame. `extent` stands
// in for the layout's own when an overlay's rows reach further (walk rows).
export function drawingBounds(
  layout: LayoutResult,
  opts: {
    region?: { start: number; end: number }
    extent?: LayoutResult['extent']
  } = {},
) {
  let { minX, minY, maxX, maxY } =
    layout.frame ?? layoutExtent(layout.nodePositions)
  const { region } = opts
  if (layout.referenceAxis && region && region.end > region.start) {
    minX = region.start
    maxX = region.end
  }
  const extent = opts.extent ?? layout.extent
  if (extent) {
    minX = Math.min(minX, extent.minX ?? minX)
    minY = Math.min(minY, extent.minY ?? minY)
    maxX = Math.max(maxX, extent.maxX ?? maxX)
    maxY = Math.max(maxY, extent.maxY ?? maxY)
  }
  return { minX, minY, w: maxX - minX, h: maxY - minY }
}
