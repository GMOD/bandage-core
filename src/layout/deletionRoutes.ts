import type { NodeSegment } from '../types'

// A polyline per deletion edge, by edge index, that a layout laid out for it
// to be drawn along in place of the bowed curve. No layout in this package
// returns one any more; consumers may still pass one through.
export type DeletionRoutes = Record<number, NodeSegment[]>
