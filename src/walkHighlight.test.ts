import { convertGFAToGraph } from './gfa/gfaConverter'
import { parseGFA } from './gfa-core/index'
import { anchorGraph } from './pathAnchoring'
import { computeReferenceRamp } from './renderer/GeometryBuilder'
import { NO_VALUE_COLOR, encodedColor, schemeColor } from './walkEncoding'
import { facetLifts, walkHighlight, walkLift } from './walkHighlight'
import { walkKey, walkPosition } from './walkKey'

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

// inv crosses v1 v2 v3 backwards
const WALKS = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
S\ta1\tTTTTTT
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv1\t+\ta1\t+\t0M
L\ta1\t+\tv3\t+\t0M
W\tref\t0\tchr\t0\t9\t>v1>v2>v3
W\talt\t1\tchr\t0\t13\t>v1>a1>v3
W\tinv\t1\tchr\t0\t9\t<v3<v2<v1`

const walks = anchorGraph(convertGFAToGraph(parseGFA(WALKS)), 'ref')
const ramp = computeReferenceRamp(walks, { start: 0, end: 9 })

test('walks lifted together each take one flat colour, the reference grey', () => {
  const lift = walkLift(
    walks,
    [{ walk: 'alt#1#chr' }, { walk: 'ref#0#chr' }, { walk: 'inv#1#chr' }],
    ramp,
  )!
  expect(lift.walks.map(w => [w.name, w.encoding])).toEqual([
    ['ref#0#chr', { field: 'walk', scheme: 'grey' }],
    ['alt#1#chr', { field: 'walk', scheme: 'blue' }],
    ['inv#1#chr', { field: 'walk', scheme: 'red' }],
  ])
  const [ref] = lift.walks
  expect(new Set(ref!.colors.values()).size).toBe(1)
  expect(lift.nodeIds).toEqual(new Set(['v1+', 'v2+', 'v3+', 'a1+']))
})

test('a walk lifted alone shades light to dark along itself', () => {
  const [ref] = walkLift(walks, [{ walk: 'ref#0#chr' }], ramp)!.walks
  expect(ref!.encoding).toEqual({ field: 'progress', scheme: 'grey' })
  expect(ref!.colors.get('v1+')).toBe(schemeColor('grey', 2 / 9))
  expect(ref!.colors.get('v3+')).toBe(schemeColor('grey', 7.5 / 9))
  // inv crosses the same nodes from v3, so it shades the other way
  const [inv] = walkLift(walks, [{ walk: 'inv#1#chr' }], ramp)!.walks
  expect(inv!.colors.get('v3+')).toBe(schemeColor('blue', 1.5 / 9))
  expect(inv!.colors.get('v1+')).toBe(schemeColor('blue', 7 / 9))
})

test('a walk states where its stretch sits on its own contig, from its record', () => {
  const lift = walkLift(walks, [{ walk: 'alt#1#chr' }], ramp)!
  expect(lift.walks[0]!.range).toEqual({ contig: 'chr', start: 0, end: 13 })
  expect(lift.referenceDomain).toEqual({ start: 0, end: 9 })
})

test('one colour for the walk paints it flat', () => {
  const [alt] = walkLift(walks, [
    { walk: 'alt#1#chr', color: { field: 'walk' } },
  ])!.walks
  const blue = encodedColor({ field: 'walk', scheme: 'blue' })
  expect(new Set(alt!.colors.values())).toEqual(new Set([blue]))
})

test('progress runs pale to deep along the walk', () => {
  const [alt] = walkLift(walks, [
    { walk: 'alt#1#chr', color: { field: 'progress', scheme: 'green' } },
  ])!.walks
  // a1 is 4 + 3 bp into alt's 13
  expect(alt!.progress.get('a1+')).toBeCloseTo(7 / 13)
  expect(alt!.colors.get('a1+')).toBe(schemeColor('green', 7 / 13))
})

test('a stranger lifts nothing, a repeat lifts once, and what this build lacks reads as unset', () => {
  const lift = walkLift(walks, [
    { walk: 'nobody' },
    { walk: 'alt#1#chr', color: { field: 'visits', scheme: 'greys' } },
    { walk: 'alt#1#chr', color: { scheme: 'purple' } },
  ] as never)!
  expect(lift.walks.map(w => w.encoding)).toEqual([
    { field: 'progress', scheme: 'blue' },
  ])
  expect(walkLift(walks, [{ walk: 'nobody' }])).toBeUndefined()
})

test('the rainbow is only for reference position', () => {
  const [alt] = walkLift(walks, [
    { walk: 'alt#1#chr', color: { field: 'progress', scheme: 'rainbow' } },
  ])!.walks
  expect(alt!.encoding).toEqual({ field: 'progress', scheme: 'blue' })
})

test('a walk crossing the reference backwards says where it does', () => {
  const lift = walkLift(walks, [
    { walk: 'ref#0#chr' },
    { walk: 'alt#1#chr' },
    { walk: 'inv#1#chr' },
  ])!
  const [ref, alt, inv] = lift.walks
  expect(ref!.reversed.size).toBe(0)
  expect(alt!.reversed.size).toBe(0)
  expect(inv!.reversed).toEqual(new Set(['v3+', 'v2+', 'v1+']))
  expect(inv!.reversedBp).toBe(9)
})

test('reference position is charcoal off the reference, and may take the rainbow', () => {
  const [alt, inv] = walkLift(
    walks,
    [
      { walk: 'alt#1#chr', color: { field: 'reference' } },
      { walk: 'inv#1#chr', color: { field: 'reference', scheme: 'rainbow' } },
    ],
    ramp,
  )!.walks
  expect(alt!.encoding.scheme).toBe('blue')
  expect(alt!.colors.get('a1+')).toBe(NO_VALUE_COLOR)
  expect(inv!.colors.get('v1+')).toBe(schemeColor('rainbow', 2 / 9))
})

test('a facet lifts each walk alone on the shared scale, unless its layer states its own', () => {
  const layers = [
    { walk: 'ref#0#chr' },
    { walk: 'alt#1#chr', color: { scheme: 'green' as const } },
  ]
  const [ref, alt] = facetLifts(walks, walkLift(walks, layers)!, layers)
  expect(ref!.walks.map(w => w.encoding)).toEqual([
    { field: 'progress', scheme: 'red' },
  ])
  expect(alt!.walks[0]!.encoding).toEqual({
    field: 'progress',
    scheme: 'green',
  })
  expect(alt!.nodeIds).toEqual(new Set(['v1+', 'a1+', 'v3+']))
  expect(alt!.walks[0]!.colors.get('a1+')).toBe(schemeColor('green', 7 / 13))
})

test('a walk key writes the stretch a shading lane runs over, and leaves a flat one to hover', () => {
  const [inv] = walkLift(walks, [{ walk: 'inv#1#chr' }], ramp)!.walks
  expect(walkKey(inv!)).toEqual({
    delta: '',
    outside: '',
    reversed: ', 9 bp reversed',
    shades: true,
    scale: 'chr:0-9 (9 bp)',
    hover: undefined,
  })
  const [alt] = walkLift(walks, [
    { walk: 'alt#1#chr', color: { field: 'walk' } },
  ])!.walks
  expect(walkKey(alt!)).toMatchObject({
    delta: ' +4 bp',
    shades: false,
    scale: undefined,
    hover: 'chr:0-13 (13 bp)',
  })
  const [onReference] = walkLift(
    walks,
    [{ walk: 'alt#1#chr', color: { field: 'reference' } }],
    ramp,
  )!.walks
  expect(walkKey(onReference!, { name: 'chr1', start: 0, end: 9 }).scale).toBe(
    'chr1:0-9 (9 bp)',
  )
})

test("a node's position on a walk is its stretch on the walk's own contig", () => {
  const [alt, inv] = walkLift(walks, [
    { walk: 'alt#1#chr' },
    { walk: 'inv#1#chr' },
  ])!.walks
  expect(walkPosition(alt!, 'a1+', 6)).toBe('chr:4-10')
  expect(walkPosition(inv!, 'v1+', 4)).toBe('chr:5-9')
  expect(walkPosition(inv!, 'a1+', 6)).toBeUndefined()
})
