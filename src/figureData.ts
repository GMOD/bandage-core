import { isBackbone } from './anchoredNodes'
import { facetCells } from './facetGrid'
import { figureScene } from './figureScene'
import { parseRegion } from './gbzCut'
import { layoutEngine } from './layoutEngines'
import { layoutModeByValue } from './layoutModes'
import {
  engineSettingsOf,
  fitTransform,
  forceLayout,
  loadGraph,
} from './pipeline'
import { abgrAlpha, abgrBlue, abgrGreen, abgrRed } from './renderer/colorBits'
import { version } from './version'
import { axisScaleOf } from './viewport'
import { walkKey } from './walkKey'

import type { BubbleSpread } from './bubbleSpreads'
import type { FigureOptions } from './figure'
import type { LayoutEngineKind } from './layoutEngines'
import type { LayoutModeValue } from './layoutModes'
import type { Graph, LayoutResult } from './types'
import type { WalkLayer } from './walkEncoding'
import type { WalkLift } from './walkHighlight'

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
  | 'showDeletionEdges'
  | 'linearLayout'
  | 'contigThickness'
  | 'connectorThickness'
  | 'region'
  | 'referenceName'
  | 'colorDomain'
  | 'fitToDrawing'
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
  const width = o.width ?? 1200
  const height = o.height ?? 800
  const pixelRows = layout.pixelRows ?? false
  const {
    bounds,
    colorScheme,
    drawnDeletions,
    lift,
    facet,
    panels: facetted,
    labelOf,
    referenceName,
    reference,
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
  }[] = []
  if (facetted) {
    const place = facetCells(
      facetted.map(p => p.walks[0]!.name),
      facet.field || 'walk',
      facet.domain,
    )
    const ordered = facetted
      .map((panel, i) => ({ panel, cell: place.cells[i]! }))
      .sort((a, b) => a.cell - b.cell)
    for (const { panel } of ordered) {
      const walk = panel.walks[0]!
      const key = walkKey(walk, reference)
      panels.push({
        highlight: panel,
        name: labelOf(walk.name),
        key: key.delta + key.outside + key.reversed,
        range: key.scale ?? '',
      })
    }
  } else {
    panels.push({ highlight: lift, name: '', key: '', range: '' })
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

  for (const { highlight, name: panel } of panels) {
    const batch = geometry(highlight, axis)
    for (const [node, run] of batch.nodeStrokeRuns) {
      for (let i = run.start; i < run.start + run.count; i++) {
        const s = batch.nodeStrokes[i]!
        for (const p of s.points) {
          nodes.push({
            panel,
            node,
            stroke: i,
            x: p.x,
            y: p.y,
            color: cssHex(s.color),
            alpha: alphaOf(s.color),
            width: s.thickness * 2,
          })
        }
      }
    }
    for (const [edge, run] of batch.edgeCurveRuns) {
      for (let i = run.start; i < run.start + run.count; i++) {
        const b = batch.edgeCurves[i]!
        for (const c of b.curves) {
          edges.push({
            panel,
            edge,
            curve: i,
            ...c,
            color: cssHex(b.color),
            alpha: alphaOf(b.color),
            width: b.thickness * 2,
            deletion: drawnDeletions.bypassed.has(edge),
          })
        }
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
    },
    panels: {
      panel: panels.map(p => p.name),
      key: panels.map(p => p.key),
      range: panels.map(p => p.range),
    },
    nodes: nodes.out,
    edges: edges.out,
    arrows: arrows.out,
    nodeInfo: {
      node: graph.nodes.map(n => n.id),
      name: graph.nodes.map(n => n.name),
      length: graph.nodes.map(n => n.length),
      depth: graph.nodes.map(n => n.depth),
      backbone: graph.nodes.map(n => isBackbone(n)),
    },
    rowLabels: {
      label: (layout.rowLabels ?? []).map(r => r.label),
      y: (layout.rowLabels ?? []).map(r => r.y),
    },
  }
}

export interface GfaFigureSpec extends Omit<
  FigureDataOptions,
  'region' | 'walks'
> {
  region?: string
  walks?: (string | WalkLayer)[]
  layout?: LayoutModeValue
  referencePath?: string
  quality?: number
  bubbleSpread?: BubbleSpread
  engine?: LayoutEngineKind
  spacing?: number
  componentSeparation?: number
}

// GFA text to tables, the whole way, for a host with no file system: the R
// package reads the file itself and hands the text in.
export async function gfaFigureData(
  text: string,
  name: string,
  spec: GfaFigureSpec = {},
) {
  const region = spec.region ? parseRegion(spec.region) : undefined
  const graph = loadGraph(text, name, { referencePath: spec.referencePath })
  const layout =
    layoutModeByValue(spec.layout ?? 'force').run(graph, region) ??
    (await forceLayout(graph, engineSettingsOf(spec), layoutEngine)).result
  return figureData(graph, layout, {
    ...spec,
    region,
    walks: spec.walks?.map(w => (typeof w === 'string' ? { walk: w } : w)),
  })
}
