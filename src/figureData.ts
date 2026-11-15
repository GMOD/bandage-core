import { isBackbone } from './anchoredNodes'
import { figureScene } from './figureScene'
import { FIGURE_DEFAULTS, figureFit } from './figureSettings'
import { parseRegion } from './gbzCut'
import { EXON_COLOR } from './genes/exonOutline'
import { genePins } from './genes/genePins'
import { FADED_KEY_INK, RAMP_KEY_STOPS, drawnMarks, graphKey } from './graphKey'
import { labelledNodeLengths, sizeLeader } from './graphLabels'
import { geneLeader, layoutLabels } from './labelLayout'
import { rowInkAt, rowInkOf } from './layout/rowInks'
import { layoutEngine } from './layoutEngines'
import { layoutModeByValue } from './layoutModes'
import { haplotypeCount, nodeFrequency, withFrequencies } from './nodeWidths'
import { LABEL_PX } from './overlayLabels'
import { referenceVisitStarts } from './pathAnchoring'
import {
  engineSettingsOf,
  fitTransform,
  forceLayout,
  loadGraph,
} from './pipeline'
import { referencePositions } from './referenceSpan'
import {
  EDGE_DELETION_COLOR,
  NOT_LOADED_COLOR,
  NOT_LOADED_FILL_COLOR,
  REFERENCE_RAMP_ALT_COLOR,
} from './renderer/GeometryBuilder'
import { abgrAlpha, abgrHex } from './renderer/colorBits'
import { laneSlideAt, passesKey, threadsPasses } from './renderer/walkLanes'
import { version } from './version'
import { axisScaleOf } from './viewport'
import { encodingStops } from './walkEncoding'

import type { BubbleSpread } from './bubbleSpreads'
import type { FigureOptions } from './figure'
import type { GraphKeySection } from './graphKey'
import type { RowInk } from './layout/rowInks'
import type { LayoutEngineKind } from './layoutEngines'
import type { LayoutModeValue } from './layoutModes'
import type { LaneSlide, RenderBatch } from './renderer/types'
import type { Graph, LayoutResult } from './types'
import type { WalkLayer } from './walkEncoding'
import type { LiftedWalk, WalkLift } from './walkHighlight'

// A figure as tables rather than ink: what figureSvg would paint, in layout
// units, for a host with its own graphics system (ggplot2 through V8) to draw.
// Every table is columnar, one array per column, so it reads as a data frame.
// Widths are css px, which a host draws at an absolute size, as the canvas
// does; y grows downward, as on screen.

export type FigureDataOptions = Pick<
  FigureOptions,
  | 'width'
  | 'height'
  | 'walks'
  | 'facet'
  | 'colorScheme'
  | 'nodeWidth'
  | 'edgeWidth'
  | 'showDeletionEdges'
  | 'linearLayout'
  | 'contigThickness'
  | 'connectorThickness'
  | 'region'
  | 'referenceName'
  | 'colorDomain'
  | 'fitToDrawing'
  | 'genes'
  | 'nodeLengths'
>

type Columns<T> = { [K in keyof T]: T[K][] }

interface NodeRow {
  panel: string
  node: string
  stroke: number
  x: number
  y: number
  color: string
  alpha: number
  width: number
  walk: number | null
  pass: number | null
  nx: number
  ny: number
  offset: number
}

interface EdgeRow {
  panel: string
  edge: number
  curve: number
  x0: number
  y0: number
  cx0: number
  cy0: number
  cx1: number
  cy1: number
  x1: number
  y1: number
  color: string
  alpha: number
  width: number
  deletion: boolean
  walk: number | null
  pass: number | null
  nx: number
  ny: number
  offset: number
  nx1: number
  ny1: number
  offset1: number
}

// a lifted walk's key: its colour stops as hex, the field they run over, the
// note and scale its bar is labelled with, and the stretch of its contig a
// progress ramp runs over
interface KeyRow {
  panel: string
  walk: string
  name: string
  color: string
  note: string
  scale: string
  stops: string
  field: string
  contig: string | null
  start: number | null
  end: number | null
}

interface ThreadKeyRow {
  panel: string
  note: string
}

interface PinRow {
  gene: string
  x: number
  y: number
  covered: number
  bp: number
}

// a point of an exon's stretch of node, one `stretch` per polyline
interface ExonRow {
  gene: string
  node: string
  stretch: number
  x: number
  y: number
}

// a label the figure places, as the canvas places it: a node's length, a
// placeholder's first, a gene's name, a bubble's, at the middle of its text,
// `size` px tall, with the leader to what it names where it stands off
interface LabelRow {
  kind: 'placeholder' | 'length' | 'gene' | 'bubble'
  item: string
  text: string
  size: number
  x: number
  y: number
  x1: number | null
  y1: number | null
  x2: number | null
  y2: number | null
}

// an entry of the graph's key, its colours as hex with their alpha
interface GraphKeyRow {
  section: string
  group: string
  key: string
  text: string
  strong: string
  under: string
  swatch: string
  color: string
  alpha: number
  stops: string
  px: number | null
  dashed: boolean
  rim: string
  rimPx: number | null
}

interface ArrowRow {
  panel: string
  edge: number
  x: number
  y: number
  angle: number
  length: number
  halfWidth: number
  color: string
  alpha: number
}

function columns<T extends object>(out: Columns<T>) {
  return {
    out,
    push(row: T) {
      for (const k in out) {
        out[k].push(row[k])
      }
    },
  }
}

const alphaOf = (c: number) => abgrAlpha(c) / 255

// a name's baseline lies about this many of its px under its middle; a
// length's label is placed by its middle already, in 10 px text
const BASELINE_TO_MIDDLE = 0.35
const SIZE_LABEL_PX = 10

function graphKeyTable(sections: GraphKeySection[]) {
  const table = columns<GraphKeyRow>({
    section: [],
    group: [],
    key: [],
    text: [],
    strong: [],
    under: [],
    swatch: [],
    color: [],
    alpha: [],
    stops: [],
    px: [],
    dashed: [],
    rim: [],
    rimPx: [],
  })
  for (const { id, group, entries } of sections) {
    for (const entry of entries) {
      const swatch = entry.swatch
      const ink =
        swatch && swatch.kind !== 'scale' && swatch.kind !== 'overhang'
          ? swatch.ink
          : undefined
      table.push({
        section: id,
        group: group ?? '',
        key: entry.key,
        text: entry.text,
        strong: entry.strong ?? '',
        under: entry.under ?? '',
        swatch: swatch?.kind ?? '',
        color: ink === undefined ? '' : abgrHex(ink),
        alpha: ink === undefined ? 1 : alphaOf(ink),
        stops:
          swatch?.kind === 'scale'
            ? swatch.stops.map(s => abgrHex(s.ink)).join(',')
            : '',
        px: swatch?.kind === 'width' ? swatch.px : null,
        dashed: swatch?.kind === 'line' && swatch.dashed,
        rim: swatch?.kind === 'hollow' ? abgrHex(swatch.rim) : '',
        rimPx: swatch?.kind === 'hollow' ? swatch.rimPx : null,
      })
    }
  }
  return table.out
}

export function figureData(
  graph: Graph,
  layout: LayoutResult,
  o: FigureDataOptions = {},
) {
  if (layout.tubeMap) {
    throw new Error('figure data has no tables for a tube map yet')
  }
  const width = o.width ?? FIGURE_DEFAULTS.width
  const height = o.height ?? FIGURE_DEFAULTS.height
  const pixelRows = layout.pixelRows ?? false
  const {
    bounds,
    colorScheme,
    referenceRamp,
    drawnDeletions,
    lift,
    facets,
    labelOf,
    referenceName,
    keyText,
    contigThickness,
    nodeWidth,
    nodeById,
    geometry,
  } = figureScene(graph, layout, o)
  const fit = fitTransform(bounds, width, height, pixelRows)
  if (!fit) {
    throw new Error('the layout drew nothing to fit')
  }
  const axis = axisScaleOf(fit.scale, pixelRows)

  const panels: {
    highlight?: WalkLift
    name: string
    key: string
    range: string
    firstKeyRow: number
  }[] = []
  const keys = columns<KeyRow>({
    panel: [],
    walk: [],
    name: [],
    color: [],
    note: [],
    scale: [],
    stops: [],
    field: [],
    contig: [],
    start: [],
    end: [],
  })
  const threadKeys = columns<ThreadKeyRow>({ panel: [], note: [] })
  const pushKey = (walk: LiftedWalk, panel: string) => {
    const key = keyText(walk)
    const stops = encodingStops(walk.encoding).map(s => abgrHex(s.abgr))
    keys.push({
      panel,
      walk: labelOf(walk.name),
      name: walk.name,
      color: walk.encoding.field === 'walk' ? stops[0]! : '',
      note: key.note,
      scale: key.scale ?? '',
      stops: stops.join(','),
      field: walk.encoding.field,
      contig: walk.range?.contig ?? null,
      start: walk.range?.start ?? null,
      end: walk.range?.end ?? null,
    })
    return key
  }
  if (facets) {
    const ordered = facets.panels
      .map((panel, i) => ({ panel, cell: facets.place.cells[i]! }))
      .sort((a, b) => a.cell - b.cell)
    for (const { panel } of ordered) {
      const walk = panel.walks[0]!
      const name = labelOf(walk.name)
      const firstKeyRow = keys.out.panel.length
      const key = pushKey(walk, name)
      panels.push({
        highlight: panel,
        name,
        key: key.note,
        range: key.scale ?? '',
        firstKeyRow,
      })
    }
  } else {
    for (const walk of lift?.walks ?? []) {
      pushKey(walk, '')
    }
    if (threadsPasses(lift?.walks ?? [])) {
      threadKeys.push({ panel: '', note: passesKey(lift?.walks ?? []) })
    }
    panels.push({
      highlight: lift,
      name: '',
      key: '',
      range: '',
      firstKeyRow: 0,
    })
  }

  const pins = columns<PinRow>({ gene: [], x: [], y: [], covered: [], bp: [] })
  const exons = columns<ExonRow>({
    gene: [],
    node: [],
    stretch: [],
    x: [],
    y: [],
  })
  let stretch = 0
  const pinned = o.genes?.length
    ? genePins(graph, o.genes, layout.nodePositions)
    : []
  for (const pin of pinned) {
    const gene = pin.gene.name
    pins.push({
      gene,
      x: pin.at.x,
      y: pin.at.y,
      covered: pin.covered,
      bp: pin.gene.end - pin.gene.start,
    })
    for (const { nodeId, stretches } of pin.exonsByNode) {
      for (const points of stretches) {
        stretch++
        for (const { x, y } of points) {
          exons.push({ gene, node: nodeId, stretch, x, y })
        }
      }
    }
  }

  const nodes = columns<NodeRow>({
    panel: [],
    node: [],
    stroke: [],
    x: [],
    y: [],
    color: [],
    alpha: [],
    width: [],
    walk: [],
    pass: [],
    nx: [],
    ny: [],
    offset: [],
  })
  const edges = columns<EdgeRow>({
    panel: [],
    edge: [],
    curve: [],
    x0: [],
    y0: [],
    cx0: [],
    cy0: [],
    cx1: [],
    cy1: [],
    x1: [],
    y1: [],
    color: [],
    alpha: [],
    width: [],
    deletion: [],
    walk: [],
    pass: [],
    nx: [],
    ny: [],
    offset: [],
    nx1: [],
    ny1: [],
    offset1: [],
  })
  const arrows = columns<ArrowRow>({
    panel: [],
    edge: [],
    x: [],
    y: [],
    angle: [],
    length: [],
    halfWidth: [],
    color: [],
    alpha: [],
  })

  const batches: RenderBatch[] = []
  for (const { highlight, name: panel, firstKeyRow } of panels) {
    const batch = geometry(highlight, axis)
    batches.push(batch)
    const keyRowOf = (walk?: number) =>
      walk === undefined ? null : firstKeyRow + walk
    const screen = ({ normal, offsetX }: LaneSlide) => ({
      nx: normal.nx,
      ny: normal.ny,
      offset: offsetX * axis.scaleX,
    })
    for (const [node, run] of batch.nodeStrokeRuns) {
      for (let i = run.start; i < run.start + run.count; i++) {
        const s = batch.nodeStrokes[i]!
        s.points.forEach((p, k) => {
          nodes.push({
            panel,
            node,
            stroke: i,
            x: p.x,
            y: p.y,
            color: abgrHex(s.color),
            alpha: alphaOf(s.color),
            width: s.thickness * 2,
            walk: keyRowOf(s.walk),
            pass: s.pass ?? null,
            nx: s.normals?.[k]?.nx ?? 0,
            ny: s.normals?.[k]?.ny ?? 0,
            offset: (s.offsets?.[k] ?? s.offsetX ?? 0) * axis.scaleX,
          })
        })
      }
    }
    for (const [edge, run] of batch.edgeCurveRuns) {
      for (let i = run.start; i < run.start + run.count; i++) {
        const b = batch.edgeCurves[i]!
        const n = b.curves.length
        const start = b.normal && { normal: b.normal, offsetX: b.offsetX ?? 0 }
        const finish = b.endNormal && {
          normal: b.endNormal,
          offsetX: b.endOffsetX ?? 0,
        }
        const slideAlong = (along: number) =>
          start && finish
            ? screen(laneSlideAt(start, finish, along))
            : { nx: 0, ny: 0, offset: 0 }
        b.curves.forEach((c, k) => {
          const end = slideAlong((k + 1) / n)
          edges.push({
            panel,
            edge,
            curve: i,
            ...c,
            color: abgrHex(b.color),
            alpha: alphaOf(b.color),
            width: b.thickness * 2,
            deletion: drawnDeletions.bypassed.has(edge),
            walk: keyRowOf(b.walk),
            pass: b.pass ?? null,
            ...slideAlong(k / n),
            nx1: end.nx,
            ny1: end.ny,
            offset1: end.offset,
          })
        })
      }
    }
    for (const [edge, run] of batch.arrowRuns) {
      for (let i = run.start; i < run.start + run.count; i++) {
        const a = batch.arrows[i]!
        arrows.push({
          panel,
          edge,
          x: a.x,
          y: a.y,
          angle: a.angle,
          length: a.length,
          halfWidth: a.halfWidth,
          color: abgrHex(a.color),
          alpha: alphaOf(a.color),
        })
      }
    }
  }

  const placed = layoutLabels({
    paneWidth: width,
    canvasHeight: height,
    axisScale: axis,
    translateX: fit.translateX,
    translateY: fit.translateY,
    contigThickness,
    legendSize: { width: 0, height: 0 },
    drawnRowLabels: layout.rowLabels ?? [],
    bubbleHalos: [],
    genePins: pinned,
    nodePositions: layout.nodePositions,
    labelsNodeSizes: !lift,
    nodeLengths: labelledNodeLengths(
      graph.nodes,
      o.nodeLengths ?? FIGURE_DEFAULTS.nodeLengths,
    ),
    nodeById,
    alleleDeletions: layout.alleleDeletions ?? [],
    positionsVersion: 0,
  })
  const toX = (x: number) => (x - fit.translateX) / axis.scaleX
  const toY = (y: number) => (y - fit.translateY) / axis.scaleY
  const labels = columns<LabelRow>({
    kind: [],
    item: [],
    text: [],
    size: [],
    x: [],
    y: [],
    x1: [],
    y1: [],
    x2: [],
    y2: [],
  })
  const pushLabel = (
    kind: LabelRow['kind'],
    item: string,
    text: string,
    at: { x: number; y: number },
    leader?: { x1: number; y1: number; x2: number; y2: number },
  ) => {
    labels.push({
      kind,
      item,
      text,
      size: kind === 'gene' || kind === 'bubble' ? LABEL_PX : SIZE_LABEL_PX,
      x: toX(at.x),
      y: toY(at.y),
      x1: leader ? toX(leader.x1) : null,
      y1: leader ? toY(leader.y1) : null,
      x2: leader ? toX(leader.x2) : null,
      y2: leader ? toY(leader.y2) : null,
    })
  }
  for (const label of placed.sizes) {
    pushLabel(
      nodeById.get(label.node)?.placeholder ? 'placeholder' : 'length',
      label.node,
      label.text,
      label,
      sizeLeader(label),
    )
  }
  for (const { item: pin, x, y, text } of placed.genes) {
    const at = {
      x: pin.at.x * axis.scaleX + fit.translateX,
      y: pin.at.y * axis.scaleY + fit.translateY,
    }
    pushLabel(
      'gene',
      pin.gene.name,
      text,
      { x, y: y - LABEL_PX * BASELINE_TO_MIDDLE },
      geneLeader({ x, y }, at, contigThickness),
    )
  }
  for (const { item: halo, x, y, text } of placed.bubbles) {
    pushLabel('bubble', halo.label, text, {
      x,
      y: y - LABEL_PX * BASELINE_TO_MIDDLE,
    })
  }

  const key = graphKey(graph, layout, {
    region: o.region,
    referenceName,
    referenceRamp,
    lift,
    panels: facets?.panels,
    walkLabel: labelOf,
    nodeWidth,
    contigThickness,
    edgeWidth: o.edgeWidth ?? FIGURE_DEFAULTS.edgeWidth,
    connectorThickness:
      o.connectorThickness ?? FIGURE_DEFAULTS.connectorThickness,
    marks: drawnMarks(batches),
    genePins: pinned,
  })

  const startsOf = referenceVisitStarts(graph)
  const positions = referencePositions(graph)
  const haplotypes = haplotypeCount(graph)
  return {
    meta: {
      generator: `@jbrowse/bandage-core@${version}`,
      width,
      scaleX: axis.scaleX,
      scaleY: axis.scaleY,
      pixelRows,
      referenceAxis: layout.referenceAxis ?? false,
      colorScheme,
      referenceName: referenceName ?? null,
      // the reference bp the position hues run between, hue 0 to 300
      referenceRamp: referenceRamp
        ? {
            start: referenceRamp.start,
            end: referenceRamp.start + referenceRamp.span,
          }
        : null,
      deletions: drawnDeletions.shown.length,
      // the inks the drawing paints what the key names with
      inks: {
        exon: EXON_COLOR,
        ramp: RAMP_KEY_STOPS.map(s => abgrHex(s.ink)),
        offReference: abgrHex(REFERENCE_RAMP_ALT_COLOR),
        placeholderFill: abgrHex(NOT_LOADED_FILL_COLOR),
        placeholderRim: abgrHex(NOT_LOADED_COLOR),
        deletion: abgrHex(EDGE_DELETION_COLOR),
        faded: abgrHex(FADED_KEY_INK),
      },
      // the graph's key, as every reader draws it (graphKey.ts)
      graphKey: graphKeyTable(key),
    },
    panels: {
      panel: panels.map(p => p.name),
      key: panels.map(p => p.key),
      range: panels.map(p => p.range),
    },
    keys: keys.out,
    threadKeys: threadKeys.out,
    pins: pins.out,
    exons: exons.out,
    labels: labels.out,
    walkNames: [...new Set((graph.paths ?? []).map(p => p.name))],
    nodes: nodes.out,
    edges: edges.out,
    arrows: arrows.out,
    nodeInfo: {
      node: graph.nodes.map(n => n.id),
      name: graph.nodes.map(n => n.name),
      length: graph.nodes.map(n => n.length),
      depth: graph.nodes.map(n => n.depth),
      frequency: graph.nodes.map(n => nodeFrequency(n, haplotypes) ?? null),
      backbone: graph.nodes.map(n => isBackbone(n)),
      referenceVisits: graph.nodes.map(n =>
        isBackbone(n) ? startsOf(n).length : 0,
      ),
      position: graph.nodes.map(n => positions.get(n.id) ?? null),
    },
    rowLabels: {
      label: (layout.rowLabels ?? []).map(r => r.label),
      y: (layout.rowLabels ?? []).map(r => r.y),
    },
  }
}

type KeyColumns = Pick<
  Columns<KeyRow>,
  'name' | 'stops' | 'field' | 'contig' | 'start' | 'end'
>

interface WalkRowColumns {
  name: string[]
  bp: number[]
  contig: (string | null)[]
  contigStart: (number | null)[]
  backward: boolean[]
}

// For a host that tiles walk rows itself: the key row naming each walk row's
// walk, or null, and each tile's colour `offset` bp along its row's bar, as
// walk rows draw it (layout/rowInks.ts), null on a row no lifted walk inks
export function walkRowInks(
  keys: KeyColumns,
  rows: WalkRowColumns,
  tiles: { row: number[]; offset: number[] },
) {
  const inks = keys.name.map((walk, k): RowInk => {
    const contig = keys.contig[k]
    const start = keys.start[k]
    const end = keys.end[k]
    return {
      walk,
      stops: keys.stops[k]!.split(','),
      range:
        contig != null && start != null && end != null
          ? { contig, start, end }
          : undefined,
    }
  })
  const named = rows.name.map(name => rowInkOf({ name }, inks))
  const inked = named.map((ink, r) => {
    const contig = rows.contig[r]
    const start = rows.contigStart[r]
    return ink && keys.field[inks.indexOf(ink)] !== 'reference'
      ? {
          ink,
          row: {
            bp: rows.bp[r]!,
            axis:
              contig != null && start != null
                ? { contig, start, reversed: rows.backward[r]! }
                : undefined,
          },
        }
      : undefined
  })
  return {
    key: named.map(ink => (ink ? inks.indexOf(ink) : null)),
    color: tiles.row.map((r, t) => {
      const at = inked[r]
      return at ? rowInkAt(at.ink, at.row, tiles.offset[t]!) : null
    }),
  }
}

export interface GfaFigureSpec extends Omit<
  FigureDataOptions,
  'region' | 'walks' | 'genes'
> {
  // the reference window the GFA was cut for
  region?: string
  walks?: (string | WalkLayer)[]
  layout?: LayoutModeValue
  referencePath?: string
  quality?: number
  bubbleSpread?: BubbleSpread
  // which force engine, Bandage's FMMM when absent
  engine?: LayoutEngineKind
  spacing?: number
  componentSeparation?: number
  // passes per haplotype by segment name, which override an AF tag and what
  // the walks give; `nodeWidth: 'frequency'` draws them
  frequencies?: Record<string, number>
}

// A graph laid out as a spec asks: by its layout mode, or by the force engine
// where the mode leaves the layout to it
export async function laidOutGraph(
  text: string,
  name: string,
  region: FigureOptions['region'],
  spec: GfaFigureSpec,
) {
  const graph = withFrequencies(
    loadGraph(text, name, { referencePath: spec.referencePath }),
    spec.frequencies,
  )
  const layout =
    layoutModeByValue(spec.layout ?? 'force').run(graph, region) ??
    (
      await forceLayout(
        graph,
        engineSettingsOf(spec),
        layoutEngine,
        figureFit(spec),
      )
    ).result
  return { graph, layout }
}

export function walkLayers(walks: GfaFigureSpec['walks']) {
  return walks?.map(w => (typeof w === 'string' ? { walk: w } : w))
}

// GFA text to tables, the whole way, for a host with no file system: the R
// package reads the file itself and hands the text in.
export async function gfaFigureData(
  text: string,
  name: string,
  spec: GfaFigureSpec = {},
) {
  const region = spec.region ? parseRegion(spec.region) : undefined
  const { graph, layout } = await laidOutGraph(text, name, region, spec)
  return figureData(graph, layout, {
    ...spec,
    region,
    walks: walkLayers(spec.walks),
  })
}
