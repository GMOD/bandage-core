import { departureTable } from '../gfa/departures'
import { loadGraph } from '../pipeline'
import { sharedRowOrder, walkRowBlocks, walkRowLinks } from './walkRowLinks'
import { walkRowRuns, walkRowsOf } from './walkRowRuns'
import { walkRows } from './walkRows'

import type { GraphTables } from '../gfa/graphTables'
import type { WalkRow, WalkVisit } from './walkRows'

// R runs 1, 2, 3 at a kb each, and the window is node 2. A and B swap it for
// the same 1 kb expansion, 4 and 5; E walks that expansion inverted; C keeps
// the reference's node; P stops inside the window.
const text = [
  'H\tVN:Z:1.1',
  'S\t1\t*\tLN:i:1000',
  'S\t2\t*\tLN:i:1000',
  'S\t3\t*\tLN:i:1000',
  'S\t4\t*\tLN:i:500',
  'S\t5\t*\tLN:i:500',
  'W\tR\t0\tchr\t0\t3000\t>1>2>3',
  'W\tA\t1\ta\t0\t3000\t>1>4>5>3',
  'W\tB\t1\tb\t0\t3000\t>1>4>5>3',
  'W\tC\t1\tc\t0\t3000\t>1>2>3',
  'W\tE\t1\te\t0\t3000\t>1<5<4>3',
  'W\tP\t1\tp\t0\t1500\t>1>4',
].join('\n')

function rows(labels: string[]) {
  const cut = walkRows(
    loadGraph(text, 'g', { referencePath: 'R#0#chr' }),
    { start: 1000, end: 2000 },
    undefined,
    { visits: true },
  )!
  const all = [cut.reference, ...cut.rows]
  return labels.map(label => all.find(r => r.label === label)!)
}

test('neighbouring rows that walk the same nodes are joined by a ribbon', () => {
  expect(walkRowLinks(rows(['R#0', 'A#1', 'B#1', 'C#1']))).toEqual([
    { row: 1, a0: 0, a1: 1000, b0: 0, b1: 1000 },
  ])
})

test('a ribbon to a row walking the stretch backwards runs from b0 down to b1', () => {
  expect(walkRowLinks(rows(['A#1', 'E#1']))).toEqual([
    { row: 0, a0: 0, a1: 1000, b0: 1000, b1: 0 },
  ])
})

test('a row cut from one flank has no ribbons and joins no block', () => {
  const cut = rows(['A#1', 'P#1', 'B#1'])
  expect(cut[1]!.complete).toBe(false)
  expect(walkRowLinks(cut)).toEqual([])
  expect(walkRowBlocks(cut).map(b => b.row)).toEqual([0, 2])
})

test('the shared order puts each row after the one it shares the most with', () => {
  expect(sharedRowOrder(rows(['R#0', 'A#1', 'B#1', 'C#1']))).toEqual([
    0, 3, 1, 2,
  ])
})

// The shared order as each pair's shared bp over every node they walk gives
// it, which sharedRowOrder states without comparing the nodes every bar walks
// once
function pairwiseOrder(all: WalkRow[]) {
  const bars = all.map(row =>
    row.complete && !row.unloadedBp ? row.visits : undefined,
  )
  const sharedBp = (a: WalkVisit[], b: WalkVisit[]) => {
    const unmatched = new Map<string, number>()
    for (const { node } of b) {
      unmatched.set(node, (unmatched.get(node) ?? 0) + 1)
    }
    let bp = 0
    for (const visit of a) {
      const left = unmatched.get(visit.node) ?? 0
      if (left > 0) {
        bp += visit.bp
        unmatched.set(visit.node, left - 1)
      }
    }
    return bp
  }
  const order = all.length > 0 ? [0] : []
  const rest = all.map((_, i) => i).slice(1)
  while (rest.length > 0) {
    const last = bars[order.findLast(i => bars[i]) ?? 0]
    const shared = rest.map(i => {
      const bar = bars[i]
      return last && bar ? sharedBp(last, bar) : 0
    })
    order.push(rest.splice(shared.indexOf(Math.max(...shared)), 1)[0]!)
  }
  return order
}

// A row walking `nodes`, each named by its bp
function walking(nodes: number[], o: Partial<WalkRow> = {}): WalkRow {
  let bp = 0
  const visits = nodes.map(node => {
    const visit = {
      node: String(node),
      start: bp,
      bp: node,
      onReference: false,
    }
    bp += node
    return visit
  })
  return {
    name: nodes.join('>'),
    label: nodes.join('>'),
    sample: 's',
    bp,
    offReferenceBp: bp,
    gapBp: 0,
    complete: true,
    runs: [],
    visits,
    ...o,
  }
}

test('the shared order of no rows is empty, and of one row that row', () => {
  expect(sharedRowOrder([])).toEqual([])
  expect(sharedRowOrder([walking([100, 200])])).toEqual([0])
})

test('the shared order is the one every pair of bars compared over all their nodes gives', () => {
  const cases = {
    'rows walking the same nodes keep their order': {
      rows: [walking([100, 200]), walking([100, 200]), walking([100, 200])],
      order: [0, 1, 2],
    },
    'a bar sharing only what every bar walks once goes before a row with no bar':
      {
        rows: [
          walking([100, 200]),
          walking([100, 200], { complete: false }),
          walking([100, 30, 200]),
        ],
        order: [0, 2, 1],
      },
    'a node walked more than once counts as often as both rows walk it': {
      rows: [
        walking([100, 50, 50, 50, 200]),
        walking([100, 50, 200]),
        walking([100, 50, 50, 200]),
        walking([100, 200]),
      ],
      order: [0, 2, 1, 3],
    },
    'a first row with no bar is followed by the next row, which the rest are compared with':
      {
        rows: [
          walking([100, 30, 200], { visits: undefined }),
          walking([100, 200]),
          walking([100, 30]),
          walking([100, 200], { unloadedBp: 40 }),
          walking([100, 200]),
        ],
        order: [0, 1, 4, 2, 3],
      },
    'rows sharing no node keep their order': {
      rows: [walking([100]), walking([200]), walking([300])],
      order: [0, 1, 2],
    },
  }
  for (const [name, { rows: all, order }] of Object.entries(cases)) {
    expect(sharedRowOrder(all), name).toEqual(order)
    expect(pairwiseOrder(all), name).toEqual(order)
  }
})

// walkRows.bench.ts's cut: a reference of `n` nodes and `h` haplotypes
// walking it, each taking a shared alt allele at one node in twenty half the
// time, and a private three-node insertion after one node in a hundred
function cohort(n: number, h: number): GraphTables {
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
    departures: departureTable(),
    revisited: 0,
  }
}

test("the shared order of a cohort's rows is the one every pair compared over all their nodes gives", () => {
  const cut = walkRowsOf(
    walkRowRuns(cohort(400, 16), undefined, { visits: true })!,
  )
  const all = [cut.reference, ...cut.rows]
  const order = sharedRowOrder(all)
  expect(order).toEqual(pairwiseOrder(all))
  expect(order).not.toEqual(all.map((_, i) => i))
})

test('a stretch off the reference that several rows walk is one block in each', () => {
  expect(walkRowBlocks(rows(['R#0', 'A#1', 'B#1', 'C#1', 'E#1']))).toEqual([
    { row: 1, start: 0, bp: 1000, block: 0 },
    { row: 2, start: 0, bp: 1000, block: 0 },
    { row: 4, start: 0, bp: 1000, block: 0 },
  ])
})
