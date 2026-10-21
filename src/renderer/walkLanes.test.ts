import {
  SLOT_GAP_PX,
  THREAD_GAP_PX,
  THREAD_PX,
  drawnPasses,
  laneNormals,
  laneSlots,
  threadsPasses,
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

test('a dip in passes shorter than the smoothing is filled, a longer one is not', () => {
  const route = Object.keys(zigzag)
  const passes = new Map(route.map((id, i) => [id, i === 5 || i >= 15 ? 1 : 2]))
  const drawn = drawnPasses([route], passes, zigzag, 1, 4)
  expect(drawn.get('n5')).toBe(2)
  expect(drawn.get('n16')).toBe(1)
  expect(drawn.get('n0')).toBe(2)
})
