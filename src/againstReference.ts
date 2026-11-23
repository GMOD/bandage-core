import { isBackbone } from './anchoredNodes'
import { panSNHaplotype } from './pansn'
import { pathOrigin } from './pathAnchoring'
import { weakMemo } from './util/weakMemo'

import type { Graph } from './types'

// The graph names no event, so an inversion's only mark was its strand-turn
// links, which the force layout draws at no length where its loop crosses:
// an inversion and a bypassed loop drew alike. What a walk does on a node is
// exact, though: each visit states the strand it reads the node on, and so
// does the reference's. A reference node some shown walk reads against the
// reference's direction carries heads pointing that way (GeometryBuilder),
// strand on a node and no event's name.

const cache = weakMemo<Graph, ReadonlyMap<string, readonly string[]>>()

// The haplotypes whose walks read each reference node against the way the
// reference reads it there, by node id, for every node some walk does: each
// visit's strand, a departure's own steps' included, against the strand the
// reference's visits there read it on, or where the reference has none in
// the cut, the strand it states for the node
export function walksAgainstReference(graph: Graph) {
  return cache(graph, [], () => {
    const visits = graph.pathVisits
    const out = new Map<string, readonly string[]>()
    const backbone = graph.nodes.filter(
      node => isBackbone(node) && !node.placeholder,
    )
    const references = new Set(backbone.map(node => node.stable!.refName))
    const ofReference = (path: string) =>
      references.has(path) || references.has(pathOrigin(path).name)
    for (const node of backbone) {
      const slot = visits ? visits.slot(node.name) : -1
      let along = 0
      let reversed = 0
      const others: { path: string; reversed: boolean }[] = []
      for (
        let i = visits && slot >= 0 ? visits.offsets[slot]! : 0;
        visits && slot >= 0 && i < visits.offsets[slot + 1]!;
        i++
      ) {
        const path = visits.paths[visits.path[i]!]!
        const turned = visits.reversed[i] === 1
        if (ofReference(path)) {
          along += turned ? 0 : 1
          reversed += turned ? 1 : 0
        } else {
          others.push({ path, reversed: turned })
        }
      }
      for (const { path, strand } of node.departureVisits ?? []) {
        if (!ofReference(path)) {
          others.push({ path, reversed: strand === '-' })
        }
      }
      const referenceReversed =
        along + reversed > 0
          ? reversed > along
          : node.stable!.strand === '-'
      const against = new Set(
        others
          .filter(visit => visit.reversed !== referenceReversed)
          .map(visit => panSNHaplotype(visit.path) ?? pathOrigin(visit.path).name),
      )
      if (against.size > 0) {
        out.set(node.id, [...against].toSorted())
      }
    }
    return out
  })
}

export const againstKey = (reference = 'the reference') =>
  `walked against ${reference}'s direction`

// What a hovered reference node says of the walks reading it against the
// reference: `walked against GRCh38's direction by 2 haplotypes: HG00099#1,
// HG01123#1`
export function againstHoverText(
  graph: Graph,
  nodeId: string,
  reference?: string,
) {
  const walks = walksAgainstReference(graph).get(nodeId)
  return walks
    ? `${againstKey(reference)} by ${walks.length} haplotype${walks.length === 1 ? '' : 's'}: ${walks.join(', ')}`
    : undefined
}
