import fs from 'fs'
import path from 'path'

import { clipToWindow, trimToWindow } from './trimToWindow'
import { tubeMapLayout } from './tubeMapLayout'
import { isBackbone } from '../anchoredNodes'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { anchorGraph, pathOrigin } from '../pathAnchoring'

import type { Graph } from '../types'

const GFA = fs.readFileSync(
  path.join(__dirname, '../../test_data/cactus/cactus_240_280.gfa'),
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

test('clipping cuts the backbone back to the window, and what lies outside to a stub', () => {
  const graph = convertGFAToGraph(
    parseGFA(
      [
        'S\tfar\t*\tLN:i:50000\tSN:Z:chr\tSO:i:0\tSR:i:0',
        'S\tr1\t*\tLN:i:5000\tSN:Z:chr\tSO:i:100000\tSR:i:0',
        'S\tr2\t*\tLN:i:5000\tSN:Z:chr\tSO:i:105000\tSR:i:0',
        'S\tpast\t*\tLN:i:50000\tSN:Z:chr\tSO:i:200000\tSR:i:0',
        'S\ta\t*\tLN:i:9000\tSN:Z:alt\tSO:i:0\tSR:i:1',
        'L\tr1\t+\tr2\t+\t0M',
        'L\tfar\t+\ta\t+\t0M',
        'L\ta\t+\tr2\t+\t0M',
        'L\tr2\t+\tpast\t+\t0M',
      ].join('\n'),
    ),
  )
  const clipped = clipToWindow(graph, { start: 104_000, end: 106_000 }, 1000)
  expect(clipped.nodes.map(n => [n.name, n.stable?.start, n.length])).toEqual([
    ['far', 49_000, 1000],
    ['r1', 104_000, 1000],
    ['r2', 105_000, 1000],
    ['past', 200_000, 1000],
    ['a', 0, 9000],
  ])
  expect(clipped.edges).toBe(graph.edges)
  expect(clipToWindow(graph, { start: 0, end: 250_000 }, 1000)).toBe(graph)
})
