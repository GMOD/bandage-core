import { describe, test } from 'vitest'

import { walkRowRuns } from './walkRowRuns'
import { walkRows } from './walkRows'
import { graphFromTables } from '../gfa/graphTables'

import type { GraphTables } from '../gfa/graphTables'

// `pnpm bench`. Walk rows over a cut of a million steps: the plugin's worker
// runs walkRowRuns on the tables, a text cut runs walkRows on the Graph that
// graphFromTables builds.

// A reference of `n` nodes and `h` haplotypes walking it, each taking a
// shared alt allele at one node in twenty half the time, and a private
// three-node insertion after one node in a hundred
function cut(n: number, h: number): GraphTables {
  let seed = 7
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const lengths: number[] = []
  for (let i = 0; i < n; i++) {
    lengths.push(50 + Math.floor(rand() * 100))
  }
  const alt = new Map<number, number>()
  for (let i = 0; i < n; i += 20) {
    alt.set(i, lengths.length)
    lengths.push(lengths[i]!)
  }
  const names = ['REF#0#chr']
  const steps = Array.from({ length: n }, (_, i) => i)
  const offsets = [0, n]
  for (let k = 0; k < h; k++) {
    names.push(`S${k}#1#c`)
    for (let i = 0; i < n; i++) {
      const a = alt.get(i)
      steps.push(a !== undefined && rand() < 0.5 ? a : i)
      if (rand() < 0.01) {
        for (let j = 0; j < 3; j++) {
          steps.push(lengths.push(40) - 1)
        }
      }
    }
    offsets.push(steps.length)
  }
  const count = lengths.length
  return {
    nodes: {
      names: lengths.map((_, i) => String(i)),
      lengths: Int32Array.from(lengths),
      refs: new Int32Array(count).fill(-1),
      starts: new Float64Array(count),
      ranks: new Int32Array(count),
      refNames: [],
    },
    links: {
      from: new Int32Array(0),
      to: new Int32Array(0),
      strands: new Uint8Array(0),
    },
    walks: {
      names,
      starts: new Float64Array(names.length),
      ends: new Float64Array(names.length),
      offsets: Int32Array.from(offsets),
      steps: Int32Array.from(steps),
      reversed: new Uint8Array(steps.length),
    },
  }
}

const tables = cut(10_000, 100)
const graph = graphFromTables(tables)
const region = { start: 400_000, end: 600_000 }

describe(`${tables.walks.steps.length} steps`, () => {
  test('walkRowRuns (tables)', async ({ bench }) => {
    await bench('walkRowRuns (tables)', () => {
      walkRowRuns(tables, region)
    }).run()
  })
  test('walkRows (graph)', async ({ bench }) => {
    await bench('walkRows (graph)', () => {
      walkRows(graph, region)
    }).run()
  })
  test('graphFromTables', async ({ bench }) => {
    await bench('graphFromTables', () => {
      graphFromTables(tables)
    }).run()
  })
})
