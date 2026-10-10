import { panSNSample } from '../pansn'
import { PathVisits } from '../pathVisits'

import type {
  Graph,
  GraphEdge,
  GraphNode,
  GraphPath,
  PathOrigin,
} from '../types'

/**
 * A graph as typed arrays, the shape a worker can hand across postMessage
 * without copying: what a GFA of S lines tagged LN/SN/SO/SR, L lines and W
 * lines states, with every link end and walk step an index into the node
 * table. `graphFromTables` builds the Graph that converting that GFA builds,
 * and `graphTablesGFA` writes the GFA.
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
  }
}

function walkFields(panSN: string) {
  const [sample = '', haplotype = '', ...contig] = panSN.split('#')
  return { sample, haplotype, contig: contig.join('#') }
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
 * The Graph `convertGFAToGraph` builds from `graphTablesGFA(tables)`, deep
 * equal, built by index: a step costs a few array reads and its visit, where
 * the text costs a string and several map lookups.
 */
export function graphFromTables(
  { nodes: n, links: l, walks: w }: GraphTables,
  name = 'Imported GFA',
): Graph {
  const count = n.names.length
  const declared = n.lengths.length
  // a segment's one drawn orientation, first claimed by a link and else by a
  // walk: 0 unclaimed, 1 forward, 2 reversed
  const canonical = new Uint8Array(count)
  const claim = (node: number, reversed: number) => {
    if (canonical[node] === 0) {
      canonical[node] = reversed ? 2 : 1
    }
  }
  for (let i = 0; i < l.from.length; i++) {
    claim(l.from[i]!, l.strands[i]! & 1)
    claim(l.to[i]!, l.strands[i]! & 2)
  }
  const drawnWalks: number[] = []
  for (let p = 0; p < w.names.length; p++) {
    if (w.offsets[p + 1]! > w.offsets[p]!) {
      drawnWalks.push(p)
    }
  }
  const traversals = new Int32Array(count)
  for (const p of drawnWalks) {
    for (let s = w.offsets[p]!; s < w.offsets[p + 1]!; s++) {
      const node = w.steps[s]!
      if (traversals[node] === 0) {
        claim(node, w.reversed[s]!)
      }
      traversals[node]!++
    }
  }
  const ids = n.names.map(
    (segment, i) => `${segment}${canonical[i] === 2 ? '-' : '+'}`,
  )

  const nodes: GraphNode[] = []
  for (let i = 0; i < declared; i++) {
    const ref = n.refs[i]!
    nodes.push({
      id: ids[i]!,
      name: n.names[i]!,
      length: n.lengths[i]!,
      depth: Math.max(traversals[i]!, 1),
      stable:
        ref < 0
          ? undefined
          : {
              refName: n.refNames[ref]!,
              start: n.starts[i]!,
              rank: n.ranks[i]!,
            },
      samples: undefined,
    })
  }

  // Links between the same two segments, either way round, share one list of
  // the walks crossing them, kept per segment as [neighbour, list, ...]
  const edges: GraphEdge[] = []
  const neighbours: (number[] | undefined)[] = new Array(count)
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
    const a = l.from[i]!
    const b = l.to[i]!
    edges.push({
      from: ids[a]!,
      to: ids[b]!,
      fromStrand: l.strands[i]! & 1 ? '-' : '+',
      toStrand: l.strands[i]! & 2 ? '-' : '+',
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
  // a walk crosses at most a list per step
  const crossedList = new Int32Array(w.offsets[w.names.length] ?? 0)
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
  for (const p of drawnWalks) {
    const { sample, haplotype, contig } = walkFields(w.names[p]!)
    const pathName = `${sample}#${+haplotype}#${contig}`
    let named = nameIndex.get(pathName)
    if (named === undefined) {
      named = pathNames.length
      nameIndex.set(pathName, named)
      pathNames.push(pathName)
      pathSamples.push(panSNSample(pathName))
    }
    const start = w.starts[p]!
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
          crossedName[crossings++] = named
        }
      }
      prev = node
    }
    paths.push({
      name: pathName,
      nodeIds,
      start,
      sample,
      haplotype: +haplotype,
      contig,
    })
    anchorPaths.push({
      name: pathName,
      sample: visitSample,
      start,
      length: pos - start,
    })
  }
  const listNames = namesByList(
    crossedList.subarray(0, crossings),
    crossedName,
    lists,
    pathNames,
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
  }
}

/**
 * The tables as GFA text: S lines in table order, then L lines, then W lines
 */
export function graphTablesGFA({ nodes, links, walks }: GraphTables) {
  const { names } = nodes
  const lines = ['H\tVN:Z:1.1']
  for (let i = 0; i < nodes.lengths.length; i++) {
    const ref = nodes.refs[i]!
    const stable =
      ref < 0
        ? ''
        : `\tSN:Z:${nodes.refNames[ref]}\tSO:i:${nodes.starts[i]}\tSR:i:${nodes.ranks[i]}`
    lines.push(`S\t${names[i]}\t*\tLN:i:${nodes.lengths[i]}${stable}`)
  }
  for (let i = 0; i < links.from.length; i++) {
    const strands = links.strands[i]!
    lines.push(
      `L\t${names[links.from[i]!]}\t${strands & 1 ? '-' : '+'}\t${names[links.to[i]!]}\t${strands & 2 ? '-' : '+'}\t0M`,
    )
  }
  for (let p = 0; p < walks.names.length; p++) {
    const { sample, haplotype, contig } = walkFields(walks.names[p]!)
    let body = ''
    for (let s = walks.offsets[p]!; s < walks.offsets[p + 1]!; s++) {
      body += (walks.reversed[s] ? '<' : '>') + names[walks.steps[s]!]
    }
    lines.push(
      `W\t${sample}\t${haplotype}\t${contig}\t${walks.starts[p]}\t${walks.ends[p]}\t${body}`,
    )
  }
  return lines.join('\n')
}
