import { rulerMarks } from './axis'

import type { Box } from './axis'

const measure = (text: string) => text.length * 6
const identity = (tx: number) => tx

// Twenty 10 bp boxes 40 px wide, with a 1 kb box 84 px wide after the tenth
// and a 1 bp box drawn 0 px wide after the fifteenth, as the own axis's log
// widths draw them, 20 px apart
function logBoxes() {
  const boxes: Box[] = []
  let bp = 0
  let x = 0
  for (let i = 0; i < 22; i++) {
    const [len, w] = i === 10 ? [1000, 84] : i === 16 ? [1, 0] : [10, 40]
    boxes.push({ bp0: bp, bp1: bp + len, x0: x, x1: x + w })
    bp += len
    x += w + 20
  }
  return boxes
}

test('every box gets a bracket with a tick at each end, and a box too narrow for one gets a tick', () => {
  const boxes = logBoxes()
  const marks = rulerMarks(boxes, identity, 2000, measure)!
  expect(marks.spans).toEqual(boxes.map(b => ({ x0: b.x0, x1: b.x1 })))
  for (const box of boxes) {
    expect(marks.ticks).toContain(box.x0 + 0.5)
  }
  expect(marks.ticks).toHaveLength(boxes.length * 2 - 1)
})

test("a box's length sits under it only when it fits inside it", () => {
  const boxes = logBoxes()
  const marks = rulerMarks(boxes, identity, 2000, measure)!
  const long = boxes[10]!
  expect(marks.labels).toContainEqual({
    text: '1 kb',
    at: (long.x0 + long.x1) / 2,
  })
  expect(marks.labels.map(l => l.text)).not.toContain('1 bp')
})

test('the ends of what is on screen are labelled with their positions', () => {
  const boxes = logBoxes()
  const marks = rulerMarks(boxes, tx => tx - 300, 900, measure)!
  const shown = boxes.filter(b => b.x1 - 300 >= 0 && b.x0 - 300 <= 900)
  expect(marks.labels).toContainEqual({
    text: shown[0]!.bp0.toLocaleString('en-US'),
    at: shown[0]!.x0 - 300,
  })
  expect(marks.labels).toContainEqual({
    text: shown.at(-1)!.bp1.toLocaleString('en-US'),
    at: shown.at(-1)!.x1 - 300,
  })
})

test('placed labels keep clear of each other', () => {
  const marks = rulerMarks(logBoxes(), identity, 2000, measure)!
  const spans = marks.labels
    .map(({ text, at }) => [at - measure(text) / 2, at + measure(text) / 2])
    .sort((a, b) => a[0]! - b[0]!)
  for (let i = 1; i < spans.length; i++) {
    expect(spans[i]![0]!).toBeGreaterThan(spans[i - 1]![1]!)
  }
})
