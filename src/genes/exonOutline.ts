import { el } from '../el'

import type { El } from '../el'
import type { GenePin } from './genePins'

// Each exon outlined in the gene track's CDS colour: a rounded box round the
// stretch of node that carries it, clear of the node's ink, so the node keeps
// its colour inside and an exon on a faded node reads as well as one on a
// lane. One drawing for every host: the plugin renders it as React, BandageJS
// as DOM, a figure as markup.

export const EXON_COLOR = '#daa520'
const EXON_GAP_PX = 1
const EXON_LINE_PX = 2
// a lifted walk's lane at the least, as the geometry draws it
const MIN_LANE_PX = 4

export interface ExonStretch {
  key: string
  // the stretch's path, in whatever units the tree is drawn in
  d: string
  // the width the outline clears, in px: the node's ink and a gap round it
  inner: number
}

// The stretches of node carrying exons, each clearing its node's ink, or the
// lifted lanes on it where they are wider
export function exonStretches(
  pins: GenePin[],
  halfWidthPx: (nodeId: string) => number,
  lift?: { nodeIds: ReadonlySet<string>; walks: readonly unknown[] },
  pathOf: (d: string) => string = d => d,
): ExonStretch[] {
  const inkPx = (nodeId: string) => {
    const own = halfWidthPx(nodeId) * 2
    return lift?.nodeIds.has(nodeId)
      ? Math.max(own, lift.walks.length * MIN_LANE_PX)
      : own
  }
  return pins.flatMap(pin =>
    pin.exonsByNode.map(({ nodeId, d }) => ({
      key: `${pin.gene.name}-${pin.gene.start}-${nodeId}`,
      d: pathOf(d),
      inner: inkPx(nodeId) + 2 * EXON_GAP_PX,
    })),
  )
}

// The outlines over a `width` by `height` px drawing, as a mask cut from a
// wash of the exon colour. `transform` takes paths in layout units to px, and
// their strokes keep their px widths under it.
export function exonOutlineTree(
  stretches: ExonStretch[],
  o: { id: string; width: number; height: number; transform?: string },
): El | undefined {
  if (stretches.length === 0) {
    return undefined
  }
  const stroke = (s: ExonStretch, color: string, width: number) =>
    el('path', {
      d: s.d,
      fill: 'none',
      stroke: color,
      'stroke-width': width,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'vector-effect': o.transform ? 'non-scaling-stroke' : undefined,
    })
  return el(
    'g',
    {},
    el(
      'mask',
      {
        id: o.id,
        maskUnits: 'userSpaceOnUse',
        x: 0,
        y: 0,
        width: o.width,
        height: o.height,
      },
      el(
        'g',
        { transform: o.transform },
        ...stretches.map(s => stroke(s, '#fff', s.inner + 2 * EXON_LINE_PX)),
        ...stretches.map(s => stroke(s, '#000', s.inner)),
      ),
    ),
    el('rect', {
      width: o.width,
      height: o.height,
      fill: EXON_COLOR,
      mask: `url(#${o.id})`,
    }),
  )
}
