import { SpatialIndex } from './SpatialIndex'

const positions = {
  'A+': [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ],
  'B+': [
    { x: 200, y: 200 },
    { x: 300, y: 200 },
  ],
  'C+': [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
  ],
}

test('finds nearby segments', () => {
  const index = new SpatialIndex(positions, 50)
  const results = index.query(50, 0, 10)
  const nodeIds = results.map(r => r.nodeId)
  expect(nodeIds).toContain('A+')
  expect(nodeIds).not.toContain('B+')
})

test('finds nothing when far from all segments', () => {
  const index = new SpatialIndex(positions, 50)
  const results = index.query(500, 500, 10)
  expect(results).toHaveLength(0)
})

test('finds segments near intersection', () => {
  const index = new SpatialIndex(positions, 50)
  const results = index.query(0, 0, 10)
  const nodeIds = new Set(results.map(r => r.nodeId))
  expect(nodeIds.has('A+')).toBe(true)
  expect(nodeIds.has('C+')).toBe(true)
})

test('larger radius finds more candidates', () => {
  const index = new SpatialIndex(positions, 50)
  const small = index.query(150, 100, 10)
  const large = index.query(150, 100, 200)
  expect(large.length).toBeGreaterThanOrEqual(small.length)
})

test('deduplicates entries across cells', () => {
  const index = new SpatialIndex(positions, 10)
  const results = index.query(50, 0, 20)
  const keys = results.map(r => `${r.nodeId}:${r.segmentIdx}`)
  const unique = new Set(keys)
  expect(keys.length).toBe(unique.size)
})

// A row layout puts bp on x and a 20 px row pitch on y, so one cell size taken
// from the two summed is the x size, and applied to y it swallows every row into
// one cell: the grid stops discriminating on y and each query hands the distance
// loop every row in the band. HPRC's rGFA is exactly this shape, at ~7 kb a
// segment.
test('a row layout is bucketed on both axes, not just on x', () => {
  const rows: Record<string, { x: number; y: number }[]> = {}
  for (let row = 0; row < 20; row++) {
    rows[`r${row}`] = [
      { x: 0, y: row * 20 },
      { x: 7000, y: row * 20 },
    ]
  }
  const index = new SpatialIndex(rows)

  // 5 screen px of slack on y, which is a quarter of a row
  const hits = index.query(3500, 0, 7000 * 0.001, 5)
  expect(hits.map(h => h.nodeId)).toEqual(['r0'])
})

test('a query far wider than its cells looks only in the cells that hold a segment', () => {
  const index = new SpatialIndex(
    {
      far: [
        { x: 5000, y: 3000 },
        { x: 5001, y: 3000 },
      ],
      near: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    },
    1,
  )
  const lookups = vi.spyOn(Map.prototype, 'get')
  const hits = index.query(2500, 1500, 3000)
  const looked = lookups.mock.calls.length
  lookups.mockRestore()
  expect(hits.map(h => h.nodeId)).toEqual(['near', 'far'])
  expect(looked).toBeLessThan(10)
})

test('some asks no further once a segment passes', () => {
  const index = new SpatialIndex(positions, 50)
  const asked: string[] = []
  const found = index.some(150, 100, 200, 200, ({ nodeId }) => {
    asked.push(nodeId)
    return true
  })
  expect(found).toBe(true)
  expect(asked).toHaveLength(1)
  expect(index.some(150, 100, 200, 200, () => false)).toBe(false)
  expect(index.some(500, 500, 10, 10, () => true)).toBe(false)
})

test('cells are no smaller than the smallest asked for', () => {
  const dots = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [
      `d${i}`,
      [
        { x: i * 10, y: 0 },
        { x: i * 10 + 1, y: 0 },
      ],
    ]),
  )
  expect(new SpatialIndex(dots).query(250, 0, 100)).toHaveLength(21)
  expect(
    new SpatialIndex(dots, undefined, { x: 500, y: 500 }).query(250, 0, 100),
  ).toHaveLength(50)
})
