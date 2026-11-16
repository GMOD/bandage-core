import {
  LEGEND_INSET_PX,
  fitBesideKey,
  keyColumnBox,
  keyColumnPx,
  keyHeightPx,
} from './keyColumn'
import { FIT_PADDING } from './layout/fitAssumptions'
import { fitTransform } from './pipeline'

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

test('a host fits its drawing beside the key, so the drawing ends its padding clear of the column', () => {
  const fit = fitBesideKey(pane)
  expect(fit).toEqual({ width: 1000 - 200 - 2 * LEGEND_INSET_PX, height: 400 })
  const t = fitTransform(
    { minX: 0, minY: 0, w: 5000, h: 10 },
    fit.width,
    fit.height,
    false,
  )!
  expect(t.translateX + 5000 * t.scale).toBeCloseTo(
    keyColumnBox(pane).x0 - FIT_PADDING,
  )
  expect(
    fitBesideKey({ ...pane, legendSize: { width: 0, height: 0 } }),
  ).toEqual({ width: 1000, height: 400 })
})
