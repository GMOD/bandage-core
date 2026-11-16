import { baseEdgeCurves } from './edgeCurves'
import {
  distanceToCubicBezier,
  distanceToSegment,
  findHoveredEdge,
  findHoveredNode,
  otherNodeUnderBox,
} from './hitDetection'

import type { Graph } from '../types'

// isotropic: one scale for both axes, which is every layout but the row ones
const iso = (scale = 1) => ({ scaleX: scale, scaleY: scale })

describe('distanceToSegment', () => {
  test('point on the segment', () => {
    expect(distanceToSegment(5, 0, 0, 0, 10, 0)).toBeCloseTo(0)
  })

  test('point perpendicular to segment midpoint', () => {
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3)
  })

  test('point closest to segment start', () => {
    expect(distanceToSegment(-1, 0, 0, 0, 10, 0)).toBeCloseTo(1)
  })

  test('point closest to segment end', () => {
    expect(distanceToSegment(11, 0, 0, 0, 10, 0)).toBeCloseTo(1)
  })

  test('zero-length segment (point)', () => {
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5)
  })
})

describe('distanceToCubicBezier', () => {
  // a curve along y = 0 from x 0, through two control points, to `x1`
  const flat = (cx0: number, cx1: number, x1: number) => ({
    x0: 0,
    y0: 0,
    cx0,
    cy0: 0,
    cx1,
    cy1: 0,
    x1,
    y1: 0,
  })

  test('straight-line bezier at midpoint', () => {
    // control points on the line = straight bezier
    const dist = distanceToCubicBezier(5, 1, flat(3.3, 6.6, 10))
    expect(dist).toBeLessThan(1.5)
  })

  test('point far from bezier', () => {
    const dist = distanceToCubicBezier(100, 100, flat(3, 7, 10))
    expect(dist).toBeGreaterThan(100)
  })

  // A deletion arc is routinely this long on screen. Measured to the sampled
  // points alone, a cursor on the curve between two of them read as up to 25
  // away, past the hover tolerance, at most positions along it.
  test('a point on a long curve is on it wherever along it the point lies', () => {
    for (let x = 0; x <= 1000; x += 7) {
      const dist = distanceToCubicBezier(x, 0, flat(333, 667, 1000))
      expect(dist).toBeLessThan(0.001)
    }
  })

  test('distance off a long curve is the distance to the curve', () => {
    const dist = distanceToCubicBezier(525, 4, flat(333, 667, 1000))
    expect(dist).toBeCloseTo(4)
  })
})

describe('findHoveredNode', () => {
  const nodePositions = {
    'A+': [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    'B+': [
      { x: 20, y: 20 },
      { x: 30, y: 20 },
    ],
  }

  test('finds node when cursor is on segment', () => {
    expect(findHoveredNode(nodePositions, 5, 0, iso())).toBe('A+')
  })

  test('finds node when cursor is near segment', () => {
    expect(findHoveredNode(nodePositions, 5, 3, iso())).toBe('A+')
  })

  test('returns null when cursor is far from nodes', () => {
    expect(findHoveredNode(nodePositions, 50, 50, iso())).toBeNull()
  })

  test('respects scale for threshold', () => {
    // At scale 10, threshold is 5/10 = 0.5, so a point 3 units away should miss
    expect(findHoveredNode(nodePositions, 5, 3, iso(10))).toBeNull()
  })

  // A node drawn thick by its depth is 18 px across at the defaults, so the
  // pointer can be on its ink 8 px from its centreline. A fixed 5 px missed
  // it there, and the link beside it took the hover instead.
  test('a node answers anywhere on the ink it is drawn with', () => {
    const drawn = {
      halfWidthPx: (id: string) => (id === 'A+' ? 9 : 3),
      maxHalfWidthPx: 9,
    }
    expect(findHoveredNode(nodePositions, 5, 8, iso())).toBeNull()
    expect(findHoveredNode(nodePositions, 5, 8, iso(), 0, drawn)).toBe('A+')
    expect(findHoveredNode(nodePositions, 25, 28, iso(), 0, drawn)).toBeNull()
  })

  test('a thin node keeps the tolerance that makes it catchable', () => {
    const drawn = { halfWidthPx: () => 1, maxHalfWidthPx: 1 }
    expect(findHoveredNode(nodePositions, 5, 4, iso(), 0, drawn)).toBe('A+')
  })

  test('of two thick nodes under the pointer, the nearer centreline wins', () => {
    const stacked = {
      'A+': [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      'B+': [
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ],
    }
    const thick = { halfWidthPx: () => 9, maxHalfWidthPx: 9 }
    expect(findHoveredNode(stacked, 5, 6, iso(), 0, thick)).toBe('B+')
    expect(findHoveredNode(stacked, 5, 4, iso(), 0, thick)).toBe('A+')
  })
})

describe('findHoveredEdge', () => {
  // Horizontal A→B edge so the path-offset perpendicular is purely vertical;
  // each of 3 paths occupies a lane at y ≈ -3, 0, +3 (offsetDist = 3).
  const nodePositions = {
    'A+': [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ],
    'B+': [
      { x: 150, y: 0 },
      { x: 200, y: 0 },
    ],
  }
  const graph: Graph = {
    name: 't',
    nodes: [
      { id: 'A+', name: 'A', length: 50, depth: 1 },
      { id: 'B+', name: 'B', length: 50, depth: 1 },
    ],
    edges: [{ from: 'A+', to: 'B+', pathIds: ['p1', 'p2', 'p3'] }],
  }
  const hit = (x: number, y: number, drawPaths: boolean) =>
    findHoveredEdge(
      nodePositions,
      graph,
      x,
      y,
      iso(),
      drawPaths,
      0,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
    )

  test('hits edge on center lane', () => {
    expect(hit(100, 0, true)).toBe(0)
  })

  test('hits edge on offset path lane', () => {
    // Outer lane sits ~3 units off center; 10/scale threshold easily covers it.
    expect(hit(100, 3, true)).toBe(0)
  })

  test('misses when far from all lanes', () => {
    expect(hit(100, 200, true)).toBeNull()
  })

  test('drawPaths=false still hits on centerline', () => {
    expect(hit(100, 0, false)).toBe(0)
  })

  // A deletion is drawn bowed off its chord, and the tutorial tells the reader to
  // hover it for the interval and the bp it removes. Hit detection built its
  // curves without the bow, so the shape on screen was not hoverable and the
  // empty space along the chord was.
  describe('a bowed deletion arc', () => {
    // bulge = DELETION_BULGE_FRACTION * the bypassed node's drawn length
    const bypassing = new Map([[0, ['mid']]])
    const withBypassed = {
      ...nodePositions,
      mid: [
        { x: 50, y: 0 },
        { x: 150, y: 0 },
      ],
    }
    const at = (x: number, y: number, deletions?: Map<number, string[]>) =>
      findHoveredEdge(
        withBypassed,
        graph,
        x,
        y,
        iso(),
        false,
        0,
        deletions,
        undefined,
        undefined,
        false,
        undefined,
      )

    test('is hoverable where it is drawn', () => {
      // 0.35 * 100 = 35 of bulge, so the curve's own midpoint is near y = 26
      expect(at(100, 26, bypassing)).toBe(0)
    })

    test('and the chord it is not drawn on is not', () => {
      expect(at(100, 26)).toBeNull()
    })

    test('and a hidden one is not hoverable at all', () => {
      expect(
        findHoveredEdge(
          withBypassed,
          graph,
          100,
          26,
          iso(),
          false,
          0,
          bypassing,
          new Set([0]),
          undefined,
          false,
          undefined,
        ),
      ).toBeNull()
    })
  })
})

// A+ to B- leaves A's end and enters B's end, B's far side from A, where a
// force layout draws it; joined at the nearer ends it would stop at B's start
describe('a hit test on a stranded drawing', () => {
  const positions = {
    'A+': [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ],
    'B+': [
      { x: 100, y: 0 },
      { x: 150, y: 0 },
    ],
  }
  const stranded: Graph = {
    name: 't',
    nodes: [
      { id: 'A+', name: 'A', length: 50, depth: 1 },
      { id: 'B+', name: 'B', length: 50, depth: 1 },
    ],
    edges: [{ from: 'A+', to: 'B+', fromStrand: '+', toStrand: '-' }],
  }
  const hit = (x: number, onEnds: boolean) =>
    findHoveredEdge(
      positions,
      stranded,
      x,
      0,
      iso(),
      false,
      0,
      undefined,
      undefined,
      undefined,
      onEnds,
      undefined,
    )

  test('targets the link where it is drawn, into the end its strand names', () => {
    const drawn = baseEdgeCurves(
      positions,
      stranded,
      iso(),
      undefined,
      0,
      undefined,
      true,
    ).get(0)!
    expect(drawn.at(-1)!.x1).toBeCloseTo(150)
    expect(hit(125, true)).toBe(0)
    expect(hit(125, false)).toBeNull()
  })
})

// The hover threshold is 5 screen px converted to world units, so zoomed out it
// spans several nodes at once. Returning the first candidate inside it meant the
// grid's visit order decided the answer: the cursor sat on one node and a
// neighbour lit up.
test('picks the nearest node when several are inside the threshold', () => {
  const positions = {
    'near+': [
      { x: 1000, y: 0 },
      { x: 1100, y: 0 },
    ],
    'far+': [
      { x: 500, y: 0 },
      { x: 600, y: 0 },
    ],
  }
  // scale 0.008 -> a 625 unit threshold, wide enough to reach both
  expect(findHoveredNode(positions, 1050, 0, iso(0.008))).toBe('near+')
  expect(findHoveredNode(positions, 550, 0, iso(0.008))).toBe('far+')
})

// On a row layout x is reference bp and y is screen px, and the hover slack is
// screen px over the x scale — 500 bp at a 100 kb window. Fed straight into a
// hypot over both axes that slack is also 500 ROWS, so every row within the
// cursor's x band answered the hover and the nearest of them won: the cursor sat
// on one haplotype and the drawing lit up another. `yToX` is what makes the two
// comparable, and 5 px is 5 px on either axis once it is applied.
describe('hover on a row layout', () => {
  const ROWS = {
    top: [
      { x: 0, y: 0 },
      { x: 100_000, y: 0 },
    ],
    next: [
      { x: 0, y: 20 },
      { x: 100_000, y: 20 },
    ],
  }
  // 100 kb over ~1000 px, and rows already in px
  const scaleX = 0.01
  const yToX = 1 / scaleX

  test('a cursor on a row hits that row', () => {
    expect(
      findHoveredNode(
        ROWS,
        50_000,
        2,
        { scaleX: scaleX, scaleY: scaleX * yToX },
        0,
      ),
    ).toBe('top')
    expect(
      findHoveredNode(
        ROWS,
        50_000,
        18,
        { scaleX: scaleX, scaleY: scaleX * yToX },
        0,
      ),
    ).toBe('next')
  })

  test('a cursor between the rows hits neither', () => {
    expect(
      findHoveredNode(
        ROWS,
        50_000,
        10,
        { scaleX: scaleX, scaleY: scaleX * yToX },
        0,
      ),
    ).toBeNull()
  })

  test('the slack is still screen px along x', () => {
    // 300 bp past the end is 3 px at this scale, and inside the 5 px slack
    expect(
      findHoveredNode(
        ROWS,
        100_300,
        0,
        { scaleX: scaleX, scaleY: scaleX * yToX },
        0,
      ),
    ).toBe('top')
    expect(
      findHoveredNode(
        ROWS,
        101_000,
        0,
        { scaleX: scaleX, scaleY: scaleX * yToX },
        0,
      ),
    ).toBeNull()
  })
})

describe('otherNodeUnderBox', () => {
  const nodePositions = {
    line: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    crossing: [
      { x: 50, y: -20 },
      { x: 50, y: 20 },
    ],
  }
  const under = otherNodeUnderBox(nodePositions, {
    scaleX: 2,
    scaleY: 2,
    translateX: 10,
    translateY: 10,
  })
  const overBoth = { x0: 100, x1: 120, y0: 5, y1: 15 }
  const overLine = { x0: 20, x1: 60, y0: 5, y1: 15 }
  const overNeither = { x0: 20, x1: 60, y0: 100, y1: 120 }

  test('a box over two nodes covers another node unless both are its own', () => {
    expect(under(overBoth, id => id === 'line')).toBe(true)
    expect(under(overBoth, () => true)).toBe(false)
  })

  test('a box over its own node alone, or over none, covers no other', () => {
    expect(under(overLine, id => id === 'line')).toBe(false)
    expect(under(overLine, id => id === 'crossing')).toBe(true)
    expect(under(overNeither, () => false)).toBe(false)
  })

  test('a label box over a drawing zoomed far out looks in the few cells it covers', () => {
    const chain = Object.fromEntries(
      Array.from({ length: 5000 }, (_, i) => [
        `n${i}`,
        [
          { x: i * 4, y: 0 },
          { x: i * 4 + 3, y: 0 },
        ],
      ]),
    )
    const covered = otherNodeUnderBox(chain, {
      scaleX: 0.02,
      scaleY: 0.02,
      translateX: 0,
      translateY: 0,
    })
    const box = { x0: 100, x1: 250, y0: -9, y1: 10 }
    expect(covered(box, id => id !== 'n2000')).toBe(true)
    const lookups = vi.spyOn(Map.prototype, 'get')
    const coveredOwn = covered(box, () => true)
    const looked = lookups.mock.calls.length
    lookups.mockRestore()
    expect(coveredOwn).toBe(false)
    expect(looked).toBeLessThan(50)
  })

  test('the first other node under the box settles it', () => {
    const fan = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [
        `n${i}`,
        [
          { x: i / 100, y: 0 },
          { x: i / 100, y: 10 },
        ],
      ]),
    )
    const own = vi.fn<(nodeId: string) => boolean>(() => false)
    const covered = otherNodeUnderBox(fan, {
      scaleX: 1,
      scaleY: 1,
      translateX: 0,
      translateY: 0,
    })({ x0: -1, x1: 11, y0: 4, y1: 6 }, own)
    expect(covered).toBe(true)
    expect(own).toHaveBeenCalledTimes(1)
  })

  test('a drawing zoomed out after it was labelled close in is asked of cells a label covers few of', () => {
    const chain = Object.fromEntries(
      Array.from({ length: 5000 }, (_, i) => [
        `n${i}`,
        [
          { x: i * 4, y: 0 },
          { x: i * 4 + 3, y: 0 },
        ],
      ]),
    )
    const at = (scale: number) => ({
      scaleX: scale,
      scaleY: scale,
      translateX: 0,
      translateY: 0,
    })
    otherNodeUnderBox(chain, at(5))(
      { x0: 0, x1: 40, y0: -9, y1: 10 },
      () => true,
    )
    const far = otherNodeUnderBox(chain, at(0.02))
    const lookups = vi.spyOn(Map.prototype, 'get')
    const covered = far({ x0: 100, x1: 250, y0: -9, y1: 10 }, () => true)
    const looked = lookups.mock.calls.length
    lookups.mockRestore()
    expect(covered).toBe(false)
    expect(looked).toBeLessThan(50)
  })

  test('after a drag moves a node in place, a label box is asked of where the node is now', () => {
    const drawn = {
      moved: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    }
    const identity = { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 }
    const where = { x0: 40, x1: 60, y0: -5, y1: 5 }
    const draggedTo = { x0: 40, x1: 60, y0: 495, y1: 505 }
    expect(otherNodeUnderBox(drawn, identity, 0)(where, () => false)).toBe(true)
    for (const point of drawn.moved) {
      point.y = 500
    }
    const dragged = otherNodeUnderBox(drawn, identity, 1)
    expect(dragged(where, () => false)).toBe(false)
    expect(dragged(draggedTo, () => false)).toBe(true)
  })
})
