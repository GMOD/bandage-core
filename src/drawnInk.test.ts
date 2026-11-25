import { inkUnderBox, sameInkOnPane, skipMidpoints } from './drawnInk'

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

const moved = (dx: number, edge = 7): InkBatch => ({
  ...batch,
  nodeStrokes: batch.nodeStrokes.map(stroke => ({
    ...stroke,
    points: stroke.points.map(({ x, y }) => ({ x: x + dx, y })),
  })),
  edgeCurveRuns: new Map([[edge, { start: 0, count: 1 }]]),
})

// a batch rebuilt for the same pane, as after a pan or a settled fit, paints
// what the last one did there
test('two batches paint the same ink on a pane where each stroke lies where the other draws it, as wide, for the same node or link', () => {
  expect(sameInkOnPane(batch, moved(0), frame)).toBe(true)
  expect(sameInkOnPane(batch, moved(1), frame)).toBe(false)
  expect(sameInkOnPane(batch, moved(0, 8), frame)).toBe(false)
  expect(
    sameInkOnPane(
      batch,
      {
        ...moved(0),
        nodeStrokes: [{ ...batch.nodeStrokes[0]!, thickness: 5 }],
      },
      frame,
    ),
  ).toBe(false)
})

test('ink off the pane does not make two batches paint differently on it', () => {
  const far = {
    ...moved(0),
    nodeStrokes: [
      ...batch.nodeStrokes,
      { points: [{ x: 1000, y: 1000 }], thickness: 4, color: 0 },
    ],
  }
  expect(sameInkOnPane(batch, far, frame)).toBe(true)
  expect(
    sameInkOnPane(batch, far, {
      ...frame,
      translateX: -1990,
      translateY: -1990,
    }),
  ).toBe(false)
})

const line = (x0: number, y0: number, x1: number, y1: number) => ({
  x0,
  y0,
  cx0: x0,
  cy0: y0,
  cx1: x1,
  cy1: y1,
  x1,
  y1,
})

const skipBatch = (edgeCurves: InkBatch['edgeCurves']): InkBatch => ({
  nodeStrokes: [],
  nodeStrokeRuns: new Map(),
  edgeCurves,
  edgeCurveRuns: new Map([[3, { start: 0, count: edgeCurves.length }]]),
})

const square = { scaleX: 1, scaleY: 1 }

const expectNear = (
  p: { x: number; y: number } | undefined,
  x: number,
  y: number,
  digits = 2,
) => {
  expect(p?.x).toBeCloseTo(x, digits)
  expect(p?.y).toBeCloseTo(y, digits)
}

test("a skip's middle is the top of its arch as drawn, to the half px the arch is flattened to", () => {
  const arch = skipBatch([{ ...batch.edgeCurves[0]!, skip: true, arch: true }])
  expectNear(skipMidpoints(arch, square).get(3), 50, 70, 0)
})

test("a skip's middle is halfway along on screen, not in layout units", () => {
  const bent = skipBatch([
    {
      curves: [line(0, 0, 10, 0), line(10, 0, 10, 10)],
      thickness: 1,
      color: 0,
      skip: true,
    },
  ])
  expectNear(skipMidpoints(bent, square).get(3), 10, 0)
  expectNear(skipMidpoints(bent, { scaleX: 1, scaleY: 3 }).get(3), 10, 10 / 3)
})

test("a dashed skip's middle counts the gaps between its dashes", () => {
  const dashed = skipBatch([
    {
      curves: [line(0, 0, 10, 0)],
      thickness: 1,
      color: 0,
      skip: true,
      dashed: true,
    },
    {
      curves: [line(20, 0, 30, 0)],
      thickness: 1,
      color: 0,
      skip: true,
      dashed: true,
    },
    {
      curves: [line(70, 0, 80, 0)],
      thickness: 1,
      color: 0,
      skip: true,
      dashed: true,
    },
  ])
  expectNear(skipMidpoints(dashed, square).get(3), 40, 0)
})

test('a skip drawn only by lanes has its middle in the middle of the band', () => {
  const lanes = skipBatch([
    {
      curves: [line(0, 0, 100, 0)],
      thickness: 1,
      color: 0,
      walk: 0,
      pass: 0,
      skip: true,
    },
    {
      curves: [line(0, 4, 100, 4)],
      thickness: 1,
      color: 0,
      walk: 1,
      pass: 0,
      skip: true,
    },
  ])
  expectNear(skipMidpoints(lanes, square).get(3), 50, 2)
})

test('a skip drawn plainly is placed on that stroke, not between it and a lane', () => {
  const both = skipBatch([
    { curves: [line(0, 0, 100, 0)], thickness: 1, color: 0, skip: true },
    {
      curves: [line(0, 8, 100, 8)],
      thickness: 1,
      color: 0,
      walk: 0,
      pass: 0,
      skip: true,
    },
  ])
  expectNear(skipMidpoints(both, square).get(3), 50, 0)
})

test('a link that skips nothing has no middle', () => {
  expect(skipMidpoints(batch, square).size).toBe(0)
})
