import { existsSync, readFileSync } from 'fs'

import { filterSamples, walkRows } from './walkRows'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { anchorGraph, pathOrigin } from '../pathAnchoring'

function pggbGraph() {
  const gfa = readFileSync(
    require.resolve('../../test_data/ecoli_pggb_subgraph.gfa'),
    'utf8',
  )
  return anchorGraph(convertGFAToGraph(parseGFA(gfa), 'pggb'), 'K12')
}

const KIV2 = '.test-jbrowse-variants/test_data/graphgenomeview/kiv2_eight.gfa'

test('one row per non-reference path, longest first, bp summed over its nodes', () => {
  const graph = pggbGraph()
  const result = walkRows(graph)!
  expect(result.reference.label).toBe('K12')
  expect(result.rows.map(r => r.label).sort()).toEqual([
    'CFT073',
    'IAI39',
    'NCTC86',
    'Sakai',
  ])
  for (let i = 1; i < result.rows.length; i++) {
    expect(result.rows[i - 1]!.bp).toBeGreaterThanOrEqual(result.rows[i]!.bp)
  }
  const byId = new Map(graph.nodes.map(n => [n.id, n.length]))
  for (const row of [result.reference, ...result.rows]) {
    const path = graph.paths!.find(p => p.name === row.name)!
    const total = path.nodeIds.reduce((s, id) => s + byId.get(id)!, 0)
    expect(row.bp).toBe(total)
    expect(row.runs.reduce((s, r) => s + r.bp, 0)).toBe(total)
    expect(row.complete).toBe(true)
  }
  expect(result.reference.offReferenceBp).toBe(0)
})

test('runs cover the row without gaps, splitting shared sequence where its reference jumps', () => {
  const { rows } = walkRows(pggbGraph())!
  for (const row of rows) {
    let pos = 0
    row.runs.forEach((run, i) => {
      expect(run.start).toBe(pos)
      const prev = row.runs[i - 1]
      if (prev?.onReference && run.onReference) {
        expect(run.referenceStart).not.toBe(prev.referenceStart! + prev.bp)
      } else if (prev) {
        expect(run.onReference).not.toBe(prev.onReference)
      }
      expect(run.referenceStart !== undefined).toBe(run.onReference)
      pos += run.bp
    })
  }
})

test('the reference row is one run spanning its own coordinates', () => {
  const graph = pggbGraph()
  const { reference, origin } = walkRows(graph)!
  expect(reference.runs).toEqual([
    {
      start: 0,
      bp: reference.bp,
      onReference: true,
      referenceStart: origin,
    },
  ])
})

test('a region measures between its flanking reference nodes', () => {
  const graph = pggbGraph()
  const byId = new Map(graph.nodes.map(n => [n.id, n.length]))
  const reference = graph.paths!.find(
    p => pathOrigin(p.name).name === graph.referencePath,
  )!
  const start = graph.anchorPaths!.find(
    p => p.name === graph.referencePath,
  )!.start
  const ends = [start]
  for (const id of reference.nodeIds) {
    ends.push(ends.at(-1)! + byId.get(id)!)
  }
  const n = reference.nodeIds.length
  // flanks are the 2nd node and the 2nd-to-last, so the slice is nodes 2..n-3
  const region = { start: ends[2]!, end: ends[n - 2]! }
  const cut = walkRows(graph, region)!
  expect(cut.origin).toBe(region.start)
  expect(cut.reference.bp).toBe(ends[n - 2]! - ends[2]!)
  expect(cut.reference.complete).toBe(true)
  const whole = walkRows(graph)!
  expect(cut.reference.bp).toBeLessThan(whole.reference.bp)
})

test("a row's visits step through its bar, each at its bp offset", () => {
  const graph = pggbGraph()
  const byId = new Map(graph.nodes.map(n => [n.id, n.length]))
  const reference = graph.paths!.find(
    p => pathOrigin(p.name).name === graph.referencePath,
  )!
  const start = graph.anchorPaths!.find(
    p => p.name === graph.referencePath,
  )!.start
  const ends = [start]
  for (const id of reference.nodeIds) {
    ends.push(ends.at(-1)! + byId.get(id)!)
  }
  const n = reference.nodeIds.length
  const region = { start: ends[2]!, end: ends[n - 2]! }
  expect(walkRows(graph, region)!.reference.visits).toBeUndefined()
  const cut = walkRows(graph, region, undefined, { visits: true })!
  expect(cut.reference.visits!.map(v => v.node)).toEqual(
    reference.nodeIds.slice(2, n - 2),
  )
  for (const row of [cut.reference, ...cut.rows]) {
    let bp = 0
    for (const visit of row.visits!) {
      expect(visit.start).toBe(bp)
      const run = row.runs.find(
        r => r.start <= visit.start && visit.start < r.start + r.bp,
      )!
      expect(visit.onReference).toBe(run.onReference)
      bp += byId.get(visit.node)!
    }
    expect(bp).toBe(row.bp)
  }
})

test('a walk that stops inside a flanked region reads partial', () => {
  const graph = pggbGraph()
  const byId = new Map(graph.nodes.map(n => [n.id, n.length]))
  const reference = graph.paths!.find(
    p => pathOrigin(p.name).name === graph.referencePath,
  )!
  const start = graph.anchorPaths!.find(
    p => p.name === graph.referencePath,
  )!.start
  const ends = [start]
  for (const id of reference.nodeIds) {
    ends.push(ends.at(-1)! + byId.get(id)!)
  }
  const n = reference.nodeIds.length
  const region = { start: ends[2]!, end: ends[n - 2]! }
  // an assembly whose contig ends halfway through the region
  const truncated = {
    ...reference,
    name: 'truncated',
    nodeIds: reference.nodeIds.slice(0, Math.floor(n / 2)),
  }
  const cut = walkRows(
    { ...graph, paths: [...graph.paths!, truncated] },
    region,
  )!
  const row = cut.rows.find(r => r.name === 'truncated')!
  expect(row.complete).toBe(false)
  expect(row.stop).toEqual({ contigEnds: true, shortBp: 0 })
  expect(row.bp).toBe(ends[Math.floor(n / 2)]! - region.start)
})

test('a walk whose contig ends before the region says how far short', () => {
  const graph = pggbGraph()
  const byId = new Map(graph.nodes.map(n => [n.id, n.length]))
  const reference = graph.paths!.find(
    p => pathOrigin(p.name).name === graph.referencePath,
  )!
  const start = graph.anchorPaths!.find(
    p => p.name === graph.referencePath,
  )!.start
  const ends = [start]
  for (const id of reference.nodeIds) {
    ends.push(ends.at(-1)! + byId.get(id)!)
  }
  const n = reference.nodeIds.length
  const region = { start: ends[3]!, end: ends[n - 2]! }
  const short = {
    ...reference,
    name: 'short',
    nodeIds: reference.nodeIds.slice(0, 2),
  }
  const row = walkRows(
    { ...graph, paths: [...graph.paths!, short] },
    region,
  )!.rows.find(r => r.name === 'short')!
  expect(row.bp).toBe(0)
  expect(row.stop).toEqual({ contigEnds: true, shortBp: ends[3]! - ends[2]! })
})

test('a walk that leaves the reference and does not come back stops off it', () => {
  const graph = pggbGraph()
  const byId = new Map(graph.nodes.map(n => [n.id, n.length]))
  const reference = graph.paths!.find(
    p => pathOrigin(p.name).name === graph.referencePath,
  )!
  const onReference = new Set(reference.nodeIds)
  const off = graph.nodes.find(node => !onReference.has(node.id))!
  const start = graph.anchorPaths!.find(
    p => p.name === graph.referencePath,
  )!.start
  const ends = [start]
  for (const id of reference.nodeIds) {
    ends.push(ends.at(-1)! + byId.get(id)!)
  }
  const n = reference.nodeIds.length
  const region = { start: ends[2]!, end: ends[n - 2]! }
  const open = {
    ...reference,
    name: 'open',
    nodeIds: [...reference.nodeIds.slice(0, 3), off.id],
  }
  const row = walkRows(
    { ...graph, paths: [...graph.paths!, open] },
    region,
  )!.rows.find(r => r.name === 'open')!
  expect(row.complete).toBe(false)
  expect(row.stop).toEqual({ contigEnds: false, shortBp: 0 })
  expect(row.bp).toBe(byId.get(reference.nodeIds[2]!)! + off.length)
})

test('a walk that skips the flanking node is cut at the next one it visits', () => {
  const graph = pggbGraph()
  const byId = new Map(graph.nodes.map(n => [n.id, n.length]))
  const reference = graph.paths!.find(
    p => pathOrigin(p.name).name === graph.referencePath,
  )!
  const start = graph.anchorPaths!.find(
    p => p.name === graph.referencePath,
  )!.start
  const ends = [start]
  for (const id of reference.nodeIds) {
    ends.push(ends.at(-1)! + byId.get(id)!)
  }
  const n = reference.nodeIds.length
  const region = { start: ends[3]!, end: ends[n - 3]! }
  const skipper = {
    ...reference,
    name: 'skipper',
    nodeIds: reference.nodeIds.filter((_, i) => i !== 2 && i !== n - 3),
  }
  const cut = walkRows({ ...graph, paths: [...graph.paths!, skipper] }, region)!
  const row = cut.rows.find(r => r.name === 'skipper')!
  expect(row.complete).toBe(true)
  expect(row.bp).toBe(cut.reference.bp)
})

// The numbers scripts/layout-lab/copycount.mjs reports for the hosted
// eight-haplotype KIV-2 cut: GRCh38 about 33 kb through the window, HG00133
// about 149 kb, so HG00133 carries roughly 21 more units of 5,548 bp.
test.skipIf(!existsSync(KIV2))(
  'KIV-2: HG00133 carries ~116 kb GRCh38 does not',
  () => {
    const graph = anchorGraph(
      convertGFAToGraph(parseGFA(readFileSync(KIV2, 'utf8')), 'kiv2'),
      'GRCh38',
    )
    const result = walkRows(graph)!
    expect(result.reference.label).toBe('GRCh38#0')
    expect(result.reference.bp).toBeGreaterThan(32_000)
    expect(result.reference.bp).toBeLessThan(34_000)
    expect(result.rows[0]!.label).toBe('HG00133#1')
    expect(result.rows[0]!.bp).toBeGreaterThan(145_000)
    expect(result.rows[0]!.offReferenceBp / 5548).toBeGreaterThan(19)
    expect(result.rows.map(r => r.label)).toHaveLength(8)
  },
)

test('every piece of a walk draws, joined into its row, whatever it meets', () => {
  const graph = pggbGraph()
  const reference = graph.paths!.find(
    p => pathOrigin(p.name).name === graph.referencePath,
  )!
  const onReference = new Set(reference.nodeIds)
  const offReference = graph.nodes
    .filter(n => !onReference.has(n.id))
    .map(n => n.id)
    .slice(0, 2)
  expect(offReference.length).toBeGreaterThan(0)
  const walk = graph.paths!.find(p => p !== reference)!
  const stray = { ...walk, nodeIds: offReference }
  const lone = { ...walk, name: 'lone', nodeIds: offReference }
  const rows = walkRows({
    ...graph,
    paths: [...graph.paths!, stray, lone],
  })!
  expect(rows.rows.filter(r => r.name === walk.name)).toHaveLength(1)
  expect(rows.rows.filter(r => r.name === 'lone')).toHaveLength(1)
})

test('a cut that stops at the window leaves whole walks, not partial ones', () => {
  const graph = pggbGraph()
  const byId = new Map(graph.nodes.map(n => [n.id, n.length]))
  const reference = graph.paths!.find(
    p => pathOrigin(p.name).name === graph.referencePath,
  )!
  const start = graph.anchorPaths!.find(
    p => p.name === graph.referencePath,
  )!.start
  let end = start
  for (const id of reference.nodeIds) {
    end += byId.get(id)!
  }
  // the region IS the reference walk, so no node lies outside it
  const rows = walkRows(graph, { start, end })!
  expect(rows.rows.every(r => r.complete)).toBe(true)
  expect(rows.reference.complete).toBe(true)
})

test('a walk that crosses the window backwards reads in reference direction', () => {
  const graph = pggbGraph()
  const byId = new Map(graph.nodes.map(n => [n.id, n.length]))
  const reference = graph.paths!.find(
    p => pathOrigin(p.name).name === graph.referencePath,
  )!
  const start = graph.anchorPaths!.find(
    p => p.name === graph.referencePath,
  )!.start
  const ends = [start]
  for (const id of reference.nodeIds) {
    ends.push(ends.at(-1)! + byId.get(id)!)
  }
  const n = reference.nodeIds.length
  const region = { start: ends[2]!, end: ends[n - 2]! }
  const forward = walkRows(graph, region)!.rows.find(
    r => r.complete && r.runs.length > 1,
  )!
  expect(forward).toBeDefined()
  const path = graph.paths!.find(p => p.name === forward.name)!
  const backwards = {
    ...path,
    name: 'backwards',
    nodeIds: [...path.nodeIds].reverse(),
  }
  const cut = walkRows(
    { ...graph, paths: [...graph.paths!, backwards] },
    region,
  )!
  const row = cut.rows.find(r => r.name === 'backwards')!
  expect(row.complete).toBe(true)
  expect(row.runs).toEqual(forward.runs)
})

test('a walk crossing the reference backwards with no cut keeps its runs whole', () => {
  const graph = pggbGraph()
  const forward = walkRows(graph)!.rows.find(r =>
    r.runs.some(run => run.onReference && run.bp > 100 && !run.reversed),
  )!
  const path = graph.paths!.find(p => p.name === forward.name)!
  const backwards = {
    ...path,
    name: 'backwards',
    nodeIds: [...path.nodeIds].reverse(),
  }
  const row = walkRows({
    ...graph,
    paths: [...graph.paths!, backwards],
  })!.rows.find(r => r.name === 'backwards')!
  expect(row.runs.map(r => [r.bp, r.referenceStart])).toEqual(
    forward.runs.map(r => [r.bp, r.referenceStart]).reverse(),
  )
  expect(row.runs.filter(r => r.onReference && r.reversed)).not.toHaveLength(0)
})

test('a reference walking a node again stays one run on its own coordinates', () => {
  const graph = pggbGraph()
  const reference = graph.paths!.find(
    p => pathOrigin(p.name).name === graph.referencePath,
  )!
  const first = reference.nodeIds[0]!
  const looped = { ...reference, nodeIds: [...reference.nodeIds, first] }
  const { reference: row, origin } = walkRows({
    ...graph,
    paths: graph.paths!.map(p => (p === reference ? looped : p)),
  })!
  expect(row.runs).toHaveLength(1)
  expect(row.runs[0]!.referenceStart).toBe(origin)
})

// GRCh38's C4A and C4B collapsed onto one copy's nodes, as syng builds them:
// the reference walks the unit (1, 2) twice, and 4 only its second copy holds
function collapsedRepeat(haplotypes: Record<string, string[]>) {
  const lengths: Record<string, number> = {
    0: 100,
    1: 10,
    2: 20,
    3: 100,
    4: 5,
    5: 5,
  }
  const paths = {
    'ref#0#chr': ['0', '1', '2', '1', '4', '2', '3'],
    ...haplotypes,
  }
  const gfa = [
    ...Object.entries(lengths).map(([id, n]) => `S\t${id}\t${'A'.repeat(n)}`),
    ...Object.entries(paths).map(
      ([name, ids]) => `P\t${name}\t${ids.map(id => `${id}+`).join(',')}\t*`,
    ),
  ].join('\n')
  return walkRows(
    anchorGraph(convertGFAToGraph(parseGFA(gfa), 'repeat'), 'ref'),
  )!
}

const runsOf = (row: { runs: { bp: number; referenceStart?: number }[] }) =>
  row.runs.map(r => [r.bp, r.referenceStart])

test('a reference walking a collapsed repeat twice is one smooth run', () => {
  const { reference } = collapsedRepeat({ 'a#1#c': ['0', '3'] })
  expect(runsOf(reference)).toEqual([[265, 0]])
})

test('a haplotype matching the reference copy for copy takes its runs', () => {
  const { reference, rows } = collapsedRepeat({
    'a#1#c': ['0', '1', '2', '1', '4', '2', '3'],
  })
  expect(runsOf(rows[0]!)).toEqual(runsOf(reference))
})

test('each copy of a collapsed repeat follows the reference copy it continues', () => {
  const { rows } = collapsedRepeat({
    'three#1#c': ['0', '1', '2', '1', '4', '2', '1', '4', '2', '3'],
    'snp#1#c': ['0', '1', '2', '1', '5', '2', '3'],
  })
  const three = rows.find(r => r.label === 'three')!
  expect(runsOf(three)).toEqual([
    [165, 0],
    [135, 130],
  ])
  const snp = rows.find(r => r.label === 'snp')!
  expect(runsOf(snp)).toEqual([
    [140, 0],
    [5, undefined],
    [120, 145],
  ])
})

test('a graph naming no reference takes every piece of its first path as the reference', () => {
  const nodes = ['0', '1', '2', '3', '4'].map(id => ({
    id,
    name: id,
    length: 1000,
    depth: 1,
  }))
  const path = (name: string, nodeIds: string[], start: number) => ({
    name,
    nodeIds,
    start,
  })
  const graph = {
    name: 'split',
    nodes,
    edges: [],
    paths: [
      path('GRCh38#0#chr1', ['0', '1'], 0),
      path('GRCh38#0#chr1', ['3', '4'], 3000),
      path('A#1#a', ['0', '1', '2', '3', '4'], 0),
    ],
  }
  const region = { start: 2200, end: 2800 }
  const unnamed = walkRows(graph, region)!
  expect(unnamed.rows.map(r => r.name)).toEqual(['A#1#a'])
  expect(unnamed.rows[0]).toMatchObject({ bp: 1000, complete: true })
  expect(unnamed).toEqual(
    walkRows({ ...graph, referencePath: 'GRCh38#0#chr1' }, region),
  )
})

test("a tag-anchored graph's reference is the sequence its rank 0 segments name", () => {
  const stable = (refName: string, start: number, rank: number) => ({
    refName,
    start,
    rank,
  })
  const graph = {
    name: 'tagged',
    nodes: [
      { id: '0', stable: stable('GRCh38#0#chr1', 0, 0) },
      { id: '1', stable: stable('A#1#a', 1000, 1) },
      { id: '2', stable: stable('GRCh38#0#chr1', 1000, 0) },
    ].map(n => ({ ...n, name: n.id, length: 1000, depth: 1 })),
    edges: [],
    anchoredBy: 'tags' as const,
    paths: [
      { name: 'A#1#a', nodeIds: ['0', '1', '2'], start: 0 },
      { name: 'GRCh38#0#chr1', nodeIds: ['0', '2'], start: 0 },
    ],
  }
  const { reference, rows } = walkRows(graph)!
  expect(reference.name).toBe('GRCh38#0#chr1')
  expect(rows.map(r => r.name)).toEqual(['A#1#a'])
})

test("odgi's range-suffixed pieces of one walk make one row", () => {
  const gfa = [
    ...['a', 'b', 'c', 'd', 'x'].map(id => `S\t${id}\tAAAAAAAAAA`),
    'P\tREF#1#chr:0-20\ta+,b+\t*',
    'P\tREF#1#chr:20-40\tc+,d+\t*',
    'P\tS#1#chr:0-20\ta+,x+\t*',
    'P\tS#1#chr:20-40\tc+,d+\t*',
  ].join('\n')
  const graph = anchorGraph(convertGFAToGraph(parseGFA(gfa)), 'REF#1#chr')
  const { reference, rows } = walkRows(graph)!
  expect(reference.bp).toBe(40)
  expect(rows.map(r => [r.label, r.bp, r.offReferenceBp])).toEqual([
    ['S', 40, 10],
  ])
})

test('a sample filter keeps the samples it names, in its order', () => {
  const rows = [
    { sample: 'A', label: 'A#2' },
    { sample: 'C', label: 'C#1' },
    { sample: 'B', label: 'B#1' },
    { sample: 'A', label: 'A#1' },
  ]
  expect(filterSamples(rows, ['B', 'A']).map(r => r.label)).toEqual([
    'B#1',
    'A#1',
    'A#2',
  ])
  expect(filterSamples(rows, undefined)).toBe(rows)
})
