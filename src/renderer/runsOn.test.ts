import { figureData } from '../figureData'
import { departureTable } from '../gfa/departures'
import { RUNS_ON_KEY, drawnMarks, graphKey } from '../graphKey'
import { buildGeometry } from './GeometryBuilder'
import { RUNS_ON_LENGTH_PX } from './runsOn'

import type { Graph, GraphEdge, NodeSegment } from '../types'

const at = (x0: number, x1: number, y = 0): NodeSegment[] => [
  { x: x0, y },
  { x: x1, y },
]

// t hangs off r1's end, stepped only by y's departure, which leaves the
// reference at `leavePos`
function tailed(leavePos: number, edges: GraphEdge[] = []): Graph {
  const nodes = [
    {
      id: 'r1+',
      name: 'r1',
      length: 1000,
      depth: 2,
      stable: { refName: 'chr', start: 0, rank: 0 },
    },
    {
      id: 'r2+',
      name: 'r2',
      length: 1000,
      depth: 2,
      stable: { refName: 'chr', start: 1000, rank: 0 },
    },
    { id: 't+', name: 't', length: 40, depth: 1 },
  ]
  return {
    name: 'tail',
    nodes,
    edges: [
      { from: 'r1+', to: 'r2+' },
      { from: 'r1+', to: 't+' },
      ...edges,
    ],
    paths: [{ name: 'ref', nodeIds: ['r1+', 'r2+'] }],
    departures: {
      ...departureTable([
        {
          name: 'y#1#chr',
          hapStart: 1000,
          ownBp: 40,
          missingBp: 0,
          leavePos,
          leaveReversed: false,
          leavePasses: 1,
          rejoinPos: 1000,
          rejoinReversed: false,
          rejoinPasses: 1,
          fromSteps: true,
        },
      ]),
      offsets: Int32Array.of(0, 1),
      steps: Int32Array.of(2),
    },
  }
}

const positions = {
  'r1+': at(0, 1000),
  'r2+': at(1000, 2000),
  't+': at(1000, 1040, 200),
}

const build = (graph: Graph) =>
  buildGeometry({
    axis: { scaleX: 0.5, scaleY: 0.5 },
    nodePositions: positions,
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
  })

const tabs = (graph: Graph) => build(graph).arrows.filter(a => a.runsOn)

test('a departure tail from past the cut ends in a tab past its free end, pointing on', () => {
  const [tab, ...rest] = tabs(tailed(-93_000))
  expect(rest).toEqual([])
  expect(tab).toMatchObject({ node: 't+', y: 200, length: RUNS_ON_LENGTH_PX })
  expect(tab!.angle).toBeCloseTo(0, 6)
  expect((tab!.x - 1040) * 0.5).toBeCloseTo(3 + RUNS_ON_LENGTH_PX, 6)
})

test('a departure the cut holds both ends of, or a tail linked at both ends, has none', () => {
  expect(tabs(tailed(500))).toEqual([])
  expect(tabs(tailed(-93_000, [{ from: 't+', to: 'r2+' }]))).toEqual([])
})

test('the key names the tab where the drawing shows one, and figure data lists it', () => {
  const graph = tailed(-93_000)
  const layout = { nodePositions: positions }
  const keyed = (g: Graph) =>
    graphKey(g, layout, { marks: drawnMarks([build(g)]), drawsNodes: true })
      .flatMap(section => section.entries)
      .map(entry => entry.text)
  expect(keyed(graph)).toContain(RUNS_ON_KEY)
  expect(keyed(tailed(500))).not.toContain(RUNS_ON_KEY)
  const { arrows } = figureData(graph, layout, { width: 800, height: 400 })
  expect(arrows.runsOn.filter(Boolean)).toHaveLength(1)
  expect(arrows.node[arrows.runsOn.indexOf(true)]).toBe('t+')
})
