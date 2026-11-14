// A colour is packed as an ABGR u32: red in byte 0, alpha in byte 3, the layout
// a shader reads from a u32 vertex attribute. `>>> 0` keeps an opaque colour
// positive, since alpha's top bit would otherwise set the sign.
export function packAbgr(r: number, g: number, b: number, a: number) {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
}

export function abgrRed(c: number) {
  return c & 0xff
}

export function abgrGreen(c: number) {
  return (c >>> 8) & 0xff
}

export function abgrBlue(c: number) {
  return (c >>> 16) & 0xff
}

export function abgrAlpha(c: number) {
  return (c >>> 24) & 0xff
}

export function abgrToCssRgba(c: number) {
  return `rgba(${abgrRed(c)},${abgrGreen(c)},${abgrBlue(c)},${abgrAlpha(c) / 255})`
}

export function normalizedRgbToCssRgba(
  c: readonly [number, number, number],
  alpha: number,
) {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alpha})`
}

// The same colour at a fraction of its alpha, so a faded node reads as the
// same ink through it on any background.
export function fadeAbgr(c: number, alpha: number) {
  return packAbgr(
    abgrRed(c),
    abgrGreen(c),
    abgrBlue(c),
    Math.round(abgrAlpha(c) * alpha),
  )
}

// Lighten a packed color toward white by 1 - 1/factor, leaving alpha alone.
// Mixing keeps the hue, where scaling each channel clamps the largest first
// and turns a green yellow. factor <= 1 returns the color unchanged.
export function brightenAbgr(c: number, factor: number) {
  const t = Math.max(0, 1 - 1 / factor)
  const lift = (v: number) => Math.round(v + (255 - v) * t)
  return packAbgr(
    lift(abgrRed(c)),
    lift(abgrGreen(c)),
    lift(abgrBlue(c)),
    abgrAlpha(c),
  )
}
