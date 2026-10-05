import { expect, test } from 'vitest'

import { cutsWholeWalks, walkStripApplies } from './walkStrip'

const NODES = { drawsNodes: true }
const PICTURE = { drawsNodes: false }

test('the strip shows under a node layout for a graph with walks', () => {
  expect(walkStripApplies({ walkStrip: true, mode: NODES, walks: 9 })).toBe(
    true,
  )
  expect(walkStripApplies({ walkStrip: false, mode: NODES, walks: 9 })).toBe(
    false,
  )
  expect(walkStripApplies({ walkStrip: true, mode: PICTURE, walks: 9 })).toBe(
    false,
  )
  expect(walkStripApplies({ walkStrip: true, mode: NODES, walks: 1 })).toBe(
    false,
  )
})

test('nothing shows under a picture, a popped bubble or a host', () => {
  const asked = { walkStrip: true, mode: NODES, walks: 9 }
  expect(walkStripApplies({ ...asked, drawsPicture: true })).toBe(false)
  expect(walkStripApplies({ ...asked, popped: true })).toBe(false)
  expect(walkStripApplies({ ...asked, host: true })).toBe(false)
})

test('the strip asks a cut for whole walks, unless hosted', () => {
  const rows = { wholeWalks: true }
  const other = { wholeWalks: false }
  expect(cutsWholeWalks(rows, { walkStrip: false })).toBe(true)
  expect(cutsWholeWalks(other, { walkStrip: false })).toBe(false)
  expect(cutsWholeWalks(other, { walkStrip: true })).toBe(true)
  expect(cutsWholeWalks(other, { walkStrip: true, host: true })).toBe(false)
  // a walk-rows layout measures them whether or not it is hosted
  expect(cutsWholeWalks(rows, { walkStrip: true, host: true })).toBe(true)
})
