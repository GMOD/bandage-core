import { describe, expect, it } from 'vitest'

import { bubbleLabel, bubbleSegmentIds } from './classifyBubble'

import type { MinigraphBubble } from './bubbleLine'

function bubble(over: Partial<MinigraphBubble>): MinigraphBubble {
  return {
    refName: 'GRCh38#0#chr6',
    start: 0,
    end: 0,
    segmentCount: 3,
    pathCount: 2,
    inversion: false,
    shortestAlleleLength: 0,
    longestAlleleLength: 0,
    segments: 'a,b,c',
    shortestAllele: undefined,
    longestAllele: undefined,
    ...over,
  }
}

// Real rows from the hosted HPRC release 2.1 bubble index at KIV-2 and MHC.
describe('bubbleLabel', () => {
  it('states a bubble on a zero-width interval by its routes', () => {
    expect(
      bubbleLabel(
        bubble({
          start: 160535205,
          end: 160535205,
          shortestAlleleLength: 0,
          longestAlleleLength: 1245,
        }),
      ),
    ).toBe('0 bp–1.2 kb, 2 routes')
  })

  it('counts the alleles past two', () => {
    expect(
      bubbleLabel(
        bubble({
          start: 100,
          end: 100,
          pathCount: 3,
          shortestAlleleLength: 0,
          longestAlleleLength: 2000,
        }),
      ),
    ).toBe('0 bp–2 kb, 3 routes')
  })

  it('names no deletion where the longest route is the reference', () => {
    expect(
      bubbleLabel(
        bubble({
          start: 160588770,
          end: 160593193,
          shortestAlleleLength: 0,
          longestAlleleLength: 4423,
        }),
      ),
    ).toBe('0 bp–4.4 kb, 2 routes')
  })

  const KIV2 = bubble({
    start: 160616002,
    end: 160646753,
    segmentCount: 29,
    pathCount: 129,
    shortestAlleleLength: 3018,
    longestAlleleLength: 174966,
  })

  it('calls a bubble a repeat array where the repeat track has one', () => {
    expect(
      bubbleLabel(KIV2, [{ start: 160611000, end: 160651000, name: 'KIV-2' }]),
    ).toBe('3–175 kb repeat array (KIV-2), 129 routes')
  })

  it('does not call a bubble a repeat from its shape alone', () => {
    expect(bubbleLabel(KIV2)).toBe('3–175 kb, 129 routes')
    expect(bubbleLabel(KIV2, [{ start: 160640000, end: 160700000 }])).toBe(
      '3–175 kb, 129 routes',
    )
  })

  // GSTT1: a 55 kb presence/absence insertion carried by many haplotypes,
  // which the old shape rule called a repeat array
  it('calls a common presence/absence insertion no repeat array', () => {
    const gstt1 = bubble({
      start: 23990000,
      end: 23990000,
      pathCount: 12,
      shortestAlleleLength: 0,
      longestAlleleLength: 55000,
    })
    expect(bubbleLabel(gstt1)).toBe('0 bp–55 kb, 12 routes')
    expect(bubbleLabel(gstt1, [{ start: 23989990, end: 23990030 }])).toBe(
      '0 bp–55 kb, 12 routes',
    )
  })

  it('keeps routes of one length inside an array for what they are', () => {
    const snp = bubble({
      start: 100,
      end: 101,
      shortestAlleleLength: 1,
      longestAlleleLength: 1,
    })
    expect(bubbleLabel(snp, [{ start: 50, end: 150 }])).toBe('SNP')
  })

  it('names a saturated route count for what it is', () => {
    expect(
      bubbleLabel(
        bubble({
          start: 32486309,
          end: 32575299,
          segmentCount: 254,
          pathCount: 2147483647,
          shortestAlleleLength: 2423,
          longestAlleleLength: 205170,
        }),
      ),
    ).toBe('2.4–205 kb superbubble, 254 segments, ≥2.1B routes')
  })

  it('names a SNP, and states longer routes of one length by their length', () => {
    expect(
      bubbleLabel(
        bubble({
          start: 10,
          end: 11,
          shortestAlleleLength: 1,
          longestAlleleLength: 1,
        }),
      ),
    ).toBe('SNP')
    expect(
      bubbleLabel(
        bubble({
          start: 10,
          end: 14,
          shortestAlleleLength: 4,
          longestAlleleLength: 4,
        }),
      ),
    ).toBe('4 bp, 2 routes')
  })

  it('names no inversion, even of a single base', () => {
    const inverted = (shortest: number, longest: number) =>
      bubbleLabel(
        bubble({
          start: 10,
          end: 10 + longest,
          inversion: true,
          shortestAlleleLength: shortest,
          longestAlleleLength: longest,
        }),
      )
    expect(inverted(100, 900)).toBe('100–900 bp, 2 routes')
    expect(inverted(1, 1)).toBe('1 bp, 2 routes')
  })

  it('states a complex site by its allele range and routes, not the reference it replaces', () => {
    expect(
      bubbleLabel(
        bubble({
          start: 0,
          end: 12000,
          pathCount: 9,
          shortestAlleleLength: 8600,
          longestAlleleLength: 13000,
        }),
      ),
    ).toBe('8.6–13 kb, 9 routes')
  })

  it('marks a bubble the cut did not hold whole', () => {
    expect(
      bubbleLabel(
        bubble({
          start: 0,
          end: 41000,
          shortestAlleleLength: 41000,
          longestAlleleLength: 41000,
          partial: true,
        }),
      ),
    ).toBe('41 kb, 2 routes, partial')
  })

  it('reads a bubble off the reference by its routes alone', () => {
    const off = (shortest: number, longest: number) =>
      bubbleLabel(
        bubble({
          start: 160616010,
          end: 160646745,
          shortestAlleleLength: shortest,
          longestAlleleLength: longest,
          pathCount: 4,
          offReference: true,
        }),
      )
    expect(off(1, 1)).toBe('SNP')
    expect(off(5, 5)).toBe('5 bp, 4 routes')
    expect(off(0, 12)).toBe('0–12 bp, 4 routes')
  })

  it('splits the segment list', () => {
    expect(bubbleSegmentIds(bubble({ segments: 's1,s2,s3' }))).toEqual([
      's1',
      's2',
      's3',
    ])
  })
})
