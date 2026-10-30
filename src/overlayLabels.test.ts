import { occupancy, placeLabels } from './overlayLabels'

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
