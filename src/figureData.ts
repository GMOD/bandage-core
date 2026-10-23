import { isBackbone } from './anchoredNodes'
import { figureScene } from './figureScene'
import { FIGURE_DEFAULTS } from './figureSettings'
import { parseRegion } from './gbzCut'
import { genePins } from './genes/genePins'
import { layoutEngine } from './layoutEngines'
import { layoutModeByValue } from './layoutModes'
import { referenceVisitStarts } from './pathAnchoring'
import {
  engineSettingsOf,
  fitTransform,
  forceLayout,
  loadGraph,
} from './pipeline'
import { referencePositions } from './referenceSpan'
import { abgrAlpha, abgrBlue, abgrGreen, abgrRed } from './renderer/colorBits'
import { laneSlideAt, passesKey, threadsPasses } from './renderer/walkLanes'
import { version } from './version'
import { axisScaleOf } from './viewport'
import { encodingStops } from './walkEncoding'

import type { BubbleSpread } from './bubbleSpreads'
import type { FigureOptions } from './figure'
import type { LayoutEngineKind } from './layoutEngines'
import type { LayoutModeValue } from './layoutModes'
import type { LaneSlide } from './renderer/types'
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

// a lifted walk's key: its colour stops as hex, the field they run over, and
// the note and scale its bar is labelled with
interface KeyRow {
  panel: string
  walk: string
  name: string
  color: string
  note: string
  scale: string
  stops: string
  field: string
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

function columns<T extends object>(keys: (keyof T)[]) {
  const out = Object.fromEntries(
    keys.map(k => [k, []]),
  ) as unknown as Columns<T>
  return {
    out,
    push(row: T) {
      for (const k of keys) {
        out[k].push(row[k])
      }
    },
  }
}

const hex = (v: number) => v.toString(16).padStart(2, '0')
const cssHex = (c: number) =>
  `#${hex(abgrRed(c))}${hex(abgrGreen(c))}${hex(abgrBlue(c))}`
const alphaOf = (c: number) => abgrAlpha(c) / 255

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
  const keys = columns<KeyRow>([
    'panel',
    'walk',
    'name',
    'color',
    'note',
    'scale',
    'stops',
    'field',
  ])
  const threadKeys = columns<ThreadKeyRow>(['panel', 'note'])
  const pushKey = (walk: LiftedWalk, panel: string) => {
    const key = keyText(walk)
    const stops = encodingStops(walk.encoding).map(s => cssHex(s.abgr))
    keys.push({
      panel,
      walk: labelOf(walk.name),
      name: walk.name,
      color: walk.encoding.field === 'walk' ? stops[0]! : '',
      note: key.note,
      scale: key.scale ?? '',
      stops: stops.join(','),
      field: walk.encoding.field,
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

  const pins = columns<PinRow>(['gene', 'x', 'y', 'covered', 'bp'])
  const exons = columns<ExonRow>(['gene', 'node', 'stretch', 'x', 'y'])
  let stretch = 0
  for (const pin of o.genes?.length
    ? genePins(graph, o.genes, layout.nodePositions)
    : []) {
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

  const nodes = columns<NodeRow>([
    'panel',
    'node',
    'stroke',
    'x',
    'y',
    'color',
    'alpha',
    'width',
    'walk',
    'pass',
    'nx',
    'ny',
    'offset',
  ])
  const edges = columns<EdgeRow>([
    'panel',
    'edge',
    'curve',
    'x0',
    'y0',
    'cx0',
    'cy0',
    'cx1',
    'cy1',
    'x1',
    'y1',
    'color',
    'alpha',
    'width',
    'deletion',
    'walk',
    'pass',
    'nx',
    'ny',
    'offset',
    'nx1',
    'ny1',
    'offset1',
  ])
  const arrows = columns<ArrowRow>([
    'panel',
    'edge',
    'x',
    'y',
    'angle',
    'length',
    'halfWidth',
    'color',
    'alpha',
  ])

  for (const { highlight, name: panel, firstKeyRow } of panels) {
    const batch = geometry(highlight, axis)
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
            color: cssHex(s.color),
            alpha: alphaOf(s.color),
            width: s.thickness * 2,
            walk: keyRowOf(s.walk),
            pass: s.pass ?? null,
            nx: s.normals?.[k]?.nx ?? 0,
            ny: s.normals?.[k]?.ny ?? 0,
            offset: (s.offsetX ?? 0) * axis.scaleX,
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
            color: cssHex(b.color),
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
          color: cssHex(a.color),
          alpha: alphaOf(a.color),
        })
      }
    }
  }

  const startsOf = referenceVisitStarts(graph)
  const positions = referencePositions(graph)
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
    walkNames: [...new Set((graph.paths ?? []).map(p => p.name))],
    nodes: nodes.out,
    edges: edges.out,
    arrows: arrows.out,
    nodeInfo: {
      node: graph.nodes.map(n => n.id),
      name: graph.nodes.map(n => n.name),
      length: graph.nodes.map(n => n.length),
      depth: graph.nodes.map(n => n.depth),
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
}

// A graph laid out as a spec asks: by its layout mode, or by the force engine
// where the mode leaves the layout to it
export async function laidOutGraph(
  text: string,
  name: string,
  region: FigureOptions['region'],
  spec: GfaFigureSpec,
) {
  const graph = loadGraph(text, name, { referencePath: spec.referencePath })
  const layout =
    layoutModeByValue(spec.layout ?? 'force').run(graph, region) ??
    (await forceLayout(graph, engineSettingsOf(spec), layoutEngine)).result
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
