import { deletionDrawing, deletionEdges } from './deletionEdges'
import { parseGFA } from './gfa-core/index'
import { convertGFAToGraph } from './gfa/gfaConverter'
import {
  hiddenUnderHalos,
  inversionHalos,
  inversionKey,
} from './inversionHalos'
import { drawnInversionHalos, hiddenLinks } from './renderer/geometryInputs'

// 2 lies between 1 and 3 on the reference, and `L 1 + 2 -`, `L 2 - 3 +` read
// it backwards
const graph = convertGFAToGraph(
  parseGFA(
    [
      'S\t1\t*\tLN:i:10\tSN:Z:chr1\tSO:i:0\tSR:i:0',
      'S\t2\t*\tLN:i:3000\tSN:Z:chr1\tSO:i:10\tSR:i:0',
      'S\t3\t*\tLN:i:10\tSN:Z:chr1\tSO:i:3010\tSR:i:0',
      'L\t1\t+\t2\t+\t0M',
      'L\t2\t+\t3\t+\t0M',
      'L\t1\t+\t2\t-\t0M',
      'L\t2\t-\t3\t+\t0M',
    ].join('\n'),
  ),
)
const drawing = deletionDrawing(graph, deletionEdges(graph))
const inverted = drawing.inversions ?? []

const flat = {
  '1+': [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
  '2+': [
    { x: 12, y: 0 },
    { x: 40, y: 0.5 },
    { x: 70, y: 0 },
  ],
  '3+': [
    { x: 72, y: 0 },
    { x: 82, y: 0 },
  ],
}
const curled = {
  ...flat,
  '2+': [
    { x: 12, y: 0 },
    { x: 20, y: -30 },
    { x: 4, y: -30 },
    { x: 11, y: 0 },
  ],
}

test('a run drawn flat gets a halo along it, named with its length, and its links leave the drawing', () => {
  const halos = inversionHalos(inverted, flat)
  expect(halos).toEqual([
    {
      inversion: inverted[0],
      points: flat['2+'],
      labelAt: { x: 41, y: 0 },
      note: '3 kb',
      flat: true,
    },
  ])
  expect([...hiddenUnderHalos(drawing.hidden, halos)]).toEqual([2, 3])
})

test('a curled run gets its halo and keeps the links that draw its loop', () => {
  const halos = inversionHalos(inverted, curled)
  expect(halos).toMatchObject([{ flat: false, labelAt: { x: 12, y: -30 } }])
  expect(hiddenUnderHalos(drawing.hidden, halos)).toBe(drawing.hidden)
})

test('a run the layout did not place has no halo', () => {
  expect(inversionHalos(inverted, { '1+': flat['1+'] })).toEqual([])
})

test('the key names the reference it reverses', () => {
  expect(inversionKey('GRCh38 chrX')).toBe(
    'INV: GRCh38 chrX sequence inverted in some haplotypes',
  )
})

test('a drawing that states no inversions draws none and hides only its own links', () => {
  const { inversions: _, ...older } = drawing
  const layout = { nodePositions: flat }
  expect(drawnInversionHalos(layout, older)).toEqual([])
  expect(hiddenLinks(layout, older)).toBe(drawing.hidden)
  expect(drawnInversionHalos(layout, drawing)).toHaveLength(1)
})
