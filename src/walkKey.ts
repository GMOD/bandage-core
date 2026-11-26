import { GAP_CAUSE_TEXT, OUTSIDE_TEXT, ownGapText } from './gfa/departures'
import { formatBp, groupDigits } from './graphLabels'
import { panSNHaplotype } from './pansn'

import type { LiftedWalk } from './walkHighlight'

// `contig:start-end (length)`, 1-based and closed as `formatLocus` writes it, of
// a 0-based half-open range
export function rangeText(
  contig: string | undefined,
  start: number,
  end: number,
) {
  const s = Math.round(start)
  const e = Math.round(end)
  return `${contig ? `${contig}:` : ''}${groupDigits(s + 1)}-${groupDigits(e)} (${formatBp(e - s)})`
}

// A lifted walk's key in words, for a legend row or a facet panel's title: the
// bp of its steps not loaded and what its pieces leave out, and for a lane that
// shades,
// the stretch its scale runs over as `contig:start-end (length)`, to write
// under a short bar of that scale. A flat lane's stretch is `hover`.
export function walkKey(
  walk: LiftedWalk,
  reference?: { name?: string; start: number; end: number },
) {
  const { field } = walk.encoding
  const own = walk.range
    ? rangeText(walk.range.contig, walk.range.start, walk.range.end)
    : undefined
  const scale =
    field === 'progress'
      ? own
      : field === 'reference' && reference
        ? rangeText(reference.name, reference.start, reference.end)
        : undefined
  // what the walk spans on its contig, which its pieces may not all show
  const spanned = walk.extent ? walk.extent.end - walk.extent.start : walk.bp
  const unstated = spanned - walk.bp - walk.missingBp - walk.ownBp
  const outside = walk.readBp ?? unstated
  const gaps = [
    [walk.unloadedBp, 'whose nodes are not shown'],
    [walk.missingBp, GAP_CAUSE_TEXT.missing],
    [
      walk.ownBp,
      ownGapText(
        walk.referencePath &&
          (panSNHaplotype(walk.referencePath) ?? walk.referencePath),
        walk.revisited,
      ),
    ],
    [
      walk.readBp === undefined ? 0 : unstated - walk.readBp,
      GAP_CAUSE_TEXT.unread,
    ],
    [outside, OUTSIDE_TEXT],
  ] as const
  return {
    gaps: gaps
      .filter(([bp]) => bp > 0)
      .map(([bp, text]) => `, ${formatBp(bp)} ${text}`)
      .join(''),
    shades: field !== 'walk',
    scale,
    hover: scale === own ? undefined : own,
  }
}

// Whether a walk visits a node, and where the node sits on the walk's own
// contig at its first visit, from how far along the walk it is: nothing where
// the walk states no start, or its nodes are not drawn at its own lengths
export function walkPosition(walk: LiftedWalk, nodeId: string, length: number) {
  const progress = walk.progress.get(nodeId)
  const { range, extent } = walk
  const start =
    progress === undefined || !extent || !walk.ownLengths
      ? undefined
      : Math.round(
          extent.start + progress * (extent.end - extent.start) - length / 2,
        )
  return {
    onWalk: progress !== undefined,
    at:
      range && start !== undefined
        ? `${range.contig}:${groupDigits(start + 1)}-${groupDigits(start + length)}`
        : undefined,
  }
}
