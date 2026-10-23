import { readFileSync } from 'fs'
import { join } from 'path'

import { figureData, gfaFigureData, laidOutGraph } from './figureData'
import { graphBackbone } from './reference'

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
  for (const table of [d.nodes, d.edges, d.arrows, d.nodeInfo, d.rowLabels]) {
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

test('every drawn node is in the node table', async () => {
  const d = await gfaFigureData(read('ecoli_pggb_subgraph.gfa'), 'ecoli', {
    engine: 'stress',
  })
  expect(new Set(d.nodes.node)).toEqual(new Set(d.nodeInfo.node))
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
  expect(d.panels.key[1]).toMatch(/reversed/)
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
  faceted.nodes.walk.forEach((w, i) => {
    if (w !== null) {
      expect(faceted.keys.panel[w]).toBe(faceted.nodes.panel[i])
    }
  })
  expect(new Set(faceted.nodes.walk.filter(w => w !== null))).toEqual(
    new Set([0, 1]),
  )
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

test('a tube map has no tables yet', async () => {
  await expect(
    gfaFigureData(read('ecoli_pggb_subgraph.gfa'), 'ecoli', {
      layout: 'tubemap',
    }),
  ).rejects.toThrow(/tube map/)
})

test('walks lifted together where one repeats key a thread per pass, apart from the walks', async () => {
  const gfa = [
    'S\tv1\tAAAA',
    'S\tv2\tCC',
    'S\tv3\tGGG',
    'L\tv1\t+\tv2\t+\t0M',
    'L\tv2\t+\tv3\t+\t0M',
    'L\tv2\t+\tv1\t+\t0M',
    'W\tref\t0\tchr\t0\t9\t>v1>v2>v3',
    'W\tdup\t1\tchr\t0\t15\t>v1>v2>v1>v2>v3',
  ].join('\n')
  const d = await gfaFigureData(gfa, 'dup', {
    engine: 'stress',
    walks: ['ref#0#chr', 'dup#1#chr'],
  })
  expect(d.keys.walk).toHaveLength(2)
  expect(d.threadKeys).toEqual({
    panel: [''],
    note: ['a thread per pass through a node'],
  })
  const passes = d.nodes.pass.filter((p, i) => d.nodes.walk[i] === 1)
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
