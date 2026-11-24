import { loadFmmm } from '@jbrowse/graph-fmmm-layout'

import { againstHoverText, walksAgainstReference } from './againstReference'
import { deletionDrawing, deletionEdges } from './deletionEdges'
import { drawnMarks, graphKey } from './graphKey'
import { layoutModeByValue } from './layoutModes'
import { drawingBounds, fitTransform, forceLayout, loadGraph } from './pipeline'
import { buildGeometry } from './renderer/GeometryBuilder'
import { layoutGeometryInputs } from './renderer/geometryInputs'
import { foldThreads } from './threadFold'
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

function drawn(g: Graph, lifted?: string[], scale = 20) {
  const layout = layoutModeByValue('ordered').run(g, undefined)!
  return buildGeometry({
    ...layoutGeometryInputs(layout, deletionDrawing(g, deletionEdges(g))),
    graph: g,
    nodeById: new Map(g.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
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

// the heads took black or white by each node's ink, under a dark grey key
// swatch
test('heads against the reference draw in the one haloed ink their key swatch shows', () => {
  const batch = drawn(graph)
  const layout = layoutModeByValue('ordered').run(graph, undefined)!
  const swatch = graphKey(graph, layout, { marks: drawnMarks([batch]) })
    .flatMap(s => s.entries)
    .find(e => e.key === 'against')?.swatch
  const turned = batch.arrows.filter(a => a.turned)
  expect(turned.length).toBeGreaterThan(0)
  expect(swatch).toMatchObject({ kind: 'heads', haloed: true })
  for (const head of turned) {
    expect(swatch).toMatchObject({ ink: head.color })
    expect(head.halo).toBe(true)
  }
})

test('under a lift the lanes carry their own heads, and no node takes these', () => {
  const batch = drawn(graph, ['inv#1#c'])
  expect(batch.arrows.filter(a => a.turned)).toEqual([])
})

// a 1 bp node read backwards drew a 6 px head at overview, where its site
// had otherwise vanished
test('a stretch read against the reference shorter than the fold draws takes no head, and one as long does', () => {
  const pxPerBpAt = (scale: number) =>
    drawn(graph, undefined, scale).collapsed!.pxPerBp
  const stretchBp = 30
  const tiny = 2 / (stretchBp * pxPerBpAt(1))
  expect(stretchBp * pxPerBpAt(tiny)).toBeLessThan(3)
  expect(drawn(graph, undefined, tiny).arrows.filter(a => a.turned)).toEqual([])
  const shown = 4 / (stretchBp * pxPerBpAt(1))
  expect(stretchBp * pxPerBpAt(shown)).toBeGreaterThanOrEqual(3)
  expect(
    drawn(graph, undefined, shown).arrows.filter(a => a.turned).length,
  ).toBeGreaterThan(0)
})

// review 4: an inverted walk's SNPs split the stretch it reads against the
// reference into pieces of a few hundred bp, each under the fold at an
// overview, and its heads went with them
test('heads mark a long inversion whose walk carries a SNP every 300 bp, at an overview fit', () => {
  const n = 600
  const [a, b] = [200, 400]
  const piece = (i: number) => `p${i}`
  const lines = [
    ...Array.from(
      { length: n },
      (_, i) => `S\t${piece(i)}\t${'ACGT'.repeat(75)}`,
    ),
    ...Array.from({ length: n - 1 }, (_, i) => [
      `S\ts${i}\tA`,
      `S\tt${i}\tC`,
      `L\t${piece(i)}\t+\ts${i}\t+\t0M`,
      `L\ts${i}\t+\t${piece(i + 1)}\t+\t0M`,
      `L\t${piece(i)}\t+\tt${i}\t+\t0M`,
      `L\tt${i}\t+\t${piece(i + 1)}\t+\t0M`,
    ]).flat(),
    `L\ts${a - 1}\t+\t${piece(b)}\t-\t0M`,
    `L\t${piece(a)}\t-\ts${b}\t+\t0M`,
  ]
  const forward = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, k) => from + k)
      .map(i => `>${piece(i)}${i < n - 1 ? `>s${i}` : ''}`)
      .join('')
  const inverted = Array.from({ length: b - a + 1 }, (_, k) => b - k)
    .map(i => `<${piece(i)}${i > a ? `<t${i - 1}` : ''}`)
    .join('')
  const g = loadGraph(
    [
      ...lines,
      `W\tGRCh38\t0\tchr1\t0\t*\t${forward(0, n)}`,
      `W\tinv\t1\tc\t0\t*\t${forward(0, a)}${inverted}${forward(b + 1, n)}`,
    ].join('\n'),
    'snp-split inversion',
  )
  const layout = layoutModeByValue('ordered').run(g, undefined)!
  const fit = fitTransform(drawingBounds(layout, {}), 1090, 300, false)!
  const batch = buildGeometry({
    ...layoutGeometryInputs(layout, deletionDrawing(g, deletionEdges(g))),
    graph: g,
    nodeById: new Map(g.nodes.map(node => [node.id, node])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    axis: { scaleX: fit.scale, scaleY: fit.scale },
  })
  expect(300 * batch.collapsed!.pxPerBp).toBeLessThan(3)
  const headed = new Set(
    batch.arrows.filter(head => head.turned).map(head => head.node),
  )
  const name = (id: string | undefined) =>
    Number(g.nodes.find(node => node.id === id)?.name.slice(1))
  const pieces = [...headed].map(name)
  expect(pieces.length).toBeGreaterThan(0)
  expect(pieces.every(i => i >= a && i <= b)).toBe(true)
  const spread =
    pieces.reduce((most, i) => Math.max(most, i), -Infinity) -
    pieces.reduce((least, i) => Math.min(least, i), Infinity)
  expect(spread).toBeGreaterThan((b - a) / 2)
})

// final review: a run measured by its span, gaps and all, gave four 1 bp
// nodes read backwards 300 bp apart an inversion's heads at overview
test('nodes read against the reference take heads by the bp they read so, not the span their run reaches over', () => {
  const n = 600
  const reversed = new Set([300, 301, 302, 303])
  const piece = (i: number) => `p${i}`
  const g = loadGraph(
    [
      ...Array.from(
        { length: n },
        (_, i) => `S\t${piece(i)}\t${'ACGT'.repeat(75)}`,
      ),
      ...Array.from({ length: n - 1 }, (_, i) => [
        `S\ts${i}\tA`,
        `L\t${piece(i)}\t+\ts${i}\t+\t0M`,
        `L\ts${i}\t+\t${piece(i + 1)}\t+\t0M`,
        ...(reversed.has(i)
          ? [
              `L\t${piece(i)}\t+\ts${i}\t-\t0M`,
              `L\ts${i}\t-\t${piece(i + 1)}\t+\t0M`,
            ]
          : []),
      ]).flat(),
      `W\tGRCh38\t0\tchr1\t0\t*\t${Array.from({ length: n }, (_, i) => `>${piece(i)}${i < n - 1 ? `>s${i}` : ''}`).join('')}`,
      `W\tflip\t1\tc\t0\t*\t${Array.from({ length: n }, (_, i) => `>${piece(i)}${i < n - 1 ? `${reversed.has(i) ? '<' : '>'}s${i}` : ''}`).join('')}`,
    ].join('\n'),
    'four flipped bases',
  )
  expect(
    [...walksAgainstReference(g).keys()].map(
      id => g.nodes.find(node => node.id === id)?.name,
    ),
  ).toEqual(['s300', 's301', 's302', 's303'])
  const layout = layoutModeByValue('ordered').run(g, undefined)!
  const fit = fitTransform(drawingBounds(layout, {}), 1090, 300, false)!
  const batch = buildGeometry({
    ...layoutGeometryInputs(layout, deletionDrawing(g, deletionEdges(g))),
    graph: g,
    nodeById: new Map(g.nodes.map(node => [node.id, node])),
    colorScheme: 'uniform',
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    axis: { scaleX: fit.scale, scaleY: fit.scale },
  })
  expect(300 * batch.collapsed!.pxPerBp).toBeLessThan(3)
  expect(batch.arrows.filter(head => head.turned)).toEqual([])
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
