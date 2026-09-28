// Panels this far apart, each a title row over a drawing padded this much
export const FACET_GAP_PX = 8
export const FACET_TITLE_PX = 34
export const FACET_PAD_PX = 12
const MIN_FACET_PANEL_PX = 60

export interface FacetGrid {
  columns: number
  width: number
  height: number
  // the drawing's scale in each panel
  scale: number
  total: number
}

// How `count` panels of one drawing tile a pane `width` wide that may grow to
// `room` tall. Unless `columns` says, as many go across as draws each panel
// largest, as facet_wrap chooses its grid: four square drawings go two by
// two in a tall pane and four across in a wide one, and a drawing far wider
// than it is tall stacks. A row layout's rows are px, so its scale is x
// alone and its panels stack. Each panel is as tall as its drawing needs.
export function facetGrid({
  count,
  bounds,
  pixelRows,
  width,
  room,
  columns,
}: {
  count: number
  bounds: { w: number; h: number }
  pixelRows: boolean
  width: number
  room: number
  columns?: number
}): FacetGrid {
  function tile(across: number): FacetGrid {
    const rows = Math.ceil(count / across)
    const panelWidth = Math.floor(
      (width - (across - 1) * FACET_GAP_PX) / across,
    )
    const panelRoom =
      (room - rows * FACET_TITLE_PX - (rows - 1) * FACET_GAP_PX) / rows
    const fitX = (panelWidth - 2 * FACET_PAD_PX) / bounds.w
    const fitY =
      bounds.h > 0 ? (panelRoom - 2 * FACET_PAD_PX) / bounds.h : Infinity
    const scale = pixelRows ? fitX : Math.min(fitX, fitY)
    const drawn = pixelRows ? bounds.h : bounds.h * scale
    const height = Math.floor(
      Math.max(
        MIN_FACET_PANEL_PX,
        Math.min(drawn + 2 * FACET_PAD_PX, panelRoom),
      ),
    )
    return {
      columns: across,
      width: panelWidth,
      height,
      scale,
      total: rows * (height + FACET_TITLE_PX) + (rows - 1) * FACET_GAP_PX,
    }
  }
  if (columns !== undefined) {
    return tile(Math.max(1, Math.min(count, Math.round(columns))))
  }
  let best = tile(1)
  for (let across = 2; across <= count; across++) {
    const grid = tile(across)
    if (grid.scale > best.scale) {
      best = grid
    }
  }
  return best
}
