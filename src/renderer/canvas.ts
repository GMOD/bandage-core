// Cost scales with the square of the ratio, so a dpr=3 phone would shade 9x the
// pixels of dpr=1 for a difference nobody resolves past 2x.
export const MAX_DPR = 2

// Browsers throw `InvalidStateError: Canvas exceeds max size` once a backing
// store crosses their limit. 8192 is under every one of them.
export const MAX_CANVAS_DIM_PX = 8192

// The ratio every canvas here renders at. The backing-store size and the
// transform a caller builds for it must read the same value, so callers use
// this rather than a bare `devicePixelRatio`.
export function getDpr() {
  return typeof devicePixelRatio === 'undefined'
    ? 1
    : Math.min(devicePixelRatio, MAX_DPR)
}

let warnedCanvasClamp = false

function backingPx(cssSize: number, dpr: number, axis: string) {
  const value = Math.round(cssSize * dpr)
  if (value > MAX_CANVAS_DIM_PX) {
    if (!warnedCanvasClamp) {
      warnedCanvasClamp = true
      console.warn(
        `Canvas ${axis} ${value}px exceeds the safe limit ${MAX_CANVAS_DIM_PX}px and was clamped`,
      )
    }
    return MAX_CANVAS_DIM_PX
  }
  return value
}

export function syncCanvasSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const dpr = getDpr()
  const pw = backingPx(width, dpr, 'width')
  const ph = backingPx(height, dpr, 'height')
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const cssWidth = `${width}px`
  const cssHeight = `${height}px`
  if (canvas.style.width !== cssWidth) {
    canvas.style.width = cssWidth
  }
  if (canvas.style.height !== cssHeight) {
    canvas.style.height = cssHeight
  }
}
