import { readFileSync } from 'fs'
import { join } from 'path'

import { COMPRESSED_KEY } from './bubbleSpreads'
import { figureSvg } from './figure'
import {
  figureData,
  gfaFigureData,
  laidOutGraph,
  walkRowInks,
} from './figureData'
import { EXON_COLOR } from './genes/exonOutline'
import { genesOverNode } from './genes/geneNames'
import { genePins } from './genes/genePins'
import { gfaTables } from './gfa/gfaTables'
import { labelledNodeLengths } from './graphLabels'
import { layoutLabels } from './labelLayout'
import { liftedRowInks, rowInkAt } from './layout/rowInks'
import { walkRows } from './layout/walkRows'
import { layoutEngine } from './layoutEngines'
import { layoutModeByValue } from './layoutModes'
import { SMALL_SITE_PX } from './levelOfDetail'
import { LABEL_PX } from './overlayLabels'
import {
  drawingBounds,
  engineSettingsOf,
  fitTransform,
  forceLayout,
  loadGraph,
} from './pipeline'
import { graphBackbone } from './reference'
import { abgrHex } from './renderer/colorBits'
import { axisScaleOf } from './viewport'
import { encodingStops } from './walkEncoding'
import { walkLift } from './walkHighlight'

import type { BubbleSpread } from './bubbleSpreads'
import type { GfaFigureSpec } from './figureData'
import type { WalkLayer } from './walkEncoding'

const read = (name: string) =>
  readFileSync(join(__dirname, '..', 'test_data', name), 'utf8')

const K12 = 'K12#1#chr:1004500-1004961'
const IAI39 = 'IAI39#1#chr:2249412-2249872'

function lengths(table: Record<string, unknown[]>) {
  return new Set(Object.values(table).map(column => column.length))
}

test('every column of a table is one row long per row', async () => {
  const d = await gfaFigureData(read('ecoli_rgfa_slice.gfa'), 'ecoli', {
    layout: 'auto',
  })
  for (const table of [
    d.nodes,
    d.edges,
    d.arrows,
    d.sites ?? {},
    d.nodeInfo,
    d.rowLabels,
  ]) {
    expect(lengths(table).size).toBe(1)
  }
  expect(d.nodes.x.length).toBeGreaterThan(0)
})

test('an anchored layout states its reference axis and its rows', async () => {
  const d = await gfaFigureData(read('ecoli_rgfa_slice.gfa'), 'ecoli', {
    layout: 'auto',
  })
  expect(d.meta.referenceAxis).toBe(true)
  expect(d.meta.pixelRows).toBe(true)
  expect(d.rowLabels.label[0]).toMatch(/Reference/)
})

const listed = (column: string[] | undefined) =>
  (column ?? []).flatMap(ids => (ids ? ids.split(',') : []))

test('every node of the node table is drawn or listed as folded, never both, and with small sites drawn as nodes every one is drawn', async () => {
  const gfa = read('ecoli_pggb_subgraph.gfa')
  const d = await gfaFigureData(gfa, 'ecoli', { engine: 'fmmm', width: 160 })
  const folded = listed(d.sites?.nodes)
  const drawn = new Set(d.nodes.node)
  expect(folded.length).toBeGreaterThan(0)
  expect(folded.filter(id => drawn.has(id))).toEqual([])
  expect(new Set([...drawn, ...folded])).toEqual(new Set(d.nodeInfo.node))
  const all = await gfaFigureData(gfa, 'ecoli', {
    engine: 'fmmm',
    width: 160,
    smallSites: 'nodes',
  })
  expect(new Set(all.nodes.node)).toEqual(new Set(all.nodeInfo.node))
  expect(all.sites).toBeUndefined()
})

test('the node table counts how often the reference walks each node', async () => {
  const gfa = [
    ...[100, 10, 20, 100].map((n, id) => `S\t${id}\t${'A'.repeat(n)}`),
    'P\tref#0#chr\t0+,1+,2+,1+,2+,3+\t*',
    'P\ta#1#c\t0+,3+\t*',
    ...['0 1', '1 2', '2 1', '2 3', '0 3'].map(pair => {
      const [from, to] = pair.split(' ')
      return `L\t${from}\t+\t${to}\t+\t0M`
    }),
  ].join('\n')
  const d = await gfaFigureData(gfa, 'repeat', { engine: 'stress' })
  const visits = Object.fromEntries(
    d.nodeInfo.name.map((name, i) => [name, d.nodeInfo.referenceVisits[i]]),
  )
  expect(visits).toEqual({ 0: 1, 1: 2, 2: 2, 3: 1 })
  expect(d.meta.referenceRamp).toEqual({ start: 50, end: 210 })
  expect(d.meta.deletions).toBe(1)
})

test('the node table places each node on the reference, alleles by their flanks', async () => {
  const chain = Array.from({ length: 12 }, (_, i) => `c${i}`)
  const gfa = [
    ...[100, 10, 20, 100].map((n, id) => `S\t${id}\t${'A'.repeat(n)}`),
    ...chain.map(id => `S\t${id}\tAAAA`),
    'S\tlone\tAAAA',
    'P\tref#0#chr:1000-1210\t0+,1+,3+\t*',
    'P\ta#1#c\t0+,2+,3+\t*',
    `P\tb#1#c\t0+,${chain.map(id => `${id}+`).join(',')},3+\t*`,
    ...['0 1', '1 3', '0 2', '2 3', '0 c0', 'c11 3'].map(pair => {
      const [from, to] = pair.split(' ')
      return `L\t${from}\t+\t${to}\t+\t0M`
    }),
    ...chain.slice(1).map((id, i) => `L\t${chain[i]}\t+\t${id}\t+\t0M`),
  ].join('\n')
  const d = await gfaFigureData(gfa, 'bubble', { engine: 'stress' })
  const positions = Object.fromEntries(
    d.nodeInfo.name.map((name, i) => [name, d.nodeInfo.position[i]]),
  )
  expect(positions).toMatchObject({ 0: 1050, 1: 1105, 2: 1105, 3: 1160 })
  expect(positions.lone).toBeNull()
  for (const id of chain) {
    expect(positions[id]).toBeGreaterThanOrEqual(1050)
    expect(positions[id]).toBeLessThanOrEqual(1160)
  }
})

test('a panel per walk, its walk lifted and the rest faded', async () => {
  const d = await gfaFigureData(read('ecoli_pggb_subgraph.gfa'), 'ecoli', {
    engine: 'stress',
    walks: [K12, IAI39],
    facet: 'walk',
  })
  expect(d.panels.panel).toEqual(['K12', 'IAI39'])
  expect(d.panels.key[1]).not.toMatch(/reversed/)
  const alphas = (panel: string) =>
    new Set(d.nodes.alpha.filter((_, i) => d.nodes.panel[i] === panel))
  expect(Math.min(...alphas('K12'))).toBeLessThan(1)
  expect(Math.max(...alphas('K12'))).toBe(1)
})

test('each lifted walk is keyed with its colour stops as hex', async () => {
  const gfa = read('ecoli_pggb_subgraph.gfa')
  const d = await gfaFigureData(gfa, 'ecoli', {
    engine: 'stress',
    walks: [K12, IAI39],
  })
  expect(d.keys.walk).toEqual(['K12', 'IAI39'])
  expect(d.keys.panel).toEqual(['', ''])
  for (const stops of d.keys.stops) {
    expect(stops).toMatch(/^#[0-9a-f]{6}(,#[0-9a-f]{6})*$/)
  }
  expect(d.walkNames).toEqual(expect.arrayContaining([K12, IAI39]))
  expect(d.keys.name).toEqual([K12, IAI39])
  expect(d.keys.color).toEqual(d.keys.stops)
  expect(d.keys.field).toEqual(['walk', 'walk'])
  const ramped = await gfaFigureData(gfa, 'ecoli', {
    engine: 'stress',
    walks: [{ walk: K12, color: { field: 'progress' } }],
  })
  expect(ramped.keys.field).toEqual(['progress'])
  expect(ramped.keys.color).toEqual([''])
  expect(ramped.keys.contig).toEqual(['chr'])
  expect(ramped.keys.start).toEqual([1004500])
  expect(ramped.keys.end).toEqual([1004961])
  expect(d.threadKeys.note).toEqual([])
  const lifted = d.nodes.walk.filter(w => w !== null)
  expect(new Set(lifted)).toEqual(new Set([0, 1]))
  expect(d.nodes.offset.some(o => o !== 0)).toBe(true)
  const faceted = await gfaFigureData(gfa, 'ecoli', {
    engine: 'stress',
    walks: [K12, IAI39],
    facet: 'walk',
  })
  expect(faceted.keys.panel).toEqual(faceted.panels.panel)
  const walked = [...faceted.nodes.walk.keys()].filter(
    i => faceted.nodes.walk[i] !== null,
  )
  for (const i of walked) {
    expect(faceted.keys.panel[faceted.nodes.walk[i]!]).toBe(
      faceted.nodes.panel[i],
    )
  }
  expect(new Set(faceted.nodes.walk.filter(w => w !== null))).toEqual(
    new Set([0, 1]),
  )
})

test("a figure's force layout is sized for the figure's own width and height, and the figure's defaults where it states none", async () => {
  const text = read('ecoli_rgfa_slice.gfa')
  const atFit = async (fit?: { width: number; height: number }) =>
    (
      await forceLayout(
        loadGraph(text, 'ecoli'),
        engineSettingsOf({ engine: 'stress' }),
        layoutEngine,
        fit,
      )
    ).result.nodePositions
  const laid = async (size: { width?: number; height?: number }) =>
    (
      await laidOutGraph(text, 'ecoli', undefined, {
        engine: 'stress',
        ...size,
      })
    ).layout.nodePositions
  expect(await laid({ width: 900, height: 400 })).toEqual(
    await atFit({ width: 900, height: 400 }),
  )
  expect(await laid({})).toEqual(await atFit({ width: 1200, height: 800 }))
})

test('a gene is pinned, its exons polylines along the nodes under them', async () => {
  const { graph, layout } = await laidOutGraph(
    read('ecoli_rgfa_slice.gfa'),
    'ecoli',
    undefined,
    { engine: 'stress' },
  )
  const { refName, start, end } = graphBackbone(graph)!.contigs[0]!
  const mid = Math.round((start + end) / 2)
  const d = figureData(graph, layout, {
    genes: [
      {
        name: 'geneA',
        refName,
        start,
        end: mid,
        strand: 1,
        exons: [{ start: start + 10, end: mid - 10 }],
      },
    ],
  })
  expect(d.pins.gene).toEqual(['geneA'])
  expect(d.pins.bp).toEqual([mid - start])
  expect(lengths(d.exons).size).toBe(1)
  const nodes = new Set(d.nodeInfo.node)
  expect(d.exons.node.every(n => nodes.has(n))).toBe(true)
  for (const stretch of new Set(d.exons.stretch)) {
    expect(d.exons.stretch.filter(s => s === stretch).length).toBeGreaterThan(1)
  }
  expect(figureData(graph, layout).pins.gene).toEqual([])
})

test('colours are css hex', async () => {
  const d = await gfaFigureData(read('ecoli_pggb_subgraph.gfa'), 'ecoli', {
    engine: 'stress',
  })
  for (const color of [...d.nodes.color, ...d.edges.color]) {
    expect(color).toMatch(/^#[0-9a-f]{6}$/)
  }
})

test('a tube map has no tables yet', () => {
  const graph = loadGraph(read('ecoli_pggb_subgraph.gfa'), 'ecoli')
  const layout = layoutModeByValue('tubemap').run(graph, undefined)
  expect(layout?.tubeMap).toBeDefined()
  expect(() => figureData(graph, layout!)).toThrow(/tube map/)
})

test('a spec is refused its layout where no mode of that name draws nodes, and its engine where no build has it', async () => {
  const text = read('ecoli_pggb_subgraph.gfa')
  const laid = (spec: string) =>
    gfaFigureData(text, 'ecoli', JSON.parse(spec) as GfaFigureSpec)
  const noLayout = (layout: string) =>
    `a figure draws no "${layout}" layout: one of auto, samplerows, ordered, force`
  await expect(laid('{ "layout": "spiral" }')).rejects.toThrow(
    noLayout('spiral'),
  )
  await expect(laid('{ "layout": "walkrows" }')).rejects.toThrow(
    noLayout('walkrows'),
  )
  await expect(laid('{ "layout": "tubemap" }')).rejects.toThrow(
    noLayout('tubemap'),
  )
  await expect(laid('{ "engine": "Stress" }')).rejects.toThrow(
    'no "Stress" layout engine: one of fmmm, stress',
  )
  const drawn = await laid('{ "layout": "ordered", "engine": "stress" }')
  expect(drawn.nodes.x.length).toBeGreaterThan(0)
})

test('a region read from a walk file is laid out from its tables as its GFA text is', async () => {
  const tables = gfaTables(DUP)
  expect(tables).toBeDefined()
  const laid = async (source: Parameters<typeof laidOutGraph>[0]) =>
    (await laidOutGraph(source, 'dup', undefined, { engine: 'stress' })).layout
      .nodePositions
  const fromTables = await laid(tables!)
  expect(Object.keys(fromTables)).toHaveLength(3)
  expect(fromTables).toEqual(await laid(DUP))
})

const DUP = [
  'S\tv1\tAAAA',
  'S\tv2\tCC',
  'S\tv3\tGGG',
  'L\tv1\t+\tv2\t+\t0M',
  'L\tv2\t+\tv3\t+\t0M',
  'L\tv2\t+\tv1\t+\t0M',
  'W\tref\t0\tchr\t0\t9\t>v1>v2>v3',
  'W\tdup\t1\tchr\t0\t15\t>v1>v2>v1>v2>v3',
].join('\n')

test("a pass's name is as tall in the labels table as the figure writes it", async () => {
  const walks: WalkLayer[] = [{ walk: 'dup#1#chr', color: { field: 'pass' } }]
  const { graph, layout } = await laidOutGraph(DUP, 'dup', undefined, {
    engine: 'stress',
  })
  const d = figureData(graph, layout, { walks })
  const passes = d.labels.kind.flatMap((kind, i) =>
    kind === 'pass' ? [{ text: d.labels.text[i], size: d.labels.size[i] }] : [],
  )
  expect(passes).toEqual([
    { text: 'pass 1', size: LABEL_PX },
    { text: 'pass 2', size: LABEL_PX },
  ])
  expect(figureSvg(graph, layout, { walks })).toContain(
    `font-size="${LABEL_PX}" font-weight="bold" fill="${d.labels.color[d.labels.kind.indexOf('pass')]}" text-anchor="middle">pass 1<`,
  )
})

test('walks lifted together where one repeats key a thread per pass, apart from the walks', async () => {
  const d = await gfaFigureData(DUP, 'dup', {
    engine: 'stress',
    walks: ['ref#0#chr', 'dup#1#chr'],
  })
  expect(d.keys.walk).toHaveLength(2)
  expect(d.threadKeys).toEqual({
    panel: [''],
    note: ['a thread per pass through a node'],
  })
  const passes = d.nodes.pass.filter((_, i) => d.nodes.walk[i] === 1)
  expect(new Set(passes)).toEqual(new Set([0, 1]))
  const e = d.edges
  const lane = e.walk.findIndex(w => w === 0)
  const slide = (nx: number, ny: number, offset: number) => [
    nx * offset,
    ny * offset,
  ]
  const start = slide(e.nx[lane]!, e.ny[lane]!, e.offset[lane]!)
  const end = slide(e.nx1[lane]!, e.ny1[lane]!, e.offset1[lane]!)
  for (const v of [...start, ...end]) {
    expect(Number.isFinite(v)).toBe(true)
  }
  expect(Math.hypot(end[0]!, end[1]!)).toBeGreaterThan(0)
})

test('the node table gives each node its share of the haplotypes', async () => {
  const d = await gfaFigureData(read('ecoli_pggb_subgraph.gfa'), 'ecoli', {
    layout: 'auto',
    nodeWidth: 'frequency',
  })
  const frequency = d.nodeInfo.frequency as number[]
  expect(frequency.every(f => f > 0)).toBe(true)
  expect(Math.max(...frequency)).toBeGreaterThanOrEqual(1)
  expect(Math.min(...frequency)).toBeLessThan(1)
})

test('a frequency table names segments over what the walks give', async () => {
  const text = read('ecoli_pggb_subgraph.gfa')
  const name = text
    .split('\n')
    .find(l => l.startsWith('S\t'))!
    .split('\t')[1]!
  const d = await gfaFigureData(text, 'ecoli', {
    layout: 'auto',
    frequencies: { [name]: 0.125 },
  })
  expect(d.nodeInfo.frequency[d.nodeInfo.name.indexOf(name)]).toBe(0.125)
})

test('the dashed key is there only when a drawn deletion stays dashed', async () => {
  const gfa = [
    ...[100, 10, 100].map((n, id) => `S\t${id}\t${'A'.repeat(n)}`),
    'P\tref#0#chr\t0+,1+,2+\t*',
    'P\ta#1#c\t0+,2+\t*',
    ...['0 1', '1 2', '0 2'].map(pair => {
      const [from, to] = pair.split(' ')
      return `L\t${from}\t+\t${to}\t+\t0M`
    }),
  ].join('\n')
  const keyOf = async (walks?: string[]) => {
    const { graphKey } = (
      await gfaFigureData(gfa, 'skip', { engine: 'stress', walks })
    ).meta
    return graphKey.text.find((_, i) => graphKey.key[i] === 'deletion')
  }
  expect(await keyOf()).toMatch(/^skips .+? sequence$/)
  expect(await keyOf(['ref#0#chr'])).toMatch(/^skips .+? sequence$/)
  expect(await keyOf(['a#1#c'])).toBeUndefined()
})

test('the key says a layout under compress is not to scale', async () => {
  const gfa = [
    ...[100, 10, 100].map((n, id) => `S\t${id}\t${'A'.repeat(n)}`),
    'P\tref#0#chr\t0+,1+,2+\t*',
    ...['0 1', '1 2'].map(pair => {
      const [from, to] = pair.split(' ')
      return `L\t${from}\t+\t${to}\t+\t0M`
    }),
  ].join('\n')
  const keyOf = async (bubbleSpread: BubbleSpread) =>
    (await gfaFigureData(gfa, 'chain', { engine: 'stress', bubbleSpread })).meta
      .graphKey.text
  expect(await keyOf('compress')).toContain(COMPRESSED_KEY)
  expect(await keyOf('auto')).not.toContain(COMPRESSED_KEY)
})

test("walk row tiles take their lifted walk's colours as walk rows draw them", () => {
  const gfa = [
    'S\ta\tAAAAAAAAAA',
    'S\tb\tAAAAAAAAAA',
    'S\tx\tCCCCC',
    'S\tc\tAAAAAAAAAA',
    'W\tGRCh38\t0\tchr1\t1000\t1030\t>a>b>c',
    'W\tHG1\t1\tctg1\t500\t525\t>a>x>c',
    'W\tHG2\t1\tctg2\t0\t25\t<c<x<a',
  ].join('\n')
  const graph = loadGraph(gfa, 'test')
  const lift = walkLift(graph, [
    { walk: 'HG1#1#ctg1', color: { field: 'progress' } },
    { walk: 'GRCh38#0#chr1', color: { field: 'reference' } },
  ])!
  const keys = {
    name: lift.walks.map(w => w.name),
    stops: lift.walks.map(w =>
      encodingStops(w.encoding)
        .map(s => abgrHex(s.abgr))
        .join(','),
    ),
    field: lift.walks.map(w => w.encoding.field),
    contig: lift.walks.map(w => w.range?.contig ?? null),
    start: lift.walks.map(w => w.range?.start ?? null),
    end: lift.walks.map(w => w.range?.end ?? null),
  }
  const bars = walkRows(graph)!
  const all = [bars.reference, ...bars.rows]
  const rows = {
    name: all.map(r => r.name),
    bp: all.map(r => r.bp),
    contig: all.map(r => r.axis?.contig ?? null),
    contigStart: all.map(r => r.axis?.start ?? null),
  }
  const hg1 = all.findIndex(r => r.name === 'HG1#1#ctg1')
  const hg2 = all.findIndex(r => r.name === 'HG2#1#ctg2')
  const inks = walkRowInks(keys, rows, {
    row: [hg1, hg1, hg2, 0],
    offset: [0, 7, 3, 3],
  })
  const ink = liftedRowInks(lift.walks)[0]!
  expect(inks.key[hg1]).toBe(keys.name.indexOf('HG1#1#ctg1'))
  expect(inks.key[0]).toBe(keys.name.indexOf('GRCh38#0#chr1'))
  expect(inks.key[hg2]).toBeNull()
  expect(inks.color).toEqual([
    rowInkAt(ink, all[hg1]!, 0),
    rowInkAt(ink, all[hg1]!, 7),
    null,
    null,
  ])
  // and a bar with a stretch away from the window drawn 2 bp wide at 5 bp
  // along it has a tile past the break at the contig's colour there
  const broken = walkRowInks(
    keys,
    rows,
    { row: [hg1], offset: [7] },
    undefined,
    { row: [hg1], at: [5], bp: [10], drawn: [2] },
  )
  expect(broken.color).toEqual([rowInkAt(ink, all[hg1]!, 15)])
})

// R walks three reference nodes; A leaves it for a 75 kb loop the cut did not
// load, a placeholder, and comes back
const UNLOADED = `S\tr1\t*\tLN:i:20000
S\tr2\t*\tLN:i:30000
S\tr3\t*\tLN:i:25000
S\tp1\t*\tLN:i:75000\tnl:i:1
L\tr1\t+\tr2\t+\t0M
L\tr2\t+\tr3\t+\t0M
L\tr1\t+\tp1\t+\t0M
L\tp1\t+\tr3\t+\t0M
W\tR\t0\tchr\t0\t75000\t>r1>r2>r3
W\tA\t1\tchr\t0\t120000\t>r1>p1>r3`

test("the labels table places the canvas's labels: a placeholder's length always, every node's with lengths on", async () => {
  const { graph, layout } = await laidOutGraph(
    UNLOADED,
    'unloaded',
    undefined,
    {
      layout: 'auto',
      referencePath: 'R',
    },
  )
  const width = 900
  const height = 600
  const d = figureData(graph, layout, { width, height, nodeLengths: true })
  const fit = fitTransform(drawingBounds(layout, {}), width, height, true)!
  const axis = axisScaleOf(fit.scale, true)
  const placed = layoutLabels({
    paneWidth: width,
    canvasHeight: height,
    axisScale: axis,
    translateX: fit.translateX,
    translateY: fit.translateY,
    contigThickness: 6,
    legendSize: { width: 0, height: 0 },
    drawnRowLabels: layout.rowLabels ?? [],
    bubbleHalos: [],
    genePins: [],
    nodePositions: layout.nodePositions,
    labelsNodeSizes: true,
    nodeLengths: labelledNodeLengths(graph.nodes, true),
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    graph,
    drawnInk: undefined,
    alleleDeletions: layout.alleleDeletions ?? [],
    positionsVersion: 0,
    folded: new Set(listed(d.sites?.nodes)),
  })
  expect(d.labels.text).toEqual(placed.sizes.map(l => l.text))
  expect(d.labels.kind[0]).toBe('placeholder')
  expect(d.labels.text[0]).toBe('75 kb')
  expect(d.labels.kind.slice(1).every(k => k === 'length')).toBe(true)
  d.labels.x.forEach((x, i) => {
    expect(x * axis.scaleX + fit.translateX).toBeCloseTo(placed.sizes[i]!.x)
    expect(d.labels.y[i]! * axis.scaleY + fit.translateY).toBeCloseTo(
      placed.sizes[i]!.y,
    )
  })
  const plain = figureData(graph, layout, {
    width,
    height,
    nodeLengths: false,
  })
  expect(plain.labels.text).toEqual(['75 kb'])
  const hollow = plain.meta.graphKey.key.indexOf('not-shown')
  expect(plain.meta.graphKey.swatch[hollow]).toBe('hollow')
  expect(plain.meta.graphKey.color[hollow]).toBe(
    plain.meta.inks.placeholderFill,
  )
  expect(plain.meta.graphKey.rim[hollow]).toBe(plain.meta.inks.placeholderRim)
})

test("a gene's name is labelled with its leader to its pin, and the inks are the canvas's", async () => {
  const { graph, layout } = await laidOutGraph(
    read('ecoli_rgfa_slice.gfa'),
    'ecoli',
    undefined,
    { layout: 'auto' },
  )
  const { refName, start, end } = graphBackbone(graph)!.contigs[0]!
  const d = figureData(graph, layout, {
    genes: [
      {
        name: 'geneA',
        refName,
        start,
        end,
        strand: 1,
        exons: [{ start: start + 10, end: end - 10 }],
      },
    ],
  })
  const gene = d.labels.kind.indexOf('gene')
  expect(d.labels.item[gene]).toBe('geneA')
  expect(d.labels.x1[gene]).not.toBeNull()
  expect(d.labels.y2[gene]).not.toBeNull()
  expect(d.meta.inks.exon).toBe(EXON_COLOR)
  expect(d.meta.inks.ramp).toHaveLength(7)
  const exon = d.meta.graphKey.key.indexOf('exon')
  expect(d.meta.graphKey.color[exon]).toBe(EXON_COLOR)
})

// a 1 bp SNP taken by one of three walks and a 1 bp deletion taken by two,
// each under 3 px at a 1200 px fit of a 2 kb reference
test('the sites table lists each folded site, its nodes and links each once and none drawn, and meta states the mode and threshold', () => {
  const graph = loadGraph(
    [
      `S\tr1\t${'A'.repeat(1000)}`,
      'S\tr2\tC',
      `S\tr3\t${'A'.repeat(500)}`,
      'S\tr4\tG',
      `S\tr5\t${'A'.repeat(500)}`,
      'S\ta1\tT',
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr2\t+\tr3\t+\t0M',
      'L\tr3\t+\tr4\t+\t0M',
      'L\tr4\t+\tr5\t+\t0M',
      'L\tr1\t+\ta1\t+\t0M',
      'L\ta1\t+\tr3\t+\t0M',
      'L\tr3\t+\tr5\t+\t0M',
      'W\tref\t0\tchr\t0\t2002\t>r1>r2>r3>r4>r5',
      'W\tw\t1\tchr\t0\t*\t>r1>a1>r3>r5',
      'W\tw\t2\tchr\t0\t*\t>r1>r2>r3>r5',
    ].join('\n'),
    'sites',
  )
  const at = (x0: number, x1: number, y = 0) => [
    { x: x0, y },
    { x: x1, y },
  ]
  const layout = {
    nodePositions: {
      'r1+': at(0, 1000),
      'r2+': at(1000, 1001),
      'r3+': at(1001, 1501),
      'r4+': at(1501, 1502),
      'r5+': at(1502, 2002),
      'a1+': at(1000, 1001, 0.25),
    },
  }
  const d = figureData(graph, layout)
  const index = (from: string, to: string) =>
    graph.edges.findIndex(e => e.from === from && e.to === to)
  const into = index('r1+', 'a1+')
  const out = index('a1+', 'r3+')
  const skip = index('r3+', 'r5+')
  expect(d.sites).toEqual({
    site: [0, 1],
    refName: ['ref#0#chr', 'ref#0#chr'],
    start: [1000, 1501],
    end: [1001, 1502],
    bp: [2, 1],
    x: [1000.5, 1501.5],
    y: [0, 0],
    count: [1, 2],
    total: [3, 3],
    nodes: ['a1+', ''],
    links: [[into, out].join(','), `${skip}`],
    laneNodes: ['', ''],
    laneLinks: ['', ''],
  })
  const lifted = figureData(graph, layout, {
    walks: [{ walk: 'w#1#chr' }, { walk: 'w#2#chr' }],
  })
  expect(lifted.sites?.laneNodes).toEqual(['r2+', 'r4+'])
  expect(lifted.sites?.laneLinks).toEqual(['', ''])
  expect(lifted.nodes.node).not.toContain('r2+')
  expect(lifted.nodes.node).not.toContain('r4+')
  const links = (d.sites?.links ?? []).flatMap(ids =>
    ids.split(',').map(Number),
  )
  const byIndex = (a: number, b: number) => a - b
  expect(links.toSorted(byIndex)).toEqual([into, out, skip].toSorted(byIndex))
  expect(d.nodes.node).not.toContain('a1+')
  for (const edge of links) {
    expect(d.edges.edge).not.toContain(edge)
  }
  expect(d.meta.smallSites?.mode).toBe('hidden')
  expect(d.meta.smallSites?.px).toBe(SMALL_SITE_PX)
  expect(d.meta.smallSites?.bp).toBe(3)
  const keyRow = d.meta.graphKey.key.indexOf('too-small')
  expect(d.meta.graphKey.text[keyRow]).toBe(
    '1 node and 1 skip under 3 bp not drawn',
  )
  expect(d.meta.graphKey.swatch[keyRow]).toBe('')
  const nodes = figureData(graph, layout, { smallSites: 'nodes' })
  expect(nodes.sites).toBeUndefined()
  expect(nodes.meta.smallSites).toBeUndefined()
  expect(Object.keys(nodes)).not.toContain('sites')
  expect(Object.keys(nodes.meta)).not.toContain('smallSites')
  expect(nodes.nodes.node).toContain('a1+')
  expect(nodes.meta.graphKey.key).not.toContain('too-small')
})

// A 5 bp loop the cut did not load, a placeholder, between 10 kb flanks: at
// a 1200 px figure it is well under SMALL_SITE_PX
const SMALL_LOOP = [
  `S\tr1\t${'A'.repeat(10_000)}`,
  'S\tr2\tC',
  `S\tr3\t${'A'.repeat(10_000)}`,
  'S\tp1\t*\tLN:i:5\tnl:i:1',
  'L\tr1\t+\tr2\t+\t0M',
  'L\tr2\t+\tr3\t+\t0M',
  'L\tr1\t+\tp1\t+\t0M',
  'L\tp1\t+\tr3\t+\t0M',
  'W\tR\t0\tchr\t0\t20001\t>r1>r2>r3',
  'W\tA\t1\tchr\t0\t*\t>r1>p1>r3',
].join('\n')
const smallLoopLayout = {
  nodePositions: {
    'r1+': [
      { x: 0, y: 0 },
      { x: 10_000, y: 0 },
    ],
    'r2+': [
      { x: 10_000, y: 0 },
      { x: 10_001, y: 0 },
    ],
    'r3+': [
      { x: 10_001, y: 0 },
      { x: 20_001, y: 0 },
    ],
    'p1+': [
      { x: 10_000, y: 200 },
      { x: 10_001, y: 200 },
    ],
  },
}

test('the labels table holds no length for a placeholder the figure folded, and holds it with small sites drawn as nodes', () => {
  const loop = loadGraph(SMALL_LOOP, 'loop', { referencePath: 'R' })
  const drawn = figureData(loop, smallLoopLayout, {
    smallSites: 'nodes',
    nodeLengths: false,
  })
  expect(drawn.labels.text).toEqual(['5 bp'])
  expect(drawn.labels.item).toEqual(['p1+'])
  const folded = figureData(loop, smallLoopLayout, { nodeLengths: false })
  expect(listed(folded.sites?.nodes)).toEqual(['p1+'])
  expect(folded.labels.text).toEqual([])
})

test('a gene on a folded allele is still pinned and listed over its node, with no exon outlined where its node is not drawn', () => {
  const graph = loadGraph(
    [
      `S\tr1\t${'A'.repeat(10_000)}`,
      'S\tr2\tC',
      `S\tr3\t${'A'.repeat(10_000)}`,
      'S\ta1\tT',
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr2\t+\tr3\t+\t0M',
      'L\tr1\t+\ta1\t+\t0M',
      'L\ta1\t+\tr3\t+\t0M',
      'W\tR\t0\tchr\t0\t20001\t>r1>r2>r3',
      'W\tA\t1\tchr\t0\t20001\t>r1>a1>r3',
    ].join('\n'),
    'allele',
    { referencePath: 'R' },
  )
  const at = (x0: number, x1: number, y = 0) => [
    { x: x0, y },
    { x: x1, y },
  ]
  const layout = {
    nodePositions: {
      'r1+': at(0, 10_000),
      'r2+': at(10_000, 10_001),
      'r3+': at(10_001, 20_001),
      'a1+': at(10_000, 10_001, 2),
    },
  }
  const genes = [
    {
      name: 'ONA1',
      refName: 'A#1#chr',
      start: 10_000,
      end: 10_001,
      strand: 1,
      exons: [{ start: 10_000, end: 10_001 }],
    },
  ]
  const walks = [{ walk: 'A#1#chr' }]
  const d = figureData(graph, layout, { genes, walks })
  expect(listed(d.sites?.nodes)).toContain('a1+')
  expect(d.nodes.node).not.toContain('a1+')
  expect(d.pins.gene).toEqual(['ONA1'])
  expect(d.exons.node).not.toContain('a1+')
  const pins = genePins(graph, genes, layout.nodePositions, false)
  expect(genesOverNode(pins, 'a1+')).toEqual(['ONA1 · A#1'])
  const drawn = figureData(graph, layout, {
    genes,
    walks,
    smallSites: 'nodes',
  })
  expect(drawn.pins).toEqual(d.pins)
  expect(drawn.exons.node).toContain('a1+')
})

test('a link turning strand against the reference is marked turn on its rows, as the canvas paints it over the nodes, and no other link is', () => {
  const graph = loadGraph(
    [
      `S\tA\t${'A'.repeat(10)}`,
      `S\tB\t${'C'.repeat(10)}`,
      `S\tC\t${'G'.repeat(10)}`,
      'L\tA\t+\tB\t-\t0M',
      'L\tB\t-\tC\t+\t0M',
      'L\tA\t+\tC\t-\t0M',
      'W\tR\t0\tchr\t0\t30\t>A<B>C',
      'W\tT\t1\tchr\t0\t20\t>A<C',
    ].join('\n'),
    'turn',
    { referencePath: 'R' },
  )
  const layout = {
    nodePositions: Object.fromEntries(
      graph.nodes.map((n, i) => [
        n.id,
        [
          { x: 20 * i, y: 0 },
          { x: 20 * i + 10, y: 0 },
        ],
      ]),
    ),
  }
  const named = (id: string) => id.slice(0, -1)
  const turning = graph.edges.findIndex(
    e => [named(e.from), named(e.to)].sort().join() === 'A,C',
  )
  expect(turning).toBeGreaterThanOrEqual(0)
  for (const walks of [undefined, [{ walk: 'R#0#chr' }]]) {
    const d = figureData(graph, layout, { walks, smallSites: 'nodes' })
    expect(d.edges.turn).toHaveLength(d.edges.edge.length)
    const turned = new Set(d.edges.edge.filter((_, i) => d.edges.turn[i]))
    expect([...turned]).toEqual([turning])
  }
})

test('a plain link whose ends lie apart along a node is marked along on its rows, as the canvas paints it over the nodes, and no other link is', () => {
  const graph = loadGraph(
    [
      `S\tA\t${'A'.repeat(10)}`,
      `S\tX\t${'C'.repeat(10)}`,
      `S\tY\t${'G'.repeat(10)}`,
      `S\tZ\t${'T'.repeat(10)}`,
      `S\tD\t${'A'.repeat(10)}`,
      'L\tA\t+\tD\t+\t0M',
      'L\tA\t+\tX\t+\t0M',
      'L\tX\t+\tY\t+\t0M',
      'L\tY\t+\tZ\t+\t0M',
      'L\tX\t+\tZ\t+\t0M',
      'L\tZ\t+\tD\t+\t0M',
      'W\tR\t0\tchr\t0\t20\t>A>D',
      'W\tT\t1\tchr\t0\t*\t>A>X>Z>D',
      'W\tU\t1\tchr\t0\t*\t>A>X>Y>Z>D',
    ].join('\n'),
    'along',
    { referencePath: 'R' },
  )
  const laid: Record<string, [number, number, number]> = {
    A: [0, 10, 0],
    X: [10, 20, 20],
    Y: [20, 30, 20],
    Z: [30, 40, 20],
    D: [40, 50, 0],
  }
  const named = (id: string) => id.slice(0, -1)
  const layout = {
    nodePositions: Object.fromEntries(
      graph.nodes.map(n => {
        const [x0, x1, y] = laid[named(n.id)]!
        return [
          n.id,
          [
            { x: x0, y },
            { x: x1, y },
          ],
        ]
      }),
    ),
  }
  const skipping = graph.edges.findIndex(
    e => named(e.from) === 'X' && named(e.to) === 'Z',
  )
  expect(skipping).toBeGreaterThanOrEqual(0)
  for (const walks of [undefined, [{ walk: 'T#1#chr' }]]) {
    const d = figureData(graph, layout, { walks, smallSites: 'nodes' })
    expect(d.edges.along).toHaveLength(d.edges.edge.length)
    const along = new Set(d.edges.edge.filter((_, i) => d.edges.along[i]))
    expect([...along]).toEqual([skipping])
  }
})

test('with walks lifted across a folded site, a gene over a reference node the lanes alone draw there is outlined nowhere, in the exons table or the figure', () => {
  const graph = loadGraph(
    [
      `S\tr1\t${'A'.repeat(10_000)}`,
      'S\tr2\tC',
      `S\tr3\t${'A'.repeat(10_000)}`,
      'L\tr1\t+\tr2\t+\t0M',
      'L\tr2\t+\tr3\t+\t0M',
      'L\tr1\t+\tr3\t+\t0M',
      'W\tR\t0\tchr\t0\t20001\t>r1>r2>r3',
      'W\tA\t1\tchr\t0\t20000\t>r1>r3',
    ].join('\n'),
    'skip',
    { referencePath: 'R' },
  )
  const at = (x0: number, x1: number, y = 0) => [
    { x: x0, y },
    { x: x1, y },
  ]
  const layout = {
    nodePositions: {
      'r1+': at(0, 10_000),
      'r2+': at(10_000, 10_001),
      'r3+': at(10_001, 20_001),
    },
  }
  const genes = [
    {
      name: 'ONR2',
      refName: 'R#0#chr',
      start: 9_990,
      end: 10_011,
      strand: 1,
      exons: [{ start: 9_990, end: 10_011 }],
    },
  ]
  const walks = [{ walk: 'R#0#chr' }, { walk: 'A#1#chr' }]
  const d = figureData(graph, layout, { genes, walks })
  expect(listed(d.sites?.laneNodes)).toEqual(['r2+'])
  expect(d.nodes.node).not.toContain('r2+')
  expect(d.pins.gene).toEqual(['ONR2'])
  expect(new Set(d.exons.node)).toEqual(new Set(['r1+', 'r3+']))
  const drawn = figureData(graph, layout, {
    genes,
    walks,
    smallSites: 'nodes',
  })
  expect(new Set(drawn.exons.node)).toEqual(new Set(['r1+', 'r2+', 'r3+']))
  const outlined = (smallSites: 'hidden' | 'nodes') =>
    (
      /<mask[\s\S]*?<\/mask>/.exec(
        figureSvg(graph, layout, { genes, walks, smallSites }),
      )?.[0] ?? ''
    ).match(/<path /g)?.length
  expect(outlined('nodes')).toBe(2 * 3)
  expect(outlined('hidden')).toBe(2 * 2)
})
