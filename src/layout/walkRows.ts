import { panSNSample } from '../pansn'
import { pathOrigin } from '../pathAnchoring'

import type { Graph, GraphPath } from '../types'

// Each haplotype walk on its own bp axis, so what a walk carries through the
// window is its bar length. Reference-anchored rows cannot state that: a
// haplotype's private copies of a repeat consume no reference and collapse to
// a mark, which is why the KIV-2 array reads as a knot in every node layout
// and as a ladder here.
//
// A base-level graph does not revisit reference nodes through a repeat array,
// so a copy count is not a visit count; it is the sequence a walk spends
// between the reference nodes flanking the window, divided by the unit. Runs
// distinguish sequence the reference walk also carries from sequence it does
// not, so an expansion is the off-reference stretch of a row.

export interface WalkRun {
  // bp offset from the start of this walk's slice
  start: number
  bp: number
  onReference: boolean
  // lowest reference bp an on-reference run covers; the run covers `bp` of
  // reference contiguously. In a tandem array that is the reference copy the
  // graph threads this copy through, which need not be the one it most
  // resembles.
  referenceStart?: number
  // the walk crosses that reference from its end back to its start
  reversed?: true
  // bases of the walk's contig between two pieces the cut returned: the walk
  // left the window's nodes and came back, and the cut holds nothing of them
  gap?: true
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
  // false when the walk does not reach both flanking reference nodes, in which
  // case the whole walk is measured and the bar says so
  complete: boolean
  runs: WalkRun[]
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

function sampleOf(path: GraphPath) {
  return path.sample ?? panSNSample(path.name)
}

function labelOf(path: GraphPath) {
  return path.haplotype !== undefined && path.sample !== undefined
    ? `${path.sample}#${path.haplotype}`
    : sampleOf(path)
}

// A walk's steps through the cut: its node ids, and between two pieces of it
// the bp of contig the cut does not hold
type Step = string | number

// The pieces of one walk in contig order, with the bp between them as gaps.
// A piece with no start, or one that overlaps the last, follows it directly.
function stepsOf(pieces: GraphPath[], lengthOf: Map<string, number>): Step[] {
  const steps: Step[] = []
  let end: number | undefined
  for (const piece of pieces) {
    if (end !== undefined && piece.start !== undefined && piece.start > end) {
      steps.push(piece.start - end)
    }
    steps.push(...piece.nodeIds)
    const bp = piece.nodeIds.reduce(
      (sum, id) => sum + (lengthOf.get(id) ?? 0),
      0,
    )
    end = piece.start === undefined ? undefined : piece.start + bp
  }
  return steps
}

// Each walk is cut at the nearest reference nodes IT visits on either side of
// the region, so a walk that skips one flanking node at a SNP is still measured
// between flanks rather than whole.
function sliceBetween(
  steps: Step[],
  span: Map<string, { start: number; end: number }>,
  region: { start: number; end: number } | undefined,
  flanked = true,
) {
  // A cut that stops at the window carries no flanking reference for anyone,
  // so every walk is whole and the slice is the walk.
  if (!region || !flanked) {
    return { ids: steps, complete: true }
  }
  let i0 = -1
  let i1 = -1
  let bestEnd = -Infinity
  let bestStart = Infinity
  steps.forEach((id, i) => {
    const s = typeof id === 'string' ? span.get(id) : undefined
    if (s) {
      if (s.end <= region.start && s.end > bestEnd) {
        bestEnd = s.end
        i0 = i
      }
      if (s.start >= region.end && s.start < bestStart) {
        bestStart = s.start
        i1 = i
      }
    }
  })
  if (i0 < 0 || i1 < 0) {
    return { ids: steps, complete: false }
  }
  const ids = steps.slice(Math.min(i0, i1) + 1, Math.max(i0, i1))
  return { ids: i0 < i1 ? ids : ids.reverse(), complete: true }
}

export function walkRows(
  graph: Graph,
  region?: { start: number; end: number },
  unit?: number,
): WalkRows | undefined {
  const paths = graph.paths ?? []
  // `referencePath` is the anchor name, which pathOrigin has already stripped
  // of the range suffix odgi leaves on a P record's name. A cut over several
  // fragments of the reference holds one record per fragment.
  const isReference = (p: GraphPath) =>
    pathOrigin(p.name).name === graph.referencePath
  const referencePieces = paths.some(isReference)
    ? paths.filter(isReference).sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    : paths.slice(0, 1)
  const first = referencePieces[0]
  const others = paths.filter(p => !referencePieces.includes(p))
  if (!first || others.length === 0) {
    return undefined
  }
  // a cut hands a walk back as one record per piece inside its nodes
  const walks = new Map<string, GraphPath[]>()
  for (const path of others) {
    walks.set(path.name, [...(walks.get(path.name) ?? []), path])
  }
  const lengthOf = new Map(graph.nodes.map(n => [n.id, n.length]))
  const referenceStart = first.start ?? 0

  const cut = region && region.end > region.start ? region : undefined
  const span = new Map<string, { start: number; end: number }>()
  for (const piece of referencePieces) {
    let pos = piece.start ?? 0
    for (const id of piece.nodeIds) {
      const len = lengthOf.get(id) ?? 0
      if (!span.has(id)) {
        span.set(id, { start: pos, end: pos + len })
      }
      pos += len
    }
  }

  // Whether the reference reaches past the region on both sides, i.e. whether
  // a flanking node exists for any walk to be cut at.
  const flanked =
    cut === undefined ||
    ([...span.values()].some(s => s.end <= cut.start) &&
      [...span.values()].some(s => s.start >= cut.end))

  const rowOf = (pieces: GraphPath[]): WalkRow => {
    const path = pieces[0]!
    const ordered = [...pieces].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
    const { ids, complete } = sliceBetween(
      stepsOf(ordered, lengthOf),
      span,
      cut,
      flanked,
    )
    const runs: WalkRun[] = []
    let bp = 0
    let offReferenceBp = 0
    let gapBp = 0
    // which way the last run steps through the reference, 0 while it holds
    // one node
    let step = 0
    for (const id of ids) {
      if (typeof id === 'number') {
        runs.push({ start: bp, bp: id, onReference: false, gap: true })
        bp += id
        gapBp += id
        step = 0
        continue
      }
      const len = lengthOf.get(id) ?? 0
      const s = span.get(id)
      const last = runs.at(-1)
      const at = last?.referenceStart
      const forward =
        s && at !== undefined && step >= 0 && at + last!.bp === s.start
      const backward = s && at !== undefined && step <= 0 && s.end === at
      if (!s && last && !last.onReference && !last.gap) {
        last.bp += len
      } else if (forward || backward) {
        last!.bp += len
        if (!forward) {
          last!.referenceStart = s.start
          last!.reversed = true
        }
        step = forward ? 1 : -1
      } else {
        runs.push({
          start: bp,
          bp: len,
          onReference: s !== undefined,
          referenceStart: s?.start,
        })
        step = 0
      }
      bp += len
      if (!s) {
        offReferenceBp += len
      }
    }
    return {
      name: path.name,
      label: labelOf(path),
      sample: sampleOf(path),
      haplotype: path.haplotype,
      bp,
      offReferenceBp,
      gapBp,
      complete,
      runs,
    }
  }

  const origin = cut ? cut.start : referenceStart
  return {
    origin,
    unit,
    reference: rowOf(referencePieces),
    rows: [...walks.values()]
      .map(rowOf)
      .sort(
        (a, b) =>
          Number(b.complete) - Number(a.complete) ||
          b.bp - a.bp ||
          a.label.localeCompare(b.label),
      ),
  }
}
