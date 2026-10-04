import { nodeLimitError } from './gbzWindow'

const tripped = (walkedBp: number) =>
  Object.assign(new Error('Subgraph size limit of 3 nodes exceeded'), {
    name: 'SubgraphLimitError',
    walkedBp,
  })

test('a tripped limit names a zoom from how far the walk got', () => {
  expect(nodeLimitError(tripped(1000), 3, 10_000)?.message).toMatch(
    /zoom in to about 800 bp/,
  )
  expect(nodeLimitError(tripped(0), 3, 10_000)?.message).toMatch(
    /zoom in to about 5,000 bp/,
  )
})

test('a tripped limit is marked as a window too large, not a failure', () => {
  expect(nodeLimitError(tripped(1000), 3, 10_000)).toMatchObject({
    regionTooLarge: true,
    fitsBp: 800,
  })
})

test('an error that is not the node limit passes through', () => {
  expect(nodeLimitError(new Error('network'), 3, 10_000)).toBeUndefined()
})
