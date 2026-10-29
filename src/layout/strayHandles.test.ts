import { withoutStrayHandles } from './strayHandles'
import { walkRows } from './walkRows'
import { graphFromTables } from '../gfa/graphTables'
import { layoutModeByValue } from '../layoutModes'

import type { GraphTables } from '../gfa/graphTables'

// The cut holds the reference over nodes 0-3, linked in a chain. H leaves at
// node 1 and rejoins at node 6, far past the window, and the writer abridged
// the steps between, so nothing links node 6 into the cut.
function cut(walks: { name: string; steps: number[]; abridged?: number }[]) {
  const offsets = [0]
  for (const w of walks) {
    offsets.push(offsets.at(-1)! + w.steps.length)
  }
  const tables: GraphTables = {
    nodes: {
      names: ['0', '1', '2', '3', '6'],
      lengths: Int32Array.of(1000, 1000, 1000, 1000, 1000),
      refs: Int32Array.of(0, 0, 0, 0, 0),
      starts: Float64Array.of(0, 1000, 2000, 3000, 60_000),
      ranks: Int32Array.of(0, 0, 0, 0, 0),
      refNames: ['chr1'],
    },
    links: {
      from: Int32Array.of(0, 1, 2),
      to: Int32Array.of(1, 2, 3),
      strands: new Uint8Array(3),
    },
    walks: {
      names: walks.map(w => w.name),
      starts: new Float64Array(walks.length),
      ends: Float64Array.from(walks, w => w.steps.length * 1000),
      offsets: Int32Array.from(offsets),
      steps: Int32Array.from(walks.flatMap(w => w.steps)),
      reversed: new Uint8Array(offsets.at(-1)!),
      abridgedSteps: Float64Array.from(walks, w => w.abridged ?? Number.NaN),
      abridgedBp: Float64Array.from(walks, w =>
        w.abridged ? 59_000 : Number.NaN,
      ),
    },
  }
  return graphFromTables(tables)
}

const reference = { name: 'GRCh38#0#chr1', steps: [0, 1, 2, 3] }
const abridgedH = { name: 'H#1#h', steps: [1, 4], abridged: 120_000 }

test("drops an abridged walk's handle that no link reaches", () => {
  const graph = cut([reference, abridgedH])
  expect(withoutStrayHandles(graph).nodes.map(n => n.id)).toEqual([
    '0+',
    '1+',
    '2+',
    '3+',
  ])
})

test('keeps a handle a walk read in full steps on', () => {
  const graph = cut([reference, abridgedH, { name: 'K#1#k', steps: [4] }])
  expect(withoutStrayHandles(graph)).toBe(graph)
})

test('keeps a graph with no abridged walk as it is', () => {
  const graph = cut([reference, { name: 'H#1#h', steps: [1, 4] }])
  expect(withoutStrayHandles(graph)).toBe(graph)
})

test('the node layouts leave the stray handle out, and walk rows place it', () => {
  const graph = cut([reference, abridgedH])
  const region = { start: 0, end: 4000 }
  for (const mode of ['auto', 'ordered']) {
    const result = layoutModeByValue(mode).run(graph, region)!
    expect(Object.keys(result.nodePositions)).not.toContain('6+')
    expect(Object.keys(result.nodePositions)).toContain('3+')
  }
  const h = walkRows(graph, region).rows.find(row => row.label === 'H#1')
  expect(h?.runs.slice(-2)).toMatchObject([
    { cause: 'abridged' },
    { start: 58_000, bp: 1000 },
  ])
})
