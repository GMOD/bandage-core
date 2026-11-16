import { COMPRESSED_KEY } from './bubbleSpreads'
import { BUBBLE_HALO_COLOR } from './bubbles/bubbleLabel'
import { SHORT_SKIP_KEY, deletionKey } from './deletionEdges'
import { busiestEdge, edgeWidthFactor } from './edgeWidths'
import { EXON_COLOR } from './genes/exonOutline'
import { NOT_LOADED_TEXT } from './gfa/departures'
import { formatBp } from './graphLabels'
import { SMALL_SITE_PX } from './levelOfDetail'
import { depthKey, frequencyKey } from './nodeWidths'
import { referenceLabel } from './reference'
import {
  REFERENCE_RAMP_LIGHTNESS,
  REFERENCE_RAMP_SATURATION,
  rampHueAt,
} from './referenceRampCss'
import {
  EDGE_DEFAULT_COLOR,
  EDGE_DELETION_COLOR,
  FADED_ALPHA,
  LIFT_BACKDROP_COLOR,
  NOT_LOADED_COLOR,
  NOT_LOADED_FILL_COLOR,
  NOT_LOADED_RIM_PX,
  REFERENCE_RAMP_ALT_COLOR,
  packHsl,
  rampFraction,
  skipDashes,
} from './renderer/GeometryBuilder'
import { fadeAbgr, hexAbgr, packAbgr } from './renderer/colorBits'
import { LANE_HEADS_AGAINST_KEY, LANE_HEADS_KEY } from './renderer/laneHeads'
import { passesKey } from './renderer/walkLanes'
import { encodingStops } from './walkEncoding'
import { fadedKey } from './walkHighlight'
import { rangeText, walkKey } from './walkKey'

import type { EdgeWidth } from './edgeWidths'
import type { GenePin } from './genes/genePins'
import type { UnlabelledPlaceholders } from './graphLabels'
import type { NodeWidth } from './nodeWidths'
import type { ReferenceRamp } from './renderer/GeometryBuilder'
import type { RenderBatch } from './renderer/types'
import type { Graph, LayoutResult } from './types'
import type { LiftedWalk, WalkLift } from './walkHighlight'

// The graph's key as data: what each mark the drawing holds means, in the
// order every reader stacks it, each entry only where the drawing holds a
// member of its class. Colours are packed ABGR (renderer/colorBits.ts), which
// a reader turns into its own colour syntax.

export interface KeyStop {
  offset: number
  ink: number
}

export type GraphKeySwatch =
  // a short bar of a scale
  | { kind: 'scale'; stops: KeyStop[] }
  // a walk's one colour, as a short bar
  | { kind: 'swatch'; ink: number }
  // a colour alone, as a square chip
  | { kind: 'chip'; ink: number }
  // a node or link as thick as the drawing makes it, `px` across
  | { kind: 'width'; ink: number; px: number }
  // a node the cut did not load, hollow in its rim
  | { kind: 'hollow'; ink: number; rim: number; rimPx: number }
  // a link's stroke, dashed or the plain stroke of a skip too short to dash
  | { kind: 'line'; ink: number; dashed: boolean }
  | { kind: 'outline'; ink: number }
  | { kind: 'halo'; ink: number }
  // a lane's threads side by side, one per pass through a node
  | { kind: 'threads'; ink: number }
  // heads along a lane
  | { kind: 'heads'; ink: number; haloed: boolean }
  // the reference strip's tab past its edge
  | { kind: 'overhang' }

// An entry with no swatch is a note on the drawing
export interface GraphKeyEntry {
  key: string
  text: string
  // the walk's name, ahead of the text
  strong?: string
  // the line under it: the stretch a scale runs over
  under?: string
  // more than fits, for a reader with a hover
  hover?: string
  swatch?: GraphKeySwatch
  walk?: LiftedWalk
}

export type GraphKeySectionId =
  | 'ramp'
  | 'walks'
  | 'node-width'
  | 'link-width'
  | 'halo'
  | 'links'
  | 'skips'
  | 'not-shown'
  | 'exon'
  | 'overhang'
  | 'compressed'
  | 'too-small'

export interface GraphKeySection {
  id: GraphKeySectionId
  // the group a reader may head the section with: a thickness's entries are
  // counts that read only under it
  group?: 'Color' | 'Walks' | 'Node thickness' | 'Link thickness' | 'Marks'
  entries: GraphKeyEntry[]
}

// The classes of mark a drawing's batches hold, which the key names: a skip
// dashed, or one plain stroke where its span on screen is too short to hold
// the dashes; a node hollow for the bp a cut did not load; a node or link in
// no lifted walk's lane, which under a lift is faded; a node in the
// off-reference charcoal, plain or in a lane; a lane's second thread through a
// node; nodes of more than one thickness; each lifted walk's passes, by lane;
// heads along a lane, pointing back along a node or either way; the nodes and
// skips folded as too small to draw. A lifted walk's lane on a skip is its
// walk's, keyed by the walk.
export function drawnMarks(
  batches: readonly (Pick<RenderBatch, 'edgeCurves' | 'nodeStrokes'> &
    Partial<Pick<RenderBatch, 'arrows' | 'collapsed'>>)[],
) {
  const marks = {
    dashedSkip: false,
    shortSkip: false,
    placeholder: false,
    plainNode: false,
    plainLink: false,
    offReference: false,
    threads: false,
    widthsVary: false,
    passes: new Map<number, Set<number>>(),
    headsAgainst: false,
    headsAlong: false,
    headsHaloed: false,
    foldedNodes: new Set<string>(),
    foldedSkips: new Set<number>(),
    foldedUnderBp: 0,
  }
  let width: number | undefined
  for (const { edgeCurves, nodeStrokes, arrows = [], collapsed } of batches) {
    if (collapsed?.sites.length && collapsed.pxPerBp > 0) {
      marks.foldedUnderBp = Math.max(
        marks.foldedUnderBp,
        Math.ceil(SMALL_SITE_PX / collapsed.pxPerBp),
      )
    }
    for (const { nodes, edges } of collapsed?.sites ?? []) {
      for (const id of nodes) {
        marks.foldedNodes.add(id)
      }
      for (const edge of nodes.length === 0 ? edges : []) {
        marks.foldedSkips.add(edge)
      }
    }
    for (const { skip, span = 0, walk } of edgeCurves) {
      if (walk === undefined) {
        if (!skip) {
          marks.plainLink = true
        } else if (skipDashes(span)) {
          marks.dashedSkip = true
        } else {
          marks.shortSkip = true
        }
      }
    }
    for (const {
      placeholder,
      walk,
      pass = 0,
      color,
      thickness,
    } of nodeStrokes) {
      if (placeholder) {
        marks.placeholder = true
      } else {
        marks.plainNode ||= walk === undefined
        marks.widthsVary ||= width !== undefined && width !== thickness
        width = thickness
      }
      if (color === REFERENCE_RAMP_ALT_COLOR) {
        marks.offReference = true
      }
      if (pass > 0) {
        marks.threads = true
      }
    }
    for (const strokes of [edgeCurves, nodeStrokes]) {
      for (const { walk, walkPass = -1 } of strokes) {
        if (walk !== undefined && walkPass >= 0) {
          const drawn = marks.passes.get(walk) ?? new Set<number>()
          drawn.add(walkPass)
          marks.passes.set(walk, drawn)
        }
      }
    }
    for (const { walk, against, halo } of arrows) {
      if (walk !== undefined) {
        marks.headsAgainst ||= !!against
        marks.headsAlong ||= !against
        marks.headsHaloed ||= !!halo
      }
    }
  }
  return marks
}

export type DrawnMarks = ReturnType<typeof drawnMarks>

export interface GraphKeyOptions {
  // the window the graph was cut for, which names the reference
  region?: { refName: string }
  // what the key calls the reference, referenceLabel's where absent
  referenceName?: string
  // the ramp the drawing paints nodes by reference position with
  referenceRamp?: ReferenceRamp
  lift?: WalkLift
  // a lift per facet panel, whose titles key their walks
  panels?: readonly WalkLift[]
  walkLabel?: (name: string) => string
  nodeWidth?: NodeWidth
  contigThickness?: number
  edgeWidth?: EdgeWidth
  connectorThickness?: number
  // whether the layout draws nodes, as a tube map and walk rows' bars do not
  drawsNodes?: boolean
  // the marks the drawing holds: drawnMarks of its batches
  marks: DrawnMarks
  genePins?: readonly GenePin[]
  // where the genes came from, named after their outline's entry
  genesFrom?: string
  halos?: readonly { whole: boolean }[]
  // the reference strip has a tab past an edge
  stripOverhangs?: boolean
  // the placeholders the labels left without a length: layoutLabels'
  // `unlabelled`. A host that sizes its pane by the key before it places the
  // labels passes 'reserved': the line under is kept, blank, whenever
  // placeholders are drawn, for unlabelledText to fill once they are placed,
  // so no label can change the key's height
  unlabelled?: UnlabelledPlaceholders | 'reserved'
}

// LIFT_BACKDROP_COLOR reads paler alone than faded strokes do where they
// overlap, so the key samples it darker
export const FADED_KEY_INK = fadeAbgr(LIFT_BACKDROP_COLOR, 0.45)
export const EXON_INK = hexAbgr(EXON_COLOR)
const HALO_INK = hexAbgr(BUBBLE_HALO_COLOR)
export const THREAD_INK = packAbgr(68, 68, 68, 255)

// The reference-position ramp as a key's stops, one per 50 degrees of hue
export const RAMP_KEY_STOPS: KeyStop[] = Array.from({ length: 7 }, (_, i) => ({
  offset: i / 6,
  ink: packHsl(
    rampHueAt(i / 6),
    REFERENCE_RAMP_SATURATION,
    REFERENCE_RAMP_LIGHTNESS,
  ),
}))

const entry = (
  key: string,
  text: string,
  swatch?: GraphKeySwatch,
): GraphKeyEntry => (swatch ? { key, text, swatch } : { key, text })

const counted = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

export function unlabelledText(unlabelled?: UnlabelledPlaceholders) {
  const n = unlabelled?.count.toLocaleString('en-US')
  return !unlabelled
    ? ''
    : unlabelled.count === 1
      ? `${n} unlabelled, ${formatBp(unlabelled.largest)}`
      : unlabelled.smallest === unlabelled.largest
        ? `${n} unlabelled, each ${formatBp(unlabelled.largest)}`
        : `${n} unlabelled, ${formatBp(unlabelled.largest)} or less each`
}

export function tooSmallText(nodes: number, skips: number, underBp = 0) {
  const parts = [
    ...(nodes > 0 ? [counted(nodes, 'node', 'nodes')] : []),
    ...(skips > 0 ? [counted(skips, 'skip', 'skips')] : []),
  ]
  return underBp > 0
    ? `${parts.join(' and ')} under ${counted(underBp, 'bp', 'bp')} not drawn`
    : `${parts.join(' and ')} too small to draw`
}

const roundDepth = (depth: number) =>
  depth >= 10 ? Math.round(depth) : Math.round(depth * 10) / 10

const keyStops = (walk: LiftedWalk) =>
  encodingStops(walk.encoding).map(({ offset, abgr }) => ({
    offset,
    ink: abgr,
  }))

// A lifted walk's entry: a short bar of its colour or of the scale its lane
// shades by, its name and what its pieces leave out, and the stretch the scale
// runs over
export function walkKeyEntry(
  walk: LiftedWalk,
  label: string,
  reference: { name?: string; start: number; end: number } | undefined,
): GraphKeyEntry {
  const key = walkKey(walk, reference)
  const stops = keyStops(walk)
  return {
    key: `walk-${walk.name}`,
    strong: label,
    text: key.gaps,
    under: key.scale,
    hover: key.hover,
    swatch:
      stops.length > 1
        ? { kind: 'scale', stops }
        : { kind: 'swatch', ink: stops[0]!.ink },
    walk,
  }
}

export function graphKey(
  graph: Graph,
  layout: Pick<LayoutResult, 'tubeMap' | 'compressed'>,
  o: GraphKeyOptions,
) {
  const reference =
    o.referenceName ?? referenceLabel(graph, o.region) ?? 'the reference'
  const label = o.walkLabel ?? ((name: string) => name)
  const drawsNodes = o.drawsNodes ?? !layout.tubeMap
  const lifts = o.panels ?? (o.lift ? [o.lift] : [])
  const lifted = lifts.length > 0
  const ramp = o.referenceRamp
  const thickness = o.contigThickness ?? 6
  const connector = o.connectorThickness ?? 2

  const offReference = (key: string) =>
    entry(key, `off ${reference}`, {
      kind: 'chip',
      ink: REFERENCE_RAMP_ALT_COLOR,
    })
  const rampEntries: GraphKeyEntry[] =
    ramp && !lifted
      ? [
          {
            key: 'ramp',
            text: `position on ${reference}`,
            under: rangeText(undefined, ramp.start, ramp.start + ramp.span),
            swatch: { kind: 'scale', stops: RAMP_KEY_STOPS },
          },
          ...((
            layout.tubeMap
              ? graph.nodes.some(
                  n => !n.placeholder && rampFraction(n, ramp) === undefined,
                )
              : drawsNodes && o.marks.offReference
          )
            ? [offReference('off')]
            : []),
        ]
      : []

  const walksLabel = (lift: WalkLift) =>
    lift.walks.length === 1 ? label(lift.walks[0]!.name) : 'these walks'
  const fadedTexts = new Set(
    lifts.flatMap(
      lift =>
        fadedKey(
          graph,
          lift,
          o.panels ? "the panel's walk" : walksLabel(lift),
        ) ?? [],
    ),
  )
  // a faded node keyed by what it is, else the faded links alone
  const fadedNode = lifted && o.marks.plainNode && fadedTexts.size > 0
  const faded = fadedNode
    ? [
        entry(
          'faded',
          fadedTexts.size > 1 ? "not on the panel's walk" : [...fadedTexts][0]!,
          { kind: 'chip', ink: FADED_KEY_INK },
        ),
      ]
    : lifted && o.marks.plainLink
      ? [
          entry(
            'faded-links',
            `links not on ${o.panels ? "the panel's walk" : walksLabel(lifts[0]!)}`,
            { kind: 'line', ink: FADED_KEY_INK, dashed: false },
          ),
        ]
      : []
  const domain = o.lift?.referenceDomain
  const walkReference = domain && { ...domain, name: reference }
  const passEntries = (walk: LiftedWalk, lane: number) => {
    const drawn = walk.walkPasses
    const shown = o.marks.passes.get(lane)
    return !drawn || !shown?.size
      ? []
      : drawn.bundled
        ? drawn.passes
            .slice(0, 1)
            .map(({ title, ink }) =>
              entry(`passes-${walk.name}`, title, { kind: 'swatch', ink }),
            )
        : drawn.passes.flatMap(({ title, ink }, pass) =>
            shown.has(pass)
              ? [
                  entry(`pass-${walk.name}-${pass}`, title, {
                    kind: 'swatch',
                    ink,
                  }),
                ]
              : [],
          )
  }
  const walkEntries: GraphKeyEntry[] = [
    ...(o.panels
      ? []
      : (o.lift?.walks ?? []).flatMap((w, lane) => [
          walkKeyEntry(w, label(w.name), walkReference),
          ...passEntries(w, lane),
        ])),
    ...(lifted && o.marks.offReference ? [offReference('lift-off')] : []),
    ...faded,
    ...(!o.panels && o.lift && o.marks.threads
      ? [
          entry('walk-passes', passesKey(o.lift.walks), {
            kind: 'threads',
            ink: THREAD_INK,
          }),
        ]
      : []),
    ...(lifted && (o.marks.headsAlong || o.marks.headsAgainst)
      ? [
          entry(
            'lane-heads',
            o.marks.headsAlong ? LANE_HEADS_KEY : LANE_HEADS_AGAINST_KEY,
            { kind: 'heads', ink: THREAD_INK, haloed: o.marks.headsHaloed },
          ),
        ]
      : []),
  ]

  const widthEntry = (key: string, text: string, px: number, ink: number) =>
    entry(key, text, { kind: 'width', ink, px })
  const walkCount = graph.paths?.length ?? 0
  const depths = depthKey(graph, thickness)
  // a walk looping through a repeat passes its nodes more than once, and
  // each pass counts
  const passes = (depths[0]?.depth ?? 0) > walkCount
  const nodeWidthEntries: GraphKeyEntry[] = !(drawsNodes && o.marks.widthsVary)
    ? []
    : o.nodeWidth === 'frequency'
      ? frequencyKey(thickness).map(({ label: share, widthPx }) =>
          widthEntry(
            `width-${share}`,
            graph.nodes.some(n => n.frequency !== undefined)
              ? `AF ${share}`
              : `${share} of haplotypes`,
            widthPx,
            REFERENCE_RAMP_ALT_COLOR,
          ),
        )
      : (o.nodeWidth ?? 'depth') === 'depth'
        ? depths.map(({ depth, widthPx }, i) =>
            widthEntry(
              i === 0 ? 'width-thickest' : 'width-thinnest',
              walkCount > 0
                ? passes
                  ? counted(Math.round(depth), 'walk pass', 'walk passes')
                  : counted(Math.round(depth), 'walk', 'walks')
                : `depth ${roundDepth(depth).toLocaleString('en-US')}`,
              widthPx,
              REFERENCE_RAMP_ALT_COLOR,
            ),
          )
        : []

  const busiest = busiestEdge(graph)
  const linkWidthEntries: GraphKeyEntry[] =
    drawsNodes && o.edgeWidth === 'walks' && busiest > 0
      ? (busiest > 1 ? [busiest, 1] : [1]).map(n =>
          widthEntry(
            `link-width-${n}`,
            counted(n, 'walk', 'walks'),
            connector * edgeWidthFactor(n, busiest, 'walks'),
            EDGE_DEFAULT_COLOR,
          ),
        )
      : []

  const skipInk = lifted
    ? fadeAbgr(EDGE_DELETION_COLOR, FADED_ALPHA)
    : EDGE_DELETION_COLOR
  const skipEntries: GraphKeyEntry[] = [
    ...(o.marks.dashedSkip
      ? [
          entry('deletion', deletionKey(reference), {
            kind: 'line',
            ink: skipInk,
            dashed: true,
          }),
        ]
      : []),
    ...(o.marks.shortSkip
      ? [
          entry('short-skip', SHORT_SKIP_KEY, {
            kind: 'line',
            ink: skipInk,
            dashed: false,
          }),
        ]
      : []),
  ]

  const marked = (o.genePins ?? []).filter(pin => pin.exonsByNode.length > 0)
  const wholeGenes = marked.every(({ gene: g }) =>
    g.exons.every(e => e.start <= g.start && e.end >= g.end),
  )
  const outlined = wholeGenes ? 'gene' : 'exon'

  const sections: GraphKeySection[] = [
    { id: 'ramp', group: 'Color', entries: rampEntries },
    { id: 'walks', group: 'Walks', entries: walkEntries },
    { id: 'node-width', group: 'Node thickness', entries: nodeWidthEntries },
    { id: 'link-width', group: 'Link thickness', entries: linkWidthEntries },
    {
      id: 'halo',
      group: 'Marks',
      entries: (o.halos ?? []).some(h => !h.whole)
        ? [
            {
              key: 'halo',
              text: 'bubble',
              swatch: { kind: 'halo', ink: HALO_INK },
            },
          ]
        : [],
    },
    {
      id: 'links',
      group: 'Marks',
      entries:
        !lifted && o.marks.plainLink
          ? [
              entry('link', 'link', {
                kind: 'line',
                ink: EDGE_DEFAULT_COLOR,
                dashed: false,
              }),
            ]
          : [],
    },
    { id: 'skips', group: 'Marks', entries: skipEntries },
    {
      id: 'not-shown',
      group: 'Marks',
      entries:
        drawsNodes && o.marks.placeholder
          ? [
              {
                key: 'not-shown',
                text: NOT_LOADED_TEXT,
                ...(o.unlabelled === 'reserved'
                  ? { under: '' }
                  : o.unlabelled
                    ? { under: unlabelledText(o.unlabelled) }
                    : {}),
                swatch: {
                  kind: 'hollow',
                  ink: NOT_LOADED_FILL_COLOR,
                  rim: NOT_LOADED_COLOR,
                  rimPx: NOT_LOADED_RIM_PX,
                },
              },
            ]
          : [],
    },
    {
      id: 'exon',
      group: 'Marks',
      entries:
        marked.length > 0
          ? [
              {
                key: 'exon',
                text: o.genesFrom
                  ? `${outlined}, from ${o.genesFrom}`
                  : outlined,
                swatch: { kind: 'outline', ink: EXON_INK },
              },
            ]
          : [],
    },
    {
      id: 'overhang',
      entries: o.stripOverhangs
        ? [
            {
              key: 'overhang',
              text: 'graph runs past this edge',
              swatch: { kind: 'overhang' },
            },
          ]
        : [],
    },
    {
      id: 'compressed',
      entries: layout.compressed
        ? [{ key: 'compressed', text: COMPRESSED_KEY }]
        : [],
    },
    {
      id: 'too-small',
      entries:
        o.marks.foldedNodes.size + o.marks.foldedSkips.size > 0
          ? [
              {
                key: 'too-small',
                text: tooSmallText(
                  o.marks.foldedNodes.size,
                  o.marks.foldedSkips.size,
                  o.marks.foldedUnderBp,
                ),
              },
            ]
          : [],
    },
  ]
  return sections.filter(section => section.entries.length > 0)
}

export type GraphKey = ReturnType<typeof graphKey>
