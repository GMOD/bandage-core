import { FACET_GAP_PX, FACET_TITLE_PX, facetGrid } from './facetGrid'

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
