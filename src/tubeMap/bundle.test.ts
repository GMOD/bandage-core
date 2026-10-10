import { bundleRoutes } from './bundle'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { tubeMapReferenceLayout } from '../layout/tubeMapLayout'
import { anchorGraph } from '../pathAnchoring'

// A's two haplotypes and C's first take the insertion; B and C's second skip
// segment 3; the reference walks neither
const GFA = [
  'S\t1\tACGTACGTAC',
  'S\t2\tGGGG',
  'S\t3\tTTTTTTTTTT',
  'S\t4\tCCCCCCCCCC',
  'L\t1\t+\t2\t+\t0M',
  'L\t2\t+\t3\t+\t0M',
  'L\t1\t+\t3\t+\t0M',
  'L\t3\t+\t4\t+\t0M',
  'L\t1\t+\t4\t+\t0M',
  'P\tref\t1+,3+,4+\t*',
  'P\tA#1#c\t1+,2+,3+,4+\t*',
  'P\tA#2#c\t1+,2+,3+,4+\t*',
  'P\tB#1#c\t1+,4+\t*',
  'P\tC#1#c\t1+,2+,3+,4+\t*',
  'P\tC#2#c\t1+,4+\t*',
].join('\n')

const graph = () => anchorGraph(convertGFAToGraph(parseGFA(GFA)), 'ref')

test('walks taking one route draw as one record standing for them all', () => {
  const bundled = bundleRoutes(graph())
  expect(bundled.paths!.map(p => [p.name, p.members ?? [p.name]])).toEqual([
    ['ref', ['ref']],
    ['A#1#c', ['A#1#c', 'A#2#c', 'C#1#c']],
    ['B#1#c', ['B#1#c', 'C#2#c']],
  ])
  for (const visits of bundled.pathVisits!.values()) {
    expect(visits.every(v => ['ref', 'A#1#c', 'B#1#c'].includes(v.path))).toBe(
      true,
    )
  }
})

test('a bundle is as many tubes wide as walks it stands for', () => {
  const { layout } = tubeMapReferenceLayout(bundleRoutes(graph()))!.tubeMap!
  const width = (name: string) =>
    layout.tracks.find(t => t.name === name)!.width
  expect(width('A#1#c')).toBe(3 * width('ref'))
  expect(width('B#1#c')).toBe(2 * width('ref'))
})

test('a graph whose walks all differ is left as it is', () => {
  const g = graph()
  const distinct = { ...g, paths: g.paths!.slice(0, 2) }
  expect(bundleRoutes(distinct)).toBe(distinct)
})

// A and C share a route, and split by group they sit side by side under it
test("a route's walks split by group, the strands side by side", () => {
  const group = (walk: string) => (walk.startsWith('C') ? 'x' : 'y')
  const bundled = bundleRoutes(graph(), group)
  expect(bundled.paths!.map(p => [p.name, p.members ?? [p.name]])).toEqual([
    ['ref', ['ref']],
    ['C#1#c', ['C#1#c']],
    ['A#1#c', ['A#1#c', 'A#2#c']],
    ['C#2#c', ['C#2#c']],
    ['B#1#c', ['B#1#c']],
  ])
})
