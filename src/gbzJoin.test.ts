import { joinCuts } from './gbzJoin'

const seq = 'ACGTACGTAC'
const segments = (...ids: number[]) => ids.map(id => `S\t${id}\t${seq}`)
const walk = (name: string, start: number, ids: number[]) =>
  `W\t${name.replaceAll('#', '\t')}\t${start}\t${start + ids.length * seq.length}\t${ids.map(id => `>${id}`).join('')}`
const gfa = (...lines: string[]) => `${lines.join('\n')}\n`
const walks = (text: string) =>
  text.split('\n').filter(line => line.startsWith('W\t'))
const links = (text: string) =>
  text.split('\n').filter(line => line.startsWith('L\t'))
const unlinked = async () => false
const linked =
  (...edges: string[]) =>
  async (from: string, to: string) =>
    edges.includes(`${from}${to}`)

// Two fragments of GRCh38 chr6, and HG002#1 bridging the gap between them
const first = gfa(
  'H\tVN:Z:1.1\tRS:Z:GRCh38',
  ...segments(1, 2, 3, 4),
  'L\t3\t+\t4\t+\t0M',
  walk('GRCh38#0#chr6', 100, [1, 2]),
  walk('HG002#1#chr6', 500, [1, 2, 3, 4]),
)
const second = gfa(
  'H\tVN:Z:1.1\tRS:Z:GRCh38',
  ...segments(3, 4, 5, 6),
  'L\t3\t+\t4\t+\t0M',
  walk('GRCh38#0#chr6', 200, [5, 6]),
  walk('HG002#1#chr6', 520, [3, 4, 5, 6]),
)

test('one cut passes through unchanged', async () => {
  expect(await joinCuts([first], unlinked)).toBe(first)
})

test('a walk bridging two fragments is joined where its pieces overlap', async () => {
  expect(walks(await joinCuts([first, second], unlinked))).toEqual([
    walk('GRCh38#0#chr6', 100, [1, 2]),
    walk('GRCh38#0#chr6', 200, [5, 6]),
    walk('HG002#1#chr6', 500, [1, 2, 3, 4, 5, 6]),
  ])
})

// context shorter than the haplotype's sequence in the gap: its piece in each
// cut ends where the other's starts, and neither cut holds both ends of the
// link between them
const meeting = [
  gfa(
    ...segments(1, 2),
    walk('GRCh38#0#chr6', 100, [1]),
    walk('HG003#1#chr6', 500, [1, 2]),
  ),
  gfa(
    ...segments(5, 6),
    walk('GRCh38#0#chr6', 200, [6]),
    walk('HG003#1#chr6', 520, [5, 6]),
  ),
]

test('pieces that meet where the graph links them are joined, with the link neither cut wrote', async () => {
  const joined = await joinCuts(meeting, linked('>2>5'))
  expect(walks(joined).slice(2)).toEqual([
    walk('HG003#1#chr6', 500, [1, 2, 5, 6]),
  ])
  expect(links(joined)).toEqual([
    'L\t1\t+\t2\t+\t0M',
    'L\t2\t+\t5\t+\t0M',
    'L\t5\t+\t6\t+\t0M',
  ])
})

// a haplotype split into two paths at one coordinate, with no edge between
test('pieces that meet where the graph does not link them stay apart', async () => {
  const joined = await joinCuts(meeting, unlinked)
  expect(walks(joined).slice(2)).toEqual([
    walk('HG003#1#chr6', 500, [1, 2]),
    walk('HG003#1#chr6', 520, [5, 6]),
  ])
  expect(links(joined)).not.toContain('L\t2\t+\t5\t+\t0M')
})

// a cut's context reaches the other fragment, which it writes as a walk
test("the reference's pieces in another cut fold into its own walks", async () => {
  const joined = await joinCuts(
    [
      gfa(
        ...segments(1, 2, 5),
        walk('GRCh38#0#chr6', 100, [1, 2]),
        walk('GRCh38#0#chr6', 200, [5]),
      ),
      gfa(
        ...segments(2, 5, 6),
        walk('GRCh38#0#chr6', 200, [5, 6]),
        walk('GRCh38#0#chr6', 110, [2]),
      ),
    ],
    unlinked,
  )
  expect(walks(joined)).toEqual([
    walk('GRCh38#0#chr6', 100, [1, 2]),
    walk('GRCh38#0#chr6', 200, [5, 6]),
  ])
})

test('a link a walk takes backwards is not written again', async () => {
  const backwards = gfa(
    ...segments(3, 4),
    'L\t3\t+\t4\t+\t0M',
    walk('GRCh38#0#chr6', 300, [3, 4]),
    'W\tHG005\t1\tchr6\t0\t20\t<4<3',
  )
  expect(links(await joinCuts([backwards, backwards], unlinked))).toEqual([
    'L\t3\t+\t4\t+\t0M',
  ])
})

test('segments, links and headers appear once', async () => {
  const joined = (await joinCuts([first, second], unlinked)).split('\n')
  expect(joined.filter(line => line.startsWith('S\t'))).toHaveLength(6)
  expect(joined.filter(line => line.startsWith('H\t'))).toHaveLength(1)
  const written = joined.filter(line => line.startsWith('L\t'))
  expect(new Set(written).size).toBe(written.length)
})

test('a piece inside another is dropped, and pieces apart stay apart', async () => {
  const inside = gfa(
    ...segments(5, 6),
    walk('GRCh38#0#chr6', 200, [5, 6]),
    walk('HG002#1#chr6', 510, [2, 3]),
    walk('HG002#2#chr6', 900, [5, 6]),
  )
  const apart = gfa(
    ...segments(1, 2),
    walk('GRCh38#0#chr6', 100, [1, 2]),
    walk('HG002#1#chr6', 500, [1, 2, 3, 4]),
    walk('HG002#2#chr6', 700, [1, 2]),
  )
  expect(walks(await joinCuts([apart, inside], unlinked)).slice(2)).toEqual([
    walk('HG002#1#chr6', 500, [1, 2, 3, 4]),
    walk('HG002#2#chr6', 700, [1, 2]),
    walk('HG002#2#chr6', 900, [5, 6]),
  ])
})

test("each cut's unnamed walks are numbered on from the cut before's", async () => {
  const unnamed = (ref: number, ids: number[]) =>
    gfa(
      ...segments(...ids),
      walk('GRCh38#0#chr6', ref, ids),
      walk('unknown#1#chr6', 0, ids),
      walk('unknown#2#chr6', 0, ids),
    )
  expect(
    walks(await joinCuts([unnamed(100, [1]), unnamed(200, [2])], unlinked))
      .slice(2)
      .map(line => line.split('\t').slice(1, 3).join('#')),
  ).toEqual(['unknown#1', 'unknown#2', 'unknown#3', 'unknown#4'])
})
