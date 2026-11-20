import { LABEL_PAD, LABEL_PX, occupancy, placeLabels } from './overlayLabels'

import type { Box } from './overlayLabels'

const frame = { width: 400, height: 300 }

test('a label that lands on a placed one, or off the pane, is dropped', () => {
  const placed = placeLabels(
    [
      { item: 'a', x: 100, y: 50, text: 'first' },
      { item: 'b', x: 110, y: 52, text: 'second' },
      { item: 'c', x: 300, y: 50, text: 'third' },
      { item: 'd', x: 900, y: 50, text: 'off' },
    ],
    frame,
    occupancy(frame),
  )
  expect(placed.map(p => p.item)).toEqual(['a', 'c'])
  expect(placed[0]!.w).toBeGreaterThan(0)
})

test('a label too wide for its spot takes its shorter fallback', () => {
  const placed = placeLabels(
    [
      {
        item: 'a',
        x: 30,
        y: 50,
        text: 'ycbF · 0.2 of 0.7 kb',
        fallback: 'ycbF …',
      },
      { item: 'b', x: 30, y: 150, text: 'no room at all here' },
    ],
    frame,
    occupancy(frame),
  )
  expect(placed.map(p => [p.item, p.text])).toEqual([['a', 'ycbF …']])
})

test('a reserved box keeps labels out of a corner', () => {
  const placed = placeLabels(
    [{ item: 'a', x: 380, y: 20, text: 'legend' }],
    frame,
    occupancy(frame, [{ x0: 300, x1: 400, y0: 0, y1: 60 }]),
  )
  expect(placed).toEqual([])
})

test('a stacking label steps down past a taken spot', () => {
  const placed = placeLabels(
    [
      { item: 'a', x: 100, y: 50, text: 'first' },
      { item: 'b', x: 100, y: 50, text: 'second', stack: 3 },
      { item: 'c', x: 100, y: 50, text: 'third', stack: 3 },
    ],
    frame,
    occupancy(frame),
  )
  expect(placed.map(p => [p.item, p.y])).toEqual([
    ['a', 50],
    ['b', 69],
    ['c', 88],
  ])
})

test('a stack near the bottom edge grows upward', () => {
  const placed = placeLabels(
    [
      { item: 'a', x: 100, y: 280, text: 'first' },
      { item: 'b', x: 100, y: 280, text: 'second', stack: 3 },
    ],
    frame,
    occupancy(frame),
  )
  expect(placed.map(p => [p.item, p.y])).toEqual([
    ['a', 280],
    ['b', 261],
  ])
})

test('a label no row under it fits stacks away from it at flipY', () => {
  const fits = (box: { y0: number }) => box.y0 < 80
  const placed = placeLabels(
    [
      { item: 'a', x: 100, y: 100, text: 'flipped', stack: 1, flipY: 70, fits },
      { item: 'b', x: 100, y: 100, text: 'flipped', stack: 1, flipY: 70, fits },
    ],
    frame,
    occupancy(frame),
  )
  expect(placed.map(p => [p.item, p.y])).toEqual([
    ['a', 70],
    ['b', 51],
  ])
})

test('a label crowded out by other labels does not flip', () => {
  const placed = placeLabels(
    [
      { item: 'a', x: 100, y: 100, text: 'taken', stack: 1 },
      { item: 'b', x: 100, y: 100, text: 'taken', stack: 1 },
      { item: 'c', x: 100, y: 100, text: 'crowded', stack: 1, flipY: 70 },
    ],
    frame,
    occupancy(frame),
  )
  expect(placed.map(p => p.item)).toEqual(['a', 'b'])
})

test('a label that may slide moves sideways, nearest first, to a free box on its row', () => {
  const key = { x0: 300, x1: 400, y0: 0, y1: 300 }
  const [placed] = placeLabels(
    [{ item: 'g', x: 290, y: 50, text: 'GENE1', slide: 20 }],
    frame,
    occupancy(frame, [key]),
    [key],
  )
  expect(placed).toMatchObject({ x: 274, y: 50 })
  expect(
    placeLabels(
      [{ item: 'g', x: 290, y: 50, text: 'GENE1' }],
      frame,
      occupancy(frame, [key]),
      [key],
    ),
  ).toEqual([])
})

// LOC124904594 at amylase slid along its own row onto AMY1A's leader, where
// it read as naming AMY1A, though the row under its pin was free
test('a label takes the next row unslid before a long slide on its own row', () => {
  const pinX = 300
  const besidePin = (box: Box) =>
    box.y1 <= 104 && Math.abs((box.x0 + box.x1) / 2 - pinX) <= 16
  const [placed] = placeLabels(
    [
      {
        item: 'LOC',
        x: pinX,
        y: 100,
        text: 'LOC124904594',
        stack: 2,
        slide: 40,
        fits: box => !besidePin(box),
      },
    ],
    frame,
    occupancy(frame),
  )
  expect(placed).toMatchObject({ x: pinX, y: 100 + LABEL_PX + 2 * LABEL_PAD })
})

test('a label only a reserved box refused still flips', () => {
  const key = { x0: 0, x1: 400, y0: 80, y1: 300 }
  const placed = placeLabels(
    [{ item: 'g', x: 100, y: 100, text: 'under the key', stack: 1, flipY: 60 }],
    frame,
    occupancy(frame, [key]),
    [key],
  )
  expect(placed.map(p => [p.item, p.y])).toEqual([['g', 60]])
})

test('a chip the pane edge would cut is dropped', () => {
  const placed = placeLabels(
    [
      { item: 'cut', x: 5, y: 50, text: 'at the edge' },
      { item: 'whole', x: 200, y: 50, text: 'inside' },
    ],
    frame,
    occupancy(frame),
  )
  expect(placed.map(p => p.item)).toEqual(['whole'])
})

test('a label kept from being dropped stands past a reserved column, nearest its point, and only for a point on the pane', () => {
  const column = { x0: 300, x1: 400, y0: 0, y1: 300 }
  const placed = placeLabels(
    [
      { item: 'a', x: 350, y: 150, text: 'gene', nearest: { x: 350, y: 150 } },
      { item: 'b', x: 900, y: 150, text: 'gene', nearest: { x: 900, y: 150 } },
    ],
    frame,
    occupancy(frame, [column]),
    [column],
  )
  expect(placed.map(p => [p.item, p.y])).toEqual([['a', 150]])
  expect(placed[0]!.x + placed[0]!.w / 2).toBeLessThanOrEqual(300)
  expect(placed[0]!.x + placed[0]!.w / 2).toBeGreaterThan(300 - 8)
})

test('labels other labels crowded out stand at the nearest free spot only while the ration of labels standing apart lasts', () => {
  const at = { x: 200, y: 100 }
  const placed = placeLabels(
    ['a', 'b', 'c', 'd'].map(item => ({
      item,
      ...at,
      text: 'gene',
      nearest: at,
    })),
    frame,
    occupancy(frame),
    [],
    2,
  )
  expect(placed.map(p => p.item)).toEqual(['a', 'b', 'c'])
  expect(placed.slice(1).every(p => p.y !== at.y)).toBe(true)
})

// the placements a build and sort of every spot per label gave
test('labels a band of nodes refuses stand at the same nearest free spots in a crowd', () => {
  const reserved: Box[] = [{ x0: 300, x1: 400, y0: 0, y1: 300 }]
  const candidates = Array.from({ length: 24 }, (_, i) => {
    const x = 20 + ((i * 53) % 270)
    const y = 130 + ((i * 17) % 40)
    return {
      item: i,
      x,
      y: y + 20,
      flipY: y - 20,
      text: `gene${i}`,
      stack: 2,
      slide: 24,
      nearest: i % 7 === 6 ? { x: x + 400, y } : { x, y },
      fits: (box: Box) => box.y1 < 100 || box.y0 > 200,
    }
  })
  const placed = placeLabels(
    candidates,
    frame,
    occupancy(frame, reserved),
    reserved,
    6,
  )
  expect(placed.map(p => [p.item, p.x, p.y])).toEqual([
    [0, 20, 91],
    [1, 73, 89],
    [2, 126, 221],
    [3, 179, 83],
    [4, 232, 82],
    [5, 277, 77],
    [7, 81, 226],
    [8, 134, 89],
    [9, 227, 220],
    [10, 272, 216],
    [11, 31, 233],
    [14, 182, 225],
    [16, 58, 67],
    [18, 164, 61],
    [21, 53, 262],
    [23, 159, 256],
  ])
})
