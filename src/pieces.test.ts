import { walkRows } from './layout/walkRows'
import { loadGraph } from './pipeline'
import { walkHighlight, walkLift } from './walkHighlight'
import { walkKey } from './walkKey'

// gbz-base hands a haplotype back as one W line per piece of its walk inside
// the cut: two where the walk leaves the cut's nodes and comes back (a private
// bubble at context 0 or snarls 'none', a copy in a duplication), and two where
// the haplotype is two paths of one contig. The view keys walks by
// `sample#haplotype#contig`, so every piece after the first has to survive
// each place that looks a walk up by name.

const seq = 'A'.repeat(1000)
const S = (...ids: number[]) => ids.map(id => `S\t${id}\t${seq}`)
const L = (...pairs: [number, number][]) =>
  pairs.map(([a, b]) => `L\t${a}\t+\t${b}\t+\t0M`)
const W = (name: string, start: number, end: number, steps: string) =>
  `W\t${name.replaceAll('#', '\t')}\t${start}\t${end}\t${steps}`
const gfa = (...lines: string[]) => `${lines.join('\n')}\n`
const nodeNames = (
  ids: Set<string>,
  graph: { nodes: { id: string; name: string }[] },
) =>
  graph.nodes
    .filter(n => ids.has(n.id))
    .map(n => n.name)
    .sort()

// HG002#1 leaves the cut between 2 and 4 through a node the cut does not hold
const leavesAndReturns = gfa(
  'H\tVN:Z:1.1\tRS:Z:GRCh38',
  ...S(1, 2, 3, 4, 5),
  ...L([1, 2], [2, 3], [3, 4], [4, 5]),
  W('GRCh38#0#chr1', 0, 5000, '>1>2>3>4>5'),
  W('HG002#1#chr1', 0, 2000, '>1>2'),
  W('HG002#1#chr1', 3000, 5000, '>4>5'),
)

test('a lifted walk holds every piece of its haplotype', () => {
  const graph = loadGraph(leavesAndReturns, 'cut', {
    referencePath: 'GRCh38#0#chr1',
  })
  const lift = walkHighlight(graph, 'HG002#1#chr1')!
  expect(nodeNames(lift.nodeIds, graph)).toEqual(['1', '2', '4', '5'])
  expect(lift.bp).toBe(4000)
})

test("a lifted walk's key states what all its pieces carry", () => {
  const graph = loadGraph(leavesAndReturns, 'cut', {
    referencePath: 'GRCh38#0#chr1',
  })
  const lift = walkLift(graph, [{ walk: 'HG002#1#chr1' }])
  const key = walkKey(lift.walks[0]!)
  // the walk spans the reference's 5 kb; the kilobase between its pieces is
  // walked outside the cut, not deleted
  expect(key.delta).toBe('')
  expect(key.outside).toBe(', 1 kb outside the cut')
})

// GRCh38 chr1 in two fragments joined from two cuts, as gbzJoin writes them:
// the reference is two W lines, HG003 bridges the gap through node 3, and
// HG004 is two paths that meet at the gap
const twoFragments = gfa(
  'H\tVN:Z:1.1\tRS:Z:GRCh38',
  ...S(1, 2, 3, 4, 5),
  ...L([1, 2], [2, 3], [3, 4], [4, 5]),
  W('GRCh38#0#chr1', 0, 2000, '>1>2'),
  W('GRCh38#0#chr1', 3000, 5000, '>4>5'),
  W('HG003#1#chr1', 0, 5000, '>1>2>3>4>5'),
  W('HG004#1#chr1', 0, 2000, '>1>2'),
  W('HG004#1#chr1', 3000, 5000, '>4>5'),
)

test('walk rows over two reference fragments measure against both', () => {
  const graph = loadGraph(twoFragments, 'cut', {
    referencePath: 'GRCh38#0#chr1',
  })
  const rows = walkRows(graph, { start: 0, end: 5000 })!
  // the two fragments and the kilobase between them
  expect(rows.reference.bp).toBe(5000)
  expect(rows.reference.gapBp).toBe(1000)
  // the second reference fragment is the reference, not a haplotype row
  expect(rows.rows.map(r => r.label)).not.toContain('GRCh38#0')
  // only node 3 is off the reference
  expect(rows.rows.find(r => r.label === 'HG003#1')!.offReferenceBp).toBe(1000)
})

test('walk rows draw a haplotype returned in two pieces as one row with the gap', () => {
  const graph = loadGraph(twoFragments, 'cut', {
    referencePath: 'GRCh38#0#chr1',
  })
  const rows = walkRows(graph, { start: 0, end: 5000 })!
  const hg004 = rows.rows.filter(r => r.label === 'HG004#1')
  expect(hg004).toHaveLength(1)
  const row = hg004[0]!
  expect(row.bp).toBe(5000)
  expect(row.gapBp).toBe(1000)
  expect(row.offReferenceBp).toBe(0)
  expect(row.runs.map(r => [r.start, r.bp, r.gap ?? false])).toEqual([
    [0, 2000, false],
    [2000, 1000, true],
    [3000, 2000, false],
  ])
})

test('the reference lifted over two fragments holds both', () => {
  const graph = loadGraph(twoFragments, 'cut', {
    referencePath: 'GRCh38#0#chr1',
  })
  const lift = walkHighlight(graph, 'GRCh38#0#chr1')!
  expect(nodeNames(lift.nodeIds, graph)).toEqual(['1', '2', '4', '5'])
})
