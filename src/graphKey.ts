import { COMPRESSED_KEY } from './bubbleSpreads'
import { BUBBLE_HALO_COLOR } from './bubbles/bubbleLabel'
import { SHORT_SKIP_KEY, deletionKey } from './deletionEdges'
import { busiestEdge, edgeWidthFactor } from './edgeWidths'
import { EXON_COLOR } from './genes/exonOutline'
import { NOT_LOADED_TEXT } from './gfa/departures'
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
import { passesKey, threadsPasses } from './renderer/walkLanes'
import { NO_VALUE_COLOR, encodingStops } from './walkEncoding'
import { fadedKey } from './walkHighlight'
import { rangeText, walkKey } from './walkKey'

import type { EdgeWidth } from './edgeWidths'
import type { GenePin } from './genes/genePins'
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
  | 'skips'
  | 'not-shown'
  | 'exon'
  | 'overhang'
  | 'compressed'

export interface GraphKeySection {
  id: GraphKeySectionId
  // the group a reader may head the section with: a thickness's entries are
  // counts that read only under it
  group?: 'Color' | 'Walks' | 'Node thickness' | 'Link thickness' | 'Marks'
  entries: GraphKeyEntry[]
}

// Which marks a skip draws as in a drawing's batches: dashed, and one plain
// stroke where its span on screen is too short to hold the dashes. A lifted
// walk's lane on a skip is its walk's, keyed by the walk.
export function drawnSkips(
  batches: readonly Pick<RenderBatch, 'edgeCurves'>[],
) {
  let dashed = false
  let short = false
  for (const { edgeCurves } of batches) {
    for (const { skip, span = 0, walk } of edgeCurves) {
      if (skip && walk === undefined && span > 0) {
        if (skipDashes(span)) {
          dashed = true
        } else {
          short = true
        }
      }
    }
  }
  return { dashed, short }
}

export type DrawnSkips = ReturnType<typeof drawnSkips>

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
  skips: DrawnSkips
  genePins?: readonly GenePin[]
  // where the genes came from, named after their outline's entry
  genesFrom?: string
  halos?: readonly { whole: boolean }[]
  // the reference strip has a tab past an edge
  stripOverhangs?: boolean
}

// LIFT_BACKDROP_COLOR reads paler alone than faded strokes do where they
// overlap, so the key samples it darker
export const FADED_KEY_INK = fadeAbgr(LIFT_BACKDROP_COLOR, 0.45)
export const EXON_INK = hexAbgr(EXON_COLOR)
const HALO_INK = hexAbgr(BUBBLE_HALO_COLOR)
const THREAD_INK = packAbgr(68, 68, 68, 255)

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

const paintsOffReference = (lifts: readonly WalkLift[]) =>
  lifts.some(lift =>
    lift.walks.some(
      w =>
        w.encoding.field !== 'walk' &&
        [...w.colors.values()].includes(NO_VALUE_COLOR),
    ),
  )

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
          ...((drawsNodes || layout.tubeMap) &&
          graph.nodes.some(
            n => !n.placeholder && rampFraction(n, ramp) === undefined,
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
  const faded =
    fadedTexts.size > 1 ? "not on the panel's walk" : [...fadedTexts][0]
  const domain = o.lift?.referenceDomain
  const walkReference = domain && { ...domain, name: reference }
  const walkEntries: GraphKeyEntry[] = [
    ...(o.panels
      ? []
      : (o.lift?.walks ?? []).map(w =>
          walkKeyEntry(w, label(w.name), walkReference),
        )),
    ...(paintsOffReference(lifts) ? [offReference('lift-off')] : []),
    ...(faded
      ? [entry('faded', faded, { kind: 'chip', ink: FADED_KEY_INK })]
      : []),
    ...(!o.panels && o.lift && threadsPasses(o.lift.walks)
      ? [
          entry('walk-passes', passesKey(o.lift.walks), {
            kind: 'threads',
            ink: THREAD_INK,
          }),
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
  const nodeWidthEntries: GraphKeyEntry[] = !drawsNodes
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

  const skipInk = lifted ? FADED_KEY_INK : EDGE_DELETION_COLOR
  const skipEntries: GraphKeyEntry[] = [
    ...(o.skips.dashed
      ? [
          entry('deletion', deletionKey(reference), {
            kind: 'line',
            ink: skipInk,
            dashed: true,
          }),
        ]
      : []),
    ...(o.skips.short
      ? [
          entry('short-skip', SHORT_SKIP_KEY, {
            kind: 'line',
            ink: skipInk,
            dashed: false,
          }),
        ]
      : []),
  ]

  const shownPlaceholder = graph.nodes.some(
    n =>
      n.placeholder && (!lifted || lifts.some(lift => lift.nodeIds.has(n.id))),
  )
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
    { id: 'skips', group: 'Marks', entries: skipEntries },
    {
      id: 'not-shown',
      group: 'Marks',
      entries:
        drawsNodes && shownPlaceholder
          ? [
              {
                key: 'not-shown',
                text: NOT_LOADED_TEXT,
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
  ]
  return sections.filter(section => section.entries.length > 0)
}

export type GraphKey = ReturnType<typeof graphKey>
