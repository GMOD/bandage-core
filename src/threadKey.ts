import { formatBp } from './graphLabels'

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

// What a key says of a fold's threads
export const threadFoldKey = ({ belowBp }: { belowBp: number }) =>
  `a thread is the haplotypes alike in every difference of ${formatBp(belowBp)} or more; smaller ones are not drawn`
