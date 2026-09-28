import { abgrAlpha } from '@jbrowse/core/util/colorBits'

import { buildGeometry } from './GeometryBuilder'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { walkLift } from '../walkHighlight'

// ref walks v1 v2 v3; alt walks v1 a1 v3. Lifting alt out fades v2 and the
// links it alone uses; lifting both gives each a lane of its own.
const GFA = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
S\ta1\tTTTTTT
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv1\t+\ta1\t+\t0M
L\ta1\t+\tv3\t+\t0M
W\tref\t0\tchr\t0\t9\t>v1>v2>v3
W\talt\t1\tchr\t0\t13\t>v1>a1>v3`

const graph = convertGFAToGraph(parseGFA(GFA))
const positions = {
  'v1+': [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
  'v2+': [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ],
  'v3+': [
    { x: 40, y: 0 },
    { x: 50, y: 0 },
  ],
  'a1+': [
    { x: 20, y: 10 },
    { x: 30, y: 10 },
  ],
}

const lift = (...walks: string[]) =>
  walkLift(
    graph,
    walks.map(walk => ({ walk })),
  )

function build(highlight?: ReturnType<typeof walkLift>, drawPaths = false) {
  return buildGeometry({
    axis: { scaleX: 1, scaleY: 1 },
    nodePositions: positions,
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 5,
    connectorThickness: 2,
    drawPaths,
    highlight,
  })
}

test('a lifted walk keeps its nodes and fades the rest', () => {
  const plain = build()
  const lifted = build(lift('alt#1#chr'))
  const alphaOf = (batch: typeof plain, id: string) =>
    abgrAlpha(batch.nodeStrokes[batch.nodeStrokeRuns.get(id)!.start]!.color)
  expect(alphaOf(lifted, 'a1+')).toBe(alphaOf(plain, 'a1+'))
  expect(alphaOf(lifted, 'v1+')).toBe(alphaOf(plain, 'v1+'))
  expect(alphaOf(lifted, 'v2+')).toBeLessThan(alphaOf(plain, 'v2+') / 4)
})

test("a lifted walk's links carry its lane colour, the others fade", () => {
  const plain = build()
  const one = lift('alt#1#chr')!
  const lifted = build(one)
  const strokeOf = (batch: typeof plain, edge: number) =>
    batch.edgeCurves[batch.edgeCurveRuns.get(edge)!.start]!
  expect(strokeOf(lifted, 2).color).toBe(one.walks[0]!.colors.get('v1+'))
  expect(strokeOf(lifted, 0).thickness).toBe(strokeOf(plain, 0).thickness)
  expect(abgrAlpha(strokeOf(lifted, 0).color)).toBeLessThan(
    abgrAlpha(strokeOf(plain, 0).color) / 4,
  )
})

test('two lifted walks each keep a lane, missing where a walk does not go', () => {
  const both = lift('ref#0#chr', 'alt#1#chr')!
  const batch = build(both)
  const lanesOf = (id: string) => {
    const { start, count } = batch.nodeStrokeRuns.get(id)!
    return batch.nodeStrokes.slice(start, start + count)
  }
  const [ref, alt] = both.walks
  expect(lanesOf('v1+').map(s => s.color)).toEqual([
    ref!.colors.get('v1+'),
    alt!.colors.get('v1+'),
  ])
  expect(lanesOf('v2+').map(s => s.color)).toEqual([ref!.colors.get('v2+')])
  expect(lanesOf('a1+').map(s => s.color)).toEqual([alt!.colors.get('a1+')])
  // the lanes sit either side of the node's centreline
  const [a, b] = lanesOf('v1+')
  expect(a!.points[0]!.y).toBeLessThan(0)
  expect(b!.points[0]!.y).toBeGreaterThan(0)
})

// Painted per path, a node is one stroke per walk through it rather than one
// stroke, and that branch never read the highlight: v2 kept its full ink
// beside links that had faded.
test('a node painted in path stripes fades off the lifted walk too', () => {
  const plain = build(undefined, true)
  const lifted = build(lift('alt#1#chr'), true)
  const alphasOf = (batch: typeof plain, id: string) => {
    const { start, count } = batch.nodeStrokeRuns.get(id)!
    return batch.nodeStrokes
      .slice(start, start + count)
      .map(stroke => abgrAlpha(stroke.color))
  }
  expect(alphasOf(plain, 'v1+')).toHaveLength(2)
  expect(alphasOf(lifted, 'v1+')).toEqual(alphasOf(plain, 'v1+'))
  for (const [i, alpha] of alphasOf(lifted, 'v2+').entries()) {
    expect(alpha).toBeLessThan(alphasOf(plain, 'v2+')[i]! / 4)
  }
})
