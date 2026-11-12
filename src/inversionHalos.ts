import { BUBBLE_KIND_COLORS } from './bubbles/classifyBubble'
import { formatBp } from './graphLabels'
import { weakMemo } from './util/weakMemo'

import type { Inversion } from './deletionEdges'
import type { NodeSegment } from './types'

// An inversion is two links, into and out of the run they read backwards. A
// layout that draws the reference straight lays both along that run, where
// they show only as arrowheads pointing on along the reference. So the run is
// marked as the viewer marks a bubble, with a halo along its nodes in the
// inversion bubble's orange and a chip over it, `INV 37.6 kb`. Where the run
// lies flat its links are left out, since they say the opposite of the halo;
// where a layout curls it, they are what draw the loop, and stay.

export const INVERSION_COLOR = BUBBLE_KIND_COLORS.inversion

export const INVERSION_LABEL = 'INV'

// as the viewer draws a bubble's halo
export const HALO_OPACITY = 0.22

// What a legend calls the halo, in the words of the reference it reverses
export const inversionKey = (reference?: string) =>
  `${INVERSION_LABEL}: ${reference ?? 'reference'} sequence inverted in some haplotypes`

export interface InversionHalo {
  inversion: Inversion
  // the run's nodes as one line in layout units, in reference order
  points: NodeSegment[]
  // over the middle of the run, at the height of its highest point
  labelAt: { x: number; y: number }
  // the length the chip states after INV
  note: string
  // the run and the nodes its links join lie on one line, so the links lie
  // along the run
  flat: boolean
}

// How far off the line through a run its points may lie, as a share of the
// line's length, and still be drawn flat
const FLAT_SHARE = 0.05

function liesFlat(points: NodeSegment[]) {
  const first = points[0]
  const last = points.at(-1)
  const len = first && last ? Math.hypot(last.x - first.x, last.y - first.y) : 0
  const off = (p: NodeSegment) =>
    first && last
      ? Math.abs(
          (p.x - first.x) * (last.y - first.y) -
            (p.y - first.y) * (last.x - first.x),
        ) / len
      : 0
  return len > 0 && points.every(p => off(p) <= len * FLAT_SHARE)
}

// one fold rather than Math.min(...spread), which a long run overflows
function extent(points: NodeSegment[]) {
  return points.reduce(
    (b, p) => ({
      minX: Math.min(b.minX, p.x),
      maxX: Math.max(b.maxX, p.x),
      minY: Math.min(b.minY, p.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity },
  )
}

const halosCache = weakMemo<Record<string, NodeSegment[]>, InversionHalo[]>()

// A halo per inversion the layout placed. `version` is bumped when a drag
// moves the positions in place.
export function inversionHalos(
  inversions: Inversion[],
  nodePositions: Record<string, NodeSegment[]>,
  version = 0,
) {
  return halosCache(nodePositions, [inversions, version], () =>
    inversions.flatMap(inversion => {
      const points = inversion.across.flatMap(id => nodePositions[id] ?? [])
      const joined = inversion.joins.flatMap(id => nodePositions[id] ?? [])
      const { minX, maxX, minY } = extent(points)
      return points.length > 0
        ? [
            {
              inversion,
              points,
              labelAt: { x: (minX + maxX) / 2, y: minY },
              note: formatBp(inversion.bp),
              flat: liesFlat([...points, ...joined]),
            },
          ]
        : []
    }),
  )
}

const hiddenCache = weakMemo<ReadonlySet<number>, ReadonlySet<number>>()

// The links a drawing leaves out: those it hides already, and an inversion's
// where its run lies flat
export function hiddenUnderHalos(
  hidden: ReadonlySet<number>,
  halos: InversionHalo[],
) {
  const flat = halos.filter(h => h.flat)
  return flat.length === 0
    ? hidden
    : hiddenCache(hidden, [halos], () => {
        const out = new Set(hidden)
        for (const halo of flat) {
          for (const ei of halo.inversion.edgeIndexes) {
            out.add(ei)
          }
        }
        return out
      })
}
