import type { DeletionDrawing } from '../deletionEdges'
import type { LayoutResult } from '../types'

// What the renderer reads off a layout and its deletion drawing, which every
// caller of buildGeometry needs and none of them owns: a row layout draws its
// bars as an overlay rather than nodes, so it hands the renderer no positions,
// and a deletion the drawing hides is hidden wherever it is drawn.
export function layoutGeometryInputs(
  layout: LayoutResult,
  drawing: DeletionDrawing,
  o: { drawsRows?: boolean } = {},
) {
  return {
    nodePositions: o.drawsRows ? {} : layout.nodePositions,
    deletions: drawing.bypassed,
    deletionRoutes: layout.deletionRoutes,
    stranded: layout.stranded,
    hiddenEdges: drawing.hidden,
  }
}
