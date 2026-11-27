import { panSNHaplotype } from '../pansn'
import { compareIds } from '../util/canonicalOrder'
import { walkRowRuns, walkRowsOf } from './walkRowRuns'

import type { Departure, GapCause } from '../gfa/departures'
import type { Graph } from '../types'

export { referenceWalkName } from './walkRowRuns'

// Each haplotype walk on its own bp axis, so what a walk carries through the
// window is its bar length. Reference-anchored rows cannot state that: a
// haplotype's private copies of a repeat consume no reference and collapse to
// a mark, which is why the KIV-2 array reads as a knot in every node layout
// and as a ladder here.
//
// A base-level graph does not revisit reference nodes through a repeat array,
// so a copy count is not a visit count; it is the sequence a walk spends
// between the reference nodes flanking the window, divided by the unit. Runs
// tell nodes on the reference walk's path from nodes off it. Off the path is
// an alternative route through the graph, not sequence the reference lacks: at
// a duplication the graph may route a copy the reference carries through nodes
// of its own, so an off-path run is no copy count.

export interface WalkRun {
  // bp offset from the start of this walk's slice
  start: number
  bp: number
  onReference: boolean
  // lowest reference bp an on-reference run covers; the run covers `bp` of
  // reference contiguously. A node the reference walks more than once counts
  // from the visit nearest where the walk left the reference. In a tandem array that is the reference copy the
  // graph threads this copy through, which need not be the one it most
  // resembles.
  referenceStart?: number
  // the walk's steps run against the reference's strand at their nodes
  reversed?: true
  // bases of the walk's contig between two pieces the cut returned, which the
  // cut holds nothing of
  gap?: true
  // why (gfa/departures.ts gapParts)
  cause?: GapCause
  // for a `mixed` gap, its bp left out of graph
  missingBp?: number
  // set where the bp left out of graph are a lower bound: the cut did not
  // read every departure across the gap
  atLeast?: true
  // for an `away` gap, drawn at most a fixed width, the bp it holds
  heldBp?: number
  unloaded?: true
  // off the reference in the cut, the source stating its steps on the
  // reference at passes the cut does not hold: reference sequence from
  // elsewhere, not the walk's own
  fromElsewhere?: true
}

// Where a row's bar lies along its walk's own steps: the bp the walk's
// visits count at the bar's left end, rising rightward along it
export interface WalkAlong {
  start: number
  // the stretches away from the window, `bp` of the walk from `at` bp along
  // the bar drawn `drawn` wide, in order
  breaks?: WalkBreak[]
}

// The same where the walk's records state the contig positions it counts
export interface WalkAxis extends WalkAlong {
  contig: string
}

export interface WalkBreak {
  at: number
  bp: number
  drawn: number
}

// Where `along` bp of contig past the bar's start is drawn on the bar
export function drawnAlong(axis: Pick<WalkAlong, 'breaks'>, along: number) {
  let shift = 0
  let inside: number | undefined
  for (const b of axis.breaks ?? []) {
    if (inside === undefined && along >= b.at + b.bp) {
      shift += b.bp - b.drawn
    } else if (inside === undefined && along > b.at) {
      inside = b.at - shift + ((along - b.at) * b.drawn) / b.bp
    }
  }
  return inside ?? along - shift
}

// The bp of contig past the bar's start drawn at `x` on the bar
export function contigAlong(axis: Pick<WalkAlong, 'breaks'>, along: number) {
  let shift = 0
  let inside: number | undefined
  for (const b of axis.breaks ?? []) {
    const start = b.at - shift
    if (inside === undefined && along >= start + b.drawn) {
      shift += b.bp - b.drawn
    } else if (inside === undefined && along > start) {
      inside = b.at + ((along - start) * b.bp) / b.drawn
    }
  }
  return inside ?? along + shift
}

// A contig span as offsets along a row's bar
export const alongRow = (axis: WalkAlong, start: number, end: number) => ({
  start: drawnAlong(axis, start - axis.start),
  end: drawnAlong(axis, end - axis.start),
})

// How a row's walk stops at one end of its bar inside the window: the graph
// holds no more of its contig on the reference past that step (`contigEnds`),
// at the contig's start `contigStart` bp in, which lie in no W line or in one
// with no step on the reference; or it goes on by the departure at that
// step (`goesOn`) or past what the cut kept.
export interface WalkStop {
  contigEnds: boolean
  shortBp: number
  // set at the end of the bar the walk's contig comes from
  start?: true
  // set where the step lies past the window's right edge, `shortBp` past it
  past?: true
  contigStart?: number
  goesOn?: { departure: Departure; near: number; drawn?: true }
  // the walk comes back to the reference on the side it came in from, which
  // ends its pass
  turnsBack?: true
}

export interface WalkStops {
  left?: WalkStop
  right?: WalkStop
}

// One pass of a walk over the window, from a flank on one side to the next on
// the other: its bp, and its bp over the window or, where its own sequence
// crosses a window edge, the reference's bp it replaces
export interface WalkPass {
  bp: number
  windowBp: number
  replacedBp?: number
  // of `bp`, the bp of steps on the reference from elsewhere
  fromElsewhereBp?: number
  // where it has `replacedBp`, its bp on the reference in the cut, and its bp
  // in gaps
  onReferenceBp?: number
  gapBp?: number
}

// A step of a row's bar through a graph node: its bp offset from the bar's
// start, its bp, and whether the step lies on the reference in the cut
export interface WalkVisit {
  node: string
  start: number
  bp: number
  onReference: boolean
  unloaded?: true
}

export interface WalkRow {
  name: string
  label: string
  sample: string
  haplotype?: number
  bp: number
  // bp of its loaded runs off the reference walk's path; for a stepless row,
  // the haplotype's own bp between its departures' ends, which it draws no
  // bar of
  offReferenceBp: number
  unloadedBp?: number
  // of `offReferenceBp`, the bp of `fromElsewhere` runs
  fromElsewhereBp?: number
  // bp of the gap runs, counted in `bp` and not in `offReferenceBp`
  gapBp: number
  // bp of its runs walked against the reference, over the window alone where
  // it has `windowBp`
  reversedBp?: number
  // false when the walk does not reach both flanking reference nodes; one
  // that reaches one flank is measured from it, a lower bound
  complete: boolean
  // bp of the walk over the window alone, where it reaches a flank: its bp
  // from them less what lies between a flank and the window, so every row is
  // measured over the same reference interval
  windowBp?: number
  // in place of windowBp where the walk's own sequence crosses a window edge,
  // which leaves it no length over the window: the reference's bp between the
  // walk's flanks, which its `bp` replaces
  replacedBp?: number
  // with `replacedBp`, the bp of the pass on the reference in the cut
  onReferenceBp?: number
  // set where the bar reaches over steps on the reference outside the window,
  // drawn as gaps near where they lie, so its bp are no length over the window
  passesOutside?: true
  // every pass over the window, in contig order, where there are several
  passes?: WalkPass[]
  // how the walk stops at each end of its bar where it does not leave the
  // window there by a flank
  stops?: WalkStops
  // the steps of the walk's pieces the cut did not load, on a row that
  // holds any of them, for a host to offer to load
  abridgedSteps?: number
  // the walk's departures from the reference over the cut that its runs do
  // not draw as steps: those its gaps stand for, and for a stepless row every
  // one
  departures?: Departure[]
  // set where one of the walk's departures over the cut is the writer's
  // placement choice, an end on a node the reference passes more than once
  placementChoice?: true
  // set on a row with no step in the cut, drawn from its departures alone
  stepless?: true
  // the walk's departures a walk-file cut states outside the row, and the bp
  // of their own steps it holds
  outsideRow?: { count: number; stepsBp: number }
  // the departures over the cut of its haplotype's contigs with no walk in it,
  // on the haplotype's first row
  otherContigs?: { contigs: number; departures: number }
  runs: WalkRun[]
  // walkRows fills it only when asked, since an object per step costs a big
  // cut far more than its runs
  visits?: WalkVisit[]
  // undefined where a piece states no start or overlaps the one before, so
  // bar offsets don't map linearly onto the walk's own steps
  along?: WalkAlong
  // undefined also where a piece states no span its own steps fill
  // (pathAnchoring.ts spanStated)
  axis?: WalkAxis
  // on the reference row, the count of nodes the reference passes more than
  // once that its tables or Graph state, or the host passes (gfa/departures.ts
  // ownIsExact)
  revisited?: number
}

export interface WalkRows {
  // reference bp the rows' bars start at, so a row's x is origin + run.start
  origin: number
  // repeat unit in bp when a repeat annotation supplied one; the bars tile by it
  unit?: number
  reference: WalkRow
  // every other walk, longest first
  rows: WalkRow[]
}

interface NamedRow {
  name: string
  sample: string
  haplotype?: number
}

// What a sample filter names a row's haplotype by: `sample#haplotype`, from
// its W line or a P line's PanSN name, or the sample where neither states one
export const rowHaplotype = (row: NamedRow) =>
  row.haplotype === undefined
    ? (panSNHaplotype(row.name) ?? row.sample)
    : `${row.sample}#${row.haplotype}`

// The rows a sample filter keeps, in the order it names them: each names a
// sample, every haplotype of it, or one haplotype as rowHaplotype does
export function filterSamples<R extends NamedRow & { label: string }>(
  rows: R[],
  samples: string[] | undefined,
) {
  const named = (r: R) => {
    const at = samples?.indexOf(rowHaplotype(r)) ?? -1
    return at >= 0 ? at : (samples?.indexOf(r.sample) ?? -1)
  }
  return samples
    ? rows
        .filter(r => named(r) >= 0)
        .sort((a, b) => named(a) - named(b) || compareIds(a.label, b.label))
    : rows
}

export function walkRows(
  graph: Graph,
  region?: { start: number; end: number },
  unit?: number,
  o: { visits?: boolean; revisited?: number } = {},
): WalkRows | undefined {
  const runs = walkRowRuns(graph, region, o)
  return runs && walkRowsOf(runs, unit)
}
