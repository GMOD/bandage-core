import { nodeLimitError } from './gbzWindow'

const tripped = (walkedBp: number) =>
  Object.assign(new Error('Subgraph size limit of 3 nodes exceeded'), {
    name: 'SubgraphLimitError',
    walkedBp,
  })

test('a limit tripped in a later piece names a zoom from the window start', () => {
  expect(nodeLimitError(tripped(1000), 3, 10_000)?.message).toMatch(
    /zoom in to about 800 bp/,
  )
  expect(nodeLimitError(tripped(1000), 3, 10_000, 6000)?.message).toMatch(
    /zoom in to about 5,600 bp/,
  )
})

test('an error that is not the node limit passes through', () => {
  expect(nodeLimitError(new Error('network'), 3, 10_000)).toBeUndefined()
})
