import { hiddenUnderHalos, inversionHalos } from '../inversionHalos'

import type { DeletionDrawing } from '../deletionEdges'
import type { LayoutResult } from '../types'

// What the renderer reads off a layout and its deletion drawing, which every
// caller of buildGeometry needs and none of them owns: a row layout draws its
// bars as an overlay rather than nodes, so it hands the renderer no positions,
// and a link the drawing hides is hidden wherever it is drawn, and from the
// pointer. `version` is bumped when a drag moves the positions in place.
export interface GeometryInputOptions {
  drawsRows?: boolean
  version?: number
}

export function drawnInversionHalos(
  layout: LayoutResult,
  drawing: DeletionDrawing,
  o: GeometryInputOptions = {},
) {
  return o.drawsRows || layout.tubeMap || !drawing.inversions
    ? []
    : inversionHalos(drawing.inversions, layout.nodePositions, o.version)
}

export function hiddenLinks(
  layout: LayoutResult,
  drawing: DeletionDrawing,
  o: GeometryInputOptions = {},
) {
  return hiddenUnderHalos(
    drawing.hidden,
    drawnInversionHalos(layout, drawing, o),
  )
}

export function layoutGeometryInputs(
  layout: LayoutResult,
  drawing: DeletionDrawing,
  o: GeometryInputOptions = {},
) {
  return {
    nodePositions: o.drawsRows ? {} : layout.nodePositions,
    deletions: drawing.bypassed,
    deletionRoutes: layout.deletionRoutes,
    stranded: layout.stranded,
    hiddenEdges: hiddenLinks(layout, drawing, o),
    inversionHalos: drawnInversionHalos(layout, drawing, o),
  }
}
