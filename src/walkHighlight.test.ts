import { parseGFA } from './gfa-core/index'
import { departureTable } from './gfa/departures'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { gfaTables } from './gfa/gfaTables'
import { graphFromTables } from './gfa/graphTables'
import { anchorGraph } from './pathAnchoring'
import { computeReferenceRamp } from './renderer/GeometryBuilder'
import {
  NO_VALUE_COLOR,
  encodedColor,
  encodingStops,
  resolveEncoding,
  schemeColor,
} from './walkEncoding'
import { facetLifts, walkHighlight, walkLift } from './walkHighlight'
import { walkKey, walkPosition } from './walkKey'

import type { Graph } from './types'

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
  expect([...h.edgeIndexes].sort((a, b) => a - b)).toEqual([2, 3])
  expect(h).toMatchObject({ steps: 3, bp: 13 })
})

test('the reference walk is marked, and a stranger is undefined', () => {
  expect(walkHighlight(graph, 'ref#0#chr')!.reference).toBe(true)
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

test('a reference path whose name carries a range is the reference walk', () => {
  const extracted = anchorGraph(convertGFAToGraph(parseGFA(ODGI)), 'K12')
  const h = walkHighlight(extracted, 'Sakai#1#chr:2000-2013')!
  expect(h).toMatchObject({ bp: 13, reference: false })
  expect(walkHighlight(extracted, 'K12#1#chr:1000-1009')!.reference).toBe(true)
})

// vg names each piece of a cut walk `sample#hap#contig#start[from-to]`, and the
// walk's row stands for all of them, so lifting it takes every piece
const FRAGMENTS = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
S\ta1\tTTTTTT
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv3\t+\t0M
L\tv1\t+\ta1\t+\t0M
P\tK12#1#chr\tv1+,v2+,v3+\t*
P\tSakai#1#chr#0[0-4]\tv1+,a1+\t*
P\tSakai#1#chr#20[20-23]\tv3+\t*`

test('a walk cut into pieces lifts them all under any piece name', () => {
  const cut = anchorGraph(convertGFAToGraph(parseGFA(FRAGMENTS)), 'K12')
  const h = walkHighlight(cut, 'Sakai#1#chr#0[0-4]')!
  expect(h.bp).toBe(13)
  expect([...h.nodeIds].sort()).toEqual(['a1+', 'v1+', 'v3+'])
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

test('a stated value paints a walk that colour, the reference too, and its key', () => {
  const lift = walkLift(
    walks,
    [
      { walk: 'ref#0#chr', color: { value: '#5c5c5c' } },
      { walk: 'alt#1#chr', color: { value: '#2a9fd0', field: 'progress' } },
      { walk: 'inv#1#chr', color: { value: 'teal' } },
    ],
    ramp,
  )!
  expect(lift.walks.map(w => [w.name, w.encoding])).toEqual([
    ['ref#0#chr', { field: 'walk', scheme: 'grey', value: '#5c5c5c' }],
    ['alt#1#chr', { field: 'walk', scheme: 'blue', value: '#2a9fd0' }],
    ['inv#1#chr', { field: 'walk', scheme: 'red' }],
  ])
  const [ref, alt] = lift.walks
  expect(new Set(ref!.colors.values())).toEqual(
    new Set([
      encodedColor({ field: 'walk', scheme: 'grey', value: '#5c5c5c' }),
    ]),
  )
  expect(new Set(alt!.colors.values()).size).toBe(1)
  expect(encodingStops(alt!.encoding)).toEqual([
    {
      offset: 0,
      color: 'rgb(42, 159, 208)',
      abgr: [...alt!.colors.values()][0],
    },
  ])
})

test('a walk lifted alone with a stated value is that one colour', () => {
  const [ref] = walkLift(
    walks,
    [{ walk: 'ref#0#chr', color: { value: '#abc' } }],
    ramp,
  )!.walks
  expect(ref!.encoding).toEqual({
    field: 'walk',
    scheme: 'grey',
    value: '#abc',
  })
  expect(encodingStops(ref!.encoding)[0]!.color).toBe('rgb(170, 187, 204)')
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

test('flat lanes past the four families take each one deeper, then paler', () => {
  const nth = (picked: number) =>
    resolveEncoding({ walk: 'w' }, false, picked, false)
  expect(nth(0)).toEqual({ field: 'walk', scheme: 'blue' })
  expect(nth(4)).toEqual({ field: 'walk', scheme: 'blue', shade: 0.85 })
  expect(nth(9)).toEqual({ field: 'walk', scheme: 'red', shade: 0.2 })
  const twelve = Array.from({ length: 12 }, (_, i) => encodedColor(nth(i)))
  expect(new Set(twelve).size).toBe(12)
  expect(encodingStops(nth(4))[0]!.abgr).toBe(twelve[4])
  expect(
    resolveEncoding({ walk: 'w', color: { scheme: 'green' } }, false, 4, false),
  ).toEqual({ field: 'walk', scheme: 'green' })
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

test('a walk key states no length against the reference and no reversed bp, writes the stretch a shading lane runs over, and leaves a flat one to hover', () => {
  const [inv] = walkLift(walks, [{ walk: 'inv#1#chr' }], ramp)!.walks
  expect(walkKey(inv!)).toEqual({
    gaps: '',
    shades: true,
    scale: 'chr:1-9 (9 bp)',
    hover: undefined,
  })
  const [alt] = walkLift(walks, [
    { walk: 'alt#1#chr', color: { field: 'walk' } },
  ])!.walks
  expect(walkKey(alt!)).toEqual({
    gaps: '',
    shades: false,
    scale: undefined,
    hover: 'chr:1-13 (13 bp)',
  })
  const [onReference] = walkLift(
    walks,
    [{ walk: 'alt#1#chr', color: { field: 'reference' } }],
    ramp,
  )!.walks
  expect(walkKey(onReference!, { name: 'chr1', start: 0, end: 9 }).scale).toBe(
    'chr1:1-9 (9 bp)',
  )
})

test("a node's position on a walk is its stretch on the walk's own contig", () => {
  const [alt, inv] = walkLift(walks, [
    { walk: 'alt#1#chr' },
    { walk: 'inv#1#chr' },
  ])!.walks
  expect(walkPosition(alt!, 'a1+', 6)).toEqual({ onWalk: true, at: 'chr:5-10' })
  expect(walkPosition(inv!, 'v1+', 4)).toEqual({ onWalk: true, at: 'chr:6-9' })
  expect(walkPosition(inv!, 'a1+', 6)).toEqual({
    onWalk: false,
    at: undefined,
  })
})

test('a walk in a tagged walk cut is not the reference walk', () => {
  const gfa = [
    'S\t1\t*\tLN:i:10\tSN:Z:GRCh38#0#chr1\tSO:i:100\tSR:i:0',
    'S\t2\t*\tLN:i:5',
    'S\t3\t*\tLN:i:10\tSN:Z:GRCh38#0#chr1\tSO:i:110\tSR:i:0',
    'L\t1\t+\t3\t+\t0M',
    'L\t1\t+\t2\t+\t0M',
    'L\t2\t+\t3\t+\t0M',
    'W\tGRCh38\t0\tchr1\t100\t120\t>1>3',
    'W\tHG1\t1\tctg\t0\t25\t>1>2>3',
  ].join('\n')
  const looped = anchorGraph(convertGFAToGraph(parseGFA(gfa)), undefined)
  const name = looped.paths!.find(p => p.name.startsWith('HG1'))!.name
  const walk = walkHighlight(looped, name)!
  expect(walk.reference).toBe(false)
})

const REPEAT = `${GFA}
L\tv2\t+\tv1\t+\t0M
L\ta1\t+\tv1\t+\t0M
W\tdup\t1\tchr\t0\t8\t>v1>v2>v1
W\tdup\t1\tchr\t8\t21\t>a1>v1>v2>v3`

test('a walk counts its passes through each node over all its pieces', () => {
  const h = walkHighlight(
    anchorGraph(convertGFAToGraph(parseGFA(REPEAT)), 'ref'),
    'dup#1#chr',
  )!
  expect(Object.fromEntries(h.passes)).toEqual({
    'v1+': 3,
    'v2+': 2,
    'a1+': 1,
    'v3+': 1,
  })
  expect(h.mostPasses).toBe(3)
  expect(h.route).toEqual([
    ['v1+', 'v2+', 'v1+'],
    ['a1+', 'v1+', 'v2+', 'v3+'],
  ])
  expect(walkHighlight(graph, 'ref#0#chr')!.mostPasses).toBe(1)
})

test('a repeat shades each pass at its own place along the walk', () => {
  const repeat = anchorGraph(convertGFAToGraph(parseGFA(REPEAT)), 'ref')
  const [, dup] = walkLift(repeat, [
    { walk: 'ref#0#chr' },
    { walk: 'dup#1#chr', color: { field: 'progress', scheme: 'orange' } },
  ])!.walks
  const passes = dup!.passProgress.get('v1+')!
  expect(passes.map(t => t * 23)).toEqual([2, 8, 18])
  expect(dup!.passColors.get('v1+')).toEqual(
    passes.map(t => encodedColor(dup!.encoding, t)),
  )
  expect(dup!.colors.get('v1+')).toBe(dup!.passColors.get('v1+')![0])
})

// ref walks the repeat v1 twice, at 0 and 6; tail walks it once, after v2
const COPIES = `S\tv1\tAAAA
S\tv2\tCC
S\tv3\tGGG
L\tv1\t+\tv2\t+\t0M
L\tv2\t+\tv1\t+\t0M
L\tv1\t+\tv3\t+\t0M
W\tref\t0\tchr\t0\t13\t>v1>v2>v1>v3
W\ttail\t1\tchr\t0\t9\t>v2>v1>v3`

test('each pass through a collapsed repeat takes its own copy on the reference', () => {
  const copies = anchorGraph(convertGFAToGraph(parseGFA(COPIES)), 'ref')
  const copyRamp = computeReferenceRamp(copies, { start: 0, end: 13 })
  const [ref, tail] = walkLift(
    copies,
    [
      { walk: 'ref#0#chr', color: { field: 'reference', scheme: 'rainbow' } },
      { walk: 'tail#1#chr', color: { field: 'reference', scheme: 'rainbow' } },
    ],
    copyRamp,
  )!.walks
  const at = (w: typeof ref, mids: number[]) =>
    mids.map(mid => encodedColor(w!.encoding, mid / 13))
  expect(ref!.passColors.get('v1+')).toEqual(at(ref, [2, 8]))
  expect(tail!.passColors.get('v1+')).toEqual(at(tail, [8]))
})

test('walks lifted together shade no darker than mid-lightness, alone they do', () => {
  const [, alt] = walkLift(graph, [
    { walk: 'ref#0#chr', color: { field: 'progress' } },
    { walk: 'alt#1#chr', color: { field: 'progress' } },
  ])!.walks
  const [alone] = walkLift(graph, [{ walk: 'alt#1#chr' }])!.walks
  expect(alt!.encoding.darkest).toBeGreaterThan(0.5)
  expect(alone!.encoding.darkest).toBeUndefined()
  const luma = (c: number) =>
    (c & 0xff) + ((c >> 8) & 0xff) + ((c >> 16) & 0xff)
  expect(luma(alt!.colors.get('v3+')!)).toBeGreaterThan(
    luma(alone!.colors.get('v3+')!),
  )
})

test('a floor on lightness keeps the light end and the flat colour', () => {
  expect(schemeColor('blue', 0, 0.55)).toBe(schemeColor('blue', 0))
  expect(schemeColor('blue', 1, 0.55)).not.toBe(schemeColor('blue', 1))
  expect(schemeColor('rainbow', 1, 0.55)).toBe(schemeColor('rainbow', 1))
})

test('ramps past the fourth walk split their family, the first taking the pale end', () => {
  const haplotypes = [1, 2, 3, 4, 5].map(i => `h${i}#1#chr`)
  const five = convertGFAToGraph(
    parseGFA(
      [
        'S\tv1\tAAAA',
        'S\tv2\tCC',
        'L\tv1\t+\tv2\t+\t0M',
        ...haplotypes.map(h => `W\t${h.split('#')[0]}\t1\tchr\t0\t6\t>v1>v2`),
      ].join('\n'),
    ),
  )
  const lifted = (n: number) =>
    walkLift(
      five,
      haplotypes
        .slice(0, n)
        .map(walk => ({ walk, color: { field: 'progress' as const } })),
    )!.walks
  expect(lifted(4).every(w => w.encoding.stretch === undefined)).toBe(true)
  const [first, , , , fifth] = lifted(5)
  expect([first!.encoding.scheme, fifth!.encoding.scheme]).toEqual([
    'blue',
    'blue',
  ])
  const stops = (w: typeof first) => encodingStops(w!.encoding).map(s => s.abgr)
  expect(stops(first)[0]).toBe(stops(lifted(4)[0])[0])
  expect(stops(first).filter(c => stops(fifth).includes(c))).toEqual([])
  expect(stops(first).at(-1)).not.toBe(stops(fifth)[0])
})

// GRCh38 reads r4 r5 r6 forward; HAPA reads r5 inverted between them, on the
// links r4+ r5- and r5- r6+ that join the same nodes as GRCh38's
const SELFIES = [
  'S\tr1\t*\tLN:i:2000\tSN:Z:GRCh38#0#chrS\tSO:i:0\tSR:i:0',
  'S\tr2\t*\tLN:i:2000\tSN:Z:GRCh38#0#chrS\tSO:i:2000\tSR:i:0',
  'S\tr3\t*\tLN:i:2000\tSN:Z:GRCh38#0#chrS\tSO:i:4000\tSR:i:0',
  'S\tr4\t*\tLN:i:2000\tSN:Z:GRCh38#0#chrS\tSO:i:6000\tSR:i:0',
  'S\tr5\t*\tLN:i:2000\tSN:Z:GRCh38#0#chrS\tSO:i:8000\tSR:i:0',
  'S\tr6\t*\tLN:i:2000\tSN:Z:GRCh38#0#chrS\tSO:i:10000\tSR:i:0',
  'S\ta\t*\tLN:i:2000',
  'S\tg\t*\tLN:i:2000',
  'S\th\t*\tLN:i:2000',
  'L\tr1\t+\tr2\t+\t0M',
  'L\tr2\t+\tr3\t+\t0M',
  'L\tr3\t+\tr4\t+\t0M',
  'L\tr4\t+\tr5\t+\t0M',
  'L\tr5\t+\tr6\t+\t0M',
  'L\tr1\t+\ta\t+\t0M',
  'L\ta\t+\ta\t+\t0M',
  'L\ta\t+\tr2\t+\t0M',
  'L\tr3\t+\tg\t-\t0M',
  'L\tg\t-\tg\t+\t0M',
  'L\tg\t+\tr4\t+\t0M',
  'L\tr4\t+\tr5\t-\t0M',
  'L\tr5\t-\tr6\t+\t0M',
  'L\tr2\t+\th\t+\t0M',
  'L\th\t+\th\t-\t0M',
  'W\tGRCh38\t0\tchrS\t0\t12000\t>r1>r2>r3>r4>r5>r6',
  'W\tHAPA\t1\tctgA\t0\t20000\t>r1>a>a>r2>r3<g>g>r4<r5>r6',
  'W\tHAPB\t1\tctgB\t0\t12000\t>r1>r2>h<h<r2<r1',
].join('\n')

const linksOf = (g: Graph, edges: Set<number>) =>
  [...edges]
    .map(i => g.edges[i]!)
    .map(
      e =>
        `${e.from.slice(0, -1)}${e.fromStrand} ${e.to.slice(0, -1)}${e.toStrand}`,
    )
    .sort()

test("a lifted walk's lane lies on the links it steps, not on another orientation's between the same nodes", () => {
  const selfies = anchorGraph(convertGFAToGraph(parseGFA(SELFIES)), 'GRCh38')
  const [reference, inverted] = walkLift(selfies, [
    { walk: 'GRCh38#0#chrS' },
    { walk: 'HAPA#1#ctgA' },
  ])!.walks
  const referenceLinks = linksOf(selfies, reference!.edgeIndexes)
  expect(referenceLinks).toEqual(expect.arrayContaining(['r4+ r5+', 'r5+ r6+']))
  expect(referenceLinks).not.toContain('r4+ r5-')
  expect(referenceLinks).not.toContain('r5- r6+')
  expect(linksOf(selfies, inverted!.edgeIndexes)).toEqual(
    expect.arrayContaining(['r4+ r5-', 'r5- r6+']),
  )
  expect(linksOf(selfies, inverted!.edgeIndexes)).not.toContain('r4+ r5+')
})

// up reads b after a, down reads them both reversed, b first: two links join
// a and b, a's end to b's start and b's end to a's start
const BOTH_WAYS = `S\ta\tAAAA
S\tb\tCC
L\ta\t+\tb\t+\t0M
L\tb\t+\ta\t+\t0M
W\tup\t0\tchr\t0\t6\t>a>b
W\tdown\t1\tchr\t0\t6\t<b<a
W\tround\t2\tchr\t0\t6\t>b>a`

test('two links between one pair of nodes each carry the walks that step them', () => {
  const both = anchorGraph(convertGFAToGraph(parseGFA(BOTH_WAYS)), 'up')
  const forward = both.edges.findIndex(e => e.from === 'a+' && e.to === 'b+')
  const back = both.edges.findIndex(e => e.from === 'b+' && e.to === 'a+')
  const lift = walkLift(both, [
    { walk: 'up#0#chr' },
    { walk: 'down#1#chr' },
    { walk: 'round#2#chr' },
  ])!
  expect(lift.walks.map(w => [...w.edgeIndexes])).toEqual([
    [forward],
    [forward],
    [back],
  ])
})

// GRCh38 reads 1 2 3; A reads 1, then leaves for 8, which its departure
// steps reversed, and rejoins at 3. Two links join 1 and 8, and two join 8
// and 3, one for each way 8 can be read; the graph holds 8- 3+ as 3- 8+
function reversedDeparture() {
  const t = gfaTables(
    [
      'H\tVN:Z:1.1',
      ...[1, 2, 3, 8].map(id => `S\t${id}\t*\tLN:i:1000`),
      'L\t1\t+\t2\t+\t0M',
      'L\t2\t+\t3\t+\t0M',
      'L\t1\t+\t8\t+\t0M',
      'L\t1\t+\t8\t-\t0M',
      'L\t8\t+\t3\t+\t0M',
      'L\t8\t-\t3\t+\t0M',
      'W\tGRCh38\t0\tchr1\t0\t3000\t>1>2>3',
      'W\tA\t1\ta\t0\t1000\t>1',
      'W\tA\t1\ta\t2000\t3000\t>3',
    ].join('\n'),
  )!
  return graphFromTables({
    ...t,
    departures: departureTable(),
    gaps: {
      names: ['A#1#a'],
      walks: Int32Array.of(1),
      edges: Uint8Array.of(0),
      starts: Float64Array.of(1000),
      ends: Float64Array.of(2000),
      segmentOffsets: Int32Array.of(0, 1),
      segments: {
        kinds: Uint8Array.of(0),
        bp: Float64Array.of(1000),
        missingBp: Float64Array.of(0),
        before: Float64Array.of(NaN),
        after: Float64Array.of(NaN),
        stepOffsets: Int32Array.of(0, 1),
        steps: Int32Array.of(t.nodes.names.indexOf('8')),
        reversed: Uint8Array.of(1),
      },
    },
  })
}

test("a lifted walk's departure takes the links its steps read their nodes on, where another link joins the same nodes the other way", () => {
  const departed = reversedDeparture()
  expect(
    linksOf(departed, walkHighlight(departed, 'A#1#a')!.edgeIndexes),
  ).toEqual(['1+ 8-', '3- 8+'])
})
