import { expect, test, vi } from 'vitest'

import { edgeHoverText, regionLabel, skipAt } from './hoverText'
import { paddedFeet } from './layout/replacementFeet'
import { loadGraph } from './pipeline'

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

// a German browser wrote chr6:1.001-2.000 beside a key reading 1,001-2,000
test('a span and a deletion group digits the same whatever the host locale', () => {
  const asked = vi
    .spyOn(Number.prototype, 'toLocaleString')
    .mockImplementation(() => {
      throw new Error('digits were grouped by the host locale')
    })
  try {
    expect(regionLabel({ refName: 'chr6', start: 1000, end: 2000 })).toBe(
      'chr6:1,001-2,000',
    )
    expect(
      edgeHoverText(edge, {
        ...edge,
        edgeIndex: 0,
        refName: 'chr6',
        start: 1000,
        end: 87000,
        bp: 86000,
        bypassed: [],
      }),
    ).toEqual({ deletion: { bp: '86,000 bp', where: 'chr6:1,001-87,000' } })
  } finally {
    asked.mockRestore()
  }
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

// SV-rep-1k-10k: 2 bp of HG01109's own in place of 1,839 bp of GRCh38, its
// feet drawn in a skip's ink once routed, hovered as "Edge: r1+ → x+"; and
// with a second walk >r1>x>y>r3 through the same first link, which once read
// "replaced by 2 bp" though that walk takes 502 bp there
test.each<[string, string[]]>([
  ['alone', []],
  [
    'beside >r1>x>y>r3',
    [
      `S\ty\t${'A'.repeat(500)}`,
      'L\tx\t+\ty\t+\t0M',
      'L\ty\t+\tr3\t+\t0M',
      'W\tHG002\t1\tc\t0\t4502\t>r1>x>y>r3',
    ],
  ],
])(
  'a routed foot of a run in place of longer reference, %s, says what its run skips and nothing of what replaces it',
  (_, second) => {
    const graph = loadGraph(
      [
        `S\tr1\t${'A'.repeat(2000)}`,
        `S\tr2\t${'A'.repeat(1839)}`,
        `S\tr3\t${'A'.repeat(2000)}`,
        'S\tx\tAA',
        'L\tr1\t+\tr2\t+\t0M',
        'L\tr2\t+\tr3\t+\t0M',
        'L\tr1\t+\tx\t+\t0M',
        'L\tx\t+\tr3\t+\t0M',
        'W\tGRCh38\t0\tchr5\t0\t5839\t>r1>r2>r3',
        'W\tHG01109\t1\tc\t0\t4002\t>r1>x>r3',
        ...second,
      ].join('\n'),
      'replacement',
    )
    const said = {
      deletion: { bp: '1,839 bp', where: 'GRCh38#0#chr5:2,001-3,839' },
    }
    const feet = paddedFeet(graph)
    const id = (name: string) => graph.nodes.find(n => n.name === name)!.id
    expect(
      feet.some(
        ({ edgeIndex }) =>
          graph.edges[edgeIndex]!.from === id('r1') &&
          graph.edges[edgeIndex]!.to === id('x'),
      ),
    ).toBe(true)
    for (const foot of feet) {
      expect(edgeHoverText(graph.edges[foot.edgeIndex]!, foot)).toEqual(said)
    }
    const route = [{ x: 0, y: 0 }]
    for (const { edgeIndex } of feet) {
      const skip = skipAt(graph, edgeIndex, [], { [edgeIndex]: route })
      expect(edgeHoverText(graph.edges[edgeIndex]!, skip)).toEqual(said)
      expect(skipAt(graph, edgeIndex, [], {})).toBeUndefined()
    }
  },
)
