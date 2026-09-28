import { resolveColorScheme } from './colorSchemes'
import { deletionEdges } from './deletionEdges'
import {
  FACET_GAP_PX,
  FACET_PAD_PX,
  FACET_TITLE_PX,
  facetCells,
  facetGrid,
} from './facetGrid'
import { LABEL_CHAR_PX } from './overlayLabels'
import { pathLegend } from './pathColors'
import { FIT_PADDING, drawingBounds, fitTransform } from './pipeline'
import { Canvas2DRenderer } from './renderer/Canvas2DRenderer'
import { buildGeometry, computeReferenceRamp } from './renderer/GeometryBuilder'
import { svgCanvas } from './renderer/svgCanvas'
import { axisScaleOf } from './viewport'
import { encodingStops } from './walkEncoding'
import { facetLifts, walkLift } from './walkHighlight'
import { rangeText, walkKey } from './walkKey'

import type { ColorScheme } from './colorSchemes'
import type { FacetBy } from './facetGrid'
import type { NodeWidth } from './nodeWidths'
import type { Graph, LayoutResult } from './types'
import type { WalkLayer } from './walkEncoding'
import type { LiftedWalk, WalkLift } from './walkHighlight'

// A graph drawn to a standalone SVG, the way the plugin and BandageJS draw it
// on screen: the same geometry through the same renderer, with the lifted
// walks' keys and, faceted, a panel per walk or a row per sample. It reads no
// DOM, so a script can make the figure from a spec and make it again.

export interface FigureOptions {
  width?: number
  // the most the figure may take; it takes less where the drawing needs less
  height?: number
  walks?: WalkLayer[]
  facet?: 'none' | FacetBy
  columns?: number
  colorScheme?: ColorScheme
  nodeWidth?: NodeWidth
  showDeletionEdges?: boolean
  contigThickness?: number
  connectorThickness?: number
  // the window the graph was cut for, which the anchored layouts and the
  // reference-position ramp span
  region?: { refName: string; start: number; end: number }
  // how the figure was made, kept in the SVG
  metadata?: string
}

const FONT = 'font-family="Helvetica, Arial, sans-serif" font-size="11"'
const BAR_PX = 48
const SWATCH_PX = 18
const KEY_GAP_PX = 16
const FADED = 'rgb(160,160,160)'

function esc(s: string) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// A key at (x, y): a swatch or a short bar of its scale, bold `label` and
// `after` beside it, and `under` on the line below. Returns its markup and
// about how wide it is.
function keySvg(
  id: string,
  x: number,
  y: number,
  stops: { offset: number; color: string }[],
  label: string,
  after: string,
  under: string | undefined,
  opacity = 1,
) {
  const bar = stops.length > 1 ? BAR_PX : SWATCH_PX
  const fill =
    stops.length > 1
      ? `fill="url(#${id})"`
      : `fill="${stops[0]!.color}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}`
  const defs =
    stops.length > 1
      ? `<linearGradient id="${id}">${stops
          .map(s => `<stop offset="${s.offset}" stop-color="${s.color}"/>`)
          .join('')}</linearGradient>`
      : ''
  const width = Math.max(
    bar + 5 + (label.length + after.length) * LABEL_CHAR_PX,
    (under?.length ?? 0) * LABEL_CHAR_PX,
  )
  return {
    width,
    markup: `${defs}<g transform="translate(${x} ${y})" ${FONT}><rect y="5" width="${bar}" height="8" rx="2" ${fill}/><text x="${bar + 5}" y="13"><tspan font-weight="bold">${esc(label)}</tspan>${esc(after)}</text>${
      under ? `<text y="28">${esc(under)}</text>` : ''
    }</g>`,
  }
}

function walkKeySvg(
  id: string,
  x: number,
  y: number,
  walk: LiftedWalk,
  label: string,
  reference: { name?: string; start: number; end: number } | undefined,
) {
  const key = walkKey(walk, reference)
  return keySvg(
    id,
    x,
    y,
    encodingStops(walk.encoding),
    label,
    key.delta + key.reversed,
    key.scale,
  )
}

export function figureSvg(
  graph: Graph,
  layout: LayoutResult,
  o: FigureOptions = {},
) {
  const width = o.width ?? 1200
  const room = o.height ?? 800
  const region = o.region
  const bounds = drawingBounds(layout, { region })
  const pixelRows = layout.pixelRows ?? false
  const nodeById = new Map(graph.nodes.map(node => [node.id, node]))
  const colorScheme = resolveColorScheme(o.colorScheme ?? 'auto', graph)
  const referenceRamp =
    colorScheme === 'reference-position' && !layout.tubeMap
      ? computeReferenceRamp(graph, region)
      : undefined
  const deletions = layout.tubeMap ? [] : deletionEdges(graph)
  const layers = o.walks ?? []
  const walkRamp = layers.some(l => l.color?.field === 'reference')
    ? (referenceRamp ?? computeReferenceRamp(graph, region))
    : undefined
  const lift =
    layers.length > 0 && !layout.tubeMap
      ? walkLift(graph, layers, walkRamp)
      : undefined
  const by = o.facet ?? 'none'
  const panels =
    by !== 'none' && lift && lift.walks.length > 1
      ? facetLifts(graph, lift, layers, walkRamp)
      : undefined
  const labels = new Map(
    (graph.paths?.length ? pathLegend(graph.paths) : []).map(p => [
      p.name,
      p.label,
    ]),
  )
  const labelOf = (name: string) => labels.get(name) ?? name
  const reference = lift?.referenceDomain && {
    ...lift.referenceDomain,
    name: region?.refName,
  }

  function drawing(highlight: WalkLift | undefined, w: number, h: number) {
    const fit = fitTransform(
      bounds,
      w,
      h,
      pixelRows,
      panels
        ? {
            padLeft: FACET_PAD_PX,
            padTop: FACET_PAD_PX,
            padRight: FACET_PAD_PX,
            padBottom: FACET_PAD_PX,
          }
        : {},
    )
    if (!fit) {
      return ''
    }
    const axis = axisScaleOf(fit.scale, pixelRows)
    const { canvas, markup } = svgCanvas(w, h)
    const renderer = new Canvas2DRenderer(canvas)
    renderer.uploadGeometry(
      buildGeometry({
        nodePositions: layout.nodePositions,
        graph,
        nodeById,
        colorScheme,
        contigThickness: o.contigThickness ?? 6,
        connectorThickness: o.connectorThickness ?? 2,
        drawPaths: false,
        nodeWidth: o.nodeWidth ?? 'depth',
        highlight,
        axis,
        referenceRamp,
        deletions: new Map(deletions.map(d => [d.edgeIndex, d.bypassed])),
        hiddenEdges: new Set(
          o.showDeletionEdges ? [] : deletions.map(d => d.edgeIndex),
        ),
      }),
    )
    renderer.updateTransform({
      scaleX: axis.scaleX,
      scaleY: axis.scaleY,
      translateX: fit.translateX,
      translateY: fit.translateY,
      dpr: 1,
    })
    renderer.render([1, 1, 1, 1])
    return markup()
  }

  const parts: string[] = []
  let height: number
  if (panels) {
    const place = facetCells(
      panels.map(p => p.walks[0]!.name),
      by as FacetBy,
    )
    const grid = facetGrid({
      count: place.count,
      bounds,
      pixelRows,
      width,
      room,
      columns: place.columns ?? o.columns,
    })
    panels.forEach((panel, i) => {
      const cell = place.cells[i]!
      const x = (cell % grid.columns) * (grid.width + FACET_GAP_PX)
      const y =
        Math.floor(cell / grid.columns) *
        (grid.height + FACET_TITLE_PX + FACET_GAP_PX)
      const walk = panel.walks[0]!
      parts.push(
        walkKeySvg(`key${i}`, x + 6, y + 2, walk, labelOf(walk.name), reference)
          .markup,
        `<svg x="${x}" y="${y + FACET_TITLE_PX}" width="${grid.width}" height="${grid.height}">${drawing(panel, grid.width, grid.height)}</svg>`,
      )
    })
    height = grid.total
  } else {
    let x = 6
    const push = (key: { width: number; markup: string }) => {
      parts.push(key.markup)
      x += key.width + KEY_GAP_PX
    }
    if (lift) {
      lift.walks.forEach((walk, i) => {
        push(walkKeySvg(`key${i}`, x, 2, walk, labelOf(walk.name), reference))
      })
      push(
        keySvg(
          'faded',
          x,
          2,
          [{ offset: 0, color: FADED }],
          '',
          `not on ${lift.walks.length === 1 ? labelOf(lift.walks[0]!.name) : 'these walks'}`,
          undefined,
          0.3,
        ),
      )
    } else if (referenceRamp) {
      push(
        keySvg(
          'ramp',
          x,
          2,
          encodingStops({ field: 'reference', scheme: 'rainbow' }),
          'Reference position',
          '',
          rangeText(
            region?.refName,
            referenceRamp.start,
            referenceRamp.start + referenceRamp.span,
          ),
        ),
      )
    }
    const header = parts.length > 0 ? FACET_TITLE_PX : 0
    const usable = width - 2 * FIT_PADDING
    const drawn =
      pixelRows || !(bounds.w > 0) ? bounds.h : (bounds.h * usable) / bounds.w
    const h = Math.max(
      160,
      Math.min(room - header, Math.ceil(drawn + 2 * FIT_PADDING)),
    )
    parts.push(
      `<svg y="${header}" width="${width}" height="${h}">${drawing(lift, width, h)}</svg>`,
    )
    height = header + h
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${o.metadata ? `<metadata>${esc(o.metadata)}</metadata>` : ''}<rect width="${width}" height="${height}" fill="#fff"/>${parts.join('')}</svg>\n`
}
