import { loadFmmm } from '@jbrowse/graph-fmmm-layout'

import { againstHoverText, walksAgainstReference } from './againstReference'
import { deletionDrawing, deletionEdges } from './deletionEdges'
import { drawnMarks, graphKey } from './graphKey'
import { layoutModeByValue } from './layoutModes'
import { forceLayout, loadGraph } from './pipeline'
import { EDGE_DEFAULT_COLOR, buildGeometry } from './renderer/GeometryBuilder'
import { layoutGeometryInputs } from './renderer/geometryInputs'
import { foldThreads } from './threadFold'
import { distanceToSegment } from './util/geometry'
import { walkLift } from './walkHighlight'

import type { NodeWidth } from './nodeWidths'
import type { LayoutEngine } from './pipeline'
import type { RenderBatch } from './renderer/types'
import type { Graph, LayoutResult, NodeSegment } from './types'

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

function drawn(
  g: Graph,
  lifted?: string[],
  scale = 20,
  nodeWidth: NodeWidth = 'uniform',
  layout: Pick<LayoutResult, 'nodePositions' | 'stranded'> = layoutModeByValue(
    'ordered',
  ).run(g, undefined)!,
) {
  return buildGeometry({
    ...layoutGeometryInputs(layout, deletionDrawing(g, deletionEdges(g))),
    graph: g,
    nodeById: new Map(g.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    nodeWidth,
    axis: { scaleX: scale, scaleY: scale },
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

// SV-inv-10k-100k: eight haplotypes read the 13.2 kb node reversed on two
// threads, and the hover said "by 2 haplotypes" beside the fold's "8 of 9"
test('on a thread fold the walks against the reference are the haplotypes every thread holds, a haplotype in two walks once', () => {
  const inverted = loadGraph(
    [
      'S\ta\t*\tLN:i:1000',
      'S\tb\t*\tLN:i:2000',
      'S\tc\t*\tLN:i:2000',
      'S\td\t*\tLN:i:1000',
      'L\ta\t+\tb\t+\t0M',
      'L\tb\t+\tc\t+\t0M',
      'L\tc\t+\td\t+\t0M',
      'L\ta\t+\tc\t-\t0M',
      'L\tb\t-\td\t+\t0M',
      'W\tref\t0\tchr\t0\t6000\t>a>b>c>d',
      'W\th1\t1\tchr\t0\t6000\t>a<c<b>d',
      'W\th2\t1\tchr\t0\t6000\t>a<c<b>d',
      'W\th2\t1\tother\t0\t6000\t>a<c<b>d',
      'W\th3\t1\tchr\t0\t6000\t>a>b>c>d',
    ].join('\n'),
    'inverted',
    { referencePath: 'ref#0#chr' },
  )
  const fold = foldThreads(inverted, 500)
  expect(fold.folded).toBe(true)
  const turned = fold.graph.paths!.find(path => path.name === 'h1#1#chr')!
  expect(turned.members).toEqual(['h1#1#chr', 'h2#1#chr', 'h2#1#other'])
  const idIn = (g: Graph) =>
    g.nodes.find(node => node.name === 'b' || node.members?.includes('b'))!.id
  expect(againstHoverText(fold.graph, idIn(fold.graph), 'chr')).toBe(
    "walked against chr's direction by 2 haplotypes: h1#1, h2#1",
  )
  expect(againstHoverText(inverted, idIn(inverted), 'chr')).toBe(
    againstHoverText(fold.graph, idIn(fold.graph), 'chr'),
  )
})

// px from a point to a line, both in layout units at `scale`
const pxFrom = (p: NodeSegment, line: readonly NodeSegment[], scale: number) =>
  line
    .slice(1)
    .reduce(
      (least, b, i) =>
        Math.min(
          least,
          distanceToSegment(p.x, p.y, line[i]!.x, line[i]!.y, b.x, b.y),
        ),
      Infinity,
    ) * scale

const strokesOf = (batch: RenderBatch, id: string) => {
  const run = batch.nodeStrokeRuns.get(id)
  return run ? batch.nodeStrokes.slice(run.start, run.start + run.count) : []
}

// the heads within any reference node's half-width of its line, other than a
// link's own head at a node end
function headsOnNodes(
  g: Graph,
  batch: RenderBatch,
  positions: LayoutResult['nodePositions'],
  scale: number,
) {
  const linkHeads = new Set<number>()
  for (const { start, count } of batch.arrowRuns.values()) {
    for (let i = start; i < start + count; i++) {
      linkHeads.add(i)
    }
  }
  return batch.arrows.filter(
    (head, i) =>
      !linkHeads.has(i) &&
      head.walk === undefined &&
      !head.runsOn &&
      g.nodes.some(node => {
        const line = positions[node.id]
        const [stroke] = strokesOf(batch, node.id)
        return (
          !!node.stable &&
          node.stable.rank === 0 &&
          !!line &&
          !!stroke &&
          pxFrom(head, line, scale) <= stroke.thickness
        )
      }),
  )
}

// the owner: heads painted on a reference node read as the reference running
// backwards, and a lane beside it read as a second copy
test('no head lies on a reference node some walks read against the reference; the turn links into and out of the reversed stretch are painted over the nodes with their heads', () => {
  const layout = layoutModeByValue('ordered').run(graph, undefined)!
  const batch = drawn(graph)
  expect(headsOnNodes(graph, batch, layout.nodePositions, 20)).toEqual([])
  const turns = graph.edges.flatMap((edge, ei) =>
    (edge.fromStrand === '+') !== (edge.toStrand === '+') ? [ei] : [],
  )
  expect(turns).toHaveLength(2)
  for (const ei of turns) {
    const run = batch.edgeCurveRuns.get(ei)!
    expect(batch.edgeCurves[run.start]).toMatchObject({
      turn: true,
      color: EDGE_DEFAULT_COLOR,
    })
    expect(batch.arrowRuns.get(ei)?.count).toBe(1)
  }
})

test('a node read against the reference draws at its full depth, by walks and uniform, with no stroke beside it', () => {
  for (const nodeWidth of ['walks', 'uniform'] as const) {
    const batch = drawn(graph, undefined, 20, nodeWidth)
    const [whole] = strokesOf(batch, idOf('1'))
    for (const name of ['2', '3', '4']) {
      expect(strokesOf(batch, idOf(name))).toEqual([
        expect.objectContaining({ thickness: whole!.thickness }),
      ])
    }
  }
})

test('the key keys no mark for walks read against the reference, since none is drawn', () => {
  const layout = layoutModeByValue('ordered').run(graph, undefined)!
  const keys = graphKey(graph, layout, {
    referenceName: 'GRCh38',
    marks: drawnMarks([drawn(graph)]),
  })
    .flatMap(section => section.entries)
    .map(entry => entry.text)
  expect(keys).not.toContainEqual(expect.stringMatching(/against/))
})

test('under a lift the lanes carry their own heads, and no reference node takes one off them', () => {
  const layout = layoutModeByValue('ordered').run(graph, undefined)!
  const batch = drawn(graph, ['inv#1#c'])
  expect(headsOnNodes(graph, batch, layout.nodePositions, 20)).toEqual([])
})

// SV-inv-10k-100k: the fit of its force layout is under the 0.45 px a unit
// link takes a head at
test('a force layout of a 100-node inversion at an overview fit puts no head on a reference node', async () => {
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
  const batch = drawn(wide, undefined, scale, 'walks', layout)
  expect(walksAgainstReference(wide).size).toBe(101)
  expect(headsOnNodes(wide, batch, layout.nodePositions, scale)).toEqual([])
})
