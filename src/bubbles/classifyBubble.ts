import { NOT_LOADED_TEXT } from '../gfa/departures'
import { formatBp } from '../graphLabels'
import { SATURATED_PATH_COUNT } from './bubbleLine'

import type { MinigraphBubble } from './bubbleLine'

// An annotated tandem repeat array over the cut (repeats/repeatFeatures).
// Its refName is not compared: the arrays are read over the same window as
// the bubbles, which spell the reference their own way (PanSN).
export interface RepeatSpan {
  start: number
  end: number
  name?: string
}

// How far past its reference length an array's alleles may run and still be
// copies of it: KIV-2's 40 kb array carries 175 kb alleles
const REPEAT_GROWTH = 10

// The array covering at least half the bubble's reference interval, or the
// point of an insertion, and long enough to account for its alleles: a
// microsatellite at an insertion point does not make the insertion a repeat.
function coveringRepeat(b: MinigraphBubble, repeats: readonly RepeatSpan[]) {
  const span = b.end - b.start
  const growth = b.longestAlleleLength - b.shortestAlleleLength
  return repeats.find(
    r =>
      growth <= REPEAT_GROWTH * (r.end - r.start) &&
      (span === 0
        ? r.start <= b.start && b.start <= r.end
        : Math.min(b.end, r.end) - Math.max(b.start, r.start) >= span / 2),
  )
}

const SUPERBUBBLE_SEGMENTS = 40

function formatBpRange(shortest: number, longest: number) {
  const low = formatBp(shortest)
  const high = formatBp(longest)
  const unit = high.slice(high.indexOf(' '))
  return low === high
    ? high
    : low.endsWith(unit)
      ? `${low.slice(0, -unit.length)}–${high}`
      : `${low}–${high}`
}

function routes(count: number) {
  if (count >= SATURATED_PATH_COUNT) {
    return '≥2.1B routes'
  }
  if (count >= 100_000) {
    return `${(count / 1000).toFixed(0)}k routes`
  }
  return `${count} routes`
}

// A bubble in words, read off the numbers `gfatools bubble` states: its
// shortest and longest route and how many routes there are. It names no event
// against the reference: an inversion, an insertion and a deletion all read as
// their routes. Only what is not a reference relation gets a name of its own:
// a single base, a superbubble by its segment count, and a repeat array, which
// is not in those numbers but in the session's repeat annotation, since a
// presence/absence insertion carried by many haplotypes has the same shape as
// an expanding array.
export function bubbleLabel(
  b: MinigraphBubble,
  repeats: readonly RepeatSpan[] = [],
) {
  const label = b.unloaded
    ? `${formatBpRange(b.shortestAlleleLength, b.longestAlleleLength)}, ${routes(b.pathCount)}, some ${NOT_LOADED_TEXT}`
    : shapeLabel(b, repeats)
  return b.partial ? `${label}, partial` : label
}

function shapeLabel(b: MinigraphBubble, repeats: readonly RepeatSpan[]) {
  const {
    shortestAlleleLength: shortest,
    longestAlleleLength: longest,
    pathCount,
    segmentCount,
  } = b
  const range = formatBpRange(shortest, longest)
  // routes of one length are substitutions inside an array, not copies
  const repeat =
    segmentCount < SUPERBUBBLE_SEGMENTS &&
    !b.inversion &&
    !b.offReference &&
    longest !== shortest
      ? coveringRepeat(b, repeats)
      : undefined
  return segmentCount >= SUPERBUBBLE_SEGMENTS
    ? `${range} superbubble, ${segmentCount} segments, ${routes(pathCount)}`
    : repeat
      ? `${range} repeat array${repeat.name ? ` (${repeat.name})` : ''}, ${routes(pathCount)}`
      : !b.inversion &&
          shortest === longest &&
          longest <= 1 &&
          (b.offReference || longest === b.end - b.start)
        ? 'SNP'
        : `${range}, ${routes(pathCount)}`
}

// Every halo in one hue, which says "a bubble" and no kind of event: clear of
// the skipped-sequence dashes' near-black and of the reference ramp.
export const BUBBLE_HALO_COLOR = '#5b6b7a'

export function bubbleSegmentIds(b: MinigraphBubble) {
  return b.segments.split(',').filter(Boolean)
}
