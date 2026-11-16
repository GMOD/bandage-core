import { drawnAlongStable, isBackbone } from '../anchoredNodes'
import { ownStrand } from '../util/geometry'

import type { EngineRequest } from '../pipeline'
import type { NodeSegment } from '../types'

type Lines = Record<string, NodeSegment[]>

const flip = { '+': '-', '-': '+' } as const

// The stress engine lays a seeded backbone node left to right from the start
// of the reading its id names. Path anchoring keeps the id the reader gave a
// segment and states the reference's reading beside it, so a node the
// reference steps against its id is handed over under the id of the
// reference's reading, and its line comes back turned end for end.
function readingsAgainstIds(request: EngineRequest) {
  return new Map<string, string>(
    request.graph.nodes.flatMap(node =>
      /[+-]$/.test(node.id) && isBackbone(node) && !drawnAlongStable(node)
        ? [[node.id, `${node.id.slice(0, -1)}${flip[ownStrand(node.id)]}`]]
        : [],
    ),
  )
}

export function readAlongReference(request: EngineRequest) {
  const readAs = readingsAgainstIds(request)
  const givenAs = new Map([...readAs].map(([id, reading]) => [reading, id]))
  return readAs.size === 0
    ? { request, turnedBack: (lines: Lines) => lines }
    : {
        request: {
          ...request,
          graph: {
            nodes: request.graph.nodes.map(node => ({
              ...node,
              id: readAs.get(node.id) ?? node.id,
            })),
            edges: request.graph.edges.map(edge =>
              readAs.has(edge.from) || readAs.has(edge.to)
                ? {
                    ...edge,
                    from: readAs.get(edge.from) ?? edge.from,
                    to: readAs.get(edge.to) ?? edge.to,
                    fromStrand: edge.fromStrand ?? ownStrand(edge.from),
                    toStrand: edge.toStrand ?? ownStrand(edge.to),
                  }
                : edge,
            ),
          },
        },
        turnedBack: (lines: Lines): Lines =>
          Object.fromEntries(
            Object.entries(lines).map(([id, line]) => {
              const given = givenAs.get(id)
              return given === undefined
                ? [id, line]
                : [given, line.toReversed()]
            }),
          ),
      }
}
