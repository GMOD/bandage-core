// The reference-position ramp runs from hue 0 to REFERENCE_RAMP_MAX_HUE at a
// fixed saturation and lightness. `getNodeColor`, the walk schemes and the CSS
// below all read these numbers, so a key or an overlay matches the canvas.
//
// A linear track can reproduce the ramp exactly from two stated numbers and a
// node's reference midpoint:
// `hsl(min(300,max(0,(mid-start)/span*300)),70%,50%)` in a track's `color`
// slot paints a segment the colour the graph paints its node. The ramp stops at
// 300 rather than wrapping to 360, so the window's ends are red and magenta.
export const REFERENCE_RAMP_MAX_HUE = 300
export const REFERENCE_RAMP_SATURATION = 0.7
export const REFERENCE_RAMP_LIGHTNESS = 0.5

export function rampHueCss(hue: number) {
  return `hsl(${hue}, ${REFERENCE_RAMP_SATURATION * 100}%, ${REFERENCE_RAMP_LIGHTNESS * 100}%)`
}

// the hue at `frac` of the way along the ramp, clamped to its ends
export function rampHueAt(frac: number) {
  return Math.max(0, Math.min(1, frac)) * REFERENCE_RAMP_MAX_HUE
}

export function rampHue(bp: number, domain: { start: number; end: number }) {
  return rampHueAt((bp - domain.start) / (domain.end - domain.start))
}

// hue degrees one gradient stop spans, since SVG interpolates stops in RGB
const HUE_STOP_DEG = 30

// The most hue one flat piece of a drawn reference span covers, so every
// point of it is within half this of its own position's hue
export const RAMP_PIECE_DEG = 6

// A reference span cut into the flat pieces the ramp paints it in, each
// covering at most RAMP_PIECE_DEG of hue: where each starts and ends, as
// fractions of the span from its start, and how far along the ramp its middle
// lies. One piece means the span is painted in one colour.
export function rampPieces(
  { start, bp }: { start: number; bp: number },
  domain: { start: number; end: number },
) {
  const hues = rampHue(start + bp, domain) - rampHue(start, domain)
  const count = Math.max(1, Math.ceil(hues / RAMP_PIECE_DEG - 1e-9))
  return Array.from({ length: count }, (_, i) => ({
    from: i / count,
    to: (i + 1) / count,
    t:
      (start + (bp * (i + 0.5)) / count - domain.start) /
      (domain.end - domain.start),
  }))
}

// The hues a gradient across `bp` of reference paints, evenly spaced along it
// and walked from `to`'s end when reversed. One hue means the span reads flat.
export function rampStops(
  { start, bp, reversed }: { start: number; bp: number; reversed?: boolean },
  domain: { start: number; end: number },
) {
  const low = rampHue(start, domain)
  const high = rampHue(start + bp, domain)
  if (high - low < 1) {
    return [(low + high) / 2]
  }
  const n = Math.ceil((high - low) / HUE_STOP_DEG)
  return Array.from({ length: n + 1 }, (_, i) =>
    rampHue(start + (bp * (reversed ? n - i : i)) / n, domain),
  )
}

export const RAMP_GRADIENT_STOPS = Array.from({ length: 7 }, (_, i) => ({
  offset: i / 6,
  color: rampHueCss((i / 6) * REFERENCE_RAMP_MAX_HUE),
}))

export const RAMP_GRADIENT_CSS = `linear-gradient(to right, ${RAMP_GRADIENT_STOPS.map(
  s => `${s.color} ${s.offset * 100}%`,
).join(', ')})`
