import { nodeInk, walkLaneWidthPx } from './nodeWidths'

import type { GraphNode } from './types'

const node: GraphNode = { id: 'a+', name: 'a', length: 10, depth: 1 }
const byId = new Map([[node.id, node]])

test('a node with no lifted walks reaches half its width', () => {
  const ink = nodeInk(undefined, byId, 6, 'uniform')
  expect(ink.halfWidthPx('a+')).toBe(3)
  expect(ink.maxHalfWidthPx).toBe(3)
})

test('lifted walks reach as far as the lanes are drawn', () => {
  // three 4 px lanes where the node is 6 px wide
  expect(walkLaneWidthPx(6, 3)).toBe(4)
  const ink = nodeInk(undefined, byId, 6, 'uniform', 3)
  expect(ink.halfWidthPx('a+')).toBe(6)
  expect(ink.maxHalfWidthPx).toBe(6)
})

test('lanes that fit inside the node leave its width as the reach', () => {
  const ink = nodeInk(undefined, byId, 12, 'uniform', 2)
  expect(ink.halfWidthPx('a+')).toBe(6)
})
