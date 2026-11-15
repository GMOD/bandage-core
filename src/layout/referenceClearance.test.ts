import { meanDepth, nodeWidthPx } from '../nodeWidths'
import { CLEARANCE_FIT, clearOfReference } from './referenceClearance'

import type { Graph, GraphNode, NodeSegment } from '../types'

const stable = (start: number, rank: number) => ({
  refName: rank === 0 ? 'chr1' : 'alt',
  start,
  rank,
})

const backboneNode = (i: number): GraphNode => ({
  id: `b${i}+`,
  name: `b${i}`,
  length: 100,
  depth: 9,
  stable: stable(i * 100, 0),
})

const allele = (i: number, start: number): GraphNode => ({
  id: `a${i}+`,
  name: `a${i}`,
  length: 1,
  depth: 1,
  stable: stable(start, 1),
})

const flat = (x0: number, x1: number, y: number): NodeSegment[] => [
  { x: x0, y },
  { x: x1, y },
]

function backbone(count: number) {
  const nodes = Array.from({ length: count }, (_, i) => backboneNode(i))
  const positions = Object.fromEntries(
    nodes.map((n, i) => [n.id, flat(i * 100, i * 100 + 100, 0)]),
  )
  return { nodes, positions }
}

function extentOf(positions: Record<string, NodeSegment[]>) {
  return Object.values(positions)
    .flat()
    .reduce(
      (e, p) => ({
        minX: Math.min(e.minX, p.x),
        minY: Math.min(e.minY, p.y),
        maxX: Math.max(e.maxX, p.x),
        maxY: Math.max(e.maxY, p.y),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    )
}

// how far the reference's ink and a node's must stay apart, in layout units
// at the fit the clearance is sized for, with a drawing `width` units wide
function inkReach(graph: Graph, node: GraphNode, width: number) {
  const norm = meanDepth(graph)
  const half = (n: GraphNode) => nodeWidthPx(n, 6, 'depth', norm) / 2
  const reference = graph.nodes.filter(n => n.stable?.rank === 0)
  const widestReference = reference.reduce((w, n) => Math.max(w, half(n)), 0)
  return ((widestReference + half(node)) * width) / CLEARANCE_FIT.width
}

test('an allele drawn on the reference line is laid beside it, clear of its ink, where the layout bent it', () => {
  const { nodes, positions } = backbone(30)
  const a = allele(0, 1050)
  const graph: Graph = { name: 'g', nodes: [...nodes, a], edges: [] }
  const laid = { ...positions, [a.id]: flat(1050, 1051, 0.3) }
  const out = clearOfReference(graph, laid, extentOf(laid))
  const reach = inkReach(graph, a, 3000)
  for (const p of out[a.id]!) {
    expect(p.y).toBeGreaterThan(reach)
    expect(p.y).toBeLessThan(2 * reach)
  }
  const [start, end] = out[a.id]!
  expect(start!.x).toBeCloseTo(1050)
  expect(end!.x).toBeCloseTo(1051)
})

test('the reference does not move', () => {
  const { nodes, positions } = backbone(30)
  const a = allele(0, 1050)
  const graph: Graph = { name: 'g', nodes: [...nodes, a], edges: [] }
  const laid = { ...positions, [a.id]: flat(1050, 1051, -0.3) }
  const out = clearOfReference(graph, laid, extentOf(laid))
  for (const n of nodes) {
    expect(out[n.id]).toEqual(positions[n.id])
  }
  expect(out[a.id]![0]!.y).toBeLessThan(-inkReach(graph, a, 3000))
})

test('thousands of alleles denser than the pixels along the reference all clear its ink, in their order along it and across it', () => {
  const { nodes, positions } = backbone(30)
  const alleles = Array.from({ length: 3000 }, (_, i) => allele(i, i))
  const graph: Graph = { name: 'g', nodes: [...nodes, ...alleles], edges: [] }
  const laid = {
    ...positions,
    ...Object.fromEntries(
      alleles.map((a, i) => [a.id, flat(i, i + 0.5, 0.2 + (i % 3) * 0.2)]),
    ),
  }
  const out = clearOfReference(graph, laid, extentOf(laid))
  const reach = inkReach(graph, alleles[0]!, 3000)
  alleles.forEach((a, i) => {
    const [start, end] = out[a.id]!
    expect(start!.y).toBeGreaterThan(reach)
    expect(start!.x).toBeCloseTo(i)
    expect(end!.x).toBeCloseTo(i + 0.5)
  })
  const depths = alleles.slice(0, 3).map(a => out[a.id]![0]!.y)
  expect(depths[0]!).toBeLessThan(depths[1]!)
  expect(depths[1]!).toBeLessThan(depths[2]!)
})

test('what lies further out keeps its order and, far enough out, its place', () => {
  const { nodes, positions } = backbone(30)
  const ladder = Array.from({ length: 60 }, (_, i) => allele(i, 1000))
  const far = allele(60, 1000)
  const graph: Graph = {
    name: 'g',
    nodes: [...nodes, ...ladder, far],
    edges: [],
  }
  const laid = {
    ...positions,
    ...Object.fromEntries(
      ladder.map((a, i) => [a.id, flat(1000, 1001, i * 5)]),
    ),
    [far.id]: flat(1000, 1001, 2000),
  }
  const out = clearOfReference(graph, laid, extentOf(laid))
  const depths = ladder.map(a => out[a.id]![0]!.y)
  for (let i = 1; i < depths.length; i++) {
    expect(depths[i]!).toBeGreaterThan(depths[i - 1]!)
  }
  expect(out[far.id]).toEqual(laid[far.id])
})

test('a node lying across the line goes to the side most of it is on', () => {
  const { nodes, positions } = backbone(30)
  const a: GraphNode = { ...allele(0, 1000), length: 40 }
  const graph: Graph = { name: 'g', nodes: [...nodes, a], edges: [] }
  const laid = {
    ...positions,
    [a.id]: [
      { x: 1000, y: -0.1 },
      { x: 1010, y: 0.4 },
      { x: 1020, y: 0.5 },
    ],
  }
  const out = clearOfReference(graph, laid, extentOf(laid))
  for (const p of out[a.id]!) {
    expect(p.y).toBeGreaterThan(inkReach(graph, a, 3000))
  }
})

test('a node the push would carry into another stretch of the reference, where the drawing folds back, stays where the layout put it', () => {
  const { nodes, positions } = backbone(30)
  const fold: GraphNode = { ...backboneNode(30), stable: stable(3000, 0) }
  const a = allele(0, 1050)
  const graph: Graph = { name: 'g', nodes: [...nodes, fold, a], edges: [] }
  const laid = {
    ...positions,
    [fold.id]: flat(3000, 0, 20),
    [a.id]: flat(1050, 1051, 0.3),
  }
  const out = clearOfReference(graph, laid, extentOf(laid))
  expect(out[a.id]).toEqual(laid[a.id])
})
