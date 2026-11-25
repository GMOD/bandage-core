import { isBackbone } from './anchoredNodes'
import { figureScene } from './figureScene'
import { FIGURE_DEFAULTS, figureFit } from './figureSettings'
import { parseRegion } from './gbzCut'
import { EXON_COLOR } from './genes/exonOutline'
import { namedGenePins } from './genes/geneNames'
import { genePins } from './genes/genePins'
import { FADED_KEY_INK, RAMP_KEY_STOPS, drawnMarks, graphKey } from './graphKey'
import {
  labelledNodeLengths,
  labelledNodeShares,
  sizeLeader,
} from './graphLabels'
import { geneLeader, layoutLabels } from './labelLayout'
import { rowInkAlong, rowInkOf } from './layout/rowInks'
import {
  LAYOUT_ENGINE_VALUES,
  isLayoutEngineKind,
  layoutEngine,
} from './layoutEngines'
import { LAYOUT_MODES, layoutModeByValue } from './layoutModes'
import {
  NO_FOLD,
  SMALL_SITE_PX,
  foldedUnderBp,
  nodesNotDrawn,
} from './levelOfDetail'
import { haplotypeCount, nodeFrequency, withFrequencies } from './nodeWidths'
import { LABEL_PX } from './overlayLabels'
import { passBars } from './passBar'
import { passLabelCandidates, passLeader } from './passLabels'
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
  LIFT_BACKDROP_COLOR,
  NOT_LOADED_COLOR,
  NOT_LOADED_FILL_COLOR,
  REFERENCE_RAMP_ALT_COLOR,
} from './renderer/GeometryBuilder'
import { FADED_ALPHA, abgrAlpha, abgrHex, fadeAbgr } from './renderer/colorBits'
import { laneSlideAt, passesKey, threadsPasses } from './renderer/walkLanes'
import { version } from './version'
import { axisScaleOf } from './viewport'
import { encodingStops } from './walkEncoding'

import type { BubbleSpread } from './bubbleSpreads'
import type { FigureOptions } from './figure'
import type { GraphTables } from './gfa/graphTables'
import type { GraphKeySection } from './graphKey'
import type { RowInk } from './layout/rowInks'
import type { LayoutEngineKind } from './layoutEngines'
import type { LayoutModeValue } from './layoutModes'
import type { Fold } from './levelOfDetail'
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
  | 'countLaneScale'
  | 'countLaneWidth'
  | 'liftFade'
  | 'region'
  | 'referenceName'
  | 'colorDomain'
  | 'fitToDrawing'
  | 'genes'
  | 'nodeLengths'
  | 'nodeShares'
  | 'smallSites'
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
  faded: boolean
  width: number
  walk: number | null
  // pass is a slot across the band, not a visit; walkPass -1 for none
  pass: number | null
  walkPass: number | null
  visit: number | null
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
  faded: boolean
  width: number
  deletion: boolean
  // a skip drawn as one solid arch, as a graph with walks draws them
  arch: boolean
  // a link reading one reference node as the reference does and the other
  // against it, which the canvas paints over the nodes, as a skip
  turn: boolean
  // a plain link the nodes would hide, its ends laid apart along them, which
  // the canvas paints over them, as a skip
  along: boolean
  walk: number | null
  // at the node the link leaves
  pass: number | null
  walkPass: number | null
  visit: number | null
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
  // what the drawing names the gene, null where namedGenePins names it nowhere
  label: string | null
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
  kind: 'placeholder' | 'length' | 'gene' | 'bubble' | 'pass'
  item: string
  text: string
  size: number
  x: number
  y: number
  x1: number | null
  y1: number | null
  x2: number | null
  y2: number | null
  // a pass's colour, '' for the rest
  color: string
}

interface PassRow {
  walk: string
  pass: number
  start: number
  end: number
  repeatBp: number
  againBp: number
  reversedBp: number
  text: string
  color: string
  reversed: boolean
}

interface PassRunRow {
  walk: string
  pass: number
  start: number
  end: number
  color: string
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
  arch: boolean
  rim: string
  rimPx: number | null
}

// a site folded as too small to draw: where it attaches to the reference,
// the nodes and links it folds, and how many of the shown haplotypes step it
interface SiteRow {
  site: number
  refName: string
  start: number
  end: number
  bp: number
  x: number
  y: number
  count: number
  total: number
  nodes: string
  links: string
  // the reference nodes and links inside the site that, with walks lifted,
  // are drawn only by the lanes crossing it
  laneNodes: string
  laneLinks: string
}

interface ArrowRow {
  panel: string
  edge: number | null
  walk: number | null
  node: string | null
  against: boolean
  x: number
  y: number
  angle: number
  length: number
  halfWidth: number
  color: string
  alpha: number
  faded: boolean
  // a head the canvas strokes a white halo under, LANE_HEAD_HALO_PX each side
  halo: boolean
  // a tab past `node`'s free end, drawn without the notch: the graph runs on
  // from there past what the drawing holds
  runsOn: boolean
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

// a faded row's alpha is the one it shows with, alone, and `faded` says it is
// laid down as one layer with the rest
const alphaOf = (c: number, faded?: true, fadedAlpha = FADED_ALPHA) =>
  (abgrAlpha(c) / 255) * (faded ? fadedAlpha : 1)

// a name's baseline lies about this many of its px under its middle; a
// length's label is placed by its middle already, in 10 px text
const BASELINE_TO_MIDDLE = 0.35
const SIZE_LABEL_PX = 10

function siteTable(
  fold: Fold,
  laneOnly: RenderBatch['laneOnly'],
  edgeEnds: (edge: number) => { from: string; to: string } | undefined,
) {
  const index = new Map(fold.sites.map((s, site) => [s, site]))
  const siteOfNode = (id: string) => {
    const s = fold.within.get(id) ?? fold.siteOf.get(id)
    return s ? index.get(s) : undefined
  }
  const laneNodes = fold.sites.map((): string[] => [])
  const laneLinks = fold.sites.map((): number[] => [])
  for (const id of laneOnly?.nodes ?? []) {
    const site = siteOfNode(id)
    if (site !== undefined) {
      laneNodes[site]!.push(id)
    }
  }
  for (const edge of laneOnly?.edges ?? []) {
    const { from = '', to = '' } = edgeEnds(edge) ?? {}
    const site = siteOfNode(from) ?? siteOfNode(to)
    if (site !== undefined) {
      laneLinks[site]!.push(edge)
    }
  }
  const sites = columns<SiteRow>({
    site: [],
    refName: [],
    start: [],
    end: [],
    bp: [],
    x: [],
    y: [],
    count: [],
    total: [],
    nodes: [],
    links: [],
    laneNodes: [],
    laneLinks: [],
  })
  fold.sites.forEach((s, site) => {
    sites.push({
      site,
      refName: s.refName,
      start: s.start,
      end: s.end,
      bp: s.bp,
      x: s.x,
      y: s.y,
      count: s.count,
      total: s.total,
      nodes: s.nodes.join(','),
      links: s.edges.join(','),
      laneNodes: laneNodes[site]!.join(','),
      laneLinks: laneLinks[site]!.join(','),
    })
  })
  return sites.out
}

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
    arch: [],
    rim: [],
    rimPx: [],
  })
  for (const { id, group, entries } of sections) {
    for (const entry of entries) {
      const swatch = entry.swatch
      const ink =
        swatch &&
        swatch.kind !== 'scale' &&
        swatch.kind !== 'overhang' &&
        swatch.kind !== 'overrun'
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
        arch: swatch?.kind === 'line' && swatch.arch === true,
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

  const pins = columns<PinRow>({
    gene: [],
    label: [],
    x: [],
    y: [],
    covered: [],
    bp: [],
  })
  const exons = columns<ExonRow>({
    gene: [],
    node: [],
    stretch: [],
    x: [],
    y: [],
  })
  let stretch = 0
  const exonRows: ExonRow[] = []
  const pinned = o.genes?.length
    ? genePins(graph, o.genes, layout.nodePositions, layout.stranded)
    : []
  const names = new Map(
    namedGenePins(
      pinned,
      lift?.walks.map(w => w.name),
    ).map(({ pin, name }) => [pin, name]),
  )
  for (const pin of pinned) {
    const gene = pin.gene.name
    pins.push({
      gene,
      label: names.get(pin) ?? null,
      x: pin.at.x,
      y: pin.at.y,
      covered: pin.covered,
      bp: pin.gene.end - pin.gene.start,
    })
    for (const { nodeId, stretches } of pin.exonsByNode) {
      for (const points of stretches) {
        stretch++
        for (const { x, y } of points) {
          exonRows.push({ gene, node: nodeId, stretch, x, y })
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
    faded: [],
    width: [],
    walk: [],
    pass: [],
    walkPass: [],
    visit: [],
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
    faded: [],
    width: [],
    deletion: [],
    arch: [],
    turn: [],
    along: [],
    walk: [],
    pass: [],
    walkPass: [],
    visit: [],
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
    walk: [],
    node: [],
    against: [],
    x: [],
    y: [],
    angle: [],
    length: [],
    halfWidth: [],
    color: [],
    alpha: [],
    faded: [],
    halo: [],
    runsOn: [],
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
            alpha: alphaOf(s.color, s.faded, lift?.fadedAlpha),
            faded: s.faded === true,
            width: s.thickness * 2,
            walk: keyRowOf(s.walk),
            pass: s.pass ?? null,
            walkPass: s.walkPass ?? null,
            visit: s.visit ?? null,
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
            alpha: alphaOf(b.color, b.faded, lift?.fadedAlpha),
            faded: b.faded === true,
            width: b.thickness * 2,
            deletion: b.skip === true,
            arch: b.arch === true,
            turn: b.turn === true,
            along: b.along === true,
            walk: keyRowOf(b.walk),
            pass: b.pass ?? null,
            walkPass: b.walkPass ?? null,
            visit: b.visit ?? null,
            ...slideAlong(k / n),
            nx1: end.nx,
            ny1: end.ny,
            offset1: end.offset,
          })
        })
      }
    }
    const edgeOf = new Map<number, number>()
    for (const [edge, run] of batch.arrowRuns) {
      for (let i = run.start; i < run.start + run.count; i++) {
        edgeOf.set(i, edge)
      }
    }
    batch.arrows.forEach((a, i) => {
      const edge = edgeOf.get(i)
      if (edge !== undefined || a.walk !== undefined || a.runsOn) {
        arrows.push({
          panel,
          edge: edge ?? null,
          walk: keyRowOf(a.walk),
          node: a.node ?? null,
          against: !!a.against,
          x: a.x,
          y: a.y,
          angle: a.angle,
          length: a.length,
          halfWidth: a.halfWidth,
          color: abgrHex(a.color),
          alpha: alphaOf(a.color, a.faded, lift?.fadedAlpha),
          faded: a.faded === true,
          halo: a.halo === true,
          runsOn: a.runsOn === true,
        })
      }
    })
  }

  const fold =
    (o.smallSites ?? FIGURE_DEFAULTS.smallSites) === 'hidden'
      ? (batches[0]?.collapsed ?? NO_FOLD)
      : undefined
  const notDrawn = new Set<string>()
  for (const batch of batches) {
    for (const id of nodesNotDrawn(batch)) {
      notDrawn.add(id)
    }
  }
  for (const row of exonRows) {
    if (!notDrawn.has(row.node)) {
      exons.push(row)
    }
  }

  const nodeShares = labelledNodeShares(
    graph,
    o.nodeShares ?? FIGURE_DEFAULTS.nodeShares,
  )
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
    liftedWalks: lift?.walks.map(w => w.name),
    nodePositions: layout.nodePositions,
    labelsNodeSizes: !lift,
    nodeLengths: labelledNodeLengths(
      graph,
      o.nodeLengths ?? FIGURE_DEFAULTS.nodeLengths,
    ),
    nodeShares: nodeShares.texts,
    linkShares: nodeShares.links,
    nodeById,
    graph,
    drawnInk: batches[0],
    alleleDeletions: layout.alleleDeletions ?? [],
    positionsVersion: 0,
    folded: fold?.nodes,
    passLabels:
      facets || !batches[0]
        ? []
        : passLabelCandidates(
            batches[0],
            lift,
            {
              scaleX: axis.scaleX,
              scaleY: axis.scaleY,
              translateX: fit.translateX,
              translateY: fit.translateY,
            },
            { width, height },
          ),
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
    color: [],
  })
  const pushLabel = (
    kind: LabelRow['kind'],
    item: string,
    text: string,
    at: { x: number; y: number },
    leader?: { x1: number; y1: number; x2: number; y2: number },
    color = '',
  ) => {
    labels.push({
      kind,
      item,
      text,
      size:
        kind === 'length' || kind === 'placeholder' ? SIZE_LABEL_PX : LABEL_PX,
      x: toX(at.x),
      y: toY(at.y),
      x1: leader ? toX(leader.x1) : null,
      y1: leader ? toY(leader.y1) : null,
      x2: leader ? toX(leader.x2) : null,
      y2: leader ? toY(leader.y2) : null,
      color,
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
  for (const {
    item: { pin },
    x,
    y,
    text,
  } of placed.genes) {
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
  for (const { item, x, y, text } of placed.passes) {
    pushLabel(
      'pass',
      item.walk,
      text,
      { x, y: y - LABEL_PX * BASELINE_TO_MIDDLE },
      passLeader({ x, y }, item.at),
      abgrHex(item.ink),
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
    nodeSharesOf: nodeShares.of,
    contigThickness,
    edgeWidth: o.edgeWidth ?? FIGURE_DEFAULTS.edgeWidth,
    connectorThickness:
      o.connectorThickness ?? FIGURE_DEFAULTS.connectorThickness,
    marks: drawnMarks(batches),
    genePins: pinned,
    unlabelled: placed.unlabelled,
  })

  const passes = columns<PassRow>({
    walk: [],
    pass: [],
    start: [],
    end: [],
    repeatBp: [],
    againBp: [],
    reversedBp: [],
    text: [],
    color: [],
    reversed: [],
  })
  const passRuns = columns<PassRunRow>({
    walk: [],
    pass: [],
    start: [],
    end: [],
    color: [],
  })
  for (const bar of facets ? [] : passBars(lift)) {
    const walk = labelOf(bar.walk)
    for (const { ink, ...pass } of bar.passes) {
      passes.push({ walk, ...pass, color: abgrHex(ink) })
    }
    for (const { ink, ...run } of bar.runs) {
      passRuns.push({ walk, ...run, color: abgrHex(ink) })
    }
  }

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
        faded: abgrHex(
          lift?.fadedAlpha === undefined
            ? FADED_KEY_INK
            : fadeAbgr(LIFT_BACKDROP_COLOR, lift.fadedAlpha),
        ),
      },
      // the graph's key, as every reader draws it (graphKey.ts)
      graphKey: graphKeyTable(key),
      ...(fold
        ? {
            smallSites: {
              mode: 'hidden',
              px: SMALL_SITE_PX,
              bp: foldedUnderBp(fold) || null,
            },
          }
        : {}),
    },
    panels: {
      panel: panels.map(p => p.name),
      key: panels.map(p => p.key),
      range: panels.map(p => p.range),
    },
    keys: keys.out,
    threadKeys: threadKeys.out,
    passes: passes.out,
    passRuns: passRuns.out,
    pins: pins.out,
    exons: exons.out,
    labels: labels.out,
    walkNames: [...new Set((graph.paths ?? []).map(p => p.name))],
    nodes: nodes.out,
    edges: edges.out,
    arrows: arrows.out,
    ...(fold
      ? {
          sites: siteTable(
            fold,
            batches[0]?.laneOnly,
            edge => graph.edges[edge],
          ),
        }
      : {}),
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
}

// For a host that tiles walk rows itself: the key row naming each walk row's
// walk, or null, and each tile's colour `offset` bp along its row's bar, as
// walk rows draw it (layout/rowInks.ts), null on a row no lifted walk inks.
// `passRuns` are the figure's passRuns with `key` the key row of their walk
export function walkRowInks(
  keys: KeyColumns,
  rows: WalkRowColumns,
  tiles: { row: number[]; offset: number[] },
  passRuns?: { key: number[]; start: number[]; end: number[]; color: string[] },
  breaks?: { row: number[]; at: number[]; bp: number[]; drawn: number[] },
) {
  const inks = keys.name.map((walk, k): RowInk => {
    const contig = keys.contig[k]
    const start = keys.start[k]
    const end = keys.end[k]
    const passes = (passRuns?.key ?? []).flatMap((key, i) =>
      key === k
        ? [
            {
              start: passRuns!.start[i]!,
              end: passRuns!.end[i]!,
              color: passRuns!.color[i]!,
            },
          ]
        : [],
    )
    return {
      walk,
      stops: keys.stops[k]!.split(','),
      range:
        contig != null && start != null && end != null
          ? { contig, start, end }
          : undefined,
      ...(passes.length ? { passes } : {}),
    }
  })
  const named = rows.name.map(name => rowInkOf({ name }, inks))
  const inkAt = named.map((ink, r) => {
    const contig = rows.contig[r]
    const start = rows.contigStart[r]
    return ink && keys.field[inks.indexOf(ink)] !== 'reference'
      ? rowInkAlong(ink, {
          bp: rows.bp[r]!,
          axis:
            contig != null && start != null
              ? {
                  contig,
                  start,
                  breaks: (breaks?.row ?? []).flatMap((row, b) =>
                    row === r
                      ? [
                          {
                            at: breaks!.at[b]!,
                            bp: breaks!.bp[b]!,
                            drawn: breaks!.drawn[b]!,
                          },
                        ]
                      : [],
                  ),
                }
              : undefined,
        })
      : undefined
  })
  return {
    key: named.map(ink => (ink ? inks.indexOf(ink) : null)),
    color: tiles.row.map((r, t) => inkAt[r]?.(tiles.offset[t]!) ?? null),
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

const FIGURE_LAYOUTS: string[] = LAYOUT_MODES.filter(m => m.drawsNodes).map(
  m => m.value,
)

function checkLayout(layout: string | undefined) {
  if (layout !== undefined && !FIGURE_LAYOUTS.includes(layout)) {
    throw new Error(
      `a figure draws no "${layout}" layout: one of ${FIGURE_LAYOUTS.join(', ')}`,
    )
  }
}

function checkEngine(engine: string | undefined) {
  if (engine !== undefined && !isLayoutEngineKind(engine)) {
    throw new Error(
      `no "${engine}" layout engine: one of ${LAYOUT_ENGINE_VALUES.join(', ')}`,
    )
  }
}

// A graph laid out as a spec asks: by its layout mode, or by the force engine
// where the mode leaves the layout to it. The graph is GFA text, or a region
// read from a walk file as tables.
export async function laidOutGraph(
  source: string | GraphTables,
  name: string,
  region: FigureOptions['region'],
  spec: GfaFigureSpec,
) {
  checkLayout(spec.layout)
  checkEngine(spec.engine)
  const graph = withFrequencies(
    loadGraph(source, name, { referencePath: spec.referencePath }),
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

// GFA text to tables, the whole way, for a host that holds the text and a
// spec. One that holds a loaded graph, as ggbandage does, calls laidOutGraph
// and figureData itself.
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
