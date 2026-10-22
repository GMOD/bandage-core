import { walkThreads } from './walkLanes'

test("each thread through a node carries one of the walk's visits to it", () => {
  const route = [
    ['a', 'b', 'a'],
    ['c', 'a', 'b'],
  ]
  const passes = new Map([
    ['a', 3],
    ['b', 2],
    ['c', 1],
  ])
  const at = (x: number) => [
    { x, y: 0 },
    { x: x + 1, y: 0 },
  ]
  const positions = { a: at(0), b: at(2), c: at(4) }
  const { nodeThreads, threadPasses } = walkThreads(
    route,
    passes,
    positions,
    1,
    10,
  )
  for (const [id, count] of passes) {
    const carried = nodeThreads.get(id)!.map(t => threadPasses.get(id)![t])
    expect(carried.toSorted()).toEqual([...Array(count).keys()])
  }
})
