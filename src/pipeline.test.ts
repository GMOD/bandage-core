import { fitTransform } from './pipeline'

test('padTop moves the drawing down by the room it adds', () => {
  const bounds = { minX: 0, minY: 0, w: 100, h: 100 }
  const plain = fitTransform(bounds, 280, 280, false)!
  const padded = fitTransform(bounds, 280, 302, false, { padTop: 62 })!
  expect(padded.scale).toBe(plain.scale)
  expect(padded.translateY).toBe(plain.translateY + 22)
})
