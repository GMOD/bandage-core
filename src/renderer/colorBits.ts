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

export function abgrHex(c: number) {
  return `#${[abgrRed(c), abgrGreen(c), abgrBlue(c)].map(v => v.toString(16).padStart(2, '0')).join('')}`
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

// `#rrggbb`, opaque
export function hexAbgr(hex: string) {
  const v = Number.parseInt(hex.slice(1), 16)
  return packAbgr((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff, 255)
}

const linear = (v: number) => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

// WCAG 2's relative luminance and contrast ratio, alpha ignored
export function relativeLuminance(c: number) {
  return (
    0.2126 * linear(abgrRed(c)) +
    0.7152 * linear(abgrGreen(c)) +
    0.0722 * linear(abgrBlue(c))
  )
}

export function contrastRatio(a: number, b: number) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// `c` moved a fraction `t` of the way to `to`, opaque
export function mixAbgr(c: number, to: number, t: number) {
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return packAbgr(
    mix(abgrRed(c), abgrRed(to)),
    mix(abgrGreen(c), abgrGreen(to)),
    mix(abgrBlue(c), abgrBlue(to)),
    255,
  )
}
