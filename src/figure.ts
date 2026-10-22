import { escapeAttr, serializeEl } from './el'
import {
  FACET_GAP_PX,
  FACET_PAD_PX,
  FACET_TITLE_PX,
  facetGrid,
} from './facetGrid'
import { figureScene } from './figureScene'
import { FIGURE_DEFAULTS } from './figureSettings'
import { EXON_COLOR, exonOutlineTree, exonStretches } from './genes/exonOutline'
import { genePins } from './genes/genePins'
import { geneLabelCandidates } from './labelLayout'
import {
  walkRowsKey,
  walkRowsKeyTree,
  walkRowsTree,
} from './layout/walkRowDraw'
import { walkRowLabels } from './layout/walkRowLayout'
import {
  stripGeneGaps,
  walkStripFrame,
  walkStripLabelsTree,
} from './layout/walkStrip'
import { nodeInk } from './nodeWidths'
import {
  LABEL_CHAR_PX,
  LABEL_PAD,
  LABEL_PX,
  occupancy,
  placeLabels,
} from './overlayLabels'
import { FIT_PADDING, fitTransform } from './pipeline'
import { Canvas2DRenderer } from './renderer/Canvas2DRenderer'
import { svgCanvas } from './renderer/svgCanvas'
import { THREAD_PX, passesKey, threadsPasses } from './renderer/walkLanes'
import { nodesUnderBox } from './util/hitDetection'
import { version } from './version'
import { axisScaleOf } from './viewport'
import { encodingStops } from './walkEncoding'
import { rangeText } from './walkKey'

import type { ColorScheme } from './colorSchemes'
import type { EdgeWidth } from './edgeWidths'
import type { FacetInput } from './facetGrid'
import type { GeneModel, GenePin } from './genes/genePins'
import type {
  GeneGaps,
  RowGene,
  RowPitch,
  WalkRowsWithCalls,
} from './layout/walkRowDraw'
import type { WalkRows } from './layout/walkRows'
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
  // the field the panels split on, bare, or the whole setting with an order
  // and a column count
  facet?: FacetInput
  colorScheme?: ColorScheme
  nodeWidth?: NodeWidth
  edgeWidth?: EdgeWidth
  // true when absent, as for the layout
  showDeletionEdges?: boolean
  // the layout was laid out for a linear view, which draws strand arrows from
  // a lower zoom (EngineSettings)
  linearLayout?: boolean
  contigThickness?: number
  connectorThickness?: number
  // the window the graph was cut for, which the anchored layouts and the
  // reference-position ramp span
  region?: { refName: string; start: number; end: number }
  // what the ramp and the walk keys call the reference, `hg38 chr6`, in place
  // of referenceLabel's
  referenceName?: string
  // the interval the ramp spans where it is not `region`, as a view's
  // `colorDomain` states it
  colorDomain?: { start: number; end: number }
  // fit what was drawn rather than the window, as a popped bubble does
  fitToDrawing?: boolean
  // genes on the backbone's refNames (featuresOnBackbone), outlined on the
  // nodes that carry their exons and named under them
  genes?: GeneModel[]
  // how the figure was made, kept in the SVG beside the version that drew it
  spec?: unknown
  // the walk rows a host draws, after its repeat pick and sample filter, for a
  // walk-rows layout; the figure draws their bars, readouts and key in place
  // of nodes
  walkRows?: WalkRowsWithCalls
  // the pitch the walk rows draw at, the layout's own unless a view packed
  // them denser to fit
  walkRowPitch?: RowPitch
  // each row's genes as offsets along its bar, and the rows read none
  rowGenes?: Map<string, RowGene[]>
  rowGeneGaps?: GeneGaps
  // walk rows in a strip under a layout that draws nodes, with their genes
  walkStrip?: {
    rows: WalkRows
    rowGenes?: Map<string, RowGene[]>
    rowGeneGaps?: GeneGaps
  }
}

const FONT = 'font-family="Helvetica, Arial, sans-serif" font-size="11"'
const BAR_PX = 48
const SWATCH_PX = 18
const KEY_GAP_PX = 16
const KEY_LINE_PX = 16
const KEY_TALL_PX = 32
const STRIP_KEY_PX = 22
const FADED = 'rgb(160,160,160)'
const GENE_INK = '#1c1c22'

// A key at (x, y): a swatch or a short bar of its scale, bold `label` and
// `after` beside it, and `under` on the line below. Returns its markup and
// about how wide and tall it is.
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
    height: under ? KEY_TALL_PX : KEY_LINE_PX,
    markup: `${defs}<g transform="translate(${x} ${y})" ${FONT}><rect y="5" width="${bar}" height="8" rx="2" ${fill}/><text x="${bar + 5}" y="13"><tspan font-weight="bold">${escapeAttr(label)}</tspan>${escapeAttr(after)}</text>${
      under ? `<text y="28">${escapeAttr(under)}</text>` : ''
    }</g>`,
  }
}

// the exon outline's key, as the viewer's gene legend draws it
function exonKeySvg(x: number, y: number) {
  return {
    width: SWATCH_PX + 5 + 4 * LABEL_CHAR_PX,
    height: KEY_LINE_PX,
    markup: `<g transform="translate(${x} ${y})" ${FONT}><rect x="1" y="4" width="${SWATCH_PX - 2}" height="10" rx="4" fill="none" stroke="${EXON_COLOR}" stroke-width="2"/><text x="${SWATCH_PX + 5}" y="13">exon</text></g>`,
  }
}

function passesKeySvg(x: number, y: number, note: string) {
  const lines = [6, 9, 12]
    .map(
      ly =>
        `<line y1="${ly}" y2="${ly}" x2="${SWATCH_PX}" stroke="#444" stroke-width="${THREAD_PX}"/>`,
    )
    .join('')
  return {
    width: SWATCH_PX + 5 + note.length * LABEL_CHAR_PX,
    height: KEY_LINE_PX,
    markup: `<g transform="translate(${x} ${y})" ${FONT}>${lines}<text x="${SWATCH_PX + 5}" y="13">${note}</text></g>`,
  }
}

type KeyAt = (
  x: number,
  y: number,
) => { width: number; height: number; markup: string }

// Keys one after another along a line, a new line where the next would run
// past the figure's right edge
function keyLines(keys: readonly KeyAt[], width: number) {
  const markup: string[] = []
  let x = 6
  let y = 2
  let line = 0
  for (const key of keys) {
    const size = key(0, 0)
    if (x > 6 && x + size.width > width - 6) {
      x = 6
      y += line + 4
      line = 0
    }
    markup.push(key(x, y).markup)
    x += size.width + KEY_GAP_PX
    line = Math.max(line, size.height)
  }
  return { markup, height: y + line }
}

function walkKeySvg(
  id: string,
  x: number,
  y: number,
  walk: LiftedWalk,
  label: string,
  key: { note: string; scale?: string },
) {
  return keySvg(
    id,
    x,
    y,
    encodingStops(walk.encoding),
    label,
    key.note,
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
  return `<rect x="${x - w / 2}" y="${y - LABEL_PX - LABEL_PAD + 2}" width="${w}" height="${LABEL_PX + LABEL_PAD * 2 - 2}" rx="3" fill="#fff" fill-opacity="0.85" stroke="${EXON_COLOR}"/><text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${LABEL_PX}" fill="${GENE_INK}" text-anchor="middle"><tspan font-style="italic" font-weight="600">${escapeAttr(name)}</tspan>${note ? escapeAttr(note) : ''}</text>`
}

export function figureSvg(
  graph: Graph,
  layout: LayoutResult,
  o: FigureOptions = {},
) {
  const width = o.width ?? FIGURE_DEFAULTS.width
  const room = o.height ?? FIGURE_DEFAULTS.height
  const rows = o.walkRows
  const {
    bounds,
    nodeById,
    referenceRamp,
    layers,
    lift,
    facet,
    facets,
    labelOf,
    referenceName,
    keyText,
    contigThickness,
    nodeWidth,
    geometry,
  } = figureScene(graph, layout, o)
  const pixelRows = layout.pixelRows ?? false
  const rampInterval = referenceRamp && {
    start: referenceRamp.start,
    end: referenceRamp.start + referenceRamp.span,
  }
  const pins: GenePin[] =
    o.genes?.length && !layout.tubeMap && !rows
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
    const outlines = exonOutlineTree(
      exonStretches(pins, ink.halfWidthPx, highlight, d => screenPath(d, t)),
      { id: `exons${masks++}`, width: w, height: h },
    )
    if (outlines) {
      out.push(serializeEl(outlines))
    }
    const screen = (p: { x: number; y: number }) => ({
      x: p.x * t.scaleX + t.translateX,
      y: p.y * t.scaleY + t.translateY,
    })
    const frame = { width: w, height: h }
    for (const { item: pin, x, y, w: cw, text } of placeLabels(
      geneLabelCandidates(
        pins,
        screen,
        contigThickness,
        nodesUnderBox(layout.nodePositions, t),
      ),
      frame,
      occupancy(frame),
    )) {
      const pinY = screen(pin.at).y + contigThickness / 2
      out.push(
        `<line x1="${x}" x2="${x}" y1="${y - LABEL_PX - 2}" y2="${pinY}" stroke="${GENE_INK}" stroke-width="0.8" stroke-opacity="0.6"/>`,
        chip(x, y, cw, pin.gene.name, text.slice(pin.gene.name.length)),
      )
    }
    if (rows) {
      out.push(
        serializeEl(
          walkRowsTree(
            rows,
            { ...t, width: w, height: h, ...o.walkRowPitch },
            {
              ramp: rampInterval,
              rowGenes: o.rowGenes,
            },
          ),
        ),
      )
    }
    const rowLabels = walkRowLabels(rows, layout, o.walkRowPitch)
    for (const { label, y } of rowLabels) {
      const sy = y * t.scaleY + t.translateY
      if (sy >= 0 && sy <= h) {
        out.push(
          `<text x="6" y="${sy + 4}" ${FONT} stroke="#fff" stroke-width="3" paint-order="stroke">${escapeAttr(label)}</text>`,
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
      facets
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
    renderer.uploadGeometry(geometry(highlight, axis))
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
  if (facets) {
    const { panels, place } = facets
    const grid = facetGrid({
      count: place.count,
      bounds,
      pixelRows,
      width,
      room,
      columns: place.columns ?? facet.columns,
    })
    panels.forEach((panel, i) => {
      const cell = place.cells[i]!
      const x = (cell % grid.columns) * (grid.width + FACET_GAP_PX)
      const y =
        Math.floor(cell / grid.columns) *
        (grid.height + FACET_TITLE_PX + FACET_GAP_PX)
      const walk = panel.walks[0]!
      parts.push(
        walkKeySvg(
          `key${i}`,
          x + 6,
          y + 2,
          walk,
          labelOf(walk.name),
          keyText(walk),
        ).markup,
        `<svg x="${x}" y="${y + FACET_TITLE_PX}" width="${grid.width}" height="${grid.height}">${drawing(panel, grid.width, grid.height)}</svg>`,
      )
    })
    height = grid.total
  } else {
    const keys: KeyAt[] = []
    if (lift) {
      lift.walks.forEach((walk, i) => {
        keys.push((x, y) =>
          walkKeySvg(`key${i}`, x, y, walk, labelOf(walk.name), keyText(walk)),
        )
      })
      keys.push((x, y) =>
        keySvg(
          'faded',
          x,
          y,
          [{ offset: 0, color: FADED }],
          '',
          `not on ${lift.walks.length === 1 ? labelOf(lift.walks[0]!.name) : 'these walks'}`,
          undefined,
          0.3,
        ),
      )
      if (threadsPasses(lift.walks)) {
        keys.push((x, y) => passesKeySvg(x, y, passesKey(lift.walks)))
      }
    }
    if (rows) {
      const entries = walkRowsKey(rows, {
        ramp: rampInterval,
        genes: o.rowGenes?.size ? o.rowGeneGaps : undefined,
      })
      entries.forEach((entry, i) => {
        keys.push((x, y) => {
          const key = walkRowsKeyTree([entry], x, y, `rows-key-${i}`)
          return {
            width: key.width - KEY_GAP_PX,
            height: KEY_LINE_PX,
            markup: serializeEl(key.tree),
          }
        })
      })
    } else if (!lift && referenceRamp) {
      keys.push((x, y) =>
        keySvg(
          'ramp',
          x,
          y,
          encodingStops({ field: 'reference', scheme: 'rainbow' }),
          referenceName ? `${referenceName} position` : 'Reference position',
          '',
          rangeText(
            referenceName,
            referenceRamp.start,
            referenceRamp.start + referenceRamp.span,
          ),
        ),
      )
    }
    if (pins.some(pin => pin.exonsByNode.length > 0)) {
      keys.push((x, y) => exonKeySvg(x, y))
    }
    const keyed = keyLines(keys, width)
    parts.push(...keyed.markup)
    const header = keys.length > 0 ? Math.max(FACET_TITLE_PX, keyed.height) : 0
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
  const strip = o.walkStrip
  if (strip && !rows && !layout.tubeMap) {
    const frame = walkStripFrame(strip.rows, { width })
    const key = walkRowsKeyTree(
      walkRowsKey(strip.rows, {
        ramp: rampInterval,
        genes: stripGeneGaps(frame, strip.rowGenes, strip.rowGeneGaps),
      }),
      6,
      height + frame.height,
      'strip-key',
    )
    parts.push(
      `<line x1="0" x2="${width}" y1="${height + 0.5}" y2="${height + 0.5}" stroke="#ddd"/>`,
      `<svg y="${height}" width="${width}" height="${frame.height}">${serializeEl(
        walkRowsTree(strip.rows, frame, {
          ramp: rampInterval,
          rowGenes: strip.rowGenes,
          idPrefix: 'strip',
        }),
      )}${serializeEl(
        walkStripLabelsTree(
          strip.rows,
          frame,
          new Set(layers.map(l => l.walk)),
        ),
      )}</svg>`,
      serializeEl(key.tree),
    )
    height += frame.height + STRIP_KEY_PX
  }
  const metadata = JSON.stringify({
    generator: `@jbrowse/bandage-core@${version}`,
    ...(o.spec === undefined ? {} : { spec: o.spec }),
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><metadata>${escapeAttr(metadata)}</metadata><rect width="${width}" height="${height}" fill="#fff"/>${parts.join('')}</svg>\n`
}
