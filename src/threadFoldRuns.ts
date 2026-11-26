import { foldRuns } from '@jbrowse/graph-fold'

import { referenceOf, walkPathName } from './gfa/graphTables'
import { pathOrigin } from './pathAnchoring'
import { foldedGraph, haplotypeOf, threadEvents } from './threadFold'

import type { WalkRunsTables } from './gfa/walkRuns'
import type { ThreadEvent, ThreadWalk } from './threadFold'
import type { Graph } from './types'
import type { Folded, RunsInput } from '@jbrowse/graph-fold'

// A window's walks read as runs, graph-walks' `WalkReader.runs`, folded as
// foldThreads folds the same window's cut: no step is made of a run, so a
// window too large to cut folds from the rows that state it.

// The runs as graph-fold's foldRuns reads them: the backbone foldThreads
// would pick of the same window's cut, its nodes the reference's, and every
// other fragment a track in the runs' order with its ends; or why not
export function threadRunsInput(runs: WalkRunsTables) {
  const { walks, stretches } = runs
  const names = walks.names.map((name, p) =>
    walkPathName(name, walks.starts[p]!, walks.ends[p]!),
  )
  const threadWalk = (p: number): ThreadWalk => ({
    name: names[p]!,
    haplotype: haplotypeOf(names[p]!),
    start: walks.starts[p]!,
  })
  const origins = names.map(name => pathOrigin(name).name)
  const referencePath = referenceOf(origins, undefined, new Set([runs.refName]))
  const backbone =
    referencePath === undefined ? -1 : origins.indexOf(referencePath)
  const order = walks.names.flatMap((_, p) => (p === backbone ? [] : [p]))
  const held = (side: 'before' | 'after') => {
    const table = walks[side]
    return {
      kinds: Uint8Array.from(order, p => table.kinds[p]!),
      pos: Float64Array.from(order, p => table.pos[p]!),
      reversed: Uint8Array.from(order, p => table.reversed[p]!),
      ownBp: Float64Array.from(order, p => table.ownBp[p]!),
      missingBp: Float64Array.from(order, p => table.missingBp[p]!),
    }
  }
  const at: number[] = []
  const offsets = [0]
  for (const p of order) {
    for (let k = walks.offsets[p]!; k < walks.offsets[p + 1]!; k++) {
      at.push(k)
    }
    offsets.push(at.length)
  }
  const spans: { start: number; end: number }[] = []
  for (
    let k = walks.offsets[backbone] ?? 0;
    k < (walks.offsets[backbone + 1] ?? 0);
    k++
  ) {
    spans.push({
      start: stretches.starts[k]!,
      end: stretches.starts[k]! + stretches.bp[k]!,
    })
  }
  const nodes = runs.reference.names.flatMap((name, i) => {
    const start = runs.reference.starts[i]!
    return spans.some(span => span.start <= start && start < span.end)
      ? [{ name, sequenceLength: runs.reference.lengths[i]!, start }]
      : []
  })
  const reference = backbone < 0 ? undefined : threadWalk(backbone)
  const input = (
    track: ThreadWalk,
  ): RunsInput<ThreadWalk & { indexOfFirstBase?: number }> => ({
    reference: {
      track: { ...track, indexOfFirstBase: nodes[0]?.start ?? 0 },
      nodes: nodes.map(({ name, sequenceLength }) => ({
        name,
        sequenceLength,
      })),
      starts: Float64Array.from(nodes, node => node.start),
    },
    tracks: order.map(threadWalk),
    offsets: Int32Array.from(offsets),
    stretches: {
      starts: Float64Array.from(at, k => stretches.starts[k]!),
      bp: Float64Array.from(at, k => stretches.bp[k]!),
      against: Uint8Array.from(at, k => stretches.against[k]!),
      offBefore: Float64Array.from(at, k => stretches.offBefore[k]!),
    },
    leadBp: Float64Array.from(order, p => walks.leadBp[p]!),
    tailBp: Float64Array.from(order, p => walks.tailBp[p]!),
    ends: { before: held('before'), after: held('after') },
  })
  return runs.revisited !== 0
    ? {
        reason: Number.isNaN(runs.revisited)
          ? 'the walk file does not say how many nodes its reference passes more than once, so a run off it may be a copy of reference sequence and not a variant'
          : `the reference passes ${runs.revisited} nodes of the graph more than once, so a run off it may be a copy of reference sequence and not a variant`,
      }
    : !reference
      ? { reason: 'the graph has no reference walk' }
      : {
          input: input(reference),
          walks: [reference, ...order.map(threadWalk)],
          refName: runs.refName,
          referencePath,
          departing: runs.departing.names,
        }
}

export type ThreadRunsFoldResult =
  | { folded: true; graph: Graph; events: ThreadEvent[]; walks: ThreadWalk[] }
  | { folded: false; reason: string }

type ThreadRunsRead = ReturnType<typeof threadRunsInput>

export interface ThreadRunsOptions {
  cluster?: boolean
  name?: string
}

/** foldThreadRuns of runs threadRunsInput has read */
export function foldThreadRunsInput(
  read: ThreadRunsRead,
  belowBp: number,
  { cluster = true, name }: ThreadRunsOptions = {},
): ThreadRunsFoldResult {
  const ready = read.input === undefined ? undefined : read
  const fold =
    ready &&
    foldRuns(ready.input, {
      threshold: belowBp,
      cluster,
      referenceRevisits: 0,
    })
  const threads = (
    kept: Folded<ThreadWalk>,
    { walks, refName, referencePath, departing }: NonNullable<typeof ready>,
  ): ThreadRunsFoldResult => {
    const graph = foldedGraph(kept, {
      name: name ?? refName,
      refName,
      referencePath,
      tracks: walks,
      departing,
    })
    return {
      folded: true,
      graph,
      events: threadEvents(kept, walks, graph),
      walks,
    }
  }
  return !ready || !fold
    ? {
        folded: false,
        reason: read.reason ?? 'nothing to fold',
      }
    : fold.folded
      ? threads(fold, ready)
      : { folded: false, reason: fold.reason }
}

/**
 * The graph foldThreads draws of a window's cut, from the same window's runs
 * instead, graph-walks' `WalkReader.runs`: every difference between its
 * walks under `belowBp` merged into the reference and its walks as threads,
 * an end that leaves the window drawn as far as the runs say it goes; or why
 * not. `name` names the graph, the reference sequence by default. The key
 * tells a haplotype that departs across the whole window from one with no
 * walk there by the runs' `departing`.
 */
export function foldThreadRuns(
  runs: WalkRunsTables,
  belowBp: number,
  opts: ThreadRunsOptions = {},
): ThreadRunsFoldResult {
  return belowBp > 0
    ? foldThreadRunsInput(threadRunsInput(runs), belowBp, opts)
    : { folded: false, reason: 'nothing to fold' }
}
