import { rulerMarks } from './axis'

import type { Box } from './axis'

const measure = (text: string) => text.length * 6
const identity = (tx: number) => tx

// Boxes as wide as their bp, 20 px apart
function linear(count: number, bp: number) {
  return Array.from({ length: count }, (_, i) => ({
    bp0: i * bp,
    bp1: (i + 1) * bp,
    x0: i * (bp + 20),
    x1: i * (bp + 20) + bp,
  }))
}

// Twenty 10 bp boxes 40 px wide, with a 1 kb box 84 px wide after the tenth,
// as the own axis's log widths draw them
function withLongBox() {
  const boxes: Box[] = []
  let bp = 0
  let x = 0
  for (let i = 0; i < 21; i++) {
    const len = i === 10 ? 1000 : 10
    const w = i === 10 ? 84 : 40
    boxes.push({ bp0: bp, bp1: bp + len, x0: x, x1: x + w })
    bp += len
    x += w + 20
  }
  return boxes
}

test('a ruler over boxes as wide as their bp squeezes none', () => {
  const marks = rulerMarks(linear(10, 100), identity, 2000, measure)!
  expect(marks.squeezed).toEqual([])
  expect(marks.ticks.length).toBeGreaterThan(3)
})

test('a long box drawn narrow gets a squeezed span and its length, no ticks', () => {
  const boxes = withLongBox()
  const long = boxes[10]!
  const marks = rulerMarks(boxes, identity, 2000, measure)!

  expect(marks.squeezed).toEqual([{ x0: long.x0, x1: long.x1 }])
  expect(marks.ticks.every(sx => sx <= long.x0 || sx >= long.x1)).toBe(true)
  expect(marks.labels).toContainEqual({
    text: '1 kb',
    at: (long.x0 + long.x1) / 2,
  })
})

test('placed labels keep clear of each other', () => {
  const marks = rulerMarks(withLongBox(), identity, 2000, measure)!
  const spans = marks.labels
    .map(({ text, at }) => [at - measure(text) / 2, at + measure(text) / 2])
    .sort((a, b) => a[0]! - b[0]!)
  for (let i = 1; i < spans.length; i++) {
    expect(spans[i]![0]!).toBeGreaterThan(spans[i - 1]![1]!)
  }
})
