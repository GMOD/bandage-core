import { readFileSync } from 'fs'
import { join } from 'path'

import { gfaFigureData } from './figureData'

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
