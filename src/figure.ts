import { resolveColorScheme } from './colorSchemes'
import { deletionEdges } from './deletionEdges'
import {
  FACET_GAP_PX,
  FACET_PAD_PX,
  FACET_TITLE_PX,
  facetCells,
  facetGrid,
} from './facetGrid'
import { genePins } from './genes/genePins'
import { geneLabelCandidates } from './labelLayout'
import { nodeInk } from './nodeWidths'
import {
  LABEL_CHAR_PX,
  LABEL_PAD,
  LABEL_PX,
  occupancy,
  placeLabels,
} from './overlayLabels'
import { pathLegend } from './pathColors'
import { FIT_PADDING, drawingBounds, fitTransform } from './pipeline'
import { Canvas2DRenderer } from './renderer/Canvas2DRenderer'
import { buildGeometry, computeReferenceRamp } from './renderer/GeometryBuilder'
import { svgCanvas } from './renderer/svgCanvas'
import { version } from './version'
import { axisScaleOf } from './viewport'
import { encodingStops } from './walkEncoding'
import { facetLifts, walkLift } from './walkHighlight'
import { rangeText, walkKey } from './walkKey'

import type { ColorScheme } from './colorSchemes'
import type { FacetBy } from './facetGrid'
import type { GeneModel, GenePin } from './genes/genePins'
import type { NodeWidth } from './nodeWidths'
import type { Graph, LayoutResult } from './types'
import type { WalkLayer } from './walkEncoding'
import type { LiftedWalk, WalkLift } from './walkHighlight'

// A graph drawn to a standalone SVG, the way the plugin and BandageJS draw it
// on screen: the same geometry through the same renderer, the genes on its
// backbone, the lifted walks' keys and, faceted, a panel per walk or a row per
// sample. It reads no DOM, so a script can make the figure from a spec and make
// it again; the SVG names the version that drew it and the spec it drew.

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
  // genes on the backbone's refNames (featuresOnBackbone), outlined on the
  // nodes that carry their exons and named under them
  genes?: GeneModel[]
  // how the figure was made, kept in the SVG beside the version that drew it
  spec?: unknown
}

const FONT = 'font-family="Helvetica, Arial, sans-serif" font-size="11"'
const BAR_PX = 48
const SWATCH_PX = 18
const KEY_GAP_PX = 16
const FADED = 'rgb(160,160,160)'
// the gene track's CDS colour, round each exon, as the viewer draws it
const EXON_COLOR = '#daa520'
const GENE_INK = '#1c1c22'
// a lifted walk's lane at the least, as the geometry draws it
const MIN_LANE_PX = 4
const EXON_GAP_PX = 1
const EXON_LINE_PX = 2

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

// `d`, a path of absolute M and L commands in layout units, in screen px
function screenPath(
  d: string,
  t: { scaleX: number; scaleY: number; translateX: number; translateY: number },
) {
  return d.replaceAll(
    /([ML])(-?[\d.e-]+),(-?[\d.e-]+)/g,
    (_, cmd: string, x: string, y: string) =>
      `${cmd}${+(Number(x) * t.scaleX + t.translateX).toFixed(1)},${+(Number(y) * t.scaleY + t.translateY).toFixed(1)}`,
  )
}

function chip(x: number, y: number, w: number, name: string, note: string) {
  return `<rect x="${x - w / 2}" y="${y - LABEL_PX - LABEL_PAD + 2}" width="${w}" height="${LABEL_PX + LABEL_PAD * 2 - 2}" rx="3" fill="#fff" fill-opacity="0.85" stroke="${EXON_COLOR}"/><text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${LABEL_PX}" fill="${GENE_INK}" text-anchor="middle"><tspan font-style="italic" font-weight="600">${esc(name)}</tspan>${note ? esc(note) : ''}</text>`
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
  const contigThickness = o.contigThickness ?? 6
  const nodeWidth = o.nodeWidth ?? 'depth'
  const pins: GenePin[] =
    o.genes?.length && !layout.tubeMap
      ? genePins(graph, o.genes, layout.nodePositions)
      : []
  const ink = nodeInk(graph, nodeById, contigThickness, nodeWidth)
  let masks = 0

  // Exons outlined round their stretch of each node, clear of its ink, and
  // the genes named under their pins; a row layout names its rows
  function overlays(
    highlight: WalkLift | undefined,
    t: {
      scaleX: number
      scaleY: number
      translateX: number
      translateY: number
    },
    w: number,
    h: number,
  ) {
    const out: string[] = []
    const inkPx = (nodeId: string) => {
      const own = ink.halfWidthPx(nodeId) * 2
      return highlight?.nodeIds.has(nodeId)
        ? Math.max(own, highlight.walks.length * MIN_LANE_PX)
        : own
    }
    const stretches = pins.flatMap(pin =>
      pin.exonsByNode.map(({ nodeId, d }) => ({
        d: screenPath(d, t),
        inner: inkPx(nodeId) + 2 * EXON_GAP_PX,
      })),
    )
    if (stretches.length > 0) {
      const id = `exons${masks++}`
      const stroke = (color: string, width: number, d: string) =>
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
      out.push(
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">${stretches
          .map(s => stroke('#fff', s.inner + 2 * EXON_LINE_PX, s.d))
          .join('')}${stretches
          .map(s => stroke('#000', s.inner, s.d))
          .join(
            '',
          )}</mask><rect width="${w}" height="${h}" fill="${EXON_COLOR}" mask="url(#${id})"/>`,
      )
    }
    const screen = (p: { x: number; y: number }) => ({
      x: p.x * t.scaleX + t.translateX,
      y: p.y * t.scaleY + t.translateY,
    })
    const frame = { width: w, height: h }
    for (const { item: pin, x, y, w: cw, text } of placeLabels(
      geneLabelCandidates(pins, screen, contigThickness),
      frame,
      occupancy(frame),
    )) {
      const pinY = screen(pin.at).y + contigThickness / 2
      out.push(
        `<line x1="${x}" x2="${x}" y1="${y - LABEL_PX - 2}" y2="${pinY}" stroke="${GENE_INK}" stroke-width="0.8" stroke-opacity="0.6"/>`,
        chip(x, y, cw, pin.gene.name, text.slice(pin.gene.name.length)),
      )
    }
    for (const { label, y } of layout.rowLabels ?? []) {
      const sy = y * t.scaleY + t.translateY
      if (sy >= 0 && sy <= h) {
        out.push(
          `<text x="6" y="${sy + 4}" ${FONT} stroke="#fff" stroke-width="3" paint-order="stroke">${esc(label)}</text>`,
        )
      }
    }
    return out.join('')
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
        contigThickness,
        connectorThickness: o.connectorThickness ?? 2,
        drawPaths: false,
        nodeWidth,
        highlight,
        axis,
        referenceRamp,
        deletions: new Map(deletions.map(d => [d.edgeIndex, d.bypassed])),
        hiddenEdges: new Set(
          o.showDeletionEdges ? [] : deletions.map(d => d.edgeIndex),
        ),
      }),
    )
    const t = {
      scaleX: axis.scaleX,
      scaleY: axis.scaleY,
      translateX: fit.translateX,
      translateY: fit.translateY,
    }
    renderer.updateTransform({ ...t, dpr: 1 })
    renderer.render([1, 1, 1, 1])
    return markup() + overlays(highlight, t, w, h)
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
  const metadata = JSON.stringify({
    generator: `@jbrowse/bandage-core@${version}`,
    ...(o.spec === undefined ? {} : { spec: o.spec }),
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><metadata>${esc(metadata)}</metadata><rect width="${width}" height="${height}" fill="#fff"/>${parts.join('')}</svg>\n`
}
