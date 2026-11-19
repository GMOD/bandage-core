// The pane a layout assumes it is fitted to where its host states none: a
// figure's default width, the gap the fit leaves on every side, and the
// height of the shortest track a host opens a graph in.

export const FIGURE_WIDTH_PX = 1200

// Gap between the drawing and the edge of the pane, on all four sides.
export const FIT_PADDING = 40

// a JBrowse track's default 300 px canvas less its reference strip
export const TRACK_FLOOR_PX = 280

// The pane, in px, a host fits a drawing into: the width and height it hands
// fitTransform, the fit's padding included
export interface FitSize {
  width: number
  height: number
}

export const ASSUMED_FIT: FitSize = {
  width: FIGURE_WIDTH_PX,
  height: TRACK_FLOOR_PX,
}

// The pane a layout is sized for: the host's, where it leaves the drawing
// room inside the padding, else the assumed one
export function fitOrAssumed(fit?: FitSize) {
  return fit && fit.width > 2 * FIT_PADDING && fit.height > 2 * FIT_PADDING
    ? fit
    : ASSUMED_FIT
}

// the room the drawing spans inside the fit's padding
export function fitRoom(fit: FitSize) {
  return {
    width: fit.width - 2 * FIT_PADDING,
    height: fit.height - 2 * FIT_PADDING,
  }
}
