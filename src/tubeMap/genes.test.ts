import fs from 'fs'
import path from 'path'

import { referenceBoxes, rulerBoxes, tubeX } from './axis'
import { tubeMapGenes } from './genes'
import { convertGFAToGraph } from '../gfa/gfaConverter'
import { parseGFA } from '../gfa-core/index'
import { tubeMapLayout } from '../layout/tubeMapLayout'
import { anchorGraph } from '../pathAnchoring'

import type { GeneModel } from '../genes/genePins'

const GFA = fs.readFileSync(
  path.join(__dirname, '../../../../test_data/cactus/cactus_240_280.gfa'),
  'utf8',
)

function cactus() {
  const graph = anchorGraph(convertGFAToGraph(parseGFA(GFA)), 'ref')
  const layout = tubeMapLayout(graph)!.tubeMap!.layout
  const byContig = referenceBoxes(graph, layout)
  return { byContig, boxes: rulerBoxes(byContig)! }
}

function gene(fields: Partial<GeneModel>): GeneModel {
  return {
    name: 'G',
    refName: 'ref',
    start: 0,
    end: 0,
    strand: 1,
    exons: [],
    ...fields,
  }
}

test('the reference boxes run left to right in bp and tube x', () => {
  const { boxes } = cactus()
  expect(boxes.length).toBeGreaterThan(10)
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i]!.bp0).toBe(boxes[i - 1]!.bp1)
    expect(boxes[i]!.x0).toBeGreaterThanOrEqual(boxes[i - 1]!.x1)
  }
})

test('a bp maps into the box that holds it, linearly', () => {
  const { boxes } = cactus()
  const box = boxes.reduce((a, b) => (b.bp1 - b.bp0 > a.bp1 - a.bp0 ? b : a))
  const mid = (box.bp0 + box.bp1) / 2
  expect(tubeX(boxes, box.bp0)).toBe(box.x0)
  expect(tubeX(boxes, mid)).toBeCloseTo((box.x0 + box.x1) / 2)
  expect(tubeX(boxes, -10)).toBe(boxes[0]!.x0)
})

test('a gene takes its span and exons in tube x, clipped to the cut', () => {
  const { byContig, boxes } = cactus()
  const end = boxes.at(-1)!.bp1
  const [g] = tubeMapGenes(byContig, [
    gene({
      start: 20,
      end: end + 500,
      exons: [
        { start: 20, end: 40 },
        { start: end + 100, end: end + 200 },
      ],
    }),
  ])
  expect(g!.x0).toBe(tubeX(boxes, 20))
  expect(g!.x1).toBe(boxes.at(-1)!.x1)
  expect(g!.exons).toEqual([{ x0: tubeX(boxes, 20), x1: tubeX(boxes, 40) }])
})

test('genes off the cut or on another contig are left out', () => {
  const { byContig, boxes } = cactus()
  const end = boxes.at(-1)!.bp1
  expect(
    tubeMapGenes(byContig, [
      gene({ start: end + 1, end: end + 10 }),
      gene({ refName: 'other', start: 0, end: 10 }),
    ]),
  ).toEqual([])
})

test('a PanSN contig matches the gene track by its last field', () => {
  const { byContig } = cactus()
  const renamed = new Map([['chr6', byContig.get('ref')!]])
  expect(
    tubeMapGenes(renamed, [gene({ refName: 'GRCh38#0#chr6', end: 10 })]),
  ).toHaveLength(1)
})

test('a span on a box boundary stays off the curves either side', () => {
  const { boxes } = cactus()
  const [a, b] = boxes
  expect(tubeX(boxes, a!.bp1)).toBe(b!.x0)
  expect(tubeX(boxes, a!.bp1, true)).toBe(a!.x1)
})
