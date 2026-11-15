import {
  LEGEND_INSET_PX,
  keyColumnBox,
  keyColumnPx,
  keyHeightPx,
} from './keyColumn'

const pane = {
  paneWidth: 1000,
  canvasHeight: 400,
  legendSize: { width: 200, height: 150 },
}

test("the key's column is its width and an inset either side, down the pane's whole right edge", () => {
  expect(keyColumnPx(pane)).toBe(200 + 2 * LEGEND_INSET_PX)
  expect(keyColumnBox({ ...pane, referenceStripZonePx: 20 })).toEqual({
    x0: 1000 - 200 - 2 * LEGEND_INSET_PX,
    x1: 1000,
    y0: 0,
    y1: 400,
  })
})

test('an unmeasured key takes no column and asks no height', () => {
  const none = { ...pane, legendSize: { width: 0, height: 0 } }
  expect(keyColumnPx(none)).toBe(0)
  expect(keyColumnBox(none).x0).toBe(1000)
  expect(keyHeightPx(none)).toBe(0)
})

test('the height that shows every row of the key counts its insets and the strip over it', () => {
  expect(keyHeightPx(pane)).toBe(150 + 2 * LEGEND_INSET_PX)
  expect(keyHeightPx({ ...pane, referenceStripZonePx: 20 })).toBe(
    150 + 2 * LEGEND_INSET_PX + 20,
  )
})
