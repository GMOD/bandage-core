import { isLoadedBackbone, readsAsReference } from '../anchoredNodes'
import { linkKey } from '../gfa/linkKey'
import { pathOrigin, referenceVisits } from '../pathAnchoring'
import { ownStrand } from '../util/geometry'
import { unclipped } from './trimToWindow'

import type { AnchoredNode } from '../anchoredNodes'
import type { Graph } from '../types'

// An allele far shorter than the reference it replaces, 13 bp for 13 kb, is
// an arm the force layout draws as a speck, and the reference closes on it as
// a loop. Its links to the reference run through route nodes, as a
// deletion's bare link does (deletionRoutes.ts), padding the arm to this share
// of the reference, and draw dashed.
export const PADDED_SHARE = 0.5

export interface PaddedFoot {
  edgeIndex: number
  from: string
  to: string
  fromStrand?: '+' | '-'
  toStrand?: '+' | '-'
  replacedBp: number
  nodes: string[]
}

// The reference a walk replaces between two steps on it, where it jumps
// forward on one pass of each node, reading both as the reference does or
// both against it; 0 for a back-jump, a strand turn or a node the reference
// passes more than once
function forwardSkip(
  leave: AnchoredNode,
  leaveStrand: '+' | '-',
  rejoin: AnchoredNode,
  rejoinStrand: '+' | '-',
  passesOf: (node: AnchoredNode) => number,
) {
  const along = readsAsReference(leave, leaveStrand)
  const gap = along
    ? rejoin.stable.start - (leave.stable.start + leave.length)
    : leave.stable.start - (rejoin.stable.start + rejoin.length)
  return leave.stable.refName === rejoin.stable.refName &&
    along === readsAsReference(rejoin, rejoinStrand) &&
    passesOf(leave) === 1 &&
    passesOf(rejoin) === 1
    ? Math.max(0, gap)
    : 0
}

// The links of each walk's run of steps off the reference between two steps
// on it, none a placeholder, where the run is a forward skip whose own bp is
// under PADDED_SHARE of what it replaces: its first and last links that no
// other run takes, or that only runs replacing as much take. Graphs without
// walks pad nothing.
export function paddedFeet(cut: Graph) {
  const graph = unclipped(cut)
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const visits = graph.pathVisits
  const visitsOf = referenceVisits(graph)
  const passesOf = (node: AnchoredNode) => visitsOf(node).length
  const linkAt = new Map<string, number>()
  graph.edges.forEach((e, i) => {
    linkAt.set(
      linkKey(
        e.from,
        e.fromStrand ?? ownStrand(e.from),
        e.to,
        e.toStrand ?? ownStrand(e.to),
      ),
      i,
    )
  })
  const runs: { replacedBp: number; nodes: string[]; links: number[] }[] = []
  // the least reference a padded run through each link replaces, 0 where a
  // run not padded takes it
  const replacing = new Map<number, number>()
  const next = visits?.replay()
  for (const { name, nodeIds } of graph.paths ?? []) {
    const walk = visits?.pathIndex(pathOrigin(name).name) ?? -1
    const strands = nodeIds.map(id => {
      const node = byId.get(id)
      const at =
        visits && next && node ? next(visits.slot(node.name), walk) : -1
      return at >= 0 && visits ? visits.strand(at) : ownStrand(id)
    })
    const links = nodeIds.map((id, i) =>
      i > 0
        ? linkAt.get(linkKey(nodeIds[i - 1]!, strands[i - 1], id, strands[i]))
        : undefined,
    )
    let last = -1
    const close = (to: number) => {
      const leave = byId.get(nodeIds[last] ?? '')
      const rejoin = byId.get(nodeIds[to] ?? '')
      const own = nodeIds.slice(last + 1, to)
      const runLinks = links
        .slice(Math.max(last, 0) + 1, to + 1)
        .flatMap(link => (link === undefined ? [] : [link]))
      const replacedBp =
        isLoadedBackbone(leave) &&
        isLoadedBackbone(rejoin) &&
        own.every(id => !byId.get(id)?.placeholder) &&
        new Set(own).size === own.length
          ? forwardSkip(leave, strands[last]!, rejoin, strands[to]!, passesOf)
          : 0
      const ownBp = own.reduce(
        (sum, id) => sum + (byId.get(id)?.length ?? 0),
        0,
      )
      const padded = ownBp < replacedBp * PADDED_SHARE
      for (const link of runLinks) {
        replacing.set(
          link,
          Math.min(replacing.get(link) ?? Infinity, padded ? replacedBp : 0),
        )
      }
      if (padded) {
        runs.push({ replacedBp, nodes: own, links: runLinks })
      }
    }
    for (let i = 0; i < nodeIds.length; i++) {
      if (isLoadedBackbone(byId.get(nodeIds[i]!))) {
        if (i > last + 1) {
          close(i)
        }
        last = i
      }
    }
    if (last < nodeIds.length - 1) {
      close(nodeIds.length)
    }
  }
  const feet = new Map<number, PaddedFoot>()
  for (const { replacedBp, nodes, links } of runs) {
    const own = links.filter(link => replacing.get(link)! >= replacedBp)
    for (const link of new Set([own[0], own.at(-1)])) {
      if (link !== undefined && !feet.has(link)) {
        const edge = graph.edges[link]!
        feet.set(link, {
          edgeIndex: link,
          from: edge.from,
          to: edge.to,
          ...(edge.fromStrand ? { fromStrand: edge.fromStrand } : {}),
          ...(edge.toStrand ? { toStrand: edge.toStrand } : {}),
          replacedBp,
          nodes,
        })
      }
    }
  }
  return [...feet.values()].sort((a, b) => a.edgeIndex - b.edgeIndex)
}

// The drawn length each padded foot's route wants, half of what pads its
// arm to PADDED_SHARE of the reference it replaces as drawn, where that is
// at least `least`, the layout's shortest node: a smaller site would bulge
// past the reference it replaces, as G4's short skips did
export function footRoutes(
  graph: Graph,
  feet: readonly PaddedFoot[],
  drawnOf: (bp: number) => number,
  nodeDrawn: (bp: number) => number,
  least: number,
) {
  const lengths = new Map(graph.nodes.map(n => [n.id, n.length]))
  return feet.flatMap(({ edgeIndex, replacedBp, nodes }) => {
    const drawn =
      (drawnOf(replacedBp) * PADDED_SHARE -
        nodes.reduce((sum, id) => sum + nodeDrawn(lengths.get(id) ?? 0), 0)) /
      2
    return drawn >= least ? [{ edgeIndex, drawn }] : []
  })
}
