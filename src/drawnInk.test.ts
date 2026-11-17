import { inkUnderBox } from './drawnInk'

import type { InkBatch } from './drawnInk'

const frame = {
  scaleX: 2,
  scaleY: 2,
  translateX: 10,
  translateY: 10,
  width: 400,
  height: 300,
}

const box = (x: number, y: number) => ({
  x0: x - 5,
  x1: x + 5,
  y0: y - 5,
  y1: y + 5,
})

const none = () => false

// a node along y = 50 from x = 0 to 100, drawn 8 px wide; an arch from
// (0, 100) to (100, 100) whose top reaches y = 70, drawn 2 px wide
const batch: InkBatch = {
  nodeStrokes: [
    {
      points: [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ],
      thickness: 4,
      color: 0,
    },
  ],
  nodeStrokeRuns: new Map([['n', { start: 0, count: 1 }]]),
  edgeCurves: [
    {
      curves: [
        {
          x0: 0,
          y0: 100,
          cx0: 0,
          cy0: 60,
          cx1: 100,
          cy1: 60,
          x1: 100,
          y1: 100,
        },
      ],
      thickness: 1,
      color: 0,
    },
  ],
  edgeCurveRuns: new Map([[7, { start: 0, count: 1 }]]),
}

test('a node is ink out to the half-width it is drawn at, on screen', () => {
  const under = inkUnderBox(batch, frame)
  expect(under(box(110, 110 - 8), none)).toBe(true)
  expect(under(box(110, 110 - 10), none)).toBe(false)
})

test("a link is ink along its curve as drawn, not along its ends' chord", () => {
  const under = inkUnderBox(batch, frame)
  expect(under(box(110, 10 + 2 * 70), none)).toBe(true)
  expect(under(box(110, 10 + 2 * 100), none)).toBe(false)
})

test('ink a box may cover is told by the node or link that paints it', () => {
  const under = inkUnderBox(batch, frame)
  expect(under(box(110, 110), ({ node }) => node === 'n')).toBe(false)
  expect(under(box(110, 150), ({ edge }) => edge === 7)).toBe(false)
  expect(under(box(110, 150), ({ node }) => node === 'n')).toBe(true)
})
