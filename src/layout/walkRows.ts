import { walkRowRuns, walkRowsOf } from './walkRowRuns'

import type { GapCause } from '../gfa/walkStops'
import type { Graph, StopChunk } from '../types'

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
  // the walk crosses that reference from its end back to its start
  reversed?: true
  // bases of the walk's contig between two pieces the cut returned, which the
  // cut holds nothing of
  gap?: true
  // why, where a walk-file cut's stops bounding the gap say: `missing`, the
  // walk's record ends and the contig's next starts past it, so the graph
  // lacks those bases; `elsewhere`, the walk goes on through nodes filed under
  // `chunk`, which the cut did not read; `unknown`, the stops leave it open,
  // as between two breaks with records this reference never visits. A gap
  // with no cause is graph sequence outside the extracted subgraph
  cause?: GapCause
  chunk?: StopChunk
}

// Where a row's bar lies on the walk's own contig: the contig position at the
// bar's left end, and whether positions fall rightward along it
export interface WalkAxis {
  contig: string
  start: number
  reversed: boolean
}

// How a walk that reaches one flank stops: on a reference node, where its
// contig ends (`shortBp` short of the region when it never enters it), or off
// the reference, where it does not rejoin within the cut
export interface WalkStop {
  contigEnds: boolean
  shortBp: number
}

// A step of a row's bar through a graph node: its bp offset from the bar's
// start, its bp, and whether the reference walk visits the node anywhere in
// the cut
export interface WalkVisit {
  node: string
  start: number
  bp: number
  onReference: boolean
}

export interface WalkRow {
  name: string
  label: string
  sample: string
  haplotype?: number
  bp: number
  offReferenceBp: number
  // bp of the gap runs, counted in `bp` and not in `offReferenceBp`
  gapBp: number
  // false when the walk does not reach both flanking reference nodes; one
  // that reaches one flank is measured from it, a lower bound
  complete: boolean
  stop?: WalkStop
  // the steps an abridged walk's gaps stand for, which the cut did not load
  abridgedSteps?: number
  // true where an abridged block runs past the window, so `bp` takes the
  // reference's bp for the part outside it
  estimated?: boolean
  // a row of deletion from a skip row: bp of the whole stretch the haplotype
  // leaves out, which runs past the window
  deletionBp?: number
  runs: WalkRun[]
  // walkRows fills it only when asked, since an object per step costs a big
  // cut far more than its runs
  visits?: WalkVisit[]
  // undefined where a piece states no start or overlaps the one before, so
  // bar offsets don't map linearly onto the contig
  axis?: WalkAxis
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

// The rows a sample filter keeps, in the order it names them
export function filterSamples<R extends { sample: string; label: string }>(
  rows: R[],
  samples: string[] | undefined,
) {
  return samples
    ? rows
        .filter(r => samples.includes(r.sample))
        .sort(
          (a, b) =>
            samples.indexOf(a.sample) - samples.indexOf(b.sample) ||
            a.label.localeCompare(b.label),
        )
    : rows
}

export function walkRows(
  graph: Graph,
  region?: { start: number; end: number },
  unit?: number,
  o: { visits?: boolean } = {},
): WalkRows | undefined {
  const runs = walkRowRuns(graph, region, o)
  return runs && walkRowsOf(runs, unit)
}
