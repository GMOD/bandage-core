import { groupDigits } from './graphLabels'

import type { GraphPath } from './types'

// What a key or a hover calls a thread: its haplotype count with the picks
// of a host's it holds, or the one walk it is
export function threadLabel(
  thread: Pick<GraphPath, 'count' | 'pieces'>,
  own: string,
  picked: readonly string[] = [],
) {
  const count = thread.count ?? 1
  return count > 1
    ? `${count.toLocaleString('en-US')} haplotypes${
        picked.length > 0 ? `, ${picked.join(', ')} among them` : ''
      }`
    : thread.pieces
      ? `${own}, one of its ${thread.pieces} pieces here`
      : own
}

// What a key says a fold leaves out: between two places a haplotype meets the
// reference, any one stretch it has off it or skips of it shorter than
// `belowBp`, however many such stretches add up to
export const threadFoldKey = (
  { belowBp }: { belowBp: number },
  reference: string,
) =>
  `not drawn: sequence shorter than ${groupDigits(belowBp)} bp that a haplotype adds to ${reference} or skips of it before rejoining it`

// What a key says a lane of a fold is
export const THREAD_LANE_KEY =
  'a lane is the haplotypes that take one drawn route'
