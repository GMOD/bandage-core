// Cost scales with the square of the ratio, so a dpr=3 phone would shade 9x the
// pixels of dpr=1 for a difference nobody resolves past 2x.
export const MAX_DPR = 2

// Browsers throw `InvalidStateError: Canvas exceeds max size` once a backing
// store crosses their limit. 8192 is under every one of them.
export const MAX_CANVAS_DIM_PX = 8192

// The ratio every canvas here renders at. The backing-store size and the
// transform a caller builds for it must read the same value, so callers use
// this rather than a bare `devicePixelRatio`. Given the css size, it also keeps
// the backing store within MAX_CANVAS_DIM_PX.
export function getDpr(width = 0, height = 0) {
  const dpr =
    typeof devicePixelRatio === 'undefined'
      ? 1
      : Math.min(devicePixelRatio, MAX_DPR)
  return Math.min(dpr, MAX_CANVAS_DIM_PX / Math.max(width, height, 1))
}

// Returns the ratio the backing store got, which is below `getDpr()` only
// when the canvas would otherwise cross MAX_CANVAS_DIM_PX
export function syncCanvasSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const dpr = getDpr(width, height)
  const pw = Math.round(width * dpr)
  const ph = Math.round(height * dpr)
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
  return dpr
}
