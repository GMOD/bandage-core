import { isLoadedBackbone } from './anchoredNodes'
import { panSNHaplotype } from './pansn'
import { pathOrigin } from './pathAnchoring'
import { weakMemo } from './util/weakMemo'

import type { Graph } from './types'

const cache = weakMemo<Graph, ReadonlyMap<string, readonly string[]>>()

// By reference node id, the haplotypes reading it on the strand the
// reference does not, those of every walk a thread or a bundled route holds;
// none where the reference reads it both ways
export function walksAgainstReference(graph: Graph) {
  return cache(graph, [], () => {
    const visits = graph.pathVisits
    const out = new Map<string, readonly string[]>()
    const walksOf = new Map(
      (graph.paths ?? []).map(path => [path.name, path.members ?? [path.name]]),
    )
    const backbone = graph.nodes.filter(isLoadedBackbone)
    const references = new Set(backbone.map(node => node.stable.refName))
    const ofReference = (path: string) =>
      references.has(path) || references.has(pathOrigin(path).name)
    for (const node of backbone) {
      let along = 0
      let reversed = 0
      const others: { path: string; reversed: boolean }[] = []
      const slot = visits ? visits.slot(node.name) : -1
      if (visits && slot >= 0) {
        for (
          let i = visits.offsets[slot]!;
          i < visits.offsets[slot + 1]!;
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
      }
      for (const { path, strand } of node.departureVisits ?? []) {
        if (!ofReference(path)) {
          others.push({ path, reversed: strand === '-' })
        }
      }
      const referenceReversed =
        along + reversed > 0 ? reversed > 0 : node.stable.strand === '-'
      const against = new Set(
        along > 0 && reversed > 0
          ? []
          : others
              .filter(visit => visit.reversed !== referenceReversed)
              .flatMap(visit => walksOf.get(visit.path) ?? [visit.path])
              .map(walk => panSNHaplotype(walk) ?? pathOrigin(walk).name),
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
