import fs from 'fs'
import path from 'path'

import {
  tubeMapLayout,
  tubeMapReferenceLayout,
  tubeMapTracks,
} from './tubeMapLayout'
import { parseGaf, parseGafLine } from '../gaf/parseGaf'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { anchorGraph } from '../pathAnchoring'
import { buildNeighbors, nodeReferenceSpan } from '../referenceSpan'
import { referenceBoxes, rulerBoxes } from '../tubeMap/axis'

import type { Graph } from '../types'

// Five E. coli haplotypes through a pggb subgraph; IAI39 walks it on the
// reverse strand and CFT073 covers only its right half.
const PGGB = fs.readFileSync(
  path.join(__dirname, '../../test_data/ecoli_pggb_subgraph.gfa'),
  'utf8',
)

function pggb() {
  return anchorGraph(convertGFAToGraph(parseGFA(PGGB)), 'NCTC86#1#chr')
}

test('the reference path is track 0 and every path is a track', () => {
  const graph = pggb()
  const tracks = tubeMapTracks(graph)
  expect(tracks[0]!.name).toBe('NCTC86#1#chr:1189696-1190158')
  expect(tracks.map(t => t.name).sort()).toEqual(
    graph.paths!.map(p => p.name).sort(),
  )
})

test('a path walking the reverse strand reads its nodes in reverse', () => {
  const tracks = tubeMapTracks(pggb())
  const iai39 = tracks.find(t => t.name.startsWith('IAI39'))!
  expect(iai39.sequence[0]).toBe('-54+')
  const nctc86 = tracks.find(t => t.name.startsWith('NCTC86'))!
  expect(nctc86.sequence.every(step => !step.startsWith('-'))).toBe(true)
})

test('own axis: every node the paths reach is placed, left to right', () => {
  const result = tubeMapLayout(pggb())!
  const { layout } = result.tubeMap!
  expect(Object.keys(result.nodePositions)).toHaveLength(
    layout.nodes.filter(n => n.order >= 0).length,
  )
  const reference = layout.tracks.find(t => t.name?.startsWith('NCTC86'))!
  const xs = reference.path.flatMap(seg =>
    seg.node === null ? [] : [layout.nodes[seg.node]!.x],
  )
  for (let i = 1; i < xs.length; i++) {
    expect(xs[i]!).toBeGreaterThan(xs[i - 1]!)
  }
  expect(result.referenceAxis).toBeUndefined()
})

test('reference axis: columns run left to right over the cut in bp', () => {
  const graph = pggb()
  const result = tubeMapReferenceLayout(graph)!
  const columns = result.tubeMap!.columns!
  for (let i = 1; i < columns.length; i++) {
    expect(columns[i]!.bp0).toBeGreaterThanOrEqual(columns[i - 1]!.bp1)
    expect(columns[i]!.x0).toBeGreaterThan(columns[i - 1]!.x0)
  }
  expect(columns[0]!.bp0).toBe(1189696)
  expect(columns.at(-1)!.bp1).toBe(1190158)
  expect(result.referenceAxis).toBe(true)
  expect(result.pixelRows).toBe(true)
})

// alt carries 7 bp the reference does not, between the same flanks
const INSERTION = `S\t1\tACGTACGTAC
S\t2\tGGGGGGG
S\t3\tTTTTTTTTTT
L\t1\t+\t2\t+\t0M
L\t2\t+\t3\t+\t0M
L\t1\t+\t3\t+\t0M
P\tref#1#chr:100-120\t1+,3+\t*
P\talt#1#chr:200-227\t1+,2+,3+\t*`

test('a column of inserted sequence covers no reference', () => {
  const graph = anchorGraph(convertGFAToGraph(parseGFA(INSERTION)), 'ref#1#chr')
  const { columns } = tubeMapReferenceLayout(graph)!.tubeMap!
  expect(columns!.map(c => [c.bp0, c.bp1])).toEqual([
    [100, 110],
    [110, 110],
    [110, 120],
  ])
})

// alt is cut into two pieces, the second reading both segments backwards
const PIECES = `S\t1\tACGT
S\t2\tGGGG
L\t1\t+\t2\t+\t0M
P\tref#1#chr:0-8\t1+,2+\t*
P\talt#1#chr:0-8\t1+,2+\t*
P\talt#1#chr:100-108\t2-,1-\t*`

test("a walk's pieces each read their own strand of a segment they share", () => {
  const graph = anchorGraph(convertGFAToGraph(parseGFA(PIECES)), 'ref#1#chr')
  expect(tubeMapTracks(graph).map(t => [t.name, t.sequence])).toEqual([
    ['ref#1#chr:0-8', ['1+', '2+']],
    ['alt#1#chr:0-8', ['1+', '2+']],
    ['alt#1#chr:100-108', ['-2+', '-1+']],
  ])
})

const SEGMENTS = `S\t1\tACGTACGTAC
S\t2\tGGGGGGGGGG
S\t3\tTTTTTTTTTT
S\t4\tA
S\t5\tC
S\t6\tAAAAAAAAAA
`

const LINKS = `L\t1\t+\t2\t+\t0M
L\t2\t+\t3\t+\t0M
L\t3\t+\t4\t+\t0M
L\t3\t+\t5\t+\t0M
L\t4\t+\t6\t+\t0M
L\t5\t+\t6\t+\t0M
`

function walks(ref: string, alt: string, links = LINKS) {
  const gfa = `${SEGMENTS}${links}P\tref#1#chr:0-41\t${ref}\t*
P\talt#1#chr:0-41\t${alt}\t*`
  return anchorGraph(convertGFAToGraph(parseGFA(gfa)), 'ref#1#chr')
}

// 1 2 3 run straight through on every path, then a SNP 4|5 and 6. `alt` is
// given forwards or backwards.
function snp(alt: string, extra = '') {
  return walks('1+,2+,3+,4+,6+', alt, `${LINKS}${extra}`)
}

function boxOf(graph: Graph, id: string) {
  const { graph: drawn } = tubeMapLayout(graph)!.tubeMap!
  return nodeReferenceSpan({
    nodeId: id,
    nodeById: new Map(drawn.nodes.map(n => [n.id, n])),
    neighbors: buildNeighbors(drawn),
  })
}

test('a merged run is one node of the drawn graph, as long as its members', () => {
  const { tubeMap, nodePositions } = tubeMapLayout(snp('1+,2+,3+,5+,6+'))!
  expect(tubeMap!.members).toEqual(new Map([['1+', ['1+', '2+', '3+']]]))
  expect(Object.keys(nodePositions).sort()).toEqual(['1+', '4+', '5+', '6+'])
  const { nodes, edges, paths } = tubeMap!.graph
  expect(nodes.map(n => [n.id, n.length, n.stable?.start])).toEqual([
    ['1+', 30, 0],
    ['4+', 1, 30],
    ['5+', 1, 30],
    ['6+', 10, 31],
  ])
  expect(edges.map(e => `${e.from}>${e.to}`)).toEqual([
    '1+>4+',
    '1+>5+',
    '4+>6+',
    '5+>6+',
  ])
  expect(paths!.map(p => p.nodeIds)).toEqual([
    ['1+', '4+', '6+'],
    ['1+', '5+', '6+'],
  ])
  expect(boxOf(snp('1+,2+,3+,5+,6+'), '1+')).toEqual({ start: 0, end: 30 })
  expect(boxOf(snp('1+,2+,3+,5+,6+'), '5+')).toEqual({ start: 30, end: 31 })
})

test('a run walked backwards merges into the same box', () => {
  const { tubeMap } = tubeMapLayout(snp('6-,5-,3-,2-,1-'))!
  expect(tubeMap!.members).toEqual(new Map([['1+', ['1+', '2+', '3+']]]))
  expect(tubeMap!.graph.paths![1]!.nodeIds).toEqual(['6+', '5+', '1+'])
})

test('a link looping back over a run stays, as a loop on its box', () => {
  const graph = snp('1+,2+,3+,1+,2+,3+,5+,6+', 'L\t3\t+\t1\t+\t0M\n')
  const { tubeMap } = tubeMapLayout(graph)!
  expect(tubeMap!.members.get('1+')).toEqual(['1+', '2+', '3+'])
  expect(tubeMap!.graph.edges.map(e => `${e.from}>${e.to}`)).toContain('1+>1+')
})

test('a reference read backwards merges its run as the layout turns it', () => {
  const graph = walks('6-,4-,3-,2-,1-', '6-,5-,3-,2-,1-')
  const { members } = tubeMapLayout(graph)!.tubeMap!
  expect(members).toEqual(new Map([['3+', ['3+', '2+', '1+']]]))
  expect(boxOf(graph, '3+')).toEqual({ start: 11, end: 41 })
})

test('the links inside a run read each node against its own strand', () => {
  const graph = walks(
    '1+,2-,3+,4+,6+',
    '1+,2-,3+,5+,6+',
    LINKS.replace('L\t1\t+\t2\t+', 'L\t1\t+\t2\t-').replace(
      'L\t2\t+\t3\t+',
      'L\t2\t-\t3\t+',
    ),
  )
  const { members, graph: drawn } = tubeMapLayout(graph)!.tubeMap!
  expect([...members.values()].map(run => run.length)).toEqual([3])
  expect(drawn.edges.filter(e => e.from === e.to)).toEqual([])
})

test('a secondary read, which the layout drops, merges nothing', () => {
  const graph = snp('1+,2+,3+,5+,6+', 'L\t5\t+\t2\t+\t0M\n')
  const read = parseGafLine(
    'r\t11\t0\t11\t+\t>5>2\t11\t0\t11\t11\t11\t0\ttp:A:S',
  )!
  expect(read.secondary).toBe(true)
  const { members } = tubeMapLayout({ ...graph, reads: [read] })!.tubeMap!
  expect(members).toEqual(new Map([['1+', ['1+', '2+', '3+']]]))
})

// a box the layout merged is one the drawn graph merged too, so each reports
// the length the layout gave it
test('every merged box in the fixtures is accounted for', () => {
  const cactus = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        fs.readFileSync(
          path.join(__dirname, '../../test_data/cactus/cactus_240_280.gfa'),
          'utf8',
        ),
      ),
    ),
    'ref',
  )
  const reads = parseGaf(
    fs.readFileSync(
      path.join(__dirname, '../../test_data/cactus/cactus_240_280.gaf'),
      'utf8',
    ),
  )
  for (const graph of [pggb(), cactus, { ...cactus, reads }]) {
    const { layout, graph: drawn } = tubeMapLayout(graph)!.tubeMap!
    const lengthOf = new Map(drawn.nodes.map(n => [n.id, n.length]))
    layout.nodes.forEach(node => {
      expect(Math.max(1, lengthOf.get(node.name)!)).toBe(node.sequenceLength)
    })
  }
})

test("a box's reference bp are its members', not the layout's 1 bp floor", () => {
  const graph = walks('1+,2+,3+,4+,6+', '1+,2+,3+,5+,6+', LINKS)
  const empty = {
    ...graph,
    nodes: graph.nodes.map(n => (n.name === '2' ? { ...n, length: 0 } : n)),
  }
  const drawing = tubeMapLayout(empty)!.tubeMap!
  const [box] = rulerBoxes(referenceBoxes(drawing))!
  expect(box).toMatchObject({ name: '1+', bp0: 0, bp1: 20 })
})

test('no layout without paths', () => {
  const graph = { ...pggb(), paths: [] }
  expect(tubeMapLayout(graph)).toBeUndefined()
  expect(tubeMapReferenceLayout(graph)).toBeUndefined()
})
