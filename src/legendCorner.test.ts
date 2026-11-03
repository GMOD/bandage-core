import { inkUnder, legendBox, legendCorner } from './legendCorner'

import type { LegendCornerSource } from './legendCorner'
import type { NodeSegment } from './types'

const pane = {
  paneWidth: 1000,
  canvasHeight: 400,
  legendSize: { width: 200, height: 150 },
  axisScale: { scaleX: 1, scaleY: 1 },
  translateX: 0,
  translateY: 0,
  drawnRowLabels: [],
  labelsNodeSizes: true,
  contigThickness: 0,
}

function drawing(nodes: Record<string, NodeSegment[]>): LegendCornerSource {
  return { ...pane, nodePositions: nodes }
}

// a backbone across the middle, and loops hanging off its right end
const kiv2Like = drawing({
  backbone: [
    { x: 10, y: 100 },
    { x: 990, y: 100 },
  ],
  loop: [
    { x: 800, y: 100 },
    { x: 850, y: 390 },
    { x: 950, y: 100 },
  ],
})

test('the top right box reaches the pane edges past the strip', () => {
  expect(legendBox('top-right', { ...pane, referenceStripZonePx: 20 })).toEqual(
    { x0: 794, x1: 1000, y0: 0, y1: 176 },
  )
})

test('the bottom left box sits on the pane floor', () => {
  expect(legendBox('bottom-left', pane)).toEqual({
    x0: 0,
    x1: 206,
    y0: 244,
    y1: 400,
  })
})

test('ink is the node line clipped to the box, in screen px', () => {
  const box = { x0: 100, x1: 200, y0: 0, y1: 200 }
  expect(
    inkUnder(
      box,
      drawing({
        a: [
          { x: 0, y: 50 },
          { x: 1000, y: 50 },
        ],
      }),
    ),
  ).toBeCloseTo(100)
  expect(
    inkUnder(box, {
      ...drawing({
        a: [
          { x: 0, y: 50 },
          { x: 500, y: 50 },
        ],
      }),
      axisScale: { scaleX: 2, scaleY: 1 },
      translateX: 50,
    }),
  ).toBeCloseTo(100)
  expect(
    inkUnder(
      box,
      drawing({
        a: [
          { x: 0, y: 300 },
          { x: 1000, y: 300 },
        ],
      }),
    ),
  ).toBe(0)
})

test('a drawing clear of the top right leaves the key there', () => {
  expect(
    legendCorner(
      drawing({
        a: [
          { x: 10, y: 300 },
          { x: 990, y: 300 },
        ],
      }),
    ),
  ).toBe('top-right')
})

test('a drawing under the top right and clear of the bottom left moves it', () => {
  expect(legendCorner(kiv2Like)).toBe('bottom-left')
})

test('the key stays top right where the bottom left holds any ink', () => {
  expect(
    legendCorner(
      drawing({
        diagonal: [
          { x: 0, y: 400 },
          { x: 1000, y: 0 },
        ],
      }),
    ),
  ).toBe('top-right')
})

test('row labels keep the key off the left edge', () => {
  expect(
    legendCorner({ ...kiv2Like, drawnRowLabels: [{ label: 'GRCh38', y: 0 }] }),
  ).toBe('top-right')
})

test('a key not yet measured stays top right', () => {
  expect(
    legendCorner({ ...kiv2Like, legendSize: { width: 0, height: 0 } }),
  ).toBe('top-right')
})

test('a bottom left with less ink than the top right still keeps the key', () => {
  expect(
    legendCorner(
      drawing({
        ...kiv2Like.nodePositions,
        corner: [
          { x: 10, y: 390 },
          { x: 20, y: 390 },
        ],
      }),
    ),
  ).toBe('top-right')
})

test('a tube map, whose ink is not its node lines, keeps the key top right', () => {
  expect(legendCorner({ ...kiv2Like, labelsNodeSizes: false })).toBe(
    'top-right',
  )
})

// LPA at 1000 px: the backbone's centre ran 4 px under the key's box while its
// stroke and halo ran under the key's last rows
test('a line whose halo reaches the box counts as under it', () => {
  const box = { x0: 100, x1: 200, y0: 0, y1: 200 }
  const justBelow = drawing({
    a: [
      { x: 0, y: 204 },
      { x: 1000, y: 204 },
    ],
  })
  expect(inkUnder(box, justBelow)).toBe(0)
  expect(inkUnder(box, { ...justBelow, contigThickness: 5 })).toBeGreaterThan(
    100,
  )
})
