import { archSeeds, closedStretches, likeEndJoins } from './archSeeds'

import type { GraphEdge } from '../types'
import type { BandageScaleOpts } from './drawnScale'
import type { LayoutNode } from './referenceSeeds'

const STEP = 100

const OPTS: BandageScaleOpts = {
  nodeLengthPerMegabase: 1_000_000,
  minimumNodeLength: 5,
  nodeSegmentLength: 20,
  edgeLength: 5,
}

const reference = (count: number): LayoutNode[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${i + 1}+`,
    name: String(i + 1),
    length: 50,
    depth: 1,
    stable: { refName: 'ref', start: i * STEP, rank: 0 },
    x: i * STEP,
    y: 0,
  }))

const offReference = (id: string, x: number, length = 1): LayoutNode => ({
  id,
  name: id,
  length,
  depth: 1,
  stable: { refName: 'alt', start: 0, rank: 1 },
  x,
  y: 120,
})

const chain = (nodes: LayoutNode[]): GraphEdge[] =>
  nodes.flatMap((n, i) => {
    const next = nodes[i + 1]
    return next ? [{ from: n.id, to: next.id }] : []
  })

const restated = (
  n: LayoutNode,
  id: string,
  strand: '+' | '-',
): LayoutNode => ({
  ...n,
  id,
  stable: n.stable ? { ...n.stable, strand } : undefined,
})

const rightToRight = (from: string, to: string): GraphEdge => ({
  from,
  to,
  toStrand: '-',
})

const leftToLeft = (from: string, to: string): GraphEdge => ({
  from,
  fromStrand: '-',
  to,
})

const lifted = (nodes: LayoutNode[], edges: GraphEdge[]) =>
  archSeeds(nodes, edges, OPTS).filter(
    n => n.stable?.rank === 0 && (n.y ?? 0) !== 0,
  )

const ids = (nodes: LayoutNode[]) => nodes.map(n => n.id)

const ref = reference(12)
const alt = offReference('a', 150)
const turned = [...chain(ref), rightToRight('3+', '8+'), leftToLeft('4+', '9+')]

test('a stretch joined to the reference by like ends is seeded on an arch, away from the off-reference seeds', () => {
  const moved = lifted([...ref, alt], turned)
  expect(ids(moved)).toEqual(['5+', '6+', '7+'])
  expect(moved.every(n => (n.y ?? 0) < 0)).toBe(true)
})

test('the arch is 0.3 of a half-circle on the chord', () => {
  const moved = lifted([...ref, alt], turned)
  const chord = 4 * STEP
  expect(moved.map(n => n.y)).toEqual(
    [1, 2, 3].map(
      k => 0.3 * ((-chord / 2) * Math.sin((Math.PI * k * STEP) / chord)),
    ),
  )
})

test('every other seed, every x and the order of the nodes stay as they were', () => {
  const nodes = [...ref, alt]
  const out = archSeeds(nodes, turned, OPTS)
  expect(ids(out)).toEqual(ids(nodes))
  expect(out.map(n => n.x)).toEqual(nodes.map(n => n.x))
  expect(out.filter((n, i) => n !== nodes[i]).map(n => n.id)).toEqual([
    '5+',
    '6+',
    '7+',
  ])
})

test('a graph with no like-end join gets its own nodes back', () => {
  const nodes = [...ref, alt]
  const skip: GraphEdge = { from: '3+', to: '8+' }
  expect(archSeeds(nodes, chain(ref), OPTS)).toEqual(nodes)
  expect(archSeeds(nodes, [...chain(ref), skip], OPTS)).toEqual(nodes)
  expect(likeEndJoins(nodes, [...chain(ref), skip], OPTS)).toEqual([])
})

test('like ends of neighbours, of one node, or across one or two nodes lift nothing', () => {
  expect(lifted(ref, [...chain(ref), rightToRight('3+', '4+')])).toEqual([])
  expect(lifted(ref, [...chain(ref), rightToRight('5+', '5+')])).toEqual([])
  expect(
    lifted(ref, [
      ...chain(ref),
      rightToRight('3+', '5+'),
      leftToLeft('4+', '6+'),
    ]),
  ).toEqual([])
})

test('overlapping stretches share one arch', () => {
  const moved = lifted(ref, [
    ...chain(ref),
    rightToRight('2+', '6+'),
    rightToRight('4+', '8+'),
  ])
  expect(ids(moved)).toEqual(['4+', '5+', '6+', '7+'])
})

test('a stretch that is most of the window is arched no higher than 0.3 of a quarter of it', () => {
  const moved = lifted(
    [...ref, alt],
    [...chain(ref), rightToRight('1+', '11+')],
  )
  const deepest = Math.min(...moved.map(n => n.y ?? 0))
  expect(ids(moved)).toEqual(['3+', '4+', '5+', '6+', '7+', '8+', '9+', '10+'])
  expect(deepest).toBeGreaterThanOrEqual(-0.3 * 0.25 * 11 * STEP)
  expect(deepest).toBeLessThan(-0.3 * 0.2 * 11 * STEP)
})

test('a stretch across a jump of more than half the window in reference position stays on the line', () => {
  const far = ref.map((n, i) =>
    i === 0
      ? n
      : {
          ...n,
          stable: { refName: 'ref', start: 1_000_000 + i * STEP, rank: 0 },
        },
  )
  expect(lifted(far, [...chain(far), rightToRight('1+', '5+')])).toEqual([])
  expect(ids(lifted(far, [...chain(far), rightToRight('3+', '7+')]))).toEqual([
    '5+',
    '6+',
  ])
})

test('a stretch whose joined node the cut does not link along the reference stays on the line', () => {
  const dangling = chain(ref).filter(e => e.from !== '2+')
  const nodes = [...ref, alt]
  expect(lifted(nodes, [...dangling, rightToRight('8+', '2+')])).toEqual([])
  expect(
    closedStretches(nodes, [...dangling, rightToRight('8+', '2+')], OPTS)
      .stretches,
  ).toEqual([])
  expect(
    closedStretches(nodes, [...chain(ref), rightToRight('8+', '2+')], OPTS)
      .stretches,
  ).toEqual([{ lo: 2, hi: 7 }])
})

test('a stretch is closed by links from its lowest to its highest rank, whatever lies beyond', () => {
  const stretchesOver = (gaps: string[], from: string, to: string) =>
    closedStretches(
      ref,
      [
        ...chain(ref).filter(e => !gaps.includes(e.from)),
        rightToRight(from, to),
      ],
      OPTS,
    ).stretches
  expect(stretchesOver(['2+', '9+'], '3+', '9+')).toEqual([{ lo: 3, hi: 8 }])
  expect(stretchesOver(['3+'], '3+', '9+')).toEqual([])
  expect(stretchesOver(['8+'], '3+', '9+')).toEqual([])
  expect(stretchesOver([], '3+', '12+')).toEqual([{ lo: 3, hi: 11 }])
  expect(
    closedStretches(
      ref,
      [
        ...chain(ref),
        ...chain(ref).map(e => ({ from: e.to, to: e.from })),
        rightToRight('3+', '9+'),
        rightToRight('3+', '9+'),
      ],
      OPTS,
    ).stretches,
  ).toEqual([{ lo: 3, hi: 8 }])
})

test('closed stretches match a rank-by-rank walk on random cuts', () => {
  let seed = 11
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const pick = (n: number) => Math.floor(rand() * n)
  for (let round = 0; round < 200; round++) {
    const nodes = reference(2 + pick(30))
    const links = chain(nodes).filter(() => rand() > 0.1)
    const joins = Array.from({ length: pick(12) }, () => {
      const a = nodes[pick(nodes.length)]!.id
      const b = nodes[pick(nodes.length)]!.id
      return rand() < 0.5 ? rightToRight(a, b) : leftToLeft(a, b)
    })
    const edges = [...links, ...links.slice(0, pick(links.length)), ...joins]
    const rank = new Map(nodes.map((n, i) => [n.id, i]))
    const linked = (r: number) =>
      edges.some(e => {
        const a = rank.get(e.from)!
        const b = rank.get(e.to)!
        return Math.min(a, b) === r && Math.abs(a - b) === 1
      })
    const walked = new Map<string, { lo: number; hi: number }>()
    for (const j of likeEndJoins(nodes, edges, OPTS)) {
      const a = rank.get(j.from)!
      const b = rank.get(j.to)!
      const [lo, hi] = [Math.min(a, b), Math.max(a, b)]
      let unbroken = a !== b
      for (let r = lo; r < hi; r++) {
        unbroken &&= linked(r)
      }
      const s = j.fromSide === 'right' ? { lo: lo + 1, hi } : { lo, hi: hi - 1 }
      if (unbroken && s.lo < s.hi) {
        walked.set(`${s.lo},${s.hi}`, s)
      }
    }
    expect(closedStretches(nodes, edges, OPTS).stretches).toEqual(
      [...walked.values()].sort((x, y) => x.lo - y.lo || y.hi - x.hi),
    )
  }
})

// Walking each join's span took 1.5 s on chrY's 14,142-node pggb window, and
// about 50 s here, past the test timeout
test('closing stretches over a long reference reads each join once, not its span', () => {
  const long = reference(40_000)
  const joins = Array.from({ length: 15_000 }, (_, i) =>
    rightToRight(long[i]!.id, long[long.length - 1 - i]!.id),
  )
  const { stretches } = closedStretches(long, [...chain(long), ...joins], OPTS)
  expect(stretches).toHaveLength(15_000)
  expect(stretches[0]).toEqual({ lo: 1, hi: 39_999 })
  expect(stretches.at(-1)).toEqual({ lo: 15_000, hi: 25_000 })
})

test('a join through one off-reference node drawn at the minimum length counts, through a longer one does not', () => {
  const short = [offReference('j1', 250), offReference('j2', 850)]
  const through: GraphEdge[] = [
    ...chain(ref),
    { from: '3+', to: 'j1' },
    { from: 'j1', to: '8+', toStrand: '-' },
    { from: '4+', fromStrand: '-', to: 'j2' },
    { from: 'j2', to: '9+' },
  ]
  const long = offReference('long', 250, 10_000)
  expect(ids(lifted([...ref, ...short], through))).toEqual(['5+', '6+', '7+'])
  expect(
    lifted(
      [...ref, long],
      [
        ...chain(ref),
        { from: '3+', to: 'long' },
        { from: 'long', to: '9+', toStrand: '-' },
      ],
    ),
  ).toEqual([])
})

test('a strand turn between a reference node and an off-reference node alone lifts nothing', () => {
  expect(
    lifted([...ref, alt], [...chain(ref), rightToRight('3+', 'a')]),
  ).toEqual([])
})

test('sides are read on the strand the reference reads a node, not on its id', () => {
  const againstId = ref.map(n => (n.id === '8+' ? restated(n, '8-', '+') : n))
  const edges: GraphEdge[] = [
    ...chain(againstId.slice(0, 7)),
    { from: '7+', to: '8-', toStrand: '+' },
    { from: '8-', fromStrand: '+', to: '9+' },
    ...chain(againstId.slice(8)),
    { from: '3+', to: '8-' },
  ]
  const withItsId = ref.map(n => restated(n, n.id.replace('+', '-'), '-'))
  expect(closedStretches(againstId, edges, OPTS).stretches).toEqual([
    { lo: 3, hi: 7 },
  ])
  expect(likeEndJoins(withItsId, chain(withItsId), OPTS)).toEqual([])
})

test('empty, unseeded and dangling input comes back as given', () => {
  const unseeded = ref.map(({ x: _x, y: _y, ...n }) => n)
  expect(archSeeds([], [], OPTS)).toEqual([])
  expect(archSeeds(unseeded, [rightToRight('2+', '9+')], OPTS)).toEqual(
    unseeded,
  )
  expect(
    archSeeds(
      ref,
      [rightToRight('2+', 'missing'), rightToRight('nowhere', '9+')],
      OPTS,
    ),
  ).toEqual(ref)
})

test('the seeds do not depend on the order the links are listed in', () => {
  const long = reference(16)
  const nodes = [...long, alt, offReference('j1', 250)]
  const edges: GraphEdge[] = [
    ...chain(long),
    rightToRight('2+', '10+'),
    leftToLeft('3+', '11+'),
    rightToRight('5+', '7+'),
    leftToLeft('6+', '8+'),
    { from: '3+', to: 'j1' },
    { from: 'j1', to: '8+', toStrand: '-' },
  ]
  const expected = archSeeds(nodes, edges, OPTS)
  expect(archSeeds(nodes, [...edges].reverse(), OPTS)).toEqual(expected)
  expect(expected).not.toEqual(nodes)
})
