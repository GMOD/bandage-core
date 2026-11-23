import { loadFmmm } from '@jbrowse/graph-fmmm-layout'

import { againstHoverText, walksAgainstReference } from './againstReference'
import { deletionDrawing, deletionEdges } from './deletionEdges'
import { drawnMarks, graphKey } from './graphKey'
import { layoutModeByValue } from './layoutModes'
import { forceLayout, loadGraph } from './pipeline'
import { buildGeometry } from './renderer/GeometryBuilder'
import { layoutGeometryInputs } from './renderer/geometryInputs'
import { walkLift } from './walkHighlight'

import type { LayoutEngine } from './pipeline'
import type { Graph } from './types'

// SV-inv-1k-10k: one haplotype reads 2 to 4 reversed, +1 -4 -3 -2 +5, beside
// a forward walk, and the graph drew it as a loop like any bypassed one
const INVERSION = [
  'S\t1\tAAAAAAAAAA',
  'S\t2\tCCCCCCCCCC',
  'S\t3\tGGGGGGGGGG',
  'S\t4\tTTTTTTTTTT',
  'S\t5\tAAAAAAAAAA',
  'L\t1\t+\t2\t+\t0M',
  'L\t2\t+\t3\t+\t0M',
  'L\t3\t+\t4\t+\t0M',
  'L\t4\t+\t5\t+\t0M',
  'L\t1\t+\t4\t-\t0M',
  'L\t2\t-\t5\t+\t0M',
  'W\tGRCh38\t0\tchr1\t0\t50\t>1>2>3>4>5',
  'W\tfwd\t1\tc\t0\t50\t>1>2>3>4>5',
  'W\tinv\t1\tc\t0\t50\t>1<4<3<2>5',
].join('\n')

const graph = loadGraph(INVERSION, 'inversion')
const idOf = (name: string) => graph.nodes.find(n => n.name === name)!.id

function drawn(g: Graph, lifted?: string[]) {
  const layout = layoutModeByValue('ordered').run(g, undefined)!
  return buildGeometry({
    ...layoutGeometryInputs(layout, deletionDrawing(g, deletionEdges(g))),
    graph: g,
    nodeById: new Map(g.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    axis: { scaleX: 20, scaleY: 20 },
    ...(lifted
      ? {
          highlight: walkLift(
            g,
            lifted.map(walk => ({ walk })),
          ),
        }
      : {}),
  })
}

test('the walks reading a reference node against the reference are named on nodes 2 to 4 alone, none where only the reference and a forward walk pass', () => {
  const against = walksAgainstReference(graph)
  expect(
    [...against].map(([id, walks]) => [
      graph.nodes.find(n => n.id === id)!.name,
      walks,
    ]),
  ).toEqual([
    ['2', ['inv#1']],
    ['3', ['inv#1']],
    ['4', ['inv#1']],
  ])
  expect(againstHoverText(graph, idOf('3'), 'GRCh38')).toBe(
    "walked against GRCh38's direction by 1 haplotype: inv#1",
  )
  expect(againstHoverText(graph, idOf('1'), 'GRCh38')).toBeUndefined()
})

test('heads point against the reference along nodes 2 to 4, and the key names them', () => {
  const batch = drawn(graph)
  const turned = batch.arrows.filter(a => a.turned)
  expect(new Set(turned.map(a => a.node))).toEqual(
    new Set([idOf('2'), idOf('3'), idOf('4')]),
  )
  const layout = layoutModeByValue('ordered').run(graph, undefined)!
  for (const head of turned) {
    const [a, b] = layout.nodePositions[head.node!]!
    const along = Math.sign(b!.x - a!.x)
    expect(Math.sign(Math.cos(head.angle))).toBe(-along)
  }
  const entries = graphKey(graph, layout, {
    referenceName: 'GRCh38',
    marks: drawnMarks([batch]),
  }).flatMap(s => s.entries)
  expect(entries.find(e => e.key === 'against')).toMatchObject({
    text: "walked against GRCh38's direction",
    swatch: { kind: 'heads' },
  })
})

test('under a lift the lanes carry their own heads, and no node takes these', () => {
  const batch = drawn(graph, ['inv#1#c'])
  expect(batch.arrows.filter(a => a.turned)).toEqual([])
})

// SV-inv-10k-100k: the fit of its force layout is under the 0.45 px a unit
// links take heads at, where a node is shorter than its head
test('a force layout drawn under the scale links take heads at marks the inverted stretch, and nothing else', async () => {
  // 400 reference nodes of 200 bp, a haplotype reading 150 to 250 reversed
  const ids = Array.from({ length: 400 }, (_, i) => i + 1)
  const forward = ids.map(i => `>${i}`).join('')
  const inverted = [
    ...ids.slice(0, 149).map(i => `>${i}`),
    ...ids
      .slice(149, 250)
      .toReversed()
      .map(i => `<${i}`),
    ...ids.slice(250).map(i => `>${i}`),
  ].join('')
  const wide = loadGraph(
    [
      ...ids.map(i => `S\t${i}\t${'ACGT'.repeat(50)}`),
      ...ids.slice(0, -1).map(i => `L\t${i}\t+\t${i + 1}\t+\t0M`),
      'L\t149\t+\t250\t-\t0M',
      'L\t150\t-\t251\t+\t0M',
      `W\tGRCh38\t0\tchr11\t0\t80000\t${forward}`,
      `W\tfwd\t1\tc\t0\t80000\t${forward}`,
      `W\tinv\t1\tc\t0\t80000\t${inverted}`,
    ].join('\n'),
    'inversion at fit',
  )
  const engine: LayoutEngine = async request => {
    const bandage = await loadFmmm()
    return {
      result: bandage.computeLayout(request.graph, request.options),
      duration: 0,
    }
  }
  const { result: layout } = await forceLayout(
    wide,
    { quality: 1, linearLayout: false, bubbleSpread: 'auto' },
    engine,
    { width: 1200, height: 400 },
  )
  const scale = 0.1
  const batch = buildGeometry({
    ...layoutGeometryInputs(layout, deletionDrawing(wide, deletionEdges(wide))),
    graph: wide,
    nodeById: new Map(wide.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    nodeWidth: 'walks',
    edgeWidth: 'walks',
    axis: { scaleX: scale, scaleY: scale },
  })
  expect(batch.arrows.some(a => !a.turned)).toBe(false)
  const turned = batch.arrows.filter(a => a.turned)
  expect(turned.length).toBeGreaterThan(0)
  for (const head of turned) {
    const name = Number(wide.nodes.find(node => node.id === head.node)!.name)
    expect(name).toBeGreaterThanOrEqual(150)
    expect(name).toBeLessThanOrEqual(250)
  }
  for (const head of turned) {
    expect(head.length).toBeGreaterThanOrEqual(6)
  }
})
