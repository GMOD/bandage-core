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
import { drawnSkips, graphKey, walkKeyEntry } from './graphKey'
import { labelledNodeLengths, sizeLeader } from './graphLabels'
import { geneLeader, layoutLabels } from './labelLayout'
import { FIT_PADDING } from './layout/fitAssumptions'
import { liftedRowInks } from './layout/rowInks'
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
import { LABEL_CHAR_PX, LABEL_PAD, LABEL_PX } from './overlayLabels'
import { fitTransform } from './pipeline'
import { Canvas2DRenderer } from './renderer/Canvas2DRenderer'
import { EDGE_DELETION_COLOR } from './renderer/GeometryBuilder'
import { abgrAlpha, abgrHex } from './renderer/colorBits'
import { svgCanvas } from './renderer/svgCanvas'
import { THREAD_PX } from './renderer/walkLanes'
import { version } from './version'
import { axisScaleOf } from './viewport'

import type { ColorScheme } from './colorSchemes'
import type { EdgeWidth } from './edgeWidths'
import type { FacetInput } from './facetGrid'
import type { GeneModel, GenePin } from './genes/genePins'
import type { GraphKeyEntry, GraphKeySection, GraphKeySwatch } from './graphKey'
import type {
  GeneGaps,
  RowGene,
  RowPitch,
  WalkRowsWithCalls,
} from './layout/walkRowDraw'
import type { WalkRows } from './layout/walkRows'
import type { NodeWidth } from './nodeWidths'
import type { Graph, LayoutResult } from './types'
import type { AxisScale } from './util/geometry'
import type { WalkLayer } from './walkEncoding'
import type { WalkLift } from './walkHighlight'

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
  // every node's length written on it, not only a placeholder's
  nodeLengths?: boolean
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
  // what the rows' boxes are, singular, for the key: 'gene' unless named
  rowAnnotation?: string
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
const ROW_NAME_X = 6
const GENE_INK = '#1c1c22'
const SIZE_PX = 10
const SIZE_INK = '#18181c'

const inkAttrs = (attr: 'fill' | 'stroke', ink: number) => {
  const alpha = abgrAlpha(ink)
  return `${attr}="${abgrHex(ink)}"${alpha < 255 ? ` ${attr}-opacity="${+(alpha / 255).toFixed(3)}"` : ''}`
}

const swatchPx = (swatch: GraphKeySwatch | undefined) =>
  !swatch
    ? 0
    : swatch.kind === 'scale' || swatch.kind === 'width'
      ? BAR_PX
      : SWATCH_PX

// One key's swatch, drawn about the line 9 px down
function swatchSvg(swatch: GraphKeySwatch, id: string) {
  switch (swatch.kind) {
    case 'scale':
      return `<linearGradient id="${id}">${swatch.stops
        .map(
          s =>
            `<stop offset="${+s.offset.toFixed(4)}" stop-color="${abgrHex(s.ink)}"/>`,
        )
        .join(
          '',
        )}</linearGradient><rect y="5" width="${BAR_PX}" height="8" rx="2" fill="url(#${id})"/>`
    case 'swatch':
      return `<rect y="5" width="${SWATCH_PX}" height="8" rx="2" ${inkAttrs('fill', swatch.ink)}/>`
    case 'chip':
      return `<rect x="4" y="4" width="10" height="10" rx="2" ${inkAttrs('fill', swatch.ink)}/>`
    case 'width':
      return `<rect y="${9 - swatch.px / 2}" width="${BAR_PX}" height="${swatch.px}" ${inkAttrs('fill', swatch.ink)}/>`
    case 'hollow':
      return `<rect x="1" y="5" width="${SWATCH_PX - 2}" height="8" rx="4" ${inkAttrs('fill', swatch.ink)} ${inkAttrs('stroke', swatch.rim)} stroke-width="${swatch.rimPx}"/>`
    case 'line':
      return swatch.dashed
        ? `<line y1="9" y2="9" x2="${SWATCH_PX}" ${inkAttrs('stroke', swatch.ink)} stroke-width="2" stroke-dasharray="4 3"/>`
        : `<line y1="9" y2="9" x1="5" x2="${SWATCH_PX - 5}" ${inkAttrs('stroke', swatch.ink)} stroke-width="1.5"/>`
    case 'outline':
      return `<rect x="1" y="4" width="${SWATCH_PX - 2}" height="10" rx="4" fill="none" ${inkAttrs('stroke', swatch.ink)} stroke-width="2"/>`
    case 'halo':
      return `<line y1="9" y2="9" x1="5" x2="13" ${inkAttrs('stroke', swatch.ink)} stroke-opacity="0.35" stroke-width="8" stroke-linecap="round"/>`
    case 'threads':
      return [6, 9, 12]
        .map(
          ly =>
            `<line y1="${ly}" y2="${ly}" x2="${SWATCH_PX}" ${inkAttrs('stroke', swatch.ink)} stroke-width="${THREAD_PX}"/>`,
        )
        .join('')
    case 'overhang':
      return `<path d="M0,9 L8,4 L8,14 Z M18,9 L10,4 L10,14 Z" fill="${abgrHex(EDGE_DELETION_COLOR)}"/>`
  }
}

// A key entry at (x, y): its swatch, its bold name and words beside it, and
// the stretch its scale runs over on the line below. Returns its markup and
// about how wide and tall it is.
function entrySvg(entry: GraphKeyEntry, id: string): KeyAt {
  const bar = swatchPx(entry.swatch)
  const at = bar > 0 ? bar + 5 : 0
  const strong = entry.strong ?? ''
  const width = Math.max(
    at + (strong.length + entry.text.length) * LABEL_CHAR_PX,
    (entry.under?.length ?? 0) * LABEL_CHAR_PX,
  )
  return (x, y) => ({
    width,
    height: entry.under ? KEY_TALL_PX : KEY_LINE_PX,
    markup: `<g transform="translate(${x} ${y})" ${FONT}>${entry.swatch ? swatchSvg(entry.swatch, id) : ''}<text${at > 0 ? ` x="${at}"` : ''} y="13">${strong ? `<tspan font-weight="bold">${escapeAttr(strong)}</tspan>` : ''}${escapeAttr(entry.text)}</text>${
      entry.under ? `<text y="28">${escapeAttr(entry.under)}</text>` : ''
    }</g>`,
  })
}

// A section's heading, where its entries are counts that read only under it
function headingSvg(text: string): KeyAt {
  return (x, y) => ({
    width: text.length * LABEL_CHAR_PX,
    height: KEY_LINE_PX,
    markup: `<g transform="translate(${x} ${y})" ${FONT}><text y="13" font-weight="bold">${escapeAttr(text)}</text></g>`,
  })
}

const HEADED = new Set(['Node thickness', 'Link thickness'])

function graphKeySvg(sections: GraphKeySection[], idPrefix: string) {
  return sections.flatMap(({ group, entries }) => [
    ...(group && HEADED.has(group) ? [headingSvg(group)] : []),
    ...entries.map((entry, i) =>
      entrySvg(entry, `${idPrefix}-${entry.key}-${i}`),
    ),
  ])
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

// a node's length on a pale backing, as the plugin's exported SVG writes it
function sizeChip(x: number, y: number, text: string) {
  const w = text.length * SIZE_PX * 0.56 + 6
  return `<rect x="${x - w / 2}" y="${y - SIZE_PX * 0.65}" width="${w}" height="${SIZE_PX * 1.3}" rx="3" fill="#fff" fill-opacity="0.8"/><text x="${x}" y="${y + SIZE_PX * 0.35}" font-family="Helvetica, Arial, sans-serif" font-size="${SIZE_PX}" fill="${SIZE_INK}" text-anchor="middle">${escapeAttr(text)}</text>`
}

// The key's height sets the room the drawing has, whose fit decides which
// skips hold their dashes, which the key lists: settled once the key no longer
// changes height
function settled<T>(laid: (header: number) => { drawn: T; header: number }) {
  let header = 0
  let out = laid(header)
  for (let i = 0; i < 3 && out.header !== header; i++) {
    header = out.header
    out = laid(header)
  }
  return out
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
    walkReference,
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
  const rowLabels = walkRowLabels(rows, layout, o.walkRowPitch)
  const nodeLengths = labelledNodeLengths(
    graph.nodes,
    o.nodeLengths ?? FIGURE_DEFAULTS.nodeLengths,
  )
  const nameGutter = rowLabels.reduce(
    (most, { label }) =>
      Math.max(most, 2 * ROW_NAME_X + label.length * LABEL_CHAR_PX),
    FIT_PADDING,
  )
  let masks = 0

  // Exons outlined round their stretch of each node, clear of its ink, the
  // genes named under their pins and the nodes' lengths, placed as the canvas
  // hosts place them; a row layout names its rows
  function overlays(
    highlight: WalkLift | undefined,
    axis: AxisScale,
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
    const labels = layoutLabels({
      paneWidth: w,
      canvasHeight: h,
      axisScale: axis,
      translateX: t.translateX,
      translateY: t.translateY,
      contigThickness,
      legendSize: { width: 0, height: 0 },
      drawnRowLabels: rowLabels,
      bubbleHalos: [],
      genePins: pins,
      nodePositions: layout.nodePositions,
      labelsNodeSizes: !layout.tubeMap && !highlight,
      nodeLengths,
      nodeById,
      alleleDeletions: layout.alleleDeletions ?? [],
      positionsVersion: 0,
    })
    for (const { item: pin, x, y, w: cw, text } of labels.genes) {
      const { x1, y1, x2, y2 } = geneLeader(
        { x, y },
        screen(pin.at),
        contigThickness,
      )
      out.push(
        `<line x1="${x1}" x2="${x2}" y1="${y1}" y2="${y2}" stroke="${GENE_INK}" stroke-width="0.8" stroke-opacity="0.6"/>`,
        chip(x, y, cw, pin.gene.name, text.slice(pin.gene.name.length)),
      )
    }
    for (const label of labels.sizes) {
      const leader = sizeLeader(label)
      if (leader) {
        out.push(
          `<line x1="${leader.x1}" x2="${leader.x2}" y1="${leader.y1}" y2="${leader.y2}" stroke="${SIZE_INK}" stroke-width="0.8" stroke-opacity="0.6"/>`,
        )
      }
      out.push(sizeChip(label.x, label.y, label.text))
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
    for (const { label, y } of rowLabels) {
      const sy = y * t.scaleY + t.translateY
      if (sy >= 0 && sy <= h) {
        out.push(
          `<rect x="${ROW_NAME_X - 2}" y="${sy - 7}" width="${label.length * LABEL_CHAR_PX + 4}" height="14" fill="#fff" fill-opacity="0.85"/>`,
          `<text x="${ROW_NAME_X}" y="${sy + 4}" ${FONT} stroke="#fff" stroke-width="3" paint-order="stroke">${escapeAttr(label)}</text>`,
        )
      }
    }
    return out.join('')
  }

  // The drawing at a w by h pane: the batch for `highlight` at its fit
  function view(highlight: WalkLift | undefined, w: number, h: number) {
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
        : { padLeft: nameGutter },
    )
    if (fit) {
      const axis = axisScaleOf(fit.scale, pixelRows)
      return {
        highlight,
        axis,
        batch: geometry(highlight, axis),
        t: {
          scaleX: axis.scaleX,
          scaleY: axis.scaleY,
          translateX: fit.translateX,
          translateY: fit.translateY,
        },
      }
    }
    return undefined
  }

  function drawing(v: ReturnType<typeof view>, w: number, h: number) {
    if (!v) {
      return ''
    }
    const { canvas, markup } = svgCanvas(w, h)
    const renderer = new Canvas2DRenderer(canvas)
    renderer.uploadGeometry(v.batch)
    renderer.updateTransform({ ...v.t, dpr: 1 })
    renderer.render([1, 1, 1, 1])
    return markup() + overlays(v.highlight, v.axis, v.t, w, h)
  }

  // The graph's key and the walk rows' entries for the drawing `views` hold,
  // laid in lines
  const keyed = (views: ReturnType<typeof view>[]) => {
    const keys = graphKeySvg(
      graphKey(graph, layout, {
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
        drawsNodes: !rows && !layout.tubeMap,
        skips: drawnSkips(views.flatMap(v => (v ? [v.batch] : []))),
        genePins: pins,
      }),
      'key',
    )
    if (rows) {
      walkRowsKey(rows, {
        ramp: rampInterval,
        genes: o.rowGenes?.size ? o.rowGeneGaps : undefined,
        annotation: o.rowAnnotation,
      }).forEach((entry, i) => {
        keys.push((x, y) => {
          const key = walkRowsKeyTree([entry], x, y, `rows-key-${i}`)
          return {
            width: key.width - KEY_GAP_PX,
            height: KEY_LINE_PX,
            markup: serializeEl(key.tree),
          }
        })
      })
    }
    return keyLines(keys, width)
  }

  const parts: string[] = []
  let height: number
  if (facets) {
    const { panels, place } = facets
    const gridAt = (header: number) =>
      facetGrid({
        count: place.count,
        bounds,
        pixelRows,
        width,
        room: room - header,
        columns: place.columns ?? facet.columns,
      })
    const { drawn: laidOut, header } = settled(above => {
      const grid = gridAt(above)
      const views = panels.map(panel => view(panel, grid.width, grid.height))
      const key = keyed(views)
      return {
        drawn: { views, key, grid },
        header: key.markup.length > 0 ? key.height + FACET_GAP_PX : 0,
      }
    })
    const { grid, key } = laidOut
    parts.push(...key.markup)
    panels.forEach((panel, i) => {
      const cell = place.cells[i]!
      const x = (cell % grid.columns) * (grid.width + FACET_GAP_PX)
      const y =
        header +
        Math.floor(cell / grid.columns) *
          (grid.height + FACET_TITLE_PX + FACET_GAP_PX)
      const walk = panel.walks[0]!
      parts.push(
        entrySvg(
          walkKeyEntry(walk, labelOf(walk.name), walkReference),
          `key${i}`,
        )(x + 6, y + 2).markup,
        `<svg x="${x}" y="${y + FACET_TITLE_PX}" width="${grid.width}" height="${grid.height}">${drawing(laidOut.views[i], grid.width, grid.height)}</svg>`,
      )
    })
    height = header + grid.total
  } else {
    const usable = width - 2 * FIT_PADDING
    const drawn =
      pixelRows || !(bounds.w > 0) ? bounds.h : (bounds.h * usable) / bounds.w
    const hAt = (header: number) =>
      Math.max(160, Math.min(room - header, Math.ceil(drawn + 2 * FIT_PADDING)))
    const { drawn: laidOut, header } = settled(above => {
      const h = hAt(above)
      const v = view(lift, width, h)
      const key = keyed([v])
      return {
        drawn: { v, key, h },
        header:
          key.markup.length > 0 ? Math.max(FACET_TITLE_PX, key.height) : 0,
      }
    })
    const { v, key, h } = laidOut
    parts.push(
      ...key.markup,
      `<svg y="${header}" width="${width}" height="${h}">${drawing(v, width, h)}</svg>`,
    )
    height = header + h
  }
  const strip = o.walkStrip
  if (strip && !rows && !layout.tubeMap) {
    const frame = walkStripFrame(strip.rows, { width })
    const inks = liftedRowInks(
      facets
        ? facets.panels.map(panel => panel.walks[0]!)
        : (lift?.walks ?? []),
    )
    const key = walkRowsKeyTree(
      walkRowsKey(strip.rows, {
        inks,
        ramp: rampInterval,
        genes: stripGeneGaps(frame, strip.rowGenes, strip.rowGeneGaps),
        annotation: o.rowAnnotation,
        markUnloaded: true,
      }),
      6,
      height + frame.height,
      'strip-key',
    )
    parts.push(
      `<line x1="0" x2="${width}" y1="${height + 0.5}" y2="${height + 0.5}" stroke="#ddd"/>`,
      `<svg y="${height}" width="${width}" height="${frame.height}">${serializeEl(
        walkRowsTree(strip.rows, frame, {
          inks,
          ramp: rampInterval,
          rowGenes: strip.rowGenes,
          idPrefix: 'strip',
          markUnloaded: true,
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
