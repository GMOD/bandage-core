import { describe, expect, test } from 'vitest'

import {
  abgrAlpha,
  abgrBlue,
  abgrGreen,
  abgrRed,
  brightenAbgr,
  packAbgr,
} from './colorBits'

const rgb = (c: number) => [abgrRed(c), abgrGreen(c), abgrBlue(c)]

describe('brightenAbgr', () => {
  test('a factor of 1 leaves the color alone', () => {
    const c = packAbgr(46, 204, 113, 200)
    expect(brightenAbgr(c, 1)).toBe(c)
  })

  // Scaling each channel clamped green at 255 while red kept climbing, so a
  // hovered green node read as yellow
  test('a green stays green, lighter', () => {
    const [r, g, b] = rgb(brightenAbgr(packAbgr(120, 220, 60, 255), 1.4))
    expect(g).toBeGreaterThan(220)
    expect(g - r).toBeGreaterThan(50)
    expect(g - b).toBeGreaterThan(80)
  })

  test('mixes toward white by 1 - 1/factor and keeps alpha', () => {
    const c = brightenAbgr(packAbgr(0, 100, 255, 128), 2)
    expect(rgb(c)).toEqual([128, 178, 255])
    expect(abgrAlpha(c)).toBe(128)
  })
})
