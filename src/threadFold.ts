import { branchLabel, foldGraph, variationLabel } from '@jbrowse/graph-fold'

import { departureTable } from './gfa/departures'
import { linkKey } from './gfa/linkKey'
import { END_KINDS } from './gfa/walkRuns'
import { referenceWalkName } from './layout/walkRowRuns'
import { panSNFields } from './pansn'
import { pathOrigin } from './pathAnchoring'
import { loadGraph } from './pipeline'
import { threadLabel } from './threadKey'

import type { GraphTables } from './gfa/graphTables'
import type { PathEnd, PathEnds } from './gfa/walkRuns'
import type { PathVisits } from './pathVisits'
import type { Graph, GraphPath } from './types'
import type { WalkLayer } from './walkEncoding'
import type { Branch, Folded } from '@jbrowse/graph-fold'

// A graph with walks at a size no pane can show step by step: graph-fold
// merges every difference under `belowBp` into the reference and reroutes each
// walk, and the walks that then take the same route are one path, a thread,
// which carries how many haplotypes take it. What each thread skips or adds is
// drawn; what that means against the reference is not written on the graph
// (graphLabels.ts), and `threadEvents` hands a host graph-fold's words for it,
// for a caption or a hover.

// A walk record a fold takes: its name as a path, its haplotype and where it
// starts on its contig
export interface ThreadWalk {
  name: string
  haplotype: string
  start: number
}

export interface ThreadTrack extends ThreadWalk {
  sequence: string[]
  indexOfFirstBase?: number
}

function inOrder(stated: PathVisits) {
  const cursor = stated.offsets.slice()
  return (slot: number, walk: number) => {
    const at = cursor[slot]!++
    return at < stated.offsets[slot + 1]! && stated.path[at] === walk ? at : -1
  }
}

const stepped = (steps: (string | undefined)[]): steps is string[] =>
  steps.every(step => step !== undefined)

// Each walk record's steps as graph-fold names them, or undefined where the
// graph does not say which way a record reads one of its steps: a node's id
// carries the way it is drawn, not the way a walk reads it. A graph's visits
// are filed under each node in the order its records step it, so reading the
// records in that order takes each node's visits one after the next; where a
// visit met that way is another walk's, the visits are in some other order and
// `replay` finds each step's instead, searching the node's visits each time
function recordSteps(graph: Graph, walked: readonly GraphPath[]) {
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const visits = graph.pathVisits
  const reversedNames = new Map<string, string>()
  const reversedName = (name: string) => {
    let reversed = reversedNames.get(name)
    if (reversed === undefined) {
      reversed = `-${name}`
      reversedNames.set(name, reversed)
    }
    return reversed
  }
  const read = (
    stated: PathVisits,
    visitOf: (slot: number, walk: number) => number,
  ) => {
    const steps = walked.map(path => {
      const walk = stated.pathIndex(pathOrigin(path.name).name)
      return path.nodeIds.map(id => {
        const node = byId.get(id)
        const slot = node ? stated.slot(node.name) : -1
        const at = slot >= 0 && walk >= 0 ? visitOf(slot, walk) : -1
        return node && at >= 0
          ? stated.strand(at) === '-'
            ? reversedName(node.name)
            : node.name
          : undefined
      })
    })
    return steps.every(stepped) ? steps : undefined
  }
  return visits
    ? (read(visits, inOrder(visits)) ?? read(visits, visits.replay()))
    : undefined
}

// The haplotype a walk record is of: `sample#hap` of a PanSN name, else the
// name less any range, so the pieces of one haplotype count once
export const haplotypeOf = (name: string) => {
  const origin = pathOrigin(name).name
  const fields = panSNFields(origin)
  return fields ? `${fields.sample}#${fields.haplotype}` : origin
}

// How many nodes the reference the fold reads passes more than once: the
// graph's `revisited` where that reference is the graph's first walk, which a
// walk file's header and `revisitedCount` count for, and any it passes twice
// here, so a graph anchored on another walk is gated on that walk's own
function referenceRevisits(graph: Graph, reference: string | undefined) {
  const paths = graph.paths ?? []
  const passes = new Map<string, number>()
  for (const path of paths) {
    if (pathOrigin(path.name).name === reference) {
      for (const id of path.nodeIds) {
        passes.set(id, (passes.get(id) ?? 0) + 1)
      }
    }
  }
  const here = [...passes.values()].filter(n => n > 1).length
  const stated =
    paths[0] && pathOrigin(paths[0].name).name === reference
      ? (graph.revisited ?? 0)
      : 0
  return stated > here ? stated : here
}

// graph-fold's ends of walks in fold order, each record's own
function foldEnds(rows: readonly PathEnds[]) {
  const table = (side: 'before' | 'after') => ({
    kinds: Uint8Array.from(rows, row => END_KINDS.indexOf(row[side].kind)),
    pos: Float64Array.from(rows, row => row[side].pos),
    reversed: Uint8Array.from(rows, row => (row[side].reversed ? 1 : 0)),
    ownBp: Float64Array.from(rows, row => row[side].ownBp),
    missingBp: Float64Array.from(rows, row => row[side].missingBp),
  })
  return { before: table('before'), after: table('after') }
}

// What a walk with no step on the reference has past its ends: nothing
// known, so nothing is said of them
const UNSTATED: PathEnd = {
  kind: 'edge',
  pos: Number.NaN,
  reversed: false,
  ownBp: Number.NaN,
  missingBp: 0,
}

// The ends of `paths`, the reference's first, where a walk-file cut states
// them against `reference`
function pathEnds(paths: readonly GraphPath[], reference: string | undefined) {
  return reference !== undefined && paths[0]?.ends?.refName === reference
    ? foldEnds(
        paths.map(path =>
          path.ends?.refName === reference
            ? path.ends
            : { refName: reference, before: UNSTATED, after: UNSTATED },
        ),
      )
    : undefined
}

// The graph as graph-fold reads it: every node's length, and each walk record
// as the node names it steps, `-` ahead of a step it reads reversed, the
// reference's record first, what lies past each record's ends where a
// walk-file cut states it against that reference, and how many records step
// nothing here and are left out; or why it cannot be read so
export function threadFoldInput(graph: Graph) {
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  const reference = graph.referencePath ?? referenceWalkName(graph)
  const paths = graph.paths ?? []
  const walked = paths.filter(path => path.nodeIds.length > 0)
  const referenceAt = walked.findIndex(
    path => pathOrigin(path.name).name === reference,
  )
  const first = walked[referenceAt]
  const firstNode = first && byId.get(first.nodeIds[0]!)
  const steps = first ? recordSteps(graph, walked) : undefined
  const order = [
    referenceAt,
    ...walked.flatMap((_, i) => (i === referenceAt ? [] : [i])),
  ]
  return !first || !firstNode
    ? { reason: 'the graph has no reference walk' }
    : !steps
      ? { reason: 'the graph does not say which way its walks read each node' }
      : {
          nodes: graph.nodes.map(node => ({
            name: node.name,
            sequenceLength: node.length,
          })),
          tracks: order.map((i, at): ThreadTrack => ({
            name: walked[i]!.name,
            haplotype: haplotypeOf(walked[i]!.name),
            start: walked[i]!.start ?? 0,
            sequence: steps[i]!,
            ...(at === 0
              ? {
                  indexOfFirstBase: firstNode.stable?.start ?? first.start ?? 0,
                }
              : {}),
          })),
          refName: firstNode.stable?.refName ?? pathOrigin(first.name).name,
          referencePath: reference,
          ends: pathEnds(
            order.map(i => walked[i]!),
            reference,
          ),
          referenceRevisits: referenceRevisits(graph, reference),
          stepless: paths.length - walked.length,
        }
}

type FoldedThreads = Folded<ThreadWalk>

// Each folded track as a thread: its name, the start of its first record and
// the names of its walks, from the records the fold took (`tracks`, in its input order). A record whose haplotype contig
// has other records here is one piece of it, and its name says which, since
// two threads of one name would be lifted as two pieces of one walk; the
// reference's record keeps its own
function threadsOfFold(fold: FoldedThreads, tracks: readonly ThreadWalk[]) {
  const origins = tracks.map(track => pathOrigin(track.name).name)
  const records = new Map<string, number[]>()
  origins.forEach((origin, i) => {
    records.set(origin, [...(records.get(origin) ?? []), i])
  })
  const recordName = (i: number) => {
    const same = records.get(origins[i]!)!
    const piece =
      [...same]
        .sort((a, b) => tracks[a]!.start - tracks[b]!.start || a - b)
        .indexOf(i) + 1
    return i === 0 || same.length === 1
      ? tracks[i]!.name
      : `${origins[i]} piece ${piece}`
  }
  const onTrack = fold.tracks.map((): number[] => [])
  fold.walks.forEach((walk, i) => {
    onTrack[walk.track]?.push(i)
  })
  const piecesOf = new Map<string, number>()
  for (const { haplotype } of tracks) {
    piecesOf.set(haplotype, (piecesOf.get(haplotype) ?? 0) + 1)
  }
  return onTrack.map(held => {
    const first = held[0] ?? 0
    return {
      name: recordName(first),
      start: tracks[first]?.start ?? 0,
      members: [...new Set(held.map(i => tracks[i]!.name))],
      walks: held.length,
      pieces:
        held.length === 1 ? (piecesOf.get(tracks[first]!.haplotype) ?? 1) : 1,
    }
  })
}

// The threads in the order their lanes lie: the reference, then the rest from
// the one that walks the most of the folded nodes' bp to the one that walks
// the least, so a thread that skips a block lies under those that walk it and
// its link round the block crosses none of them
function laneOrder(fold: FoldedThreads) {
  const lengthOf = new Map(
    fold.nodes.map(node => [node.name, node.sequenceLength]),
  )
  const walked = fold.tracks.map(track =>
    track.sequence.reduce(
      (bp, step) =>
        bp + (lengthOf.get(step) ?? lengthOf.get(step.slice(1)) ?? 0),
      0,
    ),
  )
  return fold.tracks
    .map((_, t) => t)
    .sort(
      (a, b) =>
        Number(b === 0) - Number(a === 0) ||
        walked[b]! - walked[a]! ||
        fold.tracks[b]!.haplotypes - fold.tracks[a]!.haplotypes ||
        a - b,
    )
}

// The Graph of a fold of `tracks`: a node per folded node, the reference's
// placed on `refName` at their bp, a link per step two threads' consecutive
// nodes make, and a path per thread that counts its haplotypes, each once
// however many of its walks it holds
export function foldedGraph(
  fold: FoldedThreads,
  {
    name,
    refName,
    referencePath,
    tracks,
    stepless = 0,
    departing = [],
  }: {
    name: string
    refName: string
    referencePath?: string
    tracks: readonly ThreadWalk[]
    stepless?: number
    departing?: readonly string[]
  },
): Graph {
  const index = new Map(fold.nodes.map((node, i) => [node.name, i]))
  const threads = threadsOfFold(fold, tracks)
  const lanes = laneOrder(fold).map(t => ({
    track: fold.tracks[t]!,
    thread: threads[t]!,
  }))
  const steps: number[] = []
  const reversed: number[] = []
  const offsets = [0]
  const linked = new Map<string, number>()
  const linkWalks: number[] = []
  const from: number[] = []
  const to: number[] = []
  const strands: number[] = []
  const starts: number[] = []
  const ends: number[] = []
  for (const { track, thread } of lanes) {
    let bp = 0
    track.sequence.forEach((step, i) => {
      const back = step.startsWith('-') && !index.has(step)
      const node = index.get(back ? step.slice(1) : step)!
      if (i > 0) {
        const previous = steps.at(-1)!
        const strand = reversed.at(-1)! | (back ? 2 : 0)
        const key = linkKey(
          `${previous}`,
          strand & 1 ? '-' : '+',
          `${node}`,
          back ? '-' : '+',
        )
        const link = linked.get(key) ?? from.length
        if (link === from.length) {
          linked.set(key, link)
          from.push(previous)
          to.push(node)
          strands.push(strand)
          linkWalks.push(0)
        }
        linkWalks[link]! += thread.walks
      }
      steps.push(node)
      reversed.push(back ? 1 : 0)
      bp += fold.nodes[node]!.sequenceLength
    })
    offsets.push(steps.length)
    starts.push(thread.start)
    ends.push(thread.start + bp)
  }
  const tables: GraphTables = {
    nodes: {
      names: fold.nodes.map(node => node.name),
      lengths: Int32Array.from(fold.nodes, node => node.sequenceLength),
      refs: Int32Array.from(fold.nodes, node =>
        node.kind === 'reference' ? 0 : -1,
      ),
      starts: Float64Array.from(fold.nodes, node => node.refStart ?? 0),
      ranks: Int32Array.from(fold.nodes, node =>
        node.kind === 'reference' ? 0 : 1,
      ),
      refNames: [refName],
    },
    links: {
      from: Int32Array.from(from),
      to: Int32Array.from(to),
      strands: Uint8Array.from(strands),
    },
    walks: {
      names: lanes.map(({ thread }) => thread.name),
      starts: Float64Array.from(starts),
      ends: Float64Array.from(ends),
      offsets: Int32Array.from(offsets),
      steps: Int32Array.from(steps),
      reversed: Uint8Array.from(reversed),
    },
    departures: departureTable(),
    revisited: 0,
  }
  const graph = loadGraph(tables, name, { referencePath })
  const through = new Map<string, number>()
  const paths = (graph.paths ?? []).map((path, t): GraphPath => {
    const { track, thread } = lanes[t]!
    for (const id of path.nodeIds) {
      through.set(id, (through.get(id) ?? 0) + thread.walks)
    }
    return {
      ...path,
      count: track.haplotypes,
      members: thread.members,
      variation: variationLabel(track),
      ...(thread.pieces > 1 ? { pieces: thread.pieces } : {}),
    }
  })
  return {
    ...graph,
    nodes: graph.nodes.map(node => {
      const cluster = fold.nodes[index.get(node.name) ?? -1]?.cluster
      return {
        ...node,
        depth: through.get(node.id) ?? node.depth,
        members: fold.members[node.name] ?? [],
        ...(cluster
          ? {
              lengthSpan: {
                least: cluster.minLength,
                most: cluster.maxLength,
              },
            }
          : {}),
      }
    }),
    edges: graph.edges.map((edge, i) => ({
      ...edge,
      passes: linkWalks[i]!,
    })),
    paths,
    referencePath: graph.referencePath ?? referencePath,
    threadFold: {
      belowBp: fold.threshold,
      haplotypes: fold.haplotypes,
      walks: tracks.length,
      stepless,
      departing: [...new Set(departing)],
    },
  }
}

// What a fold kept, in graph-fold's words, for a caption or a hover and not for
// the graph: each event's text, where it lies on the reference, the haplotypes
// and the threads that carry it and the nodes it is drawn as or between
export interface ThreadEvent {
  text: string
  kind: Branch['kind']
  refStart: number
  refEnd: number
  haplotypes: number
  paths: string[]
  nodeIds: string[]
  from: string | undefined
  to: string | undefined
  // false where no node or link of the graph is the event, as for a walk
  // that ends inside the window
  anchored: boolean
  // only on a branch that continues past the window: where on the reference
  // its far breakpoint is, past refStart or refEnd, which stop at the window
  beyond?: number
}

// The fold's events over `graph`, foldedGraph's of the same fold of `tracks`
export function threadEvents(
  fold: FoldedThreads,
  tracks: readonly ThreadWalk[],
  graph: Pick<Graph, 'nodes'>,
): ThreadEvent[] {
  const idOf = new Map(graph.nodes.map(node => [node.name, node.id]))
  const threads = threadsOfFold(fold, tracks)
  return fold.branches.map(branch => ({
    text: branchLabel(branch, fold.haplotypes),
    kind: branch.kind,
    refStart: branch.refStart,
    refEnd: branch.refEnd,
    haplotypes: branch.haplotypes,
    paths: branch.tracks.flatMap(t => threads[t]?.name ?? []),
    nodeIds: branch.nodes.flatMap(n => idOf.get(n) ?? []),
    from: branch.from === undefined ? undefined : idOf.get(branch.from),
    to: branch.to === undefined ? undefined : idOf.get(branch.to),
    anchored: branch.anchored,
    ...(branch.beyond === undefined ? {} : { beyond: branch.beyond }),
  }))
}

export type ThreadFoldResult =
  | { folded: true; graph: Graph; events: ThreadEvent[]; walks: ThreadWalk[] }
  | { folded: false; graph: Graph; reason: string }

// `graph` with every difference between its walks under `belowBp` merged into
// the reference and its walks as threads, or `graph` itself and why not
export function foldThreads(
  graph: Graph,
  belowBp: number,
  { cluster = true }: { cluster?: boolean } = {},
): ThreadFoldResult {
  const unfolded = (reason: string): ThreadFoldResult => ({
    folded: false,
    graph,
    reason,
  })
  const input = belowBp > 0 ? threadFoldInput(graph) : undefined
  const read = input?.reason === undefined ? input : undefined
  const fold =
    read &&
    foldGraph(read.nodes, read.tracks, {
      threshold: belowBp,
      cluster,
      referenceRevisits: read.referenceRevisits,
      ends: read.ends,
    })
  const threads = (
    kept: FoldedThreads,
    { tracks, refName, referencePath, stepless }: NonNullable<typeof read>,
  ): ThreadFoldResult => {
    const folded = foldedGraph(kept, {
      name: graph.name,
      refName,
      referencePath,
      tracks,
      stepless,
      departing: graph.departures?.names,
    })
    return {
      folded: true,
      graph: folded,
      events: threadEvents(kept, tracks, folded),
      walks: tracks.map(({ name, haplotype, start }) => ({
        name,
        haplotype,
        start,
      })),
    }
  }
  return !input
    ? unfolded('nothing to fold')
    : !read || !fold
      ? unfolded(input.reason ?? 'nothing to fold')
      : fold.folded
        ? threads(fold, read)
        : unfolded(fold.reason)
}

// The threads a walk is on: the path of its name and each thread that holds
// one of its records, so a walk in pieces lights every thread its pieces took
export function threadsOf(graph: Pick<Graph, 'paths'>, walk: string) {
  const origin = pathOrigin(walk).name
  return (graph.paths ?? []).filter(
    path =>
      path.name === walk ||
      path.members?.some(member => pathOrigin(member).name === origin),
  )
}

// A host's picked walks as layers of a folded graph: each on its threads, a
// thread several picks share lifted once, in its first pick's colour, with
// every pick it holds as `picked`
export function threadLayers(
  graph: Pick<Graph, 'paths' | 'threadFold'>,
  layers: readonly WalkLayer[],
): WalkLayer[] {
  if (!graph.threadFold) {
    return [...layers]
  }
  const byThread = new Map<string, WalkLayer & { picked: string[] }>()
  const loose: WalkLayer[] = []
  for (const layer of layers) {
    const threads = threadsOf(graph, layer.walk)
    for (const thread of threads) {
      const held = byThread.get(thread.name)
      if (held) {
        held.picked.push(layer.walk)
      } else {
        byThread.set(thread.name, {
          ...layer,
          walk: thread.name,
          picked: [layer.walk],
        })
      }
    }
    if (threads.length === 0) {
      loose.push(layer)
    }
  }
  return [...byThread.values(), ...loose]
}

// The threads through a node, for a hover: what a key calls each, what its
// haplotypes differ by under the fold, and the line a hover writes for it,
// which opens on its count so a lone haplotype's name does not read as one of
// a wider thread's listed above it
export function threadsThrough(
  graph: Pick<Graph, 'paths'>,
  nodeId: string,
  labelOf: (name: string) => string = name => name,
) {
  return (graph.paths ?? [])
    .filter(path => path.count !== undefined && path.nodeIds.includes(nodeId))
    .map(path => {
      const label = threadLabel(path, labelOf(path.members?.[0] ?? path.name))
      const count = path.count ?? 1
      return {
        name: path.name,
        label,
        count,
        variation: path.variation,
        line: count > 1 ? (path.variation ?? label) : `1 haplotype: ${label}`,
      }
    })
}

// The events a node is drawn for, and those a link is: the step of the
// threads that leave out what lies between its two nodes
export const eventsAtNode = (events: readonly ThreadEvent[], nodeId: string) =>
  events.filter(event => event.nodeIds.includes(nodeId))

// The reference a branch that continues past the window stands in for, from
// its breakpoint inside the window to the far one past it
export const openBranchSpan = (
  events: readonly ThreadEvent[],
  nodeId: string,
) => {
  const open = eventsAtNode(events, nodeId).find(
    event => event.beyond !== undefined,
  )
  return open?.beyond === undefined
    ? undefined
    : {
        start: Math.min(open.refStart, open.beyond),
        end: Math.max(open.refEnd, open.beyond),
      }
}

export const eventsAtLink = (
  events: readonly ThreadEvent[],
  { from, to }: { from: string; to: string },
) =>
  events.filter(
    event =>
      event.nodeIds.length === 0 &&
      ((event.from === from && event.to === to) ||
        (event.from === to && event.to === from)),
  )
