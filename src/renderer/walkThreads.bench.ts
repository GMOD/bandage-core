import { describe, test } from 'vitest'

import { buildGeometry } from './GeometryBuilder'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { walkLift } from '../walkHighlight'

import type { NodeSegment } from '../types'

function liftedChain(nodes: number, walks: number, repeating: boolean) {
  const lines: string[] = []
  const nodePositions: Record<string, NodeSegment[]> = {}
  for (let i = 0; i < nodes; i++) {
    lines.push(`S\tn${i}\tACGTACGTAC`)
    if (i) {
      lines.push(`L\tn${i - 1}\t+\tn${i}\t+\t0M`)
    }
    nodePositions[`n${i}+`] = [0, 1, 2].map(k => ({
      x: i * 30 + k * 10,
      y: 200 * Math.sin(i * 0.05 + k * 0.01),
    }))
  }
  for (let i = 10; i < nodes; i += 50) {
    lines.push(`L\tn${i}\t+\tn${i - 10}\t+\t0M`)
  }
  const chain = Array.from({ length: nodes }, (_, i) => `>n${i}`)
  const looped = chain.flatMap((step, i) =>
    i % 50 === 10 ? [step, ...chain.slice(i - 10, i + 1)] : [step],
  )
  for (let w = 0; w < walks; w++) {
    const steps = repeating && w === 1 ? looped : chain
    lines.push(`W\tw${w}\t1\tchr\t0\t${nodes * 10}\t${steps.join('')}`)
  }
  const graph = convertGFAToGraph(parseGFA(lines.join('\n')))
  return {
    axis: { scaleX: 1, scaleY: 1 },
    nodePositions,
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform' as const,
    contigThickness: 5,
    connectorThickness: 2,
    drawPaths: false,
    highlight: walkLift(
      graph,
      Array.from({ length: walks }, (_, w) => ({ walk: `w${w}#1#chr` })),
    ),
  }
}

describe('lifted walks on a 20k-node chain', () => {
  for (const [walks, repeating] of [
    [2, false],
    [20, false],
    [2, true],
    [20, true],
  ] as const) {
    const name = `${walks} walks${repeating ? ', one repeating' : ''}`
    const options = liftedChain(20_000, walks, repeating)
    test(name, async ({ bench }) => {
      await bench(name, () => {
        buildGeometry(options)
      }).run()
    })
  }
})
