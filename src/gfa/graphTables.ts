import { REFERENCE_RANK } from '../anchoredNodes'
import { panSNFields, panSNSample } from '../pansn'
import { pathOrigin } from '../pathAnchoring'
import { PathVisits } from '../pathVisits'
import { ownStepRuns, stretchSegments } from './departures'
import { linkKey } from './linkKey'
import {
  FORWARD,
  REVERSED,
  orientSegments,
  respelled,
  respelledStrands,
} from './segmentOrientation'

import type {
  Graph,
  GraphEdge,
  GraphNode,
  GraphPath,
  PathOrigin,
  PathVisit,
} from '../types'

/**
 * A graph as typed arrays, the shape a worker can hand across postMessage
 * without copying: what a GFA of S lines tagged LN/SN/SO/SR, L lines and W
 * lines states, with every link end and walk step an index into the node
 * table, and the departures from the reference over the cut, which no GFA
 * line states. `graphFromTables` builds the Graph that converting that GFA
 * builds, and `graphTablesGFA` writes the GFA.
 *
 * @jbrowse/graph-walks 7's `WalkGraph.tables` returns this shape, which
 * typecheck/graphWalks.ts holds equal to its `GraphTables`. `departures` is
 * required, so tables from a reader that states none fail to compile rather
 * than draw no departure; a source with none passes `departureTable()`.
 */
export interface GraphTables {
  nodes: {
    // Names past `lengths.length` belong to segments a link or walk names and
    // no S line declares: they have no node, as in a GFA.
    names: string[]
    lengths: Int32Array
    // where each segment sits, SN as an index into `refNames`, -1 for none
    refs: Int32Array
    starts: Float64Array
    ranks: Int32Array
    refNames: string[]
    // how many times the reference's paths pass each node, 0 for a node
    // placed off the reference; absent from tables another source builds
    passes?: Int32Array
    placeholders?: Uint8Array
  }
  links: {
    from: Int32Array
    to: Int32Array
    // 1 when the link leaves `from` reversed, 2 when it enters `to` reversed
    strands: Uint8Array
  }
  walks: {
    // sample#haplotype#contig
    names: string[]
    starts: Float64Array
    ends: Float64Array
    // walk i is steps offsets[i] up to offsets[i + 1]
    offsets: Int32Array
    steps: Int32Array
    reversed: Uint8Array
    // where each step lies on the reference, at the pass its row names of a
    // node the reference passes more than once, NaN for a step off it; absent
    // from tables another source builds, which state no pass
    refStarts?: Float64Array
    // bp of each walk a walk-file cut read but kept out, before and after it;
    // absent where the source states none, so a walk's ends say nothing
    trimmedBefore?: Float64Array
    trimmedAfter?: Float64Array
    // the steps of a walk's pieces the cut did not load, each piece on the
    // first walk holding it; NaN for a walk with none
    abridgedSteps?: Float64Array
  }
  // every departure from the reference over the cut, each once
  departures: DepartureTable
  // how many nodes the reference's paths pass more than once, the walk file
  // header's `revisited`, NaN where the source cannot state it: above 0, a
  // run off the reference may be a copy of sequence it passes elsewhere
  revisited: number
  // what lies between each walk's fragments, past its ends and in its
  // departures outside them, as graph-walks' ADR 0001 states it; absent from
  // tables another source builds
  gaps?: GapTable
}

// The reference walk's name, stripped of the range suffix odgi leaves on a P
// record's name: `referencePath`, else the walk a rank 0 segment's tag names,
// else the first walk, where gbz-base and walk-file cuts write it
export function referenceOf(
  names: string[],
  referencePath: string | undefined,
  rankZero: Set<string>,
) {
  return referencePath !== undefined && names.includes(referencePath)
    ? referencePath
    : (names.find(n => rankZero.has(n)) ?? names[0])
}

// How many segments the reference's walks pass more than once, as a walk
// file's header counts them, of a graph whole: its reference is the one
// `referenceOf` picks with no `referencePath`. NaN with no walk to be it.
export function revisitedCount<T>(
  walks: { name: string; segments: Iterable<T> }[],
  rankZero: Set<string>,
) {
  const names = walks.map(w => pathOrigin(w.name).name)
  const reference = referenceOf(names, undefined, rankZero)
  const passes = new Map<T, number>()
  let revisited = 0
  walks.forEach((w, p) => {
    if (names[p] === reference) {
      for (const segment of w.segments) {
        const n = (passes.get(segment) ?? 0) + 1
        passes.set(segment, n)
        if (n === 2) {
          revisited++
        }
      }
    }
  })
  return reference === undefined ? Number.NaN : revisited
}

// A stretch of a walk's contig per row: `walks` the walk the stretch follows,
// or precedes for a row's start, -1 for a departure outside the row; `edges`
// 0 between two fragments, 1 a row's start, 2 its end, 3 a departure outside
// it; its segments at `segmentOffsets[g]` up to `segmentOffsets[g + 1]`, each
// of a GAP_KINDS kind, a `steps` segment's steps as node indices at
// `stepOffsets[k]` up to `stepOffsets[k + 1]`
export interface GapTable {
  names: string[]
  walks: Int32Array
  edges: Uint8Array
  starts: Float64Array
  ends: Float64Array
  segmentOffsets: Int32Array
  segments: {
    kinds: Uint8Array
    bp: Float64Array
    missingBp: Float64Array
    before: Float64Array
    after: Float64Array
    stepOffsets: Int32Array
    steps: Int32Array
    reversed: Uint8Array
  }
}

// A Departure per row (gfa/departures.ts), each strand and `fromSteps` 1 for
// true, its own steps the cut holds as node indices at `offsets[k]` to
// `offsets[k + 1]` of `steps`, and `abridgedSteps` the steps of the pieces
// not loaded among them that no walk counts, NaN where none
export interface DepartureTable {
  names: string[]
  hapStarts: Float64Array
  ownBp: Float64Array
  missingBp: Float64Array
  leavePos: Float64Array
  leaveReversed: Uint8Array
  leavePasses: Int32Array
  rejoinPos: Float64Array
  rejoinReversed: Uint8Array
  rejoinPasses: Int32Array
  fromSteps: Uint8Array
  offsets: Int32Array
  steps: Int32Array
  reversed: Uint8Array
  abridgedSteps?: Float64Array
  // how many of a departure's steps follow its leave step before they break,
  // -1 where they run unbroken from the leave step to the rejoin step
  breakAt?: Int32Array
}

export const NOT_LOADED_TAG = 'nl:i:1'

// A P line states a walk's start only as a range on its name
function pLineName(name: string, start: number, end: number) {
  return start === 0 ? name : `${name}:${start}-${end}`
}

/** The GraphPath `graphFromTables` builds of walk `p`, less its steps */
export function tablePath(
  w: GraphTables['walks'],
  p: number,
): Omit<GraphPath, 'nodeIds'> & { start: number } {
  const walkName = w.names[p]!
  const fields = panSNFields(walkName)
  const start = w.starts[p]!
  const steps = w.abridgedSteps?.[p] ?? Number.NaN
  const abridged = Number.isNaN(steps) ? {} : { abridgedSteps: steps }
  const trimmedBefore = w.trimmedBefore?.[p]
  const trimmedAfter = w.trimmedAfter?.[p]
  return fields
    ? {
        name: `${fields.sample}#${fields.haplotype}#${fields.contig}`,
        start,
        ...fields,
        ...(trimmedBefore === undefined ? {} : { trimmedBefore }),
        ...(trimmedAfter === undefined ? {} : { trimmedAfter }),
        ...abridged,
      }
    : { name: pLineName(walkName, start, w.ends[p]!), start }
}

// Each list's names, in the order the crossings came, each once
function namesByList(
  lists: Int32Array,
  names: Int32Array,
  listCount: number,
  pathNames: string[],
) {
  const starts = new Int32Array(listCount + 1)
  for (const list of lists) {
    starts[list + 1]!++
  }
  for (let i = 0; i < listCount; i++) {
    starts[i + 1]! += starts[i]!
  }
  const fill = starts.slice(0, listCount)
  const grouped = new Int32Array(lists.length)
  lists.forEach((list, i) => {
    grouped[fill[list]!++] = names[i]!
  })
  const listed = new Int32Array(pathNames.length).fill(-1)
  return Array.from({ length: listCount }, (_, list) => {
    const out: string[] = []
    for (let i = starts[list]!; i < starts[list + 1]!; i++) {
      const k = grouped[i]!
      if (listed[k] !== list) {
        listed[k] = list
        out.push(pathNames[k]!)
      }
    }
    return out
  })
}

/**
 * Each segment's drawn orientation (segmentOrientation.ts), as
 * `convertGFAToGraph` orients it. Counts each segment's walk steps into
 * `traversals` when given one.
 */
function tableOrientation(
  {
    nodes: n,
    links: l,
    walks: w,
  }: Omit<GraphTables, 'departures' | 'revisited'>,
  traversals?: Int32Array,
) {
  const referenceReversals = new Int32Array(n.names.length)
  for (let p = 0; p < w.names.length; p++) {
    const ref = n.refNames.indexOf(pathOrigin(w.names[p]!).name)
    if (ref >= 0) {
      for (let s = w.offsets[p]!; s < w.offsets[p + 1]!; s++) {
        const node = w.steps[s]!
        if (n.refs[node] === ref) {
          referenceReversals[node]! += w.reversed[s] ? 1 : -1
        }
      }
    }
  }
  const backbone = new Uint8Array(n.names.length)
  for (let i = 0; i < n.lengths.length; i++) {
    backbone[i] =
      n.refs[i]! >= 0 && n.ranks[i] === REFERENCE_RANK
        ? referenceReversals[i]! > 0
          ? REVERSED
          : FORWARD
        : 0
  }
  const reversals = new Int32Array(n.names.length)
  const stepCount = w.offsets[w.names.length] ?? 0
  for (let s = 0; s < stepCount; s++) {
    const node = w.steps[s]!
    reversals[node]! += w.reversed[s] ? 1 : -1
    if (traversals) {
      traversals[node]!++
    }
  }
  return orientSegments(n.names, backbone, l, reversals)
}

// The links with each one's first statement only, either way round, as
// convertGFAToGraph keeps them (linkKey.ts)
function distinctLinks(l: GraphTables['links']) {
  const linked = new Set<string>()
  const kept: number[] = []
  for (let i = 0; i < l.from.length; i++) {
    const strands = l.strands[i]!
    const key = linkKey(
      `${l.from[i]}`,
      strands & 1 ? '-' : '+',
      `${l.to[i]}`,
      strands & 2 ? '-' : '+',
    )
    if (!linked.has(key)) {
      linked.add(key)
      kept.push(i)
    }
  }
  return kept.length === l.from.length
    ? l
    : {
        from: Int32Array.from(kept, i => l.from[i]!),
        to: Int32Array.from(kept, i => l.to[i]!),
        strands: Uint8Array.from(kept, i => l.strands[i]!),
      }
}

const nodeIdsOf = (names: string[], orient: Uint8Array) =>
  names.map((segment, i) => `${segment}${orient[i] === REVERSED ? '-' : '+'}`)

/**
 * Each segment's Graph node id: its name and its one drawn orientation.
 */
export function tableNodeIds(
  tables: Omit<GraphTables, 'departures' | 'revisited'>,
) {
  return nodeIdsOf(
    tables.nodes.names,
    tableOrientation({ ...tables, links: distinctLinks(tables.links) }),
  )
}

/**
 * The Graph `convertGFAToGraph` builds from `graphTablesGFA(tables)`, deep
 * equal, built by index: a step costs a few array reads and its visit, where
 * the text costs a string and several map lookups. GFA has no line for a
 * departure, a trimmed walk's bp or the source's count of nodes the reference
 * passes more than once, so only this Graph keeps the tables' `departures`,
 * each walk's trimmed bp and `revisited`, and counts into node depth, as each
 * node's `departureVisits`, and into the walks on links each walk's
 * departures' own steps no fragment of it holds (departures.ts ownStepRuns);
 * the text counts its own walks.
 */
export function graphFromTables(
  { nodes: n, links, walks: w, departures, revisited, gaps }: GraphTables,
  name = 'Imported GFA',
): Graph {
  const l = distinctLinks(links)
  const count = n.names.length
  const declared = n.lengths.length
  const drawnWalks: number[] = []
  for (let p = 0; p < w.names.length; p++) {
    if (w.offsets[p + 1]! > w.offsets[p]!) {
      drawnWalks.push(p)
    }
  }
  const traversals = new Int32Array(count)
  const orient = tableOrientation({ nodes: n, links: l, walks: w }, traversals)
  const ids = nodeIdsOf(n.names, orient)
  const departed = ownStepRuns({ nodes: n, walks: w, departures })
  const departureVisits = new Array<PathVisit[] | undefined>(count)
  let departedSteps = 0
  for (const { walk, steps, held, starts, reversed } of departed) {
    const path = tablePath(w, walk).name
    const sample = panSNSample(path)
    steps.forEach((node, i) => {
      if (!held[i]) {
        const visit: PathVisit = {
          path,
          sample,
          start: starts[i]!,
          strand: reversed[i] ? '-' : '+',
        }
        const visits = departureVisits[node]
        if (visits) {
          visits.push(visit)
        } else {
          departureVisits[node] = [visit]
        }
      }
    })
    departedSteps += steps.length
  }

  const nodes: GraphNode[] = []
  for (let i = 0; i < declared; i++) {
    const ref = n.refs[i]!
    const visits = departureVisits[i]
    nodes.push({
      id: ids[i]!,
      name: n.names[i]!,
      length: n.lengths[i]!,
      depth: Math.max(traversals[i]! + (visits?.length ?? 0), 1),
      stable:
        ref < 0
          ? undefined
          : {
              refName: n.refNames[ref]!,
              start: n.starts[i]!,
              rank: n.ranks[i]!,
            },
      samples: undefined,
      ...(n.placeholders?.[i] === 1 ? { placeholder: true as const } : {}),
      ...(visits ? { departureVisits: visits } : {}),
    })
  }

  // Links between the same two segments, either way round, share one list of
  // the walks crossing them, kept per segment as [neighbour, list, ...]
  const edges: GraphEdge[] = []
  const neighbours = new Array<number[] | undefined>(count)
  const pairList = (a: number, b: number) => {
    const near = neighbours[a]
    if (near) {
      for (let j = 0; j < near.length; j += 2) {
        if (near[j] === b) {
          return near[j + 1]
        }
      }
    }
    return undefined
  }
  const addPair = (a: number, b: number, list: number) => {
    const near = neighbours[a]
    if (near) {
      near.push(b, list)
    } else {
      neighbours[a] = [b, list]
    }
  }
  const edgeLists: number[] = []
  let lists = 0
  for (let i = 0; i < l.from.length; i++) {
    const flip = respelled(n.names, orient, l, i)
    const a = flip ? l.to[i]! : l.from[i]!
    const b = flip ? l.from[i]! : l.to[i]!
    const strands = flip ? respelledStrands(l.strands[i]!) : l.strands[i]!
    edges.push({
      from: ids[a]!,
      to: ids[b]!,
      fromStrand: strands & 1 ? '-' : '+',
      toStrand: strands & 2 ? '-' : '+',
    })
    let list = pairList(a, b)
    if (list === undefined) {
      list = lists++
      addPair(a, b, list)
      addPair(b, a, list)
    }
    edgeLists.push(list)
  }
  // the same, flattened for the walk steps to look up
  const adjacency = new Int32Array(count + 1)
  for (let a = 0; a < count; a++) {
    adjacency[a + 1] = adjacency[a]! + (neighbours[a]?.length ?? 0) / 2
  }
  const adjacentNode = new Int32Array(adjacency[count]!)
  const adjacentList = new Int32Array(adjacency[count]!)
  neighbours.forEach((near, a) => {
    for (let j = 0; j < near!.length; j += 2) {
      adjacentNode[adjacency[a]! + j / 2] = near![j]!
      adjacentList[adjacency[a]! + j / 2] = near![j + 1]!
    }
  })
  const listOf = (a: number, b: number) => {
    for (let j = adjacency[a]!; j < adjacency[a + 1]!; j++) {
      if (adjacentNode[j] === b) {
        return adjacentList[j]!
      }
    }
    return -1
  }

  // Each list holds a walk's name once, in the order walks first cross it.
  // A crossing is recorded flat, a fragment of a haplotype naming it again,
  // and grouped by list with repeats dropped once at the end: an array per
  // list grown at each crossing, searched for the name, was most of AMY1's
  // load, 1,816 fragments of 233 samples.
  const nameIndex = new Map<string, number>()
  const pathNames: string[] = []
  // a walk or a departure's run crosses at most a list per step
  const crossedList = new Int32Array(
    (w.offsets[w.names.length] ?? 0) + departedSteps,
  )
  const crossedName = new Int32Array(crossedList.length)
  let crossings = 0
  const lastWalk = new Int32Array(lists).fill(-1)
  const paths: GraphPath[] = []
  const anchorPaths: PathOrigin[] = []
  // each segment's visits, a block sized by its traversals that is placed at
  // its first visit and filled in walk order
  const totalSteps = w.offsets[w.names.length] ?? 0
  const visitPath = new Int32Array(totalSteps)
  const visitStart = new Float64Array(totalSteps)
  const visitReversed = new Uint8Array(totalSteps)
  const fill = new Int32Array(count).fill(-1)
  const visitOrder: number[] = []
  const blocks = [0]
  const pathSamples: string[] = []
  // a P line's name carries its range, which the visits drop as pathOrigin does
  const edgeNameIndex = new Map<string, number>()
  const edgeNames: string[] = []
  for (const p of drawnWalks) {
    const head = tablePath(w, p)
    const { start, name: pathName } = head
    const visitName = head.sample === undefined ? w.names[p]! : pathName
    let named = nameIndex.get(visitName)
    if (named === undefined) {
      named = pathNames.length
      nameIndex.set(visitName, named)
      pathNames.push(visitName)
      pathSamples.push(panSNSample(visitName))
    }
    let edgeNamed = edgeNameIndex.get(pathName)
    if (edgeNamed === undefined) {
      edgeNamed = edgeNames.length
      edgeNameIndex.set(pathName, edgeNamed)
      edgeNames.push(pathName)
    }
    const visitSample = pathSamples[named]!
    const first = w.offsets[p]!
    const nodeIds = new Array<string>(w.offsets[p + 1]! - first)
    let pos = start
    let prev = -1
    for (let s = first; s < w.offsets[p + 1]!; s++) {
      const node = w.steps[s]!
      nodeIds[s - first] = ids[node]!
      if (fill[node] === -1) {
        fill[node] = blocks.at(-1)!
        blocks.push(fill[node] + traversals[node]!)
        visitOrder.push(node)
      }
      const at = fill[node]!++
      visitPath[at] = named
      visitStart[at] = pos
      visitReversed[at] = w.reversed[s]!
      pos += node < declared ? n.lengths[node]! : 0
      if (prev >= 0) {
        const list = listOf(prev, node)
        if (list >= 0 && lastWalk[list] !== p) {
          lastWalk[list] = p
          crossedList[crossings] = list
          crossedName[crossings++] = edgeNamed
        }
      }
      prev = node
    }
    const refStarts = w.refStarts?.subarray(first, w.offsets[p + 1])
    paths.push({ ...head, nodeIds, ...(refStarts ? { refStarts } : {}) })
    anchorPaths.push({
      name: visitName,
      sample: visitSample,
      start,
      length: pos - start,
    })
  }
  for (const { walk, steps, held } of departed) {
    const edgeNamed = edgeNameIndex.get(tablePath(w, walk).name)!
    for (let i = 1; i < steps.length; i++) {
      const list =
        held[i - 1] && held[i] ? -1 : listOf(steps[i - 1]!, steps[i]!)
      if (list >= 0) {
        crossedList[crossings] = list
        crossedName[crossings++] = edgeNamed
      }
    }
  }
  const listNames = namesByList(
    crossedList.subarray(0, crossings),
    crossedName,
    lists,
    edgeNames,
  )
  edges.forEach((edge, i) => {
    const names = listNames[edgeLists[i]!]!
    if (names.length > 0) {
      edge.pathIds = names
    }
  })

  const walked = drawnWalks.length > 0
  return {
    name,
    nodes,
    edges,
    paths: walked ? paths : undefined,
    anchorPaths: walked ? anchorPaths : undefined,
    pathVisits: walked
      ? new PathVisits({
          segments: visitOrder.map(node => n.names[node]!),
          offsets: Int32Array.from(blocks),
          path: visitPath.subarray(0, blocks.at(-1)),
          start: visitStart.subarray(0, blocks.at(-1)),
          reversed: visitReversed.subarray(0, blocks.at(-1)),
          paths: pathNames,
          samples: pathSamples,
        })
      : undefined,
    anchoredBy: nodes.some(node => node.stable) ? 'tags' : undefined,
    revisited,
    ...(departures.names.length > 0 ? { departures } : {}),
    ...(gaps && gaps.names.length > 0 ? { gaps: graphGaps(gaps, ids) } : {}),
  }
}

function graphGaps(t: GapTable, ids: ArrayLike<string>) {
  return t.names.map((name, g) => ({
    name,
    edge: t.edges[g]!,
    start: t.starts[g]!,
    end: t.ends[g]!,
    segments: stretchSegments(t, g, i => ids[i]!),
  }))
}

/**
 * The tables as GFA text: S lines in table order, a placeholder's tagged
 * `nl:i:1`, then L lines, then a W line per walk, or a P line for a walk
 * whose name has fewer than three PanSN parts
 */
export function graphTablesGFA({
  nodes,
  links,
  walks,
}: Pick<GraphTables, 'nodes' | 'links' | 'walks'>) {
  const { names } = nodes
  const lines = ['H\tVN:Z:1.1']
  for (let i = 0; i < nodes.lengths.length; i++) {
    const ref = nodes.refs[i]!
    const stable =
      ref < 0
        ? ''
        : `\tSN:Z:${nodes.refNames[ref]}\tSO:i:${nodes.starts[i]}\tSR:i:${nodes.ranks[i]}`
    const placeholder =
      nodes.placeholders?.[i] === 1 ? `\t${NOT_LOADED_TAG}` : ''
    lines.push(
      `S\t${names[i]}\t*\tLN:i:${nodes.lengths[i]}${stable}${placeholder}`,
    )
  }
  for (let i = 0; i < links.from.length; i++) {
    const strands = links.strands[i]!
    lines.push(
      `L\t${names[links.from[i]!]}\t${strands & 1 ? '-' : '+'}\t${names[links.to[i]!]}\t${strands & 2 ? '-' : '+'}\t0M`,
    )
  }
  for (let p = 0; p < walks.names.length; p++) {
    const name = walks.names[p]!
    const fields = panSNFields(name)
    const start = walks.starts[p]!
    const end = walks.ends[p]!
    const steps = []
    for (let s = walks.offsets[p]!; s < walks.offsets[p + 1]!; s++) {
      steps.push([names[walks.steps[s]!]!, walks.reversed[s]] as const)
    }
    lines.push(
      fields
        ? `W\t${fields.sample}\t${fields.haplotype}\t${fields.contig}\t${start}\t${end}\t${steps.map(([id, rev]) => (rev ? '<' : '>') + id).join('')}`
        : `P\t${pLineName(name, start, end)}\t${steps.map(([id, rev]) => id + (rev ? '-' : '+')).join(',')}\t*`,
    )
  }
  return lines.join('\n')
}
