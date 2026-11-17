// Every label drawn over the graph claims a box in screen px from one
// occupancy, so a label that would land on one already placed, or off the pane,
// is dropped whichever overlay it belongs to. Callers take in priority order.
// A chip is drawn whole or not at all.

export interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

export const LABEL_PX = 11
export const LABEL_CHAR_PX = 6.2
export const LABEL_PAD = 4

export interface LabelCandidate<T> {
  item: T
  x: number
  y: number
  text: string
  // how many rows down to try when the spot is taken, for a label that is
  // worth a column beside its neighbours rather than dropping
  stack?: number
  // a shorter text to try where `text` does not fit, such as against the
  // pane's edge
  fallback?: string
  // where to try when no row from `y` is inside the pane and `fits`, such as
  // above a pin whose node runs on under it; its rows stack away from `y`
  flipY?: number
  // whether the label may stand in a box, beyond its being free
  fits?: (box: Box) => boolean
  // how far sideways, in px, the label may move to find a box on a row
  slide?: number
  // where no row from `y` or `flipY` takes it, the label stands at the free
  // spot nearest this point, one that `fits` where any does, so it is never
  // dropped
  nearest?: { x: number; y: number }
}

export interface PlacedLabel<T> extends LabelCandidate<T> {
  w: number
}

export type TakeBox = (box: Box) => boolean

export function labelWidth(text: string) {
  return text.length * LABEL_CHAR_PX + LABEL_PAD * 2
}

export function overlaps(a: Box, b: Box) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0
}

interface Frame {
  width: number
  height: number
}

function offFrame(box: Box, frame: Frame) {
  return (
    box.x1 <= 0 ||
    box.x0 >= frame.width ||
    box.y1 <= 0 ||
    box.y0 >= frame.height
  )
}

function insideFrame(box: Box, frame: Frame) {
  return (
    box.x0 >= 0 &&
    box.x1 <= frame.width &&
    box.y0 >= 0 &&
    box.y1 <= frame.height
  )
}

export function occupancy(frame: Frame, reserved: Box[] = []): TakeBox {
  const placed = [...reserved]
  return box => {
    if (offFrame(box, frame) || placed.some(p => overlaps(p, box))) {
      return false
    }
    placed.push(box)
    return true
  }
}

const SLIDE_STEP_PX = 8

// The sideways moves a label may try on a row, nearest first
function slides(slide: number) {
  const out = [0]
  for (let d = SLIDE_STEP_PX; d < slide; d += SLIDE_STEP_PX) {
    out.push(-d, d)
  }
  if (slide > 0) {
    out.push(-slide, slide)
  }
  return out
}

// A row another label took is a crowd, which keeps a dense gene track to one
// lane; a row only a `reserved` box (the key, the strip, the row labels) took
// is not, so a label it refuses still tries above
export function placeLabels<T>(
  candidates: LabelCandidate<T>[],
  frame: Frame,
  take: TakeBox,
  reserved: readonly Box[] = [],
): PlacedLabel<T>[] {
  const out: PlacedLabel<T>[] = []
  const row = LABEL_PX + LABEL_PAD * 2
  const boxAt = (x: number, y: number, w: number) => ({
    x0: x - w / 2,
    x1: x + w / 2,
    y0: y - LABEL_PX - LABEL_PAD,
    y1: y + LABEL_PAD,
  })
  // the label on the free spot nearest its anchor, rows down from `from` and
  // slides sideways measured alike, so a row's long slide waits for the next
  // row's short one; and whether another label took a spot it could otherwise
  // stand on
  const stackFrom = (
    c: LabelCandidate<T>,
    text: string,
    from: number,
    direction: number,
  ) => {
    const w = labelWidth(text)
    const spots: { dx: number; y: number; distance: number }[] = []
    for (let tries = 0; tries <= (c.stack ?? 0); tries++) {
      const y = from + direction * tries * row
      if (offFrame(boxAt(c.x, y, w), frame)) {
        break
      }
      for (const dx of slides(c.slide ?? 0)) {
        spots.push({ dx, y, distance: Math.hypot(dx, tries * row) })
      }
    }
    spots.sort((a, b) => a.distance - b.distance)
    let crowded = false
    for (const { dx, y } of spots) {
      const box = boxAt(c.x + dx, y, w)
      if (insideFrame(box, frame) && (c.fits?.(box) ?? true)) {
        if (take(box)) {
          return { placed: { ...c, x: c.x + dx, text, y, w }, crowded }
        }
        crowded ||= !reserved.some(r => overlaps(r, box))
      }
    }
    return { placed: undefined, crowded }
  }
  // a stack grows away from the nearer edge of the pane. A label moves to flipY
  // when `fits` or the pane refused every row, and stays put when another
  // label took one, which keeps a dense gene track to one lane
  const place = (c: LabelCandidate<T>, text: string) => {
    const first = stackFrom(c, text, c.y, c.y > frame.height / 2 ? -1 : 1)
    return (
      first.placed ??
      (c.flipY === undefined || first.crowded
        ? undefined
        : stackFrom(c, text, c.flipY, c.flipY < c.y ? -1 : 1).placed)
    )
  }
  // rows up and down from `nearest` to the pane's edges, nearest first, and
  // of two as near the higher, then the one to the left; slid either way to
  // the pane's edges from a point on the pane, so a spot past a reserved box
  // is found, else as `stackFrom` slides
  const nearestFree = (
    c: LabelCandidate<T>,
    text: string,
    from: { x: number; y: number },
  ) => {
    const w = labelWidth(text)
    const rows = Math.ceil(frame.height / row)
    const across = slides(
      insideFrame({ x0: from.x, x1: from.x, y0: from.y, y1: from.y }, frame)
        ? Math.max(from.x, frame.width - from.x)
        : (c.slide ?? 0),
    )
    const spots: { box: Box; x: number; y: number; distance: number }[] = []
    for (let k = -rows; k <= rows; k++) {
      for (const dx of across) {
        const x = from.x + dx
        const y = from.y + k * row
        const box = boxAt(x, y, w)
        if (insideFrame(box, frame)) {
          spots.push({ box, x, y, distance: Math.hypot(dx, k * row) })
        }
      }
    }
    spots.sort((a, b) => a.distance - b.distance)
    const spot =
      spots.find(s => (c.fits?.(s.box) ?? true) && take(s.box)) ??
      spots.find(s => take(s.box))
    return spot && { ...c, x: spot.x, y: spot.y, text, w }
  }
  for (const c of candidates) {
    const placed =
      place(c, c.text) ??
      (c.fallback === undefined ? undefined : place(c, c.fallback)) ??
      (c.nearest === undefined ? undefined : nearestFree(c, c.text, c.nearest))
    if (placed) {
      out.push(placed)
    }
  }
  return out
}
