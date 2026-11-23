import { isBackbone, readsAsReference } from '../anchoredNodes'

import type { AnchoredNode } from '../anchoredNodes'
import type { Graph, GraphNode } from '../types'

// A replacement's allele as a force layout pads it. An allele whose own
// sequence is far shorter than the reference it replaces, 13 bp in place of
// 13 kb, is a bubble whose own arm the engine draws as a speck, and the
// reference's arm closes on that speck as a loop, the drawing of an
// insertion. A bare link in place of the arm, a deletion, already runs
// through a route node half as long as what it skips (deletionRoutes.ts).
// The same device carries on from 0 bp: an allele of its own bp under half
// the reference it replaces runs each of its two links to the reference
// through a route node, which pad the arm to half that reference, and the
// links are drawn dashed along them, the allele's nodes at their own length
// between.
export const PADDED_SHARE = 0.5

export interface PaddedFoot {
  edgeIndex: number
  from: string
  to: string
  fromStrand?: '+' | '-'
  toStrand?: '+' | '-'
  // the reference bp between the allele's two attachments
  replacedBp: number
  // the allele's nodes and their bp
  nodes: string[]
  ownBp: number
}

const onReference = (node: GraphNode | undefined): node is AnchoredNode =>
  !!node && isBackbone(node) && !node.placeholder

// Where a link leaves or arrives at a reference node, on the reference
const attachment = (
  node: AnchoredNode,
  strand: '+' | '-' | undefined,
  leaving: boolean,
) =>
  node.stable.start +
  (readsAsReference(node, strand) === leaving ? node.length : 0)

// The links of every allele to pad. Where the graph has walks, an allele is
// a walk's run of steps off the reference between two steps on it, none a
// placeholder, padded where its own bp is under PADDED_SHARE of the reference
// between those two reference nodes. A link of the run that another run
// takes, one not padded or one replacing less, is not padded, so no walk's
// arm is drawn longer than the reference it replaces: the run is padded on its
// first and last links that only such runs take, on its links to the
// reference where it shares neither. Without walks an allele is a set of
// nodes off the reference joined by links among themselves with exactly two
// links to it, both on one sequence, and those two are padded.
export function paddedFeet(graph: Graph): PaddedFoot[] {
  return graph.paths?.length ? walkedFeet(graph) : componentFeet(graph)
}

const footOf = (
  graph: Graph,
  edgeIndex: number,
  replacedBp: number,
  nodes: string[],
  ownBp: number,
): PaddedFoot => {
  const edge = graph.edges[edgeIndex]!
  return {
    edgeIndex,
    from: edge.from,
    to: edge.to,
    ...(edge.fromStrand ? { fromStrand: edge.fromStrand } : {}),
    ...(edge.toStrand ? { toStrand: edge.toStrand } : {}),
    replacedBp,
    nodes,
    ownBp,
  }
}

// the reference bp lying between two reference nodes
const between = (a: AnchoredNode, b: AnchoredNode) =>
  Math.max(
    0,
    Math.max(a.stable.start, b.stable.start) -
      Math.min(a.stable.start + a.length, b.stable.start + b.length),
  )

function walkedFeet(graph: Graph) {
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const linkAt = new Map<string, number>()
  graph.edges.forEach(({ from, to }, edgeIndex) => {
    linkAt.set(`${from}\t${to}`, edgeIndex)
    linkAt.set(`${to}\t${from}`, edgeIndex)
  })
  const runs: {
    replacedBp: number
    nodes: string[]
    ownBp: number
    links: number[]
  }[] = []
  // the least reference a padded run through each link replaces, 0 where a
  // run not padded takes it
  const replacing = new Map<number, number>()
  const takes = (links: readonly number[], replacedBp: number) => {
    for (const link of links) {
      replacing.set(
        link,
        Math.min(replacing.get(link) ?? Infinity, replacedBp),
      )
    }
  }
  for (const { nodeIds } of graph.paths ?? []) {
    let last = -1
    let from = 0
    const close = (to: number, rejoin: AnchoredNode | undefined) => {
      const steps = nodeIds.slice(from, rejoin ? to + 1 : to)
      const links = steps.flatMap((id, i) => {
        const link = i > 0 ? linkAt.get(`${steps[i - 1]}\t${id}`) : undefined
        return link === undefined ? [] : [link]
      })
      const own = nodeIds.slice(last + 1, to)
      const leave =
        last >= 0 ? (byId.get(nodeIds[last]!) as AnchoredNode) : undefined
      const held =
        !!leave &&
        !!rejoin &&
        own.length > 0 &&
        own.every(id => !byId.get(id)?.placeholder) &&
        leave.stable.refName === rejoin.stable.refName
      const ownBp = own.reduce((sum, id) => sum + (byId.get(id)?.length ?? 0), 0)
      const replacedBp = held ? between(leave, rejoin) : 0
      const padded = held && ownBp < replacedBp * PADDED_SHARE
      takes(links, padded ? replacedBp : 0)
      if (padded) {
        runs.push({ replacedBp, nodes: [...new Set(own)], ownBp, links })
      }
    }
    for (let i = 0; i < nodeIds.length; i++) {
      const node = byId.get(nodeIds[i]!)
      if (onReference(node)) {
        if (i > last + 1) {
          from = Math.max(last, 0)
          close(i, node)
        }
        last = i
      }
    }
    if (last < nodeIds.length - 1) {
      from = Math.max(last, 0)
      close(nodeIds.length, undefined)
    }
  }
  const feet = new Map<number, PaddedFoot>()
  for (const { replacedBp, nodes, ownBp, links } of runs) {
    const own = links.filter(link => replacing.get(link)! >= replacedBp)
    const ends =
      own.length > 0 ? [own[0]!, own.at(-1)!] : [links[0]!, links.at(-1)!]
    for (const link of new Set(ends)) {
      if (own.includes(link) && !feet.has(link)) {
        feet.set(link, footOf(graph, link, replacedBp, nodes, ownBp))
      }
    }
  }
  return [...feet.values()].sort((a, b) => a.edgeIndex - b.edgeIndex)
}

function componentFeet(graph: Graph): PaddedFoot[] {
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const parent = new Map<string, string>()
  for (const node of graph.nodes) {
    if (!isBackbone(node)) {
      parent.set(node.id, node.id)
    }
  }
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) {
      root = parent.get(root)!
    }
    parent.set(id, root)
    return root
  }
  for (const { from, to } of graph.edges) {
    if (parent.has(from) && parent.has(to)) {
      parent.set(find(from), find(to))
    }
  }
  const components = new Map<
    string,
    { nodes: string[]; feet: number[]; held: boolean }
  >()
  for (const id of parent.keys()) {
    const root = find(id)
    const component = components.get(root) ?? {
      nodes: [],
      feet: [],
      held: true,
    }
    components.set(root, component)
    component.nodes.push(id)
    component.held &&= !byId.get(id)!.placeholder
  }
  graph.edges.forEach(({ from, to }, edgeIndex) => {
    const inside = parent.has(from) ? from : parent.has(to) ? to : undefined
    const outside = inside === from ? to : from
    if (inside !== undefined && !parent.has(outside)) {
      const component = components.get(find(inside))!
      component.feet.push(edgeIndex)
      component.held &&= onReference(byId.get(outside))
    }
  })
  return [...components.values()].flatMap(({ nodes, feet, held }) => {
    const ends = feet.map(edgeIndex => {
      const edge = graph.edges[edgeIndex]!
      const leaving = !parent.has(edge.from)
      const node = byId.get(leaving ? edge.from : edge.to) as AnchoredNode
      return {
        edgeIndex,
        refName: node.stable.refName,
        at: attachment(
          node,
          leaving ? edge.fromStrand : edge.toStrand,
          leaving,
        ),
      }
    })
    const ownBp = nodes.reduce((sum, id) => sum + byId.get(id)!.length, 0)
    const replacedBp =
      ends.length === 2 ? Math.abs(ends[0]!.at - ends[1]!.at) : 0
    return held &&
      ends.length === 2 &&
      ends[0]!.refName === ends[1]!.refName &&
      ownBp < replacedBp * PADDED_SHARE
      ? ends.map(({ edgeIndex }) =>
          footOf(graph, edgeIndex, replacedBp, nodes, ownBp),
        )
      : []
  })
}

// The drawn length each padded foot's route wants: half of what pads its
// allele's arm, its nodes at their drawn lengths, to PADDED_SHARE of the
// reference it replaces as drawn
export function footRoutes(
  graph: Graph,
  feet: readonly PaddedFoot[],
  drawnOf: (bp: number) => number,
  nodeDrawn: (bp: number) => number,
) {
  const lengths = new Map(graph.nodes.map(n => [n.id, n.length]))
  return feet.map(({ edgeIndex, replacedBp, nodes }) => ({
    edgeIndex,
    drawn:
      (drawnOf(replacedBp) * PADDED_SHARE -
        nodes.reduce((sum, id) => sum + nodeDrawn(lengths.get(id) ?? 0), 0)) /
      2,
  }))
}
