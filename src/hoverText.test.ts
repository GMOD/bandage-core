import { expect, test } from 'vitest'

import { edgeHoverText, regionLabel } from './hoverText'

import type { DeletionEdge } from './deletionEdges'
import type { GraphEdge } from './types'

const edge: GraphEdge = {
  from: 's1+',
  to: 's2+',
  fromStrand: '+',
  toStrand: '-',
}

test('a span reads 1-based and inclusive, as a node location does', () => {
  expect(regionLabel({ refName: 'chr6', start: 1000, end: 2000 })).toBe(
    'chr6:1,001-2,000',
  )
})

// the ids carry a strand, the names do not, so a caller passes the node's name
test('an edge names both ends with their strands', () => {
  expect(edgeHoverText(edge, undefined, id => id.slice(0, -1))).toEqual({
    ends: 's1+ → s2-',
  })
})

test('with no names to read, an edge names its ids', () => {
  expect(edgeHoverText(edge, undefined).ends).toBe('s1++ → s2+-')
})

test('a deletion says how much it skips and where', () => {
  const deletion = {
    refName: 'chr6',
    start: 1000,
    end: 87000,
    bp: 86000,
  } as DeletionEdge
  expect(edgeHoverText(edge, deletion)).toEqual({
    deletion: { bp: '86,000 bp', where: 'chr6:1,001-87,000' },
  })
})
