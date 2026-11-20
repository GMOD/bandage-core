import { NOT_LOADED_TAG } from './graphTables'

import type { Graph, GraphNode } from '../types'

// A graph as rGFA text: each segment's length and stable coordinate as the
// LN/SN/SO/SR tags gfa-to-tabix files it by, and every link between two of
// its segments in the spelling the graph holds it in. Sequence is not carried,
// so every S line is `*`. A node with no stable coordinate cannot be filed by
// position and is refused.
export function writeRgfa(graph: Graph) {
  const nameOf = new Map(graph.nodes.map(n => [n.id, n.name]))
  return [
    'H\tVN:Z:1.0',
    ...graph.nodes.map(segmentLine),
    ...graph.edges.flatMap(e => {
      const from = nameOf.get(e.from)
      const to = nameOf.get(e.to)
      return from === undefined || to === undefined
        ? []
        : [
            `L\t${from}\t${e.fromStrand ?? '+'}\t${to}\t${e.toStrand ?? '+'}\t0M`,
          ]
    }),
    '',
  ].join('\n')
}

function segmentLine(node: GraphNode) {
  const { stable } = node
  if (!stable) {
    throw new Error(`segment ${node.name} has no stable coordinate to file`)
  }
  const samples = node.samples?.length ? `\tSM:Z:${node.samples.join(',')}` : ''
  const placeholder = node.placeholder ? `\t${NOT_LOADED_TAG}` : ''
  return `S\t${node.name}\t*\tLN:i:${node.length}\tSN:Z:${stable.refName}\tSO:i:${stable.start}\tSR:i:${stable.rank}${samples}${placeholder}`
}
