import { formatBp, graphLabels, rowLabelBox } from './graphLabels'

// isotropic: one scale for both axes, which is every layout but the row ones
const iso = (scale = 1) => ({ scaleX: scale, scaleY: scale })

// along the middle of the 400 px pane, where a label stands whole
const NODES = {
  long: [
    { x: 0, y: 200 },
    { x: 200, y: 200 },
  ],
  // 70 units, which at scale 1 runs on past "12 bp" at both ends and at
  // scale 0.35 does not
  small: [
    { x: 300, y: 200 },
    { x: 370, y: 200 },
  ],
  // 2 units: a speck, whose label would be twenty times the thing it names
  speck: [
    { x: 400, y: 200 },
    { x: 402, y: 200 },
  ],
}
const LENGTHS = new Map([
  ['long', 39_000],
  ['small', 12],
  ['speck', 7],
])

// The two backbone nodes a deletion edge runs between, absent from LENGTHS so
// they carry no labels of their own
const FLANKS = {
  before: [
    { x: -80, y: 200 },
    { x: 0, y: 200 },
  ],
  after: [
    { x: 200, y: 200 },
    { x: 280, y: 200 },
  ],
}
const FLANKED = { ...NODES, ...FLANKS }
const between = { from: 'before', to: 'after' }

const VIEWPORT = { translateX: 0, translateY: 0, width: 800, height: 400 }

test('labels a node with the sequence it carries', () => {
  const labels = graphLabels({
    nodePositions: NODES,
    nodeLengths: LENGTHS,
    axis: iso(),
    ...VIEWPORT,
  })
  expect(labels.map(l => l.text).sort()).toEqual(['12 bp', '39 kb'])
})

// The reason a label is missing has to be in the picture. It is not "the node is
// small" against a flat pixel count, it is "the node is shorter than the words",
// measured against the text that would be drawn.
test('drops a label the node cannot nearly hold', () => {
  const labels = graphLabels({
    nodePositions: NODES,
    nodeLengths: LENGTHS,
    axis: iso(),
    ...VIEWPORT,
  })
  expect(labels.map(l => l.text)).not.toContain('7 bp')
})

// Zooming out shrinks every node past its own label, so a wide view sheds labels
// on its own rather than carrying one per speck.
test('sheds labels as the view zooms out', () => {
  const at = (scale: number) =>
    graphLabels({
      nodePositions: NODES,
      nodeLengths: LENGTHS,
      axis: iso(scale),
      ...VIEWPORT,
    }).map(l => l.text)
  expect(at(1).sort()).toEqual(['12 bp', '39 kb'])
  expect(at(0.35)).toEqual(['39 kb'])
  expect(at(0.05)).toEqual([])
})

test('drops a label that would land outside the canvas', () => {
  const labels = graphLabels({
    nodePositions: NODES,
    nodeLengths: LENGTHS,
    axis: iso(),
    ...VIEWPORT,
    // panned until the long node's midpoint is off the left edge
    translateX: -250,
  })
  expect(labels.map(l => l.text)).toEqual(['12 bp'])
})

test('formats bp at the scale a pangenome allele lives at', () => {
  expect([formatBp(12), formatBp(1200), formatBp(2_500_000)]).toEqual([
    '12 bp',
    '1.2 kb',
    '2.5 Mb',
  ])
})

test('rounds up to Mb rather than to 1000 kb', () => {
  expect(formatBp(999_800)).toBe('1 Mb')
  expect(formatBp(999_400)).toBe('999 kb')
})

// The row labels of a row-structured layout paint over the same overlay and are
// opaque, so a node label under one is gone rather than behind it: a "17 bp"
// against the left edge of an anchored layout came out as a stray "bp" beside
// `Reference (rank 0)`.
test('a row label holds its space against a node label', () => {
  const at = (reserved?: ReturnType<typeof rowLabelBox>[]) =>
    graphLabels({
      nodePositions: {
        atEdge: [
          { x: 10, y: 40 },
          { x: 90, y: 40 },
        ],
      },
      nodeLengths: new Map([['atEdge', 17]]),
      axis: iso(),
      ...VIEWPORT,
      reserved,
    }).map(l => l.text)
  expect(at()).toEqual(['17 bp'])
  expect(at([rowLabelBox('Reference (rank 0)', 40)])).toEqual([])
})

// What a walk skips is drawn, never written: no "84.7 kb del" on an arc, and no
// net size on an allele drawn over the reference it replaces
test('no label names a deletion or a net size', () => {
  const withArc = {
    nodePositions: FLANKED,
    nodeLengths: LENGTHS,
    deletions: [
      {
        edgeIndex: 3,
        ...between,
        refName: 'chr1',
        start: 100,
        end: 84_783,
        bp: 84_683,
        bypassed: ['long'],
      },
    ],
    axis: iso(),
    ...VIEWPORT,
  }
  expect(
    graphLabels(withArc)
      .map(l => l.text)
      .sort(),
  ).toEqual(['12 bp', '39 kb'])
  const labels = graphLabels({
    nodePositions: NODES,
    nodeLengths: LENGTHS,
    alleleDeletions: [{ nodeIds: ['long'], bp: 7019 }],
    axis: iso(),
    ...VIEWPORT,
  })
  expect(labels.map(l => l.text)).toEqual(['12 bp'])
})

// "39 kb" written across a bar whose width is the reference it replaces reads as
// the bar's size, so that node keeps its length off the drawing
test('a node inside an allele deletion keeps its length off the drawing', () => {
  const labels = graphLabels({
    nodePositions: NODES,
    nodeLengths: LENGTHS,
    alleleDeletions: [{ nodeIds: ['long'], bp: 7019 }],
    axis: iso(),
    ...VIEWPORT,
  })
  expect(labels.map(l => l.text)).not.toContain('39 kb')
})

// A node drag moves the position objects without replacing them, and a label
// follows its node there
test('labels follow positions mutated in place', () => {
  const nodePositions = {
    long: [
      { x: 0, y: 200 },
      { x: 200, y: 200 },
    ],
  }
  const at = () =>
    graphLabels({
      nodePositions,
      nodeLengths: new Map([['long', 39_000]]),
      axis: iso(),
      ...VIEWPORT,
    })[0]!
  const before = at()
  for (const seg of nodePositions.long) {
    seg.x += 120
  }
  expect(at().x).toBeCloseTo(before.x + 120, 5)
})

// The other half of that contract: a pan changes where labels go and nothing
// else, so the per-layout caches have to survive it rather than be keyed by it.
test('a pan moves every label by the pan and drops none', () => {
  const args = {
    nodePositions: NODES,
    nodeLengths: LENGTHS,
    axis: iso(),
    ...VIEWPORT,
  }
  const before = graphLabels(args)
  const after = graphLabels({ ...args, translateX: args.translateX + 25 })
  expect(after.map(l => l.key)).toEqual(before.map(l => l.key))
  expect(after.map(l => l.x)).toEqual(before.map(l => l.x + 25))
})

test("a node's label sits halfway along its polyline", () => {
  const labels = graphLabels({
    nodePositions: {
      mid: [
        { x: 0, y: 20 },
        { x: 200, y: 20 },
      ],
    },
    nodeLengths: new Map([['mid', 5000]]),
    axis: iso(),
    ...VIEWPORT,
  })
  expect(labels).toHaveLength(1)
  expect(labels[0]!.x).toBe(100)
  expect(labels[0]!.y).toBe(20)
})
