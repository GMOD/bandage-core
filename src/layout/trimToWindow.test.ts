import fs from 'fs'
import path from 'path'

import { trimToWindow } from './trimToWindow'
import { tubeMapLayout } from './tubeMapLayout'
import { isBackbone } from '../anchoredNodes'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { anchorGraph, pathOrigin } from '../pathAnchoring'

import type { Graph } from '../types'

const GFA = fs.readFileSync(
  path.join(__dirname, '../../../../test_data/cactus/cactus_240_280.gfa'),
  'utf8',
)

function cactus() {
  return anchorGraph(convertGFAToGraph(parseGFA(GFA)), 'ref')
}

// the span of the reference node in the middle of the reference walk
function innerWindow(graph: Graph) {
  const byId = new Map(graph.nodes.map(n => [n.id, n]))
  const reference = graph.paths!.find(
    p => pathOrigin(p.name).name === graph.referencePath,
  )!
  const middle = byId.get(
    reference.nodeIds[Math.floor(reference.nodeIds.length / 2)]!,
  )!
  expect(isBackbone(middle)).toBe(true)
  return {
    start: middle.stable!.start,
    end: middle.stable!.start + middle.length,
  }
}

test('a window over the whole cut leaves the graph as it is', () => {
  const graph = cactus()
  expect(trimToWindow(graph, { start: -1e9, end: 1e9 })).toBe(graph)
})

test('each walk keeps only its stretch between reference nodes in the window', () => {
  const graph = cactus()
  const window = innerWindow(graph)
  const trimmed = trimToWindow(graph, window)
  const byId = new Map(trimmed.nodes.map(n => [n.id, n]))
  expect(trimmed.nodes.length).toBeLessThan(graph.nodes.length)
  for (const p of trimmed.paths!) {
    const first = byId.get(p.nodeIds[0]!)!
    const last = byId.get(p.nodeIds.at(-1)!)!
    for (const end of [first, last]) {
      expect(isBackbone(end)).toBe(true)
      expect(end.stable!.start).toBeLessThan(window.end)
      expect(end.stable!.start + end.length).toBeGreaterThan(window.start)
    }
    // a contiguous stretch of the walk it came from
    const whole = graph.paths!.find(q => q.name === p.name)!.nodeIds.join(',')
    expect(whole.includes(p.nodeIds.join(','))).toBe(true)
  }
  for (const e of trimmed.edges) {
    expect(byId.has(e.from) && byId.has(e.to)).toBe(true)
  }
})

test('a trimmed walk keeps one visit per step, so strands still line up', () => {
  const graph = cactus()
  const trimmed = trimToWindow(graph, innerWindow(graph))
  const visits = new Map<string, number>()
  for (const [, list] of trimmed.pathVisits ?? []) {
    for (const v of list) {
      visits.set(v.path, (visits.get(v.path) ?? 0) + 1)
    }
  }
  const steps = new Map<string, number>()
  for (const p of trimmed.paths!) {
    const origin = pathOrigin(p.name).name
    steps.set(origin, (steps.get(origin) ?? 0) + p.nodeIds.length)
  }
  expect(visits).toEqual(steps)
})

test('the tube map of a trimmed cut draws fewer columns', () => {
  const graph = cactus()
  const whole = tubeMapLayout(graph)!.tubeMap!.layout.nodes.length
  const trimmed = tubeMapLayout(trimToWindow(graph, innerWindow(graph)))!
    .tubeMap!.layout.nodes.length
  expect(trimmed).toBeLessThan(whole)
})
