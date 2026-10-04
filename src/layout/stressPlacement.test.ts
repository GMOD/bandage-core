import { ROUTE_ID } from './deletionRoutes'
import { chains } from './stressEngine'
import { stressPlacement } from './stressPlacement'

import type { EngineRequest } from '../pipeline'
import type { LayoutNode } from './referenceSeeds'

// drawn units are bp: three backbone nodes of 100 along x, a link apart
const options = {
  nodeLengthPerMegabase: 1_000_000,
  minimumNodeLength: 5,
  nodeSegmentLength: 20,
  edgeLength: 5,
}

function backbone(id: string, start: number, x: number): LayoutNode {
  return {
    id,
    name: id,
    length: 100,
    depth: 1,
    stable: { refName: 'chr1', start, rank: 0 },
    x,
    y: 0,
  }
}

function withAllele(id: string, length: number): EngineRequest {
  return {
    graph: {
      nodes: [
        backbone('v1', 0, 0),
        backbone('v2', 100, 105),
        backbone('v3', 200, 210),
        { id, name: id, length, depth: 1 },
      ],
      edges: [
        { from: 'v1', to: 'v2' },
        { from: 'v2', to: 'v3' },
        { from: 'v1', to: id },
        { from: id, to: 'v3' },
      ],
    },
    options,
  }
}

function placed(request: EngineRequest) {
  const c = chains(request)
  const { X, Y } = stressPlacement(c)
  const points = (id: string) => {
    const k = c.ids.indexOf(id)
    return Array.from({ length: c.count[k]! }, (_, i) => ({
      x: X[c.first[k]! + i]!,
      y: Y[c.first[k]! + i]!,
    }))
  }
  return { points }
}

const polylineLength = (points: { x: number; y: number }[]) =>
  points.reduce(
    (sum, p, i) =>
      i ? sum + Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y) : 0,
    0,
  )

test('an allele that nearly fits its gap hangs as a lens below the backbone', () => {
  const { points } = placed(withAllele('a', 120))
  for (const id of ['v1', 'v2', 'v3']) {
    for (const p of points(id)) {
      expect(p.y).toBe(0)
    }
  }
  const allele = points('a')
  for (const p of allele) {
    expect(p.y).toBeGreaterThanOrEqual(0)
    expect(p.x).toBeGreaterThanOrEqual(100)
    expect(p.x).toBeLessThanOrEqual(210)
  }
  expect(Math.max(...allele.map(p => p.y))).toBeGreaterThan(12)
})

test('an allele much longer than its gap hangs as a teardrop of its own length', () => {
  const { points } = placed(withAllele('a', 600))
  const allele = points('a')
  expect(Math.max(...allele.map(p => p.y))).toBeGreaterThan(100)
  expect(polylineLength(allele) / 600).toBeGreaterThan(0.95)
  expect(polylineLength(allele) / 600).toBeLessThan(1.05)
})

test('a deletion route arches above the backbone', () => {
  const route = `${ROUTE_ID}0`
  const { points } = placed(withAllele(route, 50))
  for (const p of points(route)) {
    expect(p.y).toBeLessThan(0)
  }
})

test('a component with no backbone stays unplaced', () => {
  const request = withAllele('a', 120)
  request.graph.nodes.push({ id: 'z', name: 'z', length: 40, depth: 1 })
  const { X } = stressPlacement(chains(request))
  expect(Number.isNaN(X[X.length - 1]!)).toBe(true)
  expect(Number.isNaN(X[0]!)).toBe(false)
})
