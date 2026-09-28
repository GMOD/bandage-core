import { convertGFAToGraph } from './gfa/gfaConverter'
import { parseGFA } from './gfa-core/index'
import { anchorGraph } from './pathAnchoring'
import { computeReferenceRamp } from './renderer/GeometryBuilder'
import { NO_VALUE_COLOR, STRAND_T, schemeColor } from './walkEncoding'
import { walkHighlight, walkLift } from './walkHighlight'

// ref walks v1 v2 v3; alt walks v1 a1 v3, taking a1 in place of v2. The a1->v3
// link is written the other way round in the file, so the walk's step has to
// find it against the edge's direction.
const GFA = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
S\ta1\tTTTTTT
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv1\t+\ta1\t+\t0M
L\tv3\t-\ta1\t-\t0M
W\tref\t0\tchr\t0\t9\t>v1>v2>v3
W\talt\t1\tchr\t0\t13\t>v1>a1>v3`

const graph = anchorGraph(convertGFAToGraph(parseGFA(GFA)), 'ref')

test('a walk lifts its nodes, its links either way round, and its bp', () => {
  const h = walkHighlight(graph, 'alt#1#chr')!
  expect([...h.nodeIds]).toEqual(['v1+', 'a1+', 'v3+'])
  expect([...h.edgeIndexes].sort()).toEqual([2, 3])
  expect(h).toMatchObject({ steps: 3, bp: 13, referenceBp: 9 })
})

test('the reference walk compares to nothing, and a stranger is undefined', () => {
  expect(walkHighlight(graph, 'ref#0#chr')!.referenceBp).toBeUndefined()
  expect(walkHighlight(graph, 'nobody')).toBeUndefined()
})

// `odgi extract` leaves the extracted range on each P record's name. The anchor
// name has it stripped, so the reference walk has to be found the same way.
const ODGI = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
S\ta1\tTTTTTT
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv1\t+\ta1\t+\t0M
L\ta1\t+\tv3\t+\t0M
P\tK12#1#chr:1000-1009\tv1+,v2+,v3+\t*
P\tSakai#1#chr:2000-2013\tv1+,a1+,v3+\t*`

test('a walk is measured against a reference path whose name carries a range', () => {
  const extracted = anchorGraph(convertGFAToGraph(parseGFA(ODGI)), 'K12')
  const h = walkHighlight(extracted, 'Sakai#1#chr:2000-2013')!
  expect(h).toMatchObject({ bp: 13, referenceBp: 9 })
  expect(
    walkHighlight(extracted, 'K12#1#chr:1000-1009')!.referenceBp,
  ).toBeUndefined()
})

// inv crosses v1 v2 v3 backwards; rep crosses v2 twice
const WALKS = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
S\ta1\tTTTTTT
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv1\t+\ta1\t+\t0M
L\ta1\t+\tv3\t+\t0M
L\tv2\t+\tv2\t+\t0M
W\tref\t0\tchr\t0\t9\t>v1>v2>v3
W\talt\t1\tchr\t0\t13\t>v1>a1>v3
W\tinv\t1\tchr\t0\t9\t<v3<v2<v1
W\trep\t1\tchr\t0\t11\t>v1>v2>v2>v3`

const walks = anchorGraph(convertGFAToGraph(parseGFA(WALKS)), 'ref')
const ramp = computeReferenceRamp(walks, { start: 0, end: 9 })

test('the reference walk takes the rainbow by position, the rest a family each by progress', () => {
  const lift = walkLift(
    walks,
    [{ walk: 'alt#1#chr' }, { walk: 'ref#0#chr' }, { walk: 'inv#1#chr' }],
    ramp,
  )!
  expect(lift.walks.map(w => [w.name, w.encoding])).toEqual([
    ['ref#0#chr', { field: 'reference', scheme: 'rainbow' }],
    ['alt#1#chr', { field: 'progress', scheme: 'blues' }],
    ['inv#1#chr', { field: 'progress', scheme: 'reds' }],
  ])
  const ref = lift.walks[0]!
  expect(ref.colors.get('v1+')).toBe(schemeColor('rainbow', 2 / 9))
  expect(ref.colors.get('v3+')).toBe(schemeColor('rainbow', 7.5 / 9))
  // alt's a1 is 4 + 3 bp into its 13
  const alt = lift.walks[1]!
  expect(alt.progress.get('a1+')).toBeCloseTo(7 / 13)
  expect(alt.colors.get('a1+')).toBe(schemeColor('blues', 7 / 13))
  expect(lift.nodeIds).toEqual(new Set(['v1+', 'v2+', 'v3+', 'a1+']))
})

test('a stated encoding wins, a stranger lifts nothing, a repeat lifts once', () => {
  const lift = walkLift(walks, [
    { walk: 'nobody' },
    { walk: 'alt#1#chr', color: { scheme: 'greens' } },
    { walk: 'alt#1#chr' },
  ])!
  expect(lift.walks.map(w => w.encoding)).toEqual([
    { field: 'progress', scheme: 'greens' },
  ])
  expect(walkLift(walks, [{ walk: 'nobody' }])).toBeUndefined()
})

test('strand marks a walk reversed against the reference, and nothing off it', () => {
  const lift = walkLift(
    walks,
    ['alt#1#chr', 'inv#1#chr'].map(walk => ({
      walk,
      color: { field: 'strand' as const, scheme: 'reds' as const },
    })),
  )!
  const [alt, inv] = lift.walks
  expect(alt!.colors.get('v1+')).toBe(schemeColor('reds', STRAND_T.same))
  expect(alt!.colors.get('a1+')).toBe(NO_VALUE_COLOR)
  expect(inv!.colors.get('v2+')).toBe(schemeColor('reds', STRAND_T.reversed))
})

test('visits deepen with every pass a walk makes through a node', () => {
  const [rep] = walkLift(walks, [
    { walk: 'rep#1#chr', color: { field: 'visits' } },
  ])!.walks
  expect(rep!.colors.get('v1+')).toBe(schemeColor('blues', 0))
  expect(rep!.colors.get('v2+')).toBe(schemeColor('blues', 1 / 3))
})

test('reference position is charcoal off the reference', () => {
  const [alt] = walkLift(
    walks,
    [{ walk: 'alt#1#chr', color: { field: 'reference' } }],
    ramp,
  )!.walks
  expect(alt!.colors.get('a1+')).toBe(NO_VALUE_COLOR)
})
