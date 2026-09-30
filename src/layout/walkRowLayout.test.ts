import { readFileSync } from 'fs'

import { walkRowLayout } from './walkRowLayout'
import { backboneNodes } from '../anchoredNodes'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { anchorGraph } from '../pathAnchoring'

function pggbGraph() {
  const gfa = readFileSync(
    require.resolve('../../../../test_data/ecoli_pggb_subgraph.gfa'),
    'utf8',
  )
  return anchorGraph(convertGFAToGraph(parseGFA(gfa), 'pggb'), 'K12')
}

const ids = (positions: Record<string, unknown>) =>
  Object.keys(positions).sort()

test('row 0 places every backbone node at its reference bp without a region', () => {
  const graph = pggbGraph()
  const backbone = backboneNodes(graph)
  const { nodePositions, rowLabels } = walkRowLayout(graph)!
  expect(ids(nodePositions)).toEqual(backbone.map(n => n.id).sort())
  for (const node of backbone) {
    expect(nodePositions[node.id]).toEqual([
      { x: node.stable.start, y: 0 },
      { x: node.stable.start + node.length, y: 0 },
    ])
  }
  expect(rowLabels[0]).toEqual({ label: 'K12', y: 0 })
})

test('with a region, row 0 keeps only the backbone nodes overlapping it', () => {
  const graph = pggbGraph()
  const backbone = [...backboneNodes(graph)].sort(
    (a, b) => a.stable.start - b.stable.start,
  )
  expect(backbone.length).toBeGreaterThan(4)
  const first = backbone[0]!
  const second = backbone[1]!
  const last = backbone[backbone.length - 1]!
  const region = { start: second.stable.start, end: last.stable.start }
  const { nodePositions } = walkRowLayout(graph, region)!
  const expected = backbone
    .filter(
      n =>
        n.stable.start < region.end && n.stable.start + n.length > region.start,
    )
    .map(n => n.id)
  expect(expected).toContain(second.id)
  expect(expected).not.toContain(first.id)
  expect(expected).not.toContain(last.id)
  expect(ids(nodePositions)).toEqual(expected.sort())
  expect(nodePositions[second.id]![0]!.x).toBe(second.stable.start)
})

test('a region past every backbone node falls back to all of them', () => {
  const graph = pggbGraph()
  const backbone = backboneNodes(graph)
  const last = Math.max(...backbone.map(n => n.stable.start + n.length))
  const { nodePositions } = walkRowLayout(graph, {
    start: last + 1000,
    end: last + 2000,
  })!
  expect(ids(nodePositions)).toEqual(backbone.map(n => n.id).sort())
})
