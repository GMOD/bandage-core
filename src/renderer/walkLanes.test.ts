import {
  SLOT_GAP_PX,
  THREAD_GAP_PX,
  THREAD_PX,
  laneLines,
  laneNormals,
  laneSlots,
  spanSlots,
  threadsPasses,
  walkThreads,
} from './walkLanes'

test('walks that pass each node once keep abutting lanes of the lane width', () => {
  expect(laneSlots([1, 1, 1], 4)).toEqual([
    [{ offset: -4, halfWidth: 2 }],
    [{ offset: 0, halfWidth: 2 }],
    [{ offset: 4, halfWidth: 2 }],
  ])
})

test('a walk takes a slot as wide as its most passes, a thread per pass', () => {
  const [one, three] = laneSlots([1, 3], 4)
  const pitch = THREAD_PX + THREAD_GAP_PX
  const band = 4 + SLOT_GAP_PX + 3 * THREAD_PX + 2 * THREAD_GAP_PX
  expect(one).toEqual([{ offset: -band / 2 + 2, halfWidth: 2 }])
  expect(three!.map(t => t.offset)).toEqual(
    [0, 1, 2].map(i => -band / 2 + 4 + SLOT_GAP_PX + THREAD_PX / 2 + i * pitch),
  )
  expect(three!.every(t => t.halfWidth === THREAD_PX / 2)).toBe(true)
  expect(three!.at(-1)!.offset + THREAD_PX / 2).toBeCloseTo(band / 2)
})

test('threads only where walks lifted together pass a node more than once', () => {
  expect(threadsPasses([{ mostPasses: 2 }])).toBe(false)
  expect(threadsPasses([{ mostPasses: 1 }, { mostPasses: 1 }])).toBe(false)
  expect(threadsPasses([{ mostPasses: 1 }, { mostPasses: 2 }])).toBe(true)
})

// a run of one-px nodes zigzagging across a straight line along x
const zigzag = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [
    `n${i}`,
    [
      { x: i, y: i % 2 ? 0.5 : -0.5 },
      { x: i + 1, y: i % 2 ? -0.5 : 0.5 },
    ],
  ]),
)

test('lane normals follow the walk smoothed, not each short node', () => {
  const route = Object.keys(zigzag)
  const field = laneNormals([route], zigzag, 1, 12)
  for (const id of route.slice(6, 14)) {
    for (const n of field.get(id)!) {
      expect(Math.abs(n!.nx)).toBeLessThan(0.1)
      expect(n!.ny).toBeGreaterThan(0.99)
    }
  }
})

test('the first walk through a node sets its normals, read the way it runs', () => {
  const route = Object.keys(zigzag)
  const field = laneNormals([[...route].reverse(), route], zigzag, 1, 12)
  expect(field.get('n10')![0]!.ny).toBeLessThan(-0.99)
})

// a walk along the line twice, its second copy taking n14' round a bubble
// beside n14
const ring = Object.keys(zigzag)
const twice = [...ring, ...ring.slice(0, 14), "n14'", ...ring.slice(15)]
const bubbled = { ...zigzag, "n14'": zigzag.n14! }
const passesOf = (route: string[]) => {
  const passes = new Map<string, number>()
  for (const id of route) {
    passes.set(id, (passes.get(id) ?? 0) + 1)
  }
  return passes
}

test('a copy keeps its thread round a bubble the other copy skips', () => {
  const t = walkThreads([twice], passesOf(twice), bubbled, 1, 8)
  expect(t.nodeThreads.get('n5')).toEqual([0, 1])
  expect(t.nodeThreads.get('n14')).toEqual([0])
  expect(t.nodeThreads.get("n14'")).toEqual([1])
  expect(t.linkThreads.get("n13>n14'")).toEqual([[1, 1]])
})

test('a copy going on alone keeps its thread near the other copy, and takes the middle away from it', () => {
  const onward = [...ring.slice(0, 10), ...ring]
  const t = walkThreads([onward], passesOf(onward), zigzag, 1, 8)
  expect(t.nodeThreads.get('n10')).toEqual([1])
  expect(t.span.get('n10')).toBe(2)
  expect(t.nodeThreads.get('n19')).toEqual([0])
  expect(t.span.get('n19')).toBe(1)
})

test('two passes never share a thread', () => {
  const route = ['n0', 'n1', 'n0', 'n1']
  const t = walkThreads([route], passesOf(route), zigzag, 1, 0)
  expect(t.nodeThreads.get('n0')).toEqual([0, 1])
})

test('a slot narrows to the threads its walk draws, and closes where the walk is away', () => {
  const both = spanSlots([2, 1, 3], [2, 2, 3], 4)
  const away = spanSlots([2, 0, 3], [2, 2, 3], 4)
  expect(both[2]!(0).offset - both[0]!(1).offset).toBeCloseTo(
    2 * SLOT_GAP_PX + 2 * THREAD_PX,
  )
  expect(away[2]!(0).offset - away[0]!(1).offset).toBeCloseTo(
    SLOT_GAP_PX + THREAD_PX,
  )
  expect(away[0]!(0).offset).toBeCloseTo(-away[2]!(2).offset)
})

test('with a band, a walk running against the first turns its normals to match', () => {
  const route = Object.keys(zigzag)
  const back = route.slice(5).reverse()
  const loose = laneLines([route.slice(0, 10), back], zigzag, 1, 4)
  const banded = laneLines([route.slice(0, 10), back], zigzag, 1, 4, 2)
  expect(loose.normals.get('n15')![0]!.ny).toBeLessThan(-0.9)
  expect(banded.normals.get('n15')![0]!.ny).toBeGreaterThan(0.9)
})

test('with a band, lanes take the chord of a curl too tight to hold it', () => {
  const curl = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => {
      const t = ((i - 10) / 20) * 2 * Math.PI
      const at =
        i < 10 || i >= 30
          ? { x: i, y: 0 }
          : { x: 10 + Math.sin(t) * 2, y: 2 - Math.cos(t) * 2 }
      return [`c${i}`, [at, { x: at.x + 0.01, y: at.y }]]
    }),
  )
  const route = Object.keys(curl)
  const { shifts } = laneLines([route], curl, 1, 1, 8)
  const top = curl.c20![0]!
  const moved = shifts.get('c20')![0]!
  expect(Math.abs(top.y + moved.dy)).toBeLessThan(1)
  expect(
    Math.hypot(shifts.get('c2')![0]!.dx, shifts.get('c2')![0]!.dy),
  ).toBeLessThan(0.5)
})
