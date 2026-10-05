import { expect, test } from 'vitest'

import { walkRowLabels } from './walkRowLayout'

import type { RowPitch } from './walkRowDraw'
import type { WalkRows } from './walkRows'
import type { LayoutResult } from '../types'

const ROWS = {
  reference: { name: 'chm13', label: 'CHM13' },
  rows: [{ name: 'hg002', label: 'HG002#1' }],
} as unknown as WalkRows

test('the reference labels row 0, at the pitch the rows draw at', () => {
  expect(walkRowLabels(ROWS)).toEqual([
    { label: 'CHM13', y: 0 },
    { label: 'HG002#1', y: 20 },
  ])
  const pitch = { rowPx: 6, barPx: 4, labelled: true, readouts: false }
  expect(walkRowLabels(ROWS, undefined, pitch).at(-1)).toEqual({
    label: 'HG002#1',
    y: 6,
  })
})

test('a strip packed too dense to label has none', () => {
  const pitch: RowPitch = {
    rowPx: 1,
    barPx: 1,
    labelled: false,
    readouts: false,
  }
  expect(walkRowLabels(ROWS, undefined, pitch)).toEqual([])
})

test('with no rows, the layout states its own labels', () => {
  const layout = { rowLabels: [{ label: 'row', y: 3 }] } as LayoutResult
  expect(walkRowLabels(undefined, layout)).toEqual(layout.rowLabels)
  expect(walkRowLabels(undefined)).toEqual([])
})
