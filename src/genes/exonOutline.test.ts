import { describe, expect, it } from 'vitest'

import { serializeEl } from '../el'
import { EXON_COLOR, exonOutlineTree, exonStretches } from './exonOutline'

import type { GenePin } from './genePins'

const pin = (exonsByNode: GenePin['exonsByNode']): GenePin => ({
  gene: {
    name: 'LPA',
    refName: 'chr6',
    start: 0,
    end: 100,
    strand: -1,
    exons: [{ start: 10, end: 20 }],
  },
  exons: exonsByNode.map(e => e.d).join(''),
  exonsByNode,
  at: { x: 0, y: 0 },
  covered: 1,
})

describe('exonStretches', () => {
  it('clears each node’s ink and a gap round it', () => {
    const stretches = exonStretches(
      [pin([{ nodeId: 'a+', d: 'M0,0L10,0' }])],
      () => 3,
    )
    expect(stretches).toEqual([{ key: 'LPA-0-a+', d: 'M0,0L10,0', inner: 8 }])
  })

  it('clears the lifted lanes where they are wider than the node', () => {
    const lift = { nodeIds: new Set(['a+']), walks: [1, 2, 3] }
    const [s] = exonStretches(
      [pin([{ nodeId: 'a+', d: 'M0,0L10,0' }])],
      () => 3,
      lift,
    )
    expect(s!.inner).toBe(14)
  })

  it('takes paths into the units the tree is drawn in', () => {
    const [s] = exonStretches(
      [pin([{ nodeId: 'a+', d: 'M0,0L10,0' }])],
      () => 3,
      undefined,
      d => d.replace('10', '20'),
    )
    expect(s!.d).toBe('M0,0L20,0')
  })
})

describe('exonOutlineTree', () => {
  it('draws nothing without exons', () => {
    expect(exonOutlineTree([], { id: 'x', width: 10, height: 10 })).toBe(
      undefined,
    )
  })

  it('cuts each outline from a wash of the exon colour, the node clear', () => {
    const svg = serializeEl(
      exonOutlineTree([{ key: 'k', d: 'M0,0L10,0', inner: 8 }], {
        id: 'exons0',
        width: 100,
        height: 50,
      })!,
    )
    expect(svg).toContain('<mask id="exons0"')
    expect(svg).toContain('stroke="#fff" stroke-width="12"')
    expect(svg).toContain('stroke="#000" stroke-width="8"')
    expect(svg).toContain(`fill="${EXON_COLOR}" mask="url(#exons0)"`)
    expect(svg).not.toContain('vector-effect')
  })

  it('keeps px strokes under a layout transform', () => {
    const svg = serializeEl(
      exonOutlineTree([{ key: 'k', d: 'M0,0L10,0', inner: 8 }], {
        id: 'o',
        width: 100,
        height: 50,
        transform: 'scale(2 2)',
      })!,
    )
    expect(svg).toContain('<g transform="scale(2 2)">')
    expect(svg).toContain('vector-effect="non-scaling-stroke"')
  })
})
