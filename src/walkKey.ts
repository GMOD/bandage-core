import { formatBp } from './graphLabels'

import type { LiftedWalk } from './walkHighlight'

// `contig:start-end (length)`
export function rangeText(
  contig: string | undefined,
  start: number,
  end: number,
) {
  const s = Math.round(start)
  const e = Math.round(end)
  return `${contig ? `${contig}:` : ''}${s.toLocaleString()}-${e.toLocaleString()} (${formatBp(e - s)})`
}

// A lifted walk's key in words, for a legend row or a facet panel's title: its
// length against the reference and the bp it runs reversed, and for a lane that
// shades, the stretch its scale runs over as `contig:start-end (length)`, to
// write under a short bar of that scale. A flat lane's stretch is `hover`.
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
  return {
    delta:
      walk.referenceBp === undefined || walk.bp === walk.referenceBp
        ? ''
        : ` ${walk.bp > walk.referenceBp ? '+' : '−'}${formatBp(Math.abs(walk.bp - walk.referenceBp))}`,
    reversed:
      walk.reversedBp > 0 ? `, ${formatBp(walk.reversedBp)} reversed` : '',
    shades: field !== 'walk',
    scale,
    hover: scale === own ? undefined : own,
  }
}

// Where a node sits on a walk's own contig, from how far along the walk it
// is: the stretch the walk's record gives it at its first visit
export function walkPosition(walk: LiftedWalk, nodeId: string, length: number) {
  const progress = walk.progress.get(nodeId)
  const range = walk.range
  if (progress === undefined || !range) {
    return undefined
  }
  const start = Math.round(range.start + progress * walk.bp - length / 2)
  return `${range.contig}:${start.toLocaleString()}-${(start + length).toLocaleString()}`
}
