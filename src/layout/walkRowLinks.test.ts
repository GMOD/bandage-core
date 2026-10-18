import { sharedRowOrder, walkRowBlocks, walkRowLinks } from './walkRowLinks'
import { walkRows } from './walkRows'
import { loadGraph } from '../pipeline'

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

test('a stretch off the reference that several rows walk is one block in each', () => {
  expect(walkRowBlocks(rows(['R#0', 'A#1', 'B#1', 'C#1', 'E#1']))).toEqual([
    { row: 1, start: 0, bp: 1000, block: 0 },
    { row: 2, start: 0, bp: 1000, block: 0 },
    { row: 4, start: 0, bp: 1000, block: 0 },
  ])
})
