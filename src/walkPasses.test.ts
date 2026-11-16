import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import { anchorGraph } from './pathAnchoring'
import { abgrHex } from './renderer/colorBits'
import { threadsPasses } from './renderer/walkLanes'
import {
  PASS_FROM_PASS,
  PASS_FROM_WALK,
  PASS_HUES,
  WALK_SCHEMES,
  encodingStops,
  oklabGap,
  passPalette,
  schemeColor,
} from './walkEncoding'
import { walkHighlight, walkLift } from './walkHighlight'
import {
  MOST_PASS_THREADS,
  passesOf,
  statedPasses,
  walkPassesOf,
} from './walkPasses'

import type { WalkLayer } from './walkEncoding'
import type { WalkHighlight } from './walkHighlight'
import type { WalkPasses } from './walkPasses'

const SEGMENTS = `S\tf1\tAAAAAAAAAA
S\ta\tCCCC
S\tb\tGGGG
S\tc\tTTTT
S\td\tAAAA
S\tx\tCCCC
S\tf2\tGGGGGGGGGG
W\tref\t0\tchr\t0\t36\t>f1>a>b>c>d>f2`

const HAP = 'hap#1#ctg'

function graphOf(walk: string) {
  return anchorGraph(
    convertGFAToGraph(parseGFA(`${SEGMENTS}\nW\thap\t1\tctg\t0\t*\t${walk}`)),
    'ref',
  )
}

function stepped(walk: string) {
  const graph = graphOf(walk)
  const lengths = new Map(graph.nodes.map(n => [n.id, n.length]))
  return {
    graph,
    walk: walkHighlight(graph, HAP)!,
    lengthOf: (id: string) => lengths.get(id) ?? 0,
  }
}

function found(walk: string) {
  const s = stepped(walk)
  return passesOf(s.walk, s.lengthOf)
}

const spans = (walk: string) => found(walk).passes.map(p => [p.start, p.end])

const THREE_UNITS = '>f1>a>b>c>d>a>b>c>d>a>b>c>d>f2'

// What the rule determines, checked step by step: inside a pass no node the
// walk steps again is stepped twice, and each pass after the first starts on a
// node the pass before it stepped
function boundaryBreaks(walk: WalkHighlight, passes: WalkPasses) {
  const breaks: string[] = []
  let current = -1
  let held = new Set<string>()
  walk.route.forEach((piece, p) => {
    piece.forEach((id, i) => {
      const pass = passes.withinPass[p]![i]!
      if ((walk.passes.get(id) ?? 0) > 1) {
        if (pass !== current) {
          if (pass !== current + 1) {
            breaks.push(`pass ${pass} follows pass ${current}`)
          } else if (current >= 0 && !held.has(id)) {
            breaks.push(
              `pass ${pass} starts at ${id}, which pass ${current} did not step`,
            )
          }
          current = pass
          held = new Set()
        } else if (held.has(id)) {
          breaks.push(`pass ${pass} steps ${id} twice`)
        }
        held.add(id)
      }
    })
  })
  return breaks
}

test('a walk round one unit three times makes three passes between its flanks', () => {
  expect(spans(THREE_UNITS)).toEqual([
    [10, 26],
    [26, 42],
    [42, 58],
  ])
})

test('a walk that steps no node twice has no pass', () => {
  expect(found('>f1>a>b>c>d>f2').passes).toEqual([])
})

test('a node stepped once inside a pass is on no pass, and breaks its run', () => {
  const { passes, visitPass, runs } = found('>a>b>c>a>x>b>c')
  expect(passes.map(p => [p.start, p.end])).toEqual([
    [0, 12],
    [12, 28],
  ])
  expect(visitPass.get('x+')).toEqual([-1])
  expect(runs).toEqual([
    { pass: 0, start: 0, end: 12 },
    { pass: 1, start: 12, end: 16 },
    { pass: 1, start: 20, end: 28 },
  ])
})

test('a pass that reads what it steps again on the other strand is reversed', () => {
  const { passes, visitPass } = found('>f1>a>b>c>d>x<d<c<b<a>f2')
  expect(passes.map(p => [p.start, p.end])).toEqual([
    [10, 26],
    [30, 46],
  ])
  expect(passes.map(p => p.reversed)).toEqual([false, true])
  expect(passes.map(p => p.reversedBp)).toEqual([0, 16])
  expect(visitPass.get('x+')).toEqual([-1])
})

test('a pass that spans far more than it steps again colours only what it steps again', () => {
  const graph = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        [
          'S\ta\tCCCC',
          'S\tb\tGGGG',
          'S\tp\t' + 'A'.repeat(400),
          'S\tq\t' + 'T'.repeat(400),
          'W\tref\t0\tchr\t0\t8\t>a>b',
          'W\thap\t1\tctg\t0\t*\t>a>b>a>p>q>b',
        ].join('\n'),
      ),
    ),
    'ref',
  )
  const lengths = new Map(graph.nodes.map(n => [n.id, n.length]))
  const { passes, runs } = passesOf(
    walkHighlight(graph, HAP)!,
    id => lengths.get(id) ?? 0,
  )
  expect(passes.map(p => [p.start, p.end, p.repeatBp])).toEqual([
    [0, 8, 8],
    [8, 816, 8],
  ])
  expect(runs).toEqual([
    { pass: 0, start: 0, end: 8 },
    { pass: 1, start: 8, end: 12 },
    { pass: 1, start: 812, end: 816 },
  ])
})

// The unit is a b c d and the middle copy holds only c d. The walk alone does
// not say where a unit starts, so the second pass runs on into the third
// copy's a b, and the third pass is left with c d.
test('a partial copy shifts the passes after it', () => {
  expect(spans('>f1>a>b>c>d>c>d>a>b>c>d>f2')).toEqual([
    [10, 26],
    [26, 42],
    [42, 50],
  ])
})

test('every pass keeps the rule, and a boundary planted a node off breaks it', () => {
  for (const route of [
    THREE_UNITS,
    '>a>b>c>a>x>b>c',
    '>f1>a>b>c>d>x<d<c<b<a>f2',
    '>f1>a>b>c>d>c>d>a>b>c>d>f2',
  ]) {
    const { walk, lengthOf } = stepped(route)
    expect(boundaryBreaks(walk, passesOf(walk, lengthOf))).toEqual([])
  }
  const { walk, lengthOf } = stepped(THREE_UNITS)
  const real = passesOf(walk, lengthOf)
  const plant = (step: number, pass: number) => {
    const withinPass = real.withinPass.map(piece => piece.slice())
    withinPass[0]![step] = pass
    return { ...real, withinPass }
  }
  expect(boundaryBreaks(walk, plant(5, 0))).toEqual([
    'pass 0 steps a+ twice',
    'pass 2 starts at a+, which pass 1 did not step',
  ])
  expect(boundaryBreaks(walk, plant(4, 1))).toEqual([
    'pass 1 starts at d+, which pass 0 did not step',
    'pass 1 steps d+ twice',
  ])
})

test('stated passes colour every step whose middle they hold', () => {
  const { walk, lengthOf } = stepped('>f1>a>b>c>d>f2')
  const { visitPass, stated } = statedPasses(walk, lengthOf, [
    { start: 10, end: 18 },
    { start: 18, end: 26 },
  ])
  expect(stated).toBe(true)
  expect(
    ['f1+', 'a+', 'b+', 'c+', 'd+', 'f2+'].map(id => visitPass.get(id)),
  ).toEqual([[-1], [0], [0], [1], [1], [-1]])
})

test('stated passes never move the passes a walk shows', () => {
  const { walk, lengthOf } = stepped(THREE_UNITS)
  const shown = walkPassesOf(walk, lengthOf, [{ start: 0, end: 30 }])
  expect(shown.stated).toBe(false)
  expect(shown.passes.map(p => [p.start, p.end])).toEqual([
    [10, 26],
    [26, 42],
    [42, 58],
  ])
})

test('past MOST_PASS_THREADS passes a walk bundles them', () => {
  const unit = '>a>b>c>d'
  const passesFor = (n: number) => found(`>f1${unit.repeat(n)}>f2`)
  expect(passesFor(MOST_PASS_THREADS).passes).toHaveLength(MOST_PASS_THREADS)
  expect(passesFor(MOST_PASS_THREADS).bundled).toBe(false)
  expect(passesFor(MOST_PASS_THREADS + 1).bundled).toBe(true)
})

// every pair of the colours apart by at least `gap` in OKLab
const apart = (
  colours: readonly string[],
  from: readonly string[],
  gap: number,
) =>
  colours.flatMap(c =>
    from.filter(f => f !== c && oklabGap(c, f) < gap).map(f => `${c} ${f}`),
  )

test("a walk's pass colours keep PASS_FROM_WALK from its own colour and PASS_FROM_PASS from each other, on every family and shade a lane takes", () => {
  for (const { value } of WALK_SCHEMES.filter(s => s.value !== 'rainbow')) {
    for (const t of [0.2, 0.5, 0.85]) {
      const own = abgrHex(schemeColor(value, t))
      const palette = passPalette(own, MOST_PASS_THREADS)
      expect(palette).toHaveLength(MOST_PASS_THREADS)
      expect(apart(palette, [own], PASS_FROM_WALK)).toEqual([])
      expect(apart(palette, palette, PASS_FROM_PASS)).toEqual([])
    }
  }
  expect(oklabGap('#D55E00', '#E69F00')).toBeLessThan(PASS_FROM_PASS)
})

function liftedTogether(layers: WalkLayer[]) {
  const graph = anchorGraph(
    convertGFAToGraph(
      parseGFA(
        [
          SEGMENTS,
          `W\thap\t1\tctg\t0\t*\t>f1${'>a>b>c>d'.repeat(6)}>f2`,
          `W\tsib\t2\tctg\t0\t*\t>f1${'>a>b>c>d'.repeat(3)}>f2`,
          `W\tkin\t3\tctg\t0\t*\t>f1${'>a>b>c>d'.repeat(3)}>f2`,
        ].join('\n'),
      ),
    ),
    'ref',
  )
  const lift = walkLift(graph, layers)!
  const inksOf = (name: string) =>
    lift.walks.find(w => w.name === name)?.walkPasses?.inks.map(abgrHex) ?? []
  const lanesBut = (name: string) =>
    lift.walks
      .filter(w => w.name !== name)
      .flatMap(w => encodingStops(w.encoding).map(s => abgrHex(s.abgr)))
  return { inksOf, lanesBut }
}

test("a walk's pass colours keep PASS_FROM_WALK from every other lifted walk's lane colour", () => {
  const { inksOf, lanesBut } = liftedTogether([
    { walk: 'ref#0#chr' },
    { walk: HAP, color: { field: 'pass' } },
    { walk: 'kin#3#ctg' },
  ])
  expect(inksOf(HAP)).toHaveLength(MOST_PASS_THREADS)
  expect(apart(inksOf(HAP), lanesBut(HAP), PASS_FROM_WALK)).toEqual([])
})

test('two walks coloured by pass take pass colours PASS_FROM_PASS apart, and each keeps PASS_FROM_WALK from the lanes of the rest', () => {
  const { inksOf, lanesBut } = liftedTogether([
    { walk: 'ref#0#chr' },
    { walk: 'sib#2#ctg', color: { field: 'pass' } },
    { walk: 'kin#3#ctg', color: { field: 'pass' } },
  ])
  const first = inksOf('sib#2#ctg')
  const second = inksOf('kin#3#ctg')
  expect([first.length, second.length]).toEqual([3, 3])
  expect(apart(first, lanesBut('sib#2#ctg'), PASS_FROM_WALK)).toEqual([])
  expect(apart(second, lanesBut('kin#3#ctg'), PASS_FROM_WALK)).toEqual([])
  expect(
    apart(second.concat(first), second.concat(first), PASS_FROM_PASS),
  ).toEqual([])
})

test('where no hue left keeps both distances, a pass takes the one that breaks them least', () => {
  const own = '#808080'
  const crowd = PASS_HUES.slice(2)
  const [picked] = passPalette(own, 1, crowd)
  const slack = (hue: string) =>
    Math.min(...[own, ...crowd].map(c => oklabGap(hue, c) - PASS_FROM_WALK))
  const best = PASS_HUES.reduce((most, hue) =>
    slack(hue) > slack(most) ? hue : most,
  )
  expect(slack(best)).toBeLessThan(0)
  expect(picked).toBe(best)
})

test('a walk lifted alone and coloured by pass threads, each visit in its pass colour and the rest in its own', () => {
  const graph = graphOf('>f1>a>b>c>d>a>b>c>d>f2')
  const lift = walkLift(graph, [{ walk: HAP, color: { field: 'pass' } }])!
  const walk = lift.walks[0]!
  const drawn = walk.walkPasses!
  expect(threadsPasses(lift.walks)).toBe(true)
  expect(walk.passColors.get('a+')).toEqual(drawn.inks)
  expect(drawn.inks).toHaveLength(2)
  expect(walk.passColors.get('f1+')).toEqual([drawn.ownInk])
  expect(drawn.labels).toEqual(['pass 1', 'pass 2'])
  expect(abgrHex(drawn.ownInk)).not.toBe(abgrHex(drawn.inks[0]!))
  expect(threadsPasses(walkLift(graph, [{ walk: HAP }])!.walks)).toBe(false)
})

test('passes take the names a layer gives them, and a reversed pass is marked in data, not in its name', () => {
  const graph = graphOf('>f1>a>b>c>d>x<d<c<b<a>f2')
  const lift = walkLift(graph, [
    { walk: HAP, color: { field: 'pass' }, passNames: ['copy A'] },
  ])!
  const drawn = lift.walks[0]!.walkPasses!
  expect(drawn.labels).toEqual(['copy A', 'pass 2'])
  expect(drawn.passes.map(p => [p.reversed, p.againBp, p.reversedBp])).toEqual([
    [false, 0, 0],
    [true, 16, 16],
  ])
})
