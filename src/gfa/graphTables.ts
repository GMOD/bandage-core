import { panSNSample } from '../pansn'

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

  // Each list holds a walk's name once, in the order walks first cross it.
  // Fragments of one haplotype share a name, so only a name's later fragments
  // need to look for it.
  const nameIndex = new Map<string, number>()
  const pathNames: string[] = []
  const crossing: number[][] = Array.from({ length: lists }, () => [])
  const lastWalk = new Int32Array(lists).fill(-1)
  const paths: GraphPath[] = []
  const anchorPaths: PathOrigin[] = []
  const visits: (PathVisit[] | undefined)[] = new Array(count)
  const visitOrder: number[] = []
  for (const p of drawnWalks) {
    const { sample, haplotype, contig } = walkFields(w.names[p]!)
    const pathName = `${sample}#${+haplotype}#${contig}`
    let named = nameIndex.get(pathName)
    const repeat = named !== undefined
    if (named === undefined) {
      named = pathNames.length
      nameIndex.set(pathName, named)
      pathNames.push(pathName)
    }
    const start = w.starts[p]!
    const visitSample = panSNSample(pathName)
    const nodeIds: string[] = []
    let pos = start
    let prev = -1
    for (let s = w.offsets[p]!; s < w.offsets[p + 1]!; s++) {
      const node = w.steps[s]!
      nodeIds.push(ids[node]!)
      const visit: PathVisit = {
        path: pathName,
        sample: visitSample,
        start: pos,
        strand: w.reversed[s] ? '-' : '+',
      }
      const seen = visits[node]
      if (seen) {
        seen.push(visit)
      } else {
        visits[node] = [visit]
        visitOrder.push(node)
      }
      pos += node < declared ? n.lengths[node]! : 0
      if (prev >= 0) {
        const list = pairList(prev, node)
        if (list !== undefined && lastWalk[list] !== p) {
          lastWalk[list] = p
          const names = crossing[list]!
          if (!repeat || !names.includes(named)) {
            names.push(named)
          }
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
  edges.forEach((edge, i) => {
    const names = crossing[edgeLists[i]!]!
    if (names.length > 0) {
      edge.pathIds = names.map(k => pathNames[k]!)
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
      ? new Map(visitOrder.map(node => [n.names[node]!, visits[node]!]))
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
