import {
  FACET_GAP_PX,
  FACET_TITLE_PX,
  facetCells,
  facetGrid,
  facetSettingOf,
} from './facetGrid'

const square = { w: 100, h: 100 }

test('four square drawings go two by two in a tall pane and four across in a wide one', () => {
  const tall = facetGrid({
    count: 4,
    bounds: square,
    pixelRows: false,
    width: 800,
    room: 900,
  })
  expect(tall.columns).toBe(2)
  const wide = facetGrid({
    count: 4,
    bounds: square,
    pixelRows: false,
    width: 1400,
    room: 400,
  })
  expect(wide.columns).toBe(4)
})

test('a drawing far wider than it is tall stacks, and so does a row layout', () => {
  const flat = { w: 1000, h: 50 }
  expect(
    facetGrid({
      count: 3,
      bounds: flat,
      pixelRows: false,
      width: 1200,
      room: 600,
    }).columns,
  ).toBe(1)
  expect(
    facetGrid({
      count: 3,
      bounds: square,
      pixelRows: true,
      width: 1200,
      room: 600,
    }).columns,
  ).toBe(1)
})

test('a stated column count holds, within one and the panel count', () => {
  const grid = (columns: number) =>
    facetGrid({
      count: 3,
      bounds: square,
      pixelRows: false,
      width: 900,
      room: 600,
      columns,
    }).columns
  expect(grid(2)).toBe(2)
  expect(grid(0)).toBe(1)
  expect(grid(7)).toBe(3)
})

test('panels are as tall as their drawing, and the grid adds up', () => {
  const grid = facetGrid({
    count: 2,
    bounds: { w: 200, h: 100 },
    pixelRows: false,
    width: 1000,
    room: 2000,
    columns: 2,
  })
  expect(grid.width).toBe((1000 - FACET_GAP_PX) / 2)
  expect(grid.height).toBe(Math.floor(100 * grid.scale + 24))
  expect(grid.total).toBe(grid.height + FACET_TITLE_PX)
})

test('by sample, a sample takes a row and a haplotype a column', () => {
  expect(
    facetCells(
      ['GRCh38#0#chr1', 'HG01123#2#CM1', 'HG002#1#chr1', 'HG01123#1#CM2'],
      'sample',
    ),
  ).toEqual({ columns: 2, count: 6, cells: [0, 3, 4, 2] })
})

test('walks that do not say their haplotype, or share a cell, wrap', () => {
  const wrapped = { columns: undefined, count: 2, cells: [0, 1] }
  expect(facetCells(['ref', 'alt'], 'sample')).toEqual(wrapped)
  expect(facetCells(['A#1#c1', 'A#1#c2'], 'sample')).toEqual(wrapped)
  expect(facetCells(['A#1#c1', 'B#1#c1'], 'walk')).toEqual(wrapped)
})

test('a domain puts the walks, or the samples, it lists first', () => {
  expect(facetCells(['a', 'b', 'c'], 'walk', ['c', 'a']).cells).toEqual([
    1, 2, 0,
  ])
  expect(
    facetCells(['GRCh38#0#chr1', 'A#1#ctg', 'B#1#ctg'], 'sample', ['B']).cells,
  ).toEqual([1, 2, 0])
})

test('a facet setting reads a bare field, drops one the pane cannot split on, and keeps its members', () => {
  expect(facetSettingOf('walk')).toEqual({ field: 'walk', domain: [] })
  expect(facetSettingOf('none')).toEqual({ field: '', domain: [] })
  expect(facetSettingOf(undefined)).toEqual({ field: '', domain: [] })
  expect(
    facetSettingOf({ field: 'sample', domain: ['B'], columns: 2 }),
  ).toEqual({ field: 'sample', domain: ['B'], columns: 2 })
})
