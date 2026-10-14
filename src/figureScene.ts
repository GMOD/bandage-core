import { resolveColorScheme } from './colorSchemes'
import { deletionDrawing, deletionEdges } from './deletionEdges'
import { facetCells, facetSettingOf } from './facetGrid'
import { FIGURE_DEFAULTS } from './figureSettings'
import { walkRowsExtent } from './layout/walkRowLayout'
import { pathLegend, walkLabelsOf } from './pathColors'
import { drawingBounds } from './pipeline'
import { referenceLabel } from './reference'
import { buildGeometry, computeReferenceRamp } from './renderer/GeometryBuilder'
import { layoutGeometryInputs } from './renderer/geometryInputs'
import { facetLifts, walkLift } from './walkHighlight'
import { walkKey } from './walkKey'

import type { FigureOptions } from './figure'
import type { Graph, LayoutResult } from './types'
import type { AxisScale } from './util/geometry'
import type { LiftedWalk, WalkLift } from './walkHighlight'

export type FigureSceneOptions = Pick<
  FigureOptions,
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
  | 'walkRows'
  | 'walkRowPitch'
>

// What figureSvg and figureData both draw from: the fit's bounds, the colors,
// the lifted walks and their facet panels, and the geometry of one panel
export function figureScene(
  graph: Graph,
  layout: LayoutResult,
  o: FigureSceneOptions,
) {
  const region = o.region
  const rampDomain = o.colorDomain ?? region
  const rows = o.walkRows
  const bounds = drawingBounds(layout, {
    region: o.fitToDrawing ? undefined : region,
    extent:
      rows && layout.extent ? walkRowsExtent(rows, o.walkRowPitch) : undefined,
  })
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]))
  const colorScheme = resolveColorScheme(
    o.colorScheme ?? FIGURE_DEFAULTS.colorScheme,
    graph,
  )
  const referenceRamp =
    colorScheme === 'reference-position' && !layout.tubeMap
      ? computeReferenceRamp(graph, rampDomain)
      : undefined
  const drawnDeletions = deletionDrawing(
    graph,
    layout.tubeMap ? [] : deletionEdges(graph),
    o.showDeletionEdges,
  )
  const layers = o.walks ?? []
  const walkRamp = layers.some(l => l.color?.field === 'reference')
    ? (referenceRamp ?? computeReferenceRamp(graph, rampDomain))
    : undefined
  const lift =
    layers.length > 0 && !layout.tubeMap
      ? walkLift(graph, layers, walkRamp)
      : undefined
  const facet = facetSettingOf(o.facet)
  const panels =
    facet.field && lift && lift.walks.length > 1
      ? facetLifts(graph, lift, layers, walkRamp)
      : undefined
  const facets =
    facet.field && panels
      ? {
          panels,
          place: facetCells(
            panels.map(p => p.walks[0]!.name),
            facet.field,
            facet.domain,
          ),
        }
      : undefined
  const labels = walkLabelsOf(
    graph.paths?.length ? pathLegend(graph.paths) : [],
  )
  const referenceName = o.referenceName ?? referenceLabel(graph, region)
  const contigThickness = o.contigThickness ?? FIGURE_DEFAULTS.contigThickness
  const nodeWidth = o.nodeWidth ?? FIGURE_DEFAULTS.nodeWidth
  const reference = lift?.referenceDomain && {
    ...lift.referenceDomain,
    name: referenceName,
  }
  return {
    bounds,
    nodeById,
    colorScheme,
    referenceRamp,
    drawnDeletions,
    layers,
    lift,
    facet,
    facets,
    labelOf: (name: string) => labels.get(name) ?? name,
    referenceName,
    keyText: (walk: LiftedWalk) => {
      const key = walkKey(walk, reference)
      return { note: key.delta + key.outside + key.reversed, scale: key.scale }
    },
    contigThickness,
    nodeWidth,
    geometry: (highlight: WalkLift | undefined, axis: AxisScale) =>
      buildGeometry({
        ...layoutGeometryInputs(layout, drawnDeletions, { drawsRows: !!rows }),
        graph,
        nodeById,
        colorScheme,
        contigThickness,
        connectorThickness:
          o.connectorThickness ?? FIGURE_DEFAULTS.connectorThickness,
        drawPaths: false,
        nodeWidth,
        linearLayout: o.linearLayout,
        highlight,
        axis,
        referenceRamp,
      }),
  }
}
