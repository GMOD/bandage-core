import fs from 'fs'
import path from 'path'

import { coarsenTubeMap } from './coarsen'
import { deviationMarks } from './deviations'
import { tubeMapLayout } from '../layout/tubeMapLayout'
import { loadGraph } from '../pipeline'

import type { Graph } from '../types'

// The reference `ref` is b0 x b1 y b2 z b3; `lengths` overrides the 100 bp
// default, and each extra path is a list of steps
function gfa(
  paths: Record<string, string>,
  extra: Record<string, number> = {},
) {
  const lengths: Record<string, number> = {
    b0: 100,
    x: 1,
    b1: 100,
    y: 100,
    b2: 100,
    z: 1,
    b3: 100,
    ...extra,
  }
  const lines = ['H\tVN:Z:1.0']
  for (const [id, len] of Object.entries(lengths)) {
    lines.push(`S\t${id}\t*\tLN:i:${len}`)
  }
  const all = { ref: 'b0+,x+,b1+,y+,b2+,z+,b3+', ...paths }
  for (const [name, steps] of Object.entries(all)) {
    const ids = steps.split(',')
    for (let i = 1; i < ids.length; i++) {
      const [a, b] = [ids[i - 1]!, ids[i]!]
      lines.push(
        `L\t${a.slice(0, -1)}\t${a.at(-1)}\t${b.slice(0, -1)}\t${b.at(-1)}\t0M`,
      )
    }
    lines.push(`P\t${name}\t${steps}\t*`)
  }
  return loadGraph(`${lines.join('\n')}\n`, 'test', { referencePath: 'ref' })
}

function walkBp(graph: Graph, name: string) {
  const lengthOf = new Map(graph.nodes.map(n => [n.id, n.length]))
  const p = graph.paths!.find(q => q.name === name)!
  return p.nodeIds.reduce((sum, id) => sum + lengthOf.get(id)!, 0)
}

function conserved(graph: Graph, sigma: number) {
  const coarse = coarsenTubeMap(graph, sigma)!
  for (const p of graph.paths!) {
    const delta = coarse.deviations
      .get(p.name)!
      .reduce((sum, d) => sum + d.bp - (d.end - d.start), 0)
    expect(walkBp(coarse.graph, p.name) + delta).toBe(walkBp(graph, p.name))
  }
  return coarse
}

const names = (graph: Graph, walk: string) =>
  graph.paths!.find(p => p.name === walk)!.nodeIds

test('SNPs fold into one node of the whole reference, each at its bp', () => {
  const graph = gfa({ alt: 'b0+,xa+,b1+,y+,b2+,za+,b3+' }, { xa: 1, za: 1 })
  const coarse = conserved(graph, 50)
  expect(coarse.graph.nodes.map(n => n.id)).toEqual(['0-502+'])
  expect(coarse.deviations.get('alt')).toEqual([
    { start: 100, end: 101, bp: 1 },
    { start: 401, end: 402, bp: 1 },
  ])
  expect(coarse.deviations.get('ref')).toEqual([])
  expect(coarse.coarseOf.get('xa+')).toBe('0-502+')
})

test('a deletion of sigma or more keeps its reference allele, which the deleting walk bypasses', () => {
  const coarse = conserved(gfa({ del: 'b0+,x+,b1+,b2+,z+,b3+' }), 50)
  expect(names(coarse.graph, 'ref')).toEqual(['0-201+', '201-301+', '301-502+'])
  expect(names(coarse.graph, 'del')).toEqual(['0-201+', '301-502+'])
  expect(coarse.cuts.get(201)).toBe('variant')
})

test('an insertion of sigma or more is one node for the walks that carry the same sequence', () => {
  const graph = gfa(
    {
      ins1: 'b0+,x+,b1+,big+,y+,b2+,z+,b3+',
      ins2: 'b0+,x+,b1+,big+,y+,b2+,z+,b3+',
    },
    { big: 300 },
  )
  const coarse = conserved(graph, 50)
  const route = coarse.graph.nodes.find(n => n.stable?.rank === 1)!
  expect(route.length).toBe(300)
  expect(route.depth).toBe(2)
  expect(names(coarse.graph, 'ins1')).toEqual(['0-201+', route.id, '201-502+'])
  expect(coarse.members.get(route.id)).toEqual(['big+'])
})

test('an inversion of sigma or more is its reference node read backwards', () => {
  const coarse = conserved(gfa({ inv: 'b0+,x+,b1+,y-,b2+,z+,b3+' }), 50)
  const inv = coarse.graph.paths!.find(p => p.name === 'inv')!
  expect(inv.nodeIds).toEqual(['0-201+', '201-301+', '301-502+'])
  const visits = coarse.graph.pathVisits!.get('201-301')!
  expect(visits.map(v => [v.path, v.strand])).toEqual([
    ['ref', '+'],
    ['inv', '-'],
  ])
})

test('a smaller inversion folds, marked as one', () => {
  const coarse = conserved(gfa({ inv: 'b0+,x-,b1+,y+,b2+,z+,b3+' }), 50)
  expect(coarse.graph.nodes).toHaveLength(1)
  expect(coarse.deviations.get('inv')).toEqual([
    { start: 100, end: 101, bp: 1, inverted: true },
  ])
})

test('a walk that stops short cuts the reference where it stops', () => {
  const coarse = conserved(gfa({ short: 'b0+,x+,b1+' }), 50)
  expect(coarse.cuts.get(201)).toBe('walk-end')
  expect(names(coarse.graph, 'short')).toEqual(['0-201+'])
})

test("a small deletion across another walk's cut is cut too, so no walk skips a merged node", () => {
  const graph = gfa(
    {
      ins: 'b0+,x+,big+,b1+,y+,b2+,z+,b3+',
      del: 'b0+,y+,b2+,z+,b3+',
    },
    { b1: 10, big: 300 },
  )
  const coarse = conserved(graph, 50)
  expect(coarse.cuts.get(101)).toBe('variant')
  expect(coarse.cuts.get(100)).toBe('overlap')
  expect(coarse.cuts.get(111)).toBe('overlap')
  expect(names(coarse.graph, 'del')).toEqual(['0-100+', '111-412+'])
})

test('lengths survive coarsening on a real cut, at every sigma', () => {
  const text = fs.readFileSync(
    path.join(__dirname, '../../../../test_data/cactus/cactus_240_280.gfa'),
    'utf8',
  )
  const graph = loadGraph(text, 'cactus', { referencePath: 'ref' })
  for (const sigma of [1, 2, 5, 50, 1000]) {
    const coarse = conserved(graph, sigma)
    expect(tubeMapLayout(coarse.graph)?.tubeMap).toBeDefined()
  }
})

test("a folded variant marks its walk's tube at its bp through the box", () => {
  const graph = gfa({ alt: 'b0+,xa+,b1+,y+,b2+,za+,b3+' }, { xa: 1, za: 1 })
  const coarse = coarsenTubeMap(graph, 50)!
  const layout = tubeMapLayout(coarse.graph)!.tubeMap!.layout
  const box = layout.nodes[layout.nodeMap.get('0-502+')!]!
  const alt = layout.tracks.find(t => t.name === 'alt')!
  const at = (bp: number) => box.x + (bp / 502) * box.pixelWidth
  const marks = deviationMarks(coarse.graph, layout, coarse.deviations)
  expect(marks).toHaveLength(2)
  for (const [i, bp] of [100, 401].entries()) {
    expect(marks[i]!.x0).toBeCloseTo(at(bp))
    expect(marks[i]!.x1).toBeCloseTo(at(bp + 1))
    expect(marks[i]!.y).toBe(alt.path.find(s => s.node !== null)!.y)
    expect(marks[i]!.height).toBe(alt.width)
  }
})
