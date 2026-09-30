import { joinCuts } from './gbzJoin'

const seq = 'ACGTACGTAC'
const segments = (...ids: number[]) => ids.map(id => `S\t${id}\t${seq}`)
const walk = (name: string, start: number, ids: number[]) =>
  `W\t${name.replaceAll('#', '\t')}\t${start}\t${start + ids.length * seq.length}\t${ids.map(id => `>${id}`).join('')}`
const gfa = (...lines: string[]) => `${lines.join('\n')}\n`
const walks = (text: string) =>
  text.split('\n').filter(line => line.startsWith('W\t'))

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

test('one cut passes through unchanged', () => {
  expect(joinCuts([first])).toBe(first)
})

test('a walk bridging two fragments is joined where its pieces overlap', () => {
  expect(walks(joinCuts([first, second]))).toEqual([
    walk('GRCh38#0#chr6', 100, [1, 2]),
    walk('GRCh38#0#chr6', 200, [5, 6]),
    walk('HG002#1#chr6', 500, [1, 2, 3, 4, 5, 6]),
  ])
})

test('segments, links and headers appear once', () => {
  const joined = joinCuts([first, second]).split('\n')
  expect(joined.filter(line => line.startsWith('S\t'))).toHaveLength(6)
  expect(joined.filter(line => line.startsWith('L\t'))).toHaveLength(1)
  expect(joined.filter(line => line.startsWith('H\t'))).toHaveLength(1)
})

test('a piece inside another is dropped, and pieces apart stay apart', () => {
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
  expect(walks(joinCuts([apart, inside])).slice(2)).toEqual([
    walk('HG002#1#chr6', 500, [1, 2, 3, 4]),
    walk('HG002#2#chr6', 700, [1, 2]),
    walk('HG002#2#chr6', 900, [5, 6]),
  ])
})

test("each cut's unnamed walks are numbered on from the cut before's", () => {
  const unnamed = (ref: number, ids: number[]) =>
    gfa(
      ...segments(...ids),
      walk('GRCh38#0#chr6', ref, ids),
      walk('unknown#1#chr6', 0, ids),
      walk('unknown#2#chr6', 0, ids),
    )
  expect(
    walks(joinCuts([unnamed(100, [1]), unnamed(200, [2])]))
      .slice(2)
      .map(line => line.split('\t').slice(1, 3).join('#')),
  ).toEqual(['unknown#1', 'unknown#2', 'unknown#3', 'unknown#4'])
})
