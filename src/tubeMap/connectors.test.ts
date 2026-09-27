import fs from 'fs'
import path from 'path'

import { referenceBoxes, rulerBoxes } from './axis'
import { connectorAt, referenceNodes, tubeMapConnectors } from './connectors'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { tubeMapLayout } from '../layout/tubeMapLayout'
import { anchorGraph } from '../pathAnchoring'

import type { Connector } from './connectors'

const GFA = fs.readFileSync(
  path.join(__dirname, '../../../../test_data/cactus/cactus_240_280.gfa'),
  'utf8',
)

function cactus() {
  const graph = anchorGraph(convertGFAToGraph(parseGFA(GFA)), 'ref')
  const layout = tubeMapLayout(graph)!.tubeMap!.layout
  return { graph, layout }
}

test('every reference box is a node, with the bp and tube x its box has', () => {
  const { graph, layout } = cactus()
  const nodes = referenceNodes(graph, layout)
  const boxes = rulerBoxes(referenceBoxes(graph, layout))!
  const sorted = nodes.toSorted((a, b) => a.bp0 - b.bp0)
  expect(sorted.map(({ node: _node, ...box }) => box)).toEqual(boxes)
  expect(new Set(nodes.map(n => n.node)).size).toBe(nodes.length)
})

test('a band runs from its bp on the linear view to its box on the tubes', () => {
  const nodes = [
    { node: 'a', bp0: 1000, bp1: 1100, x0: 0, x1: 20 },
    { node: 'b', bp0: 1100, bp1: 1101, x0: 60, x1: 70 },
    { node: 'c', bp0: 1101, bp1: 1200, x0: 110, x1: 130 },
  ]
  const connectors = tubeMapConnectors(
    nodes,
    bp => (bp - 1000) / 2,
    tx => tx * 4 + 10,
    300,
  )
  expect(connectors).toEqual([
    { node: 'a', top0: 0, top1: 50, bottom0: 10, bottom1: 90 },
    { node: 'b', top0: 50, top1: 50.5, bottom0: 250, bottom1: 290 },
  ])
})

test('the pointer finds the band it is over, a sliver within a few px of it', () => {
  const connectors: Connector[] = [
    { node: 'wide', top0: 0, top1: 100, bottom0: 0, bottom1: 100 },
    { node: 'snp', top0: 200, top1: 200, bottom0: 200, bottom1: 200 },
    { node: 'fan', top0: 300, top1: 300, bottom0: 400, bottom1: 500 },
  ]
  expect(connectorAt(connectors, 100, 50, 50)).toBe('wide')
  expect(connectorAt(connectors, 100, 202, 10)).toBe('snp')
  expect(connectorAt(connectors, 100, 206, 10)).toBeUndefined()
  expect(connectorAt(connectors, 100, 400, 100)).toBe('fan')
  expect(connectorAt(connectors, 100, 400, 0)).toBeUndefined()
  expect(connectorAt(connectors, 100, 50, 120)).toBeUndefined()
})
