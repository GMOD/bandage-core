import { formatBp, groupDigits } from './graphLabels'

import type { LiftedWalk } from './walkHighlight'

// `contig:start-end (length)`
export function rangeText(
  contig: string | undefined,
  start: number,
  end: number,
) {
  const s = Math.round(start)
  const e = Math.round(end)
  return `${contig ? `${contig}:` : ''}${groupDigits(s)}-${groupDigits(e)} (${formatBp(e - s)})`
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
  // what the walk spans on its contig, which its pieces may not all show
  const spanned = walk.range ? walk.range.end - walk.range.start : walk.bp
  const outside = spanned - walk.bp
  return {
    delta:
      walk.referenceBp === undefined || spanned === walk.referenceBp
        ? ''
        : ` ${spanned > walk.referenceBp ? '+' : '−'}${formatBp(Math.abs(spanned - walk.referenceBp))}`,
    outside: outside > 0 ? `, ${formatBp(outside)} outside the cut` : '',
    reversed:
      walk.reversedBp > 0 ? `, ${formatBp(walk.reversedBp)} reversed` : '',
    shades: field !== 'walk',
    scale,
    hover: scale === own ? undefined : own,
  }
}

// Where a node sits on a walk's own contig, from how far along the walk it
// is: the stretch the walk's records give it at its first visit
export function walkPosition(walk: LiftedWalk, nodeId: string, length: number) {
  const progress = walk.progress.get(nodeId)
  const range = walk.range
  if (progress === undefined || !range) {
    return undefined
  }
  const start = Math.round(
    range.start + progress * (range.end - range.start) - length / 2,
  )
  return `${range.contig}:${groupDigits(start)}-${groupDigits(start + length)}`
}
