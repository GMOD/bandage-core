import { compactTables, nodeLimitError } from './gbzWindow'
import { gfaTables } from './gfa/gfaTables'

import type { CompactSubgraph } from '@gmod/gbz-base'

const tripped = (walkedBp: number) =>
  Object.assign(new Error('Subgraph size limit of 3 nodes exceeded'), {
    name: 'SubgraphLimitError',
    walkedBp,
  })

test('a tripped limit names a zoom from how far the walk got', () => {
  expect(nodeLimitError(tripped(1000), 3, 10_000)?.message).toMatch(
    /zoom in to about 800 bp/,
  )
  expect(nodeLimitError(tripped(0), 3, 10_000)?.message).toMatch(
    /zoom in to about 5,000 bp/,
  )
})

test('a tripped limit is marked as a window too large, not a failure', () => {
  expect(nodeLimitError(tripped(1000), 3, 10_000)).toMatchObject({
    regionTooLarge: true,
    fitsBp: 800,
  })
})

test('an error that is not the node limit passes through', () => {
  expect(nodeLimitError(new Error('network'), 3, 10_000)).toBeUndefined()
})

// handles are 2 * id, plus 1 read in reverse
const fwd = (id: number) => 2 * id
const rev = (id: number) => 2 * id + 1

test("a cut's typed arrays are the tables of the GFA it writes", () => {
  const cut: CompactSubgraph = {
    nodeIds: Int32Array.of(10, 11, 13),
    nodeSequences: ['ACGT', 'A', 'GG'],
    edges: Int32Array.of(fwd(10), fwd(11), fwd(11), rev(13), rev(10), fwd(13)),
    paths: [
      {
        name: 'GRCh38#0#chr6[100-107]',
        weight: undefined,
        cigar: undefined,
        steps: Int32Array.of(fwd(10), fwd(11), rev(13)),
      },
      {
        name: 'HG002#1#CM1.1[5-20]',
        weight: 3,
        cigar: undefined,
        steps: Int32Array.of(fwd(10), fwd(12), rev(99), fwd(12), rev(99)),
      },
    ],
  }
  const gfa = [
    'H\tVN:Z:1.1\tRS:Z:GRCh38',
    'S\t10\tACGT',
    'S\t11\tA',
    'S\t13\tGG',
    'L\t10\t+\t11\t+\t0M',
    'L\t11\t+\t13\t-\t0M',
    'L\t10\t-\t13\t+\t0M',
    'W\tGRCh38\t0\tchr6\t100\t107\t>10>11<13',
    'W\tHG002\t1\tCM1.1\t5\t20\t>10>12<99>12<99\tWT:i:3',
  ].join('\n')
  expect(compactTables(cut)).toEqual(gfaTables(gfa))
})
