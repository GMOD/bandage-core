import { loadGraph } from '../pipeline'
import {
  REFERENCE_RAMP_MAX_HUE,
  buildGeometry,
  computeReferenceRamp,
  endTangent,
  hslToRgb,
} from './GeometryBuilder'
import { packAbgr } from './colorBits'

import type { Graph } from '../types'
import type { RenderBatch } from './types'

// the colour a node is drawn in, off its first stroke
function nodeColor(batch: RenderBatch, id: string) {
  return batch.nodeStrokes[batch.nodeStrokeRuns.get(id)!.start]!.color
}

// isotropic: one scale for both axes, which is every layout but the row ones
const iso = (scale = 1) => ({ scaleX: scale, scaleY: scale })

const simpleGraph = {
  name: 'test',
  nodes: [
    { id: 'A+', name: 'A', length: 100, depth: 1 },
    { id: 'B+', name: 'B', length: 200, depth: 2 },
  ],
  edges: [{ from: 'A+', to: 'B+' }],
}

const simpleNodeById = new Map(simpleGraph.nodes.map(n => [n.id, n]))

const simplePositions = {
  'A+': [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
  'B+': [
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ],
}

test('produces non-empty geometry for simple graph', () => {
  const batch = buildGeometry({
    axis: iso(),
    nodePositions: simplePositions,
    graph: simpleGraph,
    nodeById: simpleNodeById,
    colorScheme: 'uniform',
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: false,
  })

  // one stroke per node, along the node's own polyline, at half its width
  expect(batch.nodeStrokes).toHaveLength(2)
  expect(batch.nodeStrokes[0]!.points).toBe(simplePositions['A+'])
  expect(batch.nodeStrokes[0]!.thickness).toBe(2.5)
  expect(batch.edgeCurves.length).toBeGreaterThan(0)
})

test('produces different geometry for different color schemes', () => {
  const opts = {
    nodePositions: simplePositions,
    graph: simpleGraph,
    nodeById: simpleNodeById,
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: false,
    axis: iso(),
  }

  const uniformBatch = buildGeometry({
    ...opts,
    colorScheme: 'uniform' as const,
  })
  const depthBatch = buildGeometry({ ...opts, colorScheme: 'depth' as const })

  expect(uniformBatch.nodeStrokes).toHaveLength(depthBatch.nodeStrokes.length)
  expect(nodeColor(uniformBatch, 'B+')).not.toBe(nodeColor(depthBatch, 'B+'))
})

test('keys the strokes by node and by edge', () => {
  const batch = buildGeometry({
    nodePositions: simplePositions,
    graph: simpleGraph,
    nodeById: simpleNodeById,
    colorScheme: 'uniform',
    axis: iso(),
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: false,
  })

  expect(batch.nodeStrokeRuns.get('A+')).toEqual({ start: 0, count: 1 })
  expect(batch.nodeStrokeRuns.get('B+')).toEqual({ start: 1, count: 1 })
  expect(batch.edgeCurveRuns.get(0)).toEqual({ start: 0, count: 1 })
})

// Nine walks leave A: eight through B and one skipping B to C, the skip a
// dashed link. A link by walks is as thick as its walks on the scale nodes
// by walks are drawn on, so A's two links add up to A, and the skip one walk
// takes draws at one walk's width, where it drew 4.4 px under the nodes'
// 6 px whatever its walks
const FORK_WALKS = Array.from({ length: 9 }, (_, i) => `w${i}`)
const fork = {
  name: 'fork',
  nodes: [
    { id: 'A+', name: 'A', length: 100, depth: 9 },
    { id: 'B+', name: 'B', length: 200, depth: 8 },
    { id: 'C+', name: 'C', length: 100, depth: 9 },
  ],
  edges: [
    { from: 'A+', to: 'B+', pathIds: FORK_WALKS.slice(0, 8) },
    { from: 'B+', to: 'C+', pathIds: FORK_WALKS.slice(0, 8) },
    { from: 'A+', to: 'C+', pathIds: FORK_WALKS.slice(8) },
  ],
  paths: FORK_WALKS.map((name, i) => ({
    name: `${name}#1#chr1`,
    nodeIds: i < 8 ? ['A+', 'B+', 'C+'] : ['A+', 'C+'],
  })),
}

function forkDrawing(
  nodeWidth: 'walks' | 'depth',
  edgeWidth: 'uniform' | 'walks',
  graph: Graph = fork,
) {
  return buildGeometry({
    nodePositions: {
      ...simplePositions,
      'C+': [
        { x: 40, y: 0 },
        { x: 50, y: 0 },
      ],
    },
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    // A to C spans 40 px, long enough to dash
    axis: iso(4),
    contigThickness: 9,
    connectorThickness: 2,
    drawPaths: false,
    nodeWidth,
    edgeWidth,
    deletions: new Map([[2, ['B']]]),
  })
}

const linkWidth = (batch: RenderBatch, edge: number) =>
  2 * batch.edgeCurves[batch.edgeCurveRuns.get(edge)!.start]!.thickness
const nodeWidth = (batch: RenderBatch, id: string) =>
  2 * batch.nodeStrokes[batch.nodeStrokeRuns.get(id)!.start]!.thickness

test('nodes and links by walks share one linear scale, so the widths at a fork add up', () => {
  const batch = forkDrawing('walks', 'walks')
  expect(nodeWidth(batch, 'A+')).toBe(9)
  expect(nodeWidth(batch, 'B+')).toBe(8)
  expect(linkWidth(batch, 0)).toBe(8)
  expect(linkWidth(batch, 2)).toBe(1)
  expect(linkWidth(batch, 0) + linkWidth(batch, 2)).toBe(nodeWidth(batch, 'A+'))
  expect(batch.edgeCurves[batch.edgeCurveRuns.get(2)!.start]!.skip).toBe(true)
})

test('a skip one walk of nine takes draws at one walk, and uniform links draw a skip as thick as a link', () => {
  expect(linkWidth(forkDrawing('walks', 'walks'), 2)).toBe(1)
  const uniform = forkDrawing('depth', 'uniform')
  expect(linkWidth(uniform, 2)).toBe(2)
  expect(linkWidth(uniform, 2)).toBe(linkWidth(uniform, 0))
})

test('the most passes draw contigThickness, every pass on one linear scale, and no walked mark under 1 px', () => {
  const repeat = {
    ...fork,
    nodes: fork.nodes.map(n => (n.id === 'B+' ? { ...n, depth: 36 } : n)),
  }
  const batch = forkDrawing('walks', 'walks', repeat)
  expect(nodeWidth(batch, 'B+')).toBe(9)
  expect(nodeWidth(batch, 'A+')).toBe(2.25)
  expect(linkWidth(batch, 0)).toBe(2)
  expect(linkWidth(batch, 2)).toBe(1)
})

// AMY1: five of eight haplotypes walk about 1,800 nodes twice, which counted
// 14 passes on a node and 9 walks on the links between
test('a walk taking a link twice counts twice, so node and link widths add up at a fork on a repeat', () => {
  const g = loadGraph(
    [
      'S\ta\tAAAAAAAAAA',
      'S\tb\tCCCCCCCCCC',
      'S\tc\tGGGGGGGGGG',
      'L\ta\t+\tb\t+\t0M',
      'L\tb\t+\ta\t+\t0M',
      'L\tb\t+\tc\t+\t0M',
      'W\tGRCh38\t0\tchr1\t0\t30\t>a>b>c',
      'W\tcopy\t1\tc\t0\t50\t>a>b>a>b>c',
    ].join('\n'),
    'repeat',
  )
  const id = (name: string) => g.nodes.find(n => n.name === name)!.id
  const edge = (from: string, to: string) =>
    g.edges.findIndex(e => e.from === id(from) && e.to === id(to))
  const batch = buildGeometry({
    nodePositions: {
      [id('a')]: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [id('b')]: [
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ],
      [id('c')]: [
        { x: 40, y: 0 },
        { x: 50, y: 0 },
      ],
    },
    graph: g,
    nodeById: new Map(g.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    axis: iso(),
    contigThickness: 6,
    connectorThickness: 2,
    drawPaths: false,
    nodeWidth: 'walks',
    edgeWidth: 'walks',
  })
  expect(g.edges.map(e => e.passes)).toEqual([3, 1, 2])
  expect(nodeWidth(batch, id('b'))).toBe(6)
  expect(linkWidth(batch, edge('a', 'b'))).toBe(nodeWidth(batch, id('b')))
  expect(
    linkWidth(batch, edge('b', 'a')) + linkWidth(batch, edge('b', 'c')),
  ).toBe(nodeWidth(batch, id('b')))
})

// R100k-02: GRCh38's walk alone, at 1 px a pass, drew the reference a hairline
test('a graph of one walk draws it contigThickness thick', () => {
  const lone = {
    ...fork,
    nodes: fork.nodes.map(n => ({ ...n, depth: 1 })),
    edges: fork.edges.slice(0, 2).map(e => ({ ...e, pathIds: ['w0'] })),
    paths: fork.paths.slice(0, 1),
  }
  const batch = forkDrawing('walks', 'walks', lone)
  expect(nodeWidth(batch, 'A+')).toBe(9)
  expect(linkWidth(batch, 0)).toBe(9)
})

test('walks draw uniform while a walk holds nodes not loaded, and by depth in a graph without walks, whose skips draw as thick as they always have', () => {
  const held = {
    ...fork,
    nodes: [
      ...fork.nodes,
      { id: 'P+', name: 'P', length: 50, depth: 1, placeholder: true as const },
    ],
  }
  const unloaded = forkDrawing('walks', 'walks', held)
  expect(nodeWidth(unloaded, 'A+')).toBe(9)
  expect(nodeWidth(unloaded, 'B+')).toBe(9)
  expect(nodeWidth(forkDrawing('depth', 'uniform', held), 'A+')).toBe(9)
  expect(linkWidth(unloaded, 2)).toBe(2)
  const { paths: _, ...walkless } = fork
  const depth = forkDrawing('walks', 'walks', walkless)
  expect(nodeWidth(depth, 'A+')).toBe(
    nodeWidth(forkDrawing('depth', 'uniform', walkless), 'A+'),
  )
  expect(linkWidth(depth, 2)).toBe(4.4)
})

test('handles empty node positions gracefully', () => {
  const batch = buildGeometry({
    nodePositions: {},
    axis: iso(),
    graph: simpleGraph,
    nodeById: simpleNodeById,
    colorScheme: 'uniform',
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: false,
  })

  expect(batch.nodeStrokes).toHaveLength(0)
  expect(batch.edgeCurves).toHaveLength(0)
})

test('handles graph with paths and drawPaths', () => {
  const graphWithPaths = {
    ...simpleGraph,
    edges: [{ from: 'A+', to: 'B+', pathIds: ['p1'] }],
    paths: [{ name: 'p1', nodeIds: ['A+', 'B+'] }],
  }

  const batch = buildGeometry({
    nodePositions: simplePositions,
    axis: iso(),
    graph: graphWithPaths,
    nodeById: simpleNodeById,
    colorScheme: 'uniform',
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: true,
  })

  expect(batch.nodeStrokes.length).toBeGreaterThan(0)
  // one stroke per path crossing the edge, not one for the edge
  expect(batch.edgeCurves).toHaveLength(1)
  expect(batch.edgeCurveRuns.get(0)).toEqual({ start: 0, count: 1 })
})

// A three-path graph where the middle node is the one B skips: A and C walk
// A+ -> B+ , B walks around it. That absence is what the stripes have to show.
const carriageGraph = {
  ...simpleGraph,
  edges: [{ from: 'A+', to: 'B+', pathIds: ['pA', 'pB', 'pC'] }],
  paths: [
    { name: 'pA', nodeIds: ['A+', 'B+'] },
    { name: 'pB', nodeIds: ['A+'] },
    { name: 'pC', nodeIds: ['A+', 'B+'] },
  ],
}

const carriageOpts = {
  nodePositions: simplePositions,
  axis: iso(),
  graph: carriageGraph,
  nodeById: simpleNodeById,
  colorScheme: 'uniform' as const,
  contigThickness: 12,
  connectorThickness: 1.5,
}

// distinct colors across a node's strokes
function nodeColors(batch: RenderBatch, nodeId: string) {
  const run = batch.nodeStrokeRuns.get(nodeId)!
  return new Set(
    batch.nodeStrokes
      .slice(run.start, run.start + run.count)
      .map(stroke => stroke.color),
  )
}

test('drawPaths stripes a node once per path that visits it', () => {
  const batch = buildGeometry({ ...carriageOpts, drawPaths: true })

  // A+ is on all three paths, B+ on two: the count of colors down the node is
  // its carriage, which is the whole point of striping the node rather than
  // only the edge
  expect(nodeColors(batch, 'A+').size).toBe(3)
  expect(nodeColors(batch, 'B+').size).toBe(2)
  // and B+'s two are the same two colors A+ has, not a re-numbered pair: the
  // slot is fixed by the path's position in the legend, so a gap lands in the
  // same place on every node
  expect(
    [...nodeColors(batch, 'B+')].every(c => nodeColors(batch, 'A+').has(c)),
  ).toBe(true)
})

test('stripes divide the node width rather than inflating it', () => {
  const striped = buildGeometry({ ...carriageOpts, drawPaths: true })
  const plain = buildGeometry({ ...carriageOpts, drawPaths: false })

  const halfWidth = (batch: RenderBatch) =>
    Math.max(...batch.nodeStrokes.map(stroke => stroke.thickness))
  // three stripes of a third the width each, laid across the same 12 units
  expect(halfWidth(striped)).toBe(halfWidth(plain) / 3)
})

test('a node keeps its scheme color when a stripe would be sub-pixel', () => {
  // contigThickness is screen px, so a thin node over three paths gives a
  // one-px stripe each: aliasing between neighbours rather than three colors
  const thin = buildGeometry({
    ...carriageOpts,
    contigThickness: 3,
    drawPaths: true,
  })
  expect(nodeColors(thin, 'A+').size).toBe(1)
})

test('the stripe offset is in world units, so zoom does not fan them apart', () => {
  const yAt = (batch: RenderBatch, nodeId: string) => {
    const run = batch.nodeStrokeRuns.get(nodeId)!
    const ys = batch.nodeStrokes
      .slice(run.start, run.start + run.count)
      .flatMap(stroke => stroke.points.map(p => p.y))
    return Math.max(...ys) - Math.min(...ys)
  }
  // the stripes are laid across a width stated in screen px, so in world units
  // they must spread twice as far when the view is drawn at half the zoom
  const near = buildGeometry({ ...carriageOpts, drawPaths: true, axis: iso() })
  const far = buildGeometry({
    ...carriageOpts,
    drawPaths: true,
    axis: iso(0.5),
  })
  expect(yAt(far, 'A+')).toBeCloseTo(yAt(near, 'A+') * 2, 5)
})

test('a many-path graph is not striped at all', () => {
  const manyPaths = {
    ...simpleGraph,
    paths: Array.from({ length: 40 }, (_, i) => ({
      name: `p${i}`,
      nodeIds: ['A+', 'B+'],
    })),
  }
  const batch = buildGeometry({
    ...carriageOpts,
    graph: manyPaths,
    drawPaths: true,
  })
  // forty colors down one node is not a reading, so the node keeps its own
  expect(nodeColors(batch, 'A+').size).toBe(1)
})

test('viewport culling skips off-screen nodes', () => {
  const batch = buildGeometry({
    axis: iso(),
    nodePositions: simplePositions,
    graph: simpleGraph,
    nodeById: simpleNodeById,
    colorScheme: 'uniform',
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: false,
    viewportBounds: { minX: -5, minY: -5, maxX: 15, maxY: 5 },
  })

  expect(batch.nodeStrokeRuns.has('A+')).toBe(true)
  expect(batch.nodeStrokeRuns.has('B+')).toBe(false)
})

// The reference-anchored layouts put x in bp, so a backbone segment is routinely
// wider than the window with both of its endpoints outside it. Culling on
// endpoint containment dropped exactly the segment those layouts exist to show.
test('viewport culling keeps a node spanning the whole viewport', () => {
  const nodes = [
    { id: 'backbone+', name: 'backbone', length: 50_000, depth: 1 },
  ]
  const batch = buildGeometry({
    nodePositions: {
      'backbone+': [
        { x: 0, y: 0 },
        { x: 50_000, y: 0 },
      ],
    },
    graph: { name: 'test', nodes, edges: [] },
    nodeById: new Map(nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    axis: iso(),
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: false,
    viewportBounds: { minX: 20_000, minY: -100, maxX: 21_000, maxY: 100 },
  })

  expect(batch.nodeStrokeRuns.has('backbone+')).toBe(true)
})

test('node-length color scheme produces distinct colors for different lengths', () => {
  const nodes = [
    { id: 'short+', name: 'short', length: 10, depth: 1 },
    { id: 'long+', name: 'long', length: 10000, depth: 1 },
  ]
  const positions = {
    'short+': [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    'long+': [
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ],
  }
  const graph = { name: 'test', nodes, edges: [] }
  const nodeById = new Map(nodes.map(n => [n.id, n]))

  const batch = buildGeometry({
    nodePositions: positions,
    graph,
    nodeById,
    colorScheme: 'node-length',
    axis: iso(),
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: false,
  })

  expect(nodeColor(batch, 'short+')).not.toBe(nodeColor(batch, 'long+'))
})

test('rainbow color scheme produces distinct colors for nodes at different indices', () => {
  const nodes = [
    { id: 'A+', name: 'A', length: 100, depth: 1 },
    { id: 'B+', name: 'B', length: 100, depth: 1 },
    { id: 'C+', name: 'C', length: 100, depth: 1 },
  ]
  const positions = {
    'A+': [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    'B+': [
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ],
    'C+': [
      { x: 40, y: 0 },
      { x: 50, y: 0 },
    ],
  }
  const graph = { name: 'test', nodes, edges: [] }
  const nodeById = new Map(nodes.map(n => [n.id, n]))

  const batch = buildGeometry({
    nodePositions: positions,
    graph,
    nodeById,
    colorScheme: 'rainbow',
    axis: iso(),
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: false,
  })

  const colors = ['A+', 'B+', 'C+'].map(id => nodeColor(batch, id))
  expect(new Set(colors).size).toBe(3)
})

test('builds geometry for a self-loop edge', () => {
  const graph = {
    name: 'test',
    nodes: [{ id: 'A+', name: 'A', length: 100, depth: 1 }],
    edges: [{ from: 'A+', to: 'A+' }],
  }
  const batch = buildGeometry({
    nodePositions: {
      'A+': [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    },
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: false,
    axis: iso(),
  })
  expect(batch.nodeStrokes).toHaveLength(1)
  // a self loop is two curves, so it strokes as one two-segment path
  expect(batch.edgeCurves[0]!.curves).toHaveLength(2)
  expect(batch.edgeCurveRuns.has(0)).toBe(true)
})

test('skips edges that reference missing node positions', () => {
  const graph = {
    name: 'test',
    nodes: [{ id: 'A+', name: 'A', length: 100, depth: 1 }],
    edges: [{ from: 'A+', to: 'missing+' }],
  }
  const batch = buildGeometry({
    nodePositions: {
      'A+': [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    },
    graph,
    nodeById: new Map(graph.nodes.map(n => [n.id, n])),
    colorScheme: 'uniform',
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: false,
    axis: iso(),
  })
  // node still builds; the dangling edge is silently dropped
  expect(batch.nodeStrokes).toHaveLength(1)
  expect(batch.edgeCurves).toHaveLength(0)
  expect(batch.edgeCurveRuns.size).toBe(0)
})

// Arrowheads used to take their angle from the last two points of the
// tessellated edge mesh. The mesh is gone, so the angle comes from the curve's
// analytic end tangent instead — which has to agree with the direction the
// tessellation was reporting, or every arrowhead points somewhere else.
describe('endTangent', () => {
  // direction of a cubic just short of its endpoint, i.e. what walking the
  // tessellated points to the end and taking the last step measured
  function numericEndAngle(c: {
    x0: number
    y0: number
    cx0: number
    cy0: number
    cx1: number
    cy1: number
    x1: number
    y1: number
  }) {
    const at = (t: number) => {
      const u = 1 - t
      return {
        x:
          u ** 3 * c.x0 +
          3 * u * u * t * c.cx0 +
          3 * u * t * t * c.cx1 +
          t ** 3 * c.x1,
        y:
          u ** 3 * c.y0 +
          3 * u * u * t * c.cy0 +
          3 * u * t * t * c.cy1 +
          t ** 3 * c.y1,
      }
    }
    // a short secant, which is what the last tessellated step was; small enough
    // that its own error stays well under the tolerance below
    const a = at(1 - 1e-6)
    const b = at(1)
    return Math.atan2(b.y - a.y, b.x - a.x)
  }

  const curves = [
    { x0: 0, y0: 0, cx0: 30, cy0: 0, cx1: 70, cy1: 40, x1: 100, y1: 40 },
    { x0: 0, y0: 0, cx0: 0, cy0: 80, cx1: 100, cy1: 80, x1: 100, y1: 0 },
    { x0: 5, y0: 5, cx0: -20, cy0: 60, cx1: -60, cy1: -30, x1: -100, y1: 10 },
  ]

  test.each(curves)('matches the numeric tangent of %j', curve => {
    expect(endTangent(curve)).toBeCloseTo(numericEndAngle(curve), 4)
  })

  // Degenerate control point: the derivative at t=1 vanishes, so there is no
  // tangent to read and the chord is the only direction available.
  test('falls back to the chord when the control point is on the endpoint', () => {
    expect(
      endTangent({
        x0: 0,
        y0: 0,
        cx0: 0,
        cy0: 0,
        cx1: 10,
        cy1: 10,
        x1: 10,
        y1: 10,
      }),
    ).toBeCloseTo(Math.atan2(10, 10), 6)
  })
})

describe('the reference-position ramp', () => {
  // Two backbone segments at either end of a 1000 bp window and one allele
  // bridging them, which is the shape every graph-over-linear figure has.
  const nodes = [
    {
      id: 'left+',
      name: 'left',
      length: 100,
      depth: 2,
      stable: { refName: 'chr', start: 0, rank: 0 },
    },
    {
      id: 'right+',
      name: 'right',
      length: 100,
      depth: 2,
      stable: { refName: 'chr', start: 900, rank: 0 },
    },
    {
      id: 'alt+',
      name: 'alt',
      length: 5000,
      depth: 1,
      stable: { refName: 'other', start: 7, rank: 1 },
    },
    // a second allele, branching from the far end of the window rather than the
    // middle of it, so a position-dependent colouring would paint it differently
    {
      id: 'alt2+',
      name: 'alt2',
      length: 400,
      depth: 1,
      stable: { refName: 'other', start: 900, rank: 1 },
    },
    { id: 'loose+', name: 'loose', length: 10, depth: 1 },
  ]
  const graph = {
    name: 'test',
    nodes,
    edges: [
      { from: 'left+', to: 'alt+' },
      { from: 'alt+', to: 'right+' },
      { from: 'right+', to: 'alt2+' },
    ],
  }
  const positions = Object.fromEntries(
    nodes.map((n, i) => [
      n.id,
      [
        { x: i * 20, y: 0 },
        { x: i * 20 + 10, y: 0 },
      ],
    ]),
  )

  function colorsFor(colorDomain?: { start: number; end: number }) {
    const batch = buildGeometry({
      nodePositions: positions,
      graph,
      nodeById: new Map(nodes.map(n => [n.id, n])),
      colorScheme: 'reference-position',
      // what the model holds against the graph and hands over; see BuildOptions
      referenceRamp: computeReferenceRamp(graph, colorDomain),
      axis: iso(),
      contigThickness: 5,
      connectorThickness: 1.5,
      drawPaths: false,
    })
    return Object.fromEntries(nodes.map(n => [n.id, nodeColor(batch, n.id)]))
  }

  // The contract a linear track's `color` jexl reproduces. Written out as the
  // arithmetic rather than as a captured constant, so an edit to the ramp fails
  // here instead of silently desynchronising the two panels.
  function expectedColor(mid: number, start: number, span: number) {
    const frac = Math.max(0, Math.min(1, (mid - start) / span))
    const [r, g, b] = hslToRgb(frac * REFERENCE_RAMP_MAX_HUE, 0.7, 0.5)
    return packAbgr(
      Math.round(r * 255),
      Math.round(g * 255),
      Math.round(b * 255),
      255,
    )
  }

  test('paints a backbone segment the hue of its own midpoint', () => {
    const colors = colorsFor({ start: 0, end: 1000 })
    expect(colors['left+']).toBe(expectedColor(50, 0, 1000))
    expect(colors['right+']).toBe(expectedColor(950, 0, 1000))
  })

  // The ramp is the reference path's colouring, so an allele is taken off it
  // entirely: a hue here — even a pale one — says the allele IS the reference at
  // that position, which is the opposite of what it is.
  test('paints an allele off the ramp, in the flat alternative colour', () => {
    const colors = colorsFor({ start: 0, end: 1000 })
    expect(colors['alt+']).toBe(packAbgr(60, 65, 72, 255))
  })

  // Every allele the same colour, wherever it branches: the ramp is not what
  // distinguishes them, and a reader looking for one is reading position off a
  // node that has none.
  test('paints two alleles at different positions the same colour', () => {
    const colors = colorsFor({ start: 0, end: 1000 })
    expect(colors['alt+']).toBe(colors['alt2+'])
    expect(colors['alt+']).not.toBe(expectedColor(500, 0, 1000))
  })

  test('paints a node the reference never visits off the ramp', () => {
    expect(colorsFor({ start: 0, end: 1000 })['loose+']).toBe(
      packAbgr(60, 65, 72, 255),
    )
  })

  // the flanking walk gives up a few hops in, which must not change the colour
  test('paints an allele deep in a bubble like one beside the backbone', () => {
    const chain = Array.from({ length: 8 }, (_, i) => ({
      id: `deep${i}+`,
      name: `deep${i}`,
      length: 10,
      depth: 1,
      stable: { refName: 'other', start: i * 10, rank: 1 },
    }))
    const deepNodes = [...nodes.slice(0, 2), ...chain]
    const deepGraph = {
      name: 'deep',
      nodes: deepNodes,
      edges: [
        { from: 'left+', to: 'deep0+' },
        ...chain.slice(1).map((n, i) => ({ from: chain[i]!.id, to: n.id })),
      ],
    }
    const batch = buildGeometry({
      nodePositions: Object.fromEntries(
        deepNodes.map((n, i) => [
          n.id,
          [
            { x: i * 20, y: 0 },
            { x: i * 20 + 10, y: 0 },
          ],
        ]),
      ),
      graph: deepGraph,
      nodeById: new Map(deepNodes.map(n => [n.id, n])),
      colorScheme: 'reference-position',
      referenceRamp: computeReferenceRamp(deepGraph, { start: 0, end: 1000 }),
      axis: iso(),
      contigThickness: 5,
      connectorThickness: 1.5,
      drawPaths: false,
    })
    expect(nodeColor(batch, 'deep7+')).toBe(nodeColor(batch, 'deep0+'))
    expect(nodeColor(batch, 'deep7+')).toBe(packAbgr(60, 65, 72, 255))
  })

  // A whole-file import states no region, so the ramp spans what it drew. The
  // two backbone segments then take the ends of the ramp rather than sitting in
  // the middle of a window nothing declared.
  test('falls back to the drawn extent with no region', () => {
    const colors = colorsFor()
    expect(colors['left+']).toBe(expectedColor(50, 50, 900))
    expect(colors['right+']).toBe(expectedColor(950, 50, 900))
  })
})

// In both anchored layouts consecutive segments meet at exactly one point, so
// every backbone link has a zero-length chord. The ribbon fan used to be
// perpendicular to that chord and gave up when there was none, which dropped the
// edge outright: no curve, no arrowhead, nothing to hover, along the whole
// backbone, and the abutting nodes hid it. Only reachable with drawPaths on,
// which is why it survived — the plain path draws the edge either way.
describe('abutting nodes under drawPaths', () => {
  const abutting = {
    name: 'abutting',
    nodes: [
      { id: 'A+', name: 'A', length: 100, depth: 1 },
      { id: 'B+', name: 'B', length: 100, depth: 1 },
    ],
    edges: [{ from: 'A+', to: 'B+', pathIds: ['p1', 'p2'] }],
    paths: [
      { name: 'p1', nodeIds: ['A+', 'B+'] },
      { name: 'p2', nodeIds: ['A+', 'B+'] },
    ],
  }
  const nodeById = new Map(abutting.nodes.map(n => [n.id, n]))
  const positions = {
    'A+': [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    'B+': [
      { x: 100, y: 0 },
      { x: 200, y: 0 },
    ],
  }

  function build(drawPaths: boolean) {
    return buildGeometry({
      axis: iso(),
      nodePositions: positions,
      graph: abutting,
      nodeById,
      colorScheme: 'uniform',
      contigThickness: 10,
      connectorThickness: 4,
      drawPaths,
    })
  }

  test('draws one ribbon per path where a plain edge draws one curve', () => {
    expect(build(false).edgeCurves).toHaveLength(1)
    expect(build(true).edgeCurves).toHaveLength(2)
  })

  test('fans them across the row, since the nodes run along it', () => {
    const ys = build(true).edgeCurves.map(c => c.curves[0]!.y0)
    // the node's own direction stands in for the missing chord, so the two
    // ribbons straddle y = 0 rather than landing on top of each other
    expect(ys).toEqual([-1.5, 1.5])
  })

  test('keys the ribbons under the edge, so they stay hoverable', () => {
    expect(build(true).edgeCurveRuns.get(0)).toEqual({ start: 0, count: 2 })
  })
})

// An arrowhead states which way a link is read, which belongs to the edge and
// not to each path crossing it. One head per ribbon said it once per haplotype:
// five stacked heads in five colours at each joint, which is the confetti that
// made drawPaths unusable on a force layout and reached the anchored ones the
// moment their abutting edges started drawing again.
describe('one arrowhead per edge, whatever crosses it', () => {
  const graph = {
    name: 'ribbons',
    nodes: [
      { id: 'A+', name: 'A', length: 100, depth: 1 },
      { id: 'B+', name: 'B', length: 100, depth: 1 },
    ],
    edges: [{ from: 'A+', to: 'B+', pathIds: ['p1', 'p2', 'p3'] }],
    paths: [
      { name: 'p1', nodeIds: ['A+', 'B+'] },
      { name: 'p2', nodeIds: ['A+', 'B+'] },
      { name: 'p3', nodeIds: ['A+', 'B+'] },
    ],
  }
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))
  const positions = {
    'A+': [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    'B+': [
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ],
  }

  function build(drawPaths: boolean) {
    return buildGeometry({
      axis: iso(),
      nodePositions: positions,
      graph,
      nodeById,
      colorScheme: 'uniform',
      contigThickness: 10,
      connectorThickness: 4,
      drawPaths,
    })
  }

  const heads = (b: ReturnType<typeof build>) => b.arrows.length

  test('three ribbons still leave one head', () => {
    expect(heads(build(false))).toBe(1)
    expect(build(true).edgeCurves).toHaveLength(3)
    expect(heads(build(true))).toBe(1)
  })

  test('and it is the edge colour, not a haplotype it would have to pick', () => {
    const plain = build(false)
    const ribboned = build(true)
    const colorOf = (b: ReturnType<typeof build>) => b.arrows[0]!.color
    expect(colorOf(ribboned)).toBe(colorOf(plain))
  })
})

describe('arrowhead placement', () => {
  function headOf(
    positions: Record<string, { x: number; y: number }[]>,
    scale: number,
    connectorThickness = 2,
    deletions?: Map<number, string[]>,
  ) {
    return buildGeometry({
      nodePositions: positions,
      graph: simpleGraph,
      nodeById: simpleNodeById,
      colorScheme: 'uniform',
      contigThickness: 6,
      connectorThickness,
      drawPaths: false,
      axis: iso(scale),
      deletions,
    }).arrows[0]
  }

  // B's round cap reaches 3 px, which is 0.75 units at scale 4
  test('the tip stops on the outline of the node it enters', () => {
    const head = headOf(simplePositions, 4)!
    expect(head.x).toBeCloseTo(19.25, 3)
    expect(head.y).toBeCloseTo(0, 6)
    expect(head.angle).toBeCloseTo(0, 6)
  })

  // the end tangent runs along B, straight down; the stroke arrives across
  test('the head lies along the curve rather than its end tangent', () => {
    const head = headOf(
      {
        'A+': [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        'B+': [
          { x: 14, y: 4 },
          { x: 14, y: 14 },
        ],
      },
      8,
    )!
    const endTangentAngle = Math.PI / 2
    expect(Math.abs(head.angle - endTangentAngle)).toBeGreaterThan(0.2)
  })

  test('heavier links draw bigger heads', () => {
    const thin = headOf(simplePositions, 8, 2)!
    const heavy = headOf(simplePositions, 8, 6)!
    expect(heavy.length).toBeGreaterThan(thin.length)
    expect(heavy.halfWidth).toBeGreaterThan(thin.halfWidth)
  })

  // a deletion's heavier head hid the dashes of a short one
  test("a deletion's head is a plain link's", () => {
    const plain = headOf(simplePositions, 4)!
    const deletion = headOf(simplePositions, 4, 2, new Map([[0, []]]))!
    expect(deletion.length).toBe(plain.length)
    expect(deletion.halfWidth).toBe(plain.halfWidth)
  })

  // A skip at its true span: B starts 10 layout units past A's end, and a
  // bowed one rises over what it bypasses between them
  const walked: Graph = {
    ...simpleGraph,
    paths: [{ name: 'a#1#c', nodeIds: ['A+', 'B+'] }],
  }
  const skipAt = (scale: number, bypassed?: string[], graph = walked) => {
    const batch = buildGeometry({
      nodePositions: {
        ...simplePositions,
        'M+': [
          { x: 12, y: -8 },
          { x: 18, y: -8 },
        ],
      },
      graph,
      nodeById: simpleNodeById,
      colorScheme: 'uniform',
      contigThickness: 6,
      connectorThickness: 2,
      drawPaths: false,
      axis: iso(scale),
      deletions: bypassed && new Map([[0, bypassed]]),
    })
    const run = batch.edgeCurveRuns.get(0)
    return {
      strokes: run
        ? batch.edgeCurves.slice(run.start, run.start + run.count)
        : [],
      heads: batch.arrowRuns.get(0)?.count ?? 0,
    }
  }

  test('a skip three dashes long on screen is dashed, with a head', () => {
    const { strokes, heads } = skipAt(4, [])
    expect(strokes.length).toBeGreaterThanOrEqual(2)
    expect(strokes.every(s => s.skip)).toBe(true)
    expect(heads).toBe(1)
  })

  // HG02055's 50 bp skip at chr1:27,853,212, about 27 px there, drew as two
  // or three heavy dashes under a head: a black dart on the backbone
  // a skip too short to dash was one plain stroke, keyed "short skip" apart
  // from the dashed ones, which read as a link
  test('a skip shorter than three full dashes on screen is dashed shorter, with no head', () => {
    for (const scale of [0.6, 2.7, 3.2]) {
      const { strokes, heads } = skipAt(scale, [])
      expect(strokes.length).toBeGreaterThanOrEqual(2)
      for (const stroke of strokes) {
        expect(stroke.thickness).toBe(1)
        expect(stroke.skip).toBe(true)
      }
      expect(heads).toBe(0)
    }
  })

  test('in a graph without walks, as the rGFA track draws, a skip shorter than three dashes on screen is one plain stroke with no head, and a dashed one is thicker', () => {
    for (const scale of [0.6, 2.7, 3.2]) {
      const { strokes, heads } = skipAt(scale, [], simpleGraph)
      expect(strokes).toHaveLength(1)
      expect(strokes[0]!.thickness).toBe(1)
      expect(strokes[0]!.dashed).toBeUndefined()
      expect(heads).toBe(0)
    }
    const { strokes } = skipAt(4, [], simpleGraph)
    expect(strokes.length).toBeGreaterThanOrEqual(2)
    expect(strokes.every(s => s.thickness === 2.2 && s.dashed)).toBe(true)
  })

  // dashes on the legs a short skip rises and falls on are dots under a head
  test('a bowed skip takes its head by the span it jumps, not its length along the bow', () => {
    const bowed = skipAt(2.7, ['M+'])
    expect(bowed.strokes.length).toBeGreaterThanOrEqual(2)
    expect(bowed.heads).toBe(0)
    expect(skipAt(4, ['M+']).strokes.length).toBeGreaterThanOrEqual(2)
  })

  // the 1-5 bp skips at the amylase locus, at 240 kb across the pane, drew
  // as loops along the backbone; dropping them left pggb chrY's 88,829 bp
  // skip at 9.3 Mb, which seven haplotypes carry, drawn nowhere
  test("a skip under a pixel on screen is drawn as the plain link it is, over the nodes in a skip's ink", () => {
    const link = skipAt(0.05, undefined, simpleGraph)
    expect(link.strokes).toHaveLength(1)
    expect(link.strokes[0]!.skip).toBeUndefined()
    const overNodes = {
      ...link,
      strokes: [
        {
          ...link.strokes[0]!,
          color: skipAt(0.2, [], simpleGraph).strokes[0]!.color,
          skip: true,
          span: 0,
        },
      ],
    }
    expect(skipAt(0.05, [], simpleGraph)).toEqual(overNodes)
    expect(skipAt(0.05, ['M+'], simpleGraph)).toEqual(overNodes)
  })

  test('a skip a twentieth of a px across is stroked in the ink of one 2 px across', () => {
    const arc = skipAt(0.2, [], simpleGraph).strokes[0]!
    const fallback = skipAt(0.005, [], simpleGraph).strokes[0]!
    expect(arc.span).toBeCloseTo(2, 5)
    expect(fallback).toMatchObject({ skip: true, span: 0 })
    expect(fallback.color).toBe(arc.color)
    expect(fallback.color).not.toBe(
      skipAt(0.005, undefined, simpleGraph).strokes[0]!.color,
    )
  })

  // a 5 px arch over a chord under its stroke drew a blob, and a skip under a
  // pixel a plain dot keyed apart
  test('with walks a skip whose span on screen holds no arch its stroke can shape is left out and counted, one that holds it drawn', () => {
    const batchAt = (scale: number, connectorThickness: number) =>
      buildGeometry({
        nodePositions: simplePositions,
        graph: walked,
        nodeById: simpleNodeById,
        colorScheme: 'uniform',
        contigThickness: 6,
        connectorThickness,
        drawPaths: false,
        axis: iso(scale),
        deletions: new Map([[0, []]]),
      })
    for (const [scale, thickness, left] of [
      [0.005, 2, true],
      [0.8, 2, false],
      [0.8, 6, true],
      [4, 6, false],
    ] as const) {
      const batch = batchAt(scale, thickness)
      expect(new Set(batch.skipsTooShort).has(0)).toBe(left)
      expect(batch.edgeCurveRuns.has(0)).toBe(!left)
    }
  })

  // a head is 10 px on a plain link, so it waits for 30 px of link
  test('a link under three heads long drops its head until a zoom lengthens it', () => {
    const tight = {
      ...simplePositions,
      'B+': [
        { x: 11, y: 0 },
        { x: 21, y: 0 },
      ],
    }
    expect(headOf(tight, 10)).toBeUndefined()
    expect(headOf(tight, 20)).toBeUndefined()
    expect(headOf(tight, 40)).toMatchObject({ length: 10 })
  })

  // an anchored layout's joint: the edge has no length, so no curve direction
  test('an abutting edge points into the node it enters, on the joint', () => {
    const head = headOf(
      {
        'A+': [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        'B+': [
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
      4,
    )!
    expect(head).toMatchObject({ x: 10, y: 0 })
    expect(head.angle).toBeCloseTo(Math.PI / 2, 6)
  })

  // a run of 1 bp nodes on a walk row drew a head at every joint
  test('a joint drops its head when the node it leaves cannot hold it', () => {
    const joint = (fromLength: number) =>
      headOf(
        {
          'A+': [
            { x: 10 - fromLength, y: 0 },
            { x: 10, y: 0 },
          ],
          'B+': [
            { x: 10, y: 0 },
            { x: 20, y: 0 },
          ],
        },
        4,
      )
    expect(joint(1)).toBeUndefined()
    expect(joint(5)).toBeDefined()
  })
})

// With the last control point on the endpoint, the tangent's limit at t=1 runs
// from the first control point, not along the chord.
test('endTangent reads the first control point when the last is degenerate', () => {
  expect(
    endTangent({
      x0: 0,
      y0: 0,
      cx0: 10,
      cy0: 0,
      cx1: 10,
      cy1: 10,
      x1: 10,
      y1: 10,
    }),
  ).toBeCloseTo(Math.PI / 2, 6)
})

test('a stub of a moved component draws paler than the same node unmoved', () => {
  const moved = { ...simpleGraph.nodes[1]!, moved: true as const }
  const opts = {
    axis: iso(),
    nodePositions: simplePositions,
    colorScheme: 'uniform' as const,
    contigThickness: 5,
    connectorThickness: 1.5,
    drawPaths: false,
  }
  const plain = buildGeometry({
    ...opts,
    graph: simpleGraph,
    nodeById: simpleNodeById,
  })
  const stub = buildGeometry({
    ...opts,
    graph: { ...simpleGraph, nodes: [simpleGraph.nodes[0]!, moved] },
    nodeById: new Map([...simpleNodeById, ['B+', moved]]),
  })
  expect(nodeColor(stub, 'A+')).toBe(nodeColor(plain, 'A+'))
  const alpha = (c: number) => c >>> 24
  expect(alpha(nodeColor(stub, 'B+'))).toBeLessThan(
    alpha(nodeColor(plain, 'B+')),
  )
})
